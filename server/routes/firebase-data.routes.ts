import { Router, type RequestHandler } from 'express';
import crypto from 'node:crypto';
import { db, admin } from '../config/firebase.js';
import { getCrmUser, requireSignedIn, requireAdmin, requireSameOrigin } from '../services/crm-auth.service.js';
import { broadcastRealtimeEvent } from './realtime.routes.js';
const router = Router();
router.use(requireSignedIn);
const clean = (data: any) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
const normalize = (data: any): any => {
  if (data?.toDate instanceof Function) return data.toDate().toISOString();
  if (Array.isArray(data)) return data.map(normalize);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, normalize(value)]));
  return data;
};
const wrap = (handler: (req: any, res: any) => Promise<unknown>): RequestHandler => (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  void handler(req, res).catch(error => {
    console.warn('[Firebase CRM]', error?.code || 'unavailable');
    res.status(503).json({ error: 'Не удалось выполнить запрос к Firebase. Локальная копия не используется.' });
  });
};
const logistics: RequestHandler = (req, res, next) => {
  if (!['admin', 'logistics'].includes(getCrmUser(req)?.role || '')) return void res.status(403).json({ error: 'Недостаточно прав.' });
  next();
};
for (const [endpoint, collection, event, permission] of [
  ['shipments', 'shipments', 'shipment', logistics],
  ['saved-trucks', 'saved_trucks', 'truck', requireSignedIn],
  ['delivery-contacts', 'saved_delivery_contacts', 'contact', requireSignedIn],
  ['users', 'users', 'user', requireAdmin]
] as const) {
  const read = endpoint === 'users' ? requireAdmin : requireSignedIn;
  const document = (snap: any) => ({ ...normalize(snap.data()), [endpoint === 'users' ? 'uid' : 'id']: snap.id });
  router.get('/' + endpoint, read, wrap(async (_req, res) => res.json((await db.collection(collection).get()).docs.map(document))));
  router.get('/' + endpoint + '/:id', read, wrap(async (req, res) => {
    const snap = await db.collection(collection).doc(req.params.id).get();
    return snap.exists ? res.json(document(snap)) : res.status(404).json({ error: 'Запись не найдена.' });
  }));
  const save = wrap(async (req, res) => {
    const id = req.params.id || req.body[endpoint === 'users' ? 'uid' : 'id'] || crypto.randomUUID();
    if (typeof id !== 'string' || id.includes('/')) return res.status(400).json({ error: 'Некорректный идентификатор.' });
    const ref = db.collection(collection).doc(id);
    const data = clean({ ...req.body, [endpoint === 'users' ? 'uid' : 'id']: id,
      ...(endpoint === 'shipments' ? { last_updated: new Date().toISOString() } : {}) });
    // Merge edits into the existing document; never recreate/reset the collection.
    await ref.set(data, { merge: true });
    const saved = document(await ref.get());
    broadcastRealtimeEvent(event + (req.method === 'POST' && endpoint === 'shipments' ? '_created' : '_updated'), saved);
    return res.status(req.method === 'POST' ? 201 : 200).json(saved);
  });
  router.post('/' + endpoint, requireSameOrigin, permission, save);
  router.put('/' + endpoint + '/:id', requireSameOrigin, permission, save);
  router.delete('/' + endpoint + '/:id', requireSameOrigin, permission, wrap(async (req, res) => {
    if (endpoint === 'shipments' && getCrmUser(req)?.role !== 'admin') {
      const existing = await db.collection(collection).doc(req.params.id).get();
      if (existing.data()?.createdBy !== getCrmUser(req)?.uid) return res.status(403).json({ error: 'Можно удалить только свою перевозку.' });
    }
    await db.collection(collection).doc(req.params.id).delete();
    const result = { success: true, [endpoint === 'users' ? 'uid' : 'id']: req.params.id };
    broadcastRealtimeEvent(event + '_deleted', result);
    return res.json(result);
  }));
}
router.get('/shipments/:id/logs', wrap(async (req, res) => {
  const snapshots = await db.collection('shipments').doc(req.params.id).collection('logs').get();
  res.json(snapshots.docs.map(doc => ({ ...normalize(doc.data()), id: doc.id, shipmentId: req.params.id })));
}));
router.post('/shipments/:id/logs', requireSameOrigin, logistics, wrap(async (req, res) => {
  const ref = db.collection('shipments').doc(req.params.id).collection('logs').doc();
  const log = clean({ ...req.body, id: ref.id, shipmentId: req.params.id, timestamp: new Date().toISOString() });
  await ref.create(log);
  broadcastRealtimeEvent('shipment_log_added', log);
  res.status(201).json(log);
}));
router.post('/upload', requireSameOrigin, logistics, wrap(async (req, res) => {
  const { fileName = 'document.bin', fileData, fileType = 'application/octet-stream' } = req.body;
  if (typeof fileData !== 'string') return res.status(400).json({ error: 'Нет файла.' });
  const name = String(fileName).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]/g, '_').slice(-100);
  const filePath = 'documents/' + crypto.randomUUID() + '/' + name;
  const file = admin.storage().bucket().file(filePath);
  const downloadToken = crypto.randomUUID();
  const buffer = Buffer.from(fileData.replace(/^data:[^,]+,/, ''), 'base64');
  await file.save(buffer, { resumable: false, contentType: fileType,
    metadata: { contentDisposition: 'attachment', metadata: { firebaseStorageDownloadTokens: downloadToken } } });
  const url = 'https://firebasestorage.googleapis.com/v0/b/' + file.bucket.name + '/o/' + encodeURIComponent(filePath) + '?alt=media&token=' + downloadToken;
  return res.status(201).json({ success: true, url, fileName, fileSize: buffer.length });
}));
export default router;
