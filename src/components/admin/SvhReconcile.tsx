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
const tenge = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₸`;
const RATE_KEY = 'svh-reconcile-rate';
const readRate = () => { try { return Number(localStorage.getItem(RATE_KEY)) || 0; } catch { return 0; } };
const PLACE = { svh: 'СВХ', warehouse: 'Ком. склад' } as const;

/** Partner's date above ours, with a badge: ✓ same, ±N days, or missing on one side. */
const DateCompare = ({ partner, partnerRaw, bad, crm, compare }: { partner: string | null; partnerRaw?: string; bad?: boolean; crm?: string | null; compare: boolean }) => {
  let badge: React.ReactNode = null;
  if (compare) {
    if (bad) badge = <span className="rounded-md bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">ошибка</span>;
    else if (partner && crm && partner === crm) badge = <span className="rounded-md bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">✓</span>;
    else if (partner && crm) {
      const shift = daysBetween(crm, partner);
      badge = <span className="rounded-md bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">{shift > 0 ? '+' : ''}{shift} дн.</span>;
    } else if (partner || crm) badge = <span className="rounded-md bg-amber-100 px-1.5 text-[10px] font-bold text-amber-800">{partner ? 'нет в CRM' : 'нет у партн.'}</span>;
  }
  return (
    <div className="flex items-start gap-2 whitespace-nowrap">
      <div className="leading-tight">
        <div className={`font-semibold ${bad ? 'text-rose-700' : 'text-slate-900'}`}>{bad ? `«${partnerRaw}»` : formatDay(partner) || '—'}</div>
        {compare && <div className="text-[11px] text-slate-400">CRM: <span className="text-slate-600">{formatDay(crm) || '—'}</span></div>}
      </div>
      {badge}
    </div>
  );
};

const PlaceTag = ({ value }: { value: UnloadPlace | null }) => value?.place ? (
  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${value.place === 'svh' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800'}`}>
    {value.place === 'svh' ? 'на СВХ' : 'сразу на ком. склад'}
  </span>
) : null;

/** Admin only: reconcile the SVH partner's parking file with "Слежка авто". Nothing is saved; the file stays in the browser. */
export const SvhReconcile = () => {
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

  const changeRate = (value: string) => {
    const next = Math.max(0, Number(value.replace(/\s/g, '').replace(',', '.')) || 0);
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
  const cost = useMemo(() => parkingCost(result?.rows || [], rate), [result, rate]);
  const months = useMemo(() => [...new Set((file?.rows || []).map(row => row.arrived.day?.slice(0, 7)).filter((month): month is string => Boolean(month)))].sort(), [file]);
  const monthRange = (month: string) => {
    const [year, number] = month.split('-').map(Number);
    return { from: `${month}-01`, to: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
  };
  const monthName = (month: string) => new Date(month + '-15T00:00:00Z').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
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
    const money = (value: number | null) => rate && value !== null ? Math.round(value * rate) : null;
    const table: ReportTable = {
      title: 'Сверка стоянки',
      header: ['№', 'Инвойс', 'Инвойс (как у партнёра)', '№ Т/С', 'Товар',
        'Заезд — партнёр', 'Заезд — CRM', 'Выгрузка — где (партнёр)', 'Выгрузка — партнёр', 'Выгрузка — где (CRM)', 'Выгрузка — CRM',
        'Перемещение на ком. склад — партнёр', 'Перемещение на ком. склад — CRM',
        'Дней стоянки — партнёр', 'Дней стоянки — CRM', 'Разница, дн.',
        'Сумма — партнёр, ₸', 'Сумма — CRM, ₸', 'Разница, ₸', 'Статус', 'Замечания'],
      rows: result.rows.map((row: ReconcileRow) => [
        row.partner.no, row.partner.invoice, row.partner.invoiceRaw, row.partner.truck, row.partner.product,
        row.partner.arrived.bad ? row.partner.arrived.raw : formatDay(row.partner.arrived.day), formatDay(row.crm?.arrived),
        row.partnerUnload.place ? PLACE[row.partnerUnload.place] : '', formatDay(row.partnerUnload.day),
        row.crmUnload?.place ? PLACE[row.crmUnload.place] : '', formatDay(row.crmUnload?.day),
        row.partner.moved.bad ? row.partner.moved.raw : formatDay(row.partner.moved.day), formatDay(row.crm?.moved),
        days(row.partnerDays, row.partnerOpen), row.crm ? days(row.crmDays, row.crmOpen) : '', row.diff,
        money(row.partnerDays), row.crm ? money(row.crmDays) : null, row.crm ? money(row.diff) : null,
        STATUS[row.status].label, row.issues.join('; '),
      ]),
    };
    const totals: ReportTable = { title: 'Итого', header: ['Показатель', 'Значение'], rows: [
      ['Период заезда', result.period ? `${formatDay(result.period.from)} — ${formatDay(result.period.to)}` : 'весь файл'],
      ['Фур в сверке', result.summary.total], ['Совпадает', result.summary.ok], ['Расхождения', result.summary.mismatch],
      ['Нет в CRM', result.summary.notFound], ['Без инвойса', result.summary.noInvoice],
      ['Ставка за сутки, ₸', rate || null],
      ['Дней стоянки по партнёру (все фуры)', result.summary.allPartnerDays], ['Сумма по партнёру (все фуры), ₸', rate ? cost.partnerAll : null],
      ['Дней стоянки по партнёру (сверенные)', result.summary.partnerDays], ['Дней стоянки по CRM (сверенные)', result.summary.crmDays],
      ['Сумма по партнёру (сверенные), ₸', rate ? cost.partner : null], ['Сумма по CRM (сверенные), ₸', rate ? cost.crm : null],
      ['Разница: партнёр минус CRM, ₸', rate ? cost.diff : null],
    ] };
    const missing: ReportTable = { title: 'Нет у партнёра', header: ['Инвойс', 'Товар', 'Заезд (CRM)'],
      rows: result.missing.map(item => [item.invoice, item.productName, formatDay(item.arrived)]) };
    downloadReports([totals, table, missing], result.period || { from: today, to: today }, 'Сверка стоянки СВХ');
  };

  const filters: { id: Filter; label: string; count: number }[] = result ? [
    { id: 'problems', label: 'Требуют внимания', count: result.summary.mismatch + result.summary.notFound },
    { id: 'mismatch', label: 'Расхождения', count: result.summary.mismatch },
    { id: 'ok', label: 'Совпадают', count: result.summary.ok },
    { id: 'not-found', label: 'Нет в CRM', count: result.summary.notFound },
    { id: 'no-invoice', label: 'Без инвойса', count: result.summary.noInvoice },
    { id: 'all', label: 'Все', count: result.summary.total },
  ] : [];
  const chip = (active: boolean) => `px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`;
  const input = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-800';

  return (
    <div className="space-y-4">
      <div className={`${card} p-5 flex flex-col lg:flex-row lg:items-center gap-4 justify-between`}>
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-emerald-600" />Сверка стоянки на СВХ</h2>
          <p className="text-sm text-slate-500 max-w-3xl">
            Загрузите файл партнёра. CRM сверит даты заезда, выгрузки на СВХ и перемещения на ком. склад со «Слежкой авто» по номеру инвойса
            и посчитает дни стоянки (от заезда до выгрузки; если выгрузки на СВХ нет — до выгрузки на ком. склад). Файл не сохраняется.
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
            <button type="button" onClick={() => setPeriod(null)} className={chip(!period)}>Весь файл</button>
            {months.map(month => {
              const value = monthRange(month);
              return <button key={month} type="button" onClick={() => setPeriod(value)} className={`${chip(range?.from === value.from && range?.to === value.to)} capitalize`}>{monthName(month)}</button>;
            })}
            <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs text-slate-500">с<input type="date" className={input} value={range?.from || ''} onChange={event => setDate('from', event.target.value)} /></label>
            <label className="flex items-center gap-1.5 text-xs text-slate-500">по<input type="date" className={input} value={range?.to || ''} onChange={event => setDate('to', event.target.value)} /></label>
            <span className="mx-1 h-5 w-px bg-slate-200 hidden sm:block" />
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <Wallet className="w-4 h-4 text-emerald-600" />Стоянка за сутки, ₸
              <input type="text" inputMode="decimal" className={`${input} w-28 font-semibold`} placeholder="например 10000"
                value={rate ? rate.toLocaleString('ru-RU') : ''} onChange={event => changeRate(event.target.value)} />
            </label>
          </div>

          <p className="text-xs text-slate-500">Файл: <span className="font-semibold text-slate-700">{file.name}</span> ·{' '}
            {range ? <>заехали с {formatDay(range.from)} по {formatDay(range.to)}: <b>{result.summary.total}</b> фур (остальные {result.summary.outside} — вне периода или с непонятной датой заезда)</> : <>фур в файле: {result.summary.total}</>}
            {' '}· без даты выгрузки стоянка считается до сегодня ({formatDay(today)}), отмечено «+»</p>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            {[
              { icon: CheckCircle2, label: 'Совпадает', value: result.summary.ok, tone: 'text-emerald-600' },
              { icon: AlertTriangle, label: 'Расхождения', value: result.summary.mismatch, tone: 'text-rose-600' },
              { icon: SearchX, label: 'Нет в CRM', value: result.summary.notFound, tone: 'text-amber-600' },
              { icon: HelpCircle, label: 'Без инвойса', value: result.summary.noInvoice, tone: 'text-slate-500' },
              { icon: FileSpreadsheet, label: 'Дней (партнёр)', value: result.summary.partnerDays, tone: 'text-blue-600', note: 'сверенные фуры' },
              { icon: FileSpreadsheet, label: 'Дней (CRM)', value: result.summary.crmDays, tone: 'text-violet-600', note: 'сверенные фуры' },
              { icon: Wallet, label: 'Сумма (партнёр)', value: rate ? tenge(cost.partnerAll) : '—', tone: 'text-slate-900',
                note: rate ? `все фуры, ${result.summary.allPartnerDays} дн.` : 'укажите ставку за сутки' },
              { icon: Wallet, label: 'Разница, ₸', value: rate ? tenge(cost.diff) : '—', tone: cost.diff > 0 ? 'text-rose-600' : 'text-emerald-600',
                note: rate ? (cost.diff > 0 ? 'партнёр выставил больше, чем по CRM' : cost.diff < 0 ? 'партнёр выставил меньше' : 'совпадает с CRM') : 'по сверенным фурам' },
            ].map(item => (
              <div key={item.label} className={`${card} p-3.5`}>
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><item.icon className={`w-3.5 h-3.5 ${item.tone}`} />{item.label}</p>
                <p className={`text-xl font-black mt-1 ${item.tone}`}>{item.value}</p>
                {'note' in item && item.note && <p className="text-[11px] text-slate-400">{item.note}</p>}
              </div>
            ))}
          </div>

          <div className={`${card} p-4 space-y-3`}>
            <div className="flex flex-wrap items-center gap-2">
              {filters.map(item => (
                <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={chip(filter === item.id)}>
                  {item.label} <span className="opacity-70">{item.count}</span>
                </button>
              ))}
              <label className="ms-auto flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Инвойс, номер ТС, товар" className="w-48 text-xs outline-none" />
              </label>
            </div>
            <div className="max-h-[70vh] overflow-auto rounded-xl border border-slate-100">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500">
                  <tr>
                    {['Инвойс · ТС · товар', 'Заезд на СВХ', 'Выгрузка', 'Перемещение на ком. склад', 'Дней стоянки', 'Сумма', 'Статус'].map(title =>
                      <th key={title} className="py-2.5 px-3 font-semibold whitespace-nowrap">{title}</th>)}
                  </tr>
                  <tr className="text-[10px] text-slate-400">
                    {['', 'партнёр / CRM', 'где и когда: партнёр / CRM', 'партнёр / CRM', 'партнёр / CRM, разница', rate ? `по ${tenge(rate)} в сутки` : 'укажите ставку', ''].map((note, index) =>
                      <th key={index} className="px-3 pb-1.5 font-normal border-b border-slate-200 whitespace-nowrap">{note}</th>)}
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
                            <span className="text-[10px] text-slate-400">№ {row.partner.no} · {row.partner.invoiceRaw || 'нет инвойса'}</span>
                          </div>
                          <div className="text-slate-600 truncate">{row.partner.truck}</div>
                          <div className="text-[11px] text-slate-400 truncate" title={row.partner.product}>{row.partner.product}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <DateCompare partner={row.partner.arrived.day} partnerRaw={row.partner.arrived.raw} bad={row.partner.arrived.bad} crm={row.crm?.arrived} compare={compare} />
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
                            ? <span className="text-[11px] text-slate-400">= выгрузка (сразу на ком. склад)</span>
                            : <DateCompare partner={row.partner.moved.day} partnerRaw={row.partner.moved.raw} bad={row.partner.moved.bad} crm={row.crm?.moved} compare={compare} />}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="text-base font-black text-slate-900">{days(row.partnerDays, row.partnerOpen)}</div>
                          {compare && (
                            <div className="text-[11px] text-slate-400">CRM: <span className="text-slate-600">{days(row.crmDays, row.crmOpen)}</span>
                              {row.diff ? <span className={`ms-1.5 rounded-md px-1.5 font-bold ${row.diff > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>{row.diff > 0 ? '+' : ''}{row.diff}</span> : null}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {rate && row.partnerDays !== null ? (
                            <>
                              <div className="font-bold text-slate-900">{tenge(row.partnerDays * rate)}</div>
                              {compare && row.diff ? <div className={`text-[11px] font-semibold ${row.diff > 0 ? 'text-rose-600' : 'text-amber-700'}`}>{row.diff > 0 ? '+' : ''}{tenge(row.diff * rate)} к CRM</div> : null}
                            </>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-2.5 px-3 min-w-[220px]">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${STATUS[row.status].tone}`}>{STATUS[row.status].label}</span>
                          {row.issues.length > 0 && <ul className="mt-1 space-y-0.5 text-[11px] text-slate-500">{row.issues.map(issue => <li key={issue}>• {issue}</li>)}</ul>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!visible.length && <p className="py-6 text-center text-xs text-slate-400">Нет фур по этому фильтру{search ? ' и поиску' : ''}.</p>}
            </div>
            <p className="text-[11px] text-slate-400">
              <span className="rounded bg-emerald-100 px-1 font-bold text-emerald-700">✓</span> дата совпадает ·{' '}
              <span className="rounded bg-rose-100 px-1 font-bold text-rose-700">+N дн.</span> у партнёра позже, чем в CRM ·{' '}
              <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">нет в CRM</span> дата есть только у одной стороны.
              Разница дней и суммы: <span className="text-rose-600 font-semibold">+</span> — партнёр выставляет больше, чем по нашим данным.
            </p>
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
