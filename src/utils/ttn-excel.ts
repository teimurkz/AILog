import type ExcelJSType from 'exceljs';
import { amountInWords, massInWords, ttnTotals, type TtnDocument } from '../../shared/ttn';

type ExcelJS = typeof ExcelJSType;

/**
 * The template is the 1C 8.3 printout of form 1-Т with the data cells blank. It has two goods rows
 * (26 and 27); the copy gets one row per goods line, built from row 26, and everything below moves down.
 */
const ITEM_ROW = 26;
const FOOTER_ROW = 28;
const LAST_ROW = 61;
const LAST_COLUMN = 77;
/** Column spans of the goods table, as in its header row 24. */
const ITEM_SPANS = [['B', 'E'], ['F', 'K'], ['L', 'V'], ['W', 'AB'], ['AC', 'AH'], ['AI', 'AO'], ['AP', 'AS'], ['AT', 'AX'], ['AY', 'BB'], ['BC', 'BF'], ['BG', 'BM'], ['BN', 'BP'], ['BQ', 'BV'], ['BW', 'BX']];

const formatDate = (iso: string) => {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}.${month}.${year}` : iso;
};

/** Rough line count of a wrapped cell, for the row height. */
const lines = (text: string, perLine: number) => Math.max(1, Math.ceil(text.length / perLine));

export async function buildTtnWorkbook(excel: ExcelJS, template: ArrayBuffer, document: TtnDocument) {
  const source = new excel.Workbook();
  await source.xlsx.load(template);
  const from = source.worksheets[0];
  const count = Math.max(document.items.length, 1);
  const rowFor = (row: number) => row < ITEM_ROW ? row : row + count - 2;

  const workbook = new excel.Workbook();
  workbook.creator = 'CRM';
  const sheet = workbook.addWorksheet('ТТН', {
    pageSetup: { ...from.pageSetup, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    // Only the row height: with the template's outline settings exceljs writes <sheetPr> children
    // out of schema order next to fitToPage, and Excel refuses to open the file.
    properties: { defaultRowHeight: from.properties.defaultRowHeight },
    views: [{ showGridLines: false }],
  });
  for (let column = 1; column <= LAST_COLUMN; column++) sheet.getColumn(column).width = from.getColumn(column).width;

  const copyRow = (fromRow: number, toRow: number) => {
    const source = from.getRow(fromRow);
    const target = sheet.getRow(toRow);
    if (source.height) target.height = source.height;
    for (let column = 1; column <= LAST_COLUMN; column++) {
      const cell = source.getCell(column);
      const copy = target.getCell(column);
      copy.style = JSON.parse(JSON.stringify(cell.style || {}));
      if (!cell.isMerged || cell.master === cell) copy.value = cell.value;
    }
  };
  for (let row = 1; row <= LAST_ROW; row++) {
    if (row === ITEM_ROW) for (let item = 0; item < count; item++) copyRow(ITEM_ROW, ITEM_ROW + item);
    else if (row !== ITEM_ROW + 1) copyRow(row, rowFor(row));
  }

  for (const range of from.model.merges as string[]) {
    const [, startColumn, startRow, endColumn, endRow] = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/)!;
    const top = Number(startRow);
    if (top === ITEM_ROW || top === ITEM_ROW + 1) continue;
    sheet.mergeCellsWithoutStyle(`${startColumn}${rowFor(top)}:${endColumn}${rowFor(Number(endRow))}`);
  }
  for (let item = 0; item < count; item++) {
    for (const [start, end] of ITEM_SPANS) sheet.mergeCellsWithoutStyle(`${start}${ITEM_ROW + item}:${end}${ITEM_ROW + item}`);
  }

  const set = (address: string, value: string | number | null | undefined) => {
    const [, column, row] = address.match(/^([A-Z]+)(\d+)$/)!;
    sheet.getCell(`${column}${rowFor(Number(row))}`).value = value === '' || value === undefined ? null : value;
  };

  set('BE2', document.number);
  set('AO3', formatDate(document.date));
  set('K5', document.vehicle);
  if (document.waybillSheet) set('AO5', `к путевому листу № ${document.waybillSheet}`);
  set('K7', document.carrier);
  set('AK7', document.driver);
  set('BE7', document.transportKind);
  set('K9', document.customer);
  set('K11', document.shipper);
  set('K13', document.consignee);
  set('K15', document.loadingPoint);
  set('AO15', document.unloadingPoint);
  set('AW17', document.trailer);

  document.items.forEach((item, index) => {
    const row = ITEM_ROW + index;
    const cell = (column: string) => sheet.getCell(`${column}${row}`);
    cell('B').value = item.code || null;
    cell('L').value = item.name || null;
    cell('W').value = item.unit || null;
    cell('AC').value = item.quantity;
    cell('AI').value = item.price;
    cell('AP').value = item.sum;
    cell('AT').value = item.documents || null;
    cell('AY').value = item.packaging || null;
    cell('BC').value = item.places;
    cell('BW').value = item.grossKg === null ? null : item.grossKg / 1000;
    cell('BW').numFmt = '#,##0.000';
    cell('BC').alignment = { ...cell('BC').alignment, horizontal: 'right' };
    cell('AT').alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    sheet.getRow(row).height = Math.max(23, 11 * Math.max(lines(item.name, 34), lines(item.documents, 11)) + 1);
  });

  const totals = ttnTotals(document);
  set('AC28', totals.quantity || null);
  set('AP28', totals.sum || null);
  set('L29', totals.sum ? amountInWords(totals.sum) : '');
  set('AY29', document.releasedBy);
  set('BK32', document.poaNumber);
  set('BV32', formatDate(document.poaDate));
  set('BI33', document.poaIssuedBy);
  if (totals.grossKg) {
    set('G34', massInWords(totals.grossKg));
    set('AJ34', massInWords(totals.grossKg));
  }
  return workbook;
}

export async function downloadTtn(document: TtnDocument, fileName: string) {
  const [{ default: excel }, { default: templateUrl }] = await Promise.all([
    import('exceljs'),
    import('../assets/ttn-1t-template.xlsx?url'),
  ]);
  const template = await (await fetch(templateUrl)).arrayBuffer();
  const workbook = await buildTtnWorkbook(excel, template, document);
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = window.document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
