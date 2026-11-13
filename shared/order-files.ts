/**
 * Files attached to a regional truck order. They live inside the order document as data URLs,
 * so all of them together must fit into one Firestore document (1 MiB).
 */

export interface OrderFileSource {
  invoiceNumber?: string;
  fileName?: string;
  fileData?: string;
  fileType?: string;
  fileSize?: string;
}

export interface OrderAttachment {
  /** Waybill number the file belongs to. */
  invoiceNumber: string;
  fileName: string;
  fileType: string;
  fileData: string;
  fileSize: string;
  /** Only the name was kept: older orders dropped files that were too large. */
  missing: boolean;
}

export type AttachmentKind = 'image' | 'pdf' | 'excel' | 'other';

/** Room for file data in one order, in data URL characters; the rest of the document needs the remainder. */
export const ORDER_FILES_BUDGET = 900_000;

/** Every attached file of an order, in waybill order; older orders kept a single file outside the list. */
export function orderAttachments(order: {
  invoices?: OrderFileSource[]; invoiceNumber?: string; invoiceFileName?: string; invoiceFileData?: string; invoiceFileType?: string;
}): OrderAttachment[] {
  const files: OrderAttachment[] = (order.invoices || [])
    .filter(invoice => invoice.fileData || invoice.fileName)
    .map(invoice => ({
      invoiceNumber: invoice.invoiceNumber || '',
      fileName: invoice.fileName || '',
      fileType: invoice.fileType || '',
      fileData: invoice.fileData || '',
      fileSize: invoice.fileSize || '',
      missing: !invoice.fileData,
    }));
  if (!files.some(file => !file.missing) && order.invoiceFileData) {
    const legacy = files.find(file => file.fileName && file.fileName === order.invoiceFileName);
    if (legacy) Object.assign(legacy, { fileData: order.invoiceFileData, fileType: legacy.fileType || order.invoiceFileType || '', missing: false });
    else files.unshift({
      invoiceNumber: order.invoices?.[0]?.invoiceNumber || order.invoiceNumber || '',
      fileName: order.invoiceFileName || '', fileType: order.invoiceFileType || '', fileData: order.invoiceFileData, fileSize: '', missing: false,
    });
  }
  return files;
}

export function attachmentKind(file: { fileName?: string; fileType?: string; fileData?: string }): AttachmentKind {
  const name = (file.fileName || '').toLowerCase();
  const data = file.fileData || '';
  const type = (file.fileType || (data.startsWith('data:') ? data.slice(5, data.indexOf(';')) : '')).toLowerCase();
  if (type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/.test(name)) return 'image';
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (type.includes('sheet') || type.includes('excel') || /\.xlsx?$/.test(name)) return 'excel';
  return 'other';
}

/** Characters of file data the files take together. */
export const attachmentsSize = (files: Array<{ fileData?: string }>) =>
  files.reduce((total, file) => total + (file.fileData?.length || 0), 0);

/** A data URL as a Blob, so the browser can show or open a large file without putting it into a URL. */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  const header = dataUrl.slice(5, comma);
  const type = header.split(';')[0] || 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (header.includes(';base64')) {
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(body)], { type });
}
