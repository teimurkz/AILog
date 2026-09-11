import type { RequestHandler, Response } from 'express';
import { storageService, type RegionalOrderRecord } from './storage.service.js';
import { usesFirebase, trackingEffects } from './tracking-context.js';
import { FieldValue } from 'firebase-admin/firestore';
export const REMOVE_FIELD = FieldValue.delete();

type Document = { id: string; data: Record<string, any> };
export interface TrackingCloudStore {
  runTransaction<T>(work: (tx: {
    read: (collection: string, ids?: string[]) => Promise<Document[]>;
    findOrder: (idOrNumber: string) => Promise<Document[]>;
    merge: (collection: string, id: string, data: any) => void;
    remove: (collection: string, id: string) => void;
  }) => Promise<T>): Promise<T>;
}
const cloudStore: TrackingCloudStore = {
  async runTransaction(work) {
    const { db } = await import('../config/firebase.js');
    return db.runTransaction(async transaction => work({
      read: async (collection, ids) => {
        if (!ids) return (await transaction.get(db.collection(collection))).docs.map(d => ({ id: d.id, data: d.data() }));
        const docs = await Promise.all(ids.map(id => transaction.get(db.collection(collection).doc(id))));
        return docs.filter(d => d.exists).map(d => ({ id: d.id, data: d.data()! }));
      },
      findOrder: async id => {
        const direct = await transaction.get(db.collection('regional_orders').doc(id));
        if (direct.exists) return [{ id: direct.id, data: direct.data()! }];
        return (await transaction.get(db.collection('regional_orders').where('orderNumber', '==', id.trim().toUpperCase()).limit(1))).docs.map(d => ({ id: d.id, data: d.data() }));
      },
      merge: (collection, id, data) => transaction.set(db.collection(collection).doc(id), data, { merge: true }),
      remove: (collection, id) => transaction.delete(db.collection(collection).doc(id))
    }));
  }
};
function plain(value: any): any {
  if (value instanceof FieldValue) return value;
  if (value?.toDate instanceof Function) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, plain(v)]));
  return value;
}
// Shared with the REST redaction boundary. Store new telemetry in a private collection.
const gpsKeys = ['currentLat', 'currentLng', 'speed', 'heading', 'lastGpsUpdate', 'driverConsent', 'driverConsentAt', 'hasRealGps',
  'isTrackingActive', 'trackingSource', 'trackingStartLocation', 'liveLocationExpiresAt', 'trackingStoppedAt', 'locationHistory'];
const splitOrder = (order: any) => {
  const business: any = {}, gps: any = {};
  for (const [key, value] of Object.entries(order)) (gpsKeys.includes(key) ? gps : business)[key] = value;
  return { business, gps };
};
const diff = (before: any, after: any) => {
  const changed: Record<string, any> = Object.fromEntries(Object.entries(plain(after)).filter(([key, value]) => JSON.stringify(plain(before?.[key])) !== JSON.stringify(value)));
  for (const key of Object.keys(after)) if (after[key] === undefined && before?.[key] !== undefined) changed[key] = REMOVE_FIELD;
  return changed;
};
let tail: Promise<unknown> = Promise.resolve();

export async function withFirebaseTracking<T>(work: () => Promise<T> | T, options: { updateId?: number; store?: TrackingCloudStore; orderLookup?: string; gpsChatId?: number } = {}): Promise<T> {
  if (!usesFirebase() && !options.store) return work();
  // The synchronous GPS engine gets its state exclusively from one Firestore transaction.
  // Serialize access to that in-memory engine; Firestore retries conflicting cloud writes.
  const run = tail.then(async () => {
    let committedEffects: Array<() => void> = [];
    const value = await (options.store || cloudStore).runTransaction(async tx => {
      const selectedSession = options.gpsChatId ? await tx.read('driver_sessions', [String(options.gpsChatId)]) : [];
      const target = options.orderLookup || selectedSession[0]?.data.orderId;
      const orders = target ? await tx.findOrder(target) : await tx.read('regional_orders');
      const [tracking, sessions, botState] = await Promise.all([
        tx.read('gps_tracking', orders.map(order => order.id)),
        options.orderLookup ? Promise.resolve([]) : selectedSession.length ? Promise.resolve(selectedSession) : tx.read('driver_sessions'),
        options.updateId !== undefined ? tx.read('bot_state', ['telegram']) : Promise.resolve([])
      ]);
      const cursor = botState.find(d => d.id === 'telegram')?.data.lastUpdateId || 0;
      if (options.updateId !== undefined && options.updateId <= cursor) return undefined as T;
      const gpsById = new Map(tracking.map(d => [d.id, plain(d.data)]));
      const before = {
        orders: orders.map(d => ({ ...plain(d.data), ...gpsById.get(d.id)?.position, id: d.id })) as RegionalOrderRecord[],
        sessions: sessions.map(d => ({ ...plain(d.data), chatId: Number(d.id) })) as any[],
        telemetry: Object.fromEntries(orders.map(d => [d.id.toUpperCase(),
          plain(gpsById.get(d.id)?.history || d.data.locationHistory || [])]))
      };
      storageService.replaceTrackingState(structuredClone(before));
      const effects: Array<() => void> = [];
      const result = await trackingEffects.run(effects, work);
      const after = storageService.trackingState();
      const oldOrders = new Map(before.orders.map(o => [o.id, o]));
      for (const order of after.orders) {
        const old = oldOrders.get(order.id);
        const current = splitOrder(order), previous = splitOrder(old || {});
        const changed = diff(previous.business, current.business);
        // A GPS refresh does not edit business metadata such as the order's update time.
        if (old && Object.keys(changed).every(key => key === 'updatedAt')) delete changed.updatedAt;
        if (Object.keys(changed).length) tx.merge('regional_orders', order.id, changed);
        const position = diff(previous.gps, current.gps);
        const history = after.telemetry[order.id.toUpperCase()] || [];
        const historyChanged = JSON.stringify(history) !== JSON.stringify(before.telemetry[order.id.toUpperCase()] || []);
        if (Object.keys(position).length || historyChanged) tx.merge('gps_tracking', order.id, plain({
          ...(Object.keys(position).length ? { position } : {}), ...(historyChanged ? { history } : {})
        }));
      }
      const present = new Set(after.orders.map(o => o.id));
      for (const order of before.orders) if (!present.has(order.id)) tx.remove('regional_orders', order.id);
      const oldSessions = new Map(before.sessions.map(s => [s.chatId, s]));
      for (const session of after.sessions) {
        const changed = diff(oldSessions.get(session.chatId), session);
        if (Object.keys(changed).length) tx.merge('driver_sessions', String(session.chatId), changed);
      }
      const active = new Set(after.sessions.map(s => s.chatId));
      for (const session of before.sessions) if (!active.has(session.chatId)) tx.remove('driver_sessions', String(session.chatId));
      if (options.updateId !== undefined) tx.merge('bot_state', 'telegram', { lastUpdateId: options.updateId });
      committedEffects = effects;
      return result;
    });
    for (const effect of committedEffects) effect();
    return value;
  });
  tail = run.catch(() => {});
  return run;
}

// Send HTTP responses only after the database transaction commits.
export function tracked(handler: (req: any, res: Response) => unknown): RequestHandler {
  return (req, res) => {
    let status = 200, body: any;
    const aborted = new Error('HTTP response rejected transaction');
    const proxy = Object.create(res);
    proxy.setHeader = res.setHeader.bind(res);
    proxy.status = (code: number) => { status = code; return proxy; };
    proxy.json = (data: any) => { body = data; return proxy; };
    void withFirebaseTracking(async () => { await handler(req, proxy); if (status >= 400) throw aborted; }, {
      orderLookup: req.method === 'GET' ? (req.params.orderId || req.params.id) : undefined
    }).then(() => res.status(status).json(body)).catch(error => {
      if (error === aborted) return res.status(status).json(body);
      console.warn('[Firebase tracking] Transaction failed:', error?.code || 'unavailable');
      return res.status(503).json({ error: 'Firebase временно недоступна. Данные не заменены локальными записями.' });
    });
  };
}
