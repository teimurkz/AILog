import * as XLSX from "xlsx";
import { createHash } from 'node:crypto';
import { extractPalletNumeric, formatCellDate } from "../utils/helpers.js";

function warehouseIds(sheetNames: string[]): Map<string, string> {
  // Keep established IDs for the two original special tabs. Other tabs must
  // never inherit those IDs merely because their names contain Кусто/машин.
  const canonical = (name: string) => {
    const normalized = name.trim().toLowerCase().replace(/ё/g, 'е');
    if (normalized === 'инв_кусто') return 'inv_kusto';
    if (normalized === 'отчет по машинам') return 'trucks_report';
    return '';
  };
  const slug = (name: string) => name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '_');
  const ids = new Map<string, string>();
  const used = new Set(['inv_kusto', 'trucks_report']);
  for (const name of [...sheetNames].sort()) {
    const legacy = canonical(name);
    const base = legacy || slug(name) || 'warehouse';
    const collision = !legacy && (used.has(base) || sheetNames.some(other => other !== name && slug(other) === base));
    let id = collision ? `${base}_${createHash('sha256').update(name).digest('hex').slice(0, 12)}` : base;
    while (idsHasValue(ids, id)) id += '_';
    used.add(id);
    ids.set(name, id);
  }
  return ids;
}

function idsHasValue(ids: Map<string, string>, value: string) {
  return [...ids.values()].includes(value);
}

export function parseWorkbookToWarehouses(buffer: Buffer): any[] {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const result: any[] = [];
  const ids = warehouseIds(wb.SheetNames);

  for (const sheetName of wb.SheetNames) {
    if (sheetName.toLowerCase().includes('список_документов')) continue;

    const ws = wb.Sheets[sheetName];
    const rawRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rawRows || rawRows.length === 0) continue;

    const sLower = sheetName.toLowerCase();
    const warehouseId = ids.get(sheetName)!;
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
            id: `${warehouseId}-${items.length + 1}`,
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
        id: warehouseId,
        name: sheetName,
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
      let cols = ['№', 'ИНВ', 'Товар', 'Заезд СВХ', 'Выезд СВХ'];
      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        if (!row || row.length === 0) continue;
        const rowStr = row.map(c => String(c).trim()).join(' ');
        if (!rowStr) continue;
        if (String(row[0]).trim() === '№' && /инв/i.test(String(row[1]))) {
          cols = cols.map((fallback, index) => String(row[index] || fallback).trim());
          continue;
        }
        if (rowStr.includes('Апрель-Май') || rowStr.includes('Январь') || rowStr.includes('Февраль')) continue;

        const num = row[0] != null ? String(row[0]).trim() : '';
        const invNum = row[1] != null ? String(row[1]).trim() : '';
        const product = row[2] != null ? String(row[2]).trim() : '';
        const entryDate = formatCellDate(row[3]);
        const exitDate = formatCellDate(row[4]);

        if (product || invNum || entryDate || exitDate) {
          items.push({
            id: `${warehouseId}-${items.length + 1}`,
            number: num || String(items.length + 1),
            invNumber: invNum,
            product,
            palletCount: '',
            entryDate,
            exitDate,
            dates: [entryDate ? `Заезд: ${entryDate}` : '', exitDate ? `Выезд: ${exitDate}` : ''].filter(Boolean).join(' | '),
            svh: sheetName,
            isArchiveItem: true,
            rawRow: row
          });
        }
      }

      result.push({
        id: warehouseId,
        name: sheetName,
        sheetName,
        isArchive: true,
        isTrucksReport: false,
        cols,
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
          id: `${warehouseId}-${items.length + 1}`,
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

    result.push({
      id: warehouseId,
      name: sheetName,
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
