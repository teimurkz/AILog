import * as XLSX from 'xlsx';
import { formatDay } from '../../shared/work-reports';

/** One report table: an Excel sheet and a card on the analytics page share it. */
export interface ReportTable { title: string; header: string[]; rows: (string | number | null)[][] }

function sheet(table: ReportTable) {
  const result = XLSX.utils.aoa_to_sheet([table.header, ...table.rows.map(row => row.map(cell => cell ?? ''))]);
  result['!cols'] = table.header.map((title, column) => ({
    wch: Math.min(50, Math.max(title.length, ...table.rows.map(row => String(row[column] ?? '').length)) + 2),
  }));
  if (table.rows.length) result['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: table.rows.length, c: table.header.length - 1 } }) };
  return result;
}

/** Downloads the tables as one workbook, a sheet per table. */
export function downloadReports(tables: ReportTable[], period: { from: string; to: string }, name = 'Отчёты') {
  const workbook = XLSX.utils.book_new();
  const taken = new Set<string>();
  for (const table of tables) {
    let title = table.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);
    for (let n = 2; taken.has(title.toLowerCase()); n++) title = `${title.slice(0, 28)} ${n}`;
    taken.add(title.toLowerCase());
    XLSX.utils.book_append_sheet(workbook, sheet(table), title);
  }
  XLSX.writeFile(workbook, `${name} ${formatDay(period.from)}-${formatDay(period.to)}.xlsx`);
}
