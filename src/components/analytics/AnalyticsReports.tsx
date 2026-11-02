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
  formatDay, NO_ROUTE, onTheRoad, periodSummary, productsShipped, routeTimes, svhQueue, todayDay, trackingReport, weeklyFlow, withoutDocuments,
} from '../../../shared/work-reports';
import { WarehouseResponse } from '../../types';
import { useSectionText } from '../../i18n/useSectionText';
import { ANALYTICS_TEXTS } from './analytics-i18n';

const DAY = 86400000;
const shiftDay = (day: string, days: number) => new Date(Date.parse(day + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10);
type PresetId = keyof typeof ANALYTICS_TEXTS.ru.presets;
const PRESETS: { id: PresetId; range: (today: string) => [string, string] }[] = [
  { id: '7', range: today => [shiftDay(today, -6), today] },
  { id: '30', range: today => [shiftDay(today, -29), today] },
  { id: 'month', range: today => [today.slice(0, 8) + '01', today] },
  { id: 'last-month', range: today => {
    const end = shiftDay(today.slice(0, 8) + '01', -1);
    return [end.slice(0, 8) + '01', end];
  } },
  { id: '90', range: today => [shiftDay(today, -89), today] },
];
type StockGroup = keyof typeof ANALYTICS_TEXTS.ru.stock.groups;
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
  const { text, isRTL } = useSectionText(ANALYTICS_TEXTS);
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
        <button type="button" disabled={!table.rows.length} onClick={() => downloadReports([table], period, table.title, isRTL)} title={text.downloadOne} aria-label={text.downloadOne}
          className="shrink-0 p-2 rounded-lg border border-slate-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"><Download className="w-4 h-4" /></button>
      </div>
      {!table.rows.length ? <p className="text-xs text-slate-400 py-4 text-center">{empty}</p> : (
        <div className="overflow-x-auto"><table className="w-full text-start text-xs">
          <thead><tr className="text-slate-500 border-b border-slate-200">{table.header.map(title => <th key={title} className="py-2 px-2 font-semibold whitespace-nowrap text-start">{title}</th>)}</tr></thead>
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
          {all ? text.collapse : text.showAll(table.rows.length)}<ChevronDown className={`w-3.5 h-3.5 ${all ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
};

export const AnalyticsReports: React.FC = () => {
  const { t } = useLanguage();
  const { text, language, locale, isRTL } = useSectionText(ANALYTICS_TEXTS);
  const { canView } = useAuth();
  const { shipments, loading: loadingShipments, error: shipmentsError, retry: retryShipments } = useShipments();
  const { stages } = useTruckTrackingStages();
  const { entries } = useTruckTracking(stages);
  const [warehouseData, setWarehouseData] = useState<WarehouseResponse | null>(null);
  const [loadingWarehouse, setLoadingWarehouse] = useState<boolean>(true);
  const [generatingPdf, setGeneratingPdf] = useState<boolean>(false);
  const today = todayDay();
  const [preset, setPreset] = useState<PresetId | ''>('30');
  const [period, setPeriod] = useState(() => { const [from, to] = PRESETS[1].range(today); return { from, to }; });
  const [route, setRoute] = useState('');
  const days = (value: number | null) => value === null ? '—' : text.days(value);
  const routeName = (value: string) => value === NO_ROUTE ? text.noRoute : value;
  const shortDay = (day: string) => new Date(day + 'T00:00:00Z').toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

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
  const choosePreset = (id: PresetId) => {
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
  const weeks = useMemo(() => weeklyFlow(shipments, range).map(week => ({ ...week, label: shortDay(week.week) })), [shipments, range, locale]);

  // Current state (not limited by the period).
  const activeShipments = useMemo(() => byRoute.filter(s => !s.isArchived && s.status !== 'Delivered'), [byRoute]);
  const statusChartData = useMemo(() => {
    const delayed = activeShipments.filter(isShipmentDelayed).length;
    return [
      { name: text.status.transit, value: activeShipments.filter(s => s.status === 'In Transit').length, color: '#3b82f6' },
      { name: text.status.customs, value: activeShipments.filter(s => s.status === 'Customs').length, color: '#8b5cf6' },
      { name: text.status.delayed, value: delayed, color: '#ef4444' },
    ];
  }, [activeShipments, text]);

  const tables = useMemo(() => {
    const queue = svhQueue(byRoute, today);
    const road = onTheRoad(byRoute, today);
    const tracking = trackingReport(entries, stages);
    const stageName = (id: string) => { const stage = stages.find(item => item.id === id); return stage ? stageLabel(stage, language) : id; };
    const names = text.tables;
    const result: Record<keyof typeof names, ReportTable> = {
      queue: { title: names.queue.title, header: names.queue.header,
        rows: queue.map(row => [row.invoice, routeName(row.route), formatDay(row.since), row.days]) },
      road: { title: names.road.title, header: names.road.header,
        rows: road.map(row => [row.invoice, routeName(row.route), formatDay(row.since), row.days, row.planned, row.over || null]) },
      routes: { title: names.routes.title, header: names.routes.header,
        rows: routeTimes(shipments, range).map(row => [routeName(row.route), row.sent, row.arrived, row.avgTransit, row.minTransit, row.maxTransit, row.avgCustoms]) },
      weeks: { title: names.weeks.title, header: names.weeks.header,
        rows: weeks.map(week => [formatDay(week.week), week.sent, week.arrived, week.unloaded]) },
      products: { title: names.products.title, header: names.products.header,
        rows: productsShipped(shipments, range).map(row => [row.product, row.trucks]) },
      documents: { title: names.documents.title, header: names.documents.header,
        rows: withoutDocuments(byRoute).map(row => [row.invoice, routeName(row.route), formatDay(row.start) || null]) },
      stages: { title: names.stages.title, header: names.stages.header,
        rows: tracking.rows.map(row => [stageName(row.stageId), row.trucks, row.avgDays, row.idle]) },
      idle: { title: names.idle.title, header: names.idle.header,
        rows: tracking.idle.map(row => [row.invoice, row.productName, stageName(row.stageId), row.days]) },
    };
    return result;
  }, [byRoute, shipments, range, weeks, entries, stages, language, today, text]);

  const showTracking = canView('truck-tracking');
  const exportAll = () => {
    const sum = text.summary;
    downloadReports([
      { title: sum.title, header: sum.header, rows: [
        [sum.period, `${formatDay(range.from)} — ${formatDay(range.to)}`], [sum.route, route || sum.allRoutes],
        [sum.sent, summary.sent], [sum.arrived, summary.arrived], [sum.unloaded, summary.unloaded],
        [sum.avgTransit, summary.avgTransit], [sum.maxTransit, summary.maxTransit],
        [sum.avgCustoms, summary.avgCustoms], [sum.onTime, summary.onTime],
      ] },
      tables.weeks, tables.routes, tables.products, tables.queue, tables.road, tables.documents,
      ...(showTracking ? [tables.stages, tables.idle] : []),
    ], range, text.workbook, isRTL);
  };

  // Warehouse stock per product group (pallets).
  const warehouseMetrics = useMemo(() => {
    if (!warehouseData?.warehouses) return { totalPallets: 0, totalSKUs: 0, categories: [] as { id: StockGroup; pallets: number }[] };
    let totalPallets = 0, totalSKUs = 0;
    const groups: Record<StockGroup, number> = { butter: 0, cheese: 0, cream: 0, iceCream: 0, other: 0 };
    for (const wh of warehouseData.warehouses) {
      if (wh.isArchive) continue;
      totalPallets += wh.totalPalletsNumeric || 0;
      for (const item of wh.items) {
        totalSKUs++;
        const name = (item.product || '').toLowerCase();
        const pallets = parseFloat(String(item.palletCount).replace(/,/g, '.')) || 1;
        const group: StockGroup = name.includes('масло') || name.includes('butter') ? 'butter'
          : name.includes('сыр') || name.includes('cheese') ? 'cheese'
          : name.includes('сливк') || name.includes('cream') ? 'cream'
          : name.includes('морож') || name.includes('ice') ? 'iceCream' : 'other';
        groups[group] += pallets;
      }
    }
    return { totalPallets: Math.round(totalPallets * 10) / 10, totalSKUs,
      categories: (Object.entries(groups) as [StockGroup, number][]).map(([id, value]) => ({ id, pallets: Math.round(value * 10) / 10 })) };
  }, [warehouseData]);
  const stockChart = warehouseMetrics.categories.map(item => ({ ...item, name: text.stock.groups[item.id] }));
  const CATEGORY_COLORS = ['#3b82f6', '#f59e0b', '#ec4899', '#06b6d4', '#64748b'];

  if (loadingShipments || shipmentsError) return <DataLoadNotice loading={loadingShipments} error={shipmentsError} onRetry={retryShipments} />;

  const input = 'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800';
  const number = (value: number) => value.toLocaleString(locale);
  return (
    <div className="space-y-6 animate-fadeIn" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="crm-page-header relative">
        <div className="absolute top-0 end-0 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="crm-eyebrow inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 rounded-full text-xs font-semibold text-blue-300 border border-blue-400/20">
              <BarChart3 className="w-3.5 h-3.5 text-blue-400" /><span>{text.eyebrow}</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">{text.title}</h2>
            <p className="text-sm text-slate-300 max-w-2xl">{text.intro}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={exportAll}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/40 border border-emerald-500/30">
              <FileSpreadsheet className="w-4 h-4" /><span>{text.allReports}</span>
            </button>
            <button onClick={handleDownloadPdfReport} disabled={generatingPdf}
              className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-rose-950/40 border border-rose-500/30 disabled:opacity-50">
              <FileText className="w-4 h-4" /><span>{generatingPdf ? text.creatingPdf : text.delaysPdf}</span>
            </button>
            <button type="button" onClick={() => void downloadFirebaseFile('/api/mailing/download-excel', 'warehouse_report.xlsx').catch(error => alert(error.message))}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center gap-2 border border-slate-700">
              <Warehouse className="w-4 h-4" /><span>{text.warehousesExcel}</span>
            </button>
            <button onClick={() => { fetchWarehouseData(); retryShipments(); }} title={text.refresh} aria-label={text.refresh}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors border border-slate-700">
              <RefreshCw className={`w-4 h-4 ${loadingWarehouse ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
        {PRESETS.map(item => (
          <button key={item.id} type="button" onClick={() => choosePreset(item.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${preset === item.id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{text.presets[item.id]}</button>
        ))}
        <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">{text.from}<input type="date" className={input} value={period.from} max={today} onChange={event => changeDate('from', event.target.value)} /></label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">{text.to}<input type="date" className={input} value={period.to} max={today} onChange={event => changeDate('to', event.target.value)} /></label>
        <select className={input} value={route} onChange={event => setRoute(event.target.value)} aria-label={text.route}>
          <option value="">{text.allRoutes}</option>
          {routes.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Send} label={text.kpi.sent} value={number(summary.sent)} note={text.kpi.sentNote} tone="bg-blue-50 text-blue-600" />
        <Kpi icon={Truck} label={text.kpi.arrived} value={number(summary.arrived)} note={text.kpi.arrivedNote} tone="bg-violet-50 text-violet-600" />
        <Kpi icon={PackageCheck} label={text.kpi.unloaded} value={number(summary.unloaded)} note={text.kpi.unloadedNote} tone="bg-emerald-50 text-emerald-600" />
        <Kpi icon={Timer} label={text.kpi.transit} value={days(summary.avgTransit)} note={summary.maxTransit !== null ? text.kpi.transitMax(summary.maxTransit) : text.kpi.noArrivals} tone="bg-amber-50 text-amber-600" />
        <Kpi icon={Clock} label={text.kpi.customs} value={days(summary.avgCustoms)} note={text.kpi.customsNote} tone="bg-purple-50 text-purple-600" />
        <Kpi icon={ShieldCheck} label={text.kpi.onTime} value={summary.onTime === null ? '—' : (summary.onTime / 100).toLocaleString(locale, { style: 'percent' })} note={summary.onTimeOf ? text.kpi.onTimeOf(summary.onTimeOf) : text.kpi.noNorm} tone="bg-teal-50 text-teal-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className={`${card} p-5 space-y-3 xl:col-span-2`}>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">{text.weeklyTitle}</h3>
            <p className="text-xs text-slate-500">{text.weeklyNote}</p>
          </div>
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeks} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} reversed={isRTL} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} orientation={isRTL ? 'right' : 'left'} />
                <Tooltip contentStyle={tooltip} labelFormatter={label => text.weekOf(String(label))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="sent" name={text.kpi.sent} fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="arrived" name={text.kpi.arrived} fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="unloaded" name={text.kpi.unloaded} fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{text.nowTitle}</h3>
              <p className="text-xs text-slate-500">{text.nowNote}</p>
            </div>
            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">{number(activeShipments.length)}</span>
          </div>
          <div className="h-64 w-full" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} reversed={isRTL} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} orientation={isRTL ? 'right' : 'left'} />
                <Tooltip contentStyle={tooltip} />
                <Bar dataKey="value" name={text.trucks} radius={[8, 8, 0, 0]}>
                  {statusChartData.map(entry => <Cell key={entry.name} fill={entry.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <ReportCard table={tables.queue} icon={Clock} period={range} subtitle={text.tables.queue.subtitle} empty={text.tables.queue.empty} highlight={row => Number(row[3]) >= 5} />
        <ReportCard table={tables.road} icon={Truck} period={range} subtitle={text.tables.road.subtitle} empty={text.tables.road.empty} highlight={row => Number(row[5]) > 0} />
        <ReportCard table={tables.routes} icon={Send} period={range} subtitle={text.tables.routes.subtitle} empty={text.tables.routes.empty} />
        <ReportCard table={tables.products} icon={PackageCheck} period={range} subtitle={text.tables.products.subtitle} empty={text.tables.products.empty} />
        {showTracking && <ReportCard table={tables.stages} icon={Truck} period={range} subtitle={text.tables.stages.subtitle} empty={text.tables.stages.empty} highlight={row => Number(row[3]) > 0} />}
        {showTracking && <ReportCard table={tables.idle} icon={Clock} period={range} subtitle={text.tables.idle.subtitle} empty={text.tables.idle.empty} highlight={() => true} />}
        <ReportCard table={tables.documents} icon={FileText} period={range} subtitle={text.tables.documents.subtitle} empty={text.tables.documents.empty} />
        <div className={`${card} p-5 space-y-3`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2"><Warehouse className="w-4 h-4 text-amber-500" />{text.stock.title}</h3>
              <p className="text-xs text-slate-500">{text.stock.note(warehouseMetrics.totalSKUs)}</p>
            </div>
            <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-lg text-xs font-bold">{text.stock.pallets(number(warehouseMetrics.totalPallets))}</span>
          </div>
          <div className="h-56 w-full" dir="ltr">
            {loadingWarehouse ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs gap-2" dir={isRTL ? 'rtl' : 'ltr'}><RefreshCw className="w-4 h-4 animate-spin text-amber-500" />{text.stock.loading}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stockChart} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} reversed={isRTL} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} orientation={isRTL ? 'right' : 'left'} />
                  <Tooltip contentStyle={tooltip} formatter={(value: any) => [text.stock.palletsLong(number(Number(value))), text.stock.remaining]} />
                  <Bar dataKey="pallets" radius={isRTL ? [8, 0, 0, 8] : [0, 8, 8, 0]}>
                    {stockChart.map((entry, index) => <Cell key={entry.id} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
      {!summary.sent && !summary.arrived && !summary.unloaded && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />{text.nothingInPeriod}</p>
      )}
    </div>
  );
};
