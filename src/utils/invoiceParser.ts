import * as XLSX from 'xlsx';

export function cleanInvoiceNumber(val: any): string | null {
  if (val === null || val === undefined) return null;
  let str = String(val).trim();
  if (!str || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') return null;
  // Remove leading №, No, :, #
  str = str.replace(/^[№No:#\s]+/, '').trim();
  // If it's something like "46969.0" from excel float numbers, convert to "46969"
  if (/^\d+\.0$/.test(str)) {
    str = str.replace(/\.0$/, '');
  }
  if (str.length >= 2) return str;
  return null;
}

export function extractInvoiceNumberFromText(text: string): string | null {
  if (!text) return null;

  const normText = text.replace(/\r/g, '');

  // 1. Form З-2 layout: "Номер \n документа \n Дата \n составления \n 46969 31.07.2026"
  const formZ2Match = normText.match(/Номер[\s\S]{0,80}?документа[\s\S]{0,80}?([A-Za-z0-9\-_/]{2,25})\s+\d{2}\.\d{2}\.\d{2,4}/i);
  if (formZ2Match && formZ2Match[1] && !/^(дата|составления|форма|приложение|номер|документа)$/i.test(formZ2Match[1])) {
    const cleaned = cleanInvoiceNumber(formZ2Match[1]);
    if (cleaned) return cleaned;
  }

  // 2. Direct labels: "Номер документа: 46969" or "Номер документа 46969" or "№ документа 46969"
  const patterns = [
    /(?:номер\s*документа|№\s*документа)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:накладная\s*на\s*отпуск[^\n]*?№?|накладная\s*№|номер\s*накладной|№\s*накладной)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:номер\s*заказа|№\s*заказа|заказ\s*№)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:документ\s*№)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
    /(?:товарно-транспортная\s*накладная\s*№)\s*[:№\s]*([A-Za-z0-9\-_/]{2,30})/i,
  ];

  for (const pattern of patterns) {
    const match = normText.match(pattern);
    if (match && match[1]) {
      const cleaned = cleanInvoiceNumber(match[1]);
      if (cleaned && !/^(дата|составления|форма|приложение|номер|документа)$/i.test(cleaned)) {
        return cleaned;
      }
    }
  }

  // 3. Fallback for "Номер" + "документа" followed within 100 chars by a standalone number (e.g. 46969)
  const z2Fallback = normText.match(/Номер\s*документа[\s\S]{0,100}?(\b\d{3,12}\b)/i);
  if (z2Fallback && z2Fallback[1]) {
    const cleaned = cleanInvoiceNumber(z2Fallback[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

export async function parseInvoiceFromExcel(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        for (const sheetName of workbook.SheetNames) {
          const worksheet = workbook.Sheets[sheetName];
          const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            if (!row) continue;
            for (let c = 0; c < row.length; c++) {
              const cellVal = String(row[c] || '').trim();
              if (!cellVal) continue;

              // 1. Direct inline pattern match
              const inlineMatch = extractInvoiceNumberFromText(cellVal);
              if (inlineMatch) {
                return resolve(inlineMatch);
              }

              // 2. Exact or close label match in cell (e.g. "Номер Документа")
              if (/(номер\s*документа|номер\s*накладной|номер\s*заказа|№\s*документа|№\s*накладной)/i.test(cellVal)) {
                // Check adjacent columns (c+1, c+2, c+3)
                for (let offset = 1; offset <= 3; offset++) {
                  const nextColVal = cleanInvoiceNumber(row[c + offset]);
                  if (nextColVal && !/^(дата|составления|форма)$/i.test(nextColVal)) {
                    return resolve(nextColVal);
                  }
                }
                // Check rows below (r+1, r+2)
                for (let rOffset = 1; rOffset <= 2; rOffset++) {
                  if (rows[r + rOffset] && rows[r + rOffset][c]) {
                    const belowVal = cleanInvoiceNumber(rows[r + rOffset][c]);
                    if (belowVal && !/^(дата|составления|форма)$/i.test(belowVal)) {
                      return resolve(belowVal);
                    }
                  }
                }
              }
            }
          }
        }
        resolve(null);
      } catch (err) {
        console.error("Error parsing Excel for invoice number:", err);
        resolve(null);
      }
    };
    reader.onerror = () => resolve(null);
    reader.readAsArrayBuffer(file);
  });
}

export async function parseInvoiceNumberServer(fileDataUrl: string, fileName: string, fileType: string): Promise<string | null> {
  try {
    const response = await fetch('/api/parse-invoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileData: fileDataUrl,
        fileName,
        fileType,
      }),
    });
    if (!response.ok) {
      console.error("Server parse invoice error status:", response.status);
      return null;
    }
    const data = await response.json();
    return data.invoiceNumber || null;
  } catch (err) {
    console.error("Server parse invoice error:", err);
    return null;
  }
}

export async function extractInvoiceNumberFromDocument(
  file: File, 
  dataUrl: string
): Promise<string | null> {
  const fileName = file.name.toLowerCase();
  const fileType = file.type;

  // 1. If it's an Excel spreadsheet, parse locally first for immediate result
  if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileType.includes('spreadsheet') || fileType.includes('excel')) {
    const excelMatch = await parseInvoiceFromExcel(file);
    if (excelMatch) return excelMatch;
  }

  // 2. If it's a plain text file or csv
  if (fileType.includes('text') || fileName.endsWith('.txt') || fileName.endsWith('.csv')) {
    try {
      const text = await file.text();
      const textMatch = extractInvoiceNumberFromText(text);
      if (textMatch) return textMatch;
    } catch (e) {
      console.error(e);
    }
  }

  // 3. Call Server API (pdf-parse + Gemini Vision)
  const serverResult = await parseInvoiceNumberServer(dataUrl, file.name, file.type);
  if (serverResult) return serverResult;

  // 4. Try extract from filename if filename has "накладная_88412" or "46969"
  const fileNameMatch = extractInvoiceNumberFromText(file.name);
  if (fileNameMatch) return fileNameMatch;

  return null;
}
