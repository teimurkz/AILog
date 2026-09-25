import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbookToWarehouses } from '../server/services/warehouse-workbook.js';
import { generateWarehouseExcelBufferAsync } from '../server/services/excel.service.js';

function source(tabs: Array<[string, any[][]]>) {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of tabs) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}
const stockRows = [['№', 'ИНВ №', 'товар', 'кол паллет', 'даты', 'СВХ'], [1, 'TEST-1', 'Мороженое', '12', '', 'СВХ']];
const kustoTabs: Array<[string, any[][]]> = [
  ['СВХ Кусто', [['№', 'ИНВ №', '№ авто', 'дата выгрузки на СВХ', ''], [1, 'NEW-1', 'TRUCK-1', 46290, '']]],
  ['инв_Кусто', [['№', 'ИНВ', 'товар', 'заезд СВХ', 'выезд СВХ'], [1, 'OLD-1', 'Архивный товар', 46000, 46001]]],
];

test('new СВХ Кусто tab and existing инв_Кусто both survive parsing and Excel export', async () => {
  const warehouses = parseWorkbookToWarehouses(source(kustoTabs));
  assert.deepEqual(warehouses.map(w => w.name), ['СВХ Кусто', 'инв_Кусто']);
  assert.equal(warehouses[1].id, 'inv_kusto', 'preserve original archive identity');
  assert.equal(new Set(warehouses.map(w => w.id)).size, 2);
  assert.equal(new Set(warehouses.flatMap(w => w.items.map((i: any) => i.id))).size, 2);
  assert.deepEqual(warehouses.map(w => w.itemCount), [1, 1], 'header is not a truck');
  const report = XLSX.read(await generateWarehouseExcelBufferAsync({ warehouses }));
  assert.deepEqual(report.SheetNames, ['Сводка по складам', 'СВХ Кусто', 'инв_Кусто']);
  assert.equal(report.Sheets['СВХ Кусто'].B5.v, 'NEW-1');
  assert.equal(report.Sheets['СВХ Кусто'].C4.v, '№ авто');
  assert.equal(report.Sheets['СВХ Кусто'].C5.v, 'TRUCK-1');
  assert.equal(report.Sheets['инв_Кусто'].B5.v, 'OLD-1');
  assert.equal(report.Sheets['инв_Кусто'].C5.v, 'Архивный товар');
});

test('adding and reordering tabs preserves existing special and warehouse identities', () => {
  const original: Array<[string, any[][]]> = [['инв_Кусто', kustoTabs[1][1]], ['Отчет по машинам', [['Инвойс', 'Наименование продукта', 'Дата прибытия', 'Статус'], ['T-1', 'Товар', '', 'В пути']]], ['А-Прейд', stockRows]];
  const before = parseWorkbookToWarehouses(source(original));
  const after = parseWorkbookToWarehouses(source([...kustoTabs.slice(0, 1), ...original].reverse()));
  for (const warehouse of before) assert.equal(after.find(w => w.sheetName === warehouse.sheetName).id, warehouse.id);
  assert.equal(after.find(w => w.sheetName === 'Отчет по машинам').id, 'trucks_report');
});

test('colliding slugs and reserved warehouse IDs do not merge separate tabs', () => {
  const names = ['Склад А', 'Склад_А', '仓库', '倉庫', 'inv_kusto', 'trucks_report', 'инв_Кусто', 'Отчет по машинам'];
  const warehouses = parseWorkbookToWarehouses(source(names.map(n => [n, stockRows])));
  assert.equal(new Set(warehouses.map(w => w.id)).size, names.length);
  const reversed = parseWorkbookToWarehouses(source([...names].reverse().map(n => [n, stockRows])));
  for (const wh of warehouses) assert.equal(reversed.find(w => w.sheetName === wh.sheetName).id, wh.id);
});

test('all new warehouse and truck report tabs are exported automatically', async () => {
  const truckRows = [['Инвойс', 'Наименование продукта', 'Дата прибытия', 'Статус'], ['T-1', 'Товар в пути', '', 'В пути']];
  const warehouses = parseWorkbookToWarehouses(source([
    ['А-Прейд', stockRows], ['Новый склад', stockRows], ['Отчет по машинам', truckRows],
    ['Отчет по машинам сентябрь', [['Инвойс', 'Наименование продукта', 'Дата прибытия', 'Статус'], ['T-2', 'Другой рейс', '', 'В пути']]],
    ['Пустой лист', []], ['список_документов_', [['Инструкция']]],
  ]));
  assert.equal(warehouses.length, 4);
  const report = XLSX.read(await generateWarehouseExcelBufferAsync({ warehouses }));
  assert.equal(report.SheetNames.length, 5);
  assert.equal(report.Sheets['Новый склад'].B5.v, 'TEST-1');
  assert.equal(report.Sheets['Отчет по машинам'].B5.v, 'T-1');
  assert.equal(report.Sheets['Отчет по машинам сентябрь'].B5.v, 'T-2');
  assert.equal(report.Sheets['Сводка по складам'].E7.v, 24);
});

test('duplicate, long, invalid and reserved Excel names cannot stop the whole report', async () => {
  const names = [
    'Архив авто (СВХ Кусто)', 'Архив авто (СВХ Кусто)', 'СКЛАД', 'склад',
    'Сводка по складам', 'History', 'history', 'Склад/А', 'Склад:А',
    'Склад с очень длинным одинаковым названием один', 'Склад с очень длинным одинаковым названием два',
    "'Склад'", '   ', "''''", '😀'.repeat(20), 'A'.repeat(30) + "'a", '\u0001Склад',
  ];
  const warehouses = names.map((name, index) => ({ name, items: [{ invNumber: `ITEM-${index}`, product: name }] }));
  const report = XLSX.read(await generateWarehouseExcelBufferAsync({ warehouses }));
  assert.equal(report.SheetNames.length, names.length + 1);
  assert.equal(new Set(report.SheetNames.map(n => n.toLowerCase())).size, report.SheetNames.length);
  report.SheetNames.forEach(name => {
    assert.ok(name.length > 0 && name.length <= 31);
    assert.doesNotMatch(name, /[\x00-\x1F:\\\/?*\[\]]|^'|'$/);
  });
  names.forEach((name, i) => {
    const sheet = report.Sheets[report.SheetNames[i + 1]];
    assert.equal(sheet.B5.v, `ITEM-${i}`, 'every sheet retains its own data');
    assert.equal(sheet.A1.v, `Склад: ${name.toUpperCase().replace(/[\x00-\x1F]/g, '')}`, 'full printable source name remains in the banner');
  });
});

test('source sheet names take precedence over legacy duplicate display labels', async () => {
  const warehouses = kustoTabs.map(([sheetName], index) => ({ sheetName, name: 'Архив авто (СВХ Кусто)', items: [{ invNumber: `INV-${index}` }] }));
  const report = XLSX.read(await generateWarehouseExcelBufferAsync({ warehouses }));
  assert.deepEqual(report.SheetNames, ['Сводка по складам', 'СВХ Кусто', 'инв_Кусто']);
});
