import test from 'node:test';
import assert from 'node:assert/strict';
import { dueMailingRun, runMailingTick, SCHEDULER_STATE, type MailingJobStore, type MailingTransaction } from '../server/services/mailing-job-runner.js';
import { smtpFailure, smtpSecure, describeSmtpError } from '../server/services/smtp-policy.js';

const settings = { enabled: true, scheduleType: 'daily', sendTime: '09:00', timezone: 'Asia/Almaty' };
const activation = '2026-09-13T00:00:00Z';
class MemoryStore implements MailingJobStore {
  data = new Map<string, any>([
    ['mailing_settings/config', { ...settings, smtpPass: 'fixture-only', unrelatedField: 'preserved' }],
    [SCHEDULER_STATE, { activatedAt: activation }],
  ]);
  tail: Promise<unknown> = Promise.resolve();
  transaction<T>(work: (tx: MailingTransaction) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const writes: [string, any][] = [];
      const value = await work({
        get: async path => { assert.equal(writes.length, 0, 'Firestore requires reads before writes'); return structuredClone(this.data.get(path)); },
        set: (path, patch) => { writes.push([path, structuredClone(patch)]); },
      });
      for (const [path, patch] of writes) this.data.set(path, { ...this.data.get(path), ...patch });
      return value;
    });
    this.tail = result.catch(() => {});
    return result;
  }
  jobs() { return [...this.data].filter(([key]) => key.startsWith('mailing_runs/')).map(([, value]) => value); }
}
function fixture() {
  const store = new MemoryStore();
  let time = new Date('2026-09-14T04:00:00Z');
  let sends = 0;
  const deps = {
    store, now: () => time,
    loadWarehouse: async () => ({ spreadsheetId: 'fixture', warehouses: [{ id: 'stock', items: [{ rawRow: [1] }] }] }),
    dispatch: async (options: any): Promise<any> => { await options.beforeSend(); sends++; return { success: true }; },
  };
  return { store, deps, sends: () => sends, advance: (minutes: number) => { time = new Date(time.getTime() + minutes * 60_000); } };
}

test('09:00 Almaty is 04:00 UTC; short late starts catch up, old reports do not', () => {
  assert.equal(dueMailingRun(settings, new Date('2026-09-14T03:59Z'), activation), null);
  assert.match(dueMailingRun(settings, new Date('2026-09-14T04:00Z'), activation)!, /2026-09-14_09:00/);
  assert.ok(dueMailingRun(settings, new Date('2026-09-14T04:20Z'), activation));
  assert.equal(dueMailingRun(settings, new Date('2026-09-14T06:00Z'), activation), null);
  assert.equal(dueMailingRun(settings, new Date('2026-09-14T04:20Z'), '2026-09-14T04:10Z'), null);
});

test('disabled, manual, weekdays, weekly, custom days and invalid settings', () => {
  const monday = new Date('2026-09-14T04:00Z');
  const sunday = new Date('2026-09-20T04:00Z');
  for (const enabled of [false, 'false', undefined]) assert.equal(dueMailingRun({ ...settings, enabled }, monday, activation), null);
  assert.equal(dueMailingRun({ ...settings, scheduleType: 'manual' }, monday, activation), null);
  for (const scheduleType of ['workdays', 'weekly']) {
    assert.ok(dueMailingRun({ ...settings, scheduleType }, monday, activation));
    assert.equal(dueMailingRun({ ...settings, scheduleType }, sunday, activation), null);
  }
  assert.ok(dueMailingRun({ ...settings, scheduleType: 'custom', scheduleDays: [0] }, sunday, activation));
  assert.throws(() => dueMailingRun({ ...settings, sendTime: '29:99' }, monday, activation));
  assert.throws(() => dueMailingRun({ ...settings, timezone: 'bad/timezone' }, monday, activation));
});

test('first deployment only establishes a baseline and does not mail retrospectively', async () => {
  const f = fixture(); f.store.data.delete(SCHEDULER_STATE); f.advance(20);
  await runMailingTick(f.deps); await runMailingTick(f.deps);
  assert.equal(f.sends(), 0);
  assert.ok(f.store.data.get(SCHEDULER_STATE).lastCheckedAt);
});

test('overlapping scheduler invocations and restarted instances send one report', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 10 }, () => runMailingTick(f.deps)));
  f.advance(10); await runMailingTick({ ...f.deps });
  assert.equal(f.sends(), 1);
  assert.equal(f.store.jobs()[0].status, 'sent');
  assert.equal(f.store.data.get('mailing_settings/config').unrelatedField, 'preserved');
  assert.equal(f.store.data.get('mailing_settings/config').lastAutoSentKey, undefined);
});

test('TLS failure is retried later, never marked as successful before acceptance', async () => {
  const f = fixture(); let attempts = 0;
  f.deps.dispatch = async options => {
    await options.beforeSend(); attempts++;
    return attempts === 1 ? { success: false, retryable: true, error: 'fixture TLS failure' } : { success: true };
  };
  await runMailingTick(f.deps);
  assert.equal(f.store.jobs()[0].status, 'failed');
  assert.equal(f.store.data.get(SCHEDULER_STATE).lastSuccessAt, undefined);
  f.advance(1); await runMailingTick(f.deps); assert.equal(attempts, 1);
  f.advance(4); await runMailingTick(f.deps); assert.equal(attempts, 2);
  assert.equal(f.store.jobs()[0].status, 'sent');
});

test('retry budget is bounded and preparation failures are logged', async () => {
  const f = fixture(); let attempts = 0;
  f.deps.dispatch = async () => { attempts++; throw new Error('fixture download failure'); };
  for (let i = 0; i < 5; i++) { await runMailingTick(f.deps); f.advance(15); }
  assert.equal(attempts, 3);
  assert.equal(f.sends(), 0);
  assert.equal([...f.store.data.keys()].filter(k => k.startsWith('mailing_logs/')).length, 3);
});

test('unknown delivery and partial acceptance are not resent to the entire list', async () => {
  for (const result of [{ success: false, uncertain: true }, { success: false, log: { status: 'partial' } }]) {
    const f = fixture(); let calls = 0;
    f.deps.dispatch = async options => { await options.beforeSend(); calls++; return result; };
    await runMailingTick(f.deps); f.advance(10); await runMailingTick(f.deps);
    assert.equal(calls, 1);
  }
});

test('crash after SMTP starts blocks repeats; an expired preparation lease can recover', async () => {
  for (const status of ['sending', 'preparing']) {
    const f = fixture();
    await runMailingTick(f.deps);
    const path = [...f.store.data.keys()].find(p => p.startsWith('mailing_runs/'))!;
    f.store.data.set(path, { ...f.store.data.get(path), status });
    for (const key of f.store.data.keys()) if (key.startsWith('mailing_logs/')) f.store.data.delete(key);
    f.store.data.set(SCHEDULER_STATE, { ...f.store.data.get(SCHEDULER_STATE), token: 'dead-worker', leaseUntil: Date.parse('2026-09-14T04:05Z') });
    f.advance(6); await runMailingTick(f.deps);
    assert.equal(f.sends(), status === 'sending' ? 1 : 2);
    assert.equal(f.store.jobs()[0].status, status === 'sending' ? 'uncertain' : 'sent');
  }
});

test('a saved SMTP receipt recovers a crash before the job was completed', async () => {
  const f = fixture();
  await runMailingTick(f.deps);
  const path = [...f.store.data.keys()].find(p => p.startsWith('mailing_runs/'))!;
  f.store.data.set(path, { ...f.store.data.get(path), status: 'sending' });
  f.advance(6); await runMailingTick(f.deps);
  assert.equal(f.sends(), 1);
  assert.equal(f.store.jobs()[0].status, 'sent');
});

test('turning mailing off while preparing prevents SMTP from starting', async () => {
  const f = fixture(); let calls = 0;
  f.deps.dispatch = async options => {
    f.store.data.set('mailing_settings/config', { ...settings, enabled: false });
    await options.beforeSend(); calls++;
    return { success: true };
  };
  await runMailingTick(f.deps);
  assert.equal(calls, 0);
  assert.equal(f.store.jobs()[0].retryable, false);
});

test('database failures stop the job without fallback recipients', async () => {
  const f = fixture();
  f.deps.store.transaction = async () => { throw new Error('fixture Firestore unavailable'); };
  await assert.rejects(() => runMailingTick(f.deps), /Firestore unavailable/);
  assert.equal(f.sends(), 0);
});

test('on-change establishes a baseline, ignores metadata, and sends changed rows once', async () => {
  const f = fixture();
  f.store.data.set('mailing_settings/config', { ...settings, scheduleType: 'on_change' });
  await runMailingTick(f.deps); assert.equal(f.sends(), 0);
  await runMailingTick(f.deps); assert.equal(f.sends(), 0);
  f.deps.loadWarehouse = async () => ({ spreadsheetId: 'fixture', warehouses: [{ id: 'stock', items: [{ rawRow: [2] }] }] });
  await runMailingTick(f.deps); await runMailingTick(f.deps);
  assert.equal(f.sends(), 1);
});

test('test interval survives restarts without resending the same interval', async () => {
  const f = fixture();
  f.store.data.set('mailing_settings/config', { ...settings, scheduleType: 'test_interval', intervalMinutes: 5 });
  await runMailingTick(f.deps); f.advance(1); await runMailingTick(f.deps);
  assert.equal(f.sends(), 1);
  f.advance(4); await runMailingTick(f.deps); assert.equal(f.sends(), 2);
});

test('SMTP port and retry policy prevent wrong TLS mode and ambiguous duplicates', () => {
  assert.equal(smtpSecure(465, false), true);
  assert.equal(smtpSecure(587, 'false'), false);
  assert.equal(smtpSecure(2525, true), false);
  assert.deepEqual(smtpFailure({ code: 'ESOCKET', command: 'CONN', message: 'Client network socket disconnected before secure TLS connection was established' }), { retryable: true, uncertain: false });
  assert.deepEqual(smtpFailure({ code: 'ESOCKET', command: 'CONN', message: 'Unexpected socket close' }), { retryable: false, uncertain: true });
  assert.deepEqual(smtpFailure({ code: 'EAUTH', responseCode: 535 }), { retryable: false, uncertain: false });
  assert.deepEqual(smtpFailure({ command: 'DATA', responseCode: 451 }), { retryable: true, uncertain: false });
  assert.equal(describeSmtpError({ message: 'failed fixture-password' }, ['fixture-password']).includes('fixture-password'), false);
});
