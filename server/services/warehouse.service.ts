import fs from "fs";
import https from "https";
import * as XLSX from "xlsx";
import { db } from "../config/firebase.js";
import {
  DEFAULT_SPREADSHEET_ID,
  LOGS_FILE_PATH,
  SNAPSHOT_FILE_PATH
} from "../config/constants.js";
import {
  extractPalletNumeric,
  formatCellDate,
  fetchBufferWithRedirects
} from "../utils/helpers.js";
import { getMailingSettings } from "./mailing.service.js";

let customSpreadsheetId = DEFAULT_SPREADSHEET_ID;

export interface SnapshotItem {
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

export function fetchGvizSheet(sheetName: string, spreadsheetId: string): Promise<string> {
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

export function parseGvizResponse(rawText: string) {
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

export function parseWorkbookToWarehouses(buffer: Buffer): any[] {
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

    // Regular Warehouse sheets
    const items: any[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.length === 0) continue;
      const rowStr = row.map(c => String(c).trim()).join(' ');
      if (!rowStr) continue;

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

export function loadLocalLogs(): any[] {
  try {
    if (fs.existsSync(LOGS_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(LOGS_FILE_PATH, 'utf8')) || [];
    }
  } catch (e) {}
  return [];
}

import path from "path";

function ensureDir(filePath: string) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {}
}

export function saveLocalLogs(logsToAppend: any[]) {
  try {
    const existing = loadLocalLogs();
    const existingMap = new Map<string, any>(existing.map(l => [l.id, l]));
    logsToAppend.forEach(l => existingMap.set(l.id, l));
    
    const updated = Array.from(existingMap.values()).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 500);

    ensureDir(LOGS_FILE_PATH);
    fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(updated, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing local logs cache:", e);
  }
}

export function loadLocalSnapshot(): Record<string, SnapshotItem> | null {
  try {
    if (fs.existsSync(SNAPSHOT_FILE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(SNAPSHOT_FILE_PATH, 'utf8'));
      return parsed?.itemsMap || null;
    }
  } catch (e) {}
  return null;
}

export function saveLocalSnapshot(itemsMap: Record<string, SnapshotItem>, updatedAt: string) {
  try {
    ensureDir(SNAPSHOT_FILE_PATH);
    fs.writeFileSync(SNAPSHOT_FILE_PATH, JSON.stringify({ updatedAt, itemsMap }, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing local snapshot cache:", e);
  }
}

export async function processWarehouseSnapshotAndDiff(currentWarehouses: any[], onDispatchCallback?: () => void) {
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
    } catch (e) {}
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
      } catch (err) {}
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
  } catch (err) {}

  if (generatedLogs.length > 0 && onDispatchCallback) {
    onDispatchCallback();
  }

  return generatedLogs;
}

export async function getWarehouseChangeLogs() {
  try {
    const snap = await db.collection('warehouse_change_logs')
      .orderBy('timestamp', 'desc')
      .limit(250)
      .get();
    
    const dbLogs = snap.docs.map(doc => doc.data());
    if (dbLogs.length > 0) return dbLogs;
  } catch (err) {}
  return loadLocalLogs();
}

let cachedWarehouseResult: any = null;
let lastSyncTimestamp: string = '';

export async function getWarehouseData(forceRefresh = false, onDispatchCallback?: () => void) {
  const settings = await getMailingSettings();
  const spreadsheetId = (settings?.spreadsheetId || customSpreadsheetId || DEFAULT_SPREADSHEET_ID).trim();
  customSpreadsheetId = spreadsheetId;

  if (!forceRefresh && cachedWarehouseResult && lastSyncTimestamp) {
    const ageMs = Date.now() - new Date(lastSyncTimestamp).getTime();
    if (ageMs < 30000) {
      return cachedWarehouseResult;
    }
  }

  let result: any[] = [];
  let syncSuccess = false;
  let syncMethod = 'direct_xlsx';

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

  if (!syncSuccess || result.length === 0) {
    if (cachedWarehouseResult && cachedWarehouseResult.warehouses?.length > 0) {
      console.warn('[Warehouse Sync] Using previous in-memory cache due to fetch error');
      return cachedWarehouseResult;
    }
  }

  const nowIso = new Date().toISOString();
  lastSyncTimestamp = nowIso;

  let newLogs: any[] = [];
  try {
    newLogs = await processWarehouseSnapshotAndDiff(result, onDispatchCallback);
  } catch (diffErr) {
    console.error("Error processing warehouse snapshot diff:", diffErr);
  }

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
