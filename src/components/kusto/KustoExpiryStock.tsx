import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  FileSpreadsheet, 
  Upload, 
  Download, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Calendar, 
  Package, 
  RotateCcw,
  ShieldAlert,
  Info,
  Check,
  SlidersHorizontal,
  Settings,
  X,
  RefreshCw,
  Eye,
  Layers,
  HelpCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { KustoExpiryItem } from '../../types';

const LOCAL_STORAGE_KEY = 'kusto_expiry_stock_data_v3';
const LOCAL_STORAGE_MAP_KEY = 'kusto_expiry_stock_col_map_v3';

export interface KustoColumnMapping {
  group: number;
  article: number;
  name: number;
  rsv: number;
  unit: number;
  batch: number;
  productionDate: number;
  expiryDate: number;
  minDaysLimit: number;
  daysToExpiry: number;
  commercializationDeadline: number;
  daysToDeadline: number;
  stockType: number;
  totalStock: number;
  reservedStock: number;
  freeStock: number;
}

const DEFAULT_COLUMN_MAPPING: KustoColumnMapping = {
  group: 0,
  article: 1,
  name: 2,
  rsv: 3,
  unit: 4,
  batch: 5,
  productionDate: 6,
  expiryDate: 7,
  minDaysLimit: 8,
  daysToExpiry: 9,
  commercializationDeadline: 10,
  daysToDeadline: 11,
  stockType: 12,
  totalStock: 13,
  reservedStock: 14,
  freeStock: 15
};

const formatNum = (val: number | null | undefined): string => {
  if (val === null || val === undefined || isNaN(val)) return '0';
  return Number(val).toLocaleString('ru-RU');
};

// Clean string and quotes
const cleanText = (v: any): string => {
  if (v === null || v === undefined) return '';
  let str = String(v).trim();
  // Remove wrapping double-double quotes e.g. ""Сметанковый"" -> "Сметанковый"
  str = str.replace(/^"+|"+$/g, '"').replace(/""/g, '"');
  return str.trim();
};

// Clean article preserving leading zeros and string representations
const cleanArticle = (v: any): string => {
  if (v === null || v === undefined || v === '') return '';
  let str = String(v).trim();
  str = str.replace(/^"+|"+$/g, '').trim();
  return str;
};

// Parse signed integer/float handling unicode minus, spaces (e.g. "12 191"), commas, parentheses
const parseSignedNum = (v: any): number => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  let str = String(v).trim();
  // Handle parenthesis for negative numbers e.g. "(122)" -> "-122"
  if (str.startsWith('(') && str.endsWith(')')) {
    str = '-' + str.slice(1, -1);
  }
  // Replace unicode dashes (\u2212 minus, \u2013 en-dash, \u2014 em-dash, etc.) with standard ascii hyphen
  str = str.replace(/[\u2212\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-');
  // Remove non-breaking spaces (\u00A0), thin spaces (\u202F), standard spaces
  str = str.replace(/[\s\u00A0\u202F]+/g, '');
  // Replace comma with dot
  str = str.replace(',', '.');
  // If trailing minus like "122-"
  if (str.endsWith('-')) {
    str = '-' + str.slice(0, -1);
  }
  // Keep only digits, minus, and dot
  str = str.replace(/[^0-9.-]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

// Clean dates from Excel cells (handling strings, Date objects, and numeric serial dates)
const cleanDateStr = (v: any): string => {
  if (v === null || v === undefined || v === '' || v === '-') return '—';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '—';
    const day = String(v.getUTCDate()).padStart(2, '0');
    const month = String(v.getUTCMonth() + 1).padStart(2, '0');
    const year = v.getUTCFullYear();
    return `${day}.${month}.${year}`;
  }
  // Check if Excel serial date number (e.g. 45522)
  if (typeof v === 'number' && v > 20000 && v < 70000) {
    try {
      const date = new Date(Math.round((v - 25569) * 86400 * 1000));
      if (!isNaN(date.getTime())) {
        const day = String(date.getUTCDate()).padStart(2, '0');
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const year = date.getUTCFullYear();
        return `${day}.${month}.${year}`;
      }
    } catch {
      // ignore
    }
  }
  let str = String(v).trim();
  // Strip trailing "г." or "г" or time " 00:00:00"
  str = str.replace(/\s*г\.?$/i, '').trim();
  str = str.replace(/\s+\d{1,2}:\d{2}(:\d{2})?$/, '').trim();

  // Normalize separators / or - to .
  const dmyMatch = str.match(/^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})/);
  if (dmyMatch) {
    let day = dmyMatch[1].padStart(2, '0');
    let month = dmyMatch[2].padStart(2, '0');
    let year = dmyMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${day}.${month}.${year}г.`;
  }
  const ymdMatch = str.match(/^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})/);
  if (ymdMatch) {
    let year = ymdMatch[1];
    let month = ymdMatch[2].padStart(2, '0');
    let day = ymdMatch[3].padStart(2, '0');
    return `${day}.${month}.${year}г.`;
  }
  return str ? (str.endsWith('г.') ? str : `${str}г.`) : '—';
};

// Real baseline data transcribed directly from user's official Kusto report screenshot
const INITIAL_SAMPLE_DATA: KustoExpiryItem[] = [
  {
    id: 'k-1',
    group: 'MEHKAZ',
    article: '00000000410',
    name: 'Продукт готовый из молочного сырья "Сметанковый" 50% жира',
    rsv: 1,
    unit: 'Килограмм',
    batch: '20032026',
    productionDate: '18.08.2026',
    expiryDate: '15.04.2027г.',
    minDaysLimit: 14,
    daysToExpiry: 238,
    commercializationDeadline: '01.04.2027г.',
    daysToDeadline: 224,
    stockType: 'B',
    totalStock: 0,
    reservedStock: 0,
    freeStock: 0
  },
  {
    id: 'k-2',
    group: 'MEHKAZ',
    article: '00000000410',
    name: 'Продукт готовый из молочного сырья "Сметанковый" 50% жира',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '08.05.2026',
    expiryDate: '04.11.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 76,
    commercializationDeadline: '21.10.2026г.',
    daysToDeadline: 62,
    stockType: 'N',
    totalStock: 332,
    reservedStock: 68,
    freeStock: 264
  },
  {
    id: 'k-3',
    group: 'MEHKAZ',
    article: '00000000410',
    name: 'Продукт готовый из молочного сырья "Сметанковый" 50% жира',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '28.06.2026',
    expiryDate: '25.12.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 127,
    commercializationDeadline: '11.12.2026г.',
    daysToDeadline: 113,
    stockType: 'N',
    totalStock: 9800,
    reservedStock: 0,
    freeStock: 9800
  },
  {
    id: 'k-4',
    group: 'MEHKAZ',
    article: '00000000410',
    name: 'Продукт готовый из молочного сырья "Сметанковый" 50% жира',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '28.06.2026',
    expiryDate: '25.12.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 127,
    commercializationDeadline: '11.12.2026г.',
    daysToDeadline: 113,
    stockType: 'A',
    totalStock: 1394,
    reservedStock: 15,
    freeStock: 1379
  },
  {
    id: 'k-5',
    group: 'MEHKAZ',
    article: '00000000410',
    name: 'Продукт готовый из молочного сырья "Сметанковый" 50% жира',
    rsv: 1,
    unit: 'Килограмм',
    batch: '20032026',
    productionDate: '29.04.2026',
    expiryDate: '25.12.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 127,
    commercializationDeadline: '11.12.2026г.',
    daysToDeadline: 113,
    stockType: 'N',
    totalStock: 13,
    reservedStock: 0,
    freeStock: 13
  },
  {
    id: 'k-6',
    group: 'MEHKAZ',
    article: '00000000410',
    name: 'Продукт готовый из молочного сырья "Сметанковый" 50% жира',
    rsv: 1,
    unit: 'Килограмм',
    batch: '20032026',
    productionDate: '27.04.2026',
    expiryDate: '23.12.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 125,
    commercializationDeadline: '09.12.2026г.',
    daysToDeadline: 111,
    stockType: 'N',
    totalStock: 3,
    reservedStock: 0,
    freeStock: 3
  },
  {
    id: 'k-7',
    group: 'MEHKAZ',
    article: '30000215',
    name: 'Сыр Халуми, 2 кг.',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 0,
    daysToExpiry: 66,
    commercializationDeadline: '25.10.2026г.',
    daysToDeadline: 66,
    stockType: 'N',
    totalStock: 2,
    reservedStock: 0,
    freeStock: 2
  },
  {
    id: 'k-8',
    group: 'MEHKAZ',
    article: '30000215',
    name: 'Сыр Халуми, 2 кг.',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 0,
    daysToExpiry: 66,
    commercializationDeadline: '25.10.2026г.',
    daysToDeadline: 66,
    stockType: 'B',
    totalStock: 0,
    reservedStock: 0,
    freeStock: 0
  },
  {
    id: 'k-9',
    group: 'MEHKAZ',
    article: '30000581',
    name: 'Темный шоколад в монетах 3,5кг',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '24.10.2025',
    expiryDate: '24.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 65,
    commercializationDeadline: '10.10.2026г.',
    daysToDeadline: 51,
    stockType: 'N',
    totalStock: 26,
    reservedStock: 0,
    freeStock: 26
  },
  {
    id: 'k-10',
    group: 'MEHKAZ',
    article: '30000581',
    name: 'Темный шоколад в монетах 3,5кг',
    rsv: 1,
    unit: 'Штука',
    batch: '050326',
    productionDate: '03.02.2026',
    expiryDate: '03.02.2027г.',
    minDaysLimit: 14,
    daysToExpiry: 167,
    commercializationDeadline: '20.01.2027г.',
    daysToDeadline: 153,
    stockType: 'A',
    totalStock: 130,
    reservedStock: 0,
    freeStock: 130
  },
  {
    id: 'k-11',
    group: 'MEHKAZ',
    article: '30001273',
    name: 'Сыр Гауда, круг',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 66,
    commercializationDeadline: '11.10.2026г.',
    daysToDeadline: 52,
    stockType: 'N',
    totalStock: 3,
    reservedStock: 0,
    freeStock: 3
  },
  {
    id: 'k-12',
    group: 'MEHKAZ',
    article: '30001274',
    name: 'Красный Песто, блок, 3 кг',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 66,
    commercializationDeadline: '11.10.2026г.',
    daysToDeadline: 52,
    stockType: 'N',
    totalStock: 0,
    reservedStock: 0,
    freeStock: 0
  },
  {
    id: 'k-13',
    group: 'MEHKAZ',
    article: '30001274',
    name: 'Красный Песто, блок, 3 кг',
    rsv: 1,
    unit: 'Килограмм',
    batch: '29012026',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 66,
    commercializationDeadline: '11.10.2026г.',
    daysToDeadline: 52,
    stockType: 'N',
    totalStock: 265,
    reservedStock: 0,
    freeStock: 265
  },
  {
    id: 'k-14',
    group: 'MEHKAZ',
    article: '30001276',
    name: 'Зеленый Песто, блок/3 кг',
    rsv: 1,
    unit: 'Килограмм',
    batch: '29012026',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 66,
    commercializationDeadline: '11.10.2026г.',
    daysToDeadline: 52,
    stockType: 'N',
    totalStock: 194,
    reservedStock: 0,
    freeStock: 194
  },
  {
    id: 'k-15',
    group: 'MEHKAZ',
    article: '30001479',
    name: 'Соус "Йогуртовый" 450 гр',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '26.08.2025',
    expiryDate: '26.08.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 6,
    commercializationDeadline: '12.08.2026г.',
    daysToDeadline: -8,
    stockType: 'H',
    totalStock: 437,
    reservedStock: 0,
    freeStock: 437
  },
  {
    id: 'k-16',
    group: 'MEHKAZ',
    article: '30001479',
    name: 'Соус "Йогуртовый" 450 гр',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '24.08.2025',
    expiryDate: '24.08.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 4,
    commercializationDeadline: '10.08.2026г.',
    daysToDeadline: -10,
    stockType: 'H',
    totalStock: 7,
    reservedStock: 0,
    freeStock: 7
  },
  {
    id: 'k-17',
    group: 'MEHKAZ',
    article: '30001479',
    name: 'Соус "Йогуртовый" 450 гр',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '24.08.2025',
    expiryDate: '24.08.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 4,
    commercializationDeadline: '10.08.2026г.',
    daysToDeadline: -10,
    stockType: 'B',
    totalStock: 3,
    reservedStock: 0,
    freeStock: 3
  },
  {
    id: 'k-18',
    group: 'MEHKAZ',
    article: '30001674',
    name: 'Козий сыр, круг',
    rsv: 1,
    unit: 'Килограмм',
    batch: '-',
    productionDate: '25.10.2025',
    expiryDate: '25.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 66,
    commercializationDeadline: '11.10.2026г.',
    daysToDeadline: 52,
    stockType: 'N',
    totalStock: 25,
    reservedStock: 0,
    freeStock: 25
  },
  {
    id: 'k-19',
    group: 'MEHKAZ',
    article: '30001674',
    name: 'Козий сыр, круг',
    rsv: 1,
    unit: 'Килограмм',
    batch: '02022026',
    productionDate: '02.06.2026',
    expiryDate: '02.06.2027г.',
    minDaysLimit: 14,
    daysToExpiry: 286,
    commercializationDeadline: '19.05.2027г.',
    daysToDeadline: 272,
    stockType: 'N',
    totalStock: 3,
    reservedStock: 0,
    freeStock: 3
  },
  {
    id: 'k-20',
    group: 'MEHKAZ',
    article: '30001995',
    name: 'Мини-рожок хрустящий с какаосодержащей начинкой "Фундук" 200г (brown)',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '25.01.2025',
    expiryDate: '20.04.2026г.',
    minDaysLimit: 14,
    daysToExpiry: -122,
    commercializationDeadline: '06.04.2026г.',
    daysToDeadline: -136,
    stockType: 'E',
    totalStock: 1,
    reservedStock: 0,
    freeStock: 1
  },
  {
    id: 'k-21',
    group: 'MEHKAZ',
    article: '30002280',
    name: 'Соус Барбекю 375 г',
    rsv: 1,
    unit: 'Штука',
    batch: '29012026',
    productionDate: '17.02.2026',
    expiryDate: '17.02.2027г.',
    minDaysLimit: 14,
    daysToExpiry: 181,
    commercializationDeadline: '03.02.2027г.',
    daysToDeadline: 167,
    stockType: 'A',
    totalStock: 12,
    reservedStock: 0,
    freeStock: 12
  },
  {
    id: 'k-22',
    group: 'MEHKAZ',
    article: '30002280',
    name: 'Соус Барбекю 375 г',
    rsv: 1,
    unit: 'Штука',
    batch: '29012026',
    productionDate: '17.02.2026',
    expiryDate: '17.02.2027г.',
    minDaysLimit: 14,
    daysToExpiry: 181,
    commercializationDeadline: '03.02.2027г.',
    daysToDeadline: 167,
    stockType: 'N',
    totalStock: 325,
    reservedStock: 1,
    freeStock: 324
  },
  {
    id: 'k-23',
    group: 'MEHKAZ',
    article: '30002283',
    name: 'Соус майонезный "легкий" 450 г',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '24.08.2025',
    expiryDate: '24.08.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 4,
    commercializationDeadline: '10.08.2026г.',
    daysToDeadline: -10,
    stockType: 'H',
    totalStock: 109,
    reservedStock: 0,
    freeStock: 109
  },
  {
    id: 'k-24',
    group: 'MEHKAZ',
    article: '30002332',
    name: 'Соус горчичный 335 г',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '29.10.2025',
    expiryDate: '29.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 70,
    commercializationDeadline: '15.10.2026г.',
    daysToDeadline: 56,
    stockType: 'A',
    totalStock: 14,
    reservedStock: 0,
    freeStock: 14
  },
  {
    id: 'k-25',
    group: 'MEHKAZ',
    article: '30002332',
    name: 'Соус горчичный 335 г',
    rsv: 1,
    unit: 'Штука',
    batch: '-',
    productionDate: '29.10.2025',
    expiryDate: '29.10.2026г.',
    minDaysLimit: 14,
    daysToExpiry: 70,
    commercializationDeadline: '15.10.2026г.',
    daysToDeadline: 56,
    stockType: 'N',
    totalStock: 6,
    reservedStock: 0,
    freeStock: 6
  }
];

export const KustoExpiryStock: React.FC = () => {
  const [items, setItems] = useState<KustoExpiryItem[]>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item: any) => ({
            ...item,
            totalStock: Number(item.totalStock) || 0,
            reservedStock: Number(item.reservedStock) || 0,
            freeStock: Number(item.freeStock) || 0,
            daysToExpiry: Number(item.daysToExpiry) || 0,
            daysToDeadline: Number(item.daysToDeadline) || 0,
            minDaysLimit: Number(item.minDaysLimit) || 0,
          }));
        }
      }
    } catch (e) {
      console.error('Error reading saved Kusto expiry stock:', e);
    }
    return INITIAL_SAMPLE_DATA;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStockType, setSelectedStockType] = useState<string>('all');
  const [selectedUrgency, setSelectedUrgency] = useState<string>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('days_asc');
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reportDateInfo, setReportDateInfo] = useState<string | null>('20.08.2026 10:00:25');

  // Column Mapping & Diagnostic State
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [rawWorkbookData, setRawWorkbookData] = useState<any[][] | null>(null);
  const [availableColumns, setAvailableColumns] = useState<{ index: number; label: string; sample: string }[]>([]);
  const [dataStartRowIndex, setDataStartRowIndex] = useState<number>(3);
  const [columnMapping, setColumnMapping] = useState<KustoColumnMapping>(() => {
    try {
      const savedMap = localStorage.getItem(LOCAL_STORAGE_MAP_KEY);
      if (savedMap) return JSON.parse(savedMap);
    } catch {
      // ignore
    }
    return DEFAULT_COLUMN_MAPPING;
  });
  const [mappingNotification, setMappingNotification] = useState<{ message: string; type: 'success' | 'info' | 'warning' } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save items to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.error('Error saving Kusto expiry stock:', e);
    }
  }, [items]);

  // Save column mapping to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_STORAGE_MAP_KEY, JSON.stringify(columnMapping));
    } catch (e) {
      console.error('Error saving column mapping:', e);
    }
  }, [columnMapping]);

  // Unique groups for filter
  const uniqueGroups = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => {
      if (item.group && item.group.trim()) set.add(item.group.trim());
    });
    return Array.from(set);
  }, [items]);

  // Execute parsing on raw data with specific mapping and start row
  const executeParsing = (data: any[][], mapping: KustoColumnMapping, startRow: number): KustoExpiryItem[] => {
    const parsedItems: KustoExpiryItem[] = [];
    let currentGroup = 'MEHKAZ';

    for (let r = startRow; r < data.length; r++) {
      const row = data[r];
      if (!row || !Array.isArray(row) || row.length === 0) continue;

      const article = cleanArticle(row[mapping.article]);
      const name = cleanText(row[mapping.name]);
      const rawGroup = cleanText(row[mapping.group]);

      // Check if row is a group header (e.g. only group cell is filled)
      if (rawGroup && (!article || !name) && !row[mapping.totalStock] && !row[mapping.freeStock]) {
        const trimmedGrp = rawGroup.replace(/^[+\-*\s]+/, '').trim();
        if (trimmedGrp && trimmedGrp.length < 40) {
          currentGroup = trimmedGrp;
          continue;
        }
      }

      // Filter out empty rows or summary/totals
      if (!article && !name) continue;
      const lowerName = name.toLowerCase();
      const lowerArt = article.toLowerCase();
      if (
        lowerName.includes('итого') || lowerArt.includes('итого') ||
        lowerName.includes('всего') || lowerArt.includes('всего') ||
        lowerName.includes('отчет по') || lowerName.includes('наименование') ||
        lowerArt.includes('артикул')
      ) {
        continue;
      }

      const group = rawGroup || currentGroup || 'MEHKAZ';
      const rsv = row[mapping.rsv] !== undefined && row[mapping.rsv] !== '' ? row[mapping.rsv] : 1;
      const unit = cleanText(row[mapping.unit]) || 'Штука';
      const batch = cleanText(row[mapping.batch]) || '-';
      
      const productionDate = cleanDateStr(row[mapping.productionDate]);
      const expiryDate = cleanDateStr(row[mapping.expiryDate]);
      const commercializationDeadline = cleanDateStr(row[mapping.commercializationDeadline]);

      const minDaysLimit = parseSignedNum(row[mapping.minDaysLimit]);
      const daysToExpiry = parseSignedNum(row[mapping.daysToExpiry]);
      const daysToDeadline = parseSignedNum(row[mapping.daysToDeadline]);

      // Stock type detection (Supports N, A, B, H, E)
      let stockType = cleanText(row[mapping.stockType]).toUpperCase();
      if (!['N', 'A', 'B', 'H', 'E'].includes(stockType)) {
        if (daysToExpiry < 0) stockType = 'E';
        else if (daysToDeadline < 0) stockType = 'H';
        else if (daysToExpiry <= 30) stockType = 'B';
        else if (daysToExpiry <= 90) stockType = 'A';
        else stockType = 'N';
      }

      const totalStock = parseSignedNum(row[mapping.totalStock]);
      const reservedStock = parseSignedNum(row[mapping.reservedStock]);
      let freeStock = parseSignedNum(row[mapping.freeStock]);

      // Fallback if freeStock wasn't directly read
      if (row[mapping.freeStock] === undefined || row[mapping.freeStock] === '') {
        freeStock = Math.max(0, totalStock - reservedStock);
      }

      parsedItems.push({
        id: `kusto-row-${r}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        group,
        article,
        name,
        rsv,
        unit,
        batch,
        productionDate,
        expiryDate,
        minDaysLimit,
        daysToExpiry,
        commercializationDeadline,
        daysToDeadline,
        stockType,
        totalStock,
        reservedStock,
        freeStock
      });
    }

    return parsedItems;
  };

  // Smart Multi-Tier Excel Column Detection
  const detectColumnsAndStartRow = (rawData: any[][]): {
    mapping: KustoColumnMapping;
    startRow: number;
    detectedReportDate: string | null;
    columns: { index: number; label: string; sample: string }[];
  } => {
    const norm = (v: any) => String(v || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    // 1. Detect report date in first rows
    let detectedReportDate: string | null = null;
    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const rowText = (rawData[i] || []).map(cell => String(cell || '')).join(' ');
      const dateMatch = rowText.match(/(?:на|от|состояние\s+на)\s+(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/i);
      if (dateMatch && dateMatch[1]) {
        detectedReportDate = dateMatch[1];
        break;
      }
    }

    const numRows = rawData.length;
    const maxCols = Math.max(...rawData.slice(0, 30).map(r => (Array.isArray(r) ? r.length : 0)), 16);

    // 2. Identify Header Band and Data Start Row
    const headerRows: number[] = [];
    let detectedStartRow = -1;

    for (let r = 0; r < Math.min(25, numRows); r++) {
      const row = rawData[r] || [];
      const populated = row.filter(c => c !== null && String(c).trim() !== '');
      if (populated.length < 3) continue;

      const rowText = row.map(c => norm(c)).join(' ');
      const hasHeaderKeywords = 
        rowText.includes('артик') || 
        rowText.includes('наименов') || 
        rowText.includes('номенклатур') ||
        rowText.includes('групп') || 
        rowText.includes('годност') || 
        rowText.includes('парти') || 
        rowText.includes('свободн') ||
        rowText.includes('остаток') ||
        rowText.includes('рсв') ||
        rowText.includes('коммерц') ||
        rowText.includes('произв');

      if (hasHeaderKeywords) {
        headerRows.push(r);
      } else if (headerRows.length > 0 && detectedStartRow === -1) {
        if (populated.length >= 3) {
          detectedStartRow = r;
        }
      }
    }

    if (headerRows.length === 0) headerRows.push(2, 3);
    if (detectedStartRow === -1) detectedStartRow = Math.max(...headerRows) + 1;

    // 3. Build Composite Column Headers
    const compositeHeaders: string[] = [];
    for (let c = 0; c < maxCols; c++) {
      const parts: string[] = [];
      headerRows.forEach(r => {
        const val = cleanText(rawData[r]?.[c]);
        if (val && !parts.includes(val)) parts.push(val);
      });
      compositeHeaders[c] = parts.join(' ');
    }

    // 4. Score Each Column for 16 Fields
    const fieldScores: Record<keyof KustoColumnMapping, number[]> = {
      group: new Array(maxCols).fill(0),
      article: new Array(maxCols).fill(0),
      name: new Array(maxCols).fill(0),
      rsv: new Array(maxCols).fill(0),
      unit: new Array(maxCols).fill(0),
      batch: new Array(maxCols).fill(0),
      productionDate: new Array(maxCols).fill(0),
      expiryDate: new Array(maxCols).fill(0),
      minDaysLimit: new Array(maxCols).fill(0),
      daysToExpiry: new Array(maxCols).fill(0),
      commercializationDeadline: new Array(maxCols).fill(0),
      daysToDeadline: new Array(maxCols).fill(0),
      stockType: new Array(maxCols).fill(0),
      totalStock: new Array(maxCols).fill(0),
      reservedStock: new Array(maxCols).fill(0),
      freeStock: new Array(maxCols).fill(0)
    };

    for (let c = 0; c < maxCols; c++) {
      const h = norm(compositeHeaders[c]);

      // Group
      if (h.includes('групп') || h.includes('подраздел') || h.includes('цех')) fieldScores.group[c] += 12;
      if (h === 'группа' || h === 'группа товара') fieldScores.group[c] += 15;

      // Article
      if (h.includes('артик') || h.includes('номенклатурный') || h.includes('sku')) fieldScores.article[c] += 18;
      if (h.includes('код') && !h.includes('штрих') && !h.includes('причин')) fieldScores.article[c] += 10;

      // Name
      if (h.includes('наименов') || h.includes('номенклатур') || h.includes('название') || h.includes('товар') || h.includes('продукт')) fieldScores.name[c] += 18;

      // RSV
      if (h.includes('рсв') || h.includes('рсб') || h.includes('rcv') || h.includes('rcb') || h === 'рсв' || h === 'rsv') fieldScores.rsv[c] += 18;

      // Unit
      if (h.includes('ед.изм') || h.includes('ед. изм') || h.includes('единиц') || h === 'ед.' || h === 'ед' || h.includes('базовая ед')) fieldScores.unit[c] += 18;

      // Batch
      if (h.includes('парти') || h.includes('сери') || h.includes('batch')) fieldScores.batch[c] += 18;

      // Production Date
      if ((h.includes('произв') || h.includes('изгот') || h.includes('выработ')) && !h.includes('срок') && !h.includes('дней')) fieldScores.productionDate[c] += 18;
      if (h.includes('дата пр') || h.includes('дата выработки')) fieldScores.productionDate[c] += 18;

      // Expiry Date
      if ((h.includes('годност') || h.includes('годен до') || h.includes('с.г') || h.includes('сг')) && !h.includes('мин') && !h.includes('дней') && !h.includes('коммерц')) fieldScores.expiryDate[c] += 18;
      if (h === 'срок годности' || h.includes('дата окончания сг')) fieldScores.expiryDate[c] += 22;

      // Min Days Limit
      if (h.includes('мин') && (h.includes('дней') || h.includes('с.г') || h.includes('сг') || h.includes('день') || h.includes('срок'))) fieldScores.minDaysLimit[c] += 20;

      // Days To Expiry
      if ((h.includes('дней') || h.includes('день') || h.includes('остаток дней')) && (h.includes('до с.г') || h.includes('до сг') || h.includes('до срока') || h.includes('с.г') || h.includes('сг')) && !h.includes('мин') && !h.includes('оконч') && !h.includes('коммерц')) fieldScores.daysToExpiry[c] += 20;

      // Commercialization Deadline
      if (h.includes('коммерц') || (h.includes('срок') && (h.includes('реализ') || h.includes('дедлайн')))) fieldScores.commercializationDeadline[c] += 20;

      // Days To Deadline
      if ((h.includes('дней') || h.includes('день')) && (h.includes('оконч') || h.includes('дедлайн') || h.includes('коммерц') || h.includes('реализ') || h.includes('конц')) && !h.includes('с.г.') && !h.includes('сг')) fieldScores.daysToDeadline[c] += 20;

      // Stock Type
      if (h.includes('тип стока') || h.includes('статус стока') || h.includes('категория стока') || h === 'тип' || h === 'статус') fieldScores.stockType[c] += 20;

      // Total Stock
      if (h.includes('всего') || (h.includes('в стоке') && !h.includes('свободн') && !h.includes('резерв')) || h.includes('общий остаток') || h.includes('остаток всего') || h.includes('в наличии')) fieldScores.totalStock[c] += 18;

      // Reserved Stock
      if (h.includes('зарезерв') || h.includes('резерв') || h.includes('в заказы') || h.includes('в заказах') || h.includes('заказы')) fieldScores.reservedStock[c] += 18;

      // Free Stock
      if (h.includes('свободн') || h.includes('доступн') || h.includes('свободный остаток') || h.includes('доступный сток')) fieldScores.freeStock[c] += 18;
    }

    // 5. Data Sampling & Type Boosting (Check sample rows)
    const sampleRows = rawData.slice(detectedStartRow, detectedStartRow + 20).filter(r => Array.isArray(r) && r.some(c => c !== null && String(c).trim() !== ''));

    for (let c = 0; c < maxCols; c++) {
      const colValues = sampleRows.map(r => r[c]).filter(v => v !== null && v !== undefined && String(v).trim() !== '');
      if (colValues.length === 0) continue;

      // Check product name (Russian text, average length > 12)
      const longStrings = colValues.filter(v => typeof v === 'string' && v.trim().length > 10 && /[а-яА-ЯёЁ]/.test(v));
      if (longStrings.length / colValues.length > 0.5) fieldScores.name[c] += 30;

      // Check Article SKU
      const skuMatches = colValues.filter(v => {
        const s = String(v).trim();
        return /^\d{5,14}$/.test(s) || (s.length >= 6 && s.length <= 15 && /^[0-9A-Z-]+$/i.test(s));
      });
      if (skuMatches.length / colValues.length > 0.5) fieldScores.article[c] += 30;

      // Check Stock Type (N, A, B, H, E)
      const stockTypeMatches = colValues.filter(v => {
        const s = String(v).trim().toUpperCase();
        return ['N', 'A', 'B', 'H', 'E'].includes(s);
      });
      if (stockTypeMatches.length / colValues.length > 0.4) fieldScores.stockType[c] += 35;

      // Check Unit
      const unitMatches = colValues.filter(v => {
        const s = String(v).trim().toLowerCase();
        return s.includes('шт') || s.includes('кг') || s.includes('килограмм') || s.includes('штука') || s.includes('литр');
      });
      if (unitMatches.length / colValues.length > 0.5) fieldScores.unit[c] += 30;

      // Check Group
      const groupMatches = colValues.filter(v => {
        const s = String(v).trim().toUpperCase();
        return s === 'MEHKAZ' || (s.length >= 3 && s.length <= 12 && /^[A-Z0-9А-Я]+$/.test(s));
      });
      if (groupMatches.length / colValues.length > 0.5) fieldScores.group[c] += 20;

      // Check Dates
      const dateMatches = colValues.filter(v => {
        if (v instanceof Date) return true;
        if (typeof v === 'number' && v > 20000 && v < 60000) return true;
        const s = String(v).trim();
        return /\d{2}[./\-]\d{2}[./\-]\d{2,4}/.test(s);
      });
      if (dateMatches.length / colValues.length > 0.5) {
        fieldScores.productionDate[c] += 8;
        fieldScores.expiryDate[c] += 8;
        fieldScores.commercializationDeadline[c] += 8;
      }
    }

    // 6. Mapping Resolution
    const fieldsPriority: (keyof KustoColumnMapping)[] = [
      'name', 'article', 'stockType', 'unit', 'batch', 'group', 'rsv',
      'expiryDate', 'productionDate', 'commercializationDeadline',
      'daysToExpiry', 'daysToDeadline', 'minDaysLimit',
      'freeStock', 'totalStock', 'reservedStock'
    ];

    const assignedCols = new Set<number>();
    const mapping: KustoColumnMapping = { ...DEFAULT_COLUMN_MAPPING };

    for (const field of fieldsPriority) {
      const scores = fieldScores[field];
      let bestCol = -1;
      let bestScore = -1;

      for (let c = 0; c < maxCols; c++) {
        if (!assignedCols.has(c) && scores[c] > bestScore && scores[c] > 0) {
          bestScore = scores[c];
          bestCol = c;
        }
      }

      if (bestCol !== -1 && bestScore >= 5) {
        mapping[field] = bestCol;
        assignedCols.add(bestCol);
      }
    }

    // Fallback baseline offset if some columns were not detected by keyword
    const baseOffset = mapping.article !== undefined 
      ? Math.max(0, mapping.article - 1)
      : (mapping.name !== undefined ? Math.max(0, mapping.name - 2) : 0);

    const orderedFields: (keyof KustoColumnMapping)[] = [
      'group', 'article', 'name', 'rsv', 'unit', 'batch',
      'productionDate', 'expiryDate', 'minDaysLimit', 'daysToExpiry',
      'commercializationDeadline', 'daysToDeadline', 'stockType',
      'totalStock', 'reservedStock', 'freeStock'
    ];

    orderedFields.forEach((field, idx) => {
      if (fieldScores[field][mapping[field]] < 5) {
        mapping[field] = baseOffset + idx;
      }
    });

    // Column headers for configuration UI
    const columns = [];
    for (let c = 0; c < Math.min(maxCols, 26); c++) {
      const colLetter = String.fromCharCode(65 + c);
      const label = compositeHeaders[c] || `Колонка ${colLetter}`;
      const sampleVal = sampleRows.map(r => r[c]).find(v => v !== null && v !== undefined && String(v).trim() !== '');
      const sample = sampleVal !== undefined ? String(sampleVal).slice(0, 35) : '—';
      columns.push({
        index: c,
        label: `Кол. ${colLetter} [${c + 1}]: ${label ? label.slice(0, 30) : 'Без названия'}`,
        sample
      });
    }

    return {
      mapping,
      startRow: detectedStartRow,
      detectedReportDate,
      columns
    };
  };

  // Robust Excel File Upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

        if (!rawData || rawData.length === 0) {
          alert('Файл Excel пуст или содержит некорректные данные.');
          setIsUploading(false);
          return;
        }

        setRawWorkbookData(rawData);

        // Run smart detection
        const detected = detectColumnsAndStartRow(rawData);
        setColumnMapping(detected.mapping);
        setDataStartRowIndex(detected.startRow);
        setAvailableColumns(detected.columns);

        if (detected.detectedReportDate) {
          setReportDateInfo(detected.detectedReportDate);
        }

        // Parse items with detected mapping
        const parsedItems = executeParsing(rawData, detected.mapping, detected.startRow);

        if (parsedItems.length > 0) {
          setItems(parsedItems);
          setMappingNotification({
            message: `Успешно загружено ${parsedItems.length} позиций! Колонки сопоставлены автоматически.`,
            type: 'success'
          });
        } else {
          setMappingNotification({
            message: 'Файл загружен, но строки с товарами не распознаны автоматически. Откройте "Настройка колонок" для проверки сопоставления.',
            type: 'warning'
          });
          setIsMappingModalOpen(true);
        }
      } catch (err: any) {
        console.error('Error parsing Excel file:', err);
        alert(`Ошибка при чтении файла Excel: ${err.message || 'Неизвестная ошибка'}`);
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.readAsArrayBuffer(file);
  };

  // Re-apply column mapping manually from the modal
  const handleApplyManualMapping = (newMapping: KustoColumnMapping, newStartRow: number) => {
    setColumnMapping(newMapping);
    setDataStartRowIndex(newStartRow);

    if (rawWorkbookData) {
      const parsedItems = executeParsing(rawWorkbookData, newMapping, newStartRow);
      if (parsedItems.length > 0) {
        setItems(parsedItems);
        setMappingNotification({
          message: `Сопоставление применено: обновлено ${parsedItems.length} позиций!`,
          type: 'success'
        });
      } else {
        alert('По выбранным колонкам не удалось прочитать строки. Проверьте правильность выбранных полей.');
      }
    }
    setIsMappingModalOpen(false);
  };

  // Reset data back to default sample
  const handleResetData = () => {
    if (confirm('Сбросить данные к исходному отчету остатков Кусто?')) {
      setItems(INITIAL_SAMPLE_DATA);
      setFileName(null);
      setReportDateInfo('20.08.2026 10:00:25');
      setRawWorkbookData(null);
      setMappingNotification(null);
    }
  };

  // Export current filtered view to Excel with full 16 columns matching official template
  const handleExportExcel = () => {
    const exportRows = filteredItems.map((item) => ({
      'Группа': item.group,
      'Артикул': item.article,
      'Наименование': item.name,
      'РСВ': item.rsv,
      'Ед.изм.': item.unit,
      'Партия': item.batch,
      'Дата произв.': item.productionDate,
      'Срок годности': item.expiryDate,
      'Мин.дней до С.Г.': item.minDaysLimit,
      'Дней до С.Г.': item.daysToExpiry,
      'Срок коммерциализации': item.commercializationDeadline,
      'Дней до окончания коммерц.': item.daysToDeadline,
      'Тип стока': item.stockType,
      'Всего в стоке (шт)': item.totalStock,
      'Зарезервировано в заказы (шт)': item.reservedStock,
      'Свободный сток (шт)': item.freeStock
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 15 }, { wch: 45 },
      { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 22 },
      { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Остатки Кусто');
    XLSX.writeFile(workbook, `Отчет_остатки_Кусто_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Filter & Search Logic
  const filteredItems = useMemo(() => {
    let result = [...items];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(item => 
        item.name.toLowerCase().includes(q) ||
        item.article.toLowerCase().includes(q) ||
        item.batch.toLowerCase().includes(q) ||
        item.group.toLowerCase().includes(q)
      );
    }

    // Stock Type filter
    if (selectedStockType !== 'all') {
      result = result.filter(item => item.stockType === selectedStockType);
    }

    // Group filter
    if (selectedGroup !== 'all') {
      result = result.filter(item => item.group === selectedGroup);
    }

    // Urgency filter
    if (selectedUrgency !== 'all') {
      if (selectedUrgency === 'expired') {
        result = result.filter(item => item.daysToExpiry < 0 || item.stockType === 'E');
      } else if (selectedUrgency === 'hold') {
        result = result.filter(item => item.stockType === 'H' || item.daysToDeadline < 0);
      } else if (selectedUrgency === 'critical') {
        result = result.filter(item => item.daysToExpiry >= 0 && item.daysToExpiry <= 30);
      } else if (selectedUrgency === 'warning') {
        result = result.filter(item => item.daysToExpiry > 30 && item.daysToExpiry <= 90);
      } else if (selectedUrgency === 'normal') {
        result = result.filter(item => item.daysToExpiry > 90);
      }
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'days_asc') return a.daysToExpiry - b.daysToExpiry;
      if (sortBy === 'days_desc') return b.daysToExpiry - a.daysToExpiry;
      if (sortBy === 'stock_desc') return b.freeStock - a.freeStock;
      if (sortBy === 'stock_asc') return a.freeStock - b.freeStock;
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name, 'ru');
      if (sortBy === 'article_asc') return a.article.localeCompare(b.article);
      return 0;
    });

    return result;
  }, [items, searchQuery, selectedStockType, selectedGroup, selectedUrgency, sortBy]);

  // Aggregate Metrics & Key Statistics
  const metrics = useMemo(() => {
    let totalFree = 0;
    let totalReserved = 0;
    let totalPositions = items.length;

    let normalCount = 0;
    let normalFree = 0;

    let attentionCount = 0;
    let attentionFree = 0;

    let riskCount = 0;
    let riskFree = 0;

    let holdCount = 0;
    let holdFree = 0;

    let expiredCount = 0;
    let expiredFree = 0;

    items.forEach(item => {
      totalFree += item.freeStock;
      totalReserved += item.reservedStock;

      if (item.stockType === 'E' || item.daysToExpiry < 0) {
        expiredCount++;
        expiredFree += item.freeStock;
      } else if (item.stockType === 'H' || item.daysToDeadline < 0) {
        holdCount++;
        holdFree += item.freeStock;
      } else if (item.stockType === 'B' || item.daysToExpiry <= 30) {
        riskCount++;
        riskFree += item.freeStock;
      } else if (item.stockType === 'A' || item.daysToExpiry <= 90) {
        attentionCount++;
        attentionFree += item.freeStock;
      } else {
        normalCount++;
        normalFree += item.freeStock;
      }
    });

    return {
      totalPositions,
      totalFree,
      totalReserved,
      normalCount,
      normalFree,
      attentionCount,
      attentionFree,
      riskCount,
      riskFree,
      holdCount,
      holdFree,
      expiredCount,
      expiredFree
    };
  }, [items]);

  // Totals for current filtered page/list
  const pageTotals = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => {
        acc.totalStock += item.totalStock || 0;
        acc.reservedStock += item.reservedStock || 0;
        acc.freeStock += item.freeStock || 0;
        return acc;
      },
      { totalStock: 0, reservedStock: 0, freeStock: 0 }
    );
  }, [filteredItems]);

  // Stock Type Color Badge Helper (Supports N, A, B, H, E)
  const getStockTypeBadge = (type: string, daysExpiry: number, daysDeadline: number) => {
    if (type === 'E' || daysExpiry < 0) {
      return {
        label: 'E — Просрочено',
        bg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200 border-rose-300 dark:border-rose-700',
        dot: 'bg-rose-500'
      };
    }
    if (type === 'H' || daysDeadline < 0) {
      return {
        label: 'H — Холд / Контроль',
        bg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border-purple-300 dark:border-purple-700',
        dot: 'bg-purple-500'
      };
    }
    if (type === 'B' || daysExpiry <= 30) {
      return {
        label: 'B — Зона риска',
        bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200 border-orange-300 dark:border-orange-700',
        dot: 'bg-orange-500'
      };
    }
    if (type === 'A' || daysExpiry <= 90) {
      return {
        label: 'A — Внимание',
        bg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border-amber-300 dark:border-amber-700',
        dot: 'bg-amber-500'
      };
    }
    return {
      label: 'N — Свежий сток',
      bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
      dot: 'bg-emerald-500'
    };
  };

  // Preview samples for modal live check
  const previewRows = useMemo(() => {
    if (!rawWorkbookData) return [];
    return rawWorkbookData.slice(dataStartRowIndex, dataStartRowIndex + 3);
  }, [rawWorkbookData, dataStartRowIndex]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-semibold text-indigo-200 mb-3">
              <Calendar className="w-3.5 h-3.5" />
              <span>Склады КУСТО — Отчет по остаткам и срокам годности</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Остатки по срокам КУСТО
            </h2>
            <p className="text-slate-300 text-sm mt-1 max-w-2xl">
              Точный импорт и мониторинг отчетов WMS/1C: артикул, наименование, партия, сроки годности и коммерциализации, статусы стока (N, A, B, H, E).
            </p>
            {reportDateInfo && (
              <div className="inline-flex items-center gap-1.5 mt-2.5 text-xs text-indigo-200 bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-800/50">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span>Дата формирования отчета: <strong className="text-white">{reportDateInfo}</strong></span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx, .xls, .csv"
              className="hidden"
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>{isUploading ? 'Импорт файла...' : 'Загрузить отчет (.xlsx)'}</span>
            </button>

            {/* Column Mapping Configuration Button */}
            <button
              onClick={() => {
                if (!rawWorkbookData && availableColumns.length === 0) {
                  // Build available columns from full 16 official Kusto headers without shortening
                  const dummyCols = [
                    'Группа',
                    'Артикул',
                    'Наименование',
                    'РСВ',
                    'Ед.изм.',
                    'Партия',
                    'Дата произв.',
                    'Срок годности',
                    'Мин.дней до С.Г.',
                    'Дней до С.Г.',
                    'Срок коммерциализации',
                    'Дней до окончания коммерц.',
                    'Тип стока',
                    'Всего в стоке (шт)',
                    'Зарезервировано в заказы (шт)',
                    'Свободный сток (шт)'
                  ].map((lbl, idx) => ({
                    index: idx,
                    label: `Кол. ${String.fromCharCode(65 + idx)} [${idx + 1}]: ${lbl}`,
                    sample: 'Пример данных'
                  }));
                  setAvailableColumns(dummyCols);
                }
                setIsMappingModalOpen(true);
              }}
              title="Настройка соответствия колонок из Excel"
              className="px-4 py-2.5 bg-slate-800/90 hover:bg-slate-700 text-indigo-200 border border-indigo-500/30 font-bold text-sm rounded-xl transition-all flex items-center gap-2 cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4 text-indigo-400" />
              <span>Настройка колонок</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-bold text-sm rounded-xl transition-all flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Экспорт отчета</span>
            </button>

            <button
              onClick={handleResetData}
              title="Сбросить к исходному отчету"
              className="p-2.5 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* File & Mapping Status Bar */}
        <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>
              {fileName ? (
                <>Загруженный файл: <strong className="text-white">{fileName}</strong></>
              ) : (
                'Используется базовый отчет остатков КУСТО'
              )}
            </span>
          </span>
          
          <div className="flex items-center gap-3 text-slate-400">
            <span>Всего позиций в таблице: <strong className="text-white">{items.length}</strong></span>
            <button
              onClick={() => setIsMappingModalOpen(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline cursor-pointer"
            >
              ⚙️ Проверить сопоставление полей
            </button>
          </div>
        </div>

        {/* Dynamic Notification Toast */}
        {mappingNotification && (
          <div className={`mt-3 p-3 rounded-xl text-xs flex items-center justify-between gap-2 transition-all ${
            mappingNotification.type === 'success'
              ? 'bg-emerald-950/80 border border-emerald-700/60 text-emerald-200'
              : mappingNotification.type === 'warning'
              ? 'bg-amber-950/80 border border-amber-700/60 text-amber-200'
              : 'bg-indigo-950/80 border border-indigo-700/60 text-indigo-200'
          }`}>
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 shrink-0" />
              <span>{mappingNotification.message}</span>
            </div>
            <button 
              onClick={() => setMappingNotification(null)}
              className="text-white/60 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3.5">
        {/* Total Free Stock Card */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Свободный сток</span>
            <Package className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            {formatNum(metrics.totalFree)} <span className="text-xs font-normal text-slate-500">шт</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center justify-between">
            <span>Позиций: <strong>{metrics.totalPositions}</strong></span>
            <span>Резерв: <strong>{formatNum(metrics.totalReserved)}</strong></span>
          </div>
        </div>

        {/* Fresh Stock N */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 shadow-sm">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Свежий (N)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-black text-emerald-700 dark:text-emerald-400">
            {formatNum(metrics.normalFree)} <span className="text-xs font-normal">шт</span>
          </div>
          <div className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-1.5">
            Позиций: <strong>{metrics.normalCount}</strong> (&gt; 90 дн.)
          </div>
        </div>

        {/* Attention A */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/50 shadow-sm">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Внимание (A)</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-700 dark:text-amber-400">
            {formatNum(metrics.attentionFree)} <span className="text-xs font-normal">шт</span>
          </div>
          <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-1.5">
            Позиций: <strong>{metrics.attentionCount}</strong> (30-90 дн.)
          </div>
        </div>

        {/* Risk B */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-orange-200 dark:border-orange-900/50 shadow-sm">
          <div className="flex items-center justify-between text-orange-700 dark:text-orange-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Зона риска (B)</span>
            <AlertTriangle className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-xl font-black text-orange-700 dark:text-orange-400">
            {formatNum(metrics.riskFree)} <span className="text-xs font-normal">шт</span>
          </div>
          <div className="text-[11px] text-orange-600/80 dark:text-orange-400/80 mt-1.5">
            Позиций: <strong>{metrics.riskCount}</strong> (&le; 30 дн.)
          </div>
        </div>

        {/* Hold H */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-purple-200 dark:border-purple-900/50 shadow-sm">
          <div className="flex items-center justify-between text-purple-700 dark:text-purple-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">Холд / Срок комм. (H)</span>
            <ShieldAlert className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-xl font-black text-purple-700 dark:text-purple-400">
            {formatNum(metrics.holdFree)} <span className="text-xs font-normal">шт</span>
          </div>
          <div className="text-[11px] text-purple-600/80 dark:text-purple-400/80 mt-1.5">
            Позиций: <strong>{metrics.holdCount}</strong> (Истек срок комм.)
          </div>
        </div>

        {/* Expired E */}
        <div className={`p-4 rounded-2xl border shadow-sm transition-colors ${
          metrics.expiredCount > 0 
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200' 
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">Просрочено (E)</span>
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          </div>
          <div className="text-xl font-black text-rose-700 dark:text-rose-300">
            {formatNum(metrics.expiredFree)} <span className="text-xs font-normal">шт</span>
          </div>
          <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5 font-medium">
            Позиций: <strong>{metrics.expiredCount}</strong> (&lt; 0 дн.)
          </div>
        </div>
      </div>

      {/* Critical Expiry Warning Banner if Expired or Hold Stock exists */}
      {metrics.expiredCount > 0 && (
        <div className="bg-rose-50 border-l-4 border-rose-500 p-4 rounded-xl text-rose-900 dark:bg-rose-950/60 dark:text-rose-200 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm">Внимание: Обнаружена просроченная продукция!</h4>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                На складе числится <strong>{metrics.expiredCount}</strong> позиций со статусом <strong>"E"</strong> на остатке <strong>{formatNum(metrics.expiredFree)} шт</strong>.
              </p>
            </div>
          </div>
          <button
            onClick={() => { setSelectedStockType('E'); setSelectedUrgency('expired'); }}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shrink-0 shadow-sm cursor-pointer"
          >
            Показать просрочку
          </button>
        </div>
      )}

      {/* Filter and Control Toolbar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search Input */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Поиск по названию, артикулу, партии..."
              className="w-full pl-9 pr-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Group Filter */}
          <div>
            <select
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">Все группы ({uniqueGroups.length})</option>
              {uniqueGroups.map(grp => (
                <option key={grp} value={grp}>{grp}</option>
              ))}
            </select>
          </div>

          {/* Stock Type Filter */}
          <div>
            <select
              value={selectedStockType}
              onChange={e => setSelectedStockType(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">Все типы стока (N, A, B, H, E)</option>
              <option value="N">🟢 N — Свежий сток</option>
              <option value="A">🟡 A — Близкий к окончанию</option>
              <option value="B">🟠 B — Зона риска (Срочно)</option>
              <option value="H">🟣 H — Холд / Контроль</option>
              <option value="E">🔴 E — Просроченный сток</option>
            </select>
          </div>

          {/* Urgency Filter */}
          <div>
            <select
              value={selectedUrgency}
              onChange={e => setSelectedUrgency(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">Все сроки годности</option>
              <option value="expired">🔴 Просрочено (&lt; 0 дней)</option>
              <option value="hold">🟣 Истек срок комм. (H)</option>
              <option value="critical">🟠 Критично (&le; 30 дней)</option>
              <option value="warning">🟡 Скоро (30 - 90 дней)</option>
              <option value="normal">🟢 В норме (&gt; 90 дней)</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="days_asc">⏳ Дней до С.Г. (по возрастанию)</option>
              <option value="days_desc">⏳ Дней до С.Г. (по убыванию)</option>
              <option value="stock_desc">📦 Свободный сток (по убыванию)</option>
              <option value="stock_asc">📦 Свободный сток (по возрастанию)</option>
              <option value="name_asc">🔤 Название товара (А-Я)</option>
              <option value="article_asc">🔢 Артикул</option>
            </select>
          </div>
        </div>

        {/* Active Filters Bar */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700/50">
          <div>
            Найдено позиций: <strong className="text-slate-900 dark:text-white">{filteredItems.length}</strong> из {items.length}
          </div>
          {(selectedStockType !== 'all' || selectedUrgency !== 'all' || searchQuery || selectedGroup !== 'all') && (
            <button
              onClick={() => {
                setSelectedStockType('all');
                setSelectedUrgency('all');
                setSelectedGroup('all');
                setSearchQuery('');
              }}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      {/* Main 16-Column Excel Data Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto momentum-scroll custom-scrollbar max-h-[700px]">
          <table className="w-full text-left text-xs border-collapse min-w-[1200px]">
            <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900/95 backdrop-blur-md text-slate-700 dark:text-slate-300 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-700 text-[11px]">
              <tr>
                <th className="px-3 py-3 w-8 text-center">№</th>
                <th className="px-3 py-3 whitespace-nowrap">Группа</th>
                <th className="px-3 py-3 whitespace-nowrap">Артикул</th>
                <th className="px-3 py-3 min-w-[260px]">Наименование</th>
                <th className="px-2 py-3 text-center w-12 whitespace-nowrap">РСВ</th>
                <th className="px-3 py-3 whitespace-nowrap">Ед.изм.</th>
                <th className="px-3 py-3 whitespace-nowrap">Партия</th>
                <th className="px-3 py-3 whitespace-nowrap">Дата произв.</th>
                <th className="px-3 py-3 whitespace-nowrap">Срок годности</th>
                <th className="px-2 py-3 text-center whitespace-nowrap">Мин.дней до С.Г.</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">Дней до С.Г.</th>
                <th className="px-3 py-3 whitespace-nowrap">Срок коммерциализации</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">Дней до окончания коммерц.</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">Тип стока</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Всего в стоке (шт)</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Зарезервировано в заказы (шт)</th>
                <th className="px-3 py-3 text-right whitespace-nowrap bg-indigo-50/60 dark:bg-indigo-950/40">Свободный сток (шт)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60 font-medium">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={17} className="text-center py-12 text-slate-400">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="font-semibold text-sm">Позиции не найдены</p>
                    <p className="text-xs">Попробуйте изменить параметры поиска или загрузить файл отчета Excel</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item, index) => {
                  const badge = getStockTypeBadge(item.stockType, item.daysToExpiry, item.daysToDeadline);
                  const isExpired = item.daysToExpiry < 0 || item.stockType === 'E';
                  const isHold = item.stockType === 'H' || item.daysToDeadline < 0;

                  return (
                    <tr 
                      key={item.id} 
                      className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${
                        isExpired 
                          ? 'bg-rose-50/40 dark:bg-rose-950/20' 
                          : isHold
                          ? 'bg-purple-50/20 dark:bg-purple-950/10'
                          : ''
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center text-slate-400 font-normal">{index + 1}</td>
                      <td className="px-3 py-2.5 font-bold text-slate-600 dark:text-slate-400">{item.group}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-800 dark:text-slate-200 font-semibold">{item.article}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">{item.name}</td>
                      <td className="px-2 py-2.5 text-center text-slate-500">{item.rsv}</td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{item.unit}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">{item.batch || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.productionDate}</td>
                      <td className="px-3 py-2.5 text-slate-900 dark:text-white font-semibold whitespace-nowrap">{item.expiryDate}</td>
                      <td className="px-2 py-2.5 text-center text-slate-500">{item.minDaysLimit}</td>
                      
                      {/* Days to Expiry Badge */}
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold text-xs ${
                          isExpired 
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/80 dark:text-rose-200' 
                            : item.daysToExpiry <= 30
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/80 dark:text-orange-200'
                            : item.daysToExpiry <= 90
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200'
                        }`}>
                          {item.daysToExpiry}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">{item.commercializationDeadline}</td>
                      
                      {/* Days to Deadline */}
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-mono text-xs font-semibold ${
                          item.daysToDeadline < 0 
                            ? 'text-rose-600 dark:text-rose-400' 
                            : 'text-slate-700 dark:text-slate-300'
                        }`}>
                          {item.daysToDeadline}
                        </span>
                      </td>

                      {/* Stock Type Code */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badge.bg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {item.stockType}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400">{formatNum(item.totalStock)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-500">{formatNum(item.reservedStock)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-bold text-slate-900 dark:text-white bg-indigo-50/30 dark:bg-indigo-950/20 text-xs">
                        {formatNum(item.freeStock)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredItems.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 bg-slate-100 dark:bg-slate-900 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                <tr>
                  <td colSpan={14} className="px-3 py-3 text-right uppercase tracking-wider text-slate-700 dark:text-slate-300 text-[11px]">
                    Итого ({filteredItems.length} поз.):
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-800 dark:text-slate-200">
                    {formatNum(pageTotals.totalStock)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-600 dark:text-slate-400">
                    {formatNum(pageTotals.reservedStock)}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-100/50 dark:bg-indigo-900/50 text-sm">
                    {formatNum(pageTotals.freeStock)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Manual Column Mapping Configuration Modal */}
      {isMappingModalOpen && (
        <ColumnMappingModal
          isOpen={isMappingModalOpen}
          onClose={() => setIsMappingModalOpen(false)}
          currentMapping={columnMapping}
          availableColumns={availableColumns}
          dataStartRow={dataStartRowIndex}
          previewRows={previewRows}
          rawWorkbookData={rawWorkbookData}
          onSave={handleApplyManualMapping}
          onAutoDetect={() => {
            if (rawWorkbookData) {
              const detected = detectColumnsAndStartRow(rawWorkbookData);
              setColumnMapping(detected.mapping);
              setDataStartRowIndex(detected.startRow);
              setAvailableColumns(detected.columns);
              handleApplyManualMapping(detected.mapping, detected.startRow);
            }
          }}
        />
      )}
    </div>
  );
};

// Modal Component for Configuring Column Mapping
interface ColumnMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMapping: KustoColumnMapping;
  availableColumns: { index: number; label: string; sample: string }[];
  dataStartRow: number;
  previewRows: any[][];
  rawWorkbookData: any[][] | null;
  onSave: (mapping: KustoColumnMapping, startRow: number) => void;
  onAutoDetect: () => void;
}

const ColumnMappingModal: React.FC<ColumnMappingModalProps> = ({
  isOpen,
  onClose,
  currentMapping,
  availableColumns,
  dataStartRow,
  previewRows,
  rawWorkbookData,
  onSave,
  onAutoDetect
}) => {
  const [localMapping, setLocalMapping] = useState<KustoColumnMapping>(currentMapping);
  const [localStartRow, setLocalStartRow] = useState<number>(dataStartRow);

  const fieldsList: { key: keyof KustoColumnMapping; label: string; description: string; required?: boolean }[] = [
    { key: 'group', label: '1. Группа', description: 'Цех, подраздел или склад (например: MEHKAZ)' },
    { key: 'article', label: '2. Артикул', description: 'Код номенклатуры / артикул товара (например: 00000000410, 30000215)', required: true },
    { key: 'name', label: '3. Наименование', description: 'Полное наименование товара / номенклатуры', required: true },
    { key: 'rsv', label: '4. РСВ', description: 'Коэффициент или признак РСВ / РСБ (обычно 1)' },
    { key: 'unit', label: '5. Ед.изм.', description: 'Единица измерения (Штука, Килограмм, шт, кг)' },
    { key: 'batch', label: '6. Партия', description: 'Номер партии или серии продукции (например: 20032026, -)' },
    { key: 'productionDate', label: '7. Дата произв.', description: 'Дата производства / выработки (например: 18.08.2026)' },
    { key: 'expiryDate', label: '8. Срок годности', description: 'Дата окончания срока годности (например: 15.04.2027г.)', required: true },
    { key: 'minDaysLimit', label: '9. Мин.дней до С.Г.', description: 'Минимальный порог годности в днях (например: 14)' },
    { key: 'daysToExpiry', label: '10. Дней до С.Г.', description: 'Количество оставшихся дней до окончания срока годности' },
    { key: 'commercializationDeadline', label: '11. Срок коммерциализации', description: 'Дедлайн коммерциализации по регламенту' },
    { key: 'daysToDeadline', label: '12. Дней до окончания коммерц.', description: 'Остаток дней до окончания коммерциализации' },
    { key: 'stockType', label: '13. Тип стока', description: 'Категория годности стока (N, A, B, H, E)' },
    { key: 'totalStock', label: '14. Всего в стоке (шт)', description: 'Общий физический остаток на складе' },
    { key: 'reservedStock', label: '15. Зарезервировано в заказы (шт)', description: 'Количество, зарезервированное под клиентские заказы' },
    { key: 'freeStock', label: '16. Свободный сток (шт)', description: 'Доступный для свободной реализации остаток', required: true }
  ];

  const handleFieldChange = (field: keyof KustoColumnMapping, colIndex: number) => {
    setLocalMapping(prev => ({
      ...prev,
      [field]: colIndex
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Настройка соответствия колонок (Excel)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Укажите, из каких колонок вашего Excel-файла считывать каждое поле отчета
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
          
          {/* Row Offset Selector */}
          <div className="bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/60 dark:border-indigo-800/40 p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-300">
                Начальная строка данных
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Номер строки в Excel, с которой начинаются первые товары (пропуская шапку и заголовок)
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-500">Строка №:</span>
              <input
                type="number"
                min={1}
                max={30}
                value={localStartRow + 1}
                onChange={e => setLocalStartRow(Math.max(0, parseInt(e.target.value, 10) - 1 || 0))}
                className="w-20 px-3 py-1.5 text-center font-bold text-sm bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-700 rounded-xl text-indigo-600 dark:text-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* 16 Fields Mapping Grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-indigo-500" />
                Сопоставление 16 колонок
              </h4>
              {rawWorkbookData && (
                <button
                  type="button"
                  onClick={onAutoDetect}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Автоопределение
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {fieldsList.map(field => {
                const selectedCol = localMapping[field.key];
                return (
                  <div
                    key={field.key}
                    className="p-3.5 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/80 rounded-2xl flex flex-col justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {field.label}
                          {field.required && <span className="text-rose-500 ml-1">*</span>}
                        </span>
                        <span className="text-[11px] font-mono font-medium px-2 py-0.5 bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg">
                          Колонка {String.fromCharCode(65 + selectedCol)} ({selectedCol + 1})
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {field.description}
                      </p>
                    </div>

                    <select
                      value={selectedCol}
                      onChange={e => handleFieldChange(field.key, parseInt(e.target.value, 10))}
                      className="w-full mt-1 px-3 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {availableColumns.map(col => (
                        <option key={col.index} value={col.index}>
                          {col.label} {col.sample !== '—' ? `[Пример: ${col.sample}]` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Live Preview of 2 Sample Rows */}
          {rawWorkbookData && previewRows.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-700 rounded-2xl p-4 bg-slate-50/50 dark:bg-slate-900/30">
              <div className="flex items-center gap-2 mb-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                <Eye className="w-4 h-4 text-indigo-500" />
                Предпросмотр данных с текущим сопоставлением (первые 2 строки):
              </div>
              <div className="overflow-x-auto text-xs">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                      <th className="p-2">Артикул</th>
                      <th className="p-2">Наименование</th>
                      <th className="p-2">Партия</th>
                      <th className="p-2">Срок годности</th>
                      <th className="p-2">Дней до СГ</th>
                      <th className="p-2">Тип</th>
                      <th className="p-2">Свободно</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-[11px]">
                    {previewRows.slice(0, 2).map((row, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold">{cleanArticle(row[localMapping.article]) || '—'}</td>
                        <td className="p-2 font-sans font-medium">{cleanText(row[localMapping.name]) || '—'}</td>
                        <td className="p-2">{cleanText(row[localMapping.batch]) || '—'}</td>
                        <td className="p-2">{cleanDateStr(row[localMapping.expiryDate]) || '—'}</td>
                        <td className="p-2 text-center">{parseSignedNum(row[localMapping.daysToExpiry])}</td>
                        <td className="p-2 text-center font-bold text-indigo-600">{cleanText(row[localMapping.stockType]) || 'N'}</td>
                        <td className="p-2 text-right font-bold">{formatNum(parseSignedNum(row[localMapping.freeStock]))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
          >
            Отмена
          </button>

          <button
            type="button"
            onClick={() => onSave(localMapping, localStartRow)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Применить сопоставление</span>
          </button>
        </div>
      </div>
    </div>
  );
};
