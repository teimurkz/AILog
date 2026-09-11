// Apply to REST responses and every realtime event containing order data.
const gpsFields = new Set([
  'currentLat', 'currentLng', 'lat', 'lng', 'latitude', 'longitude', 'speed', 'heading', 'accuracy',
  'lastGpsUpdate', 'driverConsent', 'driverConsentAt', 'hasRealGps', 'isTrackingActive',
  'trackingSource', 'trackingStartLocation', 'liveLocationExpiresAt', 'trackingStoppedAt',
  'locationHistory', 'history', 'location', 'detailedRoadPolyline', 'routeWaypoints',
  'remainingDistanceKm', 'progressPercent', 'etaMinutes', 'etaFormatted', 'signalStatus', 'signalStatusText'
]);
export function withoutGps<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutGps) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !gpsFields.has(key)).map(([key, item]) => [key, withoutGps(item)])) as T;
  return value;
}
export function eventForRole(type: string, data: any, admin: boolean) {
  if (admin) return data;
  if (['telemetry_update', 'truck_position_update', 'route_updated', 'user_updated', 'user_deleted'].includes(type)) return undefined;
  return withoutGps(data);
}
