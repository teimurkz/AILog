import * as pdfParseModule from "pdf-parse";
import { getGemini } from "../config/gemini.js";
import { extractInvoiceNumberFromText } from "../utils/helpers.js";

const pdfParse = (pdfParseModule as any).default || pdfParseModule;

export async function parseInvoiceDocument(fileData: string, fileName?: string, fileType?: string) {
  if (!fileData) {
    throw new Error("No file data provided");
  }

  const matches = fileData.match(/^data:(.+);base64,(.+)$/);
  let mimeType = fileType || "application/pdf";
  let base64 = fileData;
  if (matches) {
    mimeType = matches[1];
    base64 = matches[2];
  }

  if (!mimeType || mimeType === 'application/octet-stream') {
    if (fileName?.endsWith('.pdf')) mimeType = 'application/pdf';
    else if (fileName?.endsWith('.jpg') || fileName?.endsWith('.jpeg')) mimeType = 'image/jpeg';
    else if (fileName?.endsWith('.png')) mimeType = 'image/png';
    else mimeType = 'application/pdf';
  }

  // 1. Try pdf-parse first if it's a PDF
  if (mimeType === 'application/pdf' || fileName?.toLowerCase().endsWith('.pdf')) {
    try {
      const pdfBuffer = Buffer.from(base64, 'base64');
      const pdfData = await pdfParse(pdfBuffer);
      if (pdfData && pdfData.text) {
        console.log("PDF parsed text length:", pdfData.text.length);
        const extracted = extractInvoiceNumberFromText(pdfData.text);
        if (extracted) {
          console.log("Successfully extracted invoice number via pdf-parse:", extracted);
          return { invoiceNumber: extracted, source: 'pdf-parse' };
        }
      }
    } catch (pdfErr: any) {
      console.error("PDF-parse failed, falling back to Gemini Vision:", pdfErr?.message || pdfErr);
    }
  }

  // 2. Fallback to Gemini Vision
  const ai = getGemini();
  if (!ai) {
    return { invoiceNumber: null, message: "Gemini API key not configured and PDF text parse did not yield result" };
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        role: "user",
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64,
            },
          },
          {
            text: `Ты — экспертная OCR-система для накладных и первичных документов (Форма З-2, 1С накладная, ТТН, Торг-12).

ВНИМАТЕЛЬНО НАЙДИ НОМЕР НАКЛАДНОЙ / НОМЕР ДОКУМЕНТА:
1. В верхней правой таблице под заголовком "Номер документа" стоит номер (например, 46969).
2. Или в заголовке "НАКЛАДНАЯ №...".
3. Выдели ТОЛЬКО сам чистый номер документа (без слов "Номер", "№").

Верни СТРОГО JSON без markdown:
{"invoiceNumber": "46969"}`
          }
        ]
      }
    ]
  });

  const text = response.text || "";
  console.log("Gemini response text:", text);
  let invoiceNumber = null;

  try {
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.invoiceNumber && parsed.invoiceNumber !== "null") {
      invoiceNumber = String(parsed.invoiceNumber).trim();
    }
  } catch (pErr) {
    invoiceNumber = extractInvoiceNumberFromText(text);
    if (!invoiceNumber) {
      const numMatch = text.match(/(\b\d{3,12}\b)/);
      if (numMatch) invoiceNumber = numMatch[1];
    }
  }

  return { invoiceNumber, source: 'gemini' };
}
