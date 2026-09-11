import { tracked } from '../services/firebase-tracking.service.js';
import { Router } from 'express';
import { updateDriverLocation, getDriverLocation, getActiveOrdersList, completeDriverTrip,
  getTelegramBotStatus, TrackingError, syncActiveOrders } from '../services/telegram.service.js';
import { storageService } from '../services/storage.service.js';
import { requireAdmin, isCrmAdmin } from '../services/crm-auth.service.js';
import { withoutGps } from '../services/gps-access.service.js';
import crypto from 'node:crypto';
import { processTelegramUpdate } from '../services/telegram-bot.service.js';
import { requireSignedIn } from '../services/crm-auth.service.js';
import { usesFirebase } from '../services/tracking-context.js';
import { prepareTripRoadRoute } from '../services/trip-route.service.js';
import { inspectTelegramWebhook } from '../services/telegram-bot.service.js';

const router = Router();
router.post('/telegram/webhook', async (req, res) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const supplied = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
  const actualBytes = Buffer.from(supplied), expectedBytes = Buffer.from(expected || '');
  if (!expected || actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return res.sendStatus(403);
  if (!Number.isInteger(req.body?.update_id)) return res.sendStatus(400);
  try { await processTelegramUpdate(req.body); return res.json({ ok: true }); }
  catch { return res.status(503).json({ error: 'Retry update' }); }
});
const fail = (res: any, error: unknown) => res.status(error instanceof TrackingError ? error.statusCode : 500)
  .json({ error: error instanceof Error ? error.message : 'Ошибка GPS' });

router.get('/bot-status', requireAdmin, async (_req, res) => res.json(await inspectTelegramWebhook()));
router.get('/orders', requireSignedIn, tracked((req, res) => res.json(isCrmAdmin(req) ? getActiveOrdersList() : withoutGps(getActiveOrdersList()))));
// Driver screen needs trip metadata, never another driver's coordinates/history.
router.get('/trip/:orderId', tracked((req, res) => {
  const order = storageService.getOrder(req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Заявка не найдена.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ orderNumber: order.orderNumber, destinationCity: order.destinationCity,
    originCity: order.originCity, status: order.status });
}));
// Compatibility for older clients; existing local orders stay authoritative.
router.post('/sync-orders', requireAdmin, tracked((req, res) => {
  if (usesFirebase()) return res.status(410).json({ error: 'Заявки читаются из Firebase. Загрузка локальной копии отключена.' });
  if (!Array.isArray(req.body.orders)) return res.status(400).json({ error: 'orders must be an array' });
  syncActiveOrders(req.body.orders);
  return res.json({ success: true, count: req.body.orders.length, pendingUpdates: [] });
}));
router.get('/pending-sync', tracked((_req, res) => res.json({ pending: [] })));
router.post('/ack-sync', tracked((_req, res) => res.json({ success: true })));

router.post('/location', tracked((req, res) => {
  try {
    const { orderId, lat, lng, speed, heading, accuracy, timestamp, driverPhone } = req.body;
    if (typeof orderId !== 'string' || !orderId) throw new TrackingError('Не выбрана заявка.', 400);
    if (speed !== undefined && (!Number.isFinite(speed) || speed < 0 || speed > 200)) throw new TrackingError('Некорректная скорость.', 400);
    if (heading !== undefined && (!Number.isFinite(heading) || heading < 0 || heading > 360)) throw new TrackingError('Некорректное направление.', 400);
    const location = updateDriverLocation({ orderId, lat, lng, speed, heading, accuracy, driverPhone,
      updatedAt: timestamp || new Date().toISOString(), source: 'web', isTrackingActive: true });
    return res.json({ success: true, acceptedAt: location.updatedAt });
  } catch (error) { return fail(res, error); }
}));

router.post('/complete', tracked((req, res) => {
  try {
    const id = req.body.orderId || req.body.orderNumber;
    if (typeof id !== 'string' || !id) throw new TrackingError('Не выбрана заявка.', 400);
    const order = completeDriverTrip(id);
    return res.json({ success: true, orderId: order.id, status: order.status });
  } catch (error) { return fail(res, error); }
}));

router.get('/location/:orderId', requireAdmin, tracked(async (req, res) => {
  try {
    const order = storageService.getOrder(req.params.orderId);
    if (!order) throw new TrackingError('Заявка не найдена.', 404);
    res.setHeader('Cache-Control', 'no-store');
    const route = getDriverLocation(order.id, order.destinationCity, order.orderNumber);
    if (route.routeWaypoints.length === 2) await prepareTripRoadRoute(order.id, route.routeWaypoints[0], route.routeWaypoints[1]);
    return res.json(getDriverLocation(order.id, order.destinationCity, order.orderNumber));
  } catch (error) { return fail(res, error); }
}));

export default router;
