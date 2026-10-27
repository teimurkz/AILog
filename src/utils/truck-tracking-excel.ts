import * as XLSX from 'xlsx';
import { formatTrackingDate, stageDate, stageDateLabel, stageLabel, type TruckStage, type TruckTrackingEntry } from '../../shared/truck-tracking';
import { TRACKING_TEXT, type TrackingLanguage } from '../../shared/truck-tracking-i18n';

function entriesSheet(entries: TruckTrackingEntry[], stages: TruckStage[], language: TrackingLanguage) {
  const text = TRACKING_TEXT[language];
  const labels = Object.fromEntries(stages.map(stage => [stage.id, stageLabel(stage, language)]));
  const dateLabels = stages.map(stage => stageDateLabel(stage, language));
  const header = [text.invoice, text.productName, ...dateLabels, text.status, text.comment, text.changedAt, text.changedBy];
  const sheet = XLSX.utils.aoa_to_sheet([
    header,
    ...entries.map(entry => [
      entry.invoice, entry.productName, ...stages.map(stage => formatTrackingDate(stageDate(entry, stage.id))),
      labels[entry.status] || '', entry.comment || '',
      entry.updatedAt ? new Date(entry.updatedAt).toLocaleString(text.locale) : '', entry.updatedBy || '',
    ]),
  ]);
  sheet['!cols'] = [18, 40, ...dateLabels.map(label => Math.max(15, label.length + 2)), 24, 40, 20, 24].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: entries.length, c: header.length - 1 } }) };
  return sheet;
}

/** Excel sheet names: at most 31 characters, no []:*?/\ and unique within the workbook. */
function sheetName(name: string, taken: Set<string>) {
  const base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
  let result = base;
  for (let n = 2; taken.has(result.toLowerCase()); n += 1) result = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(result.toLowerCase());
  return result;
}

function newWorkbook(language: TrackingLanguage) {
  const workbook = XLSX.utils.book_new();
  // Excel shows the sheets right-to-left for Farsi.
  if (language === 'fa') workbook.Workbook = { Views: [{ RTL: true }] };
  return workbook;
}

export function truckTrackingWorkbook(entries: TruckTrackingEntry[], stages: TruckStage[], language: TrackingLanguage = 'ru') {
  const workbook = newWorkbook(language);
  XLSX.utils.book_append_sheet(workbook, entriesSheet(entries, stages, language), sheetName(TRACKING_TEXT[language].sheetMain, new Set()));
  return workbook;
}

/** "Экспорт всё": every truck regardless of filters, a summary and one sheet per stage. */
export function truckTrackingFullWorkbook(entries: TruckTrackingEntry[], stages: TruckStage[], language: TrackingLanguage = 'ru') {
  const text = TRACKING_TEXT[language];
  const workbook = newWorkbook(language);
  const taken = new Set<string>();
  const byStage = stages.map(stage => ({ stage, rows: entries.filter(entry => entry.status === stage.id) }));
  const summary = XLSX.utils.aoa_to_sheet([
    [text.summaryTitle],
    [text.exportedAt, new Date().toLocaleString(text.locale)],
    [],
    [text.status, text.truckCount],
    ...byStage.map(({ stage, rows }) => [stageLabel(stage, language), rows.length]),
    [text.total, entries.length],
  ]);
  summary['!cols'] = [{ wch: 36 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, summary, sheetName(text.sheetSummary, taken));
  XLSX.utils.book_append_sheet(workbook, entriesSheet(entries, stages, language), sheetName(text.sheetAll, taken));
  byStage.forEach(({ stage, rows }) =>
    XLSX.utils.book_append_sheet(workbook, entriesSheet(rows, stages, language), sheetName(stageLabel(stage, language), taken)));
  return workbook;
}

const fileDate = () => new Date().toISOString().slice(0, 10);

export function downloadTruckTracking(entries: TruckTrackingEntry[], stages: TruckStage[], language: TrackingLanguage) {
  XLSX.writeFile(truckTrackingWorkbook(entries, stages, language), `Slezhka_avto_${fileDate()}.xlsx`);
}

export function downloadTruckTrackingAll(entries: TruckTrackingEntry[], stages: TruckStage[], language: TrackingLanguage) {
  XLSX.writeFile(truckTrackingFullWorkbook(entries, stages, language), `Slezhka_avto_vse_${fileDate()}.xlsx`);
}

/** Reads the first sheet of an uploaded workbook as tab-separated text for the paste parser. */
export async function readWorkbookAsTsv(file: File) {
  const workbook = XLSX.read(await file.arrayBuffer());
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  return rows.map(row => row.map(cell => String(cell ?? '').replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n');
}
