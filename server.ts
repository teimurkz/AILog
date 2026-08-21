import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { fileURLToPath } from "url";
import fs from "fs";
import https from "https";
import { GoogleGenAI } from "@google/genai";
import * as pdfParseModule from "pdf-parse";
import * as XLSX from "xlsx";
import nodemailer from "nodemailer";
import ExcelJS from "exceljs";
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return geminiClient;
}

function extractInvoiceNumberFromText(text: string): string | null {
  if (!text) return null;
  const normText = text.replace(/\r/g, '');

  // 1. Form З-2 layout: "Номер \n документа \n Дата \n составления \n 46969 31.07.2026"
  const formZ2Match = normText.match(/Номер[\s\S]{0,80}?документа[\s\S]{0,80}?([A-Za-z0-9\-_/]{2,25})\s+\d{2}\.\d{2}\.\d{2,4}/i);
  if (formZ2Match && formZ2Match[1] && !/^(дата|составления|форма|приложение|номер|документа)$/i.test(formZ2Match[1])) {
    const val = formZ2Match[1].replace(/^[№No:#\s]+/, '').trim();
    if (val.length >= 2) return val;
  }

  // 2. Direct labels
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
      const val = match[1].replace(/^[№No:#\s]+/, '').trim();
      if (val.length >= 2 && !/^(дата|составления|форма|приложение|номер|документа)$/i.test(val)) {
        return val;
      }
    }
  }

  // 3. Fallback for "Номер" + "документа" followed within 100 chars by a standalone number
  const z2Fallback = normText.match(/Номер\s*документа[\s\S]{0,100}?(\b\d{3,12}\b)/i);
  if (z2Fallback && z2Fallback[1]) {
    return z2Fallback[1].trim();
  }

  return null;
}

const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));

console.log(`Initializing Firebase Admin for project: ${firebaseConfig.projectId}, database: ${firebaseConfig.firestoreDatabaseId}`);

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}
const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

let customSpreadsheetId = '1FRwicnGLMSD2jurukoLPEa5kGmycpwAHnBvObJX7kCQ';

function extractPalletNumeric(palletStr: string | number): number {
  if (palletStr == null || palletStr === '') return 0;
  if (typeof palletStr === 'number') return isNaN(palletStr) ? 0 : palletStr;
  const normalized = String(palletStr).replace(/,/g, '.');
  const matches = normalized.match(/\d+(\.\d+)?/g);
  if (!matches) return 0;
  return matches.reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0);
}

function formatCellDate(val: any): string {
  if (val == null || val === '') return '';
  if (typeof val === 'number' && val > 30000 && val < 60000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    const day = ('0' + d.getUTCDate()).slice(-2);
    const month = ('0' + (d.getUTCMonth() + 1)).slice(-2);
    const year = d.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }
  return String(val).trim();
}

function fetchBufferWithRedirects(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects while downloading Google Sheet'));
    
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      },
      timeout: 20000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchBufferWithRedirects(res.headers.location, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Google Sheets HTTP status ${res.statusCode}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Google Sheets download timed out'));
    });
  });
}

function fetchGvizSheet(sheetName: string, spreadsheetId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&_t=${Date.now()}`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': '*/*'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Simple redirect follow
        https.get(res.headers.location, (redirRes) => {
          let data = '';
          redirRes.on('data', chunk => data += chunk);
          redirRes.on('end', () => resolve(data));
        }).on('error', reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GViz request timed out'));
    });
  });
}

function parseGvizResponse(rawText: string) {
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('Invalid GViz response format');
  }
  const jsonStr = rawText.substring(start, end + 1);
  const json = JSON.parse(jsonStr);
  if (json.status === 'error') {
    throw new Error(json.errors?.[0]?.detailed_message || 'GViz query error');
  }

  const cols = json.table.cols.map((c: any, i: number) => c.label || `Col_${i}`);
  const rows = json.table.rows.map((r: any) => {
    if (!r || !r.c) return [];
    return r.c.map((cell: any) => {
      if (!cell) return null;
      return cell.f !== undefined && cell.f !== null ? cell.f : cell.v;
    });
  });

  return { cols, rows };
}

function parseWorkbookToWarehouses(buffer: Buffer): any[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const result: any[] = [];

  for (const sheetName of wb.SheetNames) {
    if (sheetName.toLowerCase().includes('список_документов')) continue;

    const ws = wb.Sheets[sheetName];
    const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rawRows || rawRows.length === 0) continue;

    const sLower = sheetName.toLowerCase();
    const isTrucksReport = sLower.includes('машин') || sLower.includes('авто') || sLower.includes('отчет');
    const isArchive = sLower.includes('кусто') || sLower.includes('архив');

    if (isTrucksReport) {
      let reportDate = '';
      if (rawRows[0]) {
        for (const cell of rawRows[0]) {
          const formatted = formatCellDate(cell);
          if (formatted.match(/\d{2}\.\d{2}\.\d{4}/)) {
            reportDate = formatted;
            break;
          }
        }
      }

      const items: any[] = [];
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        const rowStr = row.map(c => String(c).trim()).join(' ');
        if (!rowStr) continue;
        if (rowStr.includes('Инвойс') && rowStr.includes('Наименование')) continue;
        if (rowStr.includes('Дата прибытия') || rowStr.includes('Статус')) continue;
        if (i === 0 && rowStr.match(/\d{2}\.\d{2}\.\d{4}/) && row.filter(Boolean).length <= 2) continue;

        const invNum = row[0] != null && String(row[0]).trim() !== '' ? String(row[0]).trim() : '';
        const product = row[1] != null && String(row[1]).trim() !== '' ? String(row[1]).trim() : '';
        const dates = formatCellDate(row[2]);
        const svh = formatCellDate(row[3]);

        if (invNum || product || dates || svh) {
          items.push({
            id: `trucks-${items.length + 1}`,
            number: String(items.length + 1),
            invNumber: invNum,
            product,
            palletCount: '',
            dates,
            svh,
            isArchiveItem: false,
            isTrucksReportItem: true,
            rawRow: row
          });
        }
      }

      result.push({
        id: 'trucks_report',
        name: 'Отчет по машинам',
        sheetName,
        isArchive: false,
        isTrucksReport: true,
        reportDate: reportDate || new Date().toLocaleDateString('ru-RU'),
        cols: ['Инвойс', 'Наименование продукта', 'Дата прибытия', 'Статус'],
        items,
        totalPalletsNumeric: 0,
        itemCount: items.length
      });
      continue;
    }

    if (isArchive) {
      const items: any[] = [];
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        const rowStr = row.map(c => String(c).trim()).join(' ');
        if (!rowStr) continue;
        if (rowStr.includes('ИНВ') && rowStr.includes('товар')) continue;
        if (rowStr.includes('Апрель-Май') || rowStr.includes('Январь') || rowStr.includes('Февраль')) continue;

        const num = row[0] != null ? String(row[0]).trim() : '';
        const invNum = row[1] != null ? String(row[1]).trim() : '';
        const product = row[2] != null ? String(row[2]).trim() : '';
        const entryDate = formatCellDate(row[3]);
        const exitDate = formatCellDate(row[4]);

        if (product || invNum || entryDate || exitDate) {
          items.push({
            id: `archive-${items.length + 1}`,
            number: num || String(items.length + 1),
            invNumber: invNum,
            product,
            palletCount: '',
            entryDate,
            exitDate,
            dates: [entryDate ? `Заезд: ${entryDate}` : '', exitDate ? `Выезд: ${exitDate}` : ''].filter(Boolean).join(' | '),
            svh: 'СВХ Кусто (Архив)',
            isArchiveItem: true,
            rawRow: row
          });
        }
      }

      result.push({
        id: 'inv_kusto',
        name: 'Архив авто (СВХ Кусто)',
        sheetName,
        isArchive: true,
        isTrucksReport: false,
        cols: ['№', 'ИНВ', 'Товар', 'Заезд СВХ', 'Выезд СВХ'],
        items,
        totalPalletsNumeric: 0,
        itemCount: items.length
      });
      continue;
    }

    // Regular Warehouse sheets (А-Прейд, АСЕМ, ЦЭД, Бекмаханова, Жолдостар, etc.)
    const items: any[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.length === 0) continue;
      const rowStr = row.map(c => String(c).trim()).join(' ');
      if (!rowStr) continue;

      // Skip header lines
      const lowerRow = rowStr.toLowerCase();
      if ((lowerRow.includes('№') && lowerRow.includes('инв')) || 
          (lowerRow.includes('товар') && lowerRow.includes('паллет')) ||
          (lowerRow.startsWith('склад №') && row.filter(Boolean).length <= 2)) {
        continue;
      }

      let num = '';
      let invNum = '';
      let product = '';
      let palletCount = '';
      let dates = '';
      let svh = '';

      if (sLower.includes('цэд')) {
        num = row[0] != null ? String(row[0]).trim() : '';
        product = row[1] != null ? String(row[1]).trim() : '';
        svh = row[2] != null ? String(row[2]).trim() : '';
      } else {
        num = row[0] != null ? String(row[0]).trim() : '';
        invNum = row[1] != null ? String(row[1]).trim() : '';
        product = row[2] != null ? String(row[2]).trim() : '';
        palletCount = row[3] != null ? String(row[3]).trim() : '';
        dates = formatCellDate(row[4]);
        svh = row[5] != null ? String(row[5]).trim() : '';
      }

      if (num === '№' || invNum === 'ИНВ №' || product.toLowerCase() === 'товар') {
        continue;
      }

      if (product || invNum || palletCount || dates || svh) {
        items.push({
          id: `${sheetName}-${items.length + 1}`,
          number: num || String(items.length + 1),
          invNumber: invNum,
          product,
          palletCount,
          dates,
          svh,
          isArchiveItem: false,
          rawRow: row
        });
      }
    }

    let totalPalletsNumeric = 0;
    items.forEach(item => {
      totalPalletsNumeric += extractPalletNumeric(item.palletCount);
    });

    const slugId = sheetName.toLowerCase().replace(/[^a-zа-я0-9]/gi, '_');
    result.push({
      id: slugId,
      name: sheetName.replace(/_/g, ' ').trim(),
      sheetName,
      isArchive: false,
      isTrucksReport: false,
      cols: ['№', 'ИНВ №', 'Товар', 'Кол паллет', 'Даты', 'СВХ'],
      items,
      totalPalletsNumeric: Math.round(totalPalletsNumeric * 100) / 100,
      itemCount: items.length
    });
  }

  return result;
}

// In-memory cache for ultra-fast and resilient responses
let cachedWarehouseResult: any = null;
let lastSyncTimestamp: string = '';

async function getWarehouseData(forceRefresh = false) {
  const settings = await getMailingSettings();
  const spreadsheetId = (settings?.spreadsheetId || customSpreadsheetId || '1FRwicnGLMSD2jurukoLPEa5kGmycpwAHnBvObJX7kCQ').trim();
  customSpreadsheetId = spreadsheetId;

  // If cached and fresh (within 30 seconds) and not forceRefresh, return cache
  if (!forceRefresh && cachedWarehouseResult && lastSyncTimestamp) {
    const ageMs = Date.now() - new Date(lastSyncTimestamp).getTime();
    if (ageMs < 30000) {
      return cachedWarehouseResult;
    }
  }

  let result: any[] = [];
  let syncSuccess = false;
  let syncMethod = 'direct_xlsx';

  // Strategy 1: Direct XLSX download with follow-redirects (covers all sheets at once)
  try {
    const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
    const buffer = await fetchBufferWithRedirects(exportUrl);
    if (buffer && buffer.length > 1000) {
      result = parseWorkbookToWarehouses(buffer);
      if (result && result.length > 0) {
        syncSuccess = true;
      }
    }
  } catch (xlsxErr: any) {
    console.warn(`[Warehouse Sync] Direct XLSX fetch failed (${xlsxErr?.message || xlsxErr}), falling back to GViz...`);
  }

  // Strategy 2: Fallback to GViz if Direct XLSX didn't succeed
  if (!syncSuccess || result.length === 0) {
    syncMethod = 'gviz_fallback';
    const fallbackSheets = [
      { id: 'trucks_report', name: 'Отчет по машинам', sheetName: 'Отчет по машинам', isArchive: false, isTrucksReport: true },
      { id: 'apraid', name: 'А-Прейд', sheetName: 'А-Прейд', isArchive: false, isTrucksReport: false },
      { id: 'asem', name: 'АСЕМ', sheetName: 'АСЕМ', isArchive: false, isTrucksReport: false },
      { id: 'tsed', name: 'ЦЭД', sheetName: 'ЦЭД', isArchive: false, isTrucksReport: false },
      { id: 'inv_kusto', name: 'Архив авто (СВХ Кусто)', sheetName: 'инв_Кусто', isArchive: true, isTrucksReport: false },
    ];

    result = [];
    for (const wh of fallbackSheets) {
      try {
        const raw = await fetchGvizSheet(wh.sheetName, spreadsheetId);
        const { cols, rows } = parseGvizResponse(raw);

        if (wh.isTrucksReport) {
          let reportDate = '';
          if (rows.length > 0 && rows[0][1] && String(rows[0][1]).match(/\d{2}\.\d{2}\.\d{4}/)) {
            reportDate = String(rows[0][1]).trim();
          }

          const items = rows
            .filter((row, idx) => {
              if (idx === 0 && row[1] && String(row[1]).includes('202')) return false;
              if (row.some(cell => String(cell).includes('Наименование продукта') || String(cell).includes('Дата прибытия') || String(cell).includes('Статус'))) return false;
              return row.some(cell => cell !== null && cell !== '');
            })
            .map((row, index) => ({
              id: `${wh.id}-${index + 1}`,
              number: String(index + 1),
              invNumber: row[0] != null ? String(row[0]).trim() : '',
              product: row[1] != null ? String(row[1]).trim() : '',
              palletCount: '',
              dates: formatCellDate(row[2]),
              svh: formatCellDate(row[3]),
              isArchiveItem: false,
              isTrucksReportItem: true,
              rawRow: row,
            }))
            .filter(item => item.product.length > 0 || item.invNumber.length > 0 || item.dates.length > 0 || item.svh.length > 0);

          result.push({
            id: wh.id,
            name: wh.name,
            sheetName: wh.sheetName,
            isArchive: false,
            isTrucksReport: true,
            reportDate: reportDate || new Date().toLocaleDateString('ru-RU'),
            cols,
            items,
            totalPalletsNumeric: 0,
            itemCount: items.length
          });
          continue;
        }

        if (wh.isArchive) {
          const items = rows
            .filter(row => row.some(cell => cell !== null && cell !== ''))
            .map((row, index) => {
              const num = row[0] != null ? String(row[0]).trim() : '';
              const invNum = row[1] != null ? String(row[1]).trim() : '';
              const product = row[2] != null ? String(row[2]).trim() : '';
              const entryDate = formatCellDate(row[3]);
              const exitDate = formatCellDate(row[4]);
              return {
                id: `${wh.id}-${index + 1}`,
                number: num || String(index + 1),
                invNumber: invNum,
                product,
                palletCount: '',
                entryDate,
                exitDate,
                dates: [entryDate ? `Заезд: ${entryDate}` : '', exitDate ? `Выезд: ${exitDate}` : ''].filter(Boolean).join(' | '),
                svh: 'СВХ Кусто (Архив)',
                isArchiveItem: true,
                rawRow: row,
              };
            })
            .filter(item => item.product.length > 0 || item.invNumber.length > 0 || item.entryDate || item.exitDate);

          result.push({
            id: wh.id,
            name: wh.name,
            sheetName: wh.sheetName,
            isArchive: true,
            isTrucksReport: false,
            cols,
            items,
            totalPalletsNumeric: 0,
            itemCount: items.length
          });
          continue;
        }

        const items = rows
          .filter(row => row.some(cell => cell !== null && cell !== ''))
          .map((row, index) => {
            const num = row[0] != null ? String(row[0]).trim() : '';
            const invNum = row[1] != null ? String(row[1]).trim() : '';
            const product = row[2] != null ? String(row[2]).trim() : '';
            const palletCount = row[3] != null ? String(row[3]).trim() : '';
            const dates = formatCellDate(row[4]);
            const svh = row[5] != null ? String(row[5]).trim() : '';

            return {
              id: `${wh.id}-${index + 1}`,
              number: num || String(index + 1),
              invNumber: invNum,
              product,
              palletCount,
              dates,
              svh,
              isArchiveItem: false,
              rawRow: row,
            };
          })
          .filter(item => item.product.length > 0 || item.invNumber.length > 0 || item.palletCount.length > 0);

        let totalPalletsNumeric = 0;
        items.forEach(item => {
          totalPalletsNumeric += extractPalletNumeric(item.palletCount);
        });

        result.push({
          id: wh.id,
          name: wh.name,
          sheetName: wh.sheetName,
          isArchive: false,
          isTrucksReport: false,
          cols,
          items,
          totalPalletsNumeric: Math.round(totalPalletsNumeric * 100) / 100,
          itemCount: items.length
        });
      } catch (err: any) {
        console.error(`Error in GViz fetch for ${wh.name}:`, err?.message || err);
      }
    }

    if (result.length > 0) {
      syncSuccess = true;
    }
  }

  // Strategy 3: Local cache fallback if both failed
  if (!syncSuccess || result.length === 0) {
    if (cachedWarehouseResult && cachedWarehouseResult.warehouses?.length > 0) {
      console.warn('[Warehouse Sync] Using previous in-memory cache due to fetch error');
      return cachedWarehouseResult;
    }
  }

  const nowIso = new Date().toISOString();
  lastSyncTimestamp = nowIso;

  // Diff current state against previous snapshot and write logs
  let newLogs: any[] = [];
  try {
    newLogs = await processWarehouseSnapshotAndDiff(result);
    if (newLogs && newLogs.length > 0) {
      const currentSettings = await getMailingSettings();
      if (currentSettings && (currentSettings.enabled === true || String(currentSettings.enabled) === 'true') && currentSettings.scheduleType === 'on_change') {
        console.log(`🔔 Обнаружено ${newLogs.length} новых изменений в Google Таблицах. Запуск авто-рассылки...`);
        executeMailingDispatch({ triggerSource: 'on_change' }).catch(err => {
          console.error("Error in on_change mailing dispatch:", err);
        });
      }
    }
  } catch (diffErr) {
    console.error("Error processing warehouse snapshot diff:", diffErr);
  }

  // Fetch recent change logs
  let logs: any[] = [];
  try {
    logs = await getWarehouseChangeLogs();
  } catch (logsErr) {
    console.error("Error loading warehouse change logs:", logsErr);
  }

  const finalResponse = {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    updatedAt: nowIso,
    warehouses: result,
    logs,
    newLogsCount: newLogs.length,
    syncSuccess,
    syncMethod
  };

  cachedWarehouseResult = finalResponse;
  return finalResponse;
}

interface SnapshotItem {
  id: string;
  warehouseId: string;
  warehouseName: string;
  number: string;
  invNumber: string;
  product: string;
  palletCount: string;
  numericPallets: number;
  dates: string;
  svh: string;
}

// File-backed fallback store helpers
const LOGS_FILE_PATH = path.join('/tmp', 'warehouse_change_logs.json');
const SNAPSHOT_FILE_PATH = path.join('/tmp', 'warehouse_snapshot_latest.json');

function loadLocalLogs(): any[] {
  try {
    if (fs.existsSync(LOGS_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(LOGS_FILE_PATH, 'utf8')) || [];
    }
  } catch (e) {
    // Ignore read errors
  }
  return [];
}

function saveLocalLogs(logsToAppend: any[]) {
  try {
    const existing = loadLocalLogs();
    const existingMap = new Map<string, any>(existing.map(l => [l.id, l]));
    logsToAppend.forEach(l => existingMap.set(l.id, l));
    
    // Sort descending by timestamp
    const updated = Array.from(existingMap.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 500);

    fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(updated, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing local logs cache:", e);
  }
}

function loadLocalSnapshot(): Record<string, SnapshotItem> | null {
  try {
    if (fs.existsSync(SNAPSHOT_FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE_PATH, 'utf8'));
      return parsed?.itemsMap || null;
    }
  } catch (e) {
    // Ignore read errors
  }
  return null;
}

function saveLocalSnapshot(itemsMap: Record<string, SnapshotItem>, updatedAt: string) {
  try {
    fs.writeFileSync(SNAPSHOT_FILE_PATH, JSON.stringify({ updatedAt, itemsMap }, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing local snapshot cache:", e);
  }
}

async function processWarehouseSnapshotAndDiff(currentWarehouses: any[]) {
  const nowIso = new Date().toISOString();
  const currentMap = new Map<string, SnapshotItem>();

  currentWarehouses.forEach(wh => {
    wh.items.forEach((item: any) => {
      const key = `${wh.id}::${item.invNumber || 'no_inv'}::${item.product || 'no_prod'}`;
      currentMap.set(key, {
        id: item.id,
        warehouseId: wh.id,
        warehouseName: wh.name,
        number: item.number,
        invNumber: item.invNumber,
        product: item.product,
        palletCount: item.palletCount,
        numericPallets: extractPalletNumeric(item.palletCount),
        dates: item.dates,
        svh: item.svh
      });
    });
  });

  let previousSnapshot: Record<string, SnapshotItem> | null = null;
  try {
    const snapDoc = await db.collection('warehouse_snapshots').doc('latest').get();
    if (snapDoc.exists) {
      previousSnapshot = snapDoc.data()?.itemsMap || null;
    }
  } catch (err) {
    // Fallback to local snapshot file if Firestore permission denied
    previousSnapshot = loadLocalSnapshot();
  }

  const generatedLogs: any[] = [];

  if (!previousSnapshot) {
    const logItem = {
      id: `log-init-${Date.now()}`,
      timestamp: nowIso,
      warehouseId: 'all',
      warehouseName: 'Все склады',
      product: 'Инициализация остатков',
      invNumber: 'Снимок',
      changeType: 'manual',
      title: 'Первичный снимок Google Таблицы',
      description: `Зафиксирован начальный остаток из Google Таблицы (${currentMap.size} позиций).`,
      author: 'Google Sheets Auto-Sync',
      source: 'Google Sheets'
    };
    saveLocalLogs([logItem]);
    try {
      await db.collection('warehouse_change_logs').doc(logItem.id).set(logItem);
    } catch (e) {
      // Handled by local fallback
    }
  } else {
    const prevMap = new Map<string, SnapshotItem>(Object.entries(previousSnapshot));

    // 1. Detect Added Items
    for (const [key, curr] of currentMap.entries()) {
      if (!prevMap.has(key)) {
        generatedLogs.push({
          id: `log-add-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: nowIso,
          warehouseId: curr.warehouseId,
          warehouseName: curr.warehouseName,
          product: curr.product,
          invNumber: curr.invNumber,
          changeType: 'added',
          title: '➕ Новая позиция в Google Таблице',
          description: `Добавлен товар "${curr.product}" (Инвойс: ${curr.invNumber || '—'}, ${curr.palletCount || '0'} пал.) на склад "${curr.warehouseName}"`,
          newValue: curr.palletCount,
          palletDelta: curr.numericPallets,
          author: 'Google Sheets Sync',
          source: 'Google Sheets'
        });
      }
    }

    // 2. Detect Removed Items
    for (const [key, prev] of prevMap.entries()) {
      if (!currentMap.has(key)) {
        generatedLogs.push({
          id: `log-rem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          timestamp: nowIso,
          warehouseId: prev.warehouseId,
          warehouseName: prev.warehouseName,
          product: prev.product,
          invNumber: prev.invNumber,
          changeType: 'removed',
          title: '🔴 Позиция списана / удалена в Google Таблице',
          description: `Товар "${prev.product}" (Инвойс: ${prev.invNumber || '—'}, ${prev.palletCount || '0'} пал.) списан / удален со склада "${prev.warehouseName}"`,
          oldValue: prev.palletCount,
          palletDelta: -prev.numericPallets,
          author: 'Google Sheets Sync',
          source: 'Google Sheets'
        });
      }
    }

    // 3. Detect Modified Items
    for (const [key, curr] of currentMap.entries()) {
      if (prevMap.has(key)) {
        const prev = prevMap.get(key)!;
        
        if (curr.palletCount !== prev.palletCount) {
          const pDelta = curr.numericPallets - prev.numericPallets;
          const isDecrease = pDelta < 0;
          generatedLogs.push({
            id: `log-mod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: nowIso,
            warehouseId: curr.warehouseId,
            warehouseName: curr.warehouseName,
            product: curr.product,
            invNumber: curr.invNumber,
            changeType: 'quantity_changed',
            title: isDecrease ? '📉 Списание / уменьшение паллет' : '📈 Увеличение количества паллет',
            description: `Склад "${curr.warehouseName}": "${curr.product}" — количество изменилось с "${prev.palletCount || '0'}" на "${curr.palletCount || '0'}" (${pDelta > 0 ? '+' : ''}${Math.round(pDelta * 10) / 10} пал.)`,
            oldValue: prev.palletCount,
            newValue: curr.palletCount,
            palletDelta: Math.round(pDelta * 10) / 10,
            author: 'Google Sheets Sync',
            source: 'Google Sheets'
          });
        }

        if (curr.svh !== prev.svh && curr.svh && prev.svh) {
          generatedLogs.push({
            id: `log-svh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: nowIso,
            warehouseId: curr.warehouseId,
            warehouseName: curr.warehouseName,
            product: curr.product,
            invNumber: curr.invNumber,
            changeType: 'svh_changed',
            title: 'ℹ️ Изменение СВХ / примечаний',
            description: `Склад "${curr.warehouseName}": "${curr.product}" — примечание изменено с "${prev.svh}" на "${curr.svh}"`,
            oldValue: prev.svh,
            newValue: curr.svh,
            author: 'Google Sheets Sync',
            source: 'Google Sheets'
          });
        }
      }
    }

    if (generatedLogs.length > 0) {
      console.log(`[Warehouse Sync] Detected ${generatedLogs.length} changes in Google Sheets!`);
      saveLocalLogs(generatedLogs);
      try {
        const batch = db.batch();
        generatedLogs.forEach(log => {
          const ref = db.collection('warehouse_change_logs').doc(log.id);
          batch.set(ref, log);
        });
        await batch.commit();
      } catch (err) {
        // Handled by local logs fallback
      }
    }
  }

  const currentSnapshotObj: Record<string, SnapshotItem> = {};
  currentMap.forEach((val, key) => {
    currentSnapshotObj[key] = val;
  });

  saveLocalSnapshot(currentSnapshotObj, nowIso);
  try {
    await db.collection('warehouse_snapshots').doc('latest').set({
      updatedAt: nowIso,
      itemsMap: currentSnapshotObj
    });
  } catch (err) {
    // Handled by local snapshot fallback
  }

  return generatedLogs;
}

async function getWarehouseChangeLogs() {
  try {
    const snap = await db.collection('warehouse_change_logs')
      .orderBy('timestamp', 'desc')
      .limit(250)
      .get();
    
    const dbLogs = snap.docs.map(doc => doc.data());
    if (dbLogs.length > 0) return dbLogs;
  } catch (err) {
    // Firestore error handled gracefully with local cache fallback
  }
  return loadLocalLogs();
}

// ================= MAILING STORAGE & EXCEL GENERATOR HELPERS =================
const SUBSCRIBERS_FILE_PATH = path.join(process.cwd(), 'mailing_subscribers.json');
const SETTINGS_FILE_PATH = path.join(process.cwd(), 'mailing_settings.json');
const MAILING_LOGS_FILE_PATH = path.join(process.cwd(), 'mailing_logs.json');

const DEFAULT_SUBSCRIBERS = [
  {
    id: 'sub-user-default',
    name: 'Основной получатель (Руководитель)',
    email: 'ti07kz@gmail.com',
    department: 'Руководство / Склад',
    isActive: true,
    selectedWarehouses: ['all'],
    formatPreference: 'xlsx',
    createdAt: new Date().toISOString()
  }
];

const DEFAULT_MAILING_SETTINGS = {
  enabled: true,
  scheduleType: 'daily',
  sendTime: '09:00',
  timezone: 'Asia/Almaty',
  scheduleDays: [1, 2, 3, 4, 5],
  emailSubject: '📊 Ежедневный отчет: Остатки товаров на складах',
  emailBody: 'Добрый день!\n\nНаправляем актуальный свежий файл Excel с остатками товаров и движением паллет по всем складам компании.\n\nС уважением,\nАвтоматическая система складского учета',
  attachFormat: 'xlsx',
  includeAnalyticsSummary: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpSecure: false,
  smtpUser: 'ti07kz@gmail.com',
  smtpPass: '',
  smtpFrom: '"Складской Учет (Silk Road)" <ti07kz@gmail.com>',
  smtpConfigured: false
};

function getZonedTime(timeZone: string = 'Asia/Almaty') {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    });

    const parts = formatter.formatToParts(now);
    const map: Record<string, string> = {};
    parts.forEach(p => { map[p.type] = p.value; });

    const hours = map.hour === '24' ? '00' : (map.hour || '00').padStart(2, '0');
    const minutes = (map.minute || '00').padStart(2, '0');
    const HHmm = `${hours}:${minutes}`;

    const yearNum = Number(map.year);
    const monthNum = Number(map.month) - 1;
    const dayNum = Number(map.day);
    const dayOfWeek = new Date(Date.UTC(yearNum, monthNum, dayNum)).getUTCDay();

    return {
      HHmm,
      todayDateStr: `${map.year}-${map.month}-${map.day}`,
      dayOfWeek,
      fullZonedString: `${map.day}.${map.month}.${map.year} ${HHmm}`
    };
  } catch (e) {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return {
      HHmm: `${hours}:${minutes}`,
      todayDateStr: now.toISOString().split('T')[0],
      dayOfWeek: now.getDay(),
      fullZonedString: now.toLocaleString('ru-RU')
    };
  }
}

async function getMailingSubscribers(): Promise<any[]> {
  try {
    const snap = await db.collection('mailing_subscribers').get();
    if (!snap.empty) {
      return snap.docs.map(d => d.data());
    }
  } catch (e) {
    // Fallback to local
  }
  if (fs.existsSync(SUBSCRIBERS_FILE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE_PATH, 'utf8'));
    } catch (e) {}
  }
  return DEFAULT_SUBSCRIBERS;
}

async function saveMailingSubscribers(subscribers: any[]) {
  try {
    fs.writeFileSync(SUBSCRIBERS_FILE_PATH, JSON.stringify(subscribers, null, 2), 'utf8');
  } catch (e) {}

  try {
    const batch = db.batch();
    subscribers.forEach(sub => {
      const ref = db.collection('mailing_subscribers').doc(sub.id);
      batch.set(ref, sub);
    });
    await batch.commit();
  } catch (e) {}
}

async function getMailingSettings(): Promise<any> {
  let settings: any = { ...DEFAULT_MAILING_SETTINGS };

  // 1. Read local JSON fallback first
  if (fs.existsSync(SETTINGS_FILE_PATH)) {
    try {
      const fileData = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
      if (fileData) {
        settings = { ...settings, ...fileData };
      }
    } catch (e) {}
  }

  // 2. Read Firestore and merge
  try {
    const doc = await db.collection('mailing_settings').doc('config').get();
    if (doc.exists) {
      const dbData = doc.data() || {};
      settings = {
        ...settings,
        ...dbData,
        smtpPass: dbData.smtpPass || settings.smtpPass || process.env.SMTP_PASS || ''
      };
    }
  } catch (e) {}

  const hasHost = !!(settings.smtpHost || process.env.SMTP_HOST);
  const hasUser = !!(settings.smtpUser || process.env.SMTP_USER);
  const hasPass = !!(settings.smtpPass || process.env.SMTP_PASS);
  
  settings.smtpConfigured = hasHost && hasUser && hasPass;
  return settings;
}

function createNodemailerTransport(config: {
  host?: string;
  port?: number;
  secure?: boolean;
  user: string;
  pass: string;
  useService?: boolean;
}) {
  const cleanPass = (config.pass || '').trim().replace(/\s+/g, '');
  const cleanUser = (config.user || '').trim();
  const host = (config.host || 'smtp.gmail.com').trim();
  const isGmail = host.toLowerCase().includes('gmail') || cleanUser.toLowerCase().endsWith('@gmail.com');

  if (config.useService && isGmail) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: cleanUser,
        pass: cleanPass
      },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      tls: {
        rejectUnauthorized: false
      }
    } as any);
  }

  const port = config.port || 587;
  const secure = config.secure !== undefined ? config.secure : (port === 465);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure && (port === 587 || port === 2525),
    auth: {
      user: cleanUser,
      pass: cleanPass
    },
    family: 4, // CRITICAL: Forces IPv4 to eliminate "Unexpected socket close" from IPv6 drops in container environments
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 30000,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2'
    }
  } as any);
}

async function getSmtpTransporter(customSettings?: any) {
  const settings = customSettings || await getMailingSettings();

  const host = customSettings?.smtpHost || settings.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(customSettings?.smtpPort || settings.smtpPort || process.env.SMTP_PORT || 587);
  const secure = customSettings?.smtpSecure !== undefined 
    ? Boolean(customSettings.smtpSecure) 
    : (settings.smtpSecure !== undefined ? Boolean(settings.smtpSecure) : (port === 465));
  
  const user = customSettings?.smtpUser || settings.smtpUser || process.env.SMTP_USER || 'ti07kz@gmail.com';
  const pass = customSettings?.smtpPass || settings.smtpPass || process.env.SMTP_PASS;
  const from = customSettings?.smtpFrom || settings.smtpFrom || process.env.SMTP_FROM || `"Складской Учет" <${user}>`;

  if (!host || !user || !pass) {
    return {
      transporter: null,
      configured: false,
      from,
      error: "Не введен Пароль Приложения Google (16 символов). Создайте его на странице myaccount.google.com/apppasswords и сохраните в настройках."
    };
  }

  const transporter = createNodemailerTransport({
    host: host.trim(),
    port,
    secure,
    user: user.trim(),
    pass: pass.trim()
  });

  return {
    transporter,
    configured: true,
    from,
    host: host.trim(),
    port,
    user: user.trim()
  };
}

async function sendMailWithResilience(mailOptions: any, customSettings?: any) {
  const settings = customSettings || await getMailingSettings();
  const cleanPass = (settings?.smtpPass || process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
  const cleanUser = (settings?.smtpUser || process.env.SMTP_USER || 'ti07kz@gmail.com').trim();
  const host = (settings?.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(settings?.smtpPort || process.env.SMTP_PORT || 587);
  const secure = settings?.smtpSecure !== undefined ? Boolean(settings.smtpSecure) : (port === 465);

  if (!cleanUser || !cleanPass) {
    throw new Error("Не введен Пароль Приложения Google (16 символов). Создайте его на странице myaccount.google.com/apppasswords и сохраните в настройках.");
  }

  const isGmail = host.toLowerCase().includes('gmail') || cleanUser.toLowerCase().endsWith('@gmail.com');

  // Candidate transport strategies in order of reliability for Cloud containers
  const transportConfigs: Array<{ desc: string; config: any }> = [];

  // Strategy 1: Configured port (IPv4 forced)
  transportConfigs.push({
    desc: `${host}:${port} (${secure ? 'SSL' : 'STARTTLS'}, IPv4)`,
    config: { host, port, secure, user: cleanUser, pass: cleanPass }
  });

  // Strategy 2: Alternative port (587 STARTTLS if 465, or 465 SSL if 587)
  const altPort = port === 465 ? 587 : 465;
  transportConfigs.push({
    desc: `${host}:${altPort} (${altPort === 465 ? 'SSL' : 'STARTTLS'}, IPv4)`,
    config: { host, port: altPort, secure: altPort === 465, user: cleanUser, pass: cleanPass }
  });

  // Strategy 3: Nodemailer Gmail Service Engine
  if (isGmail) {
    transportConfigs.push({
      desc: 'Nodemailer Gmail Engine (IPv4)',
      config: { host, user: cleanUser, pass: cleanPass, useService: true }
    });
  }

  let lastErr: any = null;
  for (let attempt = 0; attempt < transportConfigs.length; attempt++) {
    const item = transportConfigs[attempt];
    try {
      console.log(`📧 [Mailing] Попытка отправки почты через [${item.desc}] (${attempt + 1}/${transportConfigs.length})...`);
      const transporter = createNodemailerTransport(item.config);
      const info = await transporter.sendMail(mailOptions);
      console.log(`✅ [Mailing] Письмо успешно отправлено через [${item.desc}]! MessageID:`, info?.messageId);
      return { success: true, info, usedStrategy: item.desc };
    } catch (err: any) {
      console.error(`⚠️ [Mailing] Сбой отправки через [${item.desc}]:`, err?.message || err);
      lastErr = err;
      if (attempt < transportConfigs.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }
  }

  throw lastErr || new Error("Не удалось отправить письмо через все доступные протоколы SMTP");
}

async function saveMailingSettings(settings: any) {
  try {
    fs.writeFileSync(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {}

  try {
    await db.collection('mailing_settings').doc('config').set(settings);
  } catch (e) {}
}

async function getMailingLogs(): Promise<any[]> {
  try {
    const snap = await db.collection('mailing_logs').orderBy('timestamp', 'desc').limit(100).get();
    if (!snap.empty) {
      return snap.docs.map(d => d.data());
    }
  } catch (e) {}

  if (fs.existsSync(MAILING_LOGS_FILE_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(MAILING_LOGS_FILE_PATH, 'utf8'));
    } catch (e) {}
  }
  return [];
}

async function addMailingLog(log: any) {
  let existing: any[] = [];
  if (fs.existsSync(MAILING_LOGS_FILE_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(MAILING_LOGS_FILE_PATH, 'utf8')) || [];
    } catch (e) {}
  }
  existing.unshift(log);
  existing = existing.slice(0, 100);
  try {
    fs.writeFileSync(MAILING_LOGS_FILE_PATH, JSON.stringify(existing, null, 2), 'utf8');
  } catch (e) {}

  try {
    await db.collection('mailing_logs').doc(log.id).set(log);
  } catch (e) {}
}

async function generateWarehouseExcelBufferAsync(warehouseData: any): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Система Учета Silk Road Logistics";
  workbook.lastModifiedBy = "Автоматическая Ежедневная Рассылка";
  workbook.created = new Date();

  // Styling palette
  const HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' } // Slate 800 Navy
  };
  const TRUCKS_HEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' } // Dark Slate
  };
  const SUBHEADER_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2563EB' } // Royal Blue
  };
  const ZEBRA_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF8FAFC' } // Light Gray
  };
  const SUMMARY_TOTAL_FILL: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0F2FE' } // Sky Blue
  };

  const THIN_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
  };

  const TOTAL_DOUBLE_BORDER: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF0284C7' } },
    bottom: { style: 'double', color: { argb: 'FF0284C7' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
  };

  const allWhList = warehouseData.warehouses || [];
  const trucksWh = allWhList.find((w: any) => w.isTrucksReport || w.id === 'trucks_report');
  const stockWhList = allWhList.filter((w: any) => !w.isTrucksReport && w.id !== 'trucks_report');

  // ================= 1. TAB: ОТЧЕТ ПО МАШИНАМ (ИЗ ОНЛАЙН GOOGLE ТАБЛИЦЫ) =================
  if (trucksWh) {
    const trucksSheet = workbook.addWorksheet('Отчет по машинам', {
      views: [{ showGridLines: true }]
    });

    // Title Banner
    trucksSheet.mergeCells('A1:E1');
    const trTitleCell = trucksSheet.getCell('A1');
    trTitleCell.value = '🚚 ЕЖЕДНЕВНЫЙ ОТЧЕТ ПО МАШИНАМ И СТАТУСАМ РЕЙСОВ';
    trTitleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    trTitleCell.fill = TRUCKS_HEADER_FILL;
    trTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    trucksSheet.getRow(1).height = 36;

    // Metadata
    trucksSheet.mergeCells('A2:E2');
    const trMetaCell = trucksSheet.getCell('A2');
    trMetaCell.value = `Дата в таблице: ${trucksWh.reportDate || 'Актуально'} | Источник: Google Sheets (Онлайн таблица) | Сформировано: ${new Date().toLocaleString('ru-RU')}`;
    trMetaCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
    trMetaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    trucksSheet.getRow(2).height = 20;

    trucksSheet.addRow([]); // Empty Row 3

    // Table Headers
    const trHeaderRow = trucksSheet.addRow([
      '№ п/п', '№ Машины / Инвойс', 'Наименование продукта', 'Дата прибытия / СВХ', 'Текущий статус'
    ]);
    trHeaderRow.height = 26;
    trHeaderRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = SUBHEADER_FILL;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    });

    (trucksWh.items || []).forEach((item: any, idx: number) => {
      const row = trucksSheet.addRow([
        idx + 1,
        item.invNumber || '—',
        item.product || '—',
        item.dates || '—',
        item.svh || '—'
      ]);
      row.height = 24;

      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).font = { name: 'Consolas', size: 11, bold: true, color: { argb: 'FF1E293B' } };
      row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(3).font = { bold: true, color: { argb: 'FF0F172A' } };
      row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(5).alignment = { horizontal: 'left', vertical: 'middle' };

      const isEven = idx % 2 === 1;
      row.eachCell((cell, colNum) => {
        cell.border = THIN_BORDER;
        if (isEven && colNum < 5) cell.fill = ZEBRA_FILL;
      });

      // Status cell intelligent highlight
      const statusText = String(item.svh || '').toLowerCase();
      const statusCell = row.getCell(5);
      if (statusText.includes('можно забрать') || statusText.includes('выгружен')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
        statusCell.font = { bold: true, color: { argb: 'FF166534' } };
      } else if (statusText.includes('лаб') || statusText.includes('свх') || statusText.includes('тамож')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
        statusCell.font = { bold: true, color: { argb: 'FF1E40AF' } };
      } else if (statusText.includes('задерж')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
        statusCell.font = { bold: true, color: { argb: 'FF991B1B' } };
      } else if (!item.svh || item.svh === '—' || statusText.includes('пути')) {
        statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9C3' } };
        statusCell.font = { color: { argb: 'FF854D0E' } };
      } else {
        statusCell.font = { color: { argb: 'FF334155' } };
      }
    });

    // Total Row
    const trTotalRow = trucksSheet.addRow([
      '', `ИТОГО МАШИН В ТАБЛИЦЕ: ${trucksWh.items ? trucksWh.items.length : 0}`, '', '', ''
    ]);
    trTotalRow.height = 26;
    trTotalRow.eachCell((cell, colNum) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0369A1' } };
      cell.fill = SUMMARY_TOTAL_FILL;
      cell.border = TOTAL_DOUBLE_BORDER;
      if (colNum === 2) cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });

    trucksSheet.columns = [
      { width: 8 },  // №
      { width: 24 }, // № Машины / Инвойс
      { width: 42 }, // Продукт
      { width: 34 }, // Дата прибытия / СВХ
      { width: 40 }  // Статус
    ];
  }

  // ================= 2. TAB: СВОДКА ПО СКЛАДАМ (WAREHOUSE SUMMARY) =================
  const summarySheet = workbook.addWorksheet('Сводка по складам', {
    views: [{ showGridLines: true }]
  });

  // Title Banner
  summarySheet.mergeCells('A1:E1');
  const titleCell = summarySheet.getCell('A1');
  titleCell.value = '📦 СВОДНЫЙ ЕЖЕДНЕВНЫЙ ОТЧЕТ ПО ОСТАТКАМ НА СКЛАДАХ';
  titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = HEADER_FILL;
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(1).height = 36;

  // Metadata
  summarySheet.mergeCells('A2:E2');
  const metaCell = summarySheet.getCell('A2');
  metaCell.value = `Источник: Google Таблицы (Онлайн синхронизация) | Сформировано: ${new Date().toLocaleString('ru-RU')}`;
  metaCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
  metaCell.alignment = { horizontal: 'center', vertical: 'middle' };
  summarySheet.getRow(2).height = 20;

  summarySheet.addRow([]); // Empty Row 3

  // Table Headers
  const summaryHeaderRow = summarySheet.addRow([
    '№', 'Наименование склада', 'Категория / Тип', 'Количество позиций', 'Всего паллет (мест)'
  ]);
  summaryHeaderRow.height = 26;
  summaryHeaderRow.eachCell((cell) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = SUBHEADER_FILL;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = THIN_BORDER;
  });

  let totalItemsAll = 0;
  let totalPalletsAll = 0;

  stockWhList.forEach((wh: any, idx: number) => {
    const itemCount = wh.itemCount || (wh.items ? wh.items.length : 0);
    const palletCount = wh.totalPalletsNumeric || 0;
    
    totalItemsAll += itemCount;
    if (!wh.isArchive) totalPalletsAll += palletCount;

    const row = summarySheet.addRow([
      idx + 1,
      wh.name,
      wh.isArchive ? 'Архив выгрузок (Кусто)' : 'Активный склад',
      itemCount,
      palletCount
    ]);
    row.height = 22;

    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(2).font = { bold: true, color: { argb: 'FF0F172A' } };
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(5).font = { bold: true };
    row.getCell(5).numFmt = '#,##0.00';

    const isEven = idx % 2 === 1;
    row.eachCell((cell) => {
      cell.border = THIN_BORDER;
      if (isEven) cell.fill = ZEBRA_FILL;
    });
  });

  // Total Summary Row
  const totalRow = summarySheet.addRow([
    '', 'ИТОГО (Активные склады):', '', totalItemsAll, Math.round(totalPalletsAll * 100) / 100
  ]);
  totalRow.height = 28;
  totalRow.eachCell((cell, colNum) => {
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0369A1' } };
    cell.fill = SUMMARY_TOTAL_FILL;
    cell.border = TOTAL_DOUBLE_BORDER;
    if (colNum === 2) cell.alignment = { horizontal: 'right', vertical: 'middle' };
    if (colNum === 4) { cell.alignment = { horizontal: 'right', vertical: 'middle' }; cell.numFmt = '#,##0'; }
    if (colNum === 5) { cell.alignment = { horizontal: 'right', vertical: 'middle' }; cell.numFmt = '#,##0.00'; }
  });

  summarySheet.columns = [
    { width: 8 },  // №
    { width: 35 }, // Склад
    { width: 25 }, // Статус
    { width: 22 }, // Колич. позиций
    { width: 24 }  // Всего паллет
  ];

  // ================= 3. TABS: INDIVIDUAL WAREHOUSES FROM GOOGLE SHEETS =================
  stockWhList.forEach((wh: any) => {
    const safeSheetName = String(wh.name || 'Склад').substring(0, 30).replace(/[:\\\/?*\[\]]/g, '_');
    const ws = workbook.addWorksheet(safeSheetName, {
      views: [{ showGridLines: true }]
    });

    // Banner Header
    ws.mergeCells('A1:F1');
    const whTitleCell = ws.getCell('A1');
    whTitleCell.value = `Склад: ${String(wh.name || '').toUpperCase()}`;
    whTitleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FFFFFFFF' } };
    whTitleCell.fill = HEADER_FILL;
    whTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 32;

    ws.mergeCells('A2:F2');
    const whMetaCell = ws.getCell('A2');
    whMetaCell.value = `Статус: ${wh.isArchive ? 'Архив выгрузок' : 'Активный склад'} | Позиций: ${wh.items ? wh.items.length : 0} | Источник: Google Sheets (Онлайн)`;
    whMetaCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF475569' } };
    whMetaCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 18;

    ws.addRow([]); // Empty Row 3

    // Table Headers
    const headers = wh.isArchive 
      ? ["№ п/п", "№ Инвойса / Авто", "Наименование груза", "Заезд", "Выезд", "Примечания / СВХ"]
      : ["№ п/п", "№ Инвойса / Накладной", "Наименование продукции", "Кол-во паллет", "Даты движения", "СВХ / Примечания"];

    const headerRow = ws.addRow(headers);
    headerRow.height = 26;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = SUBHEADER_FILL;
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = THIN_BORDER;
    });

    let warehousePalletsTotal = 0;

    (wh.items || []).forEach((item: any, idx: number) => {
      const palletVal = parseFloat(String(item.palletCount || '0').replace(',', '.').replace(/[^\d.]/g, '')) || 0;
      warehousePalletsTotal += palletVal;

      const rowValues = wh.isArchive ? [
        item.number || (idx + 1),
        item.invNumber || '—',
        item.product || '—',
        item.entryDate || '—',
        item.exitDate || '—',
        item.svh || '—'
      ] : [
        item.number || (idx + 1),
        item.invNumber || '—',
        item.product || '—',
        item.palletCount || '—',
        item.dates || '—',
        item.svh || '—'
      ];

      const row = ws.addRow(rowValues);
      row.height = 21;

      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(2).font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF1E293B' } };
      row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
      row.getCell(3).font = { bold: true };
      row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' };
      row.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' };

      const isEven = idx % 2 === 1;
      row.eachCell((cell) => {
        cell.border = THIN_BORDER;
        if (isEven) cell.fill = ZEBRA_FILL;
      });
    });

    // Total Row for Active Warehouses
    if (!wh.isArchive) {
      const whTotalRow = ws.addRow(['', 'ИТОГО ПО СКЛАДУ:', '', `${Math.round(warehousePalletsTotal * 100) / 100} паллет`, '', '']);
      whTotalRow.height = 26;
      whTotalRow.eachCell((cell, colNum) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0369A1' } };
        cell.fill = SUMMARY_TOTAL_FILL;
        cell.border = TOTAL_DOUBLE_BORDER;
        if (colNum === 2) cell.alignment = { horizontal: 'right', vertical: 'middle' };
        if (colNum === 4) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
    }

    ws.columns = [
      { width: 8 },  // №
      { width: 25 }, // № Инвойса
      { width: 45 }, // Наименование
      { width: 18 }, // Паллеты / Заезд
      { width: 22 }, // Даты / Выезд
      { width: 30 }  // Примечания / СВХ
    ];
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// Global Mailing Executor Helper
async function executeMailingDispatch(options: {
  targetSubscriberIds?: string[];
  customEmail?: string;
  triggerSource?: string;
}) {
  const { targetSubscriberIds, customEmail, triggerSource = 'automatic' } = options;

  // 1. Fetch stock data & generate formatted Excel
  const warehouseData = await getWarehouseData();
  const excelBuffer = await generateWarehouseExcelBufferAsync(warehouseData);
  
  const dateStr = new Date().toISOString().split('T')[0];
  const attachmentName = `Warehouse_Stock_Report_${dateStr}.xlsx`;

  // 2. Recipients
  let allSubscribers = await getMailingSubscribers();
  let recipientsToMessage: any[] = [];

  if (customEmail) {
    recipientsToMessage = [{
      id: 'custom-single',
      name: customEmail.split('@')[0],
      email: customEmail.trim()
    }];
  } else if (targetSubscriberIds && Array.isArray(targetSubscriberIds) && targetSubscriberIds.length > 0) {
    recipientsToMessage = allSubscribers.filter(s => targetSubscriberIds.includes(s.id));
  } else {
    recipientsToMessage = allSubscribers.filter(s => s.isActive);
  }

  if (recipientsToMessage.length === 0) {
    return {
      success: false,
      error: "Нет активных получателей для отправки рассылки"
    };
  }

  const settings = await getMailingSettings();
  const recipientEmails = recipientsToMessage.map(r => r.email);

  let sendStatus: 'success' | 'failed' | 'partial' = 'success';
  let errorMsg: string | undefined = undefined;

  // 3. Resilient SMTP Send with Auto-Recovery & IPv4 enforcement
  try {
    const fromHeader = settings.smtpFrom || `"Логистика и Склад (Silk Road)" <${settings.smtpUser || process.env.SMTP_USER || 'ti07kz@gmail.com'}>`;
    await sendMailWithResilience({
      from: fromHeader,
      to: recipientEmails.join(', '),
      subject: settings.emailSubject || '📊 Ежедневный отчет: Статус машин и остатки на складах',
      text: settings.emailBody || 'Актуальный сводный отчет по автотранспорту и складским остаткам из Google Таблицы во вложении.',
      html: `
        <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="background-color: #1e293b; padding: 18px 24px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
            <h2 style="color: #ffffff; margin: 0; font-size: 19px; font-weight: bold;">📊 Ежедневный отчет по Логистике и Складам</h2>
            <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">Синхронизировано с Google Таблицей • Silk Road Logistics</p>
          </div>
          
          <p style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-line;">
            ${settings.emailBody || 'Добрый день!\n\nНаправляем актуальный ежедневный сводный отчет компании со статусом прибытия автотранспорта и остатками на складах.'}
          </p>

          <div style="margin: 18px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; font-weight: bold; font-size: 13px; color: #1e293b;">📋 Содержимое прикрепленного Excel отчета:</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6;">
              <li>🚚 <b>Вкладка «Отчет по машинам»</b>: статус машин, даты прибытия на СВХ и разрешения на выгрузку.</li>
              <li>📦 <b>Вкладка «Сводка по складам»</b>: общие итоги по товарным позициям и сумме паллетомест.</li>
              <li>🏬 <b>Вкладки по складам</b>: детальные остатки (Бекмаханова, Жолдостар, А-Прейд, АСЕМ, ЦЭД, Кусто).</li>
            </ul>
          </div>

          <div style="margin: 16px 0; padding: 14px; background-color: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
            <p style="margin: 0; font-size: 13px; color: #1e40af; font-weight: bold;">📎 Прикрепленный файл: ${attachmentName}</p>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #3b82f6;">Форматированная таблица Microsoft Excel (.xlsx) со статусами машин и итогами по паллетам.</p>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Автоматическая рассылка • Silk Road Logistics<br/>
            Сформировано: ${new Date().toLocaleString('ru-RU')}
          </p>
        </div>
      `,
      attachments: [
        {
          filename: attachmentName,
          content: excelBuffer
        }
      ]
    }, settings);
    sendStatus = 'success';
  } catch (mailErr: any) {
    console.error("Nodemailer SMTP resilient sending error:", mailErr);
    sendStatus = 'failed';
    errorMsg = mailErr.message || "Ошибка отправки через SMTP сервер";
  }

  // Update subscriber lastSentAt
  const nowIso = new Date().toISOString();
  let updatedSubs = false;
  allSubscribers = allSubscribers.map(s => {
    if (recipientEmails.includes(s.email)) {
      updatedSubs = true;
      return { ...s, lastSentAt: nowIso };
    }
    return s;
  });
  if (updatedSubs) {
    await saveMailingSubscribers(allSubscribers);
  }

  // Log dispatch history
  const logEntry = {
    id: `mail-log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: nowIso,
    recipientsCount: recipientEmails.length,
    recipientEmails,
    status: sendStatus,
    fileName: attachmentName,
    fileSize: `${(excelBuffer.length / 1024).toFixed(1)} KB`,
    triggerSource,
    errorMessage: errorMsg
  };

  await addMailingLog(logEntry);

  return {
    success: sendStatus !== 'failed',
    message: sendStatus === 'failed' ? `Ошибка рассылки: ${errorMsg}` : `Файл Excel успешно отправлен ${recipientEmails.length} получателям!`,
    error: sendStatus === 'failed' ? errorMsg : undefined,
    log: logEntry
  };
}

// Automated Background Scheduler (Cron)
let lastAutoSentKey = '';

function startBackgroundSheetsPolling() {
  console.log("📊 [Sheets Poller] Фоновая проверка обновлений Google Таблиц запущена (каждые 60 сек)...");
  setInterval(async () => {
    try {
      await getWarehouseData(true);
    } catch (err: any) {
      console.error("[Sheets Poller] Ошибка фоновой проверки Google Таблиц:", err?.message || err);
    }
  }, 60000); // Check Google Sheets every 60 seconds for changes
}

function startMailingScheduler() {
  console.log("⏰ [Mailing Scheduler] Автоматическая служба рассылки запущена (проверка каждые 20 сек)...");
  
  setInterval(async () => {
    try {
      const settings = await getMailingSettings();
      if (!settings || settings.enabled === false || String(settings.enabled) === 'false' || settings.scheduleType === 'manual') {
        return;
      }

      // If on_change mode, background polling handles it when diff is detected
      if (settings.scheduleType === 'on_change') {
        return;
      }

      const tz = settings.timezone || 'Asia/Almaty';
      const zoned = getZonedTime(tz);
      const currentHHmm = zoned.HHmm;
      const todayDateStr = zoned.todayDateStr;
      const dayOfWeek = zoned.dayOfWeek;

      const normTarget = (settings.sendTime || '09:00').trim().slice(0, 5).padStart(5, '0');
      const normCurrent = currentHHmm.trim().slice(0, 5).padStart(5, '0');

      const sendKey = `${todayDateStr}_${normTarget}`;

      if (lastAutoSentKey === sendKey) {
        return;
      }

      // Calculate minutes from midnight for robust matching
      const [tH, tM] = normTarget.split(':').map(Number);
      const [cH, cM] = normCurrent.split(':').map(Number);
      const targetMinutes = (tH || 0) * 60 + (tM || 0);
      const currentMinutes = (cH || 0) * 60 + (cM || 0);

      // Check time match (current time within target minute to target + 3 minutes)
      const inTimeWindow = (currentMinutes >= targetMinutes) && (currentMinutes <= targetMinutes + 3);
      if (!inTimeWindow) {
        return;
      }

      // Check schedule type for correct days
      let shouldSend = false;
      if (settings.scheduleType === 'daily') {
        shouldSend = true;
      } else if (settings.scheduleType === 'workdays') {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          shouldSend = true;
        }
      } else if (settings.scheduleType === 'weekly') {
        if (dayOfWeek === 1) { // Mondays
          shouldSend = true;
        }
      } else if (settings.scheduleType === 'custom' && Array.isArray(settings.scheduleDays)) {
        if (settings.scheduleDays.includes(dayOfWeek)) {
          shouldSend = true;
        }
      }

      if (!shouldSend) {
        return;
      }

      console.log(`🚀 [Cron Scheduler] Наступило время рассылки (${normCurrent} по часовому поясу ${tz}). Запуск отправки...`);

      const result = await executeMailingDispatch({ triggerSource: 'automatic' });
      if (result.success) {
        lastAutoSentKey = sendKey;
        console.log(`✅ [Cron Scheduler] Успешно отправлена авто-рассылка:`, result.message);
      } else {
        console.error(`❌ [Cron Scheduler] Ошибка отправки авто-рассылки:`, result.error || result.message);
      }

    } catch (schedErr) {
      console.error("Error in background mailing scheduler:", schedErr);
    }
  }, 20000);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' })); // Increase limit for attachments

  // API endpoint for warehouse data from Google Sheets
  app.get("/api/warehouses", async (req, res) => {
    try {
      const data = await getWarehouseData(false);
      res.json(data);
    } catch (error: any) {
      console.error("Error fetching warehouses API:", error);
      res.status(500).json({ error: error.message || "Failed to fetch warehouse data" });
    }
  });

  // Force live sync directly from Google Sheets
  app.post("/api/warehouses/sync", async (req, res) => {
    try {
      const data = await getWarehouseData(true);
      res.json({
        success: true,
        message: "Данные успешно синхронизированы напрямую из Google Таблиц!",
        data
      });
    } catch (error: any) {
      console.error("Error in forced warehouse sync API:", error);
      res.status(500).json({ error: error.message || "Failed to synchronize warehouse data" });
    }
  });

  // API endpoint for warehouse change logs
  app.get("/api/warehouses/logs", async (req, res) => {
    try {
      const logs = await getWarehouseChangeLogs();
      res.json({ logs });
    } catch (error: any) {
      console.error("Error fetching warehouse change logs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch warehouse logs" });
    }
  });

  app.post("/api/warehouses/logs", async (req, res) => {
    try {
      const logData = req.body;
      if (!logData || !logData.title) {
        return res.status(400).json({ error: "Title is required" });
      }
      const newLog = {
        id: `log-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toISOString(),
        warehouseId: logData.warehouseId || 'all',
        warehouseName: logData.warehouseName || 'Все склады',
        product: logData.product || '—',
        invNumber: logData.invNumber || '—',
        changeType: logData.changeType || 'manual',
        title: logData.title,
        description: logData.description || '',
        oldValue: logData.oldValue || '',
        newValue: logData.newValue || '',
        palletDelta: typeof logData.palletDelta === 'number' ? logData.palletDelta : 0,
        author: logData.author || 'Оператор склада',
        source: logData.source || 'Manual'
      };

      saveLocalLogs([newLog]);
      try {
        await db.collection('warehouse_change_logs').doc(newLog.id).set(newLog);
      } catch (dbErr) {
        // Handled by local fallback
      }
      res.json({ success: true, log: newLog });
    } catch (error: any) {
      console.error("Error adding manual warehouse log:", error);
      res.status(500).json({ error: error.message || "Failed to add warehouse log" });
    }
  });

  // ================= MAILING API ENDPOINTS =================
  
  // GET Subscribers
  app.get("/api/mailing/subscribers", async (req, res) => {
    try {
      const subscribers = await getMailingSubscribers();
      res.json({ subscribers });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to load subscribers" });
    }
  });

  // POST Subscriber (Add / Update)
  app.post("/api/mailing/subscribers", async (req, res) => {
    try {
      const subData = req.body;
      if (!subData.email) {
        return res.status(400).json({ error: "Email address is required" });
      }

      let subscribers = await getMailingSubscribers();
      
      if (subData.id) {
        // Update
        subscribers = subscribers.map(s => s.id === subData.id ? { ...s, ...subData, updatedAt: new Date().toISOString() } : s);
      } else {
        // Add
        const newSub = {
          id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: subData.name || subData.email.split('@')[0],
          email: subData.email.trim(),
          department: subData.department || 'Логистика / Склад',
          isActive: subData.isActive !== false,
          selectedWarehouses: subData.selectedWarehouses || ['all'],
          formatPreference: subData.formatPreference || 'xlsx',
          comments: subData.comments || '',
          createdAt: new Date().toISOString()
        };
        subscribers.unshift(newSub);
      }

      await saveMailingSubscribers(subscribers);
      res.json({ success: true, subscribers });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to save subscriber" });
    }
  });

  // DELETE Subscriber
  app.delete("/api/mailing/subscribers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let subscribers = await getMailingSubscribers();
      subscribers = subscribers.filter(s => s.id !== id);
      await saveMailingSubscribers(subscribers);

      try {
        await db.collection('mailing_subscribers').doc(id).delete();
      } catch (e) {}

      res.json({ success: true, subscribers });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete subscriber" });
    }
  });

  // GET Settings
  app.get("/api/mailing/settings", async (req, res) => {
    try {
      const settings = await getMailingSettings();
      res.json({ settings });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get settings" });
    }
  });

  // GET Mailing Live Status & Scheduler State
  app.get("/api/mailing/status", async (req, res) => {
    try {
      const settings = await getMailingSettings();
      const subscribers = await getMailingSubscribers();
      const activeSubs = subscribers.filter(s => s.isActive);
      const logs = await getMailingLogs();
      const lastLog = logs.length > 0 ? logs[0] : null;

      const tz = settings?.timezone || 'Asia/Almaty';
      const zoned = getZonedTime(tz);

      res.json({
        enabled: settings?.enabled ?? true,
        scheduleType: settings?.scheduleType || 'daily',
        sendTime: settings?.sendTime || '09:00',
        timezone: tz,
        currentZonedTime: zoned.fullZonedString,
        currentHHmm: zoned.HHmm,
        todayDateStr: zoned.todayDateStr,
        dayOfWeek: zoned.dayOfWeek,
        subscribersCount: subscribers.length,
        activeSubscribersCount: activeSubs.length,
        smtpUser: settings?.smtpUser || process.env.SMTP_USER || '',
        hasSmtpPass: !!(settings?.smtpPass || process.env.SMTP_PASS),
        lastLog
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get mailing status" });
    }
  });

  // POST Settings
  app.post("/api/mailing/settings", async (req, res) => {
    try {
      const newSettings = req.body;
      const current = await getMailingSettings();
      const updated = { ...current, ...newSettings };
      await saveMailingSettings(updated);
      res.json({ success: true, settings: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to save settings" });
    }
  });

  // GET Download Live Excel File
  app.get("/api/mailing/download-excel", async (req, res) => {
    try {
      const warehouseData = await getWarehouseData();
      const excelBuffer = await generateWarehouseExcelBufferAsync(warehouseData);

      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `Daily_Report_Vehicles_and_Stock_${dateStr}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(excelBuffer);
    } catch (error: any) {
      console.error("Error generating Excel download:", error);
      res.status(500).json({ error: error.message || "Failed to generate Excel file" });
    }
  });

  // POST Test SMTP Connection
  app.post("/api/mailing/test-smtp", async (req, res) => {
    try {
      const customSettings = req.body;
      const settings = customSettings || await getMailingSettings();
      const cleanPass = (customSettings?.smtpPass || settings?.smtpPass || process.env.SMTP_PASS || '').trim().replace(/\s+/g, '');
      const cleanUser = (customSettings?.smtpUser || settings?.smtpUser || process.env.SMTP_USER || '').trim();
      const host = (customSettings?.smtpHost || settings?.smtpHost || process.env.SMTP_HOST || 'smtp.gmail.com').trim();
      const port = Number(customSettings?.smtpPort || settings?.smtpPort || 587);
      const secure = customSettings?.smtpSecure !== undefined ? Boolean(customSettings.smtpSecure) : (port === 465);

      if (!cleanUser || !cleanPass) {
        return res.status(400).json({
          success: false,
          error: "Не введен логин или 16-значный Пароль Приложения Google."
        });
      }

      const isGmail = host.toLowerCase().includes('gmail') || cleanUser.toLowerCase().endsWith('@gmail.com');
      const strategies: Array<{ desc: string; config: any }> = [
        { desc: `${host}:${port} (${secure ? 'SSL' : 'STARTTLS'}, IPv4)`, config: { host, port, secure, user: cleanUser, pass: cleanPass } },
        { desc: `${host}:${port === 465 ? 587 : 465} (${port === 465 ? 'STARTTLS' : 'SSL'}, IPv4)`, config: { host, port: port === 465 ? 587 : 465, secure: port !== 465, user: cleanUser, pass: cleanPass } }
      ];

      if (isGmail) {
        strategies.push({
          desc: 'Nodemailer Gmail Engine (IPv4)',
          config: { host, user: cleanUser, pass: cleanPass, useService: true }
        });
      }

      let lastError: any = null;
      for (const strat of strategies) {
        try {
          console.log(`[SMTP Test] Проверка подключения через ${strat.desc}...`);
          const transport = createNodemailerTransport(strat.config);
          await transport.verify();
          console.log(`✅ [SMTP Test] Успешное подключение через ${strat.desc}!`);
          return res.json({
            success: true,
            message: `Подключение к SMTP прошло успешно (${strat.desc})! Пользователь: ${cleanUser}. Сервер готов к отправке писем.`
          });
        } catch (err: any) {
          console.warn(`⚠️ [SMTP Test] ${strat.desc} не удалось:`, err.message);
          lastError = err;
        }
      }

      res.status(400).json({
        success: false,
        error: `Ошибка подключения к SMTP: ${lastError?.message || 'Не удалось установить соединение'}`
      });
    } catch (err: any) {
      console.error("SMTP verify error:", err);
      res.status(400).json({
        success: false,
        error: `Ошибка подключения к SMTP: ${err.message || 'Проверьте хост, порт, логин и пароль'}`
      });
    }
  });

  // POST Send Auto-Mailing
  app.post("/api/mailing/send", async (req, res) => {
    try {
      const { targetSubscriberIds, customEmail, triggerSource = 'manual' } = req.body;
      const result = await executeMailingDispatch({ targetSubscriberIds, customEmail, triggerSource });

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json(result);
    } catch (error: any) {
      console.error("Error sending mailing:", error);
      res.status(500).json({ error: error.message || "Failed to process mailing request" });
    }
  });

  // GET Check Scheduler Diagnostics
  app.get("/api/mailing/check-scheduler", async (req, res) => {
    try {
      const settings = await getMailingSettings();
      const subscribers = await getMailingSubscribers();
      const activeSubs = subscribers.filter(s => s.isActive);
      const tz = settings?.timezone || 'Asia/Almaty';
      const zoned = getZonedTime(tz);

      const normTarget = (settings?.sendTime || '09:00').trim().padStart(5, '0');
      const normCurrent = zoned.HHmm.trim().padStart(5, '0');
      const timeMatched = normTarget === normCurrent;

      let dayMatched = false;
      const dayOfWeek = zoned.dayOfWeek;
      if (settings?.scheduleType === 'daily') dayMatched = true;
      else if (settings?.scheduleType === 'workdays') dayMatched = dayOfWeek >= 1 && dayOfWeek <= 5;
      else if (settings?.scheduleType === 'weekly') dayMatched = dayOfWeek === 1;
      else if (settings?.scheduleType === 'custom' && Array.isArray(settings?.scheduleDays)) dayMatched = settings.scheduleDays.includes(dayOfWeek);

      const isEnabled = settings?.enabled !== false && String(settings?.enabled) !== 'false' && settings?.scheduleType !== 'manual';
      const smtpCheck = await getSmtpTransporter(settings);

      res.json({
        enabled: settings?.enabled ?? true,
        scheduleType: settings?.scheduleType || 'daily',
        timezone: tz,
        currentZonedTime: zoned.fullZonedString,
        currentHHmm: zoned.HHmm,
        targetSendTime: settings?.sendTime || '09:00',
        timeMatched,
        dayMatched,
        shouldRunNow: isEnabled && timeMatched && dayMatched,
        activeSubscribersCount: activeSubs.length,
        smtpConfigured: smtpCheck.configured,
        smtpError: smtpCheck.error || null,
        lastAutoSentKey
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to check scheduler status" });
    }
  });

  // POST Force Auto-Mailing Trigger
  app.post("/api/mailing/force-cron-trigger", async (req, res) => {
    try {
      const result = await executeMailingDispatch({ triggerSource: 'automatic_test' });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to force trigger auto-mailing" });
    }
  });

  // GET Mailing Logs
  app.get("/api/mailing/logs", async (req, res) => {
    try {
      const logs = await getMailingLogs();
      res.json({ logs });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch mailing logs" });
    }
  });

  // API endpoint for document AI parsing of invoices/bills
  app.post("/api/parse-invoice", async (req, res) => {
    try {
      const { fileData, fileName, fileType } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: "No file data provided" });
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
              return res.json({ invoiceNumber: extracted, source: 'pdf-parse' });
            }
          }
        } catch (pdfErr: any) {
          console.error("PDF-parse failed, falling back to Gemini Vision:", pdfErr?.message || pdfErr);
        }
      }

      // 2. Fallback to Gemini Vision
      const ai = getGemini();
      if (!ai) {
        return res.json({ invoiceNumber: null, message: "Gemini API key not configured and PDF text parse did not yield result" });
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

      return res.json({ invoiceNumber, source: 'gemini' });
    } catch (error: any) {
      console.error("Error parsing invoice API:", error?.message || error);
      return res.json({ invoiceNumber: null, error: error?.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  startBackgroundSheetsPolling();
  startMailingScheduler();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
