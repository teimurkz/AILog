import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  DEFAULT_STAGES, daysInStage, isTruckIdle, normalizeEntry, parseStageStatus, parseTrackingDate, parseTruckTrackingPaste,
  stageDateLabel, stageLabel, stagePatch, statusAfterDateEdit, type TruckStage,
} from '../shared/truck-tracking';
import { truckTrackingFullWorkbook, truckTrackingWorkbook } from '../src/utils/truck-tracking-excel';
import { TRACKING_TEXT } from '../shared/truck-tracking-i18n';
import { findLinkedShipment, shipmentPatchFor, stageShipmentSync } from '../shared/shipment-link';

const today = new Date(2026, 9, 23);
const stages = DEFAULT_STAGES;
const entry = (status: string, stageDates: Record<string, string>) => ({ status, stageDates });

test('Excel paste with the team header maps every column', () => {
  const rows = parseTruckTrackingPaste([
    'Инвойс\tНаименование продукта\tДата прибытия\tРазгрузили на СВХ\tСтатус',
    'INV-1\tМолоко\t22.10.2026\t\tПрибыла',
    'INV-2\tСыр\t20.10.26\t21.10.2026\t',
    '\t\t\t\t',
  ].join('\r\n'), stages);
  assert.deepEqual(rows.map(row => [row.invoice, row.productName, row.stageDates, row.status]), [
    ['INV-1', 'Молоко', { arrived: '2026-10-22' }, 'arrived'],
    ['INV-2', 'Сыр', { arrived: '2026-10-20', unloaded: '2026-10-21' }, 'unloaded'],
  ]);
});

test('stage columns are told apart even though they all mention the SVH', () => {
  const [row] = parseTruckTrackingPaste('Инвойс\tДата прибытия на СВХ\tРазгрузили на СВХ\tПеремещение с СВХ на коммерческий склад\nB-1\t20.10.2026\t21.10.2026\t22.10.2026', stages);
  assert.deepEqual(row.stageDates, { arrived: '2026-10-20', unloaded: '2026-10-21', moved: '2026-10-22' });
  assert.equal(row.status, 'moved');
  assert.equal(parseTruckTrackingPaste('A-7\tМасло\t2026-10-20\tда\t', stages)[0].status, 'unloaded');
});

test('custom stages are recognised by their names', () => {
  const custom: TruckStage[] = [
    ...stages.slice(0, 2),
    { id: 'customs', label: 'На оформлении', dateLabel: 'Подали декларацию', color: 'violet', order: 2 },
    stages[2],
  ];
  const [row] = parseTruckTrackingPaste('Инвойс\tПодали декларацию\tСтатус\nC-1\t22.10.2026\tНа оформлении', custom);
  assert.deepEqual([row.stageDates, row.status], [{ customs: '2026-10-22' }, 'customs']);
  assert.equal(parseStageStatus('Выгрузили на СВХ', custom), 'unloaded');
});

test('dates written by people are understood', () => {
  assert.equal(parseTrackingDate('46318'), '2026-10-23');
  assert.equal(parseTrackingDate('31/12/2026'), '2026-12-31');
  assert.equal(parseTrackingDate('завтра'), '');
});

test('stage dates drive the status both ways', () => {
  assert.equal(statusAfterDateEdit(entry('arrived', {}), stages, 'unloaded', '2026-10-23'), 'unloaded');
  assert.equal(statusAfterDateEdit(entry('arrived', {}), stages, 'moved', '2026-10-23'), 'moved');
  assert.equal(statusAfterDateEdit(entry('unloaded', { arrived: '2026-10-20', unloaded: '2026-10-21' }), stages, 'unloaded', ''), 'arrived');
  assert.equal(statusAfterDateEdit(entry('moved', { unloaded: '2026-10-21', moved: '2026-10-22' }), stages, 'moved', ''), 'unloaded');
  assert.equal(statusAfterDateEdit(entry('moved', { moved: '2026-10-22' }), stages, 'unloaded', '2026-10-21'), null);
  assert.deepEqual(stagePatch({ stageDates: {} }, 'moved', today), { status: 'moved', stageDates: { moved: '2026-10-23' } });
  assert.deepEqual(stagePatch({ stageDates: { unloaded: '2026-10-20' } }, 'unloaded', today), { status: 'unloaded' });
});

test('idle trucks use each stage\'s own limit', () => {
  assert.equal(daysInStage(entry('arrived', { arrived: '2026-10-21' }), stages, today), 2);
  assert.equal(isTruckIdle(entry('arrived', { arrived: '2026-10-21' }), stages, today), true);
  assert.equal(isTruckIdle(entry('arrived', { arrived: '2026-10-22' }), stages, today), false);
  assert.equal(isTruckIdle(entry('unloaded', { arrived: '2026-10-10', unloaded: '2026-10-21' }), stages, today), false);
  // No unload date yet: counted from the latest earlier date.
  assert.equal(isTruckIdle(entry('unloaded', { arrived: '2026-10-19' }), stages, today), true);
  assert.equal(isTruckIdle(entry('moved', { moved: '2026-10-01' }), stages, today), false);
});

test('trucks of a deleted stage show up in the first stage', () => {
  assert.equal(normalizeEntry({ id: 'x', status: 'gone' }, stages).status, 'arrived');
});

test('export has one date column per stage', () => {
  const book = truckTrackingWorkbook([{
    id: '1', invoice: 'INV-1', productName: 'Молоко', stageDates: { arrived: '2026-10-20', unloaded: '2026-10-21' }, status: 'unloaded',
  }], stages);
  const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets['Слежка авто'], { header: 1 });
  assert.deepEqual(rows[0].slice(0, 6), ['Инвойс', 'Наименование продукта', 'Дата прибытия', 'Разгрузили на СВХ', 'Перемещено на склад', 'Статус']);
  assert.deepEqual(rows[1].slice(0, 6), ['INV-1', 'Молоко', '20.10.2026', '21.10.2026', '', 'Выгружена на СВХ']);
});

test('"Экспорт всё" puts every status into one workbook', () => {
  const rows = [
    { id: '1', invoice: 'INV-1', productName: 'Молоко', stageDates: { arrived: '2026-10-20' }, status: 'arrived' },
    { id: '2', invoice: 'INV-2', productName: 'Сыр', stageDates: { unloaded: '2026-10-21' }, status: 'unloaded' },
    { id: '3', invoice: 'INV-3', productName: 'Кефир', stageDates: { unloaded: '2026-10-22' }, status: 'unloaded' },
  ];
  const odd: TruckStage[] = [...stages, { id: 'x', label: 'Выгружена на СВХ', dateLabel: 'Дубль: имя/с [символами]', color: 'slate', order: 3 }];
  const book = truckTrackingFullWorkbook(rows, odd);
  assert.deepEqual(book.SheetNames, ['Сводка', 'Все фуры', 'Прибыла на СВХ', 'Выгружена на СВХ', 'Перемещена на склад', 'Выгружена на СВХ 2']);
  const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['Сводка'], { header: 1 });
  assert.deepEqual(summary.slice(4), [['Прибыла на СВХ', 1], ['Выгружена на СВХ', 2], ['Перемещена на склад', 0], ['Выгружена на СВХ', 0], ['ИТОГО', 3]]);
  assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Все фуры']).length, 3);
  assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Выгружена на СВХ']).length, 2);
});

test('stage names follow the CRM language and fall back to any name the stage has', () => {
  assert.deepEqual(['ru', 'en', 'fa'].map(language => stageLabel(stages[1], language as 'ru')), ['Выгружена на СВХ', 'Unloaded at TSW', 'تخلیه در انبار موقت']);
  const englishOnly: TruckStage = { id: 's', label: 'Customs', dateLabel: 'Cleared', labels: { en: 'Customs' }, color: 'rose', order: 3 };
  assert.equal(stageLabel(englishOnly, 'fa'), 'Customs');
  assert.equal(stageDateLabel(stages[0], 'fa'), 'تاریخ ورود');
});

test('English and Farsi sheets are recognised on paste', () => {
  const [en] = parseTruckTrackingPaste('Invoice\tProduct name\tArrival date\tUnloaded at TSW\tStatus\nE-1\tMilk\t20.10.2026\t21.10.2026\t', stages);
  assert.deepEqual([en.invoice, en.productName, en.stageDates, en.status], ['E-1', 'Milk', { arrived: '2026-10-20', unloaded: '2026-10-21' }, 'unloaded']);
  const [fa] = parseTruckTrackingPaste('فاکتور\tنام کالا\tتاریخ ورود\tوضعیت\nF-1\tشیر\t22.10.2026\tتخلیه در انبار موقت', stages);
  assert.deepEqual([fa.invoice, fa.productName, fa.stageDates, fa.status], ['F-1', 'شیر', { arrived: '2026-10-22' }, 'unloaded']);
});

test('export uses the CRM language; Farsi workbooks open right-to-left', () => {
  const rows = [{ id: '1', invoice: 'INV-1', productName: 'Milk', stageDates: { arrived: '2026-10-20' }, status: 'arrived' }];
  const en = truckTrackingFullWorkbook(rows, stages, 'en');
  assert.deepEqual(en.SheetNames, ['Summary', 'All trucks', 'Arrived at TSW', 'Unloaded at TSW', 'Moved to warehouse']);
  const fa = truckTrackingFullWorkbook(rows, stages, 'fa');
  assert.equal(fa.SheetNames[0], 'خلاصه');
  assert.equal(fa.Workbook?.Views?.[0]?.RTL, true);
  const header = XLSX.utils.sheet_to_json<string[]>(fa.Sheets['همه کامیون‌ها'], { header: 1 })[0];
  assert.deepEqual(header.slice(0, 3), ['فاکتور', 'نام کالا', 'تاریخ ورود']);
});

test('every language has every text', () => {
  const keys = Object.keys(TRACKING_TEXT.ru).sort();
  for (const language of ['en', 'fa'] as const) assert.deepEqual(Object.keys(TRACKING_TEXT[language]).sort(), keys);
});

test('a tracking invoice links to exactly one shipment by name or by number', () => {
  const shipments = [
    { id: 'a', invoice_id: 'Mehkaz 475' },
    { id: 'b', invoice_id: '504' },
    { id: 'c', invoice_id: 'X', commercial_invoice_number: '20260907-511' },
    { id: 'd', invoice_id: 'Mehkaz 600' }, { id: 'e', invoice_id: 'Solico 600' },
  ];
  assert.equal(findLinkedShipment('Mehkaz 475', shipments)?.id, 'a');
  assert.equal(findLinkedShipment('475', shipments)?.id, 'a');
  assert.equal(findLinkedShipment('mehkaz504', shipments)?.id, 'b');
  assert.equal(findLinkedShipment('Mehkaz 504', shipments)?.id, 'b');
  assert.equal(findLinkedShipment('511', shipments)?.id, 'c');
  assert.equal(findLinkedShipment('600', shipments), null); // two candidates: no guessing
  assert.equal(findLinkedShipment('1475', shipments), null);
  assert.equal(findLinkedShipment('', shipments), null);
});

test('SVH stage dates set arrival, unload date and status on the linked shipment', () => {
  const shipment = { id: 's', invoice_id: '475', status: 'In Transit' };
  assert.deepEqual(shipmentPatchFor(entry('arrived', { arrived: '2026-10-28' }), stages, shipment),
    { customs_arrival_date: '28.10.2026', status: 'Customs' });
  assert.deepEqual(shipmentPatchFor(entry('unloaded', { arrived: '2026-10-28', unloaded: '2026-10-29' }), stages, shipment),
    { customs_arrival_date: '28.10.2026', unl_date: '29.10.2026', status: 'Delivered' });
  // Already in step: nothing to write. A delivered shipment never goes back to "Customs".
  assert.equal(shipmentPatchFor(entry('arrived', { arrived: '2026-10-28' }), stages, { ...shipment, status: 'Customs', customs_arrival_date: '28.10.2026' }), null);
  assert.equal(shipmentPatchFor(entry('arrived', { arrived: '2026-10-28' }), stages, { ...shipment, status: 'Delivered', customs_arrival_date: '28.10.2026' }), null);
  // The "moved to warehouse" stage changes nothing by default; a custom stage can be linked.
  assert.equal(shipmentPatchFor(entry('moved', { moved: '2026-10-30' }), stages, shipment), null);
  const custom: TruckStage[] = [{ id: 'svh', label: 'СВХ', dateLabel: 'Разгрузка', color: 'blue', order: 0, shipmentSync: 'unloaded' }];
  assert.deepEqual(shipmentPatchFor(entry('svh', { svh: '2026-10-29' }), custom, shipment), { unl_date: '29.10.2026', status: 'Delivered' });
  assert.equal(stageShipmentSync({ id: 'arrived', shipmentSync: null }), null);
});
