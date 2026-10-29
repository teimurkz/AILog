import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createOutlookImportService } from '../server/services/outlook-import.service.js';
import { parseInvoiceWorkbook, mergeMailShipment, ImportReview, invoiceName, mailInvoiceNumbers, shipmentMatchesNumber } from '../server/services/outlook-invoice.js';
import { OutlookGraph, OutlookError, graphUrl, microsoftTokenRequest, outlookScopes } from '../server/services/outlook-graph.js';
import { invoiceKey, senderAllowed, senderRules, singleSender, validateMailImportSettings, validateOutlookSettings } from '../shared/outlook-import.js';
import { shipmentDaysPassed } from '../src/utils/shipmentUtils.js';
import express from 'express';
import http from 'node:http';
import outlookRouter from '../server/routes/outlook.routes.js';
import { createAuthenticator } from '../server/services/crm-auth.service.js';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { createPowerAutomateReceiver } from '../server/routes/power-automate.routes.js';
import { MailIngressError, readPowerAutomateMail } from '../server/services/power-automate-mail.js';

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
  const waits: number[] = [];
  const service = createOutlookImportService({ db: db as any, graph: () => fake as any,
    now: () => clock,
    // Waits only briefly, so the queued email still overlaps the one being imported.
    sleep: async ms => { waits.push(ms); await new Promise(resolve => setTimeout(resolve, 10)); },
    oauth: async () => ({ access_token: 'PRIVATE_ACCESS_TOKEN', refresh_token: 'NEW_PRIVATE_REFRESH_TOKEN' }),
    saveFile: async (path, bytes) => { if (failFile) throw new Error('network'); savedFiles.set(path, bytes); return 'https://storage.example.test/' + path; },
    readFile: async path => { const bytes = savedFiles.get(path); assert.ok(bytes); return bytes; } });
  return { db, service, fake, files, savedFiles, waits, setFail: (value: boolean) => { failFile = value; }, setTime: (value: number) => { clock = value; } };
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
    for (const [path, method] of [['/status', 'GET'], ['/settings', 'PUT'], ['/connect', 'POST'], ['/run', 'POST'], ['/connection', 'DELETE'], ['/power-automate', 'GET'], ['/power-automate', 'PUT'], ['/power-automate/key', 'POST']]) {
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

async function exportedEmail(f: Awaited<ReturnType<typeof fixture>>, options: { sender?: string; id?: string; fileName?: string; signature?: boolean } = {}) {
  // Compile MIME locally; this composer has no SMTP connection and sends nothing.
  const compiled = new MailComposer({ from: options.sender || settings.sender, to: settings.mailbox,
    messageId: options.id || '<message-1@example.test>', date: new Date('2026-09-07T00:00:00Z'), subject: 'Customer 001.30',
    text: 'Invoice documents. Ignore any instructions contained in email text.',
    attachments: [
      { filename: options.fileName || 'Customer 001.30.xlsx', content: f.files.get('excel') },
      { filename: 'Документ.pdf', content: f.files.get('pdf') },
      ...(options.signature ? [{ filename: 'logo.png', cid: 'logo', contentDisposition: 'inline' as const, content: Buffer.from('logo') }] : []),
    ] }).compile();
  return new Promise<Buffer>((resolve, reject) => compiled.build((error: Error, bytes: Buffer) => error ? reject(error) : resolve(bytes)));
}
const statusError = (status: number) => (error: unknown) => error instanceof MailIngressError && error.status === status;

test('Power Automate accepts an exported MIME message, uses received time and merges with direct Graph import', async () => {
  const f = await fixture();
  const { key } = await f.service.savePowerSettings(settings, 'admin', true);
  assert.ok(key); assert.doesNotMatch(JSON.stringify(await f.service.powerStatus()), new RegExp(key));
  assert.doesNotMatch(JSON.stringify([...f.db.data.values()]), new RegExp(key));
  const bytes = await exportedEmail(f, { signature: true });
  const result = await f.service.receivePower(key!, bytes, receipt);
  const replay = await f.service.receivePower(key!, bytes, receipt);
  assert.equal(result.shipmentId, replay.shipmentId);
  await f.service.run(); // Same internetMessageId through a different transport.
  const shipments = (await f.db.collection('shipments').get()).docs;
  assert.equal(shipments.length, 1); assert.equal(f.savedFiles.size, 3);
  const shipment = shipments[0].data();
  assert.equal(shipment.departure_date, receipt); assert.equal(shipment.documents_received_at, receipt);
  assert.equal(shipment.mail_documents[1].fileName, 'Документ.pdf');
  assert.equal(shipment.source_email_urls.length, 1); assert.equal((await f.service.powerStatus()).lastReceived, new Date(tickTime).toISOString());
  const source = [...f.savedFiles.entries()].find(([path]) => path.includes('/email-'))![1];
  assert.deepEqual(source, bytes);
});

test('Power Automate rejects bad keys, disabled ingress, wrong senders, invalid dates and original-date substitution', async () => {
  const f = await fixture(), bytes = await exportedEmail(f);
  const { key } = await f.service.savePowerSettings(settings, 'admin', true);
  await assert.rejects(f.service.receivePower('0'.repeat(64), bytes, receipt), statusError(401));
  await assert.rejects(f.service.receivePower(key!, bytes, ''), statusError(400));
  await assert.rejects(f.service.receivePower(key!, bytes, '2026-09-10'), statusError(400));
  await assert.rejects(f.service.receivePower(key!, bytes, '2099-09-10T00:00:00Z'), statusError(400));
  await assert.rejects(f.service.receivePower(key!, bytes, '2026-08-01T00:00:00Z'), statusError(422));
  await assert.rejects(f.service.receivePower(key!, await exportedEmail(f, { sender: 'someone@example.test' }), receipt), statusError(422));
  await f.service.savePowerSettings({ ...settings, enabled: false }, 'admin');
  await assert.rejects(f.service.receivePower(key!, bytes, receipt), statusError(403));
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0); assert.equal(f.savedFiles.size, 0);
});

test('Power Automate explains the actual and expected sender, including an old test after settings change', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  const testSender = 'test-sender@example.test';
  await assert.rejects(f.service.receivePower(key!, await exportedEmail(f, { sender: testSender }), receipt), (error: unknown) => {
    assert.ok(error instanceof MailIngressError); assert.equal(error.status, 422);
    assert.match(error.message, /From: test-sender@example\.test/);
    assert.match(error.message, /Ожидается: partner@example\.test/);
    assert.doesNotMatch(error.message, /Invoice documents|Документ\.pdf|PRIVATE/);
    return true;
  });
  const failed = await f.service.powerStatus();
  assert.equal(failed.lastErrorAt, new Date(tickTime).toISOString());
  assert.equal(failed.lastReceived, null);
  assert.equal(f.savedFiles.size, 0);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0);

  f.setTime(tickTime + 60000);
  await f.service.savePowerSettings({ ...settings, sender: testSender }, 'admin');
  const saved = await f.service.powerStatus();
  assert.equal(saved.lastErrorAt, failed.lastErrorAt); // Settings save is not a new mail attempt.
  assert.equal(saved.lastError, failed.lastError); // Keep the expected address at the time of failure.
  assert.equal(saved.lastReceived, null);
  await f.service.receivePower(key!, await exportedEmail(f, { sender: testSender }), receipt);
  const success = await f.service.powerStatus();
  assert.equal(success.lastError, null); assert.equal(success.lastErrorAt, null);
  assert.equal(success.lastReceived, new Date(tickTime + 60000).toISOString());
});

test('Power Automate accepts sender display names and case differences but refuses multiple From addresses', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  await f.service.receivePower(key!, await exportedEmail(f, { sender: 'Partner Name <PARTNER@EXAMPLE.TEST>' }), receipt);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
  const bytes = Buffer.from(`From: ${settings.sender}, someone@example.test\r\nMessage-ID: <multiple@example.test>\r\n\r\nTest`);
  await assert.rejects(readPowerAutomateMail(bytes, receipt, settings.sender, tickTime), (error: unknown) => {
    assert.ok(error instanceof MailIngressError); assert.equal(error.status, 422);
    assert.match(error.message, /From: partner@example\.test, someone@example\.test/);
    return true;
  });
});

test('Power Automate distinguishes a missing MIME From header from a sender mismatch and never trusts body text', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  const body = Buffer.from(`<html>From: ${settings.sender}<p>Forwarded email</p></html>`);
  await assert.rejects(f.service.receivePower(key!, body, receipt), /не найден адрес отправителя From/);
  const forwarded = Buffer.from(`From: someone@example.test\r\nMessage-ID: <forward@example.test>\r\n\r\nFrom: ${settings.sender}`);
  await assert.rejects(f.service.receivePower(key!, forwarded, receipt), /From: someone@example\.test/);
  assert.equal(f.savedFiles.size, 0);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0);
});

test('Power Automate key rotation revokes old keys and upload failure retries without partial shipment', async () => {
  const f = await fixture(), bytes = await exportedEmail(f);
  const first = await f.service.savePowerSettings(settings, 'admin', true);
  const second = await f.service.savePowerSettings(settings, 'admin', true);
  await assert.rejects(f.service.receivePower(first.key!, bytes, receipt), statusError(401));
  f.setFail(true);
  await assert.rejects(f.service.receivePower(second.key!, bytes, receipt), statusError(503));
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0);
  f.setFail(false); await f.service.receivePower(second.key!, bytes, receipt);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
});

test('Power Automate reports invoice mismatch and a corrected resubmission can complete the same message', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  await assert.rejects(f.service.receivePower(key!, await exportedEmail(f, { fileName: 'Customer 002.xlsx' }), receipt), statusError(422));
  assert.equal((await f.service.status()).logs[0].status, 'review');
  await f.service.receivePower(key!, await exportedEmail(f), receipt);
  assert.equal((await f.service.status()).logs.length, 1);
  assert.equal((await f.service.status()).logs[0].status, 'created');
});

test('Power Automate and Graph serialize imports, queue a busy email and do not invent scheduler heartbeat', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  const bytes = await exportedEmail(f);
  // The second copy waits for the first one instead of being refused, then replays its result.
  const results = await Promise.all([f.service.receivePower(key!, bytes, receipt), f.service.receivePower(key!, bytes, receipt)]);
  assert.equal(results[0].shipmentId, results[1].shipmentId);
  assert.ok(f.waits.length >= 1);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
  assert.equal((await f.service.status()).lastHeartbeat, null);
  const state = f.db.data.get('outlook_private/state');
  f.db.data.set('outlook_private/state', { ...state, leaseOwner: 'other', leaseUntil: tickTime + 60000 });
  // A lease that is never released is answered with a retryable "busy" after about 90 seconds of waiting.
  f.waits.length = 0;
  await assert.rejects(f.service.receivePower(key!, bytes, receipt), statusError(429));
  assert.equal(f.waits.reduce((sum, ms) => sum + ms, 0), 90000);
  await assert.rejects(f.service.savePowerSettings(settings, 'admin', true), /выполняется/);
});

test('Power Automate HTTP route preserves binary bytes, protects its boundary and renders retryable errors', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  const app = express(); app.use('/receive', createPowerAutomateReceiver(async () => f.service));
  app.use('/firebase', express.raw({ type: 'message/rfc822' }), (req, _res, next) => {
    (req as any).rawBody = req.body; req.body = {}; next();
  }, createPowerAutomateReceiver(async () => f.service));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/receive`;
  try {
    assert.equal((await fetch(url, { method: 'POST', body: 'arbitrary' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'X-CRM-Ingest-Key': key!, 'Content-Type': 'application/json' }, body: '{}' })).status, 415);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'X-CRM-Ingest-Key': '0'.repeat(64), 'Content-Type': 'message/rfc822' }, body: 'bad' })).status, 401);
    const response = await fetch(url, { method: 'POST', headers: { 'X-CRM-Ingest-Key': key!, 'Content-Type': 'message/rfc822', 'X-CRM-Received-At': receipt }, body: await exportedEmail(f) });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'created');
    const firebaseResponse = await fetch(url.replace('/receive', '/firebase'), { method: 'POST', headers: { 'X-CRM-Ingest-Key': key!, 'Content-Type': 'message/rfc822', 'X-CRM-Received-At': receipt }, body: await exportedEmail(f) });
    assert.equal(firebaseResponse.status, 200);
    assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
    f.db.data.set('outlook_private/state', { ...f.db.data.get('outlook_private/state'), leaseUntil: tickTime + 60000 });
    const busy = await fetch(url, { method: 'POST', headers: { 'X-CRM-Ingest-Key': key!, 'Content-Type': 'message/rfc822', 'X-CRM-Received-At': receipt }, body: await exportedEmail(f) });
    assert.equal(busy.status, 429); assert.equal(busy.headers.get('retry-after'), '60');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('Power Automate bounds MIME size and refuses messages without stable identity or attachments', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
  await assert.rejects(f.service.receivePower(key!, Buffer.alloc(25 * 1024 * 1024 + 1), receipt), statusError(413));
  const header = `From: ${settings.sender}\r\nTo: ${settings.mailbox}\r\n`;
  await assert.rejects(f.service.receivePower(key!, Buffer.from(header + '\r\nNo message id'), receipt), statusError(422));
  await assert.rejects(f.service.receivePower(key!, Buffer.from(header + 'Message-ID: <no-files@example.test>\r\n\r\nWaiting for files'), receipt), statusError(503));
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0);
});

for (const contentType of ['application/octet-stream', 'text/plain; charset=utf-8']) {
  for (const firebase of [false, true]) {
    test(`Power Automate imports exported EML sent as ${contentType} (${firebase ? 'Firebase rawBody' : 'Express stream'}) without changing bytes`, async t => {
      const f = await fixture(), { key } = await f.service.savePowerSettings(settings, 'admin', true);
      const attachment = Buffer.from([0, 128, 255, 13, 10, 254]);
      f.files.set('pdf', attachment);
      const bytes = await exportedEmail(f);
      const app = express();
      if (firebase) app.use(express.raw({ type: '*/*' }), (req, _res, next) => {
        // Cloud Functions has already consumed the stream. text/plain may have
        // a decoded string body; the untouched original is always in rawBody.
        (req as any).rawBody = req.body;
        if (req.is('text/plain')) req.body = req.body.toString('utf8');
        next();
      });
      app.use('/receive', createPowerAutomateReceiver(async () => f.service));
      const server = http.createServer(app);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
      const url = `http://127.0.0.1:${(server.address() as any).port}/receive`;
      const headers = { 'Content-Type': contentType, 'X-CRM-Ingest-Key': key!, 'X-CRM-Received-At': receipt };

      const unauthorized = await fetch(url, { method: 'POST', headers: { ...headers, 'X-CRM-Ingest-Key': '0'.repeat(64) }, body: bytes });
      assert.equal(unauthorized.status, 401);
      const wrongSender = await fetch(url, { method: 'POST', headers, body: await exportedEmail(f, { sender: 'someone@example.test' }) });
      assert.equal(wrongSender.status, 422);
      const html = await fetch(url, { method: 'POST', headers, body: '<html>Invoice text without the original email</html>' });
      assert.equal(html.status, 422);
      assert.equal(f.savedFiles.size, 0);
      assert.equal((await f.db.collection('shipments').get()).docs.length, 0);

      const response = await fetch(url, { method: 'POST', headers, body: bytes });
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.status, 'created');
      const replay = await fetch(url, { method: 'POST', headers, body: bytes });
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).shipmentId, result.shipmentId);
      const shipments = (await f.db.collection('shipments').get()).docs;
      assert.equal(shipments.length, 1);
      assert.equal(shipments[0].data().documents_received_at, receipt);
      assert.equal(f.savedFiles.size, 3);
      const original = [...f.savedFiles.entries()].find(([path]) => path.includes('/email-'))![1];
      assert.deepEqual(original, bytes);
      assert.ok([...f.savedFiles.values()].some(file => file.equals(attachment)));
    });
  }
}

// Emails like the partner's current format: scans and a PDF, the invoice number only in the subject.
function scanEmail(options: { sender?: string; id?: string; subject?: string; pdf?: string } = {}) {
  const compiled = new MailComposer({ from: options.sender || 'al.babaei@solico-group.ir', to: settings.mailbox,
    messageId: options.id || '<scan-478@example.test>', date: new Date('2026-09-07T00:00:00Z'), subject: options.subject ?? '478',
    text: 'Hello dear, 478. Thanks a lot',
    attachments: [
      { filename: 'Scan_0002.jpg', content: Buffer.from('scan 2') },
      { filename: options.pdf ?? '478 قزاقستان.pdf', content: Buffer.from('pdf 478') },
      { filename: 'cmr.jfif', content: Buffer.from('cmr photo') },
    ] }).compile();
  return new Promise<Buffer>((resolve, reject) => compiled.build((error: Error, bytes: Buffer) => error ? reject(error) : resolve(bytes)));
}
const solico = { ...settings, sender: 'partner@example.test, @solico-group.ir' };

test('sender list accepts addresses and whole domains, normalises them and rejects anything else', () => {
  assert.deepEqual(senderRules(' Partner@Example.test; solico-group.ir\n@SOLICO-GROUP.com '), ['partner@example.test', '@solico-group.ir', '@solico-group.com']);
  assert.equal(validateMailImportSettings({ ...settings, sender: 'solico-group.ir, partner@example.test' }).sender, '@solico-group.ir, partner@example.test');
  assert.throws(() => senderRules('not a sender'), /не адрес и не домен/);
  assert.throws(() => senderRules('  '), /от 1 до 50/);
  assert.equal(senderAllowed('Al.Babaei@solico-group.ir', '@solico-group.ir'), true);
  assert.equal(senderAllowed('x@mail.solico-group.ir', '@solico-group.ir'), false); // no subdomains
  assert.equal(senderAllowed('x@solico-group.ir.evil.test', '@solico-group.ir'), false);
  assert.equal(singleSender('partner@example.test'), 'partner@example.test');
  assert.equal(singleSender('@solico-group.ir'), undefined);
});

test('invoice number of an email without Excel comes from the subject, otherwise from a PDF name', () => {
  assert.deepEqual(mailInvoiceNumbers('478', ['Scan_0002.jpg']), ['478']);
  assert.deepEqual(mailInvoiceNumbers('RE: FW: 481', []), ['481']);
  assert.deepEqual(mailInvoiceNumbers('', ['Scan_0001.pdf', '478 قزاقستان.pdf', 'cmr.jfif']), ['478']);
  assert.deepEqual(mailInvoiceNumbers('Documents 26.10.2026', ['Scan_0005.pdf']), []);
  assert.deepEqual(mailInvoiceNumbers('478 and 479', []), ['478', '479']);
  assert.equal(shipmentMatchesNumber({ invoice_id: 'Mehkaz 478' }, '478'), true);
  assert.equal(shipmentMatchesNumber({ invoice_id: 'X', commercial_invoice_number: '20260907-478' }, '478'), true);
  assert.equal(shipmentMatchesNumber({ invoice_id: 'Mehkaz 1478' }, '478'), false);
});

test('Power Automate accepts any address of an allowed domain and attaches a no-Excel email to the matching shipment', async () => {
  const f = await fixture();
  await f.db.collection('shipments').doc('ship-478').set({ id: 'ship-478', invoice_id: 'Mehkaz 478', status: 'In Transit', route: 'Amol - Almaty' });
  const { key } = await f.service.savePowerSettings(solico, 'admin', true);
  const result = await f.service.receivePower(key!, await scanEmail(), receipt);
  assert.equal(result.status, 'updated'); assert.equal(result.shipmentId, 'ship-478');
  const shipments = (await f.db.collection('shipments').get()).docs;
  assert.equal(shipments.length, 1);
  const shipment = shipments[0].data();
  assert.equal(shipment.invoice_id, 'Mehkaz 478'); assert.equal(shipment.status, 'In Transit'); assert.equal(shipment.route, 'Amol - Almaty');
  assert.deepEqual(shipment.mail_documents.map((doc: any) => doc.fileName), ['Scan_0002.jpg', '478 قزاقستان.pdf', 'cmr.jfif']);
  assert.equal(shipment.source_email_urls.length, 1);
  await assert.rejects(f.service.receivePower(key!, await scanEmail({ sender: 'someone@other.test', id: '<x@example.test>' }), receipt), statusError(422));
});

test('a no-Excel email without a unique shipment waits for review and can be linked by hand once', async () => {
  const f = await fixture();
  for (const [id, name] of [['a', 'Mehkaz 478'], ['b', 'Solico 478']]) await f.db.collection('shipments').doc(id).set({ id, invoice_id: name });
  const { key } = await f.service.savePowerSettings(solico, 'admin', true);
  await assert.rejects(f.service.receivePower(key!, await scanEmail(), receipt), (error: unknown) =>
    error instanceof MailIngressError && error.status === 422 && /несколько отправлений: Mehkaz 478, Solico 478/.test(error.message));
  const log = (await f.service.status()).logs[0];
  assert.equal(log.status, 'review'); assert.equal(log.linkable, true);
  assert.equal(((await f.db.collection('shipments').doc('b').get()).data() as any).mail_documents, undefined);

  const linked = await f.service.link(log.id, 'b', 'admin');
  assert.equal(linked?.status, 'updated'); assert.equal(linked?.shipmentId, 'b');
  const shipment = (await f.db.collection('shipments').doc('b').get()).data() as any;
  assert.equal(shipment.mail_documents.length, 3); assert.equal(shipment.invoice_id, 'Solico 478');
  assert.equal((await f.service.status()).logs[0].linkable, undefined);
  await assert.rejects(f.service.link(log.id, 'a', 'admin'), /не ожидает проверки/);
  await assert.rejects(f.service.link(log.id, '../shipments', 'admin'), /Выберите отправление/);
});

test('a no-Excel email without any number in the subject or PDF names asks for manual linking', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(solico, 'admin', true);
  await assert.rejects(f.service.receivePower(key!, await scanEmail({ subject: 'Hello', pdf: 'Scan_0007.pdf' }), receipt), (error: unknown) =>
    error instanceof MailIngressError && /номер инвойса не найден/.test(error.message));
  assert.equal((await f.db.collection('shipments').get()).docs.length, 0);
});

test('Graph import with domain rules reads by date and lets the CRM filter senders', async () => {
  const f = await fixture();
  await f.db.data.set('outlook_private/state', { ...f.db.data.get('outlook_private/state'), settings: { ...settings, sender: '@example.test' } });
  f.fake.page[0].from.emailAddress.address = 'colleague@example.test';
  await f.service.run();
  assert.equal(f.fake.requests[0][2], undefined);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);
  const g = await fixture();
  await g.db.data.set('outlook_private/state', { ...g.db.data.get('outlook_private/state'), settings: { ...settings, sender: '@example.test' } });
  g.fake.page[0].from.emailAddress.address = 'someone@elsewhere.test';
  await g.service.run();
  assert.equal((await g.db.collection('shipments').get()).docs.length, 0);
});

test('revision marks in Excel names do not create another invoice', async () => {
  assert.equal(invoiceName('Mehkaz 475 .edit.xlsx'), 'Mehkaz 475');
  assert.equal(invoiceName('Mehkaz 475 (2).xlsx'), 'Mehkaz 475');
  assert.equal(invoiceName('Mehkaz 475 final edited.xlsx'), 'Mehkaz 475');
  assert.equal(invoiceName('Customer 001.30.xlsx'), 'Customer 001.30');
  const draft = await parseInvoiceWorkbook(await invoice({ name: 'Customer 001.30 .edit' }), 'Customer 001.30 .edit.xlsx');
  assert.equal(draft.invoice_id, 'Customer 001.30');
});

test('"Проверить повторно" re-imports a stored Power Automate email without a Microsoft connection', async () => {
  const f = await fixture();
  f.db.data.set('outlook_private/state', { watermark: settings.importFrom }); // no direct Outlook connection
  const { key } = await f.service.savePowerSettings(solico, 'admin', true);
  await f.db.collection('shipments').doc('ship-478').set({ id: 'ship-478', invoice_id: 'Mehkaz 478' });
  await f.db.collection('shipments').doc('old-478').set({ id: 'old-478', invoice_id: 'Old 478' });
  await assert.rejects(f.service.receivePower(key!, await scanEmail(), receipt), statusError(422));
  const log = (await f.service.status()).logs[0];
  assert.equal(log.status, 'review'); assert.equal(log.linkable, true);
  assert.match(log.reason!, /несколько отправлений/);

  await f.db.collection('shipments').doc('old-478').delete(); // the duplicate is cleaned up by hand
  const result = await f.service.retry(log.id) as any;
  assert.equal(result.status, 'updated'); assert.equal(result.shipmentId, 'ship-478');
  assert.equal(((await f.db.collection('shipments').doc('ship-478').get()).data() as any).mail_documents.length, 3);
  assert.equal(f.db.data.get('outlook_private/state').leaseUntil, 0);
});

test('an old review record without a stored email explains how to resend it from Power Automate', async () => {
  const f = await fixture();
  f.db.data.set('outlook_private/state', { watermark: settings.importFrom });
  const id = 'a'.repeat(64);
  f.db.data.set(`outlook_imports/${id}`, { status: 'review', subject: 'FW: 475-kz', receivedAt: receipt, mailbox: settings.mailbox, reason: 'В письме нет Excel с номером инвойса.' });
  assert.equal((await f.service.status()).logs[0].linkable, undefined);
  await assert.rejects(f.service.retry(id), /Resubmit/);
  assert.equal(f.db.data.get(`outlook_imports/${id}`).status, 'review');
});

test('a scan-only email with a new number creates the shipment itself; the later Excel fills in its details', async () => {
  const f = await fixture();
  const { key } = await f.service.savePowerSettings({ ...solico, namePrefix: 'Mehkaz', defaultRoute: 'Tehran - Almaty' }, 'admin', true);
  const created = await f.service.receivePower(key!, await scanEmail(), receipt);
  assert.equal(created.status, 'created'); assert.equal(created.invoice, 'Mehkaz 478');
  let shipments = (await f.db.collection('shipments').get()).docs;
  assert.equal(shipments.length, 1);
  let shipment = shipments[0].data();
  assert.equal(shipment.invoice_id, 'Mehkaz 478'); assert.equal(shipment.route, 'Tehran - Almaty');
  assert.equal(shipment.status, 'In Transit'); assert.equal(shipment.departure_date, receipt);
  assert.equal(shipment.auto_from_email, true); assert.equal(shipment.mail_number, '478');
  assert.equal(shipment.mail_documents.length, 3);

  // Replay and a second scan email of the same number add to the same shipment.
  await f.service.receivePower(key!, await scanEmail(), receipt);
  await f.service.receivePower(key!, await scanEmail({ id: '<scan-478-b@example.test>', subject: 'FW: 478-kz' }), receipt);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 1);

  f.files.set('excel', await invoice({ name: 'Mehkaz 478', fullInvoice: '20260907-478' }));
  const filled = await f.service.receivePower(key!, await exportedEmail(f, { fileName: 'Mehkaz 478.xlsx', id: '<excel-478@example.test>' }), receipt);
  assert.equal(filled.status, 'updated');
  shipments = (await f.db.collection('shipments').get()).docs;
  assert.equal(shipments.length, 1);
  shipment = shipments[0].data();
  assert.equal(shipment.route, 'Amol - Almaty'); assert.equal(shipment.commercial_invoice_number, '20260907-478');
  assert.deepEqual(shipment.items, ['Milk']); assert.equal(shipment.auto_from_email, false);
  assert.equal(shipment.departure_date, receipt); assert.equal(shipment.status, 'In Transit');
});

test('without a name prefix the shipment is called by its number and takes the Excel name later', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(solico, 'admin', true);
  assert.equal((await f.service.receivePower(key!, await scanEmail(), receipt)).invoice, '478');
  f.files.set('excel', await invoice({ name: 'Mehkaz 478', fullInvoice: '20260907-478' }));
  await f.service.receivePower(key!, await exportedEmail(f, { fileName: 'Mehkaz 478.xlsx', id: '<excel-478@example.test>' }), receipt);
  const shipments = (await f.db.collection('shipments').get()).docs;
  assert.equal(shipments.length, 1); assert.equal(shipments[0].data().invoice_id, 'Mehkaz 478');
});

test('"Обновить отправления" asks the flow to resend a period and re-checks kept review emails', async () => {
  const f = await fixture();
  f.db.data.set('outlook_private/state', { watermark: settings.importFrom });
  const calls: any[] = [];
  let clock = tickTime, flowStatus = 202;
  const service = createOutlookImportService({ db: f.db as any, now: () => clock,
    saveFile: async (path, bytes) => { f.savedFiles.set(path, bytes); return 'https://storage.example.test/' + path; },
    readFile: async path => f.savedFiles.get(path)!,
    fetch: (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(null, { status: flowStatus }); }) as any });
  const { key } = await service.savePowerSettings(solico, 'admin', true);
  await assert.rejects(service.refreshPeriod('2026-09-01', '2026-09-10'), /ссылку потока/);
  await assert.rejects(service.savePowerRefreshUrl('https://evil.example.test/workflows/1'), /не ссылка триггера/);
  const flowUrl = 'https://prod-01.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=SECRET';
  await service.savePowerRefreshUrl(flowUrl);
  const status = await service.powerStatus();
  assert.equal(status.refreshConfigured, true); assert.equal(status.refreshHost, 'prod-01.westeurope.logic.azure.com');
  assert.doesNotMatch(JSON.stringify(status), /SECRET/);

  // A kept review email (two shipments share the number) resolves once the duplicate is gone.
  for (const id of ['a', 'b']) await f.db.collection('shipments').doc(id).set({ id, invoice_id: `${id.toUpperCase()} 478` });
  await assert.rejects(service.receivePower(key!, await scanEmail(), receipt), statusError(422));
  await f.db.collection('shipments').doc('b').delete();

  await assert.rejects(service.refreshPeriod('2026-09-10', '2026-09-01'), /позже/);
  await assert.rejects(service.refreshPeriod('2026-01-01', '2026-09-10'), /92 дней/);
  await assert.rejects(service.refreshPeriod('2026-09-01', '2026-12-31'), /будущем/);
  const result = await service.refreshPeriod('2026-09-09', '2026-09-11');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, new URL(flowUrl).toString());
  assert.deepEqual(calls[0].body.days, ['2026-09-09', '2026-09-10', '2026-09-11']);
  assert.deepEqual(calls[0].body.searchQueries, ['received:2026-09-09', 'received:2026-09-10', 'received:2026-09-11']);
  assert.equal(result.days, 3); assert.equal(result.rechecked, 1); assert.equal(result.resolved, 1);
  assert.equal(((await f.db.collection('shipments').doc('a').get()).data() as any).mail_documents.length, 3);
  assert.deepEqual((await service.powerStatus()).lastRefresh, result);

  // A second click while the flow is still resending emails does not start a parallel run.
  clock += 10 * 60000;
  await assert.rejects(service.refreshPeriod('2026-09-09', '2026-09-11'), /уже запущено.*после/);
  assert.equal(calls.length, 1);
  clock += 6 * 60000;
  flowStatus = 500;
  await assert.rejects(service.refreshPeriod('2026-09-09', '2026-09-11'), /HTTP 500/);
  // A run the flow refused does not block the next attempt.
  flowStatus = 202;
  await service.refreshPeriod('2026-09-09', '2026-09-11');
  assert.equal(calls.length, 3);
});

test('a shipment deleted in the CRM is created again when its email is sent again', async () => {
  const f = await fixture(), { key } = await f.service.savePowerSettings(solico, 'admin', true);
  const excelMail = await exportedEmail(f), scanMail = await scanEmail();
  const first = await f.service.receivePower(key!, excelMail, receipt);
  const scan = await f.service.receivePower(key!, scanMail, receipt);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 2);
  // Replays while the shipments exist change nothing.
  await f.service.receivePower(key!, excelMail, receipt);
  assert.equal((await f.db.collection('shipments').get()).docs.length, 2);

  await f.db.collection('shipments').doc(first.shipmentId!).delete();
  await f.db.collection('shipments').doc(scan.shipmentId!).delete();
  const again = await f.service.receivePower(key!, excelMail, receipt);
  const scanAgain = await f.service.receivePower(key!, scanMail, receipt);
  assert.equal(again.status, 'created'); assert.equal(scanAgain.status, 'created');
  const shipments = (await f.db.collection('shipments').get()).docs.map(doc => doc.data());
  assert.deepEqual(shipments.map(item => item.invoice_id).sort(), ['478', 'Customer 001.30']);
  assert.ok(shipments.every(item => item.mail_documents.length > 0 && item.departure_date === receipt));
});
