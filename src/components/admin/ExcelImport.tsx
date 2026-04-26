import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useLanguage } from '../../contexts/LanguageContext';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { collection, addDoc, query, where, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../firebase';
import { Shipment, RouteType, ShipmentStatus } from '../../types';
import { cn } from '../../lib/utils';
import { addDays, parse, format, isValid } from 'date-fns';

interface ParsedData {
  invoice_id: string;
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
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseDate = (dateStr: any, yearContext?: string) => {
    if (!dateStr) return undefined;
    
    let cleanStr = dateStr.toString().trim();
    
    // Handle Excel numeric date
    if (typeof dateStr === 'number') {
      const date = XLSX.SSF.parse_date_code(dateStr);
      return new Date(date.y, date.m - 1, date.d).toISOString();
    }

    // Remove "СВХ", "Алматы" etc if they are part of the string
    cleanStr = cleanStr.replace(/свх|алматы/gi, '').trim();

    try {
      // Try formats: DD.MM.YYYY
      let parsed = parse(cleanStr, 'dd.MM.yyyy', new Date());
      if (isValid(parsed)) return parsed.toISOString();

      // Handle DD.MM (use year from context or current year)
      const currentYear = yearContext ? yearContext.split('.').pop() || new Date().getFullYear().toString() : new Date().getFullYear().toString();
      parsed = parse(`${cleanStr}.${currentYear}`, 'dd.MM.yyyy', new Date());
      if (isValid(parsed)) return parsed.toISOString();
      
      // Try YYYY-MM-DD
      const parsedIso = new Date(cleanStr);
      if (isValid(parsedIso)) return parsedIso.toISOString();
    } catch (e) {
      console.error("Date parse error:", e);
    }
    return undefined;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        
        const allMapped: ParsedData[] = [];

        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const raw_data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

          if (raw_data.length < 1) return;

          // Attempt to find the header row
          let headerIdx = -1;
          for (let i = 0; i < Math.min(raw_data.length, 10); i++) {
            const hasInvoice = raw_data[i].some(cell => cell?.toString().toLowerCase().includes('инвойс'));
            if (hasInvoice) {
              headerIdx = i;
              break;
            }
          }

          if (headerIdx === -1) return;

          const headers = raw_data[headerIdx].map(h => h?.toString().toLowerCase().trim() || '');
          const rows = raw_data.slice(headerIdx + 1);

          // Year context from sheet (often in top rows)
          let yearContext: string | undefined;
          for (let i = 0; i < headerIdx; i++) {
            const rowStr = raw_data[i].join(' ');
            const match = rowStr.match(/\d{2}\.\d{2}\.\d{4}/);
            if (match) {
              yearContext = match[0];
              break;
            }
          }

          const mapped: ParsedData[] = rows.map(row => {
            const getCol = (names: string[]) => {
              const idx = headers.findIndex(h => names.some(name => h.includes(name.toLowerCase())));
              return idx !== -1 ? row[idx] : undefined;
            };

            const invoice_id = getCol(['инвойс'])?.toString() || '';
            const departure_raw = getCol(['выезда', 'отправления']);
            const departure_date = parseDate(departure_raw, yearContext) || new Date().toISOString();
            const itemsRaw = getCol(['товар', 'груз', 'наименование'])?.toString() || '';
            
            const customs_raw = getCol(['свх', 'прибытия']);
            const almaty_raw = getCol(['алматы', 'склад']);
            
            const excelStatusRaw = getCol(['статус'])?.toString() || '';

            const customs_date = parseDate(customs_raw, yearContext);
            const almaty_date = parseDate(almaty_raw, yearContext);

            // Special logic for "16.04 СВХ" in "Дата прибытия" column
            let inferredCustoms = customs_date;
            if (customs_raw?.toString().toLowerCase().includes('свх')) {
              inferredCustoms = customs_date;
            }

            let status: ShipmentStatus = 'In Transit';
            let status_message: string | undefined = undefined;

            // Predefined statuses check
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
            } else if (cleanStatus) {
              status_message = excelStatusRaw;
              // If we have a custom message, check for keywords in message too
              const foundStatus = Object.entries(statusMap).find(([key]) => cleanStatus.includes(key));
              if (foundStatus) {
                status = foundStatus[1];
              } else {
                // Infer from dates if still In Transit
                if (almaty_date) status = 'Delivered';
                else if (customs_date || inferredCustoms) status = 'Customs';
              }
            } else {
              // No status in excel, infer from dates
              if (almaty_date) status = 'Delivered';
              else if (customs_date || inferredCustoms) status = 'Customs';
            }

            return {
              invoice_id: invoice_id.trim(),
              departure_date,
              items: itemsRaw.split(',').map(s => s.trim()).filter(s => s),
              customs_date: inferredCustoms,
              actual_arrival_date: almaty_date,
              route: 'Tehran - Almaty' as RouteType,
              status,
              status_message
            };
          }).filter(r => r.invoice_id);

          allMapped.push(...mapped);
        });

        setData(allMapped);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to parse file");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleImport = async () => {
    if (data.length === 0) return;
    setImporting(true);
    setError(null);

    try {
      let count = 0;
      for (const item of data) {
        const arrival_deadline = addDays(new Date(item.departure_date), 14).toISOString();
        
        // Find existing shipment with this invoice_id
        const shipmentsRef = collection(db, 'shipments');
        const q = query(shipmentsRef, where("invoice_id", "==", item.invoice_id));
        const querySnapshot = await getDocs(q);

        const finalData: any = {
          ...item,
          est_travel_time: 14,
          arrival_deadline,
          last_updated: new Date().toISOString()
        };

        // Remove undefined keys manually
        Object.keys(finalData).forEach(key => finalData[key] === undefined && delete finalData[key]);

        if (!querySnapshot.empty) {
          // Update existing
          const existingDoc = querySnapshot.docs[0];
          await updateDoc(doc(db, 'shipments', existingDoc.id), finalData);
        } else {
          // Create new
          await addDoc(collection(db, 'shipments'), {
            ...finalData,
            documents_url: [],
            createdBy: auth.currentUser?.uid || 'system',
            createdAt: serverTimestamp()
          });
        }
        count++;
      }
      setSuccess(count);
      setData([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setError("Error saving to database");
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-6 border-b border-slate-50 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Excel Import</h3>
          <p className="text-sm text-slate-500">Upload shipments from spreadsheet</p>
        </div>
        <div className="flex gap-2">
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
            className="px-4 py-2 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Select File
          </button>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-center gap-3 border border-red-100">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {success !== null && (
          <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 rounded-xl flex items-center gap-3 border border-emerald-100">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <p className="text-sm font-medium">Successfully imported {success} shipments!</p>
          </div>
        )}

        {data.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600 uppercase tracking-wider">
                Preview ({data.length} rows)
              </span>
              <button 
                onClick={handleImport}
                disabled={importing}
                className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all flex items-center gap-2"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                Import All
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-100 rounded-xl">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-4 py-3 font-bold text-slate-600">Invoice</th>
                    <th className="px-4 py-3 font-bold text-slate-600">Departure</th>
                    <th className="px-4 py-3 font-bold text-slate-600">Items</th>
                    <th className="px-4 py-3 font-bold text-slate-600">Customs</th>
                    <th className="px-4 py-3 font-bold text-slate-600">Warehouse</th>
                    <th className="px-4 py-3 font-bold text-slate-600">Status</th>
                    <th className="px-4 py-3 font-bold text-slate-600">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium">{row.invoice_id}</td>
                      <td className="px-4 py-3">{new Date(row.departure_date).toLocaleDateString()}</td>
                      <td className="px-4 py-3 max-w-[200px] truncate">{row.items.join(', ')}</td>
                      <td className="px-4 py-3">{row.customs_date ? new Date(row.customs_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3">{row.actual_arrival_date ? new Date(row.actual_arrival_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                          row.status === 'Delivered' ? 'bg-emerald-50 text-emerald-600' :
                          row.status === 'Customs' ? 'bg-indigo-50 text-indigo-600' : 'bg-blue-50 text-blue-600'
                        )}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 italic max-w-[150px] truncate">
                        {row.status_message || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : !loading && !success && (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl">
            <FileSpreadsheet className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium text-slate-500">No data loaded</p>
            <p className="text-sm">Select an Excel file to see the preview here</p>
          </div>
        )}
      </div>
    </div>
  );
};
