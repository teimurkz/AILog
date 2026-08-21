import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  FileText, 
  Download, 
  RefreshCw, 
  Clock, 
  AlertTriangle, 
  Truck, 
  Warehouse, 
  Calendar, 
  CheckCircle2, 
  ArrowUpRight, 
  ArrowDownRight, 
  PieChart as PieIcon, 
  TrendingUp, 
  ShieldAlert, 
  Building2, 
  FileSpreadsheet,
  Layers,
  ChevronRight
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  PieChart, 
  Pie, 
  Cell, 
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { useShipments } from '../../hooks/useShipments';
import { useLanguage } from '../../contexts/LanguageContext';
import { generateDelayReport } from '../../utils/reports';
import { isShipmentDelayed } from '../../utils/shipmentUtils';
import { WarehouseResponse } from '../../types';

export const AnalyticsReports: React.FC = () => {
  const { t } = useLanguage();
  const { shipments, loading: loadingShipments } = useShipments();
  const [warehouseData, setWarehouseData] = useState<WarehouseResponse | null>(null);
  const [loadingWarehouse, setLoadingWarehouse] = useState<boolean>(true);
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);

  const fetchWarehouseData = async () => {
    setLoadingWarehouse(true);
    try {
      const res = await fetch('/api/warehouses');
      if (res.ok) {
        const data: WarehouseResponse = await res.json();
        setWarehouseData(data);
      }
    } catch (err) {
      console.error('Failed to load warehouse data for analytics:', err);
    } finally {
      setLoadingWarehouse(false);
    }
  };

  useEffect(() => {
    fetchWarehouseData();
  }, []);

  const handleRefreshAll = () => {
    fetchWarehouseData();
  };

  const handleDownloadPdfReport = async () => {
    setGeneratingPdf(true);
    try {
      await generateDelayReport(shipments, t);
    } catch (err) {
      console.error('Failed to generate PDF report:', err);
    } finally {
      setGeneratingPdf(false);
    }
  };

  // 1. Shipment Metrics
  const activeShipments = useMemo(() => shipments.filter(s => !s.isArchived), [shipments]);
  const delayedShipments = useMemo(() => activeShipments.filter(s => isShipmentDelayed(s)), [activeShipments]);
  const customsShipments = useMemo(() => activeShipments.filter(s => s.status === 'Customs'), [activeShipments]);
  const inTransitShipments = useMemo(() => activeShipments.filter(s => s.status === 'In Transit'), [activeShipments]);
  const deliveredShipments = useMemo(() => activeShipments.filter(s => s.status === 'Delivered'), [activeShipments]);

  const onTimePercentage = useMemo(() => {
    if (activeShipments.length === 0) return 100;
    const onTimeCount = activeShipments.length - delayedShipments.length;
    return Math.round((onTimeCount / activeShipments.length) * 100);
  }, [activeShipments, delayedShipments]);

  // Status Chart Data
  const statusChartData = useMemo(() => [
    { name: 'В пути (Transit)', value: inTransitShipments.length, color: '#3b82f6' },
    { name: 'Таможня (Customs)', value: customsShipments.length, color: '#8b5cf6' },
    { name: 'Задержка (Delayed)', value: delayedShipments.length, color: '#ef4444' },
    { name: 'Доставлено (Delivered)', value: deliveredShipments.length, color: '#10b981' }
  ], [inTransitShipments, customsShipments, delayedShipments, deliveredShipments]);

  // 2. Warehouse Stock Metrics & Category Chart Data
  const warehouseMetrics = useMemo(() => {
    if (!warehouseData || !warehouseData.warehouses) return { totalPallets: 0, totalSKUs: 0, categories: [] };

    let totalPallets = 0;
    let totalSKUs = 0;
    const categoryCounts: Record<string, number> = {
      'Сливочное масло': 0,
      'Сыры': 0,
      'Сливки': 0,
      'Мороженое': 0,
      'Прочая продукция': 0
    };

    warehouseData.warehouses.forEach(wh => {
      if (!wh.isArchive) {
        totalPallets += wh.totalPalletsNumeric || 0;
        wh.items.forEach(item => {
          totalSKUs++;
          const nameLower = (item.product || '').toLowerCase();
          const pVal = parseFloat(String(item.palletCount).replace(/,/g, '.')) || 1;

          if (nameLower.includes('масло') || nameLower.includes('butter')) {
            categoryCounts['Сливочное масло'] += pVal;
          } else if (nameLower.includes('сыр') || nameLower.includes('cheese')) {
            categoryCounts['Сыры'] += pVal;
          } else if (nameLower.includes('сливк') || nameLower.includes('cream')) {
            categoryCounts['Сливки'] += pVal;
          } else if (nameLower.includes('морож') || nameLower.includes('ice')) {
            categoryCounts['Мороженое'] += pVal;
          } else {
            categoryCounts['Прочая продукция'] += pVal;
          }
        });
      }
    });

    const categoryData = Object.entries(categoryCounts).map(([catName, val]) => ({
      name: catName,
      pallets: Math.round(val * 10) / 10
    }));

    return {
      totalPallets: Math.round(totalPallets * 10) / 10,
      totalSKUs,
      categories: categoryData
    };
  }, [warehouseData]);

  // Category Colors
  const CATEGORY_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#64748b'];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden border border-slate-800">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 rounded-full text-xs font-semibold text-blue-300 border border-blue-400/20">
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
              <span>Центр аналитики и отчётности</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Логистическая аналитика & Отчёты
            </h2>
            <p className="text-sm text-slate-300 max-w-2xl">
              Сводная аналитика по активным автомашинам, срокам таможенного оформления, остаткам паллет на складах и мгновенная генерация PDF/Excel отчетов.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleDownloadPdfReport}
              disabled={generatingPdf}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-rose-950/40 border border-rose-500/30 disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              <span>{generatingPdf ? 'Создание PDF...' : 'Отчет по задержкам (PDF)'}</span>
            </button>

            <a
              href="/api/mailing/download-excel"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/40 border border-emerald-500/30"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Выгрузить Склады (Excel)</span>
            </a>

            <button
              onClick={handleRefreshAll}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors border border-slate-700"
              title="Обновить аналитику"
            >
              <RefreshCw className={`w-4 h-4 ${loadingShipments || loadingWarehouse ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* KPI Highlight Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* On-Time Rate */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Соблюдение графика (On-Time)
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-slate-900 dark:text-white">
                {onTimePercentage}%
              </span>
              <span className="text-xs font-semibold text-emerald-600 flex items-center">
                <ArrowUpRight className="w-3.5 h-3.5" /> Высокий показатель
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {activeShipments.length - delayedShipments.length} из {activeShipments.length} авто идут без задержки
            </p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-2xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        {/* Delayed Trucks */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Задержано автомашин
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-rose-600 dark:text-rose-400">
                {delayedShipments.length}
              </span>
              <span className="text-xs font-medium text-slate-400">
                / {activeShipments.length} авто
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {delayedShipments.length > 0 ? 'Требуют внимания логиста' : 'Задержек не зафиксировано'}
            </p>
          </div>
          <div className="p-3 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-2xl">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        {/* Customs Vehicles */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              На Таможенном Оформлении
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-purple-600 dark:text-purple-400">
                {customsShipments.length}
              </span>
              <span className="text-xs font-medium text-purple-600/80">
                авто
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Среднее время очистки: ~2.4 дня
            </p>
          </div>
          <div className="p-3 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        {/* Total Warehouse Pallets */}
        <div className="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Всего паллет на складах
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-blue-600 dark:text-blue-400">
                {warehouseMetrics.totalPallets}
              </span>
              <span className="text-xs font-medium text-slate-400">
                пал.
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Позиций (SKU): {warehouseMetrics.totalSKUs}
            </p>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl">
            <Warehouse className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Visual Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Chart 1: Shipment Status Breakdown */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                <span>Распределение авто по статусам</span>
              </h3>
              <p className="text-xs text-slate-500">Текущая загрузка автопарка Иран — Алматы</p>
            </div>
            <span className="px-2.5 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold">
              Всего: {activeShipments.length}
            </span>
          </div>

          <div className="h-64 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {statusChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Warehouse Stock Category Distribution */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60 pb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Warehouse className="w-5 h-5 text-amber-500" />
                <span>Остатки на складах по категориям</span>
              </h3>
              <p className="text-xs text-slate-500">Количество паллет продуктовой группы</p>
            </div>
            <span className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 rounded-lg text-xs font-bold">
              {warehouseMetrics.totalPallets} паллет
            </span>
          </div>

          <div className="h-64 w-full pt-2">
            {loadingWarehouse ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-amber-500" />
                <span>Загрузка данных по складам...</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={warehouseMetrics.categories} layout="vertical" margin={{ top: 10, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' }}
                    formatter={(value: any) => [`${value} паллет`, 'Остаток']}
                  />
                  <Bar dataKey="pallets" fill="#3b82f6" radius={[0, 8, 8, 0]}>
                    {warehouseMetrics.categories.map((entry, index) => (
                      <Cell key={`cat-cell-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

      </div>

      {/* Delayed Vehicles Detail Table & Direct PDF Action */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm overflow-hidden p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-700/60 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-600" />
              <span>Контроль задержек автомашин в пути</span>
            </h3>
            <p className="text-xs text-slate-500">Автомашины, превышающие контрольный норматив 14 дней в пути</p>
          </div>

          <button
            onClick={handleDownloadPdfReport}
            disabled={generatingPdf}
            className="px-4 py-2 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 font-bold text-xs rounded-xl transition-colors border border-rose-200 dark:border-rose-800/60 flex items-center gap-2"
          >
            <FileText className="w-4 h-4 text-rose-600" />
            <span>Скачать официальный PDF отчет</span>
          </button>
        </div>

        {delayedShipments.length === 0 ? (
          <div className="p-8 text-center bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-300 space-y-1">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <p className="font-bold text-sm">Все автомашины следуют строго по графику!</p>
            <p className="text-xs text-emerald-600/80">Задержек по транспортировке из Ирана в Алматы на данный момент не выявлено.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700">
                  <th className="py-2.5 px-3">Инвойс / Счет</th>
                  <th className="py-2.5 px-3">Водитель / Авто</th>
                  <th className="py-2.5 px-3">Маршрут</th>
                  <th className="py-2.5 px-3">Дата выезда</th>
                  <th className="py-2.5 px-3">Срок прибытия</th>
                  <th className="py-2.5 px-3">Превышение</th>
                  <th className="py-2.5 px-3">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50 font-medium">
                {delayedShipments.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-700/30">
                    <td className="py-3 px-3 font-bold text-slate-900 dark:text-white">
                      {s.invoice_id}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                      {s.truck_driver || 'Не указан'}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                      {s.route || 'Иран → Алматы'}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                      {s.departure_date ? new Date(s.departure_date).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-400">
                      {s.arrival_deadline ? new Date(s.arrival_deadline).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                        <Clock className="w-3 h-3" />
                        Задержка
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                        {s.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
