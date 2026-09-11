import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const workspace = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ailog-firebase-test-'));
process.chdir(fixture);
process.env.CRM_STORAGE_MODE = 'firebase';
process.env.TELEGRAM_BOT_DISABLED = 'true';
process.env.GPS_ROUTE_PROVIDER_DISABLED = 'true';
const { storageService } = await import('../server/services/storage.service.js');
const tracking = await import('../server/services/telegram.service.js');
const { withFirebaseTracking, REMOVE_FIELD } = await import('../server/services/firebase-tracking.service.js');
const { afterTrackingCommit } = await import('../server/services/tracking-context.js');
type Data = Record<string, Record<string, any>>;
const merge = (target: any, patch: any): any => {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === REMOVE_FIELD) delete result[key];
    else result[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(result[key], value) : structuredClone(value);
  }
  return result;
};
class CloudFixture {
  writes = 0;
  retryOnce = false;
  failCommit = false;
  beforeCommit?: () => void;
  constructor(public data: Data) {}
  async runTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    const attempt = async () => {
      const changes: Array<() => void> = [];
      const result = await work({
        read: async (collection: string, ids?: string[]) => Object.entries(this.data[collection] || {}).filter(([id]) => !ids || ids.includes(id)).map(([id, data]) => ({ id, data: structuredClone(data) })),
        findOrder: async (idOrNumber: string) => Object.entries(this.data.regional_orders || {}).filter(([id, data]) => id === idOrNumber || data.orderNumber === idOrNumber.toUpperCase()).map(([id, data]) => ({ id, data: structuredClone(data) })),
        merge: (collection: string, id: string, data: any) => changes.push(() => {
          this.data[collection] ||= {};
          this.data[collection][id] = merge(this.data[collection][id], data); this.writes++;
        }),
        create: (collection: string, id: string, data: any) => changes.push(() => {
          if (this.data[collection]?.[id]) throw Object.assign(new Error('Document already exists'), { code: 6 });
          this.data[collection] ||= {};
          this.data[collection][id] = structuredClone(data); this.writes++;
        }),
        remove: (collection: string, id: string) => changes.push(() => { delete this.data[collection][id]; this.writes++; })
      });
      return { result, changes };
    };
    if (this.retryOnce) { this.retryOnce = false; await attempt(); }
    const result = await attempt();
    if (this.failCommit) throw new Error('Firestore unavailable');
    this.beforeCommit?.();
    result.changes.forEach(change => change());
    return result.result;
  }
}
const database = () => new CloudFixture({
  regional_orders: {
    'firebase-existing-order': { orderNumber: 'REG-CLOUD-1', status: 'new', destinationCity: 'Шымкент',
      originCity: 'Алматы', managerName: 'Existing employee', customInvoiceField: { retained: true }, createdAt: '2025-05-02T10:00:00Z' }
  },
  users: { 'firebase-existing-uid': { email: 'employee@example.test', displayName: 'Existing employee', role: 'regional_manager', extraProfileField: 42 } }
});
after(() => {
  process.chdir(workspace);
  assert.ok(path.resolve(fixture).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('Firebase is authoritative and reading never uploads local defaults or overwrites existing documents', async () => {
  const cloud = database();
  cloud.data.regional_orders['second-existing-id'] = { ...cloud.data.regional_orders['firebase-existing-order'], comments: 'A separate document with the same public order number' };
  const original = structuredClone(cloud.data);
  storageService.saveOrder({ id: 'LOCAL-ONLY', orderNumber: 'LOCAL-ONLY', status: 'new', destinationCity: 'Астана' });
  const orders = await withFirebaseTracking(() => tracking.getActiveOrdersList(), { store: cloud });
  assert.deepEqual(orders.map(order => order.id), ['firebase-existing-order', 'second-existing-id']);
  assert.equal(cloud.writes, 0);
  assert.deepEqual(cloud.data, original);
  assert.equal(fs.existsSync(path.join(fixture, 'server/data/regional_orders.json')), false);
  assert.equal(fs.existsSync(path.join(fixture, 'server/data/users.json')), false);
});

test('consent, GPS and completion survive new engine state while employee data and order IDs stay unchanged', async () => {
  const cloud = database();
  const profiles = structuredClone(cloud.data.users);
  await withFirebaseTracking(() => tracking.consentToTrip(70001, 'REG-CLOUD-1', 'Driver'), { store: cloud });
  assert.equal(cloud.data.driver_sessions['70001'].orderId, 'firebase-existing-order');
  const timestamp = Math.floor(Date.now() / 1000);
  await withFirebaseTracking(() => tracking.acceptTelegramLocation({
    message_id: 7, date: timestamp, chat: { id: 70001 },
    location: { latitude: 43.39, longitude: 76.9, live_period: 0x7fffffff }
  }, false), { store: cloud });
  assert.equal(cloud.data.regional_orders['firebase-existing-order'].currentLat, undefined);
  assert.equal(cloud.data.gps_tracking['firebase-existing-order'].position.currentLat, 43.39);
  storageService.replaceTrackingState({ orders: [], sessions: [], telemetry: {} });
  const restored = await withFirebaseTracking(() => tracking.getDriverLocation('firebase-existing-order'), { store: cloud, orderLookup: 'REG-CLOUD-1' });
  assert.equal(restored.currentLat, 43.39);
  assert.equal(restored.driverConsent, true);
  assert.equal(restored.trackingStartLocation?.lat, 43.39);
  assert.ok(restored.locationHistory.length);
  await withFirebaseTracking(() => tracking.completeDriverTrip('REG-CLOUD-1', 70001), { store: cloud });
  assert.equal(cloud.data.regional_orders['firebase-existing-order'].status, 'delivered');
  assert.equal(cloud.data.driver_sessions['70001'], undefined);
  assert.equal(cloud.data.gps_tracking['firebase-existing-order'].position.isTrackingActive, false);
  assert.deepEqual(cloud.data.users, profiles);
  assert.deepEqual(cloud.data.regional_orders['firebase-existing-order'].customInvoiceField, { retained: true });
  assert.equal(cloud.data.regional_orders['firebase-existing-order'].createdAt, '2025-05-02T10:00:00Z');
});

test('Firestore retries publish once and failed commits cannot acknowledge saved tracking', async () => {
  const cloud = database();
  cloud.retryOnce = true;
  let runs = 0;
  const published: string[] = [];
  await withFirebaseTracking(() => {
    runs++;
    tracking.consentToTrip(70002, 'REG-CLOUD-1', 'Driver');
    afterTrackingCommit(() => published.push('saved'));
  }, { store: cloud, updateId: 120 });
  assert.equal(runs, 2);
  assert.deepEqual(published, ['saved']);
  await withFirebaseTracking(() => { throw new Error('Duplicate update must not execute'); }, { store: cloud, updateId: 120 });
  assert.equal(cloud.data.bot_state.telegram.lastUpdateId, 120);
  const snapshot = structuredClone(cloud.data);
  cloud.failCommit = true;
  await assert.rejects(withFirebaseTracking(() => {
    tracking.completeDriverTrip('REG-CLOUD-1', 70002);
    afterTrackingCommit(() => published.push('completed'));
  }, { store: cloud, updateId: 121 }));
  assert.deepEqual(cloud.data, snapshot);
  assert.deepEqual(published, ['saved']);
});

test('legacy Firebase GPS history remains readable without erasing any original fields', async () => {
  const cloud = database();
  Object.assign(cloud.data.regional_orders['firebase-existing-order'], {
    hasRealGps: true, driverConsent: true, currentLat: 43.39, currentLng: 76.9, lastGpsUpdate: '2026-09-11T10:05:00Z',
    locationHistory: [{ lat: 43.30, lng: 76.85, timestamp: '2026-09-11T10:00:00Z' }, { lat: 43.39, lng: 76.9, timestamp: '2026-09-11T10:05:00Z' }]
  });
  const original = structuredClone(cloud.data.regional_orders);
  const map = await withFirebaseTracking(() => tracking.getDriverLocation('firebase-existing-order'), { store: cloud });
  assert.equal(map.locationHistory.length, 2);
  assert.equal(map.trackingStartLocation?.lat, 43.30);
  assert.deepEqual(cloud.data.regional_orders, original);
});

test('a Firebase request awaits road geometry without writing local files', async () => {
  const { prepareTripRoadRoute, getTripRoadRoute } = await import('../server/services/trip-route.service.js');
  process.env.GPS_ROUTE_PROVIDER_DISABLED = 'false';
  try {
    const origin = { lat: 43.39, lng: 76.9 }, destination = { lat: 42.9, lng: 71.3667 };
    const fetcher = async () => new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 500000,
      geometry: { coordinates: [[76.901, 43.391], [74, 43], [71.367, 42.901]] } }] }));
    await prepareTripRoadRoute('function-road-fixture', origin, destination, fetcher as typeof fetch);
    const route = getTripRoadRoute('function-road-fixture', origin, destination, []);
    assert.equal(route.status, 'road');
    assert.deepEqual(route.points[0], origin);
    assert.deepEqual(route.points.at(-1), destination);
    assert.equal(fs.existsSync(path.join(fixture, 'server/data/gps_routes.json')), false);
  } finally { process.env.GPS_ROUTE_PROVIDER_DISABLED = 'true'; }
});

test('a concurrent order with the same ID cannot be overwritten during creation', async () => {
  const cloud = database();
  const concurrent = { orderNumber: 'EXISTING', destinationCity: 'Тараз', custom: 'keep' };
  cloud.beforeCommit = () => { cloud.data.regional_orders['new-id'] = structuredClone(concurrent); };
  await assert.rejects(withFirebaseTracking(() => storageService.saveOrder({ id: 'new-id', orderNumber: 'NEW',
    destinationCity: 'Астана', status: 'new' }), { store: cloud }), { code: 6 });
  assert.deepEqual(cloud.data.regional_orders['new-id'], concurrent);
  assert.equal(cloud.writes, 0);
});
