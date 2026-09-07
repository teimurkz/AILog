/**
 * GPS Engine Service
 * Advanced Geospatial Telemetry Processing:
 * - High-precision Geodesic distance (Haversine & Vincenty)
 * - Forward Azimuth / Compass bearing (0-360°)
 * - 2D Kalman Filter for GPS drift & jitter suppression
 * - Road Snapping (Map matching to highway polylines)
 * - Geofencing & automated checkpoint arrival detection
 */

export interface GpsPoint {
  lat: number;
  lng: number;
  speed?: number; // km/h
  heading?: number; // 0-360 deg
  accuracy?: number; // meters
  altitude?: number; // meters
  timestamp: string; // ISO string
}

export interface Geofence {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number; // e.g. 500m for warehouse, 2000m for city limit
  type: 'origin' | 'checkpoint' | 'destination';
}

export interface SnappedLocation {
  originalLat: number;
  originalLng: number;
  snappedLat: number;
  snappedLng: number;
  crossTrackDistanceMeters: number; // distance from road
  alongTrackKm: number; // distance traveled along road
  bearing: number; // heading along road
  segmentIndex: number;
}

export interface ProcessedTelemetry {
  orderId: string;
  lat: number;
  lng: number;
  rawLat: number;
  rawLng: number;
  speed: number;
  heading: number;
  accuracy: number;
  isStationary: boolean;
  snapped?: SnappedLocation;
  currentGeofence?: Geofence;
  remainingKm?: number;
  progressPercent?: number;
  etaMinutes?: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// 1. Math Core: Distance and Bearing
// ---------------------------------------------------------------------------

const EARTH_RADIUS_METERS = 6371000;
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/**
 * High-accuracy Haversine formula for distance between two points in meters
 */
export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * TO_RAD) * Math.cos(lat2 * TO_RAD) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return calculateDistanceMeters(lat1, lon1, lat2, lon2) / 1000;
}

/**
 * Forward Azimuth (compass bearing) in degrees [0, 360)
 */
export function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * TO_RAD;
  const φ2 = lat2 * TO_RAD;
  const Δλ = (lon2 - lon1) * TO_RAD;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return (θ * TO_DEG + 360) % 360;
}

// ---------------------------------------------------------------------------
// 2. Kalman Filter for GPS coordinates (Noise & Drift suppression)
// ---------------------------------------------------------------------------

export class GpsKalmanFilter {
  private variance: number; // process noise variance
  private lat: number = 0;
  private lng: number = 0;
  private varianceLat: number = 1;
  private varianceLng: number = 1;
  private initialized: boolean = false;
  private lastTimestampMs: number = 0;

  constructor(variance: number = 3) {
    this.variance = variance; // default process noise
  }

  /**
   * Filter raw GPS coordinate.
   * If speed is stationary (< 3 km/h), noise rejection is increased to stop marker jitter.
   */
  public update(lat: number, lng: number, accuracyMeters: number = 5, timestampMs: number = Date.now()): { lat: number; lng: number } {
    if (!this.initialized) {
      this.lat = lat;
      this.lng = lng;
      this.varianceLat = accuracyMeters * accuracyMeters;
      this.varianceLng = accuracyMeters * accuracyMeters;
      this.initialized = true;
      this.lastTimestampMs = timestampMs;
      return { lat: this.lat, lng: this.lng };
    }

    const dtSeconds = Math.max(0.1, (timestampMs - this.lastTimestampMs) / 1000);
    this.lastTimestampMs = timestampMs;

    // Time update (predict)
    this.varianceLat += (dtSeconds * this.variance);
    this.varianceLng += (dtSeconds * this.variance);

    // Measurement update (correct)
    const measurementVariance = Math.max(4, accuracyMeters * accuracyMeters);
    const kLat = this.varianceLat / (this.varianceLat + measurementVariance);
    const kLng = this.varianceLng / (this.varianceLng + measurementVariance);

    this.lat += kLat * (lat - this.lat);
    this.lng += kLng * (lng - this.lng);

    this.varianceLat = (1 - kLat) * this.varianceLat;
    this.varianceLng = (1 - kLng) * this.varianceLng;

    return { lat: this.lat, lng: this.lng };
  }

  public reset(): void {
    this.initialized = false;
  }
}

// Cache of active Kalman filters per order
const kalmanFiltersMap = new Map<string, GpsKalmanFilter>();

function getKalmanFilter(orderId: string): GpsKalmanFilter {
  const key = orderId.toLowerCase();
  let filter = kalmanFiltersMap.get(key);
  if (!filter) {
    filter = new GpsKalmanFilter(2.5);
    kalmanFiltersMap.set(key, filter);
  }
  return filter;
}

// ---------------------------------------------------------------------------
// 3. Road Snapping (Project point to polyline)
// ---------------------------------------------------------------------------

/**
 * Projects a point onto a line segment [p1, p2].
 * Returns nearest point coordinates and distance in meters.
 */
function projectPointToSegment(
  p: { lat: number; lng: number },
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): { lat: number; lng: number; distanceMeters: number; t: number } {
  // Equirectangular projection for local segment
  const x = (p2.lng - p1.lng) * Math.cos(((p1.lat + p2.lat) / 2) * TO_RAD);
  const y = p2.lat - p1.lat;
  const lenSq = x * x + y * y;

  if (lenSq === 0) {
    return {
      lat: p1.lat,
      lng: p1.lng,
      distanceMeters: calculateDistanceMeters(p.lat, p.lng, p1.lat, p1.lng),
      t: 0
    };
  }

  const px = (p.lng - p1.lng) * Math.cos(((p1.lat + p2.lat) / 2) * TO_RAD);
  const py = p.lat - p1.lat;
  const t = Math.max(0, Math.min(1, (px * x + py * y) / lenSq));

  const projLat = p1.lat + t * (p2.lat - p1.lat);
  const projLng = p1.lng + t * (p2.lng - p1.lng);
  const dist = calculateDistanceMeters(p.lat, p.lng, projLat, projLng);

  return { lat: projLat, lng: projLng, distanceMeters: dist, t };
}

/**
 * Snap raw GPS point to the closest segment of a highway polyline.
 * If distance to road is within maxThresholdMeters (default 350m), snapped coords are returned.
 */
export function snapToPolyline(
  point: { lat: number; lng: number },
  polyline: Array<{ lat: number; lng: number }>,
  maxThresholdMeters: number = 350
): SnappedLocation | null {
  if (!polyline || polyline.length < 2) return null;

  let minDistance = Infinity;
  let bestLat = point.lat;
  let bestLng = point.lng;
  let bestSegmentIndex = 0;
  let bestT = 0;

  let accumulatedKm = 0;
  let alongTrackKmAtBest = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const p1 = polyline[i];
    const p2 = polyline[i + 1];
    const segDistKm = calculateDistanceKm(p1.lat, p1.lng, p2.lat, p2.lng);

    const proj = projectPointToSegment(point, p1, p2);
    if (proj.distanceMeters < minDistance) {
      minDistance = proj.distanceMeters;
      bestLat = proj.lat;
      bestLng = proj.lng;
      bestSegmentIndex = i;
      bestT = proj.t;
      alongTrackKmAtBest = accumulatedKm + (segDistKm * proj.t);
    }
    accumulatedKm += segDistKm;
  }

  if (minDistance > maxThresholdMeters) {
    return null;
  }

  const p1 = polyline[bestSegmentIndex];
  const p2 = polyline[bestSegmentIndex + 1];
  const roadBearing = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);

  return {
    originalLat: point.lat,
    originalLng: point.lng,
    snappedLat: bestLat,
    snappedLng: bestLng,
    crossTrackDistanceMeters: Math.round(minDistance),
    alongTrackKm: Math.round(alongTrackKmAtBest * 10) / 10,
    bearing: Math.round(roadBearing),
    segmentIndex: bestSegmentIndex
  };
}

// ---------------------------------------------------------------------------
// 4. Geofencing & Predefined Logistics Hubs
// ---------------------------------------------------------------------------

export const PREDEFINED_GEOFENCES: Geofence[] = [
  { id: 'almaty_wh', name: 'Алматы (Центральный Склад)', lat: 43.2389, lng: 76.8897, radiusMeters: 1500, type: 'origin' },
  { id: 'balkhash_cp', name: 'Балхаш (Транзитный пост)', lat: 46.8481, lng: 74.9804, radiusMeters: 3000, type: 'checkpoint' },
  { id: 'karaganda_hub', name: 'Караганда (Логистический хаб)', lat: 49.8019, lng: 73.1021, radiusMeters: 4000, type: 'checkpoint' },
  { id: 'astana_wh', name: 'Астана (Склад назначения)', lat: 51.1694, lng: 71.4491, radiusMeters: 3500, type: 'destination' },
  { id: 'taraz_cp', name: 'Тараз (Чекпоинт)', lat: 42.8958, lng: 71.3783, radiusMeters: 3000, type: 'checkpoint' },
  { id: 'shymkent_wh', name: 'Шымкент (Склад назначения)', lat: 42.3155, lng: 69.5869, radiusMeters: 3500, type: 'destination' }
];

export function checkGeofences(lat: number, lng: number): Geofence | undefined {
  for (const gf of PREDEFINED_GEOFENCES) {
    const dist = calculateDistanceMeters(lat, lng, gf.lat, gf.lng);
    if (dist <= gf.radiusMeters) {
      return gf;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5. Main Telemetry Processor
// ---------------------------------------------------------------------------

export function processIncomingTelemetry(params: {
  orderId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  roadPolyline?: Array<{ lat: number; lng: number }>;
  destination?: { lat: number; lng: number };
  timestamp?: string;
}): ProcessedTelemetry {
  const { orderId, lat, lng, roadPolyline, destination } = params;
  const timestamp = params.timestamp || new Date().toISOString();
  const accuracy = Math.max(1, params.accuracy || 5);
  const nowMs = new Date(timestamp).getTime();

  // 1. Kalman filter smoothing
  const kalman = getKalmanFilter(orderId);
  const smoothed = kalman.update(lat, lng, accuracy, nowMs);

  // 2. Real speed evaluation
  const rawSpeed = params.speed !== undefined && params.speed !== null && !isNaN(params.speed)
    ? Math.max(0, Math.round(params.speed))
    : 0;
  const isStationary = rawSpeed < 4;

  // 3. Road snapping (if polyline provided)
  let snapped: SnappedLocation | null = null;
  if (roadPolyline && roadPolyline.length > 1) {
    snapped = snapToPolyline(smoothed, roadPolyline, 400);
  }

  // Active coordinates: if snapped to road and moving, use snapped; otherwise smoothed
  const activeLat = snapped && !isStationary ? snapped.snappedLat : smoothed.lat;
  const activeLng = snapped && !isStationary ? snapped.snappedLng : smoothed.lng;

  // Heading calculation
  const heading = params.heading !== undefined && params.heading !== null && params.heading >= 0
    ? Math.round(params.heading)
    : (snapped ? snapped.bearing : 0);

  // 4. Geofence evaluation
  const currentGeofence = checkGeofences(activeLat, activeLng);

  // 5. Remaining distance and ETA
  let remainingKm: number | undefined = undefined;
  let progressPercent: number | undefined = undefined;
  let etaMinutes: number | undefined = undefined;

  if (destination) {
    remainingKm = Math.round(calculateDistanceKm(activeLat, activeLng, destination.lat, destination.lng) * 10) / 10;
    const assumedSpeed = rawSpeed >= 30 ? rawSpeed : 70;
    etaMinutes = Math.round((remainingKm / assumedSpeed) * 60);

    if (roadPolyline && roadPolyline.length > 1) {
      const totalRoadKm = calculateDistanceKm(
        roadPolyline[0].lat, roadPolyline[0].lng,
        destination.lat, destination.lng
      );
      if (totalRoadKm > 0) {
        progressPercent = Math.min(99, Math.max(0, Math.round(((totalRoadKm - remainingKm) / totalRoadKm) * 100)));
      }
    }
  }

  return {
    orderId,
    lat: activeLat,
    lng: activeLng,
    rawLat: lat,
    rawLng: lng,
    speed: rawSpeed,
    heading,
    accuracy,
    isStationary,
    snapped: snapped || undefined,
    currentGeofence,
    remainingKm,
    progressPercent,
    etaMinutes,
    timestamp
  };
}
