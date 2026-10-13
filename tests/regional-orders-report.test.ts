import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildRegionalOrdersReport, regionalReportDate, type RegionalReportOrder } from '../shared/regional-orders-report';
import { regionalReportWorkbook } from '../src/utils/regional-report-excel';

const order = (id: string, patch: Partial<RegionalReportOrder> = {}): RegionalReportOrder => ({
  id, orderNumber: `REG-${id}`, status: 'delivered', originCity: 'Алматы', destinationCity: 'Астана',
  shipmentDate: '2026-09-15', assignedTruckPlate: '777 ABC 02', ...patch,
});

test('sent totals exclude pending and cancelled orders; repeated plates/numbers count separate trips', () => {
  const orders = ['new', 'assigned', 'loading', 'cancelled', 'dispatched', 'delivered'].map((status, i) => order(String(i), { status, orderNumber: 'REG-SAME' }));
  const report = buildRegionalOrdersReport([...orders, orders[5]]);
  assert.equal(report.total, 2);
  assert.equal(report.dispatched, 1);
  assert.equal(report.delivered, 1);
  assert.equal(report.directions[0].count, 2);
  assert.equal(report.rows.length, 2, 'deduplicate Firestore ID, not display number or truck');
});

test('inclusive period uses actual departure day in Almaty rather than planned or created date', () => {
  const rows = [
    order('utc', { dispatchedAt: '2026-09-30T20:05:00Z', shipmentDate: '2026-09-15' }),
    order('last', { dispatchedAt: '2026-10-01T18:59:00Z' }),
    order('next', { dispatchedAt: '2026-10-01T19:00:00Z' }),
  ];
  const report = buildRegionalOrdersReport(rows, { from: '2026-10-01', to: '2026-10-01' });
  assert.deepEqual(report.rows.map(row => row.id).sort(), ['last', 'utc']);
  assert.equal(report.rows.every(row => row.dateSource === 'actual'), true);
  assert.equal(report.shipmentDates, 0);
});

test('older trips explicitly use shipment dates; absent dates are counted separately and never invented', () => {
  const orders = [order('readable', { shipmentDate: '15.09.2026' }), order('invalid-actual', { dispatchedAt: 'not a date' }),
    order('missing', { shipmentDate: '' }), order('invalid', { shipmentDate: '31.09.2026' })];
  const all = buildRegionalOrdersReport(orders);
  assert.equal(all.total, 4);
  assert.equal(all.shipmentDates, 2);
  assert.equal(all.undated, 2);
  const period = buildRegionalOrdersReport(orders, { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(period.total, 2);
  assert.equal(period.undatedExcluded, 2);
  assert.equal(period.undated, 0);
  assert.equal(regionalReportDate('2026-02-30T09:00:00Z'), '');
  assert.equal(regionalReportDate('2026-02-28T09:00:00'), '', 'timezone-free instants are ambiguous');
  assert.equal(regionalReportDate('29.02.2024'), '2024-02-29');
});

test('directions include origins, group equivalent city labels and reconcile counts', () => {
  const report = buildRegionalOrdersReport([
    order('1', { destinationCity: ' Астана ', status: 'dispatched' }), order('2', { destinationCity: 'астана' }),
    order('3', { originCity: 'Шымкент' }), order('4', { originCity: '', destinationCity: '' }),
  ]);
  assert.equal(report.directions.length, 3);
  assert.equal(report.directions.reduce((total, row) => total + row.count, 0), report.total);
  assert.equal(report.directions[0].count, 2);
  assert.ok(report.rows.some(row => row.route === 'Не указан → Не указан'));
  const filtered = buildRegionalOrdersReport([order('1'), order('2', { destinationCity: 'Шымкент' }), order('3', { status: 'dispatched' })],
    { destination: 'астана', status: 'delivered' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.rows[0].id, '1');
});

test('invalid and reversed date ranges fail visibly instead of exporting misleading totals', () => {
  assert.throws(() => buildRegionalOrdersReport([], { from: '2026-10-20', to: '2026-10-01' }), /Начало периода/);
  assert.throws(() => buildRegionalOrdersReport([], { from: '2026-02-30' }), /корректные даты/);
  assert.equal(buildRegionalOrdersReport([], { from: '2026-09-01' }).total, 0);
});

test('exported Excel matches the filtered report and retains date provenance and text identifiers', () => {
  const filters = { from: '2026-09-01', to: '2026-09-30', status: 'all' as const };
  const report = buildRegionalOrdersReport([order('a', { orderNumber: '000123', invoiceNumber: '00123' }),
    order('b', { dispatchedAt: '2026-09-16T09:00:00Z', status: 'dispatched' }), order('c', { shipmentDate: '2026-10-01' })], filters);
  const file = XLSX.write(regionalReportWorkbook(report, filters), { type: 'buffer', bookType: 'xlsx' });
  const exported = XLSX.read(file);
  assert.deepEqual(exported.SheetNames, ['Сводка по направлениям', 'Отправленные машины']);
  assert.equal(exported.Sheets['Сводка по направлениям'].B5.v, 2);
  assert.equal(exported.Sheets['Отправленные машины'].C3.v, '000123');
  assert.equal(exported.Sheets['Отправленные машины'].H3.v, '00123');
  assert.equal(exported.Sheets['Отправленные машины'].B2.v, 'Фактическая отправка');
  assert.equal(exported.Sheets['Отправленные машины'].B3.v, 'Дата отгрузки из заявки');
  assert.equal(exported.Sheets['Отправленные машины']['!autofilter']?.ref, 'A1:J3');
});
