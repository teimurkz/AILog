import * as XLSX from 'xlsx';
import { formatTrackingDate, stageDate, type TruckStage, type TruckTrackingEntry } from '../../shared/truck-tracking';

function entriesSheet(entries: TruckTrackingEntry[], stages: TruckStage[]) {
  const labels = Object.fromEntries(stages.map(stage => [stage.id, stage.label]));
  const header = ['Инвойс', 'Наименование продукта', ...stages.map(stage => stage.dateLabel), 'Статус', 'Комментарий', 'Изменено', 'Кем изменено'];
  const sheet = XLSX.utils.aoa_to_sheet([
    header,
    ...entries.map(entry => [
      entry.invoice, entry.productName, ...stages.map(stage => formatTrackingDate(stageDate(entry, stage.id))),
      labels[entry.status] || '', entry.comment || '',
      entry.updatedAt ? new Date(entry.updatedAt).toLocaleString('ru-RU') : '', entry.updatedBy || '',
    ]),
  ]);
  sheet['!cols'] = [18, 40, ...stages.map(stage => Math.max(15, stage.dateLabel.length + 2)), 24, 40, 20, 24].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: entries.length, c: header.length - 1 } }) };
  return sheet;
}

/** Excel sheet names: at most 31 characters, no []:*?/\ and unique within the workbook. */
function sheetName(name: string, taken: Set<string>) {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Этап').slice(0, 31);
  let result = base;
  for (let n = 2; taken.has(result.toLowerCase()); n += 1) result = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(result.toLowerCase());
  return result;
}

export function truckTrackingWorkbook(entries: TruckTrackingEntry[], stages: TruckStage[]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, entriesSheet(entries, stages), 'Слежка авто');
  return workbook;
}

/** "Экспорт всё": every truck regardless of filters, a summary and one sheet per stage. */
export function truckTrackingFullWorkbook(entries: TruckTrackingEntry[], stages: TruckStage[]) {
  const workbook = XLSX.utils.book_new();
  const taken = new Set<string>();
  const byStage = stages.map(stage => ({ stage, rows: entries.filter(entry => entry.status === stage.id) }));
  const summary = XLSX.utils.aoa_to_sheet([
    ['Слежка авто — все статусы'],
    ['Выгружено', new Date().toLocaleString('ru-RU')],
    [],
    ['Статус', 'Количество фур'],
    ...byStage.map(({ stage, rows }) => [stage.label, rows.length]),
    ['ИТОГО', entries.length],
  ]);
  summary['!cols'] = [{ wch: 36 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, summary, sheetName('Сводка', taken));
  XLSX.utils.book_append_sheet(workbook, entriesSheet(entries, stages), sheetName('Все фуры', taken));
  byStage.forEach(({ stage, rows }) => XLSX.utils.book_append_sheet(workbook, entriesSheet(rows, stages), sheetName(stage.label, taken)));
  return workbook;
}

const fileDate = () => new Date().toISOString().slice(0, 10);

export function downloadTruckTracking(entries: TruckTrackingEntry[], stages: TruckStage[]) {
  XLSX.writeFile(truckTrackingWorkbook(entries, stages), `Slezhka_avto_${fileDate()}.xlsx`);
}

export function downloadTruckTrackingAll(entries: TruckTrackingEntry[], stages: TruckStage[]) {
  XLSX.writeFile(truckTrackingFullWorkbook(entries, stages), `Slezhka_avto_vse_${fileDate()}.xlsx`);
}

/** Reads the first sheet of an uploaded workbook as tab-separated text for the paste parser. */
export async function readWorkbookAsTsv(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  return rows.map(row => row.map(cell => String(cell ?? '').replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');
}
