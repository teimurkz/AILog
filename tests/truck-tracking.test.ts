import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  DEFAULT_STAGES, daysInStage, isTruckIdle, normalizeEntry, parseStageStatus, parseTrackingDate, parseTruckTrackingPaste,
  stagePatch, statusAfterDateEdit, type TruckStage,
} from '../shared/truck-tracking';
import { truckTrackingFullWorkbook, truckTrackingWorkbook } from '../src/utils/truck-tracking-excel';

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
