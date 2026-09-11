import { storageService, type LocationPoint } from './storage.service.js';
import { getSavedDriverLocation, getTrackingStartLocation, validCoordinates } from './driver-tracking.service.js';
import { getTripRoadRoute } from './trip-route.service.js';
import { calculateRouteProgressTurf } from './gps-tracking-framework.service.js';
export * from './driver-tracking.service.js';
export * from './telegram-bot.service.js';
export type { LocationPoint };

export interface RouteProgress {
  orderId: string;
  orderNumber?: string;
  currentLat: number;
  currentLng: number;
  speed: number;
  heading?: number;
  originCity: string;
  destinationCity: string;
  totalDistanceKm: number;
  remainingDistanceKm: number;
  progressPercent: number;
  etaMinutes: number;
  etaFormatted: string;
  signalStatus: 'in_transit' | 'parked' | 'idle' | 'offline' | 'waiting' | 'delivered';
  signalStatusText: string;
  lastPingSecondsAgo?: number;
  updatedAt: string;
  routeWaypoints: Array<{ name: string; lat: number; lng: number; reached: boolean }>;
  detailedRoadPolyline: LocationPoint[];
  locationHistory: LocationPoint[];
  hasRealGps: boolean;
  isTrackingActive: boolean;
  driverConsent?: boolean;
  trackingSource?: string;
  liveLocationExpiresAt?: string;
  routeStatus: 'waiting' | 'building' | 'road' | 'approximate';
  trackingStartLocation?: LocationPoint;
}

import { KAZAKHSTAN_ROADS } from "../config/kazakhstanRoads.js";

// High-resolution Kazakhstan Highway Road Polylines (OSRM real asphalt road geometry)
export const DETAILED_HIGHWAYS: Record<string, LocationPoint[]> = KAZAKHSTAN_ROADS;

// Major Kazakhstan Highway Nodes
export const HIGHWAY_NODES: Record<string, { lat: number; lng: number; name: string }> = {
  almaty: { lat: 43.2389, lng: 76.8897, name: 'Алматы' },
  balkhash: { lat: 46.8481, lng: 74.9804, name: 'Балхаш' },
  karaganda: { lat: 49.8019, lng: 73.1021, name: 'Караганда' },
  astana: { lat: 51.1694, lng: 71.4491, name: 'Астана' },
  shymkent: { lat: 42.3417, lng: 69.5901, name: 'Шымкент' },
  taraz: { lat: 42.9000, lng: 71.3667, name: 'Тараз' },
};

// Haversine formula for distance between 2 coordinates in km
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export function getDriverLocation(
  orderId: string, 
  destinationCity: string = 'Астана',
  orderNumber?: string,
  orderStatus?: string,
  dispatchedAt?: string
): RouteProgress {
  const storedOrder = storageService.getOrder(orderId) || (orderNumber ? storageService.getOrder(orderNumber) : undefined);
  const saved = getSavedDriverLocation(storedOrder?.id || orderId);

  // Real telemetry history recorded directly from device
  const locationHistory: LocationPoint[] = storageService.getTelemetry(storedOrder?.id || orderId).slice();
  if (locationHistory.length === 0 && orderNumber) {
    const numHistory = storageService.getTelemetry(orderNumber);
    if (numHistory.length > 0) {
      locationHistory.push(...numHistory);
    }
  }
  if (locationHistory.length === 0 && saved && validCoordinates(saved.lat, saved.lng)) {
    locationHistory.push({
      lat: saved.lat,
      lng: saved.lng,
      speed: saved.speed ?? 0,
      timestamp: saved.updatedAt
    });
  }

  const effectiveDestCity = storedOrder?.destinationCity || destinationCity || 'Астана';
  
  // Resolve destination coordinates
  const destKey = Object.keys(HIGHWAY_NODES).find(k => 
    effectiveDestCity.toLowerCase().includes(k) || HIGHWAY_NODES[k].name.toLowerCase() === effectiveDestCity.toLowerCase()
  ) || 'astana';
  
  const destNode = HIGHWAY_NODES[destKey] || HIGHWAY_NODES.astana;
  const trackingStartLocation = getTrackingStartLocation(storedOrder?.id || orderId);
  const origin = trackingStartLocation || destNode;
  const highway = DETAILED_HIGHWAYS[destKey] || (destKey === 'taraz' ? DETAILED_HIGHWAYS.shymkent : DETAILED_HIGHWAYS.astana);
  const roadRoute = trackingStartLocation ? getTripRoadRoute(storedOrder?.id || orderId, origin, destNode, highway) : undefined;
  const detailedRoadPolyline = roadRoute?.points || [];
  const waypoints = trackingStartLocation ? [
    { name: 'Старт GPS', lat: origin.lat, lng: origin.lng, reached: true },
    { name: destNode.name, lat: destNode.lat, lng: destNode.lng, reached: storedOrder?.status === 'delivered' }
  ] : [];

  // Status-aware position determination - 100% REAL, NO DEAD RECKONING
  const effectiveStatus = (storedOrder?.status || orderStatus || '').toLowerCase();
  const isDelivered = effectiveStatus === 'delivered' || effectiveStatus === 'доставлено';
  const isPending = effectiveStatus === 'new' || effectiveStatus === 'loading' || effectiveStatus === 'новый' || effectiveStatus === 'на погрузке';
  const driverConsent = storedOrder?.driverConsent === true;
  const hasRealGps = Boolean(saved?.hasRealGps && validCoordinates(saved.lat, saved.lng));
  const expired = Boolean(storedOrder?.liveLocationExpiresAt && Date.parse(storedOrder.liveLocationExpiresAt) <= Date.now());
  const isTrackingActive = Boolean(hasRealGps && !isDelivered && effectiveStatus !== 'cancelled' &&
    !expired && (storedOrder?.isTrackingActive ?? saved?.isTrackingActive));

  let currentLat = origin.lat;
  let currentLng = origin.lng;
  let speed = 0;
  let heading = 0;
  let signalStatus: 'in_transit' | 'parked' | 'idle' | 'offline' | 'waiting' | 'delivered' = 'waiting';
  let signalStatusText = 'Ожидание выезда';
  let lastPingSecondsAgo: number | undefined = undefined;

  if (isDelivered) {
    currentLat = saved?.lat ?? origin.lat;
    currentLng = saved?.lng ?? origin.lng;
    speed = 0;
    heading = 0;
    signalStatus = 'delivered';
    signalStatusText = 'Груз доставлен';
  } else if (hasRealGps && saved) {
    currentLat = saved.lat;
    currentLng = saved.lng;
    speed = isTrackingActive ? saved.speed ?? 0 : 0;
    heading = saved.heading ?? 0;

    const lastTime = saved.updatedAt ? new Date(saved.updatedAt).getTime() : Date.now();
    const elapsedMs = Math.max(0, Date.now() - lastTime);
    lastPingSecondsAgo = Math.round(elapsedMs / 1000);

    if (!isTrackingActive) {
      signalStatus = 'offline';
      signalStatusText = effectiveStatus === 'cancelled' ? 'Рейс отменён — GPS остановлен' :
        storedOrder?.trackingSource === 'telegram_static' ? 'Разовая точка — ожидается трансляция GPS' :
        expired ? 'Срок трансляции истёк — водитель должен продлить GPS' : 'Трансляция остановлена — последняя полученная точка';
    } else if (lastPingSecondsAgo <= 120) {
      if (speed > 5) {
        signalStatus = 'in_transit';
        signalStatusText = `🟢 В движении (${speed} км/ч)`;
      } else {
        signalStatus = 'parked';
        signalStatusText = `🟢 На связи (Стоянка)`;
      }
    } else if (lastPingSecondsAgo <= 600) {
      signalStatus = 'idle';
      speed = 0;
      const mins = Math.max(1, Math.round(lastPingSecondsAgo / 60));
      signalStatusText = `🟡 Нет новых координат (${mins} мин)`;
    } else {
      signalStatus = 'offline';
      speed = 0;
      const mins = Math.round(lastPingSecondsAgo / 60);
      signalStatusText = `🔴 Нет сигнала (${mins} мин. назад)`;
    }
  } else if (effectiveStatus === 'cancelled') {
    signalStatus = 'offline';
    signalStatusText = 'Рейс отменён — GPS остановлен';
  } else if (driverConsent) {
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
    signalStatus = 'waiting';
    signalStatusText = 'Водитель согласился (ожидание Live GPS)';
  } else if (isPending) {
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
    signalStatus = 'waiting';
    signalStatusText = 'На погрузке / Ожидает выезда';
  } else {
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
    signalStatus = 'waiting';
    signalStatusText = 'Ожидание запуска GPS-трансляции';
  }

  // Progress and ETA via Turf.js framework
  let totalDistance = trackingStartLocation ? calculateDistanceKm(origin.lat, origin.lng, destNode.lat, destNode.lng) : 0;
  let remainingDistance = isDelivered ? 0 : totalDistance;
  let progressPercent = isDelivered ? 100 : 0;
  let etaTotalMinutes = isDelivered ? 0 : Math.round((totalDistance / 70) * 60);

  if (hasRealGps && trackingStartLocation) {
    const turfProgress = calculateRouteProgressTurf(
      origin,
      destNode,
      { lat: currentLat, lng: currentLng },
      detailedRoadPolyline
    );
    totalDistance = turfProgress.totalDistanceKm;
    remainingDistance = isDelivered ? 0 : turfProgress.remainingDistanceKm;
    progressPercent = isDelivered ? 100 : turfProgress.progressPercent;
    etaTotalMinutes = isDelivered ? 0 : turfProgress.etaMinutes;
  }

  const hours = Math.floor(etaTotalMinutes / 60);
  const mins = etaTotalMinutes % 60;
  const etaFormatted = isDelivered 
    ? "Груз доставлен" 
    : !hasRealGps
      ? "Ожидает отправки" 
      : speed >= 30
        ? (hours > 0 ? `~${hours} ч ${mins} мин` : `~${mins} мин`)
        : (hours > 0 ? `~${hours} ч ${mins} мин (при 70 км/ч)` : `~${mins} мин`);

  return {
    orderId,
    orderNumber: orderNumber || storedOrder?.orderNumber,
    currentLat,
    currentLng,
    speed: isDelivered || !hasRealGps ? 0 : speed,
    heading: hasRealGps ? heading : 0,
    originCity: trackingStartLocation ? 'Старт GPS' : 'Ожидание GPS',
    destinationCity: destNode.name,
    totalDistanceKm: totalDistance,
    remainingDistanceKm: remainingDistance,
    progressPercent,
    etaMinutes: isDelivered || !hasRealGps ? 0 : etaTotalMinutes,
    etaFormatted,
    signalStatus,
    signalStatusText,
    lastPingSecondsAgo,
    updatedAt: saved ? saved.updatedAt : '',
    routeWaypoints: waypoints,
    detailedRoadPolyline,
    locationHistory,
    hasRealGps,
    isTrackingActive,
    driverConsent,
    trackingSource: storedOrder?.trackingSource,
    liveLocationExpiresAt: storedOrder?.liveLocationExpiresAt,
    routeStatus: roadRoute?.status || 'waiting',
    trackingStartLocation
  };
}
