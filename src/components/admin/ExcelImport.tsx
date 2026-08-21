import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../contexts/LanguageContext';
import { GoogleGenAI } from "@google/genai";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Languages, Zap, ShieldCheck, Filter, RefreshCw } from 'lucide-react';
import { collection, query, where, getDocs, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { Shipment, RouteType, ShipmentStatus } from '../../types';
import { cn } from '../../lib/utils';
import { addDays, isValid } from 'date-fns';

interface ParsedData {
  invoice_id: string;
  week?: string | number;
  shipment_type?: string;
  destination?: string;
  goods?: string;
  driver_name?: string;
  driver_phone?: string;
  plate_number?: string;
  loading_date?: string;
  ex_border_date?: string;
  customs_arrival_date?: string;
  unl_date?: string;
  transit_time?: string | number;
  departure_date: string;
  items: string[];
  customs_date?: string;
  actual_arrival_date?: string;
  route: RouteType;
  status: ShipmentStatus;
  status_message?: string;
}

export const ExcelImport = () => {
  const { t, isRTL } = useLanguage();
  const [data, setData] = useState<ParsedData[]>([]);
  const [existingMap, setExistingMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [autoTranslate, setAutoTranslate] = useState(true);
  const [onlyNew, setOnlyNew] = useState(true); // Default TRUE for fast new shipment insertion
  const [updateExisting, setUpdateExisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<number | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [previewStats, setPreviewStats] = useState<{ total: number; newCount: number; duplicateCount: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseDate = (dateStr: any, yearContext?: string) => {
    if (!dateStr) return undefined;

    if (dateStr instanceof Date) {
      return isValid(dateStr) ? dateStr.toISOString() : undefined;
    }
    
    // Handle Excel numeric date if it's still a number
    if (typeof dateStr === 'number') {
      try {
        const date = XLSX.SSF.parse_date_code(dateStr);
        return new Date(date.y, date.m - 1, date.d).toISOString();
      } catch (e) {
        return undefined;
      }
    }

    let cleanStr = dateStr.toString().trim().toLowerCase();
    if (!cleanStr || cleanStr === '-' || cleanStr === '?') return undefined;

    // Remove "СВХ", "Алматы" etc if they are part of the string
    cleanStr = cleanStr.replace(/свх|алматы|выгружен|доставлен|быков|утепов/gi, '').trim();

    // 1. Try format: DD.MM.YYYY
    const dmyRegex = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/;
    const dmyMatch = cleanStr.match(dmyRegex);
    if (dmyMatch) {
      const d = parseInt(dmyMatch[1]);
      const m = parseInt(dmyMatch[2]);
      const y = parseInt(dmyMatch[3]);
      const parsed = new Date(y, m - 1, d);
      if (isValid(parsed)) return parsed.toISOString();
    }

    // 2. Try format: DD.MM (e.g., 12.04 or 16.04)
    const dmRegex = /^(\d{1,2})[-./](\d{1,2})$/;
    const dmMatch = cleanStr.match(dmRegex);
    if (dmMatch) {
      const d = parseInt(dmMatch[1]);
      const m = parseInt(dmMatch[2]);
      const yStr = yearContext ? (yearContext.match(/\d{4}/)?.[0] || '2026') : '2026';
      const parsed = new Date(parseInt(yStr), m - 1, d);
      if (isValid(parsed)) return parsed.toISOString();
    }

    // 3. Try format: text dates like "31-Jan", "5-Feb", "18.май", "20.май"
    const enMonths: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };
    const ruMonths: Record<string, number> = {
      янв: 0, фев: 1, мар: 2, апр: 3, май: 4, июн: 5, июл: 6, авг: 7, сен: 8, окт: 9, ноя: 10, дек: 11,
      мая: 4
    };

    const textDateRegex = /^(\d{1,2})[-./\s]+([a-zа-яё]+)/;
    const textDateMatch = cleanStr.match(textDateRegex);
    if (textDateMatch) {
      const d = parseInt(textDateMatch[1]);
      const monthWord = textDateMatch[2].substring(0, 3);
      let monthIdx = -1;
      
      if (enMonths[monthWord] !== undefined) {
        monthIdx = enMonths[monthWord];
      } else if (ruMonths[monthWord] !== undefined) {
        monthIdx = ruMonths[monthWord];
      } else {
        // Fuzzy startsWith match
        for (const [key, val] of Object.entries(enMonths)) {
          if (monthWord.startsWith(key)) { monthIdx = val; break; }
        }
        if (monthIdx === -1) {
          for (const [key, val] of Object.entries(ruMonths)) {
            if (monthWord.startsWith(key)) { monthIdx = val; break; }
          }
        }
      }

      if (monthIdx !== -1) {
        const yStr = yearContext ? (yearContext.match(/\d{4}/)?.[0] || '2026') : '2026';
        const parsed = new Date(parseInt(yStr), monthIdx, d);
        if (isValid(parsed)) return parsed.toISOString();
      }
    }

    // Fallback: try default Date parser
    try {
      const parsedIso = new Date(dateStr);
      if (isValid(parsedIso)) return parsedIso.toISOString();
    } catch (e) {}

    return undefined;
  };

  const translateItemsChunk = async (items: string[]): Promise<string[]> => {
    if (items.length === 0) return [];
    const hasEnglish = items.some(item => /[a-zA-Z]/.test(item));
    if (!hasEnglish) return items;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Translate the following list of goods/items from English to Russian. 
      If an item is already in Russian, leave it as is. 
      Return ONLY a JSON array of strings, no other text.
      
      Items: ${JSON.stringify(items)}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const text = response.text || "[]";
      const cleaned = text.replace(/```json|```/g, "").trim();
      const translated = JSON.parse(cleaned);
      
      if (Array.isArray(translated) && translated.length === items.length) {
        return translated;
      }
      return items;
    } catch (e) {
      console.error("Translation error:", e);
      return items;
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);
    setSkipped(null);
    setPreviewStats(null);
    setImportProgress(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const arrayBuffer = evt.target?.result as ArrayBuffer;
        const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
        
        const groupedData = new Map<string, ParsedData>();

        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const raw_data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

          if (raw_data.length < 1) return;

          // Find header row
          let headerIdx = -1;
          for (let i = 0; i < Math.min(raw_data.length, 15); i++) {
            const hasInvoice = raw_data[i].some(cell => {
              const str = cell?.toString().toLowerCase();
              return str?.includes('инвойс') || str?.includes('invoice') || str?.includes('счет') || str?.includes('товар') || str?.includes('груз') || str?.includes('order name') || str?.includes('order');
            });
            if (hasInvoice) {
              headerIdx = i;
              break;
            }
          }

          const headers = headerIdx !== -1 
            ? raw_data[headerIdx].map(h => h?.toString().toLowerCase().trim() || '')
            : [];
          
          const rows = raw_data.slice(headerIdx + 1).filter(row => row && row.length > 0);

          // Fast column index mapping once per sheet
          const getColIdx = (names: string[], excludeNames: string[] = []) => {
            return headers.findIndex(h => 
              names.some(name => h.includes(name.toLowerCase())) &&
              !excludeNames.some(ex => h.includes(ex.toLowerCase()))
            );
          };

          const colMap = {
            invoice: getColIdx(['order name', 'order_name', 'order', 'инвойс', 'счет', 'invoice', '№']),
            week: getColIdx(['week', 'неделя']),
            shipmentType: getColIdx(['type of shipment', 'shipment type', 'тип', 'вид']),
            destination: getColIdx(['destination', 'назначение', 'город']),
            goods: getColIdx(['goods', 'товар', 'груз', 'наименование', 'продукта'], ['дата', 'выезда', 'отгрузки', 'место', 'place']),
            driver: getColIdx(['driver', 'водитель', 'фио']),
            phone: getColIdx(['phone no', 'phone', 'телефон', 'номер телефона', 'phone_no']),
            plate: getColIdx(['transit plate no', 'transit plate', 'plate no', 'plate', 'номер машины', 'номер', 'госномер', 'transit_plate_no']),
            lDate: getColIdx(['l date', 'l.date', 'l_date', 'дата загрузки', 'погрузка', 'date', 'дата']),
            exBorder: getColIdx(['ex border date', 'ex border', 'выход с границы', 'граница', 'border']),
            customs: getColIdx(['a to destination customs', 'destination customs', 'a to c.dc', 'c.dc', 'таможня', 'свх', 'прибытия', 'гтд', 'customs', 'координаты свх']),
            unloading: getColIdx(['unl date', 'unl_date', 'разгрузка', 'склад', 'алматы', 'warehouse', 'доставлен', 'выгрузка']),
            tt: getColIdx(['t.t', 'tt', 'transit time', 'время в пути']),
            lPlace: getColIdx(['l place', 'l. place', 'l_place', 'место погрузки', 'погрузка']),
            status: getColIdx(['статус', 'status'])
          };

          let yearContext: string | undefined;
          for (let i = 0; i < Math.max(headerIdx, 5); i++) {
            const rowStr = raw_data[i]?.join(' ') || '';
            const match = rowStr.match(/\d{2}\.\d{2}\.\d{4}/);
            if (match) {
              yearContext = match[0];
              break;
            }
          }

          rows.forEach(row => {
            const getVal = (idx: number) => (idx !== -1 && row[idx] !== undefined) ? row[idx] : undefined;

            const raw_invoice_id = getVal(colMap.invoice)?.toString() || '';
            const invoice_id = raw_invoice_id.trim();
            if (!invoice_id) return;

            const weekRaw = getVal(colMap.week)?.toString() || '';
            const shipmentTypeRaw = getVal(colMap.shipmentType)?.toString() || '';
            const destinationRaw = getVal(colMap.destination)?.toString() || '';
            const goodsRaw = getVal(colMap.goods)?.toString() || '';
            const newItems = goodsRaw ? goodsRaw.split(',').map(s => s.trim()).filter(s => s) : [];

            const driverRaw = getVal(colMap.driver)?.toString() || '';
            const phoneRaw = getVal(colMap.phone)?.toString() || '';
            const plateRaw = getVal(colMap.plate)?.toString() || '';

            const lDateRaw = getVal(colMap.lDate)?.toString() || '';
            const exBorderRaw = getVal(colMap.exBorder)?.toString() || '';
            const arrivalCustomsRaw = getVal(colMap.customs)?.toString() || '';
            const unloadingRaw = getVal(colMap.unloading)?.toString() || '';
            const ttRaw = getVal(colMap.tt)?.toString() || '';

            const departure_date = parseDate(lDateRaw, yearContext) || parseDate(exBorderRaw, yearContext) || new Date().toISOString();
            const customs_date = parseDate(arrivalCustomsRaw, yearContext);
            const actual_arrival_date = parseDate(unloadingRaw, yearContext);

            const loadingPlaceRaw = getVal(colMap.lPlace)?.toString() || '';
            let route: RouteType = 'Tehran - Almaty';
            if (loadingPlaceRaw.toLowerCase().includes('amol')) {
              route = 'Amol - Almaty';
            }

            const statusParts = [];
            if (driverRaw) statusParts.push(`Водитель: ${driverRaw}`);
            if (phoneRaw) statusParts.push(`Тел: ${phoneRaw}`);
            if (plateRaw) statusParts.push(`Транспорт: ${plateRaw}`);
            if (ttRaw) statusParts.push(`T.T: ${ttRaw} дн.`);
            if (exBorderRaw) statusParts.push(`Граница: ${exBorderRaw}`);
            const status_message = statusParts.join(' | ') || undefined;

            let status: ShipmentStatus = 'In Transit';
            let excelStatusRaw = getVal(colMap.status)?.toString() || '';

            if (actual_arrival_date || unloadingRaw) {
              status = 'Delivered';
            } else if (customs_date || arrivalCustomsRaw) {
              status = 'Customs';
            } else if (exBorderRaw) {
              status = 'In Transit';
            }

            if (excelStatusRaw) {
              const statusMap: Record<string, ShipmentStatus> = {
                'в пути': 'In Transit',
                'готов к выгрузке': 'Customs',
                'таможня': 'Customs',
                'свх': 'Customs',
                'на свх': 'Customs',
                'на очистке': 'Customs',
                'досмотр': 'Customs',
                'выгружен': 'Delivered',
                'доставлен': 'Delivered',
                'прибыл': 'Delivered',
                'задержка': 'Delay',
                'ожидание': 'Delay'
              };
              const cleanStatus = excelStatusRaw.toLowerCase().trim();
              if (statusMap[cleanStatus]) {
                status = statusMap[cleanStatus];
              }
            }

            if (groupedData.has(invoice_id)) {
              const existing = groupedData.get(invoice_id)!;
              const combinedItems = Array.from(new Set([...existing.items, ...newItems]));
              
              const statusPriority: Record<ShipmentStatus, number> = {
                'In Transit': 1,
                'Delay': 2,
                'Customs': 3,
                'Delivered': 4
              };

              const newStatus = statusPriority[status] > statusPriority[existing.status] ? status : existing.status;

              groupedData.set(invoice_id, {
                ...existing,
                items: combinedItems,
                status: newStatus,
                week: existing.week || weekRaw,
                shipment_type: existing.shipment_type || shipmentTypeRaw,
                destination: existing.destination || destinationRaw,
                goods: existing.goods || goodsRaw,
                driver_name: existing.driver_name || driverRaw,
                driver_phone: existing.driver_phone || phoneRaw,
                plate_number: existing.plate_number || plateRaw,
                loading_date: existing.loading_date || lDateRaw,
                ex_border_date: existing.ex_border_date || exBorderRaw,
                customs_arrival_date: existing.customs_arrival_date || arrivalCustomsRaw,
                unl_date: existing.unl_date || unloadingRaw,
                transit_time: existing.transit_time || ttRaw,
                customs_date: existing.customs_date || customs_date,
                actual_arrival_date: existing.actual_arrival_date || actual_arrival_date,
                status_message: existing.status_message || status_message
              });
            } else {
              groupedData.set(invoice_id, {
                invoice_id,
                week: weekRaw,
                shipment_type: shipmentTypeRaw,
                destination: destinationRaw,
                goods: goodsRaw,
                driver_name: driverRaw,
                driver_phone: phoneRaw,
                plate_number: plateRaw,
                loading_date: lDateRaw,
                ex_border_date: exBorderRaw,
                customs_arrival_date: arrivalCustomsRaw,
                unl_date: unloadingRaw,
                transit_time: ttRaw,
                departure_date,
                items: newItems,
                customs_date,
                actual_arrival_date,
                route,
                status,
                status_message
              });
            }
          });
        });

        const finalData = Array.from(groupedData.values());

        // Fast Translation Step if enabled
        if (autoTranslate) {
          setTranslating(true);
          const allUniqueItems = Array.from(new Set(finalData.flatMap(d => d.items)));
          const itemsNeedingTranslation = allUniqueItems.filter(item => /[a-zA-Z]/.test(item));

          if (itemsNeedingTranslation.length > 0) {
            // Chunk translation to avoid Gemini timeouts
            const chunkSize = 40;
            const translatedMap = new Map<string, string>();

            for (let i = 0; i < itemsNeedingTranslation.length; i += chunkSize) {
              const chunk = itemsNeedingTranslation.slice(i, i + chunkSize);
              const translatedChunk = await translateItemsChunk(chunk);
              chunk.forEach((orig, idx) => {
                translatedMap.set(orig, translatedChunk[idx] || orig);
              });
            }

            finalData.forEach(shipment => {
              shipment.items = shipment.items.map(item => translatedMap.get(item) || item);
            });
          }
          setTranslating(false);
        }

        // Fast Database Pre-Fetch (1 single query to get all existing invoice_ids)
        const shipmentsRef = collection(db, 'shipments');
        const dbSnapshot = await getDocs(shipmentsRef);
        const map = new Map<string, string>();
        dbSnapshot.docs.forEach(docSnap => {
          const invId = docSnap.data().invoice_id?.toString().trim();
          if (invId) {
            map.set(invId, docSnap.id);
          }
        });
        setExistingMap(map);

        let newCount = 0;
        let duplicateCount = 0;
        finalData.forEach(item => {
          if (map.has(item.invoice_id)) {
            duplicateCount++;
          } else {
            newCount++;
          }
        });

        setPreviewStats({
          total: finalData.length,
          newCount,
          duplicateCount
        });

        setData(finalData);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('failedToParseFile'));
      } finally {
        setLoading(false);
        setTranslating(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImport = async () => {
    if (data.length === 0) return;
    setImporting(true);
    setError(null);
    setSuccess(null);
    setSkipped(null);

    try {
      // Determine items to process
      let itemsToProcess = data;
      if (onlyNew) {
        itemsToProcess = data.filter(item => !existingMap.has(item.invoice_id));
      }

      if (itemsToProcess.length === 0) {
        setSkipped(data.length);
        setSuccess(0);
        setError("Внимание: Все отгрузки из этого файла уже имеются в базе данных. Новых отгрузок не найдено.");
        setImporting(false);
        return;
      }

      const totalItems = itemsToProcess.length;
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = data.length - itemsToProcess.length;

      // Batch Write in chunks of 400 for blazing speed
      const chunkSize = 400;
      for (let i = 0; i < itemsToProcess.length; i += chunkSize) {
        const chunk = itemsToProcess.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        setImportProgress({
          current: Math.min(i + chunkSize, totalItems),
          total: totalItems,
          message: `Пакетное добавление в базу (${Math.min(i + chunkSize, totalItems)} из ${totalItems})...`
        });

        for (const item of chunk) {
          const arrival_deadline = addDays(new Date(item.departure_date), 14).toISOString();
          const docData: any = {
            ...item,
            est_travel_time: 14,
            arrival_deadline,
            last_updated: new Date().toISOString()
          };
          Object.keys(docData).forEach(key => docData[key] === undefined && delete docData[key]);

          const existingDocId = existingMap.get(item.invoice_id);
          if (existingDocId) {
            if (updateExisting) {
              const docRef = doc(db, 'shipments', existingDocId);
              batch.update(docRef, docData);
              updatedCount++;
            } else {
              skippedCount++;
            }
          } else {
            const newDocRef = doc(collection(db, 'shipments'));
            batch.set(newDocRef, {
              ...docData,
              documents_url: [],
              createdBy: auth.currentUser?.uid || 'system',
              createdAt: serverTimestamp()
            });
            createdCount++;
          }
        }

        await batch.commit();
      }

      setSuccess(createdCount + updatedCount);
      setSkipped(skippedCount);
      setData([]);
      setPreviewStats(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setError(err.message || t('dbSaveError'));
      console.error("Batch import error:", err);
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t('excelImport')}</h3>
            <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold rounded-full flex items-center gap-1 border border-emerald-300 dark:border-emerald-800">
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>Пакетная ускоренная загрузка</span>
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('uploadShipmentsDescription')}</p>
        </div>

        <div className="flex items-center gap-2">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx, .xls, .csv"
            className="hidden"
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || importing}
            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center gap-2 transition-all disabled:opacity-50 text-sm shadow-sm"
          >
            {loading || translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {translating ? t('translatingText') : t('selectFile')}
          </button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Settings & Import Mode Controls */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-4 text-xs font-medium text-slate-700 dark:text-slate-200">
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input 
                type="checkbox" 
                checked={onlyNew}
                onChange={(e) => {
                  setOnlyNew(e.target.checked);
                  if (e.target.checked) setUpdateExisting(false);
                }}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 dark:border-slate-600"
              />
              <span className="font-bold text-slate-900 dark:text-white">⚡ Только новые отгрузки (быстрый режим)</span>
            </label>

            {!onlyNew && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 border-slate-300 dark:border-slate-600"
                />
                <span>Обновлять дублирующиеся данные в базе</span>
              </label>
            )}
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-400">
            <input 
              type="checkbox" 
              checked={autoTranslate}
              onChange={(e) => setAutoTranslate(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 dark:border-slate-600"
            />
            <Languages className="w-3.5 h-3.5 text-emerald-600" />
            <span>Авто-перевод товаров Gemini AI</span>
          </label>
        </div>

        {error && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 rounded-xl flex items-center gap-3 border border-amber-200 dark:border-amber-800/60">
            <AlertCircle className="w-5 h-5 shrink-0 text-amber-600" />
            <p className="text-sm font-semibold">{error}</p>
          </div>
        )}

        {importProgress && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 rounded-xl border border-blue-200 dark:border-blue-800/60 space-y-2">
            <div className="flex items-center justify-between font-bold text-xs">
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span>{importProgress.message}</span>
              </span>
              <span>{Math.round((importProgress.current / importProgress.total) * 100)}%</span>
            </div>
            <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2 overflow-hidden">
              <div 
                className="bg-blue-600 h-2 transition-all duration-300 rounded-full"
                style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {translating && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 rounded-xl flex items-center gap-3 border border-blue-100 dark:border-blue-900 animate-pulse">
            <Languages className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{t('translatingItems')}</p>
          </div>
        )}

        {success !== null && (
          <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 rounded-xl flex flex-col gap-1 border border-emerald-200 dark:border-emerald-800/60">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
              <p className="font-bold text-base">{t('importSuccess')}</p>
            </div>
            <p className="text-sm pl-8 text-emerald-900 dark:text-emerald-200 font-medium mt-1">
              {t('addedNew')}: <strong className="text-emerald-700 dark:text-emerald-300 font-bold text-base">{success}</strong>.
              {skipped !== null && skipped > 0 && (
                <span> {t('skippedDuplicates')}: <strong className="text-amber-700 dark:text-amber-300 font-bold text-base">{skipped}</strong>.</span>
              )}
            </p>
          </div>
        )}

        {data.length > 0 ? (
          <div className="space-y-4">
            {/* Quick Preview Header & Stats Badges */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-100 dark:bg-slate-800/80 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Найдено в файле: <strong>{data.length}</strong>
                </span>

                {previewStats && (
                  <>
                    <span className="px-2.5 py-1 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 text-xs font-bold rounded-lg border border-emerald-500/30 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Новые: {previewStats.newCount}</span>
                    </span>

                    <span className="px-2.5 py-1 bg-amber-500/15 text-amber-800 dark:text-amber-300 text-xs font-bold rounded-lg border border-amber-500/30 flex items-center gap-1">
                      <Filter className="w-3.5 h-3.5 text-amber-600" />
                      <span>Уже есть в базе (дубли): {previewStats.duplicateCount}</span>
                    </span>
                  </>
                )}
              </div>

              <button 
                onClick={handleImport}
                disabled={importing}
                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-all flex items-center justify-center gap-2 text-sm shadow-sm shrink-0"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                <span>
                  {onlyNew 
                    ? `Загрузить новые (${previewStats ? previewStats.newCount : data.length})` 
                    : `Загрузить все (${data.length})`
                  }
                </span>
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-xl max-h-[450px]">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 z-10">
                  <tr>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">Статус в БД</th>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{t('invoice')}</th>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{t('departure')}</th>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{t('items')}</th>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{t('customs')}</th>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{t('warehouse')}</th>
                    <th className="px-4 py-3 font-bold text-slate-700 dark:text-slate-300">{t('status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.map((row, i) => {
                    const isDuplicate = existingMap.has(row.invoice_id);
                    return (
                      <tr key={i} className={cn("hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors", isDuplicate && onlyNew && "opacity-60 bg-amber-50/30 dark:bg-amber-950/20")}>
                        <td className="px-4 py-3 text-xs">
                          {isDuplicate ? (
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800">
                              Есть в БД
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800">
                              Новая
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{row.invoice_id}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{new Date(row.departure_date).toLocaleDateString()}</td>
                        <td className="px-4 py-3 max-w-[220px] truncate text-slate-700 dark:text-slate-300" title={row.items.join(', ')}>
                          {row.items.join(', ')}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.customs_date ? new Date(row.customs_date).toLocaleDateString() : '-'}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.actual_arrival_date ? new Date(row.actual_arrival_date).toLocaleDateString() : '-'}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                            row.status === 'Delivered' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' :
                            row.status === 'Customs' ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                          )}>
                            {t(row.status as any) || row.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : !loading && !success && (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <FileSpreadsheet className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium text-slate-600 dark:text-slate-300">{t('noDataLoaded')}</p>
            <p className="text-sm text-slate-400 mt-1">{t('selectExcelToPreview')}</p>
          </div>
        )}
      </div>
    </div>
  );
};

