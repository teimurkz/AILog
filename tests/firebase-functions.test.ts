import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveFirebaseApiUrl } from '../shared/firebase-endpoints.js';
import { mergeOrderGps, ageGpsSignal } from '../shared/gps-projection.js';

const workspace = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ailog-functions-test-'));
process.chdir(fixture);
process.env.TELEGRAM_BOT_TOKEN = 'fixture-token-never-sent';
process.env.TELEGRAM_WEBHOOK_SECRET = 'fixture-webhook-secret';
process.env.GOOGLE_APPLICATION_CREDENTIALS = '';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:1';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:1';
process.env.TELEGRAM_BOT_DISABLED = 'true';
process.env.GPS_ROUTE_PROVIDER_DISABLED = 'true';
// Simulate the Firebase platform invoking the exported function. No real tokens,
// Firestore emulator or production database are needed for HTTP boundary checks.
const require = createRequire(import.meta.url);
const { crmApi } = require(fileURLToPath(new URL('../functions/lib/index.js', import.meta.url)));
const server = http.createServer(crmApi);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
after(async () => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(workspace);
  assert.equal(path.dirname(path.resolve(fixture)), path.resolve(os.tmpdir()));
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('the static frontend resolves regional and driver requests to the same Firebase project', () => {
  assert.equal(resolveFirebaseApiUrl('/api/orders/regional'), 'https://asia-east1-logisticsapp-216d5.cloudfunctions.net/crmApi/api/orders/regional');
  assert.equal(resolveFirebaseApiUrl('/api/driver/telegram/webhook').endsWith('/crmApi/api/driver/telegram/webhook'), true);
  assert.throws(() => resolveFirebaseApiUrl('https://other-site.test/api/orders'));
  assert.throws(() => resolveFirebaseApiUrl('//other-site.test/api/orders'));
});

test('Firestore GPS joins by immutable document ID and preserves legacy records', () => {
  const orders = [{ id: 'first', orderNumber: 'REG-SAME', currentLat: 43 }, { id: 'second', orderNumber: 'REG-SAME', currentLat: 44 }];
  const result = mergeOrderGps(orders, [{ id: 'second', position: { currentLat: 0, currentLng: 0, isTrackingActive: true }, history: [] }]);
  assert.equal(result[0].currentLat, 43);
  assert.equal(result[1].currentLat, 0);
  assert.equal(result[1].id, 'second');
  assert.equal(orders[1].currentLat, 44);
});

test('signal expiry is reflected without a polling server or invented coordinates', () => {
  const sample = { hasRealGps: true, isTrackingActive: true, currentLat: 43.39, speed: 65, signalStatus: 'in_transit', updatedAt: '2026-09-11T10:00:00Z' };
  const stale = ageGpsSignal(sample, Date.parse('2026-09-11T10:03:00Z'))!;
  assert.equal(stale.signalStatus, 'idle');
  assert.equal(stale.speed, 0);
  assert.equal(stale.currentLat, sample.currentLat);
  assert.equal(ageGpsSignal(sample, Date.parse('2026-09-11T10:11:00Z'))?.signalStatus, 'offline');
  const expired = ageGpsSignal({ ...sample, liveLocationExpiresAt: '2026-09-11T10:00:30Z' }, Date.parse('2026-09-11T10:01:00Z'))!;
  assert.equal(expired.isTrackingActive, false);
});

test('Firebase HTTP function accepts AI Studio CORS preflight and protects regional writes', async () => {
  const headers = { Origin: 'https://ai-studio-preview.example.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' };
  const preflight = await fetch(base + '/api/orders/regional', { method: 'OPTIONS', headers });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), headers.Origin);
  const health = await fetch(base + '/api/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'silk-road-crm');
  const response = await fetch(base + '/api/orders/regional', { method: 'POST', headers: { Origin: headers.Origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber: 'FIXTURE', destinationCity: 'Астана' }) });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.equal(process.env.CRM_STORAGE_MODE, 'firebase');
  assert.equal(fs.existsSync(path.join(fixture, 'server/data')), false);
});

test('GPS, completion and Telegram webhook cannot be forged using a public order URL', async () => {
  const gps = await fetch(base + '/api/driver/location/an-order');
  assert.equal(gps.status, 401);
  for (const route of ['/api/driver/location', '/api/driver/complete']) {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: 'an-order', lat: 1, lng: 1 }) });
    assert.equal(response.status, 403);
  }
  const webhook = await fetch(base + '/api/driver/telegram/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }, body: '{"update_id":123}' });
  assert.equal(webhook.status, 403);
});
