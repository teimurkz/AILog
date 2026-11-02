import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, HelpCircle, Search, SearchX, Upload, Wallet } from 'lucide-react';
import { useTruckTracking, useTruckTrackingStages } from '../../hooks/useTruckTracking';
import {
  daysBetween, formatDay, parkingCost, parsePartnerSheet, reconcile,
  type PartnerRow, type ReconcileRow, type ReconcileStatus, type UnloadPlace,
} from '../../../shared/svh-reconcile';
import { todayDay } from '../../../shared/work-reports';
import { downloadReports, type ReportTable } from '../../utils/work-reports-excel';
import { useSectionText } from '../../i18n/useSectionText';
import { ADMIN_TEXTS } from './admin-i18n';

const STATUS_TONE: Record<ReconcileStatus, string> = {
  ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  mismatch: 'bg-rose-50 text-rose-700 border-rose-200',
  'not-found': 'bg-amber-50 text-amber-800 border-amber-200',
  ambiguous: 'bg-amber-50 text-amber-800 border-amber-200',
  'no-invoice': 'bg-slate-100 text-slate-600 border-slate-200',
};
type Filter = 'all' | 'problems' | ReconcileStatus;
const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm';
const days = (value: number | null, open: boolean) => value === null ? '?' : `${value}${open ? '+' : ''}`;
const RATE_KEY = 'svh-reconcile-rate';
const readRate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || 0; } catch { return 0; } };
// Persian and Arabic-Indic digits typed into the rate field.
const latinDigits = (value: string) => value.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660));

/** Partner's date above ours, with a badge: ✓ same, ±N days, or missing on one side. */
const DateCompare = ({ partner, partnerRaw, bad, crm, compare, weekend }: { partner: string | null; partnerRaw?: string; bad?: boolean; crm?: string | null; compare: boolean; weekend?: boolean }) => {
  const text = useSectionText(ADMIN_TEXTS).text.svh;
  let badge: React.ReactNode = null;
  if (compare) {
    if (bad) badge = <span className="rounded-md bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">{text.error}</span>;
    else if (weekend) badge = <span className="rounded-md bg-sky-100 px-1.5 text-[10px] font-bold text-sky-700" title={text.weekendTitle}>{text.weekend} ✓</span>;
    else if (partner && crm && partner === crm) badge = <span className="rounded-md bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">✓</span>;
    else if (partner && crm) {
      const shift = daysBetween(crm, partner);
      badge = <span className="rounded-md bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700" dir="ltr">{text.days(`${shift > 0 ? '+' : ''}${shift}`)}</span>;
    } else if (partner || crm) badge = <span className="rounded-md bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{partner ? text.notInCrm : text.notAtPartner}</span>;
  }
  return (
    <div className="flex items-start gap-2 whitespace-nowrap">
      <div className="leading-tight">
        <div className={`font-semibold ${bad ? 'text-rose-700' : 'text-slate-900'}`} dir="ltr">{bad ? `«${partnerRaw}»` : formatDay(partner) || '—'}</div>
        {compare && <div className="text-[11px] text-slate-400">CRM: <span className="text-slate-600" dir="ltr">{formatDay(crm) || '—'}</span></div>}
      </div>
      {badge}
    </div>
  );
};

const PlaceTag = ({ value }: { value: UnloadPlace | null }) => {
  const text = useSectionText(ADMIN_TEXTS).text.svh;
  return value?.place ? (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${value.place === 'svh' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}>
      {text.placeTag[value.place]}
    </span>
  ) : null;
};

/** Admin only: reconcile the SVH partner's parking file with "Слежка авто". Nothing is saved; the file stays in the browser. */
export const SvhReconcile = () => {
  const { text: all, language, locale, isRTL } = useSectionText(ADMIN_TEXTS);
  const text = all.svh;
  const { stages } = useTruckTrackingStages();
  const { entries, loading } = useTruckTracking(stages);
  const [file, setFile] = useState<{ name: string; rows: PartnerRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('problems');
  const [search, setSearch] = useState('');
  // Arrival-date period; null = the whole file.
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);
  // Parking price per truck per day, remembered in this browser.
  const [rate, setRate] = useState<number>(readRate);
  const today = todayDay();
  const tenge = (value: number) => `${Math.round(value).toLocaleString(locale)} ₸`;

  const changeRate = (value: string) => {
    const next = Math.max(0, Number(latinDigits(value).replace(/[\s٬]/g, '').replace(/[,٫]/, '.')) || 0);
    setRate(next);
    try { localStorage.setItem(RATE_KEY, String(next)); } catch { /* private window: keep it for this visit only */ }
  };

  const read = async (picked?: File | null) => {
    if (!picked) return;
    setError(null);
    try {
      const workbook = XLSX.read(await picked.arrayBuffer());
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = parsePartnerSheet(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true }), today);
      if (!rows.length) { setFile(null); setError(text.noRowsError); return; }
      setFile({ name: picked.name, rows });
      setPeriod(null);
    } catch {
      setFile(null);
      setError(text.readError);
    }
  };

  const range = period && period.from > period.to ? { from: period.to, to: period.from } : period;
  const result = useMemo(() => file ? reconcile(file.rows, entries, stages, today, range, language) : null, [file, entries, stages, today, range?.from, range?.to, language]);
  const cost = useMemo(() => parkingCost(result?.rows || [], rate), [result, rate]);
  const months = useMemo(() => [...new Set((file?.rows || []).map(row => row.arrived.day?.slice(0, 7)).filter((month): month is string => Boolean(month)))].sort(), [file]);
  const monthRange = (month: string) => {
    const [year, number] = month.split('-').map(Number);
    return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
  };
  const monthName = (month: string) => new Date(month + '-15T00:00:00Z').toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const setDate = (field: 'from' | 'to', value: string) => {
    if (!value || !file) return;
    const arrivals = file.rows.map(row => row.arrived.day).filter((day): day is string => Boolean(day)).sort();
    setPeriod(old => ({ from: old?.from || arrivals[0] || value, to: old?.to || arrivals.at(-1) || value, [field]: value }));
  };

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (result?.rows || []).filter(row =>
      (filter === 'all' ? true : filter === 'problems' ? row.status === 'mismatch' || row.status === 'not-found' || row.status === 'ambiguous'
        : filter === 'not-found' ? row.status === 'not-found' || row.status === 'ambiguous' : row.status === filter)
      && (!query || [row.partner.invoice, row.partner.invoiceRaw, row.partner.truck, row.partner.product, row.crm?.invoice].some(value => value?.toLowerCase().includes(query))));
  }, [result, filter, search]);

  const exportExcel = () => {
    if (!result) return;
    const excel = text.excel;
    const money = (value: number | null) => rate && value !== null ? Math.round(value * rate) : null;
    const table: ReportTable = {
      title: excel.sheet,
      header: excel.header,
      rows: result.rows.map((row: ReconcileRow) => [
        row.partner.no, row.partner.invoice, row.partner.invoiceRaw, row.partner.truck, row.partner.product,
        row.partner.arrived.bad ? row.partner.arrived.raw : formatDay(row.partner.arrived.day), formatDay(row.crm?.arrived),
        row.partnerUnload.place ? text.place[row.partnerUnload.place] : '', formatDay(row.partnerUnload.day),
        row.crmUnload?.place ? text.place[row.crmUnload.place] : '', formatDay(row.crmUnload?.day),
        row.partner.moved.bad ? row.partner.moved.raw : formatDay(row.partner.moved.day), formatDay(row.crm?.moved),
        days(row.partnerDays, row.partnerOpen), row.crm ? days(row.crmDays, row.crmOpen) : '', row.diff,
        money(row.partnerDays), row.crm ? money(row.crmDays) : null, row.crm ? money(row.diff) : null,
        text.status[row.status], [...row.issues, ...row.notes].join('; '),
      ]),
    };
    const totals: ReportTable = { title: excel.totals, header: excel.totalsHeader, rows: [
      [excel.period, result.period ? `${formatDay(result.period.from)} — ${formatDay(result.period.to)}` : excel.wholeFile],
      [excel.trucks, result.summary.total], [excel.ok, result.summary.ok], [excel.mismatch, result.summary.mismatch],
      [excel.notFound, result.summary.notFound], [excel.noInvoice, result.summary.noInvoice],
      [excel.rate, rate || null],
      [excel.partnerDaysAll, result.summary.allPartnerDays], [excel.partnerSumAll, rate ? cost.partnerAll : null],
      [excel.partnerDays, result.summary.partnerDays], [excel.crmDays, result.summary.crmDays],
      [excel.partnerSum, rate ? cost.partner : null], [excel.crmSum, rate ? cost.crm : null],
      [excel.diffSum, rate ? cost.diff : null],
    ] };
    const missing: ReportTable = { title: excel.missing, header: excel.missingHeader,
      rows: result.missing.map(item => [item.invoice, item.productName, formatDay(item.arrived)]) };
    downloadReports([totals, table, missing], result.period || { from: today, to: today }, excel.file, isRTL);
  };

  const filters: { id: Filter; label: string; count: number }[] = result ? [
    { id: 'problems', label: text.filter.problems, count: result.summary.mismatch + result.summary.notFound },
    { id: 'mismatch', label: text.filter.mismatch, count: result.summary.mismatch },
    { id: 'ok', label: text.filter.ok, count: result.summary.ok },
    { id: 'not-found', label: text.filter.notFound, count: result.summary.notFound },
    { id: 'no-invoice', label: text.filter.noInvoice, count: result.summary.noInvoice },
    { id: 'all', label: text.filter.all, count: result.summary.total },
  ] : [];
  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`;
  const input = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800';

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={`${card} p-5 flex flex-col lg:flex-row lg:items-center gap-4 justify-between`}>
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-emerald-600" />{text.title}</h2>
          <p className="text-sm text-slate-500 max-w-3xl">{text.intro}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label className="cursor-pointer px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
            <Upload className="w-4 h-4" />{file ? text.otherFile : text.uploadFile}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={event => { void read(event.target.files?.[0]); event.target.value = ''; }} />
          </label>
          {result && (
            <button type="button" onClick={exportExcel} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl flex items-center gap-2">
              <Download className="w-4 h-4" />{text.toExcel}
            </button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-sm text-rose-800">{error}</div>}
      {file && loading && <p className="text-sm text-slate-500">{text.loadingTracking}</p>}

      {result && file && (
        <>
          <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
            <span className="text-xs font-semibold text-slate-500 me-1">{text.periodLabel}</span>
            <button type="button" onClick={() => setPeriod(null)} className={chip(!period)}>{text.wholeFile}</button>
            {months.map(month => {
              const value = monthRange(month);
              return <button key={month} type="button" onClick={() => setPeriod(value)} className={`${chip(range?.from === value.from && range?.to === value.to)} capitalize`}>{monthName(month)}</button>;
            })}
            <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs text-slate-500">{text.from}<input type="date" className={input} value={range?.from || ''} onChange={event => setDate('from', event.target.value)} /></label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">{text.to}<input type="date" className={input} value={range?.to || ''} onChange={event => setDate('to', event.target.value)} /></label>
            <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Wallet className="w-4 h-4 text-emerald-600" />{text.rate}
              <input type="text" inputMode="decimal" dir="ltr" className={`${input} w-28 font-semibold`} placeholder={text.ratePlaceholder}
                value={rate ? rate.toLocaleString('ru-RU') : ''} onChange={event => changeRate(event.target.value)} />
            </label>
          </div>

          <p className="text-xs text-slate-500">{text.file} <span className="font-semibold text-slate-700">{file.name}</span> ·{' '}
            {range ? text.inPeriod(formatDay(range.from), formatDay(range.to), result.summary.total, result.summary.outside) : text.inFile(result.summary.total)}
            {' '}· {text.openNote(formatDay(today))}</p>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            {[
              { icon: CheckCircle2, label: text.kpi.ok, value: result.summary.ok, tone: 'text-emerald-600' },
              { icon: AlertTriangle, label: text.kpi.mismatch, value: result.summary.mismatch, tone: 'text-rose-600' },
              { icon: SearchX, label: text.kpi.notFound, value: result.summary.notFound, tone: 'text-amber-600' },
              { icon: HelpCircle, label: text.kpi.noInvoice, value: result.summary.noInvoice, tone: 'text-slate-500' },
              { icon: FileSpreadsheet, label: text.kpi.partnerDays, value: result.summary.partnerDays, tone: 'text-blue-600', note: text.kpi.reconciled },
              { icon: FileSpreadsheet, label: text.kpi.crmDays, value: result.summary.crmDays, tone: 'text-violet-600', note: text.kpi.reconciled },
              { icon: Wallet, label: text.kpi.partnerSum, value: rate ? tenge(cost.partnerAll) : '—', tone: 'text-slate-900',
                note: rate ? text.kpi.allTrucks(result.summary.allPartnerDays) : text.kpi.enterRate },
              { icon: Wallet, label: text.kpi.diffSum, value: rate ? tenge(cost.diff) : '—', tone: cost.diff > 0 ? 'text-rose-600' : 'text-emerald-600',
                note: rate ? (cost.diff > 0 ? text.kpi.billedMore : cost.diff < 0 ? text.kpi.billedLess : text.kpi.same) : text.kpi.byReconciled },
            ].map(item => (
              <div key={item.label} className={`${card} p-3.5`}>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><item.icon className={`w-3.5 h-3.5 ${item.tone}`} />{item.label}</p>
                <p className={`text-xl font-black mt-1 ${item.tone}`}>{item.value}</p>
                {'note' in item && item.note && <p className="text-[11px] text-slate-400">{item.note}</p>}
              </div>
            ))}
          </div>

          {result.summary.weekend > 0 && (
            <p className="rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-2 text-xs text-sky-800">{text.weekendCount(result.summary.weekend)}</p>
          )}

          <div className={`${card} p-4 space-y-3`}>
            <div className="flex flex-wrap items-center gap-2">
              {filters.map(item => (
                <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={chip(filter === item.id)}>
                  {item.label} <span className="opacity-70">{item.count}</span>
                </button>
              ))}
              <label className="ms-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder={text.searchPlaceholder} className="w-48 text-xs outline-none" />
              </label>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-100">
              <table className="w-full text-start text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                  <tr>
                    {text.columns.map(title =>
                      <th key={title} className="py-2.5 px-3 font-semibold whitespace-nowrap text-start">{title}</th>)}
                  </tr>
                  <tr className="text-[10px] text-slate-400">
                    {['', text.sides, text.whereWhen, text.sides, text.sidesDiff, rate ? text.perDay(tenge(rate)) : text.enterRate, ''].map((note, index) =>
                      <th key={index} className="px-3 pb-1.5 font-normal border-b border-slate-200 whitespace-nowrap text-start">{note}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {visible.map(row => {
                    const compare = Boolean(row.crm);
                    const placeDiffers = compare && row.crmUnload?.place && row.partnerUnload.place && row.crmUnload.place !== row.partnerUnload.place;
                    return (
                      <tr key={row.partner.row} className={`border-b border-slate-100 align-top hover:bg-blue-50/30 ${row.status === 'mismatch' ? 'bg-rose-50/40' : ''}`}>
                        <td className="py-2.5 px-3 max-w-[240px]">
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm font-black text-slate-900">{row.partner.invoice || '—'}</span>
                            <span className="text-[10px] text-slate-400">№ {row.partner.no} · {row.partner.invoiceRaw || text.noInvoice}</span>
                          </div>
                          <div className="text-slate-600 truncate">{row.partner.truck}</div>
                          <div className="text-[11px] text-slate-400 truncate" title={row.partner.product}>{row.partner.product}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <DateCompare partner={row.partner.arrived.day} partnerRaw={row.partner.arrived.raw} bad={row.partner.arrived.bad} crm={row.crm?.arrived} compare={compare} weekend={row.weekendArrival} />
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap items-center gap-1 mb-1">
                            <PlaceTag value={row.partnerUnload} />
                            {placeDiffers && <><span className="text-[10px] text-rose-600 font-bold">≠ CRM:</span><PlaceTag value={row.crmUnload} /></>}
                          </div>
                          <DateCompare partner={row.partnerUnload.day} partnerRaw={row.partner.unloaded.raw} bad={row.partner.unloaded.bad} crm={row.crmUnload?.day} compare={compare} />
                        </td>
                        <td className="py-2.5 px-3">
                          {row.partnerUnload.place === 'warehouse' && (!compare || row.crmUnload?.place !== 'svh')
                            ? <span className="text-[11px] text-slate-400">{text.sameAsUnloading}</span>
                            : <DateCompare partner={row.partner.moved.day} partnerRaw={row.partner.moved.raw} bad={row.partner.moved.bad} crm={row.crm?.moved} compare={compare} />}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="text-base font-black text-slate-900">{days(row.partnerDays, row.partnerOpen)}</div>
                          {compare && (
                            <div className="text-[11px] text-slate-400">CRM: <span className="text-slate-600">{days(row.crmDays, row.crmOpen)}</span>
                              {row.diff ? <span dir="ltr" className={`ms-1.5 rounded-md px-1.5 font-bold ${row.diff > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>{row.diff > 0 ? '+' : ''}{row.diff}</span> : null}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {rate && row.partnerDays !== null ? (
                            <>
                              <div className="font-bold text-slate-900">{tenge(row.partnerDays * rate)}</div>
                              {compare && row.diff ? <div className={`text-[11px] font-semibold ${row.diff > 0 ? 'text-rose-600' : 'text-amber-700'}`}>{text.toCrm(`${row.diff > 0 ? '+' : ''}${tenge(row.diff * rate)}`)}</div> : null}
                            </>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 min-w-[220px]">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[row.status]}`}>{text.status[row.status]}</span>
                          {row.issues.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">{row.issues.map(issue => <li key={issue}>• {issue}</li>)}</ul>}
                          {row.notes.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-sky-700">{row.notes.map(note => <li key={note}>• {note}</li>)}</ul>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visible.length && <p className="py-6 text-center text-xs text-slate-400">{search ? text.emptyFilterSearch : text.emptyFilter}</p>}
            </div>
            <p className="text-[11px] text-slate-400">
              <span className="rounded bg-emerald-100 px-1 font-bold text-emerald-700">✓</span> {text.legendSame} ·{' '}
              <span className="rounded bg-rose-100 px-1 font-bold text-rose-700">{text.legendShift}</span> {text.legendLater} ·{' '}
              <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">{text.notInCrm}</span> {text.legendOneSide}{' '}
              {text.legendDiff} <span className="text-rose-600 font-semibold">+</span> {text.legendMore}
            </p>
          </div>

          {result.missing.length > 0 && (
            <div className={`${card} p-4 space-y-2`}>
              <h3 className="text-sm font-bold text-slate-900">{text.missingTitle} <span className="text-slate-400 font-normal">· {result.missing.length}</span></h3>
              <p className="text-xs text-slate-500">{text.missingNote}</p>
              <div className="flex flex-wrap gap-2">
                {result.missing.map(item => (
                  <span key={item.id} className="px-2.5 py-1 rounded-lg border border-slate-200 text-xs text-slate-700">
                    <b>{item.invoice}</b> · {item.productName} · {text.arrivedOn(formatDay(item.arrived))}
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
