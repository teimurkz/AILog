import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import path from 'node:path';
import { invoiceKey, type MailDocument } from '../../shared/outlook-import.js';
import type { Shipment } from '../../src/types/index.js';

export class ImportReview extends Error {}
export interface InvoiceDraft {
  invoice_id: string; commercial_invoice_number: string; invoice_date?: string;
  route: Shipment['route']; plate_number?: string; loading_date?: string; goods?: string; items: string[];
}
export function invoiceName(fileName: string) {
  const name = fileName.replace(/\.(xlsx|xls)$/i, '').trim();
  if (!/\.(xlsx|xls)$/i.test(fileName) || !name || name.length > 160 || !/\d/.test(name) || /[\x00-\x1f/\\]/.test(name)) {
    throw new ImportReview('Не удалось определить номер инвойса по имени Excel-файла.');
  }
  return name;
}
// Bound the uncompressed ZIP size before reading its XML entries.
function checkWorkbookSize(bytes: Buffer) {
  if (bytes.length > 10 * 1024 * 1024) throw new ImportReview('Excel-файл больше 10 МБ. Нужна ручная проверка.');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new ImportReview('Excel-файл повреждён или защищён паролем.');
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16), size = 0;
  if (entries > 5000 || offset > end) throw new ImportReview('Слишком сложная структура Excel-файла.');
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new ImportReview('Повреждён архив Excel.');
    size += bytes.readUInt32LE(offset + 24);
    if (size > 64 * 1024 * 1024) throw new ImportReview('Слишком большой распакованный Excel-файл.');
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}
type ValueSheet = { cells: Map<string, unknown>; rowCount: number };
function xmlEvents(xml: string, open: (tag: any) => void, text: (value: string) => void, close: (tag: any) => void) {
  const parser = new SaxesParser();
  // XLSX needs no DTD. Neither external entities nor external workbook links
  // are resolved, and only cached cell values are consumed.
  parser.on('doctype', () => { throw new ImportReview('XML с DTD не поддерживается.'); });
  parser.on('opentag', open); parser.on('text', text); parser.on('cdata', text); parser.on('closetag', close);
  parser.write(xml).close();
}
async function readValueSheets(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string) => { const entry = zip.file(name); if (!entry) throw new ImportReview('В Excel отсутствует обязательная часть таблицы.'); return entry.async('string'); };
  const sheets = new Map<string, ValueSheet>(), names: { name: string; relation: string }[] = [], relations = new Map<string, string>();
  xmlEvents(await read('xl/workbook.xml'), tag => {
    if (tag.name === 'sheet') names.push({ name: String(tag.attributes.name).trim().toLowerCase(), relation: String(tag.attributes['r:id']) });
  }, () => {}, () => {});
  xmlEvents(await read('xl/_rels/workbook.xml.rels'), tag => {
    if (tag.name === 'Relationship' && tag.attributes.TargetMode !== 'External') relations.set(String(tag.attributes.Id), String(tag.attributes.Target));
  }, () => {}, () => {});
  const strings: string[] = [];
  if (zip.file('xl/sharedStrings.xml')) {
    let inItem = false, inText = false, value = '';
    xmlEvents(await read('xl/sharedStrings.xml'), tag => {
      if (tag.name === 'si') { inItem = true; value = ''; }
      if (tag.name === 't' && inItem) inText = true;
    }, text => { if (inText) value += text; }, tag => {
      if (tag.name === 't') inText = false;
      if (tag.name === 'si') { strings.push(value); inItem = false; if (strings.length > 250000) throw new ImportReview('Слишком много строк в словаре Excel.'); }
    });
  }
  for (const item of names.filter(item => ['order form', 'd cmr', 'quality certificate'].includes(item.name))) {
    const target = relations.get(item.relation);
    if (!target) throw new ImportReview('Не найден лист инвойса.');
    const location = path.posix.normalize(target.startsWith('/') ? target.slice(1) : 'xl/' + target);
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(location)) throw new ImportReview('Некорректная ссылка на лист Excel.');
    const sheet: ValueSheet = { cells: new Map(), rowCount: 0 };
    let address = '', type = '', capture = false, value = '';
    xmlEvents(await read(location), tag => {
      if (tag.name === 'c') { address = String(tag.attributes.r || ''); type = String(tag.attributes.t || ''); value = ''; }
      if (tag.name === 'v' || (tag.name === 't' && type === 'inlineStr')) capture = true;
    }, text => { if (capture) value += text; }, tag => {
      if (tag.name === 'v' || tag.name === 't') capture = false;
      if (tag.name !== 'c' || !value || type === 'e') return;
      if (!/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(address)) throw new ImportReview('Некорректная ячейка Excel.');
      const row = Number(address.match(/\d+$/)![0]);
      if (row > 200) throw new ImportReview('Формат листа инвойса отличается от поддерживаемого шаблона.');
      sheet.rowCount = Math.max(sheet.rowCount, row);
      sheet.cells.set(address, type === 's' ? strings[Number(value)] || '' : value);
    });
    if (sheets.has(item.name)) throw new ImportReview('В Excel повторяются названия листов инвойса.');
    sheets.set(item.name, sheet);
  }
  return sheets;
}
function cellText(sheet: ValueSheet | undefined, address: string): string {
  let value: any = sheet?.cells.get(address);
  if (value && typeof value === 'object') {
    if ('result' in value) value = value.result;
    else if (value.richText) value = value.richText.map((part: any) => part.text).join('');
    else if ('text' in value) value = value.text;
    else return '';
  }
  return value === undefined || value === null ? '' : String(value).trim();
}
function documentDate(text: string) {
  const match = text.match(/\b(\d{2})[./](\d{2})[./](\d{4})\b/);
  if (!match) return undefined;
  const date = `${match[3]}-${match[2]}-${match[1]}`;
  return !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().startsWith(date) ? date : undefined;
}
export async function parseInvoiceWorkbook(bytes: Buffer, fileName: string): Promise<InvoiceDraft> {
  const name = invoiceName(fileName);
  if (!/\.xlsx$/i.test(fileName)) throw new ImportReview('Для автоматического разбора нужен Excel в формате .xlsx. Исходное письмо доступно в Outlook.');
  checkWorkbookSize(bytes);
  let sheets: Map<string, ValueSheet>;
  try {
    // Read the three business sheets directly. Styling, images, dictionaries
    // of other customers and external links are not parsed or recalculated.
    sheets = await readValueSheets(bytes);
  } catch (error) { if (error instanceof ImportReview) throw error; throw new ImportReview('Не удалось прочитать Excel-файл.', { cause: error }); }
  const sheet = (name: string) => sheets.get(name.toLowerCase());
  const order = sheet('Order Form'), cmr = sheet('D CMR');
  const orderName = cellText(order, 'I2');
  if (!orderName || invoiceKey(orderName) !== invoiceKey(name)) throw new ImportReview('Название Excel не совпадает с Order Name внутри файла или формат таблицы отличается.');
  const fullInvoice = cellText(cmr, 'A15').match(/INVOICE\s*:\s*#?\s*([\w.\/-]+)/i)?.[1];
  if (!fullInvoice) throw new ImportReview('В Excel не найден полный номер инвойса в CMR.');
  const shortNumber = name.match(/(\d+(?:[.-]\d+)*)$/)?.[1];
  if (!shortNumber || (fullInvoice !== shortNumber && !fullInvoice.endsWith('-' + shortNumber))) {
    throw new ImportReview('Номер инвойса в CMR не совпадает с названием Excel.');
  }
  const origin = cellText(cmr, 'J12') || cellText(cmr, 'A12');
  const destination = cellText(cmr, 'A10');
  const route = /almaty|алмат[ыа]/i.test(destination) ? /amol|амол/i.test(origin) ? 'Amol - Almaty' : /tehran|тегеран/i.test(origin) ? 'Tehran - Almaty' : undefined : undefined;
  if (!route) throw new ImportReview('Маршрут в документе не распознан. Создайте отправление вручную после проверки.');
  const plate = cellText(cmr, 'C14'), qualityPlate = cellText(sheet('Quality Certificate'), 'B18');
  if (plate && qualityPlate && invoiceKey(plate) !== invoiceKey(qualityPlate)) throw new ImportReview('Номера машины в CMR и сертификате качества различаются.');
  const items = new Set<string>();
  for (let row = 5; row <= Math.min(order!.rowCount, 200); row++) {
    if (!/^\d+$/.test(cellText(order, `C${row}`)) || !(Number(cellText(order, `L${row}`)) > 0)) continue;
    const product = cellText(order, `F${row}`);
    if (product) items.add(product);
  }
  return { invoice_id: name, commercial_invoice_number: fullInvoice, route,
    ...(documentDate(cellText(cmr, 'A16')) ? { invoice_date: documentDate(cellText(cmr, 'A16')) } : {}),
    ...(documentDate(cellText(cmr, 'A12')) ? { loading_date: documentDate(cellText(cmr, 'A12')) } : {}),
    ...(plate || qualityPlate ? { plate_number: plate || qualityPlate } : {}),
    ...(items.size ? { goods: [...items].join(', ') } : {}), items: [...items] };
}
export function mergeMailShipment(existing: Partial<Shipment> | undefined, draft: InvoiceDraft,
  documents: MailDocument[], receivedAt: string, originalUrl: string, travelDays: number, actor: string, now: string): Partial<Shipment> {
  const oldDate = existing?.documents_received_at;
  const firstReceived = oldDate && Date.parse(oldDate) <= Date.parse(receivedAt) ? oldDate : receivedAt;
  const oldDocuments = existing?.mail_documents || [];
  const known = new Set(oldDocuments.map(doc => doc.sha256));
  const additions = documents.filter(doc => { if (known.has(doc.sha256)) return false; known.add(doc.sha256); return true; });
  const merged: Partial<Shipment> = {
    documents_received_at: firstReceived,
    mail_documents: [...oldDocuments, ...additions],
    documents_url: [...new Set([...(existing?.documents_url || []), ...additions.map(doc => doc.url)])],
    source_email_urls: [...new Set([...(existing?.source_email_urls || []), originalUrl])],
    last_updated: now,
  };
  if (!existing) {
    Object.assign(merged, draft, { departure_date: firstReceived, transit_start_source: 'email',
      est_travel_time: travelDays, arrival_deadline: new Date(Date.parse(firstReceived) + travelDays * 86400000).toISOString(),
      status: 'In Transit', createdBy: actor });
  } else if (existing.transit_start_source === 'email' && firstReceived !== oldDate) {
    merged.arrival_deadline = new Date(Date.parse(firstReceived) + (existing.est_travel_time || travelDays) * 86400000).toISOString();
  }
  return merged;
}
