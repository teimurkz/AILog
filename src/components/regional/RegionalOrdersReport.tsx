import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, X } from 'lucide-react';
import type { RegionalTruckOrder } from '../../types';
import { buildRegionalOrdersReport, formatRegionalReportDate, regionalReportDate, type RegionalReportFilters } from '../../../shared/regional-orders-report';
import { ResponsiveTable } from '../common/ResponsiveTable';
import { DataLoadNotice } from '../common/DataLoadNotice';

export function RegionalOrdersReport({ orders, loading, error, onRetry, onClose }: {
  orders: RegionalTruckOrder[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [filters, setFilters] = useState<RegionalReportFilters>({ status: 'all' });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const { report, validationError } = useMemo(() => {
    try { return { report: buildRegionalOrdersReport(orders, filters), validationError: '' }; }
    catch (e) { return { report: null, validationError: e instanceof Error ? e.message : 'Проверьте период отчёта.' }; }
  }, [orders, filters]);
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
      downloadRegionalReport(report, filters);
    } catch { setExportError('Не удалось скачать отчёт. Повторите попытку.'); }
    finally { setExporting(false); }
  };
  return <dialog ref={dialog} aria-labelledby="regional-report-title"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="regional-report-dialog fixed inset-0 m-auto w-[calc(100%-24px)] max-w-6xl max-h-[90dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-800 dark:text-white">
    <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
      <div className="min-w-0">
        <h2 id="regional-report-title" className="flex items-center gap-2 text-lg font-semibold"><FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-600" />Отчёт по отправленным машинам</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Рейсы в регионы: даты, направления и количество машин.</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Закрыть отчёт" className="shrink-0 rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-5 w-5" /></button>
    </header>
    <div className="space-y-5 p-5">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="min-w-0 text-xs font-medium">С даты
          <input type="date" value={filters.from || ''} onChange={e => set({ from: e.target.value })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="min-w-0 text-xs font-medium">По дату
          <input type="date" value={filters.to || ''} onChange={e => set({ to: e.target.value })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900" />
        </label>
        <label className="min-w-0 text-xs font-medium">Город назначения
          <select aria-label="Город назначения" value={filters.destination || ''} onChange={e => set({ destination: e.target.value })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="">Все города</option>{cities.map(city => <option key={city} value={city}>{city}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-medium">Статус рейса
          <select aria-label="Статус рейса" value={filters.status || 'all'} onChange={e => set({ status: e.target.value as RegionalReportFilters['status'] })} className="mt-1 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900">
            <option value="all">В пути и доставлено</option><option value="dispatched">В пути</option><option value="delivered">Доставлено</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={() => set({ from: '', to: '' })} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-600">За всё время</button>
        <button type="button" onClick={() => chooseMonth(false)} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-600">Этот месяц</button>
        <button type="button" onClick={() => chooseMonth(true)} className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-600">Прошлый месяц</button>
        <button type="button" onClick={() => setFilters({ status: 'all' })} className="px-2 py-2 text-blue-600 dark:text-blue-400">Сбросить фильтры</button>
      </div>
      <DataLoadNotice loading={loading} error={error} onRetry={onRetry} />
      {(validationError || exportError) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{validationError || exportError}</p>}
      {report && !loading && !error && <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Отправлено машин (рейсов)', report.total], ['В пути', report.dispatched],
            ['Доставлено', report.delivered], ['Направлений', report.directions.length],
          ].map(([title, value]) => <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <p className="text-xs text-slate-500 dark:text-slate-400">{title}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>)}
        </div>
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          <p>Одна заявка — один рейс. Учитываются машины в пути и доставленные; новые, на погрузке и отменённые заявки не входят в итог. Даты: время Алматы.</p>
          <p>Период определяется по фактической дате отправки; если она не сохранена — по дате отгрузки из заявки.</p>
          {report.shipmentDates > 0 && <p className="text-amber-700 dark:text-amber-300">У {report.shipmentDates} рейсов нет фактической даты отправки: использована дата отгрузки из заявки, отмеченная в списке и Excel.</p>}
          {report.undated > 0 && <p className="text-amber-700 dark:text-amber-300">Без даты отправки: {report.undated}. Они учтены в общем количестве за всё время.</p>}
          {report.undatedExcluded > 0 && <p className="text-amber-700 dark:text-amber-300">В выбранный период не включены {report.undatedExcluded} рейсов без даты. Для просмотра выберите «За всё время».</p>}
        </div>
        {report.total === 0 ? <p className="rounded-lg border border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">За выбранный период и направление отправленных машин нет.</p> : <>
          <section aria-labelledby="regional-report-directions">
            <h3 id="regional-report-directions" className="mb-2 font-semibold">Сводка по направлениям</h3>
            <ResponsiveTable>
              <thead><tr><th>Направление</th><th>Машин (рейсов)</th><th>В пути</th><th>Доставлено</th><th>Первая отправка</th><th>Последняя отправка</th></tr></thead>
              <tbody>{report.directions.map(group => <tr key={group.route} className="border-t border-slate-200 dark:border-slate-700">
                <td>{group.route}</td><td className="font-semibold">{group.count}</td><td>{group.dispatched}</td><td>{group.delivered}</td>
                <td>{formatRegionalReportDate(group.firstDate)}</td><td>{formatRegionalReportDate(group.lastDate)}</td>
              </tr>)}</tbody>
            </ResponsiveTable>
          </section>
          <section aria-labelledby="regional-report-trips">
            <h3 id="regional-report-trips" className="mb-2 font-semibold">Отправленные машины</h3>
            <ResponsiveTable>
              <thead><tr><th>Дата отправки</th><th>№ заявки</th><th>Направление</th><th>Госномер</th><th>Водитель</th><th>Статус</th></tr></thead>
              <tbody>{report.rows.map(row => <tr key={row.id} className="border-t border-slate-200 dark:border-slate-700">
                <td>{formatRegionalReportDate(row.date)}{row.dateSource === 'shipment' && <span className="block text-xs text-amber-700 dark:text-amber-300">По дате отгрузки в заявке</span>}</td>
                <td className="font-mono">{row.orderNumber}</td><td>{row.route}</td><td>{row.plate || 'Не указан'}</td><td>{row.driver || 'Не указан'}</td><td>{row.status === 'delivered' ? 'Доставлено' : 'В пути'}</td>
              </tr>)}</tbody>
            </ResponsiveTable>
          </section>
        </>}
      </>}
    </div>
    <footer className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600">Закрыть</button>
      <button type="button" onClick={() => void download()} disabled={!report?.total || loading || !!error || exporting}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
        <Download className="h-4 w-4" />{exporting ? 'Готовим Excel…' : 'Скачать Excel'}
      </button>
    </footer>
  </dialog>;
}
