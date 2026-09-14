import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import nodemailer from 'nodemailer';
import { normalizeMailingDiagnostics } from '../shared/mailing-diagnostics.js';
import { MailingDiagnosticsPanel } from '../src/components/warehouses/MailingDiagnosticsPanel.js';

process.env.CRM_STORAGE_MODE = 'firebase';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.SMTP_PASS = '';
const { db } = await import('../server/config/firebase.js');
const { getSchedulerDiagnostics } = await import('../server/services/scheduler.service.js');
const { default: mailingRoutes } = await import('../server/routes/mailing.routes.js');
afterEach(() => mock.restoreAll());

function fakeDatabase(now: Date, options: { password?: string; state?: any; job?: any; scheduleType?: string; sendTime?: string; scheduleDays?: number[] } = {}) {
  const settings = { enabled: true, scheduleType: options.scheduleType || 'daily', scheduleDays: options.scheduleDays || [], sendTime: options.sendTime || '09:00', timezone: 'Asia/Almaty', smtpHost: 'smtp.example.test', smtpUser: 'fixture@example.test', smtpPass: options.password ?? 'fixture-private-password' };
  const state = options.state === undefined ? { activatedAt: '2026-09-01T00:00:00Z', lastCheckedAt: now.toISOString() } : options.state;
  mock.method(db, 'collection', ((name: string) => ({
    doc: () => ({ get: async () => ({ exists: true, data: () => settings }) }),
    get: async () => ({ docs: Array.from({ length: 4 }, (_, id) => ({ id: `fixture-${id}`, data: () => ({ isActive: true, email: `recipient${id}@example.test` }) })) }),
  })) as any);
  mock.method(db, 'doc', ((path: string) => ({ get: async () => ({ data: () => path === 'mailing_scheduler/warehouse' ? state : options.job }) })) as any);
  mock.method(db, 'runTransaction', (() => { throw new Error('Diagnostics must not mutate Firebase'); }) as any);
  mock.method(nodemailer, 'createTransport', (() => { throw new Error('Diagnostics must not connect to SMTP'); }) as any);
}

const render = (raw: unknown) => renderToStaticMarkup(<MailingDiagnosticsPanel diagnostics={normalizeMailingDiagnostics(raw)} onClose={() => {}} />);

test('reported 15:19 case shows 09:00, daily weekday match and saved SMTP without sending', async () => {
  const now = new Date('2026-09-14T10:19:00Z');
  fakeDatabase(now);
  const d = await getSchedulerDiagnostics(now);
  assert.equal(d.currentHHmm, '15:19');
  assert.equal(d.currentZonedTime, '14.09.2026 15:19');
  assert.equal(d.targetSendTime, '09:00');
  assert.equal(d.dayMatched, true);
  assert.equal(d.timeMatched, false);
  assert.equal(d.smtpConfigured, true);
  assert.equal(d.activeSubscribersCount, 4);
  assert.equal(d.shouldRunNow, false);
  assert.match(d.statusMessage, /время рассылки прошло/);
  const html = render(d);
  assert.match(html, /09:00/);
  assert.match(html, /Заполнены/);
  assert.doesNotMatch(html, /fixture-private-password|\(\)|Не настроен/);
});

test('enabled schedule does not claim a healthy service without a heartbeat', async () => {
  const now = new Date('2026-09-14T04:00:00Z');
  fakeDatabase(now, { state: null });
  const d = await getSchedulerDiagnostics(now);
  assert.equal(d.enabled, true);
  assert.equal(d.schedulerHealthy, false);
  assert.equal(d.shouldRunNow, false);
  assert.match(d.statusMessage, /warehouseMailing/);
  assert.match(render(d), /Нет свежего сигнала/);
});

test('real missing SMTP settings are distinguished from missing diagnostic fields', async () => {
  const now = new Date('2026-09-14T04:00:00Z');
  fakeDatabase(now, { password: '' });
  const d = await getSchedulerDiagnostics(now);
  assert.equal(d.smtpConfigured, false);
  assert.match(d.smtpError!, /логин и пароль/);
  assert.equal(d.shouldRunNow, false);
  assert.match(render(d), /Сохраните настройки SMTP/);
});

test('old deployed API aliases remain readable and absent booleans remain unknown', () => {
  const old = { enabled: true, scheduleType: 'daily', currentHHmm: '15:19', currentServerZonedTime: '14.09.2026 15:19', targetHHmm: '09:00', timezone: 'Asia/Almaty', activeSubscribersCount: 4 };
  const d = normalizeMailingDiagnostics(old);
  assert.equal(d.targetSendTime, '09:00');
  assert.equal(d.currentZonedTime, old.currentServerZonedTime);
  assert.equal(d.smtpConfigured, null);
  assert.equal(d.schedulerHealthy, null);
  assert.equal(d.dayMatched, true);
  assert.equal(d.apiUpdateRequired, true);
  const html = render(old);
  assert.match(html, /Нет данных от сервера/);
  assert.match(html, /crmApi/);
  assert.doesNotMatch(html, /Ошибка: Не настроен|\(\)/);
  assert.equal(normalizeMailingDiagnostics({ enabled: 'false' }).enabled, false);
});

test('eligible slot, accepted run, retry delay and active lease have distinct statuses', async () => {
  const now = new Date('2026-09-14T04:00:00Z');
  for (const [options, expected, message] of [
    [{}, true, /Условия выполнены/],
    [{ job: { status: 'sent', attempts: 1 } }, false, /Повтор не требуется/],
    [{ job: { status: 'failed', retryable: true, attempts: 1, nextRetryAt: now.getTime() + 300000 } }, false, /повторная попытка/],
    [{ state: { activatedAt: '2026-09-01T00:00:00Z', lastCheckedAt: now.toISOString(), leaseUntil: now.getTime() + 60000 } }, false, /выполняется/],
  ] as const) {
    mock.restoreAll(); fakeDatabase(now, options);
    const d = await getSchedulerDiagnostics(now);
    assert.equal(d.shouldRunNow, expected);
    assert.match(d.statusMessage, message);
  }
});

test('weekly days and modes without fixed times do not show fabricated mismatches', async () => {
  const sunday = new Date('2026-09-20T04:00:00Z');
  fakeDatabase(sunday, { scheduleType: 'workdays' });
  assert.equal((await getSchedulerDiagnostics(sunday)).dayMatched, false);
  for (const scheduleType of ['manual', 'on_change', 'test_interval']) {
    mock.restoreAll(); fakeDatabase(sunday, { scheduleType });
    const d = await getSchedulerDiagnostics(sunday);
    assert.equal(d.timeMatched, null);
    assert.equal(d.dayMatched, null);
    assert.doesNotMatch(render(d), /Совпадение по времени|День по расписанию/);
  }
});

test('real check-scheduler HTTP response renders through the shared UI contract', async () => {
  fakeDatabase(new Date());
  const app = express(); app.use('/api/mailing', mailingRoutes);
  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/api/mailing/check-scheduler`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.diagnosticsVersion, 2);
    assert.equal(body.targetSendTime, '09:00');
    assert.equal(body.smtpConfigured, true);
    assert.equal(body.dayMatched, true);
    assert.match(render(body), /Заполнены/);
    assert.doesNotMatch(JSON.stringify(body), /fixture-private-password/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
