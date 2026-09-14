export interface GpsTrailPoint {
  lat: number;
  lng: number;
  timestamp?: string;
  accuracy?: number;
}

const radians = (degrees: number) => degrees * Math.PI / 180;
function distanceMeters(a: GpsTrailPoint, b: GpsTrailPoint) {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// These are drawing limits, not a filter on saved GPS. Sparse or uncertain
// observations remain visible as points; they do not prove a path between them.
function canConnect(a: GpsTrailPoint, b: GpsTrailPoint) {
  const elapsed = Date.parse(b.timestamp || '') - Date.parse(a.timestamp || '');
  if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > 120000) return false;
  if ([a, b].some(point => point.accuracy !== undefined &&
    (!Number.isFinite(point.accuracy) || point.accuracy < 0 || point.accuracy > 200))) return false;
  const distance = distanceMeters(a, b);
  // Even a plausible long chord could cut across several streets. Small GPS
  // noise has a 50 m allowance; larger jumps must be possible below 160 km/h.
  return distance <= 1000 && distance <= 50 + 160 / 3.6 * elapsed / 1000;
}

export function splitGpsTrail<T extends GpsTrailPoint>(history: readonly T[]): T[][] {
  const segments: T[][] = [];
  let segment: T[] | undefined;
  for (const point of history) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
      Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      segment = undefined;
      continue;
    }
    if (!segment || !canConnect(segment[segment.length - 1], point)) {
      segment = [];
      segments.push(segment);
    }
    segment.push(point);
  }
  return segments;
}
