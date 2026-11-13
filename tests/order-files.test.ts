import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentKind, attachmentsSize, dataUrlToBlob, orderAttachments } from '../shared/order-files';

const pdf = (text: string) => `data:application/pdf;base64,${Buffer.from(text).toString('base64')}`;

test('every attached waybill is listed, not only the first one', () => {
  const files = orderAttachments({
    invoiceNumber: 'Накладные: 101, 102, 103 (3 шт)',
    invoiceFileName: 'a.pdf', invoiceFileData: pdf('a'), invoiceFileType: 'application/pdf',
    invoices: [
      { invoiceNumber: '101', fileName: 'a.pdf', fileData: pdf('a'), fileType: 'application/pdf' },
      { invoiceNumber: '102', fileName: 'b.xls', fileData: 'data:application/vnd.ms-excel;base64,AA==', fileType: 'application/vnd.ms-excel' },
      { invoiceNumber: '103', fileName: 'c.jpg', fileData: 'data:image/jpeg;base64,AA==', fileType: 'image/jpeg' },
      { invoiceNumber: '104' },
    ],
  });
  assert.deepEqual(files.map(file => [file.invoiceNumber, attachmentKind(file)]), [['101', 'pdf'], ['102', 'excel'], ['103', 'image']]);
});

test('a file dropped by older orders is shown as missing; the legacy single file still opens', () => {
  const dropped = orderAttachments({ invoices: [{ invoiceNumber: '7', fileName: 'big.pdf', fileData: '' }] });
  assert.deepEqual(dropped.map(file => [file.fileName, file.missing]), [['big.pdf', true]]);
  // Orders from before the list kept the file only in the summary fields.
  const legacy = orderAttachments({ invoiceNumber: '55', invoiceFileName: 'x.pdf', invoiceFileData: pdf('x'), invoiceFileType: 'application/pdf' });
  assert.deepEqual(legacy.map(file => [file.invoiceNumber, file.missing]), [['55', false]]);
  // The list named the file, the data was only in the summary: one entry, not two.
  const both = orderAttachments({ invoiceFileName: 'x.pdf', invoiceFileData: pdf('x'), invoices: [{ invoiceNumber: '55', fileName: 'x.pdf', fileData: '' }] });
  assert.deepEqual(both.map(file => [file.invoiceNumber, file.missing]), [['55', false]]);
});

test('file size budget and blob decoding', () => {
  assert.equal(attachmentsSize([{ fileData: 'abc' }, {}, { fileData: 'de' }]), 5);
  const blob = dataUrlToBlob(pdf('hello'));
  assert.equal(blob?.type, 'application/pdf');
  assert.equal(blob?.size, 5);
  assert.equal(dataUrlToBlob('https://example.com/a.pdf'), null);
});
