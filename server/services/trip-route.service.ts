import fs from 'node:fs';
import path from 'node:path';
import * as turf from '@turf/turf';
import type { LocationPoint } from './storage.service.js';
import { broadcastRealtimeEvent } from '../routes/realtime.routes.js';

type Point = Pick<LocationPoint, 'lat' | 'lng'>;
export interface TripRoadRoute { key: string; points: Point[]; distanceKm: number; }
const cachePath = path.join(process.cwd(), 'server/data/gps_routes.json');
const cache = new Map<string, TripRoadRoute>();
const pending = new Set<string>();
const retryAfter = new Map<string, number>();
try {
  const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const [id, route] of Object.entries(saved)) cache.set(id, route as TripRoadRoute);
} catch { /* Routes are generated on demand. */ }

export const routeKey = (origin: Point, destination: Point) =>
  `${origin.lat},${origin.lng}:${destination.lat},${destination.lng}`;

function withEndpoints(origin: Point, destination: Point, points: Point[]) {
  // Routing engines snap to the road; preserve the device's exact start marker.
  return [{ lat: origin.lat, lng: origin.lng }, ...points, { lat: destination.lat, lng: destination.lng }]
    .filter((p, i, all) => i === 0 || p.lat !== all[i - 1].lat || p.lng !== all[i - 1].lng);
}

export function buildApproximateRoute(origin: Point, destination: Point, highway: Point[] = []): Point[] {
  if (highway.length < 2) return withEndpoints(origin, destination, []);
  const line = turf.lineString(highway.map(p => [p.lng, p.lat]));
  const start = turf.nearestPointOnLine(line, turf.point([origin.lng, origin.lat]));
  const end = turf.nearestPointOnLine(line, turf.point([destination.lng, destination.lat]));
  if ((start.properties.dist ?? 0) > 50 || (end.properties.dist ?? 0) > 50) return withEndpoints(origin, destination, []);
  const points = turf.lineSlice(start, end, line).geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  if ((start.properties.location ?? 0) > (end.properties.location ?? 0)) points.reverse();
  return withEndpoints(origin, destination, points);
}

export async function fetchTripRoadRoute(origin: Point, destination: Point, fetcher: typeof fetch = fetch): Promise<TripRoadRoute> {
  const base = (process.env.OSRM_ROUTE_URL || 'https://router.project-osrm.org/route/v1/driving').replace(/\/$/, '');
  const url = `${base}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=false`;
  const response = await fetcher(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('Route provider unavailable');
  const result = await response.json();
  const route = result.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (result.code !== 'Ok' || !Array.isArray(coordinates) || coordinates.length < 2 ||
      !Number.isFinite(route.distance) || !coordinates.every((p: any) => Array.isArray(p) &&
        Number.isFinite(p[0]) && Math.abs(p[0]) <= 180 && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90)) {
    throw new Error('Invalid route geometry');
  }
  const points = withEndpoints(origin, destination, coordinates.map(([lng, lat]: number[]) => ({ lat, lng })));
  return { key: routeKey(origin, destination), points, distanceKm: Math.round(turf.length(turf.lineString(points.map(p => [p.lng, p.lat]))) * 10) / 10 };
}

export function getTripRoadRoute(orderId: string, origin: Point, destination: Point, highway: Point[]) {
  const key = routeKey(origin, destination);
  const saved = cache.get(orderId);
  if (saved?.key === key && saved.points.length >= 2) return { ...saved, status: 'road' as const };
  const requestKey = `${orderId}:${key}`;
  if (process.env.GPS_ROUTE_PROVIDER_DISABLED !== 'true' && !pending.has(requestKey) && Date.now() >= (retryAfter.get(requestKey) || 0)) {
    pending.add(requestKey);
    void fetchTripRoadRoute(origin, destination).then(route => {
      cache.set(orderId, route);
      const tmp = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(cache)));
      fs.renameSync(tmp, cachePath);
      broadcastRealtimeEvent('route_updated', { orderId });
    }).catch(() => {
      retryAfter.set(requestKey, Date.now() + 60000);
    }).finally(() => pending.delete(requestKey));
  }
  const points = buildApproximateRoute(origin, destination, highway);
  return { key, points, distanceKm: 0, status: pending.has(requestKey) ? 'building' as const : 'approximate' as const };
}
