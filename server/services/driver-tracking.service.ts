import fs from 'node:fs';
import path from 'node:path';
import { storageService, type RegionalOrderRecord, type DriverSessionRecord, type LocationPoint } from './storage.service.js';
import { broadcastRealtimeEvent } from '../routes/realtime.routes.js';
import { emitTruckPositionUpdate, emitDeliveryEnded } from './socket.service.js';
import { calculateSpeedGeolib, calculateBearingTurf } from './gps-tracking-framework.service.js';
import { usesFirebase } from './tracking-context.js';

export type RegionalOrderSummary = RegionalOrderRecord;
export interface DriverLocation {
  orderId: string;
  driverPhone?: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  updatedAt: string;
  history?: LocationPoint[];
  hasRealGps?: boolean;
  isTrackingActive?: boolean;
  driverConsent?: boolean;
  source?: RegionalOrderRecord['trackingSource'];
}

export class TrackingError extends Error {
  constructor(message: string, public statusCode = 409) { super(message); }
}
export const isTerminalOrder = (order?: RegionalOrderRecord) =>
  !order || ['delivered', 'cancelled'].includes(order.status);

export function getActiveOrdersList() { return storageService.getUniqueOrders(); }
export function linkOrderNumberToId(_id: string, _number: string) {
  // Storage resolves the exact ID and order number to the same record.
}

// Legacy clients may supply orders. Existing server records, including consent and
// terminal status, are authoritative; a stale browser must never reopen a trip.
export function syncActiveOrders(orders: RegionalOrderRecord[]) {
  for (const order of orders) {
    if (order.id && order.orderNumber && order.destinationCity &&
        !storageService.getOrder(order.id) && !storageService.getOrder(order.orderNumber)) {
      storageService.saveOrder(order);
    }
  }
}

function publishOrder(order: RegionalOrderRecord) {
  broadcastRealtimeEvent('order_updated', { ...order, orderNumberOrId: order.id });
}

export function stopOrderTracking(orderId: string) {
  const order = storageService.getOrder(orderId);
  if (!order) return;
  const updated = storageService.saveOrder({ ...order, isTrackingActive: false, speed: 0,
    trackingStoppedAt: new Date().toISOString() });
  for (const session of storageService.getAllSessions()) {
    if (session.orderId === order.id || session.orderNumber === order.orderNumber) {
      storageService.deleteSession(session.chatId);
    }
  }
  publishOrder(updated);
  return updated;
}

export function updateCachedOrderStatus(id: string, status: string, extra?: Partial<RegionalOrderRecord>) {
  const order = storageService.getOrder(id);
  if (!order) return;
  const updated = storageService.updateOrderStatus(order.id, status as RegionalOrderRecord['status'], extra)!;
  if (isTerminalOrder(updated)) return stopOrderTracking(updated.id);
  publishOrder(updated);
  return updated;
}

export function completeDriverTrip(orderId: string, chatId?: number) {
  const order = storageService.getOrder(orderId);
  if (!order) throw new TrackingError('Заявка не найдена.', 404);
  if (chatId !== undefined) {
    const session = storageService.getSession(chatId);
    if (!session?.driverConsent || session.orderId !== order.id) {
      throw new TrackingError('Эта кнопка относится к другому или уже завершённому рейсу.', 403);
    }
  }
  if (order.status === 'cancelled') throw new TrackingError('Заявка отменена.');
  const updated = updateCachedOrderStatus(order.id, 'delivered', {
    deliveredAt: order.deliveredAt || new Date().toISOString(), speed: 0,
    isTrackingActive: false
  })!;
  broadcastRealtimeEvent('order_completed', { orderId: order.id, orderNumber: order.orderNumber,
    status: 'delivered', deliveredAt: updated.deliveredAt });
  emitDeliveryEnded(order.id, order.orderNumber);
  return updated;
}

export function getAvailableOrdersForDriver(_driver?: string, chatId?: number) {
  return getActiveOrdersList().filter(order => !isTerminalOrder(order) &&
    !storageService.getAllSessions().some(session => session.chatId !== chatId &&
      session.driverConsent && session.orderId === order.id));
}

export function getDriverSession(chatId: number) {
  const session = storageService.getSession(chatId);
  const order = session && storageService.getOrder(session.orderId);
  return session?.driverConsent && !isTerminalOrder(order) ? session : undefined;
}

export function consentToTrip(chatId: number, orderId: string, driverName: string, consentAt = new Date().toISOString()) {
  const order = storageService.getOrder(orderId);
  if (isTerminalOrder(order)) throw new TrackingError('Этот рейс уже недоступен.');
  const current = getDriverSession(chatId);
  if (current && current.orderId !== order!.id) {
    throw new TrackingError(`Сначала завершите текущий рейс ${current.orderNumber}.`);
  }
  if (!getAvailableOrdersForDriver(driverName, chatId).some(item => item.id === order!.id)) {
    throw new TrackingError('Этот рейс уже принят другим водителем.');
  }
  // Repeated consent buttons must not reset an already running live stream.
  if (current) return current;
  const session: DriverSessionRecord = { chatId, orderId: order!.id,
    orderNumber: order!.orderNumber, driverName, driverConsent: true, consentAt,
    tripActive: false, startedAt: consentAt, lastUpdated: consentAt };
  storageService.saveSession(session);
  updateCachedOrderStatus(order!.id, order!.status === 'dispatched' ? 'dispatched' : 'assigned', {
    assignedDriver: driverName, driverConsent: true, driverConsentAt: consentAt,
    isTrackingActive: false
  });
  return session;
}

// Restore only explicitly recorded GPS. A status change or warehouse position
// without a device timestamp is never evidence of a driver location.
export function getSavedDriverLocation(orderId: string): DriverLocation | undefined {
  const order = storageService.getOrder(orderId);
  if (!order) return;
  if (order.hasRealGps && validCoordinates(order.currentLat, order.currentLng) && order.lastGpsUpdate) {
    return { orderId: order.id, lat: order.currentLat!, lng: order.currentLng!, speed: order.speed,
      heading: order.heading, updatedAt: order.lastGpsUpdate, hasRealGps: true,
      isTrackingActive: order.isTrackingActive, driverConsent: order.driverConsent,
      source: order.trackingSource };
  }
  // Compatibility with sessions recorded by the previous version.
  if (usesFirebase()) return;
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'server/data/driver_locations.json'), 'utf8'));
    const saved = cached[order.id] || cached[order.orderNumber] || cached[order.id.toLowerCase()] || cached[order.orderNumber.toLowerCase()];
    if (saved?.hasRealGps && order.driverConsent && validCoordinates(saved.lat, saved.lng) && saved.updatedAt) return saved;
  } catch { /* No legacy cache. */ }
}

export function validCoordinates(lat: unknown, lng: unknown): boolean {
  return typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

export function getTrackingStartLocation(orderId: string): LocationPoint | undefined {
  const order = storageService.getOrder(orderId);
  if (!order) return;
  if (order.trackingStartLocation && validCoordinates(order.trackingStartLocation.lat, order.trackingStartLocation.lng)) {
    return order.trackingStartLocation;
  }
  const saved = getSavedDriverLocation(order.id);
  if (!saved?.hasRealGps) return;
  const history = [...storageService.getTelemetry(order.id), ...storageService.getTelemetry(order.orderNumber), ...(saved.history || [])];
  const consentTime = order.driverConsentAt ? Math.floor(Date.parse(order.driverConsentAt) / 1000) * 1000 : 0;
  const first = history.filter(p => validCoordinates(p.lat, p.lng) &&
    (!consentTime || (p.timestamp && Date.parse(p.timestamp) >= consentTime)))
    .sort((a, b) => Date.parse(a.timestamp || saved.updatedAt) - Date.parse(b.timestamp || saved.updatedAt))[0];
  const origin = first ? { lat: first.lat, lng: first.lng, timestamp: first.timestamp } :
    { lat: saved.lat, lng: saved.lng, timestamp: saved.updatedAt };
  // Migrate existing trips once; the start must survive a bounded telemetry trail.
  storageService.saveOrder({ ...order, trackingStartLocation: origin });
  return origin;
}

export function updateDriverLocation(location: DriverLocation, _status?: string): DriverLocation {
  const order = storageService.getOrder(location.orderId);
  if (!order) throw new TrackingError('Заявка не найдена.', 404);
  if (isTerminalOrder(order)) throw new TrackingError('Рейс завершён. Приём геопозиции остановлен.');
  if (!order.driverConsent) throw new TrackingError('Сначала выберите рейс и подтвердите согласие в Telegram-боте.', 403);
  if (!validCoordinates(location.lat, location.lng) ||
      (location.accuracy !== undefined && (!Number.isFinite(location.accuracy) || location.accuracy < 0 || location.accuracy > 1500))) {
    throw new TrackingError('Некорректные координаты GPS.', 400);
  }
  const timestamp = Date.parse(location.updatedAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60000) throw new TrackingError('Некорректное время GPS.', 400);
  const previous = getSavedDriverLocation(order.id);
  if (previous && (timestamp < Date.parse(previous.updatedAt) ||
      (timestamp === Date.parse(previous.updatedAt) && previous.source !== 'telegram_static'))) return previous;
  const speed = calculateSpeedGeolib(previous && { ...previous, timestamp: previous.updatedAt },
    { ...location, timestamp: location.updatedAt }, location.speed);
  const heading = Number.isFinite(location.heading) ? location.heading! % 360 :
    previous ? calculateBearingTurf(previous, location) : 0;
  const source = location.source || 'web';
  const isTrackingActive = location.isTrackingActive !== false;
  const trackingStartLocation = getTrackingStartLocation(order.id) ||
    { lat: location.lat, lng: location.lng, timestamp: location.updatedAt };
  const history = storageService.appendTelemetryPoint(order.id, { lat: location.lat, lng: location.lng,
    speed, heading, accuracy: location.accuracy, timestamp: location.updatedAt });
  const updated = updateCachedOrderStatus(order.id, isTrackingActive ? 'dispatched' : order.status, {
    currentLat: location.lat, currentLng: location.lng, speed, heading, lastGpsUpdate: location.updatedAt,
    hasRealGps: true, isTrackingActive, trackingSource: source, trackingStartLocation
  })!;
  const result: DriverLocation = { ...location, orderId: order.id, speed, heading, history,
    hasRealGps: true, isTrackingActive, driverConsent: true };
  const payload = { ...result, orderNumber: order.orderNumber, truckNumber: order.assignedTruckPlate,
    assignedDriver: order.assignedDriver, status: updated.status };
  broadcastRealtimeEvent('telemetry_update', payload);
  emitTruckPositionUpdate(payload);
  return result;
}

export interface TelegramLocationMessage {
  message_id: number;
  date: number;
  edit_date?: number;
  chat: { id: number; type?: string };
  from?: { id?: number; username?: string; first_name?: string; last_name?: string };
  location: { latitude: number; longitude: number; live_period?: number; heading?: number; horizontal_accuracy?: number };
}

export function acceptTelegramLocation(msg: TelegramLocationMessage, edited: boolean) {
  const session = getDriverSession(msg.chat.id);
  if (!session) return { kind: 'no_session' as const };
  const order = storageService.getOrder(session.orderId)!;
  const timestamp = new Date((msg.edit_date || msg.date) * 1000).toISOString();
  const legacyStream = session.tripActive && !session.consentAt && session.liveMessageId === undefined;
  // Bind a live message to its trip; old messages must not follow a driver to the next trip.
  if (!legacyStream && msg.date * 1000 < Math.floor(Date.parse(session.consentAt || session.startedAt || session.lastUpdated) / 1000) * 1000) return { kind: 'ignored' as const };
  if (edited && session.liveMessageId === undefined && !legacyStream) return { kind: 'ignored' as const };
  if (edited && session.liveMessageId !== undefined && msg.message_id !== session.liveMessageId) return { kind: 'ignored' as const };
  if (session.lastLocationAt && (timestamp < session.lastLocationAt ||
      (timestamp === session.lastLocationAt && (edited || msg.message_id === session.liveMessageId)))) return { kind: 'ignored' as const };
  const livePeriod = msg.location.live_period;
  const isLive = typeof livePeriod === 'number' && livePeriod > 0;
  if (edited && !isLive) {
    // Telegram removes live_period when the driver stops sharing.
    if (session.liveMessageId !== msg.message_id) return { kind: 'ignored' as const };
    storageService.saveSession({ ...session, tripActive: false, lastLocationAt: timestamp, lastUpdated: timestamp });
    updateCachedOrderStatus(order.id, order.status, { isTrackingActive: false, speed: 0 });
    return { kind: 'stopped' as const, order };
  }
  if (!isLive && session.tripActive) return { kind: 'ignored' as const };
  const expiresAt = isLive && livePeriod !== 0x7fffffff ? new Date((msg.date + livePeriod!) * 1000).toISOString() : undefined;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) return { kind: 'ignored' as const };
  const firstLive = isLive && (!session.tripActive || session.liveMessageId !== msg.message_id);
  const location = updateDriverLocation({ orderId: order.id, lat: msg.location.latitude, lng: msg.location.longitude,
    heading: msg.location.heading, accuracy: msg.location.horizontal_accuracy, updatedAt: timestamp,
    driverPhone: msg.from?.username || `id:${msg.chat.id}`, source: isLive ? 'telegram_live' : 'telegram_static',
    isTrackingActive: isLive });
  storageService.saveSession({ ...session, tripActive: isLive, lastLocationAt: timestamp, lastUpdated: timestamp,
    ...(isLive ? { liveMessageId: msg.message_id, liveStartedAt: msg.date, liveExpiresAt: expiresAt } : {}) });
  const latest = storageService.getOrder(order.id)!;
  storageService.saveOrder({ ...latest, liveLocationExpiresAt: expiresAt });
  return { kind: isLive ? 'live' as const : 'static' as const, firstLive, order: latest, location };
}
