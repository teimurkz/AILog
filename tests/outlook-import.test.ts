import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createOutlookImportService } from '../server/services/outlook-import.service.js';
import { parseInvoiceWorkbook, mergeMailShipment, ImportReview } from '../server/services/outlook-invoice.js';
import { OutlookGraph, OutlookError, graphUrl, microsoftTokenRequest, outlookScopes } from '../server/services/outlook-graph.js';
import { invoiceKey, validateOutlookSettings } from '../shared/outlook-import.js';
import { shipmentDaysPassed } from '../src/utils/shipmentUtils.js';
import express from 'express';
import http from 'node:http';
import outlookRouter from '../server/routes/outlook.routes.js';
import { createAuthenticator } from '../server/services/crm-auth.service.js';

// In-memory Firestore boundary: atomic transactions roll back on failure. No
// production database, account, network call or real email is used by these tests.
class MemoryDb {
  data = new Map<string, any>();
  queue = Promise.resolve();
  collection(path: string) {
    const database = this;
    const query = { doc: (id: string) => database.doc(`${path}/${id}`),
      get: async () => ({ docs: [...database.data.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1).map(key => database.snapshot(key)) }),
      orderBy: (_field: string, _order: string) => ({ limit: (_count: number) => query }) };
    return query;
  }
  snapshot(path: string, data = this.data) {
    return { id: path.split('/').at(-1), ref: this.doc(path), exists: data.has(path), data: () => structuredClone(data.get(path)) };
  }
  doc(path: string) {
    return { path, id: path.split('/').at(-1), get: async () => this.snapshot(path),
      set: async (value: any, options?: any) => { this.data.set(path, structuredClone(options?.merge ? { ...this.data.get(path), ...value } : value)); },
      update: async (value: any) => { assert.ok(this.data.has(path)); this.data.set(path, { ...this.data.get(path), ...structuredClone(value) }); },
      delete: async () => { this.data.delete(path); }, collection: (name: string) => this.collection(`${path}/${name}`) };
  }
  async runTransaction<T>(work: (transaction: any) => Promise<T>): Promise<T> {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const pending = structuredClone(this.data);
    const tx = {
      get: async (ref: any) => this.snapshot(ref.path, pending),
      set: (ref: any, value: any, options?: any) => pending.set(ref.path, options?.merge ? { ...pending.get(ref.path), ...structuredClone(value) } : structuredClone(value)),
      update: (ref: any, value: any) => { assert.ok(pending.has(ref.path)); pending.set(ref.path, { ...pending.get(ref.path), ...structuredClone(value) }); },
      create: (ref: any, value: any) => { assert.equal(pending.has(ref.path), false); pending.set(ref.path, structuredClone(value)); },
      delete: (ref: any) => pending.delete(ref.path),
    };
    try { const result = await work(tx); this.data = pending; return result; } finally { release(); }
  }
}
const settings = { tenantId: '00000000-0000-4000-8000-000000000001', clientId: '00000000-0000-4000-8000-000000000002',
  mailbox: 'owner@example.test', sender: 'partner@example.test', importFrom: '2026-09-01T00:00:00Z', travelDays: 12, enabled: true };
const receipt = '2026-09-10T08:43:35.000Z', tickTime = Date.parse('2026-09-15T10:00:00Z');
async function invoice(options: { name?: string; origin?: string; plate?: string; fullInvoice?: string } = {}) {
  const workbook = new ExcelJS.Workbook(), order = workbook.addWorksheet('Order Form'), cmr = workbook.addWorksheet('D CMR');
  order.getCell('I2').value = options.name || 'Customer 001.30';
  for (const row of [5, 6]) { order.getCell(`C${row}`).value = '300001'; order.getCell(`L${row}`).value = 100; order.getCell(`F${row}`).value = { formula: '"Milk"', result: 'Milk' }; }
  cmr.getCell('A15').value = 'INVOICE: ' + (options.fullInvoice || '20260907-001.30');
  cmr.getCell('A16').value = 'Date: 07.09.2026';
  cmr.getCell('A12').value = 'Amol, Iran - 08/09/2026'; cmr.getCell('J12').value = options.origin || 'Amol, Iran';
  cmr.getCell('A10').value = 'Almaty, Kazakhstan'; cmr.getCell('C14').value = options.plate || 'AA111/AA112';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function fixture() {
  const db = new MemoryDb();
  db.data.set('outlook_private/state', { settings, connectionId: 'connection', connectedMailbox: settings.mailbox, ownerUid: 'admin', watermark: settings.importFrom });
  db.data.set('outlook_private/credentials', { connectionId: 'connection', refreshToken: 'PRIVATE_REFRESH_TOKEN' });
  const excel = await invoice();
  const files = new Map([['excel', excel], ['pdf', Buffer.from('synthetic document')]]);
  const savedFiles = new Map<string, Buffer>();
  const fake = {
    page: [{ id: 'message-1', internetMessageId: '<message-1@example.test>', receivedDateTime: receipt, from: { emailAddress: { address: settings.sender } }, subject: 'Invoice' }],
    parts: [{ id: 'excel', name: 'Customer 001.30.xlsx', size: excel.length, '@odata.type': '#microsoft.graph.fileAttachment' },
      { id: 'pdf', name: 'document.pdf', size: 18, '@odata.type': '#microsoft.graph.fileAttachment' },
      { id: 'signature', name: 'image.png', size: 20, isInline: true, '@odata.type': '#microsoft.graph.fileAttachment' }],
    requests: [] as any[],
    profile: async () => ({ id: 'mailbox-id', mail: settings.mailbox }), excludedFolders: async () => ['trash', 'junk'],
    async messages(...args: any[]) { fake.requests.push(args); return { value: fake.page }; },
    attachments: async () => fake.parts,
    attachment: async (_id: string, id: string) => { const bytes = files.get(id); assert.ok(bytes); return bytes; },
    original: async () => Buffer.from('synthetic original email including signature'),
  };
  let failFile = false, clock = tickTime;
  const service = createOutlookImportService({ db: db as any, graph: () => fake as any,
    now: () => clock, oauth: async () => ({ access_token: 'PRIVATE_ACCESS_TOKEN', refresh_token: 'NEW_PRIVATE_REFRESH_TOKEN' }),
    saveFile: async (path, bytes) => { if (failFile) throw new Error('network'); savedFiles.set(path, bytes); return 'https://storage.example.test/' + path; } });
  return { db, service, fake, files, savedFiles, setFail: (value: boolean) => { failFile = value; }, setTime: (value: number) => { clock = value; } };
}

test('invoice parser separates receipt-independent invoice/loading dates, preserves decimal identifier, reads cached formula products', async () => {
  const draft = await parseInvoiceWorkbook(await invoice(), 'Customer 001.30.xlsx');
  assert.equal(draft.invoice_id, 'Customer 001.30'); assert.equal(draft.commercial_invoice_number, '20260907-001.30');
  assert.equal(draft.invoice_date, '2026-09-07'); assert.equal(draft.loading_date, '2026-09-08');
  assert.equal(draft.route, 'Amol - Almaty'); assert.deepEqual(draft.items, ['Milk']);
  assert.notEqual(invoiceKey('001.30'), invoiceKey('1.3'));
});
test('unknown routes, mismatched invoice names and corrupt workbooks go to review instead of guessed shipment data', async () => {
  await assert.rejects(parseInvoiceWorkbook(await invoice({ origin: 'Unknown city' }), 'Customer 001.30.xlsx'), ImportReview);
  await assert.rejects(parseInvoiceWorkbook(await invoice(), 'Customer 002.xlsx'), ImportReview);
  await assert.rejects(parseInvoiceWorkbook(await invoice({ fullInvoice: '20260907-002.10' }), 'Customer 001.30.xlsx'), /не совпадает/);
  await assert.rejects(parseInvoiceWorkbook(Buffer.from('bad file'), 'Customer 001.xlsx'), ImportReview);
});
test('new email creates one shipment and all documents before marking complete; replay is idempotent', async () => {
  const f = await fixture(); await f.service.run(); await f.service.run();
  const shipments = (await f.db.collection('shipments').get()).docs;
  assert.equal(shipments.length, 1);
  const shipment = shipments[0].data();
  assert.equal(shipment.documents_received_at, receipt); assert.equal(shipment.departure_date, receipt);
  assert.equal(shipment.loading_date, '2026-09-08'); assert.equal(shipment.status, 'In Transit');
  assert.equal(shipment.documents_url.length, 2); assert.equal(shipment.source_email_urls.length, 1);
  assert.equal(f.savedFiles.size, 3); assert.equal((await f.service.status()).logs.length, 1);
});
test('repeat emails append document versions without resetting receipt, delivery or manually edited fields', async () => {
  const f = await fixture(); await f.service.run();
  const ref = (await f.db.collection('shipments').get()).docs[0].ref;
  await ref.update({ status: 'Delivered', actual_arrival_date: '2026-09-12T08:43:35Z', plate_number: 'USER-EDIT' });
  f.fake.page[0] = { ...f.fake.page[0], id: 'message-2', internetMessageId: '<message-2@example.test>', receivedDateTime: '2026-09-14T10:00:00Z' };
  f.files.set('pdf', Buffer.from('revised document, same filename'));
  await f.service.run();
  const result = (await ref.get()).data();
  assert.equal(result.documents_url.length, 3); assert.equal(result.documents_received_at, receipt);
  assert.equal(result.status, 'Delivered'); assert.equal(result.plate_number, 'USER-EDIT');
  assert.equal(shipmentDaysPassed(result, new Date('2026-10-01')), 2);
});
test('partial upload failure cannot create an incomplete shipment and can be retried safely', async () => {
  const f = await fixture(); f.setFail(true);
  await assert.rejects(f.service.run());
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0); assert.equal((await f.service.status()).logs.length, 0);
  f.setFail(false); await f.service.run(); assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
});
test('existing legacy shipment is merged under its own ID without changing user fields or deleting documents', async () => {
  const f = await fixture();
  await f.db.collection('shipments').doc('legacy-id').set({ invoice_id: 'customer001.30', departure_date: '2026-09-08', status: 'Customs',
    plate_number: 'MANUAL', route: 'Tehran - Almaty', documents_url: ['legacy-url'], createdBy: 'another-user', customField: 123 });
  await f.service.run();
  const docs = (await f.db.collection('shipments').get()).docs;
  assert.equal(docs.length, 1); assert.equal(docs[0].id, 'legacy-id');
  const saved = docs[0].data(); assert.equal(saved.customField, 123); assert.equal(saved.createdBy, 'another-user');
  assert.equal(saved.departure_date, '2026-09-08'); assert.equal(saved.route, 'Tehran - Almaty'); assert.equal(saved.documents_url[0], 'legacy-url');
});
test('ambiguous multiple Excel attachments and legacy duplicate invoices create a visible review result', async () => {
  const f = await fixture(); f.fake.parts.push({ ...f.fake.parts[0], id: 'extra', name: 'Another 2.xlsx' });
  await f.service.run(); assert.equal((await f.service.status()).logs[0].status, 'review');
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0);
  const g = await fixture();
  for (const id of ['a', 'b']) await g.db.collection('shipments').doc(id).set({ invoice_id: 'Customer 001.30' });
  await g.service.run(); assert.match((await g.service.status()).logs[0].reason!, /несколько отправлений/);
});
test('wrong sender, old mail, drafts, spam and deleted items cannot become shipments', async () => {
  for (const patch of [{ from: { emailAddress: { address: 'other@example.test' } } }, { receivedDateTime: '2026-08-01T00:00:00Z' }, { isDraft: true }, { parentFolderId: 'trash' }, { parentFolderId: 'junk' }]) {
    const f = await fixture(); Object.assign(f.fake.page[0], patch); await f.service.run();
    assert.equal((await f.db.collection('shipments').get()).docs.length, 0);
  }
});
test('concurrent scheduler/manual calls acquire one lease; manual runs do not impersonate scheduler heartbeat', async () => {
  const f = await fixture(); await Promise.all([f.service.run(true), f.service.run(true)]);
  assert.equal(f.fake.requests.length, 1); assert.equal((await f.service.status()).lastHeartbeat, null);
  await f.service.run(); assert.ok((await f.service.status()).lastHeartbeat);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
});
test('disabled/unconnected importer performs no Microsoft requests and exposes no credentials in status', async () => {
  const f = await fixture(); await f.service.saveSettings({ ...settings, enabled: false }); await f.service.run();
  assert.equal(f.fake.requests.length, 0);
  assert.doesNotMatch(JSON.stringify(await f.service.status()), /PRIVATE|refreshToken|deviceCode/);
  await f.service.disconnect(); await f.service.run(); assert.equal(f.fake.requests.length, 0);
  await assert.rejects(f.service.saveSettings(settings), /Сначала подключите/);
});
test('transport rejects malicious pagination links and uses read-only scopes with immutable IDs', async () => {
  for (const link of ['https://evil.test/v1.0/me', 'http://graph.microsoft.com/v1.0/me', 'https://user@graph.microsoft.com/v1.0/me', 'https://graph.microsoft.com/beta/me']) assert.throws(() => graphUrl(link));
  let seen: { url?: string; init?: RequestInit } = {};
  const client = new OutlookGraph('FAKE', (async (url, init) => { seen = { url: String(url), init }; return new Response('{"value":[]}'); }) as typeof fetch);
  await client.messages(receipt, new Date(tickTime).toISOString(), settings.sender);
  assert.match(seen.url!, /receivedDateTime/); assert.equal((seen.init!.headers as any).Prefer, 'IdType="ImmutableId"');
  assert.doesNotMatch(outlookScopes, /Mail.Send|Mail.ReadWrite/);
  await assert.rejects(microsoftTokenRequest(settings, 'token', {}, (async () => new Response('{"error":"invalid_grant","error_description":"SECRET FROM MICROSOFT"}', { status: 400 })) as any), error => error instanceof OutlookError && !error.message.includes('SECRET'));
});
test('settings reject arbitrary token endpoints and invalid dates; elapsed time stops at delivery', () => {
  assert.throws(() => validateOutlookSettings({ ...settings, tenantId: '../../evil' }));
  assert.throws(() => validateOutlookSettings({ ...settings, importFrom: 'invalid' }));
  assert.throws(() => validateOutlookSettings({ ...settings, travelDays: 0 }));
  const shipment = { documents_received_at: receipt, departure_date: '2026-09-07', transit_start_source: 'email' as const, status: 'In Transit' as const };
  assert.equal(shipmentDaysPassed(shipment, new Date('2026-09-11T08:43:34Z')), 0);
  assert.equal(shipmentDaysPassed(shipment, new Date('2026-09-11T08:43:35Z')), 1);
  assert.equal(shipmentDaysPassed({ ...shipment, status: 'Delivered', actual_arrival_date: '2026-09-12T08:43:35Z' }, new Date(tickTime)), 2);
  assert.equal(shipmentDaysPassed({ ...shipment, status: 'Delivered' }), null);
});

test('device login is bound to the initiating CRM user, checks the actual mailbox and keeps all tokens private', async () => {
  const f = await fixture(); await f.service.disconnect();
  let clock = tickTime;
  const service = createOutlookImportService({ db: f.db as any, now: () => clock, saveFile: async () => '', graph: () => f.fake as any,
    oauth: async (_settings, endpoint) => endpoint === 'devicecode' ? { device_code: 'SECRET_DEVICE_CODE', user_code: 'USER-CODE', expires_in: 900, interval: 5 } : { access_token: 'SECRET_ACCESS', refresh_token: 'SECRET_REFRESH' } });
  const login = await service.beginLogin('admin');
  assert.equal(login.verificationUri, 'https://microsoft.com/devicelogin'); assert.doesNotMatch(JSON.stringify(login), /SECRET/);
  await assert.rejects(service.pollLogin('someone-else', login.flowId));
  clock += 6000;
  assert.equal((await service.pollLogin('admin', login.flowId)).state, 'connected');
  const status = await service.status(); assert.equal(status.connected, true); assert.equal(status.settings.enabled, false);
  assert.doesNotMatch(JSON.stringify(status), /SECRET|refreshToken|deviceCode/);
  assert.equal(f.db.data.get('outlook_private/credentials').refreshToken, 'SECRET_REFRESH');
});
test('wrong Microsoft mailbox and a cancelled login cannot establish a connection', async () => {
  for (const cancelled of [true, false]) {
    const f = await fixture(); await f.service.disconnect(); let clock = tickTime;
    const service = createOutlookImportService({ db: f.db as any, now: () => clock, saveFile: async () => '',
      graph: () => ({ profile: async () => ({ id: 'different-user', mail: cancelled ? settings.mailbox : 'wrong@example.test' }) }) as any,
      oauth: async (_settings, endpoint) => endpoint === 'devicecode' ? { device_code: 'SECRET', user_code: 'CODE', expires_in: 900, interval: 5 } : { access_token: 'ACCESS', refresh_token: 'REFRESH' } });
    const login = await service.beginLogin('admin');
    if (cancelled) await service.disconnect();
    clock += 6000; await assert.rejects(service.pollLogin('admin', login.flowId));
    assert.equal((await service.status()).connected, false);
    assert.equal(f.db.data.has('outlook_private/credentials'), false);
  }
});
test('pending login honors polling interval without erasing its device code', async () => {
  const f = await fixture(); await f.service.disconnect(); let clock = tickTime, polls = 0;
  const service = createOutlookImportService({ db: f.db as any, now: () => clock, saveFile: async () => '',
    oauth: async (_settings, endpoint) => { if (endpoint === 'devicecode') return { device_code: 'SECRET', user_code: 'CODE', expires_in: 900, interval: 5 };
      polls++; throw new OutlookError('authorization_pending', 'Waiting'); } });
  const login = await service.beginLogin('admin');
  await service.pollLogin('admin', login.flowId); assert.equal(polls, 0);
  clock += 6000; await service.pollLogin('admin', login.flowId); assert.equal(polls, 1);
  await service.pollLogin('admin', login.flowId); assert.equal(polls, 1);
  assert.equal(f.db.data.get(`outlook_private/flows/sessions/${login.flowId}`).deviceCode, 'SECRET');
});
test('an explicitly imported older email establishes the earliest receipt while later mail never resets it', async () => {
  const draft = await parseInvoiceWorkbook(await invoice(), 'Customer 001.30.xlsx');
  const existing: any = { ...draft, documents_received_at: receipt, transit_start_source: 'email', departure_date: receipt, est_travel_time: 12, status: 'Customs', driver_name: 'Manually assigned' };
  const patch = mergeMailShipment(existing, draft, [], '2026-09-09T08:00:00Z', 'original-url', 12, 'admin', new Date(tickTime).toISOString());
  assert.equal(patch.documents_received_at, '2026-09-09T08:00:00Z');
  assert.equal(patch.status, undefined); assert.equal(patch.driver_name, undefined); assert.equal(patch.departure_date, undefined);
});

test('logistics users cannot read connection status, change settings, connect or trigger imports', async () => {
  const authenticate = createAuthenticator(async () => ({ uid: 'employee', email: 'employee@example.test', email_verified: true, exp: Date.now() / 1000 + 3600 }), async () => ({ role: 'logistics' }));
  const app = express();
  app.use((req, _res, next) => { void authenticate(req, 'FAKE_LOCAL_TOKEN').then(() => next()).catch(next); });
  app.use(outlookRouter);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const [path, method] of [['/status', 'GET'], ['/settings', 'PUT'], ['/connect', 'POST'], ['/run', 'POST'], ['/connection', 'DELETE']]) {
      const response = await fetch(base + path, { method }); assert.equal(response.status, 403);
    }
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
test('pagination is resumed after failure without skipping a page or duplicating completed shipments', async () => {
  const f = await fixture(); let failPage = true;
  f.fake.messages = async (...args: any[]) => {
    f.fake.requests.push(args);
    if (args[3] && failPage) throw new Error('network failure fetching next page');
    return args[3] ? { value: [{ ...f.fake.page[0], id: 'second-page', internetMessageId: '<page2@example.test>' }] } :
      { value: f.fake.page, '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=10' };
  };
  await f.service.run();
  const before = structuredClone(f.db.data.get('outlook_private/state'));
  assert.ok(before.nextLink);
  await assert.rejects(f.service.run());
  assert.equal(f.db.data.get('outlook_private/state').nextLink, before.nextLink);
  assert.equal(f.db.data.get('outlook_private/state').watermark, before.watermark);
  failPage = false; await f.service.run();
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
  assert.equal((await f.service.status()).logs.length, 2);
  assert.equal(f.db.data.get('outlook_private/state').nextLink, null);
});
