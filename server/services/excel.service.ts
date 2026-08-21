import ExcelJS from "exceljs";

export async function generateWarehouseExcelBufferAsync(warehouseData: any): Promise<Buffer> {
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
