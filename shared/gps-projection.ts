export type GpsDocument = { id: string; position?: Record<string, unknown>; history?: unknown[] };
export function mergeOrderGps<T extends { id: string }>(orders: T[], positions: GpsDocument[]): T[] {
  const byId = new Map(positions.map(position => [position.id, position]));
  return orders.map(order => {
    const gps = byId.get(order.id);
    if (!gps) return order;
    return { ...order, ...gps.position, ...(gps.history ? { locationHistory: gps.history } : {}), id: order.id };
  });
}

type Signal = { updatedAt: string; hasRealGps?: boolean; isTrackingActive?: boolean; liveLocationExpiresAt?: string;
  signalStatus?: string; signalStatusText?: string; speed: number };
export function ageGpsSignal<T extends Signal>(data: T | null, now: number): T | null {
  if (!data?.hasRealGps || !data.isTrackingActive || data.signalStatus === 'delivered') return data;
  if (data.liveLocationExpiresAt && Date.parse(data.liveLocationExpiresAt) <= now) return { ...data, isTrackingActive: false,
    speed: 0, signalStatus: 'offline', signalStatusText: 'Срок трансляции истёк — водитель должен продлить GPS' };
  const age = Math.max(0, (now - Date.parse(data.updatedAt)) / 1000);
  if (age > 120) return { ...data, speed: 0, signalStatus: age > 600 ? 'offline' : 'idle',
    signalStatusText: `Нет новых координат (${Math.round(age / 60)} мин)` };
  return data;
}
