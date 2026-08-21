import React, { useState, useEffect, useMemo } from 'react';
import { 
  Warehouse as WarehouseIcon, 
  Search, 
  RefreshCw, 
  ExternalLink, 
  Package, 
  Layers, 
  Calendar, 
  Building2, 
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Tag,
  Filter,
  BarChart3,
  Download,
  PieChart,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  Box,
  History,
  Mail,
  Truck
} from 'lucide-react';
import { useLanguage } from '../../contexts/LanguageContext';
import { WarehouseResponse, Warehouse, WarehouseItem, WarehouseChangeLog } from '../../types';
import { WarehouseChangeLogs } from './WarehouseChangeLogs';
import { WarehouseAutoMailing } from './WarehouseAutoMailing';

// Category Helper
type ProductCategory = 'butter' | 'cheese' | 'icecream' | 'cream' | 'other';

function getCategory(productName: string): ProductCategory {
  const p = (productName || '').toLowerCase();
  if (p.includes('масло') || p.includes('butter')) return 'butter';
  if (p.includes('сыр') || p.includes('cheese')) return 'cheese';
  if (p.includes('мороженое') || p.includes('ice cream')) return 'icecream';
  if (p.includes('сливки') || p.includes('йогурт') || p.includes('cream')) return 'cream';
  return 'other';
}

function parsePalletsNumber(palletStr: string): number {
  if (!palletStr) return 0;
  // Replace Russian/European decimal commas with dots (e.g. "15,5" -> "15.5")
  const normalized = String(palletStr).replace(/,/g, '.');
  // Match all numbers (integers or floats) in the string regardless of surrounding letters or symbols
  const matches = normalized.match(/\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return 0;
  
  // If string explicitly specifies "пал" or "паллет" or has multiple parts, sum up all numbers
  if (normalized.includes('пал') || normalized.includes('паллет') || matches.length > 1) {
    return matches.reduce((acc, curr) => acc + (parseFloat(curr) || 0), 0);
  }
  return parseFloat(matches[0]) || 0;
}

function parseInvoiceNumberForSort(invStr: string): number {
  if (!invStr) return 0;
  const digits = String(invStr).replace(/\D/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function hasValidInvoiceNumber(invStr: string): boolean {
  if (!invStr) return false;
  // Check if invoice has actual characters/digits (ignoring spaces, dashes, slashes, empty marks)
  const cleaned = String(invStr).replace(/[^a-zA-Z0-9А-Яа-я]/g, '');
  return cleaned.length > 0;
}

export const WarehouseInventory: React.FC = () => {
  const { t } = useLanguage();
  const [data, setData] = useState<WarehouseResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Active Sub-Tab View ('stock' | 'logs')
  const [activeView, setActiveView] = useState<'stock' | 'logs'>('stock');

  // Filter States
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [selectedScope, setSelectedScope] = useState<'all' | 'active' | 'archive'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSvh, setSelectedSvh] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('default');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAnalytics, setShowAnalytics] = useState<boolean>(true);

  const handleAddManualLog = async (logData: Partial<WarehouseChangeLog>) => {
    try {
      const response = await fetch('/api/warehouses/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      });
      if (response.ok) {
        fetchData(true);
      }
    } catch (err) {
      console.error('Failed to save manual warehouse log:', err);
    }
  };

  const fetchData = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const url = isManualRefresh ? '/api/warehouses/sync' : '/api/warehouses';
      const method = isManualRefresh ? 'POST' : 'GET';
      const response = await fetch(url, { method });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      const json = await response.json();
      const jsonData: WarehouseResponse = isManualRefresh && json.data ? json.data : json;
      setData(jsonData);
    } catch (err: any) {
      console.error('Failed to fetch warehouse data:', err);
      setError(err.message || 'Error fetching warehouse data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const allWarehouses = useMemo(() => {
    return data?.warehouses || [];
  }, [data]);

  // Master Raw List of Items
  const allRawItems = useMemo(() => {
    if (!data) return [];
    const result: {
      item: WarehouseItem;
      warehouseName: string;
      warehouseId: string;
      isArchive: boolean;
      isTrucksReport: boolean;
      category: ProductCategory;
      numericPallets: number;
    }[] = [];

    allWarehouses.forEach(wh => {
      wh.items.forEach(item => {
        result.push({
          item,
          warehouseName: wh.name,
          warehouseId: wh.id,
          isArchive: !!wh.isArchive || item.isArchiveItem || wh.id === 'inv_kusto',
          isTrucksReport: !!wh.isTrucksReport || (item as any).isTrucksReportItem || wh.id === 'trucks_report',
          category: getCategory(item.product),
          numericPallets: parsePalletsNumber(item.palletCount),
        });
      });
    });

    return result;
  }, [data, allWarehouses]);

  // Filtered Items List
  const filteredItems = useMemo(() => {
    let list = [...allRawItems];

    // Scope Filter (Active Stock vs Archive)
    if (selectedScope === 'active') {
      list = list.filter(x => !x.isArchive);
    } else if (selectedScope === 'archive') {
      list = list.filter(x => x.isArchive);
    }

    // 1. Warehouse Filter
    if (selectedWarehouse !== 'all') {
      list = list.filter(x => x.warehouseId === selectedWarehouse);
    }

    // 2. Category Filter
    if (selectedCategory !== 'all') {
      list = list.filter(x => x.category === selectedCategory);
    }

    // 3. SVH Filter
    if (selectedSvh !== 'all') {
      if (selectedSvh === 'kusto') {
        list = list.filter(x => x.item.svh.toLowerCase().includes('кусто') || x.item.svh.toLowerCase().includes('kusto'));
      } else if (selectedSvh === 'zholdost') {
        list = list.filter(x => x.item.svh.toLowerCase().includes('жолдост') || x.item.svh.toLowerCase().includes('zholdost'));
      } else if (selectedSvh === 'none') {
        list = list.filter(x => !x.item.svh || x.item.svh.trim().length === 0);
      }
    }

    // 4. Invoice Filter
    if (selectedInvoice !== 'all') {
      if (selectedInvoice === 'with') {
        list = list.filter(x => hasValidInvoiceNumber(x.item.invNumber));
      } else if (selectedInvoice === 'without') {
        list = list.filter(x => !hasValidInvoiceNumber(x.item.invNumber));
      }
    }

    // 5. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(({ item, warehouseName }) => {
        return (
          item.product.toLowerCase().includes(q) ||
          item.invNumber.toLowerCase().includes(q) ||
          item.dates.toLowerCase().includes(q) ||
          item.svh.toLowerCase().includes(q) ||
          warehouseName.toLowerCase().includes(q)
        );
      });
    }

    // 6. Sorting
    if (sortBy === 'pallets-desc') {
      list.sort((a, b) => b.numericPallets - a.numericPallets);
    } else if (sortBy === 'pallets-asc') {
      list.sort((a, b) => a.numericPallets - b.numericPallets);
    } else if (sortBy === 'name-asc') {
      list.sort((a, b) => a.item.product.localeCompare(b.item.product));
    } else if (sortBy === 'inv-asc') {
      list.sort((a, b) => {
        const numA = parseInvoiceNumberForSort(a.item.invNumber);
        const numB = parseInvoiceNumberForSort(b.item.invNumber);
        if (numA !== numB && numA > 0 && numB > 0) return numA - numB;
        return (a.item.invNumber || '').localeCompare(b.item.invNumber || '');
      });
    }

    return list;
  }, [allRawItems, selectedScope, selectedWarehouse, selectedCategory, selectedSvh, selectedInvoice, searchQuery, sortBy]);

  // Overall Calculated Metrics & Analytics
  const metrics = useMemo(() => {
    // Active stock warehouses (excluding archive)
    const activeWarehouses = allWarehouses.filter(w => !w.isArchive && w.id !== 'inv_kusto');
    const archiveWarehouses = allWarehouses.filter(w => w.isArchive || w.id === 'inv_kusto');

    const activeList = allRawItems.filter(x => !x.isArchive);
    const archiveList = allRawItems.filter(x => x.isArchive);

    // Filter baseList according to selected Warehouse or selected Scope
    let baseList = allRawItems;
    if (selectedWarehouse !== 'all') {
      baseList = allRawItems.filter(x => x.warehouseId === selectedWarehouse);
    } else if (selectedScope === 'active') {
      baseList = activeList;
    } else if (selectedScope === 'archive') {
      baseList = archiveList;
    }

    const totalPositions = baseList.length;
    const totalPallets = baseList.reduce((acc, curr) => acc + (curr.isArchive ? 0 : curr.numericPallets), 0);
    const activePalletsTotal = activeList.reduce((acc, curr) => acc + curr.numericPallets, 0);

    // Categories breakdown
    const categoryCounts: Record<ProductCategory, { count: number; pallets: number }> = {
      butter: { count: 0, pallets: 0 },
      cheese: { count: 0, pallets: 0 },
      icecream: { count: 0, pallets: 0 },
      cream: { count: 0, pallets: 0 },
      other: { count: 0, pallets: 0 },
    };

    // SVH Breakdown
    let countKusto = 0;
    let countZholdost = 0;
    let countNoneSvh = 0;

    // Invoice Breakdown
    let countWithInv = 0;
    let countWithoutInv = 0;

    baseList.forEach(entry => {
      // Category
      categoryCounts[entry.category].count += 1;
      categoryCounts[entry.category].pallets += entry.isArchive ? 0 : entry.numericPallets;

      // SVH
      const svhLower = entry.item.svh.toLowerCase();
      if (svhLower.includes('кусто') || svhLower.includes('kusto')) {
        countKusto += 1;
      } else if (svhLower.includes('жолдост') || svhLower.includes('zholdost')) {
        countZholdost += 1;
      } else {
        countNoneSvh += 1;
      }

      // Invoice
      if (hasValidInvoiceNumber(entry.item.invNumber)) {
        countWithInv += 1;
      } else {
        countWithoutInv += 1;
      }
    });

    // Warehouse Distribution
    const warehouseBreakdown = allWarehouses.map(wh => {
      const whItems = allRawItems.filter(x => x.warehouseId === wh.id);
      const palletsSum = whItems.reduce((acc, curr) => acc + (wh.isArchive ? 0 : curr.numericPallets), 0);
      return {
        id: wh.id,
        name: wh.name,
        isArchive: !!wh.isArchive || wh.id === 'inv_kusto',
        count: whItems.length,
        pallets: Math.round(palletsSum * 10) / 10,
        percentage: activePalletsTotal > 0 && !wh.isArchive ? Math.round((palletsSum / activePalletsTotal) * 100) : 0,
      };
    });

    return {
      activeWarehousesCount: activeWarehouses.length,
      archiveWarehousesCount: archiveWarehouses.length,
      activePositions: activeList.length,
      activePallets: Math.round(activePalletsTotal * 10) / 10,
      archiveTrucksCount: archiveList.length,
      totalPositions,
      totalPallets: Math.round(totalPallets * 10) / 10,
      categoryCounts,
      countKusto,
      countZholdost,
      countNoneSvh,
      countWithInv,
      countWithoutInv,
      warehouseBreakdown,
    };
  }, [allRawItems, allWarehouses, selectedWarehouse, selectedScope]);

  const formattedLastUpdated = useMemo(() => {
    if (!data?.updatedAt) return '';
    try {
      return new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return data.updatedAt;
    }
  }, [data]);

  // Export Filtered Table Data to CSV
  const handleExportCSV = () => {
    if (filteredItems.length === 0) return;

    const headers = ['№', t('inventoryNumber'), t('productName'), t('palletCount'), t('dates'), t('svh'), t('warehouses')];
    const rows = filteredItems.map(({ item, warehouseName }, idx) => [
      item.number || idx + 1,
      `"${item.invNumber || ''}"`,
      `"${item.product.replace(/"/g, '""')}"`,
      `"${item.palletCount || ''}"`,
      `"${item.dates || ''}"`,
      `"${item.svh || ''}"`,
      `"${warehouseName}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `warehouse_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const categoryLabels: Record<ProductCategory, { label: string; badgeBg: string; textClr: string }> = {
    butter: { label: t('categoryButter'), badgeBg: 'bg-amber-100 dark:bg-amber-900/40', textClr: 'text-amber-800 dark:text-amber-300' },
    cheese: { label: t('categoryCheese'), badgeBg: 'bg-yellow-100 dark:bg-yellow-900/40', textClr: 'text-yellow-800 dark:text-yellow-300' },
    icecream: { label: t('categoryIceCream'), badgeBg: 'bg-pink-100 dark:bg-pink-900/40', textClr: 'text-pink-800 dark:text-pink-300' },
    cream: { label: t('categoryCream'), badgeBg: 'bg-sky-100 dark:bg-sky-900/40', textClr: 'text-sky-800 dark:text-sky-300' },
    other: { label: t('categoryOther'), badgeBg: 'bg-slate-100 dark:bg-slate-700/60', textClr: 'text-slate-800 dark:text-slate-200' },
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-sm border border-slate-200 dark:border-slate-700/60 transition-all">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4 space-x-reverse">
            <div className="p-3.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
              <WarehouseIcon className="w-8 h-8" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                  {t('warehousesTitle')}
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-500" />
                  Google Sheets Live Sync
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {t('warehousesDescription')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-start md:self-auto flex-wrap">
            <button
              onClick={() => setShowAnalytics(!showAnalytics)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border transition-all ${
                showAnalytics 
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800' 
                  : 'bg-slate-100 dark:bg-slate-700/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>{t('toggleAnalytics')}</span>
              {showAnalytics ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => fetchData(true)}
              disabled={loading || refreshing}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700/80 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors disabled:opacity-50 border border-slate-200 dark:border-slate-600"
              title={t('refreshData')}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{t('refreshData')}</span>
            </button>

            <a
              href="https://docs.google.com/spreadsheets/d/1FRwicnGLMSD2jurukoLPEa5kGmycpwAHnBvObJX7kCQ/edit?gid=2106761407#gid=2106761407"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm hover:shadow"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span className="hidden sm:inline">{t('viewOriginalSheet')}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </a>
          </div>
        </div>
      </div>

      {/* Sub-navigation Tabs (Stock vs Changes Log) */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-200/60 dark:bg-slate-800/80 rounded-2xl w-fit border border-slate-200/80 dark:border-slate-700/60">
        <button
          onClick={() => setActiveView('stock')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            activeView === 'stock'
              ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Box className="w-4 h-4" />
          <span>Остатки на складах</span>
        </button>

        <button
          onClick={() => setActiveView('logs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all relative ${
            activeView === 'logs'
              ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <History className="w-4 h-4" />
          <span>Лог изменений Excel / Google</span>
          {data?.logs && data.logs.length > 0 && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
              {data.logs.length}
            </span>
          )}
        </button>
      </div>

      {activeView === 'logs' ? (
        <WarehouseChangeLogs
          logs={data?.logs || []}
          warehouses={(data?.warehouses || []).map(w => ({ id: w.id, name: w.name }))}
          onRefresh={() => fetchData(true)}
          refreshing={refreshing}
          onAddManualLog={handleAddManualLog}
          spreadsheetUrl={data?.spreadsheetUrl}
        />
      ) : (
        <>
          {/* Primary KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('totalWarehouses')}
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {metrics.activeWarehousesCount} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">(+1 {t('deliveredArchive')})</span>
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('activeStock')} ({t('totalItems')})
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              {metrics.activePositions}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('totalPallets')} ({t('activeStock')})
            </p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
              ~{metrics.activePallets}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center space-x-4 space-x-reverse">
          <div className="p-3 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('deliveredTrucksCount')}
            </p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-0.5">
              {metrics.archiveTrucksCount}
            </p>
          </div>
        </div>
      </div>

      {/* Collapsible Analytics / Calculated Metrics Panel */}
      {showAnalytics && !loading && !error && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm p-6 space-y-6 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
            <div className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {t('calculatedMetrics')}
              </h2>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {selectedWarehouse === 'all' ? t('allWarehouses') : allWarehouses.find(w => w.id === selectedWarehouse)?.name}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 1. Category Breakdown */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/50 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Box className="w-4 h-4 text-amber-500" />
                {t('categories')}
              </h3>

              <div className="space-y-2.5 pt-1">
                {(Object.keys(metrics.categoryCounts) as ProductCategory[]).map(catKey => {
                  const itemInfo = metrics.categoryCounts[catKey];
                  const percentage = metrics.totalPallets > 0 ? Math.round((itemInfo.pallets / metrics.totalPallets) * 100) : 0;
                  const config = categoryLabels[catKey];

                  return (
                    <div key={catKey} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`px-2 py-0.5 rounded font-medium ${config.badgeBg} ${config.textClr}`}>
                          {config.label}
                        </span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {itemInfo.pallets} {t('whPalletsCount')} ({percentage}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 2. SVH & Customs Analytics */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/50 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-indigo-500" />
                {t('svh')}
              </h3>

              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t('svhKusto')}
                  </span>
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded">
                    {metrics.countKusto} {t('whItemsCount')}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t('svhZholdost')}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded">
                    {metrics.countZholdost} {t('whItemsCount')}
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t('svhNone')}
                  </span>
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded">
                    {metrics.countNoneSvh} {t('whItemsCount')}
                  </span>
                </div>
              </div>
            </div>

            {/* 3. Invoices & Warehouse Volume */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200/80 dark:border-slate-700/50 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Tag className="w-4 h-4 text-emerald-500" />
                {t('invoiceFilter')}
              </h3>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700 text-center">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    {t('withInvoice')}
                  </p>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {metrics.countWithInv}
                  </p>
                </div>

                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200/60 dark:border-slate-700 text-center">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    {t('withoutInvoice')}
                  </p>
                  <p className="text-xl font-bold text-slate-600 dark:text-slate-400 mt-1">
                    {metrics.countWithoutInv}
                  </p>
                </div>
              </div>

              {/* Share per Warehouse Mini Bar */}
              {selectedWarehouse === 'all' && (
                <div className="space-y-1.5 pt-2">
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t('shareOfTotal')}:
                  </p>
                  <div className="space-y-1">
                    {metrics.warehouseBreakdown.map(wh => (
                      <div key={wh.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-600 dark:text-slate-300">{wh.name}</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {wh.pallets} {t('whPalletsCount')} ({wh.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Content Card: Interactive Toolbar & Inventory Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden">
        {/* Scope Selector & Warehouse Tabs Header */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/30 space-y-3">
          {/* Top Scope Filter: Active Stock vs Delivered Archive */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-200/60 dark:border-slate-700/50">
            <div className="flex items-center gap-1.5 p-1 bg-slate-200/80 dark:bg-slate-900/80 rounded-xl">
              <button
                onClick={() => {
                  setSelectedScope('all');
                  setSelectedWarehouse('all');
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                  selectedScope === 'all' && selectedWarehouse === 'all'
                    ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {t('allTabs')}
              </button>

              <button
                onClick={() => {
                  setSelectedScope('active');
                  if (selectedWarehouse === 'inv_kusto') setSelectedWarehouse('all');
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  selectedScope === 'active'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>{t('activeStockOnly')}</span>
              </button>

              <button
                onClick={() => {
                  setSelectedScope('archive');
                  setSelectedWarehouse('inv_kusto');
                }}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                  selectedScope === 'archive' || selectedWarehouse === 'inv_kusto'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{t('archiveOnly')}</span>
              </button>
            </div>

            <button
              onClick={handleExportCSV}
              disabled={filteredItems.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-40 ml-auto"
            >
              <Download className="w-3.5 h-3.5 text-blue-500" />
              <span>{t('exportCsv')}</span>
            </button>
          </div>

          {/* Individual Warehouse Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => {
                setSelectedWarehouse('all');
              }}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                selectedWarehouse === 'all'
                  ? 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t('allWarehouses')} ({allWarehouses.length})
            </button>

            {allWarehouses.map(wh => {
              const isArch = wh.isArchive || wh.id === 'inv_kusto';
              const isTrucks = wh.isTrucksReport || wh.id === 'trucks_report';
              return (
                <button
                  key={wh.id}
                  onClick={() => {
                    setSelectedWarehouse(wh.id);
                    if (isArch) setSelectedScope('archive');
                  }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                    selectedWarehouse === wh.id
                      ? isTrucks
                        ? 'bg-blue-700 text-white shadow-sm'
                        : isArch
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-sm'
                      : isTrucks
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60'
                        : isArch
                          ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {isTrucks && <Truck className="w-3.5 h-3.5 text-blue-400" />}
                  {isArch && <CheckCircle2 className="w-3 h-3 text-purple-500" />}
                  <span>{wh.name}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                    selectedWarehouse === wh.id
                      ? isTrucks ? 'bg-blue-900 text-blue-100' : isArch ? 'bg-purple-800 text-purple-100' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                      : isTrucks ? 'bg-blue-200/60 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200' : isArch ? 'bg-purple-200/60 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200' : 'bg-slate-300/60 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                  }`}>
                    {wh.itemCount}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Informative Banner for Trucks Report */}
          {selectedWarehouse === 'trucks_report' && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 rounded-xl flex items-center gap-3 text-blue-900 dark:text-blue-200 text-xs">
              <Truck className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div>
                <span className="font-bold">🚚 Отчет по машинам (Онлайн Google Таблица): </span>
                <span>Вкладка содержит актуальный статус прибытия автотранспорта на СВХ, дату заезда и текущий статус (можно забрать / лаборатория / выгружен). Включается первым листом в ежедневную рассылку коллегам.</span>
              </div>
            </div>
          )}

          {/* Informative Banner for Delivered Trucks Archive (inv_kusto) */}
          {(selectedWarehouse === 'inv_kusto' || selectedScope === 'archive') && selectedWarehouse !== 'trucks_report' && (
            <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 rounded-xl flex items-center gap-3 text-purple-800 dark:text-purple-200 text-xs">
              <CheckCircle2 className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" />
              <div>
                <span className="font-bold">Архив доставленных авто (СВХ Кусто): </span>
                <span>Вкладка содержит журнал автотранспорта, который уже прибыл и выгрузился на основной склад (заезд/выезд СВХ). Не включается в текущие активные остатки паллет.</span>
              </div>
            </div>
          )}
        </div>

        {/* Filters and Search Control Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-700/60 bg-white dark:bg-slate-800 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            {/* Search Input */}
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={t('searchWarehouseItems')}
                className="w-full pl-10 pr-8 py-2 text-xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:text-white placeholder:text-slate-400 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Category Filter */}
            <div>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700 dark:text-slate-200 font-medium"
              >
                <option value="all">{t('allCategories')}</option>
                <option value="butter">{t('categoryButter')}</option>
                <option value="cheese">{t('categoryCheese')}</option>
                <option value="icecream">{t('categoryIceCream')}</option>
                <option value="cream">{t('categoryCream')}</option>
                <option value="other">{t('categoryOther')}</option>
              </select>
            </div>

            {/* SVH Filter */}
            <div>
              <select
                value={selectedSvh}
                onChange={e => setSelectedSvh(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700 dark:text-slate-200 font-medium"
              >
                <option value="all">{t('allSvh')}</option>
                <option value="kusto">{t('svhKusto')}</option>
                <option value="zholdost">{t('svhZholdost')}</option>
                <option value="none">{t('svhNone')}</option>
              </select>
            </div>

            {/* Invoice Filter */}
            <div>
              <select
                value={selectedInvoice}
                onChange={e => setSelectedInvoice(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700 dark:text-slate-200 font-medium"
              >
                <option value="all">{t('allInvoices')}</option>
                <option value="with">{t('withInvoice')}</option>
                <option value="without">{t('withoutInvoice')}</option>
              </select>
            </div>

            {/* Sorting Filter */}
            <div>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="w-full py-2 px-3 text-xs bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-700 dark:text-slate-200 font-medium"
              >
                <option value="default">{t('sortDefault')}</option>
                <option value="pallets-desc">{t('sortPalletsDesc')}</option>
                <option value="pallets-asc">{t('sortPalletsAsc')}</option>
                <option value="name-asc">{t('sortNameAsc')}</option>
                <option value="inv-asc">{t('sortInvoiceAsc')}</option>
              </select>
            </div>
          </div>

          {/* Active Filter Badges */}
          {(selectedCategory !== 'all' || selectedSvh !== 'all' || selectedInvoice !== 'all' || searchQuery || sortBy !== 'default') && (
            <div className="flex items-center gap-2 pt-1 flex-wrap text-xs">
              <span className="text-slate-400 font-medium flex items-center gap-1">
                <SlidersHorizontal className="w-3 h-3" />
                Active filters:
              </span>

              {selectedCategory !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-md font-medium">
                  {categoryLabels[selectedCategory as ProductCategory]?.label}
                  <button onClick={() => setSelectedCategory('all')} className="hover:opacity-75">✕</button>
                </span>
              )}

              {selectedSvh !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 rounded-md font-medium">
                  {selectedSvh === 'kusto' ? t('svhKusto') : selectedSvh === 'zholdost' ? t('svhZholdost') : t('svhNone')}
                  <button onClick={() => setSelectedSvh('all')} className="hover:opacity-75">✕</button>
                </span>
              )}

              {selectedInvoice !== 'all' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 rounded-md font-medium">
                  {selectedInvoice === 'with' ? t('withInvoice') : t('withoutInvoice')}
                  <button onClick={() => setSelectedInvoice('all')} className="hover:opacity-75">✕</button>
                </span>
              )}

              {sortBy !== 'default' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded-md font-medium">
                  Sort: {sortBy}
                  <button onClick={() => setSortBy('default')} className="hover:opacity-75">✕</button>
                </span>
              )}

              <button
                onClick={() => {
                  setSelectedCategory('all');
                  setSelectedSvh('all');
                  setSelectedInvoice('all');
                  setSortBy('default');
                  setSearchQuery('');
                }}
                className="text-xs text-rose-600 dark:text-rose-400 hover:underline font-medium ml-auto"
              >
                Reset all filters
              </button>
            </div>
          )}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="p-12 text-center">
            <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              {t('loadingWarehouseData')}
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-8 m-5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-2xl flex items-center gap-4 text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-6 h-6 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-sm">{t('failedToLoadWarehouseData')}</h3>
              <p className="text-xs mt-1 opacity-90">{error}</p>
              <button
                onClick={() => fetchData(true)}
                className="mt-3 px-3 py-1.5 bg-rose-600 text-white text-xs font-medium rounded-lg hover:bg-rose-700 transition-colors"
              >
                {t('refreshData')}
              </button>
            </div>
          </div>
        )}

        {/* Inventory Items Table */}
        {!loading && !error && (
          <>
            {filteredItems.length === 0 ? (
              <div className="p-12 text-center">
                <Package className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                <p className="text-base font-semibold text-slate-700 dark:text-slate-300">
                  {t('noItemsFound')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Try adjusting your search query or reset active filters.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto momentum-scroll custom-scrollbar">
                <table className="w-full text-left border-collapse min-w-[850px]">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700/60 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      <th className="py-3.5 px-4 w-12 text-center">№</th>
                      <th className="py-3.5 px-4">{selectedWarehouse === 'trucks_report' ? '№ Машины / Инвойс' : t('inventoryNumber')}</th>
                      <th className="py-3.5 px-4">{t('productName')}</th>
                      {selectedWarehouse !== 'trucks_report' && (
                        <>
                          <th className="py-3.5 px-4">{t('categories')}</th>
                          <th className="py-3.5 px-4">{t('palletCount')}</th>
                        </>
                      )}
                      <th className="py-3.5 px-4">{selectedWarehouse === 'trucks_report' ? 'Дата прибытия / СВХ' : t('dates')}</th>
                      <th className="py-3.5 px-4">{selectedWarehouse === 'trucks_report' ? 'Текущий статус' : t('svh')}</th>
                      {selectedWarehouse === 'all' && (
                        <th className="py-3.5 px-4 text-center">{t('warehouses')}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700/60 text-sm">
                    {filteredItems.map(({ item, warehouseName, warehouseId, isArchive, isTrucksReport, category }, idx) => {
                      const catConfig = categoryLabels[category];
                      const isTrucksItem = isTrucksReport || warehouseId === 'trucks_report';

                      return (
                        <tr 
                          key={`${warehouseId}-${idx}`}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-700/30 transition-colors ${
                            isTrucksItem ? 'hover:bg-blue-50/30 dark:hover:bg-blue-950/20' : isArchive ? 'bg-purple-50/20 dark:bg-purple-950/10' : ''
                          }`}
                        >
                          <td className="py-3.5 px-4 text-center text-xs font-medium text-slate-400 dark:text-slate-500">
                            {item.number || idx + 1}
                          </td>

                          <td className="py-3.5 px-4 font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {item.invNumber ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/60 text-slate-800 dark:text-slate-200">
                                {isTrucksItem ? <Truck className="w-3 h-3 text-blue-500" /> : <Tag className="w-3 h-3 text-emerald-500" />}
                                {item.invNumber}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600 font-sans text-xs">—</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-slate-100 max-w-xs md:max-w-md">
                            {item.product || '—'}
                          </td>

                          {selectedWarehouse !== 'trucks_report' && (
                            <>
                              <td className="py-3.5 px-4">
                                <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${catConfig.badgeBg} ${catConfig.textClr}`}>
                                  {catConfig.label}
                                </span>
                              </td>

                              <td className="py-3.5 px-4">
                                {isArchive ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/50">
                                    <CheckCircle2 className="w-3 h-3 text-purple-500" />
                                    {item.palletCount || 'Выгружен'}
                                  </span>
                                ) : item.palletCount ? (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/50">
                                    {item.palletCount}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 dark:text-slate-600 text-xs">—</span>
                                )}
                              </td>
                            </>
                          )}

                          <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                            {item.dates ? (
                              <span className="inline-flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                {item.dates}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">—</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-xs text-slate-600 dark:text-slate-300">
                            {item.svh ? (
                              <span className={`inline-block px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                                isTrucksItem
                                  ? item.svh.toLowerCase().includes('можно забрать') || item.svh.toLowerCase().includes('выгружен')
                                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                                    : item.svh.toLowerCase().includes('лаб') || item.svh.toLowerCase().includes('свх') || item.svh.toLowerCase().includes('тамож')
                                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60'
                                      : item.svh.toLowerCase().includes('задерж')
                                        ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60'
                                        : 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
                                  : isArchive
                                    ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200'
                                    : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                              }`}>
                                {item.svh}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-600">—</span>
                            )}
                          </td>

                          {selectedWarehouse === 'all' && (
                            <td className="py-3.5 px-4 text-center">
                              <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
                                isTrucksItem
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                                  : isArchive
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                              }`}>
                                {warehouseName}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )}
</div>
  );
};
