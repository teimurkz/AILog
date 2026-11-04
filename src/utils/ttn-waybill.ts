import * as XLSX from 'xlsx';
import {
  linesFromPdfItems, linesFromSheetRows, waybillDetails, waybillGoods, type GridLine, type PdfTextItem, type TtnItem, type WaybillDetails,
} from '../../shared/ttn';
import type { InvoiceItem } from '../types';

export interface WaybillFile {
  label: string;
  fileName: string;
  fileType: string;
  fileData: string;
}

export type WaybillResult =
  | { file: WaybillFile; status: 'ok'; items: TtnItem[]; details: WaybillDetails }
  | { file: WaybillFile; status: 'empty' | 'unsupported' | 'failed'; items: [] };

/** Files attached to a regional order: the list of invoices, or the single file of older orders. */
export function orderWaybills(order: { invoices?: InvoiceItem[]; invoiceNumber?: string; invoiceFileName?: string; invoiceFileData?: string; invoiceFileType?: string }): WaybillFile[] {
  const label = (number?: string) => number ? `Накладная №${number.replace(/^накладная\s*№?\s*/i, '')}` : '';
  const files = (order.invoices || [])
    .filter(invoice => invoice.fileData)
    .map(invoice => ({ label: label(invoice.invoiceNumber), fileName: invoice.fileName || '', fileType: invoice.fileType || '', fileData: invoice.fileData! }));
  if (!files.length && order.invoiceFileData) {
    files.push({ label: label(order.invoiceNumber), fileName: order.invoiceFileName || '', fileType: order.invoiceFileType || '', fileData: order.invoiceFileData });
  }
  return files;
}

const bytesOf = (dataUrl: string) => {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const kindOf = (file: WaybillFile) => {
  const name = file.fileName.toLowerCase();
  const type = (file.fileType || file.fileData.slice(5, file.fileData.indexOf(';'))).toLowerCase();
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (type.includes('sheet') || type.includes('excel') || /\.xlsx?$/.test(name)) return 'excel';
  return 'other';
};

function excelLines(bytes: Uint8Array): GridLine[] {
  const workbook = XLSX.read(bytes, { type: 'array' });
  return workbook.SheetNames.flatMap(name => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true });
    return linesFromSheetRows(rows, sheet['!merges'] || []);
  });
}

async function pdfLines(bytes: Uint8Array): Promise<GridLine[]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  try {
    const lines: GridLine[] = [];
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const items: PdfTextItem[] = content.items.flatMap(item => 'str' in item
        ? [{ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width }]
        : []);
      lines.push(...linesFromPdfItems(items));
    }
    return lines;
  } finally {
    await pdf.destroy();
  }
}

/** Goods lines of one attached waybill. Scans and photos have no text to read: those are typed in by hand. */
export async function readWaybill(file: WaybillFile): Promise<WaybillResult> {
  const kind = kindOf(file);
  if (kind === 'other') return { file, status: 'unsupported', items: [] };
  try {
    const bytes = bytesOf(file.fileData);
    const lines = kind === 'pdf' ? await pdfLines(bytes) : excelLines(bytes);
    const items = waybillGoods(lines, file.label);
    return items.length ? { file, status: 'ok', items, details: waybillDetails(lines) } : { file, status: 'empty', items: [] };
  } catch (error) {
    console.error('Waybill read failed:', file.fileName, error);
    return { file, status: 'failed', items: [] };
  }
}
