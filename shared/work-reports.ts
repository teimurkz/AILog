import { daysInStage, isTruckIdle, sortStages, type TruckStage, type TruckTrackingEntry } from './truck-tracking';

/** The shipment fields the work reports read (a subset of the CRM shipment). */
export interface ReportShipment {
  id: string;
  invoice_id: string;
  route?: string;
  status?: string;
  loading_date?: string;
  departure_date?: string;
  customs_arrival_date?: string;
  unl_date?: string;
  actual_arrival_date?: string;
  est_travel_time?: number;
  items?: string[];
  goods?: string;
  mail_documents?: unknown[];
  documents_url?: string[];
  isArchived?: boolean;
}

export interface ReportPeriod { from: string; to: string; route?: string }

const almatyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' });
const DAY = 86400000;

/** "28.10.2026", "2026-10-28" or an ISO instant → "2026-10-28" (instants as Almaty days); otherwise null. */
export function parseDay(value?: string | null): string | null {
  if (!value || typeof value !== 'string') return null;
  const text = value.trim();
  const dotted = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotted) return valid(`${dotted[3]}-${dotted[2].padStart(2, '0')}-${dotted[1].padStart(2, '0')}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return valid(text);
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const time = Date.parse(text);
    return Number.isFinite(time) ? almatyDay.format(new Date(time)) : null;
  }
  return null;
}
const valid = (day: string) => Number.isFinite(Date.parse(day + 'T00:00:00Z')) ? day : null;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);
export const formatDay = (day?: string | null) => day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : '';
export const todayDay = (now = new Date()) => almatyDay.format(now);
const inPeriod = (day: string | null, period: ReportPeriod): day is string => Boolean(day && day >= period.from && day <= period.to);

/** Loading (or departure) day, arrival at the destination SVH and unloading. */
export const shipmentDays = (s: ReportShipment) => ({
  start: parseDay(s.loading_date) || parseDay(s.departure_date),
  arrived: parseDay(s.customs_arrival_date),
  unloaded: parseDay(s.unl_date) || parseDay(s.actual_arrival_date),
});

const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null;
const routeOf = (s: ReportShipment) => s.route || 'Без маршрута';
const byRoute = (shipments: ReportShipment[], route?: string) => route ? shipments.filter(s => routeOf(s) === route) : shipments;
/** Monday of the week of a day. */
export function weekStart(day: string) {
  const date = new Date(day + 'T00:00:00Z');
  return new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}

export interface PeriodSummary {
  sent: number; arrived: number; unloaded: number;
  avgTransit: number | null; maxTransit: number | null; avgCustoms: number | null;
  /** Share of trucks that reached the SVH within their planned travel time, % (null without data). */
  onTime: number | null; onTimeOf: number;
}

/** Sent / arrived / unloaded in the period and how long transit and customs took. */
export function periodSummary(all: ReportShipment[], period: ReportPeriod): PeriodSummary {
  const shipments = byRoute(all, period.route);
  const transit: number[] = [], customs: number[] = [];
  let sent = 0, arrived = 0, unloaded = 0, onTime = 0, planned = 0;
  for (const s of shipments) {
    const days = shipmentDays(s);
    if (inPeriod(days.start, period)) sent++;
    if (inPeriod(days.arrived, period)) {
      arrived++;
      if (days.start && days.arrived >= days.start) {
        const took = daysBetween(days.start, days.arrived);
        transit.push(took);
        if (s.est_travel_time && s.est_travel_time > 0) { planned++; if (took <= s.est_travel_time) onTime++; }
      }
    }
    if (inPeriod(days.unloaded, period)) {
      unloaded++;
      if (days.arrived && days.unloaded >= days.arrived) customs.push(daysBetween(days.arrived, days.unloaded));
    }
  }
  return { sent, arrived, unloaded, avgTransit: average(transit), maxTransit: transit.length ? Math.max(...transit) : null,
    avgCustoms: average(customs), onTime: planned ? Math.round(onTime / planned * 100) : null, onTimeOf: planned };
}

export interface WeekRow { week: string; sent: number; arrived: number; unloaded: number }

/** Weekly counts (weeks starting Monday) across the period, empty weeks included. */
export function weeklyFlow(all: ReportShipment[], period: ReportPeriod): WeekRow[] {
  const rows = new Map<string, WeekRow>();
  for (let week = weekStart(period.from); week <= period.to; week = new Date(Date.parse(week + 'T00:00:00Z') + 7 * DAY).toISOString().slice(0, 10)) {
    rows.set(week, { week, sent: 0, arrived: 0, unloaded: 0 });
  }
  for (const s of byRoute(all, period.route)) {
    const days = shipmentDays(s);
    if (inPeriod(days.start, period)) rows.get(weekStart(days.start))!.sent++;
    if (inPeriod(days.arrived, period)) rows.get(weekStart(days.arrived))!.arrived++;
    if (inPeriod(days.unloaded, period)) rows.get(weekStart(days.unloaded))!.unloaded++;
  }
  return [...rows.values()];
}

export interface RouteRow { route: string; sent: number; arrived: number; avgTransit: number | null; minTransit: number | null; maxTransit: number | null; avgCustoms: number | null }

/** Transit and customs times per route for trucks that arrived / were unloaded in the period. */
export function routeTimes(all: ReportShipment[], period: ReportPeriod): RouteRow[] {
  const routes = [...new Set(all.map(routeOf))].sort();
  return routes.map(route => {
    const shipments = all.filter(s => routeOf(s) === route);
    const transit: number[] = [], customs: number[] = [];
    let sent = 0, arrived = 0;
    for (const s of shipments) {
      const days = shipmentDays(s);
      if (inPeriod(days.start, period)) sent++;
      if (inPeriod(days.arrived, period)) {
        arrived++;
        if (days.start && days.arrived >= days.start) transit.push(daysBetween(days.start, days.arrived));
      }
      if (inPeriod(days.unloaded, period) && days.arrived && days.unloaded >= days.arrived) customs.push(daysBetween(days.arrived, days.unloaded));
    }
    return { route, sent, arrived, avgTransit: average(transit), minTransit: transit.length ? Math.min(...transit) : null,
      maxTransit: transit.length ? Math.max(...transit) : null, avgCustoms: average(customs) };
  }).filter(row => row.sent || row.arrived);
}

export interface ProductRow { product: string; trucks: number }

/** Products of trucks loaded in the period: in how many trucks each one went. */
export function productsShipped(all: ReportShipment[], period: ReportPeriod, limit = 15): ProductRow[] {
  const counts = new Map<string, number>();
  for (const s of byRoute(all, period.route)) {
    if (!inPeriod(shipmentDays(s).start, period)) continue;
    const names = s.items?.length ? s.items : s.goods ? [s.goods] : [];
    for (const name of new Set(names.map(item => item.trim()).filter(Boolean))) counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts].map(([product, trucks]) => ({ product, trucks }))
    .sort((a, b) => b.trucks - a.trucks || a.product.localeCompare(b.product)).slice(0, limit);
}

export interface QueueRow { id: string; invoice: string; route: string; since: string; days: number; overdue: boolean }

/** Trucks at the destination SVH and not unloaded yet, longest first. `limit` = days considered too long. */
export function svhQueue(all: ReportShipment[], today: string, limit = 5): QueueRow[] {
  return all.flatMap(s => {
    const days = shipmentDays(s);
    if (s.isArchived || s.status === 'Delivered' || !days.arrived || days.unloaded) return [];
    const waited = Math.max(0, daysBetween(days.arrived, today));
    return [{ id: s.id, invoice: s.invoice_id, route: routeOf(s), since: days.arrived, days: waited, overdue: waited >= limit }];
  }).sort((a, b) => b.days - a.days);
}

export interface TransitRow { id: string; invoice: string; route: string; since: string; days: number; planned: number | null; over: number }

/** Trucks on the road (loaded, not yet at the SVH), the most overdue first. */
export function onTheRoad(all: ReportShipment[], today: string): TransitRow[] {
  return all.flatMap(s => {
    const days = shipmentDays(s);
    if (s.isArchived || s.status === 'Delivered' || !days.start || days.arrived || days.unloaded) return [];
    const travelled = Math.max(0, daysBetween(days.start, today));
    const planned = s.est_travel_time && s.est_travel_time > 0 ? s.est_travel_time : null;
    return [{ id: s.id, invoice: s.invoice_id, route: routeOf(s), since: days.start, days: travelled, planned, over: planned ? Math.max(0, travelled - planned) : 0 }];
  }).sort((a, b) => b.over - a.over || b.days - a.days);
}

/** Active shipments that have no documents attached yet. */
export function withoutDocuments(all: ReportShipment[]) {
  return all.filter(s => !s.isArchived && s.status !== 'Delivered' && !(s.mail_documents?.length) && !(s.documents_url?.length))
    .map(s => ({ id: s.id, invoice: s.invoice_id, route: routeOf(s), start: shipmentDays(s).start }))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
}

export interface StageRow { stageId: string; trucks: number; idle: number; avgDays: number | null }
export interface IdleRow { id: string; invoice: string; productName: string; stageId: string; days: number }

/** "Слежка авто": trucks per stage, how long they have been there and which ones stand idle. */
export function trackingReport(entries: TruckTrackingEntry[], stages: TruckStage[], now = new Date()) {
  const ordered = sortStages(stages);
  const rows: StageRow[] = ordered.map(stage => {
    const here = entries.filter(entry => entry.status === stage.id);
    const days = here.map(entry => daysInStage(entry, ordered, now)).filter((value): value is number => value !== null);
    return { stageId: stage.id, trucks: here.length, idle: here.filter(entry => isTruckIdle(entry, ordered, now)).length, avgDays: average(days) };
  });
  const idle: IdleRow[] = entries.filter(entry => isTruckIdle(entry, ordered, now))
    .map(entry => ({ id: entry.id, invoice: entry.invoice, productName: entry.productName, stageId: entry.status, days: daysInStage(entry, ordered, now) || 0 }))
    .sort((a, b) => b.days - a.days);
  return { rows, idle };
}
