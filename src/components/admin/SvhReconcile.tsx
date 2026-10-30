import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, HelpCircle, SearchX, Upload } from 'lucide-react';
import { useTruckTracking, useTruckTrackingStages } from '../../hooks/useTruckTracking';
import { formatDay, parsePartnerSheet, reconcile, type PartnerRow, type ReconcileRow, type ReconcileStatus } from '../../../shared/svh-reconcile';
import { todayDay } from '../../../shared/work-reports';
import { downloadReports, type ReportTable } from '../../utils/work-reports-excel';

const STATUS: Record<ReconcileStatus, { label: string; tone: string }> = {
  ok: { label: 'Совпадает', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  mismatch: { label: 'Расхождение', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  'not-found': { label: 'Нет в CRM', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  ambiguous: { label: 'Несколько в CRM', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  'no-invoice': { label: 'Без инвойса', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};
type Filter = 'all' | 'problems' | ReconcileStatus;
const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm';
const days = (value: number | null, open: boolean) => value === null ? '?' : `${value}${open ? '+' : ''}`;

/** Two dates in one cell: the partner's and ours, red when they differ. */
const DatePair = ({ partner, crm, compare }: { partner: PartnerRow['arrived']; crm?: string | null; compare: boolean }) => {
  const differs = compare && partner.day !== (crm || null) && (partner.day || crm);
  return (
    <div className="leading-tight whitespace-nowrap">
      <div className={partner.bad ? 'text-rose-700 font-semibold' : ''}>{partner.bad ? `«${partner.raw}»` : formatDay(partner.day) || '—'}</div>
      {compare && <div className={`text-[11px] ${differs ? 'text-rose-600 font-semibold' : 'text-slate-400'}`}>CRM: {formatDay(crm) || '—'}</div>}
    </div>
  );
};

/** Admin only: reconcile the SVH partner's parking file with "Слежка авто". Nothing is saved; the file stays in the browser. */
export const SvhReconcile = () => {
  const { stages } = useTruckTrackingStages();
  const { entries, loading } = useTruckTracking(stages);
  const [file, setFile] = useState<{ name: string; rows: PartnerRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('problems');
  // Arrival-date period; null = the whole file.
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  const today = todayDay();

  const read = async (picked?: File | null) => {
    if (!picked) return;
    setError(null);
    try {
      const workbook = XLSX.read(await picked.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = parsePartnerSheet(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true }), today);
      if (!rows.length) throw new Error('В файле не найдено ни одной фуры. Нужна таблица с колонками «Дата подачи на тупик СВХ», «инвойс», «Дата выгрузки на СВХ».');
      setFile({ name: picked.name, rows });
      setPeriod(null);
    } catch (reason) {
      setFile(null);
      setError(reason instanceof Error ? reason.message : 'Не удалось прочитать файл.');
    }
  };

  const range = period && period.from > period.to ? { from: period.to, to: period.from } : period;
  const result = useMemo(() => file ? reconcile(file.rows, entries, stages, today, range) : null, [file, entries, stages, today, range?.from, range?.to]);
  // Quick buttons for the months that occur in the file.
  const months = useMemo(() => [...new Set((file?.rows || []).map(row => row.arrived.day?.slice(0, 7)).filter((month): month is string => Boolean(month)))].sort(), [file]);
  const monthRange = (month: string) => {
    const [year, number] = month.split('-').map(Number);
    return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
  };
  const monthName = (month: string) => new Date(month + '-15T00:00:00Z').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const setDate = (field: 'from' | 'to', value: string) => {
    if (!value || !file) return;
    const days = file.rows.map(row => row.arrived.day).filter((day): day is string => Boolean(day)).sort();
    setPeriod(old => ({ from: old?.from || days[0] || value, to: old?.to || days.at(-1) || value, [field]: value }));
  };
  const visible = useMemo(() => (result?.rows || []).filter(row =>
    filter === 'all' ? true : filter === 'problems' ? row.status !== 'ok' && row.status !== 'no-invoice' : filter === 'not-found' ? row.status === 'not-found' || row.status === 'ambiguous' : row.status === filter), [result, filter]);

  const exportExcel = () => {
    if (!result || !file) return;
    const table: ReportTable = {
      title: 'Сверка стоянки',
      header: ['№', 'Инвойс (партнёр)', 'Номер', '№ Т/С', 'Товар', 'Заезд (партнёр)', 'Заезд (CRM)', 'Выгрузка (партнёр)', 'Выгрузка (CRM)',
        'Перемещение (партнёр)', 'Перемещение (CRM)', 'Дней стоянки (партнёр)', 'Дней стоянки (CRM)', 'Разница', 'Статус', 'Замечания'],
      rows: result.rows.map((row: ReconcileRow) => [
        row.partner.no, row.partner.invoiceRaw, row.partner.invoice, row.partner.truck, row.partner.product,
        row.partner.arrived.bad ? row.partner.arrived.raw : formatDay(row.partner.arrived.day), formatDay(row.crm?.arrived),
        row.partner.unloaded.bad ? row.partner.unloaded.raw : formatDay(row.partner.unloaded.day), formatDay(row.crm?.unloaded),
        row.partner.moved.bad ? row.partner.moved.raw : formatDay(row.partner.moved.day), formatDay(row.crm?.moved),
        days(row.partnerDays, row.partnerOpen), row.crm ? days(row.crmDays, row.crmOpen) : '', row.diff, STATUS[row.status].label, row.issues.join('; '),
      ]),
    };
    const missing: ReportTable = { title: 'Нет у партнёра', header: ['Инвойс', 'Товар', 'Заезд (CRM)'],
      rows: result.missing.map(item => [item.invoice, item.productName, formatDay(item.arrived)]) };
    downloadReports([table, missing], result.period || { from: today, to: today }, 'Сверка стоянки СВХ');
  };

  const filters: { id: Filter; label: string; count?: number }[] = result ? [
    { id: 'problems', label: 'Требуют внимания', count: result.summary.mismatch + result.summary.notFound },
    { id: 'mismatch', label: 'Расхождения', count: result.summary.mismatch },
    { id: 'not-found', label: 'Нет в CRM', count: result.summary.notFound },
    { id: 'no-invoice', label: 'Без инвойса', count: result.summary.noInvoice },
    { id: 'ok', label: 'Совпадают', count: result.summary.ok },
    { id: 'all', label: 'Все', count: result.summary.total },
  ] : [];

  return (
    <div className="space-y-5">
      <div className={`${card} p-5 flex flex-col lg:flex-row lg:items-center gap-4 justify-between`}>
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-emerald-600" />Сверка стоянки на СВХ</h2>
          <p className="text-sm text-slate-500 max-w-3xl">
            Загрузите файл партнёра («МехКаз 2026»). CRM сверит даты заезда (столбец B), выгрузки (Q) и перемещения на ком. склад (P) со «Слежкой авто»
            по номеру инвойса из столбца E (после «-») и посчитает дни стоянки: от заезда до выгрузки. Файл никуда не загружается и не сохраняется.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label className="cursor-pointer px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
            <Upload className="w-4 h-4" />{file ? 'Другой файл' : 'Загрузить файл'}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={event => { void read(event.target.files?.[0]); event.target.value = ''; }} />
          </label>
          {result && (
            <button type="button" onClick={exportExcel} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
              <Download className="w-4 h-4" />Сверка в Excel
            </button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm text-rose-800">{error}</div>}
      {file && loading && <p className="text-sm text-slate-500">Загружаю «Слежку авто»…</p>}

      {result && file && (
        <>
          <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
            <span className="text-xs font-semibold text-slate-500 me-1">Заезд за период:</span>
            <button type="button" onClick={() => setPeriod(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!period ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>Весь файл</button>
            {months.map(month => {
              const value = monthRange(month);
              const active = range?.from === value.from && range?.to === value.to;
              return (
                <button key={month} type="button" onClick={() => setPeriod(value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border capitalize ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>{monthName(month)}</button>
              );
            })}
            <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs text-slate-500">с
              <input type="date" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800" value={range?.from || ''} onChange={event => setDate('from', event.target.value)} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">по
              <input type="date" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800" value={range?.to || ''} onChange={event => setDate('to', event.target.value)} />
            </label>
          </div>
          <p className="text-xs text-slate-500">Файл: <span className="font-semibold text-slate-700">{file.name}</span> ·{' '}
            {range ? <>заехали с {formatDay(range.from)} по {formatDay(range.to)}: <b>{result.summary.total}</b> фур (остальные {result.summary.outside} — вне периода или с непонятной датой заезда)</> : <>фур в файле: {result.summary.total}</>}
            {' '}· сегодня {formatDay(today)} (для фур без даты выгрузки стоянка считается до сегодня, отмечено «+»)</p>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { icon: CheckCircle2, label: 'Совпадает', value: result.summary.ok, tone: 'text-emerald-600' },
              { icon: AlertTriangle, label: 'Расхождения', value: result.summary.mismatch, tone: 'text-rose-600' },
              { icon: SearchX, label: 'Нет в CRM', value: result.summary.notFound, tone: 'text-amber-600' },
              { icon: HelpCircle, label: 'Без инвойса', value: result.summary.noInvoice, tone: 'text-slate-500' },
              { icon: FileSpreadsheet, label: 'Дней стоянки (партнёр)', value: result.summary.partnerDays, tone: 'text-blue-600', note: 'по сверенным фурам' },
              { icon: FileSpreadsheet, label: 'Дней стоянки (CRM)', value: result.summary.crmDays, tone: 'text-violet-600',
                note: result.summary.partnerDays - result.summary.crmDays ? `партнёр ${result.summary.partnerDays > result.summary.crmDays ? 'больше' : 'меньше'} на ${Math.abs(result.summary.partnerDays - result.summary.crmDays)} дн.` : 'совпадает' },
            ].map(item => (
              <div key={item.label} className={`${card} p-4`}>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><item.icon className={`w-3.5 h-3.5 ${item.tone}`} />{item.label}</p>
                <p className={`text-2xl font-black mt-1 ${item.tone}`}>{item.value}</p>
                {'note' in item && item.note && <p className="text-[11px] text-slate-400">{item.note}</p>}
              </div>
            ))}
          </div>

          <div className={`${card} p-4 space-y-3`}>
            <div className="flex flex-wrap gap-2">
              {filters.map(item => (
                <button key={item.id} type="button" onClick={() => setFilter(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${filter === item.id ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
                  {item.label} <span className="opacity-70">{item.count}</span>
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    {['№', 'Инвойс', 'Т/С · товар', 'Заезд', 'Выгрузка', 'Перемещение', 'Дней (партнёр)', 'Дней (CRM)', 'Разница', 'Статус', 'Замечания'].map(title =>
                      <th key={title} className="py-2 px-2 font-semibold whitespace-nowrap">{title}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {visible.map(row => (
                    <tr key={row.partner.row} className={row.status === 'mismatch' ? 'bg-rose-50/40' : ''}>
                      <td className="py-2 px-2 text-slate-400">{row.partner.no}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <div className="font-bold text-slate-900">{row.partner.invoice || '—'}</div>
                        <div className="text-[11px] text-slate-400">{row.partner.invoiceRaw}</div>
                      </td>
                      <td className="py-2 px-2 max-w-[220px]">
                        <div className="text-slate-700 truncate">{row.partner.truck}</div>
                        <div className="text-[11px] text-slate-400 truncate" title={row.partner.product}>{row.partner.product}</div>
                      </td>
                      <td className="py-2 px-2"><DatePair partner={row.partner.arrived} crm={row.crm?.arrived} compare={Boolean(row.crm)} /></td>
                      <td className="py-2 px-2"><DatePair partner={row.partner.unloaded} crm={row.crm?.unloaded} compare={Boolean(row.crm)} /></td>
                      <td className="py-2 px-2"><DatePair partner={row.partner.moved} crm={row.crm?.moved} compare={Boolean(row.crm)} /></td>
                      <td className="py-2 px-2 font-bold text-slate-900">{days(row.partnerDays, row.partnerOpen)}</td>
                      <td className="py-2 px-2 text-slate-700">{row.crm ? days(row.crmDays, row.crmOpen) : '—'}</td>
                      <td className={`py-2 px-2 font-bold ${row.diff ? (row.diff > 0 ? 'text-rose-600' : 'text-amber-600') : 'text-slate-400'}`}>
                        {row.diff === null ? '—' : row.diff > 0 ? `+${row.diff}` : row.diff}
                      </td>
                      <td className="py-2 px-2"><span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS[row.status].tone}`}>{STATUS[row.status].label}</span></td>
                      <td className="py-2 px-2 text-slate-600 min-w-[240px]">{row.issues.map(issue => <div key={issue}>{issue}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && <p className="py-6 text-center text-xs text-slate-400">В этом фильтре фур нет.</p>}
            </div>
            <p className="text-[11px] text-slate-400">«Разница» = дни у партнёра минус дни в CRM: <span className="text-rose-600 font-semibold">+N</span> — партнёр выставляет больше, чем у нас записано.</p>
          </div>

          {result.missing.length > 0 && (
            <div className={`${card} p-4 space-y-2`}>
              <h3 className="text-sm font-bold text-slate-900">Есть в «Слежке авто», нет у партнёра <span className="text-slate-400 font-normal">· {result.missing.length}</span></h3>
              <p className="text-xs text-slate-500">Фуры, которые по CRM заехали в выбранный период (или в период файла), но в файле партнёра их нет вообще.</p>
              <div className="flex flex-wrap gap-2">
                {result.missing.map(item => (
                  <span key={item.id} className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-700">
                    <b>{item.invoice}</b> · {item.productName} · заезд {formatDay(item.arrived)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
