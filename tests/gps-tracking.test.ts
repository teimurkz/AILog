import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import express from 'express';
import http from 'node:http';
import { io as connectSocket } from 'socket.io-client';

// Import services only after changing to isolated storage. Real orders, tokens,
// driver sessions and Telegram message queues are never touched by these tests.
const workspace = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ailog-gps-test-'));
process.chdir(fixture);
process.env.CRM_STORAGE_MODE = 'local';
process.env.TELEGRAM_BOT_DISABLED = 'true';
process.env.GPS_ROUTE_PROVIDER_DISABLED = 'true';
const { storageService: store } = await import('../server/services/storage.service.js');
const tracking = await import('../server/services/telegram.service.js');
const { default: driverRoutes } = await import('../server/routes/driver.routes.js');
const { default: orderRoutes } = await import('../server/routes/orders.routes.js');
const { initSocketServer } = await import('../server/services/socket.service.js');
const auth = await import('../server/services/crm-auth.service.js');
const { default: authRoutes } = await import('../server/routes/auth.routes.js');
const { default: usersRoutes } = await import('../server/routes/users.routes.js');
const { default: realtimeRoutes, broadcastRealtimeEvent } = await import('../server/routes/realtime.routes.js');
const claimsByToken = new Map<string, any>();
function authorize(uid: string, overrides: any = {}) {
  const user = store.getUser(uid)!;
  const token = 'fixture-' + uid + '-' + claimsByToken.size;
  claimsByToken.set(token, { uid, email: user.email, email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: 'google.com' }, ...overrides });
  return token;
}
const authenticateTest = auth.createAuthenticator(async token => {
  const claims = claimsByToken.get(token);
  if (!claims) throw new Error('Invalid token');
  return claims;
}, async uid => store.getUser(uid));
const adminToken = authorize('admin_local');
const app = express();
app.use(express.json());
app.use((req, res, next) => { authenticateTest(req).then(() => next()).catch(() => res.status(401).json({ error: 'Invalid Firebase token' })); });
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/realtime', realtimeRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/orders', orderRoutes);
const server = http.createServer(app);
const io = initSocketServer(server, authenticateTest);
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const socket = connectSocket(base, { transports: ['websocket'], forceNew: true, extraHeaders: { Authorization: 'Bearer ' + adminToken } });
await new Promise<void>(resolve => socket.once('connect', resolve));
const positions: any[] = [];
const completions: any[] = [];
socket.on('truck_position_update', data => positions.push(data));
socket.on('delivery_ended', data => completions.push(data));
const sent: { method: string; payload: any }[] = [];
const fakeApi = async (method: string, payload: any) => {
  sent.push({ method, payload });
  return { message_id: 50000 + sent.length };
};
const now = () => Math.floor(Date.now() / 1000);
let nextId = 0;
function order() {
  const n = ++nextId;
  return store.saveOrder({ id: `document-${n}`, orderNumber: `REG-TEST-${n}`, status: 'new',
    originCity: 'Алматы', destinationCity: 'Астана' });
}
const chat = (id: number) => ({ id, type: 'private' });
const from = (id: number) => ({ id, first_name: 'Тестовый водитель' });
const text = (id: number, value: string) => tracking.processTelegramUpdate({ message: {
  message_id: 1, date: now(), chat: chat(id), from: from(id), text: value } }, fakeApi);
const callback = (id: number, data: string) => tracking.processTelegramUpdate({ callback_query: {
  id: `cb-${sent.length}`, from: from(id), data, message: { message_id: 2, chat: chat(id) } } }, fakeApi);
const locationMessage = (id: number, messageId: number, date: number, live = true, edit?: number, lat = 43.25, lng = 76.92) => ({
  message_id: messageId, date, ...(edit ? { edit_date: edit } : {}), chat: chat(id), from: from(id),
  location: { latitude: lat, longitude: lng, horizontal_accuracy: 20, ...(live ? { live_period: 0x7fffffff } : {}) }
});
const gps = (msg: any, edited = false) => tracking.processTelegramUpdate({ [edited ? 'edited_message' : 'message']: msg }, fakeApi);
const request = async (url: string, body?: any, method = 'POST') => {
  const res = await fetch(base + url, { method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
};
after(async () => {
  socket.close();
  await new Promise<void>(resolve => io.close(() => resolve()));
  server.closeAllConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(workspace);
  // This is a verified directory created by mkdtemp for this test only.
  assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('deep link and plain-text selection require explicit consent before GPS', async () => {
  const o = order();
  await text(101, `/start ${o.orderNumber}`);
  assert.equal(store.getSession(101), undefined);
  assert.match(sent.at(-1)!.payload.text, /согласен/);
  await gps(locationMessage(101, 10, now()));
  assert.equal(tracking.getDriverLocation(o.id).hasRealGps, false);
  await text(101, o.orderNumber);
  assert.equal(store.getSession(101), undefined);
  await callback(101, `consent_trip:${o.orderNumber}`);
  assert.equal(store.getOrder(o.id)?.driverConsent, true);
  assert.ok(store.getOrder(o.id)?.driverConsentAt);
  assert.equal(tracking.getDriverLocation(o.id).hasRealGps, false);
  // Reservation is enforced before the first GPS point arrives.
  await callback(102, `consent_trip:${o.orderNumber}`);
  assert.equal(store.getSession(102), undefined);
  assert.match(sent.at(-1)!.payload.text, /другим водителем/);
});

test('live Telegram edits reach the map with raw GPS, computed speed and one socket event', async () => {
  const o = order();
  await callback(201, `consent_trip:${o.orderNumber}`);
  const t = now();
  const before = positions.length;
  socket.emit('join_order_room', o.id);
  await gps(locationMessage(201, 20, t));
  await gps(locationMessage(201, 20, t, true, t + 30, 43.255, 76.925), true);
  await new Promise(resolve => setTimeout(resolve, 50));
  const result = await request(`/api/driver/location/${o.id}?status=new`);
  assert.equal(result.body.currentLat, 43.255);
  assert.equal(result.body.currentLng, 76.925);
  assert.equal(result.body.hasRealGps, true);
  assert.equal(result.body.isTrackingActive, true);
  assert.ok(result.body.speed > 0, 'Telegram has no speed field; calculate from coordinates and device time');
  assert.equal(result.body.locationHistory.length, 2);
  assert.equal(positions.length - before, 2);
  assert.equal(positions.at(-1).orderId, o.id);
  assert.equal(positions.at(-1).orderNumber, o.orderNumber);
  assert.equal(positions.at(-1).hasRealGps, true);
  const lastGpsUpdate = store.getOrder(o.id)!.lastGpsUpdate;
  await request(`/api/driver/location/${o.orderNumber}`);
  assert.equal(store.getOrder(o.id)!.lastGpsUpdate, lastGpsUpdate, 'map reads never fabricate fresh GPS');
  await gps(locationMessage(201, 20, t, true, t + 10, 1, 1), true);
  assert.equal(tracking.getDriverLocation(o.id).currentLat, 43.255);
  await text(201, '/start');
  await callback(201, 'refresh_orders');
  assert.equal(store.getSession(201)?.tripActive, true);
});

test('static point is visible at zero coordinates but does not claim live tracking', async () => {
  const o = order();
  await callback(301, `consent_trip:${o.orderNumber}`);
  const t = now();
  await gps(locationMessage(301, 30, t, false, undefined, 0, 0));
  let map = tracking.getDriverLocation(o.id);
  assert.equal(map.hasRealGps, true);
  assert.equal(map.isTrackingActive, false);
  assert.equal(map.currentLat, 0);
  assert.match(map.signalStatusText, /Разовая/);
  await gps(locationMessage(301, 31, t, true));
  map = tracking.getDriverLocation(o.id);
  assert.equal(map.isTrackingActive, true);
});

test('stopping, expiry and resuming a live message preserve the last actual position', async () => {
  const o = order();
  await callback(401, `consent_trip:${o.orderNumber}`);
  const t = now();
  await gps(locationMessage(401, 40, t));
  await gps(locationMessage(401, 40, t, false, t + 1), true);
  assert.equal(tracking.getDriverLocation(o.id).isTrackingActive, false);
  assert.equal(tracking.getDriverLocation(o.id).hasRealGps, true);
  assert.equal(store.getOrder(o.id)?.status, 'dispatched');
  await gps(locationMessage(401, 41, t + 2));
  store.saveOrder({ ...store.getOrder(o.id)!, liveLocationExpiresAt: new Date(Date.now() - 1000).toISOString() });
  const map = tracking.getDriverLocation(o.id);
  assert.equal(map.isTrackingActive, false);
  assert.match(map.signalStatusText, /истёк/);
  assert.equal(map.currentLat, 43.25);
});

test('completion rejects other drivers, old buttons and late GPS across subsequent trips', async () => {
  const a = order();
  const b = order();
  const t = now();
  await callback(501, `consent_trip:${a.orderNumber}`);
  await gps(locationMessage(501, 50, t));
  await callback(502, `finish_trip:${a.orderNumber}`);
  assert.equal(store.getOrder(a.id)?.status, 'dispatched');
  await callback(501, `consent_trip:${b.orderNumber}`);
  assert.equal(store.getSession(501)?.orderId, a.id);
  await callback(501, `finish_trip:${a.orderNumber}`);
  assert.equal(store.getOrder(a.id)?.status, 'delivered');
  assert.equal(store.getSession(501), undefined);
  await gps(locationMessage(501, 50, t, true, t + 1), true);
  const map = (await request(`/api/driver/location/${a.id}?status=dispatched`)).body;
  assert.equal(map.signalStatus, 'delivered');
  assert.equal(map.isTrackingActive, false);
  assert.equal(map.currentLat, 43.25, 'completed trip must not teleport to destination');
  assert.equal((await request('/api/driver/location', { orderId: a.id, lat: 1, lng: 1 })).status, 409);
  await callback(501, `consent_trip:${b.orderNumber}`);
  await gps(locationMessage(501, 50, t, true, t + 2), true);
  assert.equal(tracking.getDriverLocation(b.id).hasRealGps, false);
  await callback(501, `finish_trip:${a.orderNumber}`);
  assert.equal(store.getSession(501)?.orderId, b.id);
  await gps(locationMessage(501, 51, t + 3));
  await text(501, '🛑 Завершить рейс');
  assert.equal(store.getOrder(b.id)?.status, 'delivered');
});

test('invalid coordinates and missing consent are rejected; cancelled trips cannot be revived', async () => {
  const o = order();
  assert.equal((await request('/api/driver/location', { orderId: o.id, lat: 10, lng: 10 })).status, 403);
  await callback(601, `consent_trip:${o.orderNumber}`);
  for (const lat of [null, '43.2', 91]) {
    assert.equal((await request('/api/driver/location', { orderId: o.id, lat, lng: 76 })).status, 400);
  }
  const t = now();
  await gps(locationMessage(601, 60, t));
  await request(`/api/orders/regional/${o.id}`, { status: 'cancelled' }, 'PUT');
  assert.equal(store.getSession(601), undefined);
  await gps(locationMessage(601, 60, t, true, t + 1), true);
  assert.equal(store.getOrder(o.id)?.status, 'cancelled');
  tracking.syncActiveOrders([{ ...o, status: 'dispatched' }]);
  assert.equal(store.getOrder(o.id)?.status, 'cancelled');
  assert.equal((await request(`/api/orders/regional/${o.id}`, { status: 'dispatched' }, 'PUT')).status, 409);
});

test('session, consent and GPS survive a fresh server process; next edited message continues same trip', async () => {
  const o = order();
  await callback(701, `consent_trip:${o.orderNumber}`);
  const t = now();
  await gps(locationMessage(701, 70, t));
  const module = fileURLToPath(new URL('../server/services/telegram.service.ts', import.meta.url));
  const childCode = `const t=await import(${JSON.stringify('file:///' + module.replaceAll('\\', '/'))});
    const before=t.getDriverLocation(${JSON.stringify(o.id)});
    t.acceptTelegramLocation(${JSON.stringify(locationMessage(701, 70, t, true, t + 5, 43.26, 76.93))},true);
    console.log('RESULT:'+JSON.stringify({before,after:t.getDriverLocation(${JSON.stringify(o.id)})}));`;
  const output = execFileSync(process.execPath, ['--import', pathToFileURL(path.join(workspace, 'node_modules/tsx/dist/loader.mjs')).href, '--input-type=module', '-e', childCode],
    { cwd: fixture, encoding: 'utf8', timeout: 20000 });
  const restored = JSON.parse(output.split('RESULT:')[1].trim());
  assert.equal(restored.before.hasRealGps, true);
  assert.equal(restored.before.isTrackingActive, true);
  assert.equal(restored.after.currentLat, 43.26);
  assert.equal(restored.after.isTrackingActive, true);
  assert.deepEqual(restored.before.trackingStartLocation, restored.after.trackingStartLocation);
});

test('route starts at first device GPS, remains fixed during movement and ends at the requested city', async () => {
  const o = order();
  store.saveOrder({ ...o, destinationCity: 'Тараз' });
  const waiting = tracking.getDriverLocation(o.id);
  assert.equal(waiting.routeWaypoints.length, 0);
  assert.equal(waiting.detailedRoadPolyline.length, 0);
  await callback(801, `consent_trip:${o.orderNumber}`);
  const t = now();
  await gps(locationMessage(801, 80, t, true, undefined, 43.39, 76.90));
  const initial = tracking.getDriverLocation(o.id);
  assert.deepEqual(initial.detailedRoadPolyline[0], { lat: 43.39, lng: 76.90 });
  assert.equal(initial.routeWaypoints[0].name, 'Старт GPS');
  assert.equal(initial.routeWaypoints.at(-1)?.name, 'Тараз');
  assert.deepEqual(initial.detailedRoadPolyline.at(-1), { lat: 42.9, lng: 71.3667 });
  assert.equal(initial.progressPercent, 0);
  await gps(locationMessage(801, 80, t, true, t + 20, 43.38, 76.88), true);
  const moved = tracking.getDriverLocation(o.id);
  assert.equal(moved.currentLat, 43.38);
  assert.deepEqual(moved.trackingStartLocation, initial.trackingStartLocation);
  assert.deepEqual(moved.detailedRoadPolyline[0], initial.detailedRoadPolyline[0]);
  assert.equal(moved.totalDistanceKm, initial.totalDistanceKm);
});

test('existing trip recovers its original GPS start and preserves it after history is truncated', async () => {
  const o = order();
  store.saveOrder({ ...o, driverConsent: true, hasRealGps: true, currentLat: 44, currentLng: 74,
    lastGpsUpdate: new Date().toISOString(), isTrackingActive: true });
  const first = { lat: 43.39, lng: 76.90, timestamp: new Date(Date.now() - 60000).toISOString() };
  store.appendTelemetryPoint(o.id, first);
  const map = tracking.getDriverLocation(o.id);
  assert.deepEqual(map.trackingStartLocation, first);
  store.getTelemetry(o.id).splice(0);
  assert.deepEqual(tracking.getDriverLocation(o.id).trackingStartLocation, first);
});

test('road provider receives GPS origin and city in longitude/latitude order and preserves exact endpoints', async () => {
  const { fetchTripRoadRoute } = await import('../server/services/trip-route.service.js');
  const origin = { lat: 43.39, lng: 76.90 };
  const destination = { lat: 42.9, lng: 71.3667 };
  let url = '';
  const route = await fetchTripRoadRoute(origin, destination, (async (input: any) => {
    url = String(input);
    return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 500000,
      geometry: { coordinates: [[76.901, 43.391], [74, 43], [71.367, 42.901]] } }] }), { status: 200 });
  }) as typeof fetch);
  assert.ok(url.includes('/76.9,43.39;71.3667,42.9?'));
  assert.deepEqual(route.points[0], origin);
  assert.deepEqual(route.points.at(-1), destination);
  await assert.rejects(fetchTripRoadRoute(origin, destination, (async () => new Response('{"code":"NoRoute"}')) as typeof fetch));
});

const requestAs = async (token: string, url: string, body?: any, method = 'POST') => {
  const res = await fetch(base + url, { method: body === undefined ? 'GET' : method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const roleTokens = new Map<string, string>();
test('Firebase verified owner alone gets GPS; existing staff/guest profiles are preserved', async () => {
  const o = order();
  tracking.consentToTrip(88001, o.id, 'Тест');
  await gps(locationMessage(88001, 88001, now()));
  assert.equal((await requestAs('', '/api/driver/location/' + o.id)).status, 401);
  assert.equal((await requestAs('forged', '/api/driver/location/' + o.id)).status, 401);
  const legacy = await fetch(base + '/api/driver/location/' + o.id, { headers: { Cookie: 'crm_session=old-code-session', 'X-User-Id': 'admin_local', 'X-User-Role': 'admin' } });
  assert.equal(legacy.status, 401);
  assert.equal((await request('/api/driver/location/' + o.id)).status, 200);
  for (const role of ['logistics', 'regional_manager', 'viewer', 'admin', 'guest'] as const) {
    const user = store.saveUser({ uid: 'access-' + role, email: role + '@example.test', role: role === 'guest' ? 'admin' : role,
      displayName: 'Existing employee' });
    const original = structuredClone(user);
    const token = authorize(user.uid, role === 'guest' ? { email: undefined, email_verified: false, firebase: { sign_in_provider: 'anonymous' } } : {});
    roleTokens.set(role, token);
    assert.equal((await requestAs(token, '/api/driver/location/' + o.id)).status, 403);
    assert.equal((await requestAs(token, '/api/driver/location/' + o.orderNumber)).status, 403);
    assert.equal((await requestAs(token, '/api/driver/bot-status')).status, 403);
    assert.equal((await requestAs(token, '/api/users/' + user.uid, { role: 'admin' }, 'PUT')).status, 403);
    for (const url of ['/api/orders/regional', '/api/orders/regional/' + o.id, '/api/driver/orders']) {
      const result = await requestAs(token, url);
      assert.equal(result.status, 200);
      for (const field of ['currentLat', 'currentLng', 'trackingStartLocation', 'locationHistory', 'lastGpsUpdate']) {
        assert.ok(!JSON.stringify(result.body).includes('"' + field + '"'), role + ' leaked ' + field);
      }
    }
    assert.deepEqual(store.getUser(user.uid), original, 'Reading a profile must not reset saved roles/names');
  }
  const unverified = authorize('admin_local', { email_verified: false });
  assert.equal((await requestAs(unverified, '/api/driver/bot-status')).status, 403);
  const meta = await requestAs('', '/api/driver/trip/' + o.id);
  assert.equal(meta.status, 200);
  assert.equal(meta.body.currentLat, undefined);
  assert.equal((await requestAs('', '/api/auth/login', { email: 'ti07kz@gmail.com', accessKey: 'obsolete' })).status, 404);
});

async function watchSse(token: string) {
  const controller = new AbortController();
  const response = await fetch(base + '/api/realtime/stream', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const events: { type: string; data: any }[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  const done = (async () => {
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const message = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const type = message.match(/^event: (.+)$/m)?.[1];
          const data = message.match(/^data: (.+)$/m)?.[1];
          if (type && data) events.push({ type, data: JSON.parse(data) });
        }
      }
    } catch (error) { if (!controller.signal.aborted) throw error; }
  })();
  return { events, close: async () => { controller.abort(); await done; } };
}
const eventually = async (predicate: () => boolean) => {
  const end = Date.now() + 3000;
  while (!predicate() && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), 'Expected realtime event did not arrive');
};
test('SSE and sockets send GPS only to the Firebase owner; staff continue getting order status', async () => {
  const tokens = [adminToken, ...roleTokens.values()];
  const streams = await Promise.all(tokens.map(watchSse));
  const clients = tokens.map(token => connectSocket(base, { transports: ['websocket'], forceNew: true, auth: { token } }));
  const received: any[][] = clients.map(() => []);
  clients.forEach((client, i) => client.on('truck_position_update', data => received[i].push(data)));
  try {
    await Promise.all(clients.map(client => new Promise<void>(resolve => client.once('connect', resolve))));
    const { emitTruckPositionUpdate, emitDeliveryEnded } = await import('../server/services/socket.service.js');
    const point = { orderId: 'access-check', lat: 43.31, lng: 76.92, updatedAt: new Date().toISOString() };
    broadcastRealtimeEvent('telemetry_update', point);
    broadcastRealtimeEvent('order_updated', { id: point.orderId, status: 'dispatched', currentLat: point.lat, locationHistory: [point], marker: 1 });
    emitTruckPositionUpdate(point);
    const barriers = clients.map(client => new Promise<void>(resolve => client.once('delivery_ended', () => resolve())));
    emitDeliveryEnded('access-check');
    await Promise.all(barriers);
    await eventually(() => streams.every(stream => stream.events.some(e => e.data.marker === 1)));
    assert.equal(received[0].length, 1);
    received.slice(1).forEach(events => assert.equal(events.length, 0));
    streams.slice(1).forEach(stream => {
      assert.ok(!stream.events.some(e => e.type === 'telemetry_update'));
      assert.equal(stream.events.find(e => e.data.marker === 1)!.data.currentLat, undefined);
      assert.equal(stream.events.find(e => e.data.marker === 1)!.data.status, 'dispatched');
    });
  } finally { clients.forEach(client => client.close()); await Promise.all(streams.map(stream => stream.close())); }
});

test('expired Firebase tokens cannot retain GPS access on an existing socket', async () => {
  const token = authorize('admin_local', { exp: Math.floor(Date.now() / 1000) + 2 });
  const client = connectSocket(base, { transports: ['websocket'], forceNew: true, auth: { token } });
  await new Promise<void>(resolve => client.once('connect', resolve));
  const events: any[] = [];
  client.on('truck_position_update', data => events.push(data));
  const { emitTruckPositionUpdate, emitDeliveryEnded } = await import('../server/services/socket.service.js');
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() + 10000;
    emitTruckPositionUpdate({ orderId: 'expiry-test', lat: 1, lng: 1, updatedAt: new Date().toISOString() });
    const barrier = new Promise<void>(resolve => client.once('delivery_ended', () => resolve()));
    emitDeliveryEnded('expiry-test'); await barrier;
    assert.equal(events.length, 0);
    assert.equal((await requestAs(token, '/api/driver/bot-status')).status, 401);
  } finally { Date.now = originalNow; client.close(); }
});
