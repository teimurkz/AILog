import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amountInWords, consigneeLine, emptyTtnItem, findConsignee, integerInWords, linesFromPdfItems, linesFromSheetRows, massInWords, toNumber, ttnTotals, waybillDetails, waybillGoods,
  type PdfTextItem,
} from '../shared/ttn';

test('numbers are read the way 1C and Excel print them', () => {
  assert.equal(toNumber('12 314 400,00'), 12314400);
  assert.equal(toNumber('2,800.000'), 2800);
  assert.equal(toNumber('4 398,5'), 4398.5);
  assert.equal(toNumber('1.234.567'), 1234567);
  assert.equal(toNumber(2800), 2800);
  assert.equal(toNumber('шт'), null);
  assert.equal(toNumber(''), null);
});

test('sums and mass in words match the 1C printout', () => {
  assert.equal(amountInWords(24871200), 'Двадцать четыре миллиона восемьсот семьдесят одна тысяча двести теңге 00 тиын');
  assert.equal(amountInWords(1001.5), 'Одна тысяча один теңге 50 тиын');
  assert.equal(massInWords(19500), 'Девятнадцать тысяч пятьсот кг.');
  assert.equal(integerInWords(2_212_014), 'два миллиона двести двенадцать тысяч четырнадцать');
  assert.equal(integerInWords(0), 'ноль');
});

test('totals take the mass from the lines when the lines have it', () => {
  const items = [
    { ...emptyTtnItem(), quantity: 2800, sum: 12314400, grossKg: 6000 },
    { ...emptyTtnItem(), quantity: 5760, sum: 12556800, grossKg: 13500 },
  ];
  assert.deepEqual(ttnTotals({ items, grossKg: 1 }), { quantity: 8560, sum: 24871200, places: 0, grossKg: 19500 });
  assert.equal(ttnTotals({ items: items.map(item => ({ ...item, grossKg: null })), grossKg: 19500 }).grossKg, 19500);
});

// Form З-2 as pdf.js reads it: header over three lines, a wrapped name, VAT and "подлежит отпуску" columns.
const pdfRun = (str: string, x: number, y: number, width = str.length * 4): PdfTextItem => ({ str, x, y, width });
const z2Pdf: PdfTextItem[] = [
  pdfRun('НАКЛАДНАЯ НА ОТПУСК ЗАПАСОВ НА СТОРОНУ', 150, 700),
  pdfRun('46969', 420, 720), pdfRun('31.10.2026', 470, 720),
  pdfRun('Номер', 20, 600), pdfRun('Наименование, характеристика', 60, 600), pdfRun('Номенклатурный', 200, 600),
  pdfRun('Единица', 270, 600), pdfRun('Количество', 320, 600), pdfRun('Цена за единицу,', 400, 600), pdfRun('Сумма с НДС,', 470, 600), pdfRun('Сумма НДС,', 530, 600),
  pdfRun('по порядку', 20, 590), pdfRun('номер', 210, 590), pdfRun('измерения', 268, 590), pdfRun('подлежит отпуску', 300, 590), pdfRun('отпущено', 360, 590),
  pdfRun('в KZT', 410, 590), pdfRun('в KZT', 480, 590), pdfRun('в KZT', 540, 590),
  pdfRun('1', 25, 580), pdfRun('2', 100, 580), pdfRun('3', 215, 580), pdfRun('4', 280, 580), pdfRun('5', 320, 580), pdfRun('6', 370, 580), pdfRun('7', 420, 580), pdfRun('8', 490, 580), pdfRun('9', 550, 580),
  pdfRun('1', 25, 560), pdfRun('Сливочный сыр Willie 69%', 60, 560), pdfRun('30012813', 205, 560), pdfRun('шт', 280, 560),
  pdfRun('2 800,000', 305, 560), pdfRun('2 800,000', 355, 560), pdfRun('4 398,00', 405, 560), pdfRun('12 314', 465, 560, 24), pdfRun('400,00', 489.5, 560, 24), pdfRun('1 319 400,00', 528, 560),
  pdfRun('2 кг', 60, 551),
  pdfRun('2', 25, 535), pdfRun('Сливки Kalleh 33% 1 л', 60, 535), pdfRun('30012057', 205, 535), pdfRun('шт', 280, 535),
  pdfRun('5 760,000', 305, 535), pdfRun('5 760,000', 355, 535), pdfRun('2 180,00', 405, 535), pdfRun('12 556 800,00', 465, 535), pdfRun('1 345 371,43', 528, 535),
  pdfRun('Итого', 300, 515), pdfRun('8 560,000', 355, 515), pdfRun('24 871 200,00', 465, 515),
  pdfRun('Отпуск разрешил', 20, 480), pdfRun('1 000', 300, 480), pdfRun('2', 360, 480), pdfRun('2 000', 420, 480),
];

test('goods are read from a З-2 PDF: wrapped names joined, VAT and planned quantity ignored', () => {
  const items = waybillGoods(linesFromPdfItems(z2Pdf), 'Накладная №46969');
  assert.deepEqual(items.map(item => [item.code, item.name, item.unit, item.quantity, item.price, item.sum, item.documents]), [
    ['30012813', 'Сливочный сыр Willie 69% 2 кг', 'шт', 2800, 4398, 12314400, 'Накладная №46969'],
    ['30012057', 'Сливки Kalleh 33% 1 л', 'шт', 5760, 2180, 12556800, 'Накладная №46969'],
  ]);
});

test('runs printed apart on one line stay apart, touching runs join', () => {
  const [line] = linesFromPdfItems([pdfRun('12 314', 465, 10, 24), pdfRun('400,00', 489.5, 10.4, 24), pdfRun('шт', 280, 9)]);
  assert.deepEqual(line.map(cell => cell.text), ['шт', '12 314400,00']);
  assert.equal(toNumber(line[1].text), 12314400);
});

test('goods are read from a waybill exported to Excel, merged cells included', () => {
  const rows = [
    ['ТОО "MehKaz"', null, null, null, null, null, null, null],
    ['№', 'Наименование', null, 'Код', 'Ед. изм.', 'Кол-во', 'Цена', 'Сумма'],
    [1, 'Сливочный сыр Willie 69% 2 кг', null, '30012813', 'шт', 2800, 4398, 12314400],
    [2, 'Сливки Kalleh 33% 1 л', null, 'К-2057', 'шт', 5760, 2180, 12556800],
    [null, 'Итого', null, null, null, 8560, null, 24871200],
  ];
  const merges = [{ s: { r: 1, c: 1 }, e: { r: 1, c: 2 } }, { s: { r: 2, c: 1 }, e: { r: 2, c: 2 } }, { s: { r: 3, c: 1 }, e: { r: 3, c: 2 } }];
  const items = waybillGoods(linesFromSheetRows(rows, merges));
  assert.deepEqual(items.map(item => [item.code, item.name, item.quantity, item.price, item.sum]), [
    ['30012813', 'Сливочный сыр Willie 69% 2 кг', 2800, 4398, 12314400],
    ['К-2057', 'Сливки Kalleh 33% 1 л', 5760, 2180, 12556800],
  ]);
});

test('a document with no goods table gives no lines', () => {
  assert.deepEqual(waybillGoods(linesFromSheetRows([['Счёт на оплату'], ['Итого', 100]])), []);
});

test('the TTN workbook follows the 1C form with one row per goods line', async () => {
  const { readFileSync } = await import('node:fs');
  const { default: ExcelJS } = await import('exceljs');
  const { buildTtnWorkbook } = await import('../src/utils/ttn-excel');
  const template = readFileSync(new URL('../src/assets/ttn-1t-template.xlsx', import.meta.url));
  const item = (name: string, quantity: number, price: number, grossKg: number) =>
    ({ ...emptyTtnItem(), code: '300', name, unit: 'шт', quantity, price, sum: quantity * price, documents: 'Накладная №46969', packaging: 'шт', grossKg });
  const workbook = await buildTtnWorkbook(ExcelJS, template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength) as ArrayBuffer, {
    number: '67842', date: '2026-10-30', vehicle: 'VOLVO, 805AYC01', trailer: 'SCHMITZ, 47AFT01', waybillSheet: '', carrier: 'TRANSLINE',
    driver: 'Иванов И.И.', transportKind: 'АВТО', customer: 'Мех Каз ТОО', shipper: 'ТОО "MehKaz"', consignee: 'ТОО "Получатель"',
    loadingPoint: 'с. Аскара Токпанова', unloadingPoint: 'г. Актау', releasedBy: 'Генеральный директор', poaNumber: '15', poaDate: '2026-11-04',
    poaIssuedBy: 'ТОО "Получатель"', grossKg: null,
    items: [item('Сыр', 2800, 4398, 6000), item('Сливки', 5760, 2180, 13000), item('Масло', 100, 10, 500)],
  });
  const sheet = workbook.worksheets[0];
  const value = (address: string) => sheet.getCell(address).value;
  assert.equal(value('BE2'), '67842');
  assert.equal(value('AO3'), '30.10.2026');
  assert.equal(value('K5'), 'VOLVO, 805AYC01');
  assert.equal(value('L24'), 'Наименование продукции товара (груза) или номера контейнеров');
  assert.deepEqual([26, 27, 28].map(row => value(`L${row}`)), ['Сыр', 'Сливки', 'Масло']);
  assert.equal(value('BW27'), 13);
  // Everything below the goods moved down by one row.
  assert.equal(value('L29'), 'Итого');
  assert.equal(value('AC29'), 8660);
  assert.equal(value('AP29'), 2800 * 4398 + 5760 * 2180 + 1000);
  assert.equal(value('L30'), amountInWords(2800 * 4398 + 5760 * 2180 + 1000));
  assert.equal(value('AY30'), 'Генеральный директор');
  assert.equal(value('G35'), 'Девятнадцать тысяч пятьсот кг.');
  assert.equal(value('BV33'), '04.11.2026');
  assert.equal(value('B62'), 'К оплате');
  assert.ok((sheet.model.merges as string[]).includes('L28:V28'));
  assert.ok((sheet.model.merges as string[]).includes('B39:F40'));
  assert.equal(sheet.getCell('L26').border?.top?.style, 'thin');
  // Excel refuses a sheet whose <sheetPr> lists outlinePr after pageSetUpPr.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
  assert.doesNotMatch(sheetXml, /<pageSetUpPr[^>]*\/><outlinePr/);
});

test('sender, receiver and the releasing position are read from the З-2 header', () => {
  const run = (str: string, x: number, right: number, y: number): PdfTextItem => ({ str, x, y, width: right - x });
  const lines = linesFromPdfItems([
    run('Организация (индивидуальный', 34, 123, 700), run('Организация (индивидуальный', 159, 248, 700), run('Ответственный за поставку (Ф.И.О.)', 268, 371, 696),
    run('предприниматель) - отправитель', 32, 126, 690), run('предприниматель) - получатель', 158, 249, 690),
    run('Товарищество с ограниченной', 35, 122, 680), run('Товарищество с ограниченной', 160, 246, 680),
    run('Петров П.П.', 297, 341, 676),
    run('ответственностью "Отправитель"', 26, 132, 670), run('ответственностью Получатель-1', 155, 252, 670),
    run('Номер', 18, 37, 650), run('Количество', 303, 336, 650),
    run('по', 24, 31, 640), run('Наименование, характеристика', 66, 156, 640),
    run('Заместитель генерального директора', 30, 138, 300),
    run('Отпуск разрешил', 15, 65, 290), run('/', 140, 142, 290), run('Петров П.П.', 227, 270, 290),
  ]);
  assert.deepEqual(waybillDetails(lines), {
    shipper: 'Товарищество с ограниченной ответственностью "Отправитель"',
    consignee: 'Товарищество с ограниченной ответственностью Получатель-1',
    releasedBy: 'Заместитель генерального директора',
  });
});

test('the consignee named on a waybill is found in the directory with its requisites', () => {
  const directory = [
    { id: '1', name: 'ТОО «Альфа Трейд-7»', bin: '123456789012', address: 'г. Астана, ул. Примерная 1' },
    { id: '2', name: 'ТОО "Бета"', address: 'г. Шымкент' },
  ];
  const found = findConsignee(directory, 'Товарищество с ограниченной ответственностью Альфа Трейд-7');
  assert.equal(found?.id, '1');
  assert.equal(consigneeLine(found!), 'ТОО «Альфа Трейд-7», БИН 123456789012, г. Астана, ул. Примерная 1');
  assert.equal(findConsignee(directory, 'ТОО Гамма'), undefined);
  assert.equal(findConsignee(directory, 'ТОО'), undefined);
  assert.equal(consigneeLine({ name: 'ТОО "Бета"', bin: ' ', address: 'г. Шымкент' }), 'ТОО "Бета", г. Шымкент');
});

// «Накладная на перемещение» between our warehouses, as 1C saves it to Excel: no price column.
const transferRows = (): unknown[][] => {
  const row = (cells: Record<number, unknown>) => Array.from({ length: 31 }, (_, c) => cells[c] ?? null);
  return [
    row({}), row({}), row({ 1: 'Накладная на перемещение № 548 от 30 октября 2026 г.' }), row({}),
    row({ 1: 'Отправитель:' }), row({ 1: 'Структурная единица:', 8: 'MehKaz ТОО' }), row({ 1: 'Склад:', 5: 'Склад Kusto' }), row({}),
    row({ 1: 'Получатель:' }), row({ 1: 'Структурная единица:', 8: 'MehKaz ТОО' }), row({ 1: 'Склад:', 5: 'Склад Караганда' }), row({}),
    row({ 1: '№', 3: 'Код', 7: 'Товар', 19: 'Количество', 25: 'Сумма' }),
    row({ 1: 1, 3: '30003548 ', 7: 'Масло Kalleh 82% 20 кг', 19: 100, 23: 'кг', 25: 233781.43 }),
    row({ 1: 2, 3: '30006684 ', 7: 'Молоко Port de Kalleh 3% 1 л', 19: 3600, 23: 'шт', 25: 1494409.37 }),
    row({ 1: 'Итого:', 25: 1728190.8 }),
  ];
};
const transferMerges = [12, 13, 14].flatMap(r => [
  { s: { r, c: 1 }, e: { r, c: 2 } }, { s: { r, c: 3 }, e: { r, c: 6 } }, { s: { r, c: 7 }, e: { r, c: 18 } },
  { s: { r, c: 19 }, e: { r, c: r === 12 ? 24 : 22 } }, { s: { r, c: 25 }, e: { r, c: 30 } },
]);

test('a transfer between our warehouses gives quantity and sum, the price is worked out', () => {
  const items = waybillGoods(linesFromSheetRows(transferRows(), transferMerges), 'Накладная №548');
  assert.deepEqual(items.map(item => [item.code, item.name, item.unit, item.quantity, item.price, item.sum]), [
    ['30003548', 'Масло Kalleh 82% 20 кг', 'кг', 100, 2337.81, 233781.43],
    ['30006684', 'Молоко Port de Kalleh 3% 1 л', 'шт', 3600, 415.11, 1494409.37],
  ]);
});

test('a transfer names the sending and the receiving warehouse', () => {
  assert.deepEqual(waybillDetails(linesFromSheetRows(transferRows(), transferMerges)), {
    shipper: 'MehKaz ТОО, Склад Kusto', consignee: 'MehKaz ТОО, Склад Караганда', releasedBy: '',
  });
});

test('the receiving warehouse is found in the directory before the company itself', () => {
  const directory = [
    { id: 'company', name: 'ТОО MehKaz' },
    { id: 'karaganda', name: 'MehKaz Склад Караганда', address: 'г. Караганда' },
  ];
  assert.equal(findConsignee(directory, 'MehKaz ТОО, Склад Караганда')?.id, 'karaganda');
});
