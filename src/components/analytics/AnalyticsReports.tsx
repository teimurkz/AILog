import { firebaseFetch, downloadFirebaseFile } from '../../services/firebase-fetch';
import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3, FileText, RefreshCw, Clock, Truck, Warehouse, CheckCircle2, FileSpreadsheet, Send, PackageCheck,
  Timer, ShieldCheck, Download, ChevronDown,
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend } from 'recharts';
import { useShipments } from '../../hooks/useShipments';
import { useTruckTracking, useTruckTrackingStages } from '../../hooks/useTruckTracking';
import { DataLoadNotice } from '../common/DataLoadNotice';
import { useLanguage } from '../../contexts/LanguageContext';
import { useAuth } from '../../contexts/AuthContext';
import { generateDelayReport } from '../../utils/reports';
import { isShipmentDelayed } from '../../utils/shipmentUtils';
import { downloadReports, type ReportTable } from '../../utils/work-reports-excel';
import { stageLabel } from '../../../shared/truck-tracking';
import {
  formatDay, onTheRoad, periodSummary, productsShipped, routeTimes, svhQueue, todayDay, trackingReport, weeklyFlow, withoutDocuments,
} from '../../../shared/work-reports';
import { WarehouseResponse } from '../../types';

const DAY = 86400000;
const shiftDay = (day: string, days: number) => new Date(Date.parse(day + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
const PRESETS: { id: string; label: string; range: (today: string) => [string, string] }[] = [
  { id: '7', label: '7 дней', range: today => [shiftDay(today, -6), today] },
  { id: '30', label: '30 дней', range: today => [shiftDay(today, -29), today] },
  { id: 'month', label: 'Этот месяц', range: today => [today.slice(0, 8) + '01', today] },
  { id: 'last-month', label: 'Прошлый месяц', range: today => {
    const end = shiftDay(today.slice(0, 8) + '01', -1);
    return [end.slice(0, 8) + '01', end];
  } },
  { id: '90', label: '90 дней', range: today => [shiftDay(today, -89), today] },
];
const days = (value: number | null) => value === null ? '—' : `${value} дн.`;
const card = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm';
const tooltip = { backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px' };

const Kpi = ({ icon: Icon, label, value, note, tone }: { icon: typeof Truck; label: string; value: React.ReactNode; note: string; tone: string }) => (
  <div className={`${card} p-4 flex items-start justify-between gap-3`}>
    <div className="min-w-0">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{value}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{note}</p>
    </div>
    <div className={`p-2.5 rounded-xl shrink-0 ${tone}`}><Icon className="w-5 h-5" /></div>
  </div>
);

/** A report table with its own Excel download; long lists open on demand. */
const ReportCard = ({ table, subtitle, icon: Icon, empty, highlight, period }: {
  table: ReportTable; subtitle: string; icon: typeof Truck; empty: string; highlight?: (row: ReportTable['rows'][number]) => boolean; period: { from: string; to: string };
}) => {
  const [all, setAll] = useState(false);
  const rows = all ? table.rows : table.rows.slice(0, 8);
  return (
    <div className={`${card} p-4 space-y-3 min-w-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Icon className="w-4 h-4 text-blue-600 shrink-0" />{table.title}
            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px]">{table.rows.length}</span></h3>
          <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
        </div>
        <button type="button" disabled={!table.rows.length} onClick={() => downloadReports([table], period, table.title)} title="Скачать этот отчёт в Excel"
          className="shrink-0 p-2 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"><Download className="w-4 h-4" /></button>
      </div>
      {!table.rows.length ? <p className="text-xs text-slate-400 py-4 text-center">{empty}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-left text-xs">
          <thead><tr className="text-slate-500 border-b border-slate-200">{table.header.map(title => <th key={title} className="py-2 px-2 font-semibold whitespace-nowrap">{title}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, index) => (
              <tr key={index} className={highlight?.(row) ? 'bg-rose-50/70 text-rose-900' : 'text-slate-700'}>
                {row.map((cell, column) => <td key={column} className={`py-2 px-2 ${column === 0 ? 'font-semibold' : ''}`}>{cell ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {table.rows.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
          {all ? 'Свернуть' : `Показать все (${table.rows.length})`}<ChevronDown className={`w-3.5 h-3.5 ${all ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
};

export const AnalyticsReports: React.FC = () => {
  const { t, language } = useLanguage();
  const { canView } = useAuth();
  const { shipments, loading: loadingShipments, error: shipmentsError, retry: retryShipments } = useShipments();
  const { stages } = useTruckTrackingStages();
  const { entries } = useTruckTracking(stages);
  const [warehouseData, setWarehouseData] = useState<WarehouseResponse | null>(null);
  const [loadingWarehouse, setLoadingWarehouse] = useState<boolean>(true);
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);
  const today = todayDay();
  const [preset, setPreset] = useState('30');
  const [period, setPeriod] = useState(() => { const [from, to] = PRESETS[1].range(today); return { from, to }; });
  const [route, setRoute] = useState('');

  const fetchWarehouseData = async () => {
    setLoadingWarehouse(true);
    try {
      const res = await firebaseFetch('/api/warehouses');
      if (res.ok) setWarehouseData(await res.json());
    } catch (err) {
      console.error('Failed to load warehouse data for analytics:', err);
    } finally {
      setLoadingWarehouse(false);
    }
  };
  useEffect(() => { fetchWarehouseData(); }, []);

  const handleDownloadPdfReport = async () => {
    setGeneratingPdf(true);
    try { await generateDelayReport(shipments, t); }
    catch (err) { console.error('Failed to generate PDF report:', err); }
    finally { setGeneratingPdf(false); }
  };
  const choosePreset = (id: string) => {
    const [from, to] = PRESETS.find(item => item.id === id)!.range(today);
    setPreset(id); setPeriod({ from, to });
  };
  const changeDate = (field: 'from' | 'to', value: string) => {
    if (!value) return;
    setPreset(''); setPeriod(old => ({ ...old, [field]: value }));
  };

  const routes = useMemo(() => [...new Set(shipments.map(s => s.route).filter(Boolean))].sort(), [shipments]);
  const range = useMemo(() => ({ from: period.from <= period.to ? period.from : period.to, to: period.from <= period.to ? period.to : period.from, route: route || undefined }), [period, route]);
  const byRoute = useMemo(() => route ? shipments.filter(s => s.route === route) : shipments, [shipments, route]);
  const summary = useMemo(() => periodSummary(shipments, range), [shipments, range]);
  const weeks = useMemo(() => weeklyFlow(shipments, range).map(week => ({ ...week, label: formatDay(week.week).slice(0, 5) })), [shipments, range]);

  // Current state (not limited by the period).
  const activeShipments = useMemo(() => byRoute.filter(s => !s.isArchived && s.status !== 'Delivered'), [byRoute]);
  const statusChartData = useMemo(() => {
    const delayed = activeShipments.filter(isShipmentDelayed).length;
    return [
      { name: 'В пути', value: activeShipments.filter(s => s.status === 'In Transit').length, color: '#3b82f6' },
      { name: 'Таможня', value: activeShipments.filter(s => s.status === 'Customs').length, color: '#8b5cf6' },
      { name: 'Задержка', value: delayed, color: '#ef4444' },
    ];
  }, [activeShipments]);

  const tables = useMemo(() => {
    const queue = svhQueue(byRoute, today);
    const road = onTheRoad(byRoute, today);
    const tracking = trackingReport(entries, stages);
    const stageName = (id: string) => { const stage = stages.find(item => item.id === id); return stage ? stageLabel(stage, language as any) : id; };
    const result: Record<string, ReportTable> = {
      queue: { title: 'На СВХ сейчас', header: ['Инвойс', 'Маршрут', 'Приход на СВХ', 'Дней на СВХ'],
        rows: queue.map(row => [row.invoice, row.route, formatDay(row.since), row.days]) },
      road: { title: 'В пути', header: ['Инвойс', 'Маршрут', 'Загрузка', 'Дней в пути', 'Норма', 'Сверх нормы'],
        rows: road.map(row => [row.invoice, row.route, formatDay(row.since), row.days, row.planned, row.over || null]) },
      routes: { title: 'Сроки по маршрутам', header: ['Маршрут', 'Отправлено', 'Прибыло', 'В пути, ср.', 'мин.', 'макс.', 'Растаможка, ср.'],
        rows: routeTimes(shipments, range).map(row => [row.route, row.sent, row.arrived, row.avgTransit, row.minTransit, row.maxTransit, row.avgCustoms]) },
      weeks: { title: 'По неделям', header: ['Неделя с', 'Отправлено', 'Прибыло на СВХ', 'Выгружено'],
        rows: weeks.map(week => [formatDay(week.week), week.sent, week.arrived, week.unloaded]) },
      products: { title: 'Товары за период', header: ['Товар', 'Машин'],
        rows: productsShipped(shipments, range).map(row => [row.product, row.trucks]) },
      documents: { title: 'Без документов', header: ['Инвойс', 'Маршрут', 'Загрузка'],
        rows: withoutDocuments(byRoute).map(row => [row.invoice, row.route, formatDay(row.start) || null]) },
      stages: { title: 'Слежка авто: этапы', header: ['Этап', 'Машин', 'Дней на этапе, ср.', 'Простаивают'],
        rows: tracking.rows.map(row => [stageName(row.stageId), row.trucks, row.avgDays, row.idle]) },
      idle: { title: 'Слежка авто: простой', header: ['Инвойс', 'Товар', 'Этап', 'Дней'],
        rows: tracking.idle.map(row => [row.invoice, row.productName, stageName(row.stageId), row.days]) },
    };
    return result;
  }, [byRoute, shipments, range, weeks, entries, stages, language, today]);

  const showTracking = canView('truck-tracking');
  const exportAll = () => downloadReports([
    { title: 'Сводка', header: ['Показатель', 'Значение'], rows: [
      ['Период', `${formatDay(range.from)} — ${formatDay(range.to)}`], ['Маршрут', route || 'Все'],
      ['Отправлено (загружено)', summary.sent], ['Прибыло на СВХ', summary.arrived], ['Выгружено', summary.unloaded],
      ['Время в пути, ср. дней', summary.avgTransit], ['Время в пути, макс. дней', summary.maxTransit],
      ['Растаможка, ср. дней', summary.avgCustoms], ['Прибыли в срок, %', summary.onTime],
    ] },
    tables.weeks, tables.routes, tables.products, tables.queue, tables.road, tables.documents,
    ...(showTracking ? [tables.stages, tables.idle] : []),
  ], range);

  // Warehouse stock per product group (pallets).
  const warehouseMetrics = useMemo(() => {
    if (!warehouseData?.warehouses) return { totalPallets: 0, totalSKUs: 0, categories: [] as { name: string; pallets: number }[] };
    let totalPallets = 0, totalSKUs = 0;
    const groups: Record<string, number> = { 'Сливочное масло': 0, 'Сыры': 0, 'Сливки': 0, 'Мороженое': 0, 'Прочая продукция': 0 };
    for (const wh of warehouseData.warehouses) {
      if (wh.isArchive) continue;
      totalPallets += wh.totalPalletsNumeric || 0;
      for (const item of wh.items) {
        totalSKUs++;
        const name = (item.product || '').toLowerCase();
        const pallets = parseFloat(String(item.palletCount).replace(/,/g, '.')) || 1;
        const group = name.includes('масло') || name.includes('butter') ? 'Сливочное масло'
          : name.includes('сыр') || name.includes('cheese') ? 'Сыры'
          : name.includes('сливк') || name.includes('cream') ? 'Сливки'
          : name.includes('морож') || name.includes('ice') ? 'Мороженое' : 'Прочая продукция';
        groups[group] += pallets;
      }
    }
    return { totalPallets: Math.round(totalPallets * 10) / 10, totalSKUs,
      categories: Object.entries(groups).map(([name, value]) => ({ name, pallets: Math.round(value * 10) / 10 })) };
  }, [warehouseData]);
  const CATEGORY_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#64748b'];

  if (loadingShipments || shipmentsError) return <DataLoadNotice loading={loadingShipments} error={shipmentsError} onRetry={retryShipments} />;

  const input = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800';
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="crm-page-header relative">
        <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="crm-eyebrow inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 rounded-full text-xs font-semibold text-blue-300 border border-blue-400/20">
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" /><span>Центр аналитики и отчётности</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Аналитика и отчёты</h2>
            <p className="text-sm text-slate-300 max-w-2xl">Отправки, сроки в пути и растаможки, очередь на СВХ, простой фур и остатки складов — за выбранный период, с выгрузкой в Excel.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={exportAll}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/40 border border-emerald-500/30">
              <FileSpreadsheet className="w-4 h-4" /><span>Все отчёты (Excel)</span>
            </button>
            <button onClick={handleDownloadPdfReport} disabled={generatingPdf}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-rose-950/40 border border-rose-500/30 disabled:opacity-50">
              <FileText className="w-4 h-4" /><span>{generatingPdf ? 'Создание PDF...' : 'Задержки (PDF)'}</span>
            </button>
            <button type="button" onClick={() => void downloadFirebaseFile('/api/mailing/download-excel', 'warehouse_report.xlsx').catch(error => alert(error.message))}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 border border-slate-700">
              <Warehouse className="w-4 h-4" /><span>Склады (Excel)</span>
            </button>
            <button onClick={() => { fetchWarehouseData(); retryShipments(); }} title="Обновить аналитику"
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors border border-slate-700">
              <RefreshCw className={`w-4 h-4 ${loadingWarehouse ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
        {PRESETS.map(item => (
          <button key={item.id} type="button" onClick={() => choosePreset(item.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${preset === item.id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{item.label}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">с<input type="date" className={input} value={period.from} max={today} onChange={event => changeDate('from', event.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">по<input type="date" className={input} value={period.to} max={today} onChange={event => changeDate('to', event.target.value)} /></label>
        <select className={input} value={route} onChange={event => setRoute(event.target.value)} aria-label="Маршрут">
          <option value="">Все маршруты</option>
          {routes.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Send} label="Отправлено" value={summary.sent} note="загружено за период" tone="bg-blue-50 text-blue-600" />
        <Kpi icon={Truck} label="Прибыло на СВХ" value={summary.arrived} note="приход на конечный СВХ" tone="bg-violet-50 text-violet-600" />
        <Kpi icon={PackageCheck} label="Выгружено" value={summary.unloaded} note="выгрузка за период" tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Timer} label="В пути, ср." value={days(summary.avgTransit)} note={summary.maxTransit !== null ? `максимум ${summary.maxTransit} дн.` : 'нет прибывших'} tone="bg-amber-50 text-amber-600" />
        <Kpi icon={Clock} label="Растаможка, ср." value={days(summary.avgCustoms)} note="от прихода на СВХ до выгрузки" tone="bg-purple-50 text-purple-600" />
        <Kpi icon={ShieldCheck} label="Прибыли в срок" value={summary.onTime === null ? '—' : `${summary.onTime}%`} note={summary.onTimeOf ? `из ${summary.onTimeOf} с нормой срока` : 'нет данных о норме'} tone="bg-teal-50 text-teal-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className={`${card} p-5 space-y-3 xl:col-span-2`}>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Поток по неделям</h3>
            <p className="text-xs text-slate-500">Сколько машин загружено, прибыло на СВХ и выгружено каждую неделю</p>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltip} labelFormatter={label => `Неделя с ${label}`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sent" name="Отправлено" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="arrived" name="Прибыло на СВХ" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="unloaded" name="Выгружено" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Сейчас в работе</h3>
              <p className="text-xs text-slate-500">Активные отправления по статусам</p>
            </div>
            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">{activeShipments.length}</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltip} />
                <Bar dataKey="value" name="Машин" radius={[8, 8, 0, 0]}>
                  {statusChartData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ReportCard table={tables.queue} icon={Clock} period={range} subtitle="Пришли на конечный СВХ, ещё не выгружены. 5 дней и больше — красным." empty="На СВХ никто не ждёт выгрузки." highlight={row => Number(row[3]) >= 5} />
        <ReportCard table={tables.road} icon={Truck} period={range} subtitle="Загружены, ещё не на СВХ. Превысившие норму срока — сверху и красным." empty="Машин в пути нет." highlight={row => Number(row[5]) > 0} />
        <ReportCard table={tables.routes} icon={Send} period={range} subtitle="Дни от загрузки до прихода на СВХ и от прихода до выгрузки, за период" empty="За период нет отправок." />
        <ReportCard table={tables.products} icon={PackageCheck} period={range} subtitle="В скольких машинах шёл товар, загруженных за период" empty="За период нет загруженных машин." />
        {showTracking && <ReportCard table={tables.stages} icon={Truck} period={range} subtitle="Фуры на нашем СВХ по этапам «Слежки авто» (сейчас)" empty="В «Слежке авто» нет фур." highlight={row => Number(row[3]) > 0} />}
        {showTracking && <ReportCard table={tables.idle} icon={Clock} period={range} subtitle="Стоят на этапе дольше срока простоя, заданного в «Этапах»" empty="Простаивающих фур нет." highlight={() => true} />}
        <ReportCard table={tables.documents} icon={FileText} period={range} subtitle="Активные отправления, к которым ещё не пришли документы" empty="У всех активных отправлений есть документы." />
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Warehouse className="w-4 h-4 text-amber-500" />Остатки на складах</h3>
              <p className="text-xs text-slate-500">Паллет по группам товаров · позиций: {warehouseMetrics.totalSKUs}</p>
            </div>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold">{warehouseMetrics.totalPallets} пал.</span>
          </div>
          <div className="h-56 w-full">
            {loadingWarehouse ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs gap-2"><RefreshCw className="w-4 h-4 animate-spin text-amber-500" />Загрузка данных по складам...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={warehouseMetrics.categories} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip contentStyle={tooltip} formatter={(value: any) => [`${value} паллет`, 'Остаток']} />
                  <Bar dataKey="pallets" radius={[0, 8, 8, 0]}>
                    {warehouseMetrics.categories.map((entry, index) => <Cell key={entry.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
      {!summary.sent && !summary.arrived && !summary.unloaded && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />За выбранный период нет загрузок, приходов и выгрузок. Выберите другой период.</p>
      )}
    </div>
  );
};
