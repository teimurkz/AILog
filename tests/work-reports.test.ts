import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STAGES } from '../shared/truck-tracking';
import {
  onTheRoad, parseDay, periodSummary, productsShipped, routeTimes, svhQueue, trackingReport, weeklyFlow, weekStart, withoutDocuments,
  type ReportShipment,
} from '../shared/work-reports';

const ship = (id: string, fields: Partial<ReportShipment>): ReportShipment => ({ id, invoice_id: id, route: 'Amol - Almaty', status: 'In Transit', ...fields });
const october = { from: '2026-10-01', to: '2026-10-31' };
const shipments = [
  // loaded 01.10, at SVH 15.10 (14 days, plan 14 → on time), unloaded 18.10 (3 days of customs)
  ship('A', { loading_date: '01.10.2026', customs_arrival_date: '15.10.2026', unl_date: '18.10.2026', est_travel_time: 14, status: 'Delivered', items: ['Milk', 'Cream'], mail_documents: [{}] }),
  // loaded 05.10, at SVH 25.10 (20 days, late), still at the SVH
  ship('B', { departure_date: '2026-10-05', customs_arrival_date: '2026-10-25', est_travel_time: 14, status: 'Customs', items: ['Milk'] }),
  // loaded 20.10 on the road, 10 days of 7 planned
  ship('C', { loading_date: '20.10.2026', est_travel_time: 7, route: 'Tehran - Almaty', goods: 'Cheese', documents_url: ['x'] }),
  // September truck unloaded in October
  ship('D', { loading_date: '01.09.2026', customs_arrival_date: '20.09.2026', unl_date: '02.10.2026', status: 'Delivered' }),
];

test('dates in CRM formats become days; instants are Almaty days', () => {
  assert.equal(parseDay('5.1.2026'), '2026-01-05');
  assert.equal(parseDay('2026-10-28'), '2026-10-28');
  assert.equal(parseDay('2026-10-28T20:30:00.000Z'), '2026-10-29');
  assert.equal(parseDay('скоро'), null); assert.equal(parseDay(undefined), null);
  assert.equal(weekStart('2026-10-29'), '2026-10-26');
});

test('period summary counts sent / arrived / unloaded with real transit and customs times', () => {
  const summary = periodSummary(shipments, october);
  assert.deepEqual({ ...summary }, { sent: 3, arrived: 2, unloaded: 2, avgTransit: 17, maxTransit: 20, avgCustoms: 7.5, onTime: 50, onTimeOf: 2 });
  assert.equal(periodSummary(shipments, { ...october, route: 'Tehran - Almaty' }).sent, 1);
});

test('weekly flow covers every week of the period', () => {
  const weeks = weeklyFlow(shipments, october);
  assert.equal(weeks[0].week, '2026-09-28'); assert.equal(weeks.at(-1)!.week, '2026-10-26');
  assert.deepEqual(weeks.map(w => w.sent), [1, 1, 0, 1, 0]);
  assert.equal(weeks.reduce((sum, w) => sum + w.unloaded, 0), 2);
});

test('route times and products shipped', () => {
  const routes = routeTimes(shipments, october);
  assert.deepEqual(routes.map(r => [r.route, r.sent, r.arrived, r.avgTransit]), [['Amol - Almaty', 2, 2, 17], ['Tehran - Almaty', 1, 0, null]]);
  assert.deepEqual(productsShipped(shipments, october), [{ product: 'Milk', trucks: 2 }, { product: 'Cheese', trucks: 1 }, { product: 'Cream', trucks: 1 }]);
});

test('operational lists: at the SVH, on the road, without documents', () => {
  const queue = svhQueue(shipments, '2026-10-30');
  assert.deepEqual(queue.map(row => [row.invoice, row.days, row.overdue]), [['B', 5, true]]);
  const road = onTheRoad(shipments, '2026-10-30');
  assert.deepEqual(road.map(row => [row.invoice, row.days, row.over]), [['C', 10, 3]]);
  assert.deepEqual(withoutDocuments(shipments).map(row => row.invoice), ['B']);
});

test('truck tracking: trucks per stage and idle ones', () => {
  const [arrived, unloaded] = DEFAULT_STAGES;
  const entries = [
    { id: '1', invoice: '471', productName: 'Milk', stageDates: { [arrived.id]: '2026-10-20' }, status: arrived.id },
    { id: '2', invoice: '472', productName: 'Cream', stageDates: { [arrived.id]: '2026-10-29' }, status: arrived.id },
    { id: '3', invoice: '473', productName: 'Cheese', stageDates: { [arrived.id]: '2026-10-01', [unloaded.id]: '2026-10-02' }, status: unloaded.id },
  ];
  const report = trackingReport(entries, DEFAULT_STAGES, new Date('2026-10-30T06:00:00Z'));
  const first = report.rows.find(row => row.stageId === arrived.id)!;
  assert.equal(first.trucks, 2); assert.equal(first.avgDays, 5.5);
  assert.ok(report.idle.every(row => row.days >= (DEFAULT_STAGES.find(s => s.id === row.stageId)!.idleDays || Infinity)));
});
