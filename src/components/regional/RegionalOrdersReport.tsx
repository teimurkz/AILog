import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import type { RegionalTruckOrder } from '../../types';
import { buildRegionalOrdersReport, regionalReportDate, type RegionalReportFilters } from '../../../shared/regional-orders-report';
import { useSectionText } from '../../i18n/useSectionText';
import { REGIONAL_TEXT, formatRegionalDay, localizeReportError, localizeReportRoute } from './regional-i18n';
import { ResponsiveTable } from '../common/ResponsiveTable';
import { DataLoadNotice } from '../common/DataLoadNotice';

export function RegionalOrdersReport({ orders, loading, error, onRetry, onClose }: {
  orders: RegionalTruckOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { text, language, locale, isRTL } = useSectionText(REGIONAL_TEXT);
  const r = text.report;
  const day = (date: string) => date ? formatRegionalDay(date, locale) : text.common.notSpecifiedDate;
  const count = (value: number) => value.toLocaleString(locale);
  const dialog = useRef<HTMLDialogElement>(null);
  const [filters, setFilters] = useState<RegionalReportFilters>({ status: 'all' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const { report, validationError } = useMemo(() => {
    try { return { report: buildRegionalOrdersReport(orders, filters), validationError: '' }; }
    catch (e) { return { report: null, validationError: localizeReportError(e instanceof Error ? e.message : '', text) }; }
  }, [orders, filters, text]);
  const cities = useMemo(() => buildRegionalOrdersReport(orders).destinations, [orders]);
  const set = (patch: Partial<RegionalReportFilters>) => { setFilters(value => ({ ...value, ...patch })); setExportError(''); };
  const chooseMonth = (previous: boolean) => {
    const today = regionalReportDate(new Date().toISOString());
    const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7)) - 1;
    const start = new Date(Date.UTC(year, month - Number(previous), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    set({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
  };
  const download = async () => {
    if (!report || !report.total || loading || error || exporting) return;
    setExporting(true); setExportError('');
    try {
      const { downloadRegionalReport } = await import('../../utils/regional-report-excel');
      downloadRegionalReport(report, filters, language);
    } catch { setExportError(r.exportFailed); }
    finally { setExporting(false); }
  };
  return <dialog ref={dialog} aria-labelledby="regional-report-title" dir={isRTL ? 'rtl' : 'ltr'}
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="regional-report-dialog fixed inset-0 m-auto w-[calc(100%-24px)] max-w-6xl max-h-[90dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:text-white">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="min-w-0">
        <h2 id="regional-report-title" className="flex items-center gap-2 text-lg font-semibold"><FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-600" />{r.title}</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{r.subtitle}</p>
      </div>
      <button type="button" onClick={onClose} aria-label={r.closeReport} className="shrink-0 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
    </header>
    <div className="space-y-5 p-5">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="min-w-0 text-xs font-medium">{r.from}
          <input type="date" value={filters.from || ''} onChange={e => set({ from: e.target.value })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="min-w-0 text-xs font-medium">{r.to}
          <input type="date" value={filters.to || ''} onChange={e => set({ to: e.target.value })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="min-w-0 text-xs font-medium">{r.destination}
          <select aria-label={r.destination} value={filters.destination || ''} onChange={e => set({ destination: e.target.value })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="">{r.allCities}</option>{cities.map(city => <option key={city} value={city}>{city}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">{r.tripStatus}
          <select aria-label={r.tripStatus} value={filters.status || 'all'} onChange={e => set({ status: e.target.value as RegionalReportFilters['status'] })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="all">{r.statusAll}</option><option value="dispatched">{r.dispatched}</option><option value="delivered">{r.delivered}</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={() => set({ from: '', to: '' })} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-600">{r.allTime}</button>
        <button type="button" onClick={() => chooseMonth(false)} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-600">{r.thisMonth}</button>
        <button type="button" onClick={() => chooseMonth(true)} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-600">{r.lastMonth}</button>
        <button type="button" onClick={() => setFilters({ status: 'all' })} className="px-2 py-2 text-blue-600 dark:text-blue-400">{r.resetFilters}</button>
      </div>
      <DataLoadNotice loading={loading} error={error} onRetry={onRetry} />
      {(validationError || exportError) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{validationError || exportError}</p>}
      {report && !loading && !error && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            [r.sent, report.total], [r.dispatched, report.dispatched],
            [r.delivered, report.delivered], [r.directionsCount, report.directions.length],
          ].map(([title, value]) => <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">{title}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{count(Number(value))}</p>
          </div>)}
        </div>
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p>{r.ruleTrips}</p>
          <p>{r.rulePeriod}</p>
          {report.shipmentDates > 0 && <p className="text-amber-700 dark:text-amber-300">{r.shipmentDatesNote(report.shipmentDates)}</p>}
          {report.undated > 0 && <p className="text-amber-700 dark:text-amber-300">{r.undatedNote(report.undated)}</p>}
          {report.undatedExcluded > 0 && <p className="text-amber-700 dark:text-amber-300">{r.undatedExcludedNote(report.undatedExcluded)}</p>}
        </div>
        {report.total === 0 ? <p className="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">{r.empty}</p> : <>
          <section aria-labelledby="regional-report-directions">
            <h3 id="regional-report-directions" className="mb-2 font-semibold">{r.directionsTitle}</h3>
            <ResponsiveTable>
              <thead><tr><th>{r.direction}</th><th>{r.trucks}</th><th>{r.dispatched}</th><th>{r.delivered}</th><th>{r.firstDispatch}</th><th>{r.lastDispatch}</th></tr></thead>
              <tbody>{report.directions.map(group => <tr key={group.route} className="border-t border-slate-200 dark:border-slate-700">
                <td>{localizeReportRoute(group.route, text)}</td><td className="font-semibold">{count(group.count)}</td><td>{count(group.dispatched)}</td><td>{count(group.delivered)}</td>
                <td>{day(group.firstDate)}</td><td>{day(group.lastDate)}</td>
              </tr>)}</tbody>
            </ResponsiveTable>
          </section>
          <section aria-labelledby="regional-report-trips">
            <h3 id="regional-report-trips" className="mb-2 font-semibold">{r.tripsTitle}</h3>
            <ResponsiveTable>
              <thead><tr><th>{r.dispatchDate}</th><th>{r.orderNo}</th><th>{r.direction}</th><th>{r.plate}</th><th>{r.driver}</th><th>{r.status}</th></tr></thead>
              <tbody>{report.rows.map(row => <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
                <td>{day(row.date)}{row.dateSource === 'shipment' && <span className="block text-xs text-amber-700 dark:text-amber-300">{r.byShipmentDate}</span>}</td>
                <td className="font-mono">{row.orderNumber}</td><td>{localizeReportRoute(row.route, text)}</td><td>{row.plate || text.common.notSpecified}</td><td>{row.driver || text.common.notSpecified}</td><td>{row.status === 'delivered' ? r.delivered : r.dispatched}</td>
              </tr>)}</tbody>
            </ResponsiveTable>
          </section>
        </>}
      </>}
    </div>
    <footer className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">{text.common.close}</button>
      <button type="button" onClick={() => void download()} disabled={!report?.total || loading || !!error || exporting}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
        <Download className="h-4 w-4" />{exporting ? r.preparing : r.downloadExcel}
      </button>
    </footer>
  </dialog>;
}
