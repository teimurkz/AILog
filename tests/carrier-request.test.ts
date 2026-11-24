import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildCarrierRequest } from '../shared/carrier-request';
import { carrierRequestWorkbook } from '../src/utils/carrier-request-excel';

const orders = [
  { id: 'a', orderNumber: 'REG-3', status: 'new', originCity: 'Алматы', destinationCity: 'Астана', shipmentDate: '2026-11-27', truckType: 'Фура 20т', palletsCount: '33', cargoDescription: 'Обои',
    deliveryPoints: [{ address: 'Астана, ул. Кенесары 1', note: '10 паллет' }, { address: 'Астана, пр. Абая 5' }], comments: 'Рампа' },
  { id: 'b', orderNumber: 'REG-1', status: 'new', originCity: 'Алматы', destinationCity: 'астана ', shipmentDate: '2026-11-25', truckType: 'фура 20т', deliveryAddress: 'Склад №2' },
  { id: 'c', orderNumber: 'REG-2', status: 'dispatched', originCity: 'Алматы', destinationCity: 'Шымкент', shipmentDate: '2026-11-20', truckType: 'Реф' },
  { id: 'd', orderNumber: 'REG-4', status: 'new', destinationCity: 'Караганда', shipmentDate: 'завтра', truckType: 'Реф' },
];

test('only new orders go to the carrier, earliest loading first', () => {
  const { rows, directions } = buildCarrierRequest(orders, { unknownPlace: 'Не указан' });
  assert.deepEqual(rows.map(row => row.orderNumber), ['REG-1', 'REG-3', 'REG-4']);
  assert.deepEqual(rows[1].unloading, ['Астана, ул. Кенесары 1 — 10 паллет', 'Астана, пр. Абая 5']);
  assert.deepEqual(rows[0].unloading, ['Склад №2']);
  assert.equal(rows[2].route, 'Не указан → Караганда');
  // Same route and truck type regardless of case and spaces: one line, two trucks, earliest date.
  assert.deepEqual(directions[0], { route: 'Алматы → астана', truckType: 'фура 20т', trucks: 2, firstDate: '2026-11-25', orderNumbers: ['REG-1', 'REG-3'] });
  assert.equal(directions[1].firstDate, '');
});

test('ticked orders are sent as they are, whatever their status', () => {
  const { rows } = buildCarrierRequest(orders, { ids: ['c'] });
  assert.deepEqual(rows.map(row => row.orderNumber), ['REG-2']);
});

test('the workbook has routes and orders without client contacts', () => {
  const request = buildCarrierRequest(orders);
  const book = carrierRequestWorkbook(request, 'ru', new Date('2026-11-24T10:00:00Z'));
  assert.deepEqual(book.SheetNames, ['Направления', 'Заявки']);
  const routes = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Направления'], { header: 1 });
  assert.deepEqual(routes[6], ['Алматы → астана', 'фура 20т', 2, '25.11.2026', 'REG-1, REG-3']);
  assert.deepEqual(routes.at(-1), ['Итого', '', 3]);
  const list = XLSX.utils.sheet_to_json<Record<string, string>>(book.Sheets['Заявки']);
  assert.equal(list[0]['Дата погрузки'], '25.11.2026');
  assert.equal(list[2]['Дата погрузки'], 'завтра');
  assert.ok(!JSON.stringify(list).includes('Phone'));
});
