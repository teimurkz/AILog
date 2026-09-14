import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';

// All database/network methods below are replaced before being called.
// This suite never contacts production Firebase, SMTP or Google Sheets.
process.env.CRM_STORAGE_MODE = 'firebase';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
const { db } = await import('../server/config/firebase.js');
const { getMailingSubscribers, getMailingSettings, getMailingLogs, saveMailingSettings, addMailingLog, markMailingSubscribersSent } = await import('../server/services/mailing.service.js');
const { createNodemailerTransport, sendMailWithResilience } = await import('../server/services/email.service.js');
const { executeMailingDispatch } = await import('../server/services/scheduler.service.js');
afterEach(() => mock.restoreAll());

test('empty Firebase recipients/logs remain empty instead of loading committed JSON', async () => {
  mock.method(db, 'collection', (() => ({ get: async () => ({ docs: [], empty: true }), orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }) })) as any);
  assert.deepEqual(await getMailingSubscribers(), []);
  assert.deepEqual(await getMailingLogs(), []);
});

test('Firestore failure remains visible and missing settings do not enable mailing', async () => {
  mock.method(db, 'collection', (() => { throw new Error('fixture denied'); }) as any);
  await assert.rejects(getMailingSubscribers, /fixture denied/);
  await assert.rejects(getMailingSettings, /fixture denied/);
  mock.restoreAll();
  mock.method(db, 'collection', (() => ({ doc: () => ({ get: async () => ({ exists: false }) }) })) as any);
  assert.equal((await getMailingSettings()).enabled, false);
});

test('settings merge existing documents, and successful logs omit undefined fields', async () => {
  const writes: any[] = [];
  mock.method(db, 'collection', (() => ({ doc: (id: string) => ({ set: async (value: any, options: any) => { writes.push({ id, value, options }); } }) })) as any);
  await saveMailingSettings({ sendTime: '09:00' });
  await addMailingLog({ id: 'fixture', status: 'success', errorMessage: undefined });
  assert.deepEqual(writes[0].options, { merge: true });
  assert.equal('errorMessage' in writes[1].value, false);
});

test('lastSentAt patch does not recreate a deleted or edited recipient', async () => {
  const patches: any[] = [];
  mock.method(db, 'collection', (() => ({ doc: (id: string) => ({ id }) })) as any);
  mock.method(db, 'runTransaction', (async (work: any) => work({
    get: async (ref: any) => ({ ref, exists: ref.id !== 'deleted', data: () => ({ email: ref.id === 'edited' ? 'new@example.test' : 'same@example.test' }) }),
    update: (ref: any, patch: any) => patches.push({ ref, patch }),
  })) as any);
  await markMailingSubscribersSent(['deleted', 'edited', 'same'].map(id => ({ id, email: 'same@example.test' })), 'fixture-time');
  assert.deepEqual(patches, [{ ref: { id: 'same' }, patch: { lastSentAt: 'fixture-time' } }]);
});

test('SMTP transport corrects port 465, preserves custom passwords and verifies TLS', () => {
  let options: any;
  mock.method(nodemailer, 'createTransport', ((value: any) => { options = value; return { close() {} }; }) as any);
  createNodemailerTransport({ host: 'smtp.example.test', port: 465, secure: false, user: 'user', pass: 'has spaces' });
  assert.equal(options.secure, true);
  assert.equal(options.auth.pass, 'has spaces');
  assert.equal(options.tls.rejectUnauthorized, true);
});

test('Gmail TLS handshake failure can switch ports, but ambiguous socket close never resends', async () => {
  for (const uncertain of [false, true]) {
    mock.restoreAll(); const ports: number[] = []; let closes = 0;
    mock.method(nodemailer, 'createTransport', ((options: any) => {
      ports.push(options.port);
      return { close: () => { closes++; }, sendMail: async () => {
        if (ports.length === 1) throw Object.assign(new Error(uncertain ? 'Unexpected socket close' : 'Client network socket disconnected before secure TLS connection was established'), { code: 'ESOCKET', command: 'CONN' });
        return { accepted: ['fixture@example.test'], rejected: [] };
      } };
    }) as any);
    const promise = sendMailWithResilience({}, { smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpUser: 'fixture', smtpPass: 'fixture-password' });
    if (uncertain) await assert.rejects(promise, (error: any) => error.uncertain && !error.retryable);
    else await promise;
    assert.deepEqual(ports, uncertain ? [465] : [465, 587]);
    assert.equal(closes, ports.length);
  }
});

test('dispatch records actual acceptance and never marks a failed recipient as sent', async () => {
  for (const fail of [true, false]) {
    mock.restoreAll(); const logs: any[] = []; const updates: any[] = [];
    const subscribers = [{ id: 'fixture-sub', email: 'fixture@example.test', isActive: true }];
    mock.method(db, 'collection', ((name: string) => ({
      get: async () => ({ docs: subscribers.map(s => ({ id: s.id, data: () => s })) }),
      doc: (id: string) => ({ id, get: async () => ({ exists: true, data: () => ({ smtpHost: 'smtp.example.test', smtpUser: 'fixture', smtpPass: 'fixture-pass' }) }), set: async (value: any) => { if (name === 'mailing_logs') logs.push(value); } }),
    })) as any);
    mock.method(db, 'runTransaction', (async (work: any) => work({ get: async (ref: any) => ({ ref, exists: true, data: () => subscribers[0] }), update: (_ref: any, patch: any) => updates.push(patch) })) as any);
    mock.method(nodemailer, 'createTransport', (() => ({ close() {}, sendMail: async () => {
      if (fail) throw Object.assign(new Error('fixture authentication failed'), { code: 'EAUTH', responseCode: 535 });
      return { accepted: ['fixture@example.test'], rejected: [] };
    } })) as any);
    const result = await executeMailingDispatch({ warehouseData: { warehouses: [] }, triggerSource: 'fixture' });
    assert.equal(result.success, !fail);
    assert.equal(updates.length, fail ? 0 : 1);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, fail ? 'failed' : 'success');
  }
});
