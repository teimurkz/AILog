import * as turf from '@turf/turf';
import * as geolib from 'geolib';

export interface TelemetryPoint {
  lat: number;
  lng: number;
  timestamp?: string;
  speed?: number; // km/h
  heading?: number; // degrees 0-360
  accuracy?: number; // meters
}

export interface SnappedPoint {
  lat: number;
  lng: number;
  snapped: boolean;
  distanceToRoadKm: number;
  distanceAlongRoadKm: number;
  originalLat: number;
  originalLng: number;
}

export interface ProcessedGpsFrame {
  orderId: string;
  lat: number;
  lng: number;
  rawLat: number;
  rawLng: number;
  speed: number;
  heading: number;
  accuracy: number;
  isStationary: boolean;
  snappedToRoad: boolean;
  distanceToRoadKm: number;
  remainingDistanceKm: number;
  totalDistanceKm: number;
  progressPercent: number;
  etaMinutes: number;
  timestamp: string;
}

/**
 * Validate latitude and longitude bounds using geolib
 */
export function validateCoordinates(lat: number, lng: number, accuracy?: number): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
    return false;
  }
  const isValid = geolib.isValidCoordinate({ latitude: lat, longitude: lng });
  if (!isValid) return false;
  // Reject coordinates with extremely poor accuracy (> 500m)
  if (accuracy !== undefined && accuracy > 500) {
    return false;
  }
  return true;
}

/**
 * Snap a GPS point to the nearest road polyline using Turf.js
 * If distance to road is <= maxSnapKm (default 15 km), snaps to road.
 * Otherwise, preserves real location (driver in town/motel/detour).
 */
export function snapToHighway(
  point: { lat: number; lng: number },
  polyline: Array<{ lat: number; lng: number }>,
  maxSnapKm: number = 15
): SnappedPoint {
  if (!polyline || polyline.length < 2) {
    return {
      lat: point.lat,
      lng: point.lng,
      snapped: false,
      distanceToRoadKm: 0,
      distanceAlongRoadKm: 0,
      originalLat: point.lat,
      originalLng: point.lng
    };
  }

  try {
    // Note: Turf uses [longitude, latitude] GeoJSON standard
    const turfPoint = turf.point([point.lng, point.lat]);
    const lineCoords = polyline.map(pt => [pt.lng, pt.lat]);
    const turfLine = turf.lineString(lineCoords);

    const nearest = turf.nearestPointOnLine(turfLine, turfPoint, { units: 'kilometers' });
    const distKm = nearest.properties.dist ?? 0;
    const locationKm = nearest.properties.location ?? 0;
    const snappedCoords = nearest.geometry.coordinates; // [lng, lat]

    if (distKm <= maxSnapKm) {
      return {
        lat: snappedCoords[1],
        lng: snappedCoords[0],
        snapped: true,
        distanceToRoadKm: Math.round(distKm * 100) / 100,
        distanceAlongRoadKm: Math.round(locationKm * 10) / 10,
        originalLat: point.lat,
        originalLng: point.lng
      };
    }

    return {
      lat: point.lat,
      lng: point.lng,
      snapped: false,
      distanceToRoadKm: Math.round(distKm * 100) / 100,
      distanceAlongRoadKm: Math.round(locationKm * 10) / 10,
      originalLat: point.lat,
      originalLng: point.lng
    };
  } catch (err) {
    console.warn('[GPS Framework] snapToHighway error:', err);
    return {
      lat: point.lat,
      lng: point.lng,
      snapped: false,
      distanceToRoadKm: 0,
      distanceAlongRoadKm: 0,
      originalLat: point.lat,
      originalLng: point.lng
    };
  }
}

/**
 * Calculate compass bearing between two points using Turf.js
 * Normalized to [0, 360) degrees
 */
export function calculateBearingTurf(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  try {
    const pt1 = turf.point([from.lng, from.lat]);
    const pt2 = turf.point([to.lng, to.lat]);
    const b = turf.bearing(pt1, pt2);
    return Math.round(((b % 360) + 360) % 360);
  } catch {
    return 0;
  }
}

/**
 * Calculate precise geodesic distance in kilometers using Geolib and Turf
 */
export function calculateDistanceKmTurf(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  try {
    const pt1 = turf.point([from.lng, from.lat]);
    const pt2 = turf.point([to.lng, to.lat]);
    return Math.round(turf.distance(pt1, pt2, { units: 'kilometers' }) * 10) / 10;
  } catch {
    const distMeters = geolib.getDistance(
      { latitude: from.lat, longitude: from.lng },
      { latitude: to.lat, longitude: to.lng }
    );
    return Math.round((distMeters / 1000) * 10) / 10;
  }
}

/**
 * Calculate actual vehicle speed using Geolib getSpeed and reported device speed
 */
export function calculateSpeedGeolib(
  prevPoint?: TelemetryPoint,
  currPoint?: TelemetryPoint,
  reportedSpeedKmh?: number
): number {
  if (reportedSpeedKmh !== undefined && !isNaN(reportedSpeedKmh) && reportedSpeedKmh >= 0) {
    const spd = Math.round(reportedSpeedKmh);
    return spd < 3 ? 0 : spd;
  }

  if (prevPoint && currPoint && prevPoint.timestamp && currPoint.timestamp) {
    const t1 = new Date(prevPoint.timestamp).getTime();
    const t2 = new Date(currPoint.timestamp).getTime();
    if (t2 > t1 && (t2 - t1) < 600000) { // within 10 minutes
      try {
        const speedMs = geolib.getSpeed(
          { latitude: prevPoint.lat, longitude: prevPoint.lng, time: t1 },
          { latitude: currPoint.lat, longitude: currPoint.lng, time: t2 }
        );
        const speedKmh = Math.round(speedMs * 3.6);
        return speedKmh < 3 ? 0 : Math.min(130, speedKmh);
      } catch {
        // ignore fallback
      }
    }
  }

  return 0;
}

/**
 * Calculate route progress percentage and remaining distance using Turf lineSlice
 */
export function calculateRouteProgressTurf(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  currentPoint: { lat: number; lng: number },
  highwayPolyline?: Array<{ lat: number; lng: number }>
): {
  totalDistanceKm: number;
  remainingDistanceKm: number;
  progressPercent: number;
  etaMinutes: number;
} {
  const directRemaining = calculateDistanceKmTurf(currentPoint, destination);
  const directTotal = calculateDistanceKmTurf(origin, destination);

  if (!highwayPolyline || highwayPolyline.length < 2) {
    const total = directTotal || 1;
    const progress = Math.min(99, Math.max(0, Math.round(((total - directRemaining) / total) * 100)));
    const assumedSpeed = 70;
    const eta = Math.round((directRemaining / assumedSpeed) * 60);
    return {
      totalDistanceKm: directTotal,
      remainingDistanceKm: directRemaining,
      progressPercent: progress,
      etaMinutes: eta
    };
  }

  try {
    const lineCoords = highwayPolyline.map(p => [p.lng, p.lat]);
    const fullLine = turf.lineString(lineCoords);
    const totalRoadKm = Math.round(turf.length(fullLine, { units: 'kilometers' }));

    const startPt = turf.point([origin.lng, origin.lat]);
    const currPt = turf.point([currentPoint.lng, currentPoint.lat]);
    const endPt = turf.point([destination.lng, destination.lat]);

    // Slice remaining portion of the highway
    const remainingSlice = turf.lineSlice(currPt, endPt, fullLine);
    const remainingRoadKm = Math.round(turf.length(remainingSlice, { units: 'kilometers' }));

    const effectiveRemaining = remainingRoadKm > 0 ? remainingRoadKm : directRemaining;
    const effectiveTotal = totalRoadKm > 0 ? totalRoadKm : directTotal;
    const progress = Math.min(99, Math.max(0, Math.round(((effectiveTotal - effectiveRemaining) / effectiveTotal) * 100)));
    const eta = Math.round((effectiveRemaining / 70) * 60);

    return {
      totalDistanceKm: effectiveTotal,
      remainingDistanceKm: effectiveRemaining,
      progressPercent: isNaN(progress) ? 0 : progress,
      etaMinutes: isNaN(eta) ? 0 : eta
    };
  } catch {
    const total = directTotal || 1;
    const progress = Math.min(99, Math.max(0, Math.round(((total - directRemaining) / total) * 100)));
    return {
      totalDistanceKm: directTotal,
      remainingDistanceKm: directRemaining,
      progressPercent: progress,
      etaMinutes: Math.round((directRemaining / 70) * 60)
    };
  }
}

/**
 * Main Frame Processor using Turf.js and Geolib
 */
export function processGpsTelemetryFrame(params: {
  orderId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp?: string;
  prevPoint?: TelemetryPoint;
  highwayPolyline?: Array<{ lat: number; lng: number }>;
  origin?: { lat: number; lng: number };
  destination?: { lat: number; lng: number };
}): ProcessedGpsFrame {
  const { orderId, lat, lng, highwayPolyline, origin, destination, prevPoint } = params;
  const timestamp = params.timestamp || new Date().toISOString();
  const accuracy = Math.max(1, params.accuracy || 5);

  // 1. Validate coordinates
  const isValid = validateCoordinates(lat, lng, accuracy);
  const safeLat = isValid ? lat : (prevPoint?.lat ?? lat);
  const safeLng = isValid ? lng : (prevPoint?.lng ?? lng);

  // 2. Road snapping via Turf.js
  let snappedLat = safeLat;
  let snappedLng = safeLng;
  let snappedToRoad = false;
  let distToRoadKm = 0;

  if (highwayPolyline && highwayPolyline.length > 1) {
    const snapResult = snapToHighway({ lat: safeLat, lng: safeLng }, highwayPolyline, 15);
    snappedLat = snapResult.lat;
    snappedLng = snapResult.lng;
    snappedToRoad = snapResult.snapped;
    distToRoadKm = snapResult.distanceToRoadKm;
  }

  // 3. Speed calculation via Geolib
  const calculatedSpeed = calculateSpeedGeolib(
    prevPoint,
    { lat: safeLat, lng: safeLng, timestamp },
    params.speed
  );
  const isStationary = calculatedSpeed < 4;

  // 4. Heading calculation via Turf.js
  let heading = params.heading !== undefined && params.heading >= 0
    ? Math.round(params.heading)
    : 0;

  if (heading === 0 && prevPoint && (prevPoint.lat !== safeLat || prevPoint.lng !== safeLng)) {
    heading = calculateBearingTurf(
      { lat: prevPoint.lat, lng: prevPoint.lng },
      { lat: safeLat, lng: safeLng }
    );
  }

  // 5. Route progress calculation via Turf.js
  const defaultOrigin = origin || { lat: 43.2389, lng: 76.8897 }; // Almaty
  const defaultDest = destination || { lat: 51.1694, lng: 71.4491 }; // Astana

  const progress = calculateRouteProgressTurf(
    defaultOrigin,
    defaultDest,
    { lat: snappedLat, lng: snappedLng },
    highwayPolyline
  );

  return {
    orderId,
    lat: snappedLat,
    lng: snappedLng,
    rawLat: lat,
    rawLng: lng,
    speed: calculatedSpeed,
    heading,
    accuracy,
    isStationary,
    snappedToRoad,
    distanceToRoadKm: distToRoadKm,
    remainingDistanceKm: progress.remainingDistanceKm,
    totalDistanceKm: progress.totalDistanceKm,
    progressPercent: progress.progressPercent,
    etaMinutes: progress.etaMinutes,
    timestamp
  };
}
