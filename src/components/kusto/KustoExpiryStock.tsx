import { ResponsiveTable } from '../common/ResponsiveTable';
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
import { useSectionText } from '../../i18n/useSectionText';
import { KUSTO_TEXT, KustoText } from './kusto-i18n';

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

// Report fields in the order of the official 16-column template
const FIELD_ORDER = Object.keys(DEFAULT_COLUMN_MAPPING) as (keyof KustoColumnMapping)[];

// A column of the uploaded sheet; `field` names the template field when no file has been read yet
interface SourceColumn {
  index: number;
  header: string;
  sample: string | null;
  field?: keyof KustoColumnMapping;
}

const formatNum = (val: number | null | undefined, locale: string): string => {
  if (val === null || val === undefined || isNaN(val)) return (0).toLocaleString(locale);
  return Number(val).toLocaleString(locale);
};

// Report dates are kept as the report writes them ("dd.mm.yyyy[г.][ hh:mm[:ss]]"); show them in the interface language
const formatReportDate = (value: string, locale: string): string => {
  const match = value.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})(?:г\.?)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return value;
  const [, day, month, year, hours, minutes, seconds] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day, +(hours ?? 0), +(minutes ?? 0), +(seconds ?? 0)));
  if (isNaN(date.getTime())) return value;
  return date.toLocaleString(locale, {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(hours ? { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) } : {}),
  } as Intl.DateTimeFormatOptions);
};

const columnLetter = (index: number) => String.fromCharCode(65 + index);

const sourceColumnLabel = (col: SourceColumn, text: KustoText, locale: string) =>
  text.columnOption(
    columnLetter(col.index),
    formatNum(col.index + 1, locale),
    col.header || (col.field ? text.columns[col.field] : text.columnFallback(columnLetter(col.index)))
  );

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
  const { text, locale, isRTL } = useSectionText(KUSTO_TEXT);
  const num = (val: number | null | undefined) => formatNum(val, locale);
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
  const [availableColumns, setAvailableColumns] = useState<SourceColumn[]>([]);
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
  // Kept as a kind and count, so the message follows a language switch
  const [mappingNotification, setMappingNotification] = useState<{ kind: 'loaded' | 'notRecognized' | 'applied'; count: number; type: 'success' | 'info' | 'warning' } | null>(null);
  const notificationMessage = (notice: NonNullable<typeof mappingNotification>) =>
    notice.kind === 'loaded' ? text.loaded(num(notice.count))
      : notice.kind === 'applied' ? text.mappingApplied(num(notice.count))
      : text.notRecognized;

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
    columns: SourceColumn[];
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
    const columns: SourceColumn[] = [];
    for (let c = 0; c < Math.min(maxCols, 26); c++) {
      const sampleVal = sampleRows.map(r => r[c]).find(v => v !== null && v !== undefined && String(v).trim() !== '');
      const sample = sampleVal !== undefined ? String(sampleVal).slice(0, 35) : '—';
      columns.push({
        index: c,
        header: (compositeHeaders[c] || '').slice(0, 30),
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
          alert(text.emptyFile);
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
          setMappingNotification({ kind: 'loaded', count: parsedItems.length, type: 'success' });
        } else {
          setMappingNotification({ kind: 'notRecognized', count: 0, type: 'warning' });
          setIsMappingModalOpen(true);
        }
      } catch (err: any) {
        console.error('Error parsing Excel file:', err);
        alert(text.readError(err.message || text.unknownError));
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
        setMappingNotification({ kind: 'applied', count: parsedItems.length, type: 'success' });
      } else {
        alert(text.noRowsForMapping);
      }
    }
    setIsMappingModalOpen(false);
  };

  // Reset data back to default sample
  const handleResetData = () => {
    if (confirm(text.resetConfirm)) {
      setItems(INITIAL_SAMPLE_DATA);
      setFileName(null);
      setReportDateInfo('20.08.2026 10:00:25');
      setRawWorkbookData(null);
      setMappingNotification(null);
    }
  };

  // Export current filtered view to Excel with full 16 columns matching official template
  const handleExportExcel = () => {
    const dateFields = new Set<keyof KustoColumnMapping>(['productionDate', 'expiryDate', 'commercializationDeadline']);
    const header = FIELD_ORDER.map(field => text.columns[field]);
    const exportRows = filteredItems.map(item => FIELD_ORDER.map(field => {
      const value = item[field];
      return dateFields.has(field) ? formatReportDate(String(value), locale) : value;
    }));

    const worksheet = XLSX.utils.aoa_to_sheet([header, ...exportRows]);
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 15 }, { wch: 45 },
      { wch: 6 }, { wch: 12 }, { wch: 14 }, { wch: 14 },
      { wch: 14 }, { wch: 15 }, { wch: 14 }, { wch: 22 },
      { wch: 18 }, { wch: 12 }, { wch: 18 }, { wch: 22 }, { wch: 20 }
    ];

    const workbook = XLSX.utils.book_new();
    if (isRTL) workbook.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(workbook, worksheet, text.sheetName);
    XLSX.writeFile(workbook, `${text.fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
        label: text.stockTypes.E,
        bg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200 border-rose-300 dark:border-rose-700',
        dot: 'bg-rose-500'
      };
    }
    if (type === 'H' || daysDeadline < 0) {
      return {
        label: text.stockTypes.H,
        bg: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border-purple-300 dark:border-purple-700',
        dot: 'bg-purple-500'
      };
    }
    if (type === 'B' || daysExpiry <= 30) {
      return {
        label: text.stockTypes.B,
        bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200 border-orange-300 dark:border-orange-700',
        dot: 'bg-orange-500'
      };
    }
    if (type === 'A' || daysExpiry <= 90) {
      return {
        label: text.stockTypes.A,
        bg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border-amber-300 dark:border-amber-700',
        dot: 'bg-amber-500'
      };
    }
    return {
      label: text.stockTypes.N,
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
      <div className="crm-page-header relative">
        <div className="absolute top-0 end-0 -mt-8 -me-8 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="crm-eyebrow inline-flex items-center gap-2 px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-xs font-semibold text-slate-600 mb-3">
              <Calendar className="w-3.5 h-3.5" />
              <span>{text.eyebrow}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {text.title}
            </h2>
            <p className="text-slate-600 text-sm mt-1 max-w-2xl">
              {text.subtitle}
            </p>
            {reportDateInfo && (
              <div className="inline-flex items-center gap-1.5 mt-2.5 text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span>{text.reportDate} <strong className="text-slate-900">{formatReportDate(reportDateInfo, locale)}</strong></span>
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
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>{isUploading ? text.importing : text.upload}</span>
            </button>

            {/* Column Mapping Configuration Button */}
            <button
              onClick={() => {
                if (!rawWorkbookData && availableColumns.length === 0) {
                  // Build available columns from full 16 official Kusto headers without shortening
                  const dummyCols: SourceColumn[] = FIELD_ORDER.map((field, idx) => ({
                    index: idx,
                    header: '',
                    sample: null,
                    field
                  }));
                  setAvailableColumns(dummyCols);
                }
                setIsMappingModalOpen(true);
              }}
              title={text.mappingButtonTitle}
              className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-indigo-500/30 font-bold text-sm rounded-xl transition-all flex items-center gap-2 cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4 text-blue-600" />
              <span>{text.mappingButton}</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 font-bold text-sm rounded-xl transition-all flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{text.exportReport}</span>
            </button>

            <button
              onClick={handleResetData}
              title={text.resetTitle}
              aria-label={text.resetTitle}
              className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* File & Mapping Status Bar */}
        <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
          <span className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <span>
              {fileName ? (
                <>{text.loadedFile} <strong className="text-slate-900">{fileName}</strong></>
              ) : (
                text.baseReport
              )}
            </span>
          </span>

          <div className="flex items-center gap-3 text-slate-500">
            <span>{text.totalInTable} <strong className="text-slate-900">{num(items.length)}</strong></span>
            <button
              onClick={() => setIsMappingModalOpen(true)}
              className="text-xs text-blue-600 hover:text-indigo-300 font-semibold underline cursor-pointer"
            >
              ⚙️ {text.checkMapping}
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
              <span>{notificationMessage(mappingNotification)}</span>
            </div>
            <button
              onClick={() => setMappingNotification(null)}
              aria-label={text.closeNotice}
              className="text-white/60 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards Overview */}
      <div className="crm-stats">
        {/* Total Free Stock Card */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">{text.freeStock}</span>
            <Package className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-xl font-black text-slate-900 dark:text-white">
            {num(metrics.totalFree)} <span className="text-xs font-normal text-slate-500">{text.pcs}</span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center justify-between">
            <span>{text.positions} <strong>{num(metrics.totalPositions)}</strong></span>
            <span>{text.reserve} <strong>{num(metrics.totalReserved)}</strong></span>
          </div>
        </div>

        {/* Fresh Stock N */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/50 shadow-sm">
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">{text.freshCard}</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-xl font-black text-emerald-700 dark:text-emerald-400">
            {num(metrics.normalFree)} <span className="text-xs font-normal">{text.pcs}</span>
          </div>
          <div className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-1.5">
            {text.positions} <strong>{num(metrics.normalCount)}</strong> {text.over90}
          </div>
        </div>

        {/* Attention A */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-amber-200 dark:border-amber-900/50 shadow-sm">
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">{text.attentionCard}</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-xl font-black text-amber-700 dark:text-amber-400">
            {num(metrics.attentionFree)} <span className="text-xs font-normal">{text.pcs}</span>
          </div>
          <div className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-1.5">
            {text.positions} <strong>{num(metrics.attentionCount)}</strong> {text.from30to90}
          </div>
        </div>

        {/* Risk B */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-orange-200 dark:border-orange-900/50 shadow-sm">
          <div className="flex items-center justify-between text-orange-700 dark:text-orange-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">{text.riskCard}</span>
            <AlertTriangle className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-xl font-black text-orange-700 dark:text-orange-400">
            {num(metrics.riskFree)} <span className="text-xs font-normal">{text.pcs}</span>
          </div>
          <div className="text-[11px] text-orange-600/80 dark:text-orange-400/80 mt-1.5">
            {text.positions} <strong>{num(metrics.riskCount)}</strong> {text.upTo30}
          </div>
        </div>

        {/* Hold H */}
        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-purple-200 dark:border-purple-900/50 shadow-sm">
          <div className="flex items-center justify-between text-purple-700 dark:text-purple-400 mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider">{text.holdCard}</span>
            <ShieldAlert className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-xl font-black text-purple-700 dark:text-purple-400">
            {num(metrics.holdFree)} <span className="text-xs font-normal">{text.pcs}</span>
          </div>
          <div className="text-[11px] text-purple-600/80 dark:text-purple-400/80 mt-1.5">
            {text.positions} <strong>{num(metrics.holdCount)}</strong> {text.deadlinePassed}
          </div>
        </div>

        {/* Expired E */}
        <div className={`p-4 rounded-2xl border shadow-sm transition-colors ${
          metrics.expiredCount > 0 
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200' 
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">{text.expiredCard}</span>
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
          </div>
          <div className="text-xl font-black text-rose-700 dark:text-rose-300">
            {num(metrics.expiredFree)} <span className="text-xs font-normal">{text.pcs}</span>
          </div>
          <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1.5 font-medium">
            {text.positions} <strong>{num(metrics.expiredCount)}</strong> {text.below0}
          </div>
        </div>
      </div>

      {/* Critical Expiry Warning Banner if Expired or Hold Stock exists */}
      {metrics.expiredCount > 0 && (
        <div className="bg-rose-50 border-l-4 border-rose-500 p-4 rounded-xl text-rose-900 dark:bg-rose-950/60 dark:text-rose-200 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm">{text.expiredAlertTitle}</h4>
              <p className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
                {text.expiredAlertBody(num(metrics.expiredCount), num(metrics.expiredFree))}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setSelectedStockType('E'); setSelectedUrgency('expired'); }}
            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-lg shrink-0 shadow-sm cursor-pointer"
          >
            {text.showExpired}
          </button>
        </div>
      )}

      {/* Filter and Control Toolbar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm space-y-3">
        <div className="crm-filters">
          {/* Search Input */}
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={text.searchPlaceholder}
              className="w-full ps-9 pe-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Group Filter */}
          <div>
            <select
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">{text.allGroups(num(uniqueGroups.length))}</option>
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
              <option value="all">{text.allStockTypes}</option>
              <option value="N">🟢 {text.stockTypeOptions.N}</option>
              <option value="A">🟡 {text.stockTypeOptions.A}</option>
              <option value="B">🟠 {text.stockTypeOptions.B}</option>
              <option value="H">🟣 {text.stockTypeOptions.H}</option>
              <option value="E">🔴 {text.stockTypeOptions.E}</option>
            </select>
          </div>

          {/* Urgency Filter */}
          <div>
            <select
              value={selectedUrgency}
              onChange={e => setSelectedUrgency(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">{text.allExpiry}</option>
              <option value="expired">🔴 {text.urgencyOptions.expired}</option>
              <option value="hold">🟣 {text.urgencyOptions.hold}</option>
              <option value="critical">🟠 {text.urgencyOptions.critical}</option>
              <option value="warning">🟡 {text.urgencyOptions.warning}</option>
              <option value="normal">🟢 {text.urgencyOptions.normal}</option>
            </select>
          </div>

          {/* Sort By */}
          <div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="days_asc">⏳ {text.sortOptions.days_asc}</option>
              <option value="days_desc">⏳ {text.sortOptions.days_desc}</option>
              <option value="stock_desc">📦 {text.sortOptions.stock_desc}</option>
              <option value="stock_asc">📦 {text.sortOptions.stock_asc}</option>
              <option value="name_asc">🔤 {text.sortOptions.name_asc}</option>
              <option value="article_asc">🔢 {text.sortOptions.article_asc}</option>
            </select>
          </div>
        </div>

        {/* Active Filters Bar */}
        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700/50">
          <div>
            {text.found} <strong className="text-slate-900 dark:text-white">{num(filteredItems.length)}</strong> {text.ofTotal(num(items.length))}
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
              {text.resetFilters}
            </button>
          )}
        </div>
      </div>

      {/* Main 16-Column Excel Data Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200/80 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="min-w-0 overflow-y-auto custom-scrollbar max-h-[700px]">
          <ResponsiveTable wide className="w-full text-start text-xs border-collapse">
            <thead className="sticky top-0 z-20 bg-slate-100 dark:bg-slate-900/95 backdrop-blur-md text-slate-700 dark:text-slate-300 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-700 text-[11px]">
              <tr>
                <th className="px-3 py-3 w-8 text-center">{text.rowNumber}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.group}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.article}</th>
                <th className="px-3 py-3 min-w-[260px]">{text.columns.name}</th>
                <th className="px-2 py-3 text-center w-12 whitespace-nowrap">{text.columns.rsv}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.unit}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.batch}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.productionDate}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.expiryDate}</th>
                <th className="px-2 py-3 text-center whitespace-nowrap">{text.columns.minDaysLimit}</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">{text.columns.daysToExpiry}</th>
                <th className="px-3 py-3 whitespace-nowrap">{text.columns.commercializationDeadline}</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">{text.columns.daysToDeadline}</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">{text.columns.stockType}</th>
                <th className="px-3 py-3 text-end whitespace-nowrap">{text.columns.totalStock}</th>
                <th className="px-3 py-3 text-end whitespace-nowrap">{text.columns.reservedStock}</th>
                <th className="px-3 py-3 text-end whitespace-nowrap bg-indigo-50/60 dark:bg-indigo-950/40">{text.columns.freeStock}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60 font-medium">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={17} className="text-center py-12 text-slate-400">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="font-semibold text-sm">{text.emptyTitle}</p>
                    <p className="text-xs">{text.emptyHint}</p>
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
                      <td className="px-3 py-2.5 text-center text-slate-400 font-normal">{num(index + 1)}</td>
                      <td className="px-3 py-2.5 font-bold text-slate-600 dark:text-slate-400">{item.group}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-800 dark:text-slate-200 font-semibold">{item.article}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">{item.name}</td>
                      <td className="px-2 py-2.5 text-center text-slate-500">{item.rsv}</td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">{item.unit}</td>
                      <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400">{item.batch || '—'}</td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatReportDate(item.productionDate, locale)}</td>
                      <td className="px-3 py-2.5 text-slate-900 dark:text-white font-semibold whitespace-nowrap">{formatReportDate(item.expiryDate, locale)}</td>
                      <td className="px-2 py-2.5 text-center text-slate-500">{num(item.minDaysLimit)}</td>
                      
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
                          {num(item.daysToExpiry)}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">{formatReportDate(item.commercializationDeadline, locale)}</td>
                      
                      {/* Days to Deadline */}
                      <td className="px-3 py-2.5 text-center">
                        <span className={`font-mono text-xs font-semibold ${
                          item.daysToDeadline < 0 
                            ? 'text-rose-600 dark:text-rose-400' 
                            : 'text-slate-700 dark:text-slate-300'
                        }`}>
                          {num(item.daysToDeadline)}
                        </span>
                      </td>

                      {/* Stock Type Code */}
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <span title={badge.label} className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${badge.bg}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {item.stockType}
                        </span>
                      </td>

                      <td className="px-3 py-2.5 text-end font-mono text-slate-600 dark:text-slate-400">{num(item.totalStock)}</td>
                      <td className="px-3 py-2.5 text-end font-mono text-slate-500">{num(item.reservedStock)}</td>
                      <td className="px-3 py-2.5 text-end font-mono font-bold text-slate-900 dark:text-white bg-indigo-50/30 dark:bg-indigo-950/20 text-xs">
                        {num(item.freeStock)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredItems.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 bg-slate-100 dark:bg-slate-900 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                <tr>
                  <td colSpan={14} className="px-3 py-3 text-end uppercase tracking-wider text-slate-700 dark:text-slate-300 text-[11px]">
                    {text.totalRow(num(filteredItems.length))}
                  </td>
                  <td className="px-3 py-3 text-end font-mono text-slate-800 dark:text-slate-200">
                    {num(pageTotals.totalStock)}
                  </td>
                  <td className="px-3 py-3 text-end font-mono text-slate-600 dark:text-slate-400">
                    {num(pageTotals.reservedStock)}
                  </td>
                  <td className="px-3 py-3 text-end font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-100/50 dark:bg-indigo-900/50 text-sm">
                    {num(pageTotals.freeStock)}
                  </td>
                </tr>
              </tfoot>
            )}
          </ResponsiveTable>
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
  availableColumns: SourceColumn[];
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
  const { text, locale } = useSectionText(KUSTO_TEXT);
  const num = (val: number | null | undefined) => formatNum(val, locale);

  const requiredFields = new Set<keyof KustoColumnMapping>(['article', 'name', 'expiryDate', 'freeStock']);
  const fieldsList = FIELD_ORDER.map((key, idx) => ({
    key,
    label: `${num(idx + 1)}. ${text.columns[key]}`,
    description: text.fieldHints[key],
    required: requiredFields.has(key)
  }));

  const handleFieldChange = (field: keyof KustoColumnMapping, colIndex: number) => {
    setLocalMapping(prev => ({
      ...prev,
      [field]: colIndex
    }));
  };

  return (
    <div className="crm-dialog-overlay fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="crm-dialog bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {text.mappingTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {text.mappingSubtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={text.close}
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
                {text.startRowTitle}
              </span>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {text.startRowHint}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-500">{text.rowNo}</span>
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
                {text.mappingGrid}
              </h4>
              {rawWorkbookData && (
                <button
                  type="button"
                  onClick={onAutoDetect}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {text.autoDetect}
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
                          {field.required && <span className="text-rose-500 ms-1">*</span>}
                        </span>
                        <span className="text-[11px] font-mono font-medium px-2 py-0.5 bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg">
                          {text.columnBadge(columnLetter(selectedCol), num(selectedCol + 1))}
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
                          {sourceColumnLabel(col, text, locale)} {col.sample !== '—' ? text.sample(col.sample ?? text.sampleData) : ''}
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
                {text.previewTitle}
              </div>
              <div className="min-w-0 text-xs">
                <ResponsiveTable wide className="w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-200 dark:bg-slate-800 text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">
                      <th className="p-2">{text.preview.article}</th>
                      <th className="p-2">{text.preview.name}</th>
                      <th className="p-2">{text.preview.batch}</th>
                      <th className="p-2">{text.preview.expiryDate}</th>
                      <th className="p-2">{text.preview.daysToExpiry}</th>
                      <th className="p-2">{text.preview.stockType}</th>
                      <th className="p-2">{text.preview.freeStock}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-[11px]">
                    {previewRows.slice(0, 2).map((row, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-bold">{cleanArticle(row[localMapping.article]) || '—'}</td>
                        <td className="p-2 font-sans font-medium">{cleanText(row[localMapping.name]) || '—'}</td>
                        <td className="p-2">{cleanText(row[localMapping.batch]) || '—'}</td>
                        <td className="p-2">{formatReportDate(cleanDateStr(row[localMapping.expiryDate]), locale) || '—'}</td>
                        <td className="p-2 text-center">{num(parseSignedNum(row[localMapping.daysToExpiry]))}</td>
                        <td className="p-2 text-center font-bold text-indigo-600">{cleanText(row[localMapping.stockType]) || 'N'}</td>
                        <td className="p-2 text-end font-bold">{num(parseSignedNum(row[localMapping.freeStock]))}</td>
                      </tr>
                    ))}
                  </tbody>
                </ResponsiveTable>
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
            {text.cancel}
          </button>

          <button
            type="button"
            onClick={() => onSave(localMapping, localStartRow)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-2 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>{text.applyMapping}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
