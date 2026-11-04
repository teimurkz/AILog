import React from 'react';
import { BookPlus, CheckCircle2, Download, FileText, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import type { RegionalTruckOrder } from '../../types';
import {
  TTN_REMEMBERED_FIELDS, TTN_SHIPPER, amountInWords, consigneeLine, emptyTtnItem, findConsignee, massInWords, toNumber, ttnTotals,
  type TtnConsignee, type TtnDocument, type TtnItem, type TtnRemembered,
} from '../../../shared/ttn';
import { orderWaybills, readWaybill, type WaybillResult } from '../../utils/ttn-waybill';
import { downloadTtn } from '../../utils/ttn-excel';
import { useSectionText } from '../../i18n/useSectionText';
import { TTN_TEXT } from './ttn-i18n';
import { ConsigneeForm } from './ConsigneeForm';
import { useTtnConsignees } from '../../hooks/useTtnConsignees';
import { cn } from '../../lib/utils';

const REMEMBERED_KEY = 'crm.ttn.remembered';
const draftKey = (orderId: string) => `crm.ttn.draft.${orderId}`;

const readStored = <T,>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
};
const store = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the form still works */ }
};

const today = () => new Date().toISOString().slice(0, 10);

function newDocument(order: RegionalTruckOrder): TtnDocument {
  const remembered = readStored<TtnRemembered>(REMEMBERED_KEY) || {};
  const point = order.deliveryPoints?.find(entry => entry.address);
  return {
    number: '', date: today(), vehicle: order.assignedTruckPlate || '', trailer: '', waybillSheet: '',
    carrier: remembered.carrier || '', driver: order.assignedDriver || '', transportKind: remembered.transportKind || 'АВТО',
    customer: remembered.customer || '', shipper: TTN_SHIPPER, consignee: point?.recipientName || '',
    loadingPoint: remembered.loadingPoint || '',
    unloadingPoint: [order.destinationCity, order.deliveryAddress || point?.address].filter(Boolean).join(', '),
    releasedBy: remembered.releasedBy || '', poaNumber: '', poaDate: '', poaIssuedBy: '', grossKg: null, items: [],
  };
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const format = (value: number | null, digits: number) =>
  value === null ? '' : value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** A number typed the way people type it ("2 800,5"): kept as text while editing, read on blur. */
const NumberInput = ({ value, onChange, digits, label, className }: {
  value: number | null; onChange: (value: number | null) => void; digits: number; label: string; className?: string;
}) => {
  const [text, setText] = React.useState<string | null>(null);
  return (
    <input
      inputMode="decimal" aria-label={label} dir="ltr"
      value={text ?? (value === null ? '' : String(value).replace('.', ','))}
      onChange={event => setText(event.target.value)}
      onBlur={() => { if (text !== null) onChange(text.trim() ? toNumber(text) : null); setText(null); }}
      title={format(value, digits)}
      className={cn('w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-end text-xs tabular-nums dark:border-slate-600 dark:bg-slate-900', className)}
    />
  );
};

const Field = ({ label, value, onChange, wide, type = 'text' }: {
  label: string; value: string; onChange: (value: string) => void; wide?: boolean; type?: string;
}) => (
  <label className={cn('flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400', wide && 'sm:col-span-2')}>
    {label}
    <input type={type} value={value} onChange={event => onChange(event.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" />
  </label>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h4>
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
  </section>
);

/** «Печать ТТН»: form 1-Т for a regional order, goods read from the attached waybills, saved as Excel in the 1C layout. */
export const TtnModal = ({ order, onClose }: { order: RegionalTruckOrder; onClose: () => void }) => {
  const { text: t } = useSectionText(TTN_TEXT);
  const [document, setDocument] = React.useState<TtnDocument>(() => {
    const draft = readStored<TtnDocument>(draftKey(order.id));
    return draft ? { ...draft, shipper: draft.shipper || TTN_SHIPPER } : newDocument(order);
  });
  const { consignees, saveConsignee } = useTtnConsignees();
  /** The receiving company as the waybill names it, to look up in the directory. */
  const [waybillConsignee, setWaybillConsignee] = React.useState('');
  const [addingConsignee, setAddingConsignee] = React.useState(false);
  const [reading, setReading] = React.useState(false);
  const [results, setResults] = React.useState<WaybillResult[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const waybills = React.useMemo(() => orderWaybills(order), [order]);

  const set = <K extends keyof TtnDocument>(key: K) => (value: TtnDocument[K]) => setDocument(current => ({ ...current, [key]: value }));
  const setItem = (index: number, patch: Partial<TtnItem>) => setDocument(current => ({
    ...current,
    items: current.items.map((item, at) => {
      if (at !== index) return item;
      const next = { ...item, ...patch };
      // Quantity × price gives the sum, as in 1C; a typed sum stays as typed.
      if (('quantity' in patch || 'price' in patch) && next.quantity !== null && next.price !== null) next.sum = round2(next.quantity * next.price);
      return next;
    }),
  }));

  const fillFromWaybills = React.useCallback(async (confirmReplace: boolean) => {
    if (confirmReplace && document.items.length && !window.confirm(t.replaceGoods)) return;
    setReading(true);
    const read = await Promise.all(waybills.map(readWaybill));
    setResults(read);
    const items = read.flatMap(result => result.items);
    const details = read.flatMap(result => result.status === 'ok' ? [result.details] : []);
    const first = (key: keyof typeof details[number]) => details.find(entry => entry[key])?.[key] || '';
    if (items.length) setDocument(current => ({
      ...current,
      items,
      // The waybill names the receiving company; the order only has a contact person.
      consignee: first('consignee') || current.consignee,
      releasedBy: current.releasedBy || first('releasedBy'),
    }));
    setWaybillConsignee(first('consignee'));
    setReading(false);
  }, [document.items.length, t.replaceGoods, waybills]);

  // A new TTN starts from the waybills straight away; a saved draft keeps its lines.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!document.items.length && waybills.length) void fillFromWaybills(false);
  }, [document.items.length, fillFromWaybills, waybills.length]);

  React.useEffect(() => { store(draftKey(order.id), document); }, [document, order.id]);

  const applyConsignee = React.useCallback((entry: TtnConsignee) => setDocument(current => ({
    ...current,
    consignee: consigneeLine(entry),
    unloadingPoint: entry.unloadingPoint || current.unloadingPoint,
  })), []);

  // Like 1C: the company named on the waybill brings its requisites from the directory.
  const waybillMatch = React.useMemo(() => findConsignee(consignees, waybillConsignee), [consignees, waybillConsignee]);
  React.useEffect(() => {
    if (waybillMatch && document.consignee === waybillConsignee) applyConsignee(waybillMatch);
  }, [applyConsignee, document.consignee, waybillConsignee, waybillMatch]);
  const selectedConsignee = consignees.find(entry => consigneeLine(entry) === document.consignee);

  const totals = ttnTotals(document);
  const linesHaveMass = document.items.some(item => item.grossKg !== null);

  const download = async () => {
    if (!document.items.length) { setError(t.needGoods); return; }
    setSaving(true);
    setError(null);
    try {
      store(REMEMBERED_KEY, Object.fromEntries(TTN_REMEMBERED_FIELDS.map(key => [key, document[key]])));
      await downloadTtn(document, `TTN_${(document.number || order.orderNumber).replace(/[^\wА-Яа-яЁё-]+/g, '_')}.xlsx`);
    } catch (failure) {
      console.error('TTN export failed:', failure);
      setError(t.downloadFailed);
    } finally {
      setSaving(false);
    }
  };

  const resultText = (result: WaybillResult) => {
    const name = result.file.label || result.file.fileName;
    if (result.status === 'ok') return t.readOk(name, result.items.length);
    if (result.status === 'empty') return t.readEmpty(name);
    if (result.status === 'unsupported') return t.readUnsupported(name);
    return t.readFailed(name);
  };

  const cellInput = 'w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs dark:border-slate-600 dark:bg-slate-900';

  return (
    <div className="crm-dialog-overlay fixed inset-0 z-50 flex items-start justify-center bg-slate-950/50 p-3 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="my-4 w-full max-w-6xl rounded-2xl bg-white shadow-2xl dark:bg-slate-800" onMouseDown={event => event.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={t.title(order.orderNumber)}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-4 dark:border-slate-700 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600 dark:bg-blue-950/50"><FileText className="h-5 w-5" /></div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t.title(order.orderNumber)}</h3>
              <p className="mt-0.5 text-sm text-slate-500">{t.subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={t.cancel}><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-6 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Section title={t.transport}>
              <Field label={t.number} value={document.number} onChange={set('number')} />
              <Field label={t.date} type="date" value={document.date} onChange={set('date')} />
              <Field label={t.vehicle} value={document.vehicle} onChange={set('vehicle')} wide />
              <Field label={t.trailer} value={document.trailer} onChange={set('trailer')} wide />
              <Field label={t.driver} value={document.driver} onChange={set('driver')} wide />
              <Field label={t.waybillSheet} value={document.waybillSheet} onChange={set('waybillSheet')} />
              <Field label={t.transportKind} value={document.transportKind} onChange={set('transportKind')} />
            </Section>
            <Section title={t.parties}>
              <Field label={t.carrier} value={document.carrier} onChange={set('carrier')} wide />
              <Field label={t.customer} value={document.customer} onChange={set('customer')} wide />
              <Field label={t.shipper} value={document.shipper} onChange={set('shipper')} wide />
              <div className="space-y-1.5 sm:col-span-2">
                <Field label={t.consignee} value={document.consignee} onChange={set('consignee')} />
                <div className="flex gap-1.5">
                  <select value={selectedConsignee?.id || ''} aria-label={t.pickConsignee}
                    onChange={event => { const entry = consignees.find(item => item.id === event.target.value); if (entry) applyConsignee(entry); }}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                    <option value="">{t.pickConsignee}</option>
                    {consignees.map(entry => <option key={entry.id} value={entry.id}>{entry.name}{entry.bin ? ` · ${entry.bin}` : ''}</option>)}
                  </select>
                  {!selectedConsignee && !addingConsignee && (
                    <button type="button" onClick={() => setAddingConsignee(true)}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
                      <BookPlus className="h-3.5 w-3.5" /> {t.toDirectory}
                    </button>
                  )}
                </div>
                {selectedConsignee && <p className="flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {t.fromDirectory}</p>}
                {!selectedConsignee && waybillConsignee && !waybillMatch && !addingConsignee && <p className="text-xs text-amber-600">{t.notInDirectory(waybillConsignee)}</p>}
                {addingConsignee && (
                  <ConsigneeForm
                    initial={{ name: waybillConsignee || document.consignee, bin: '', address: '', unloadingPoint: '' }}
                    onCancel={() => setAddingConsignee(false)}
                    onSave={async draft => { applyConsignee(await saveConsignee(draft)); setAddingConsignee(false); }}
                  />
                )}
              </div>
              <Field label={t.loadingPoint} value={document.loadingPoint} onChange={set('loadingPoint')} wide />
              <Field label={t.unloadingPoint} value={document.unloadingPoint} onChange={set('unloadingPoint')} wide />
            </Section>
            <Section title={t.signatures}>
              <Field label={t.releasedBy} value={document.releasedBy} onChange={set('releasedBy')} wide />
              <Field label={t.poaNumber} value={document.poaNumber} onChange={set('poaNumber')} />
              <Field label={t.poaDate} type="date" value={document.poaDate} onChange={set('poaDate')} />
              <Field label={t.poaIssuedBy} value={document.poaIssuedBy} onChange={set('poaIssuedBy')} wide />
            </Section>
          </div>
          <p className="text-xs text-slate-400">{t.remembered}</p>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t.goods}</h4>
              <div className="flex gap-2">
                {waybills.length > 0 && (
                  <button type="button" onClick={() => void fillFromWaybills(true)} disabled={reading}
                    className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
                    {reading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {reading ? t.reading : t.fromWaybills}
                  </button>
                )}
                <button type="button" onClick={() => setDocument(current => ({ ...current, items: [...current.items, emptyTtnItem()] }))}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300">
                  <Plus className="h-3.5 w-3.5" /> {t.addRow}
                </button>
              </div>
            </div>
            {!waybills.length && <p className="text-xs text-amber-600">{t.noWaybills}</p>}
            {results && (
              <ul className="space-y-0.5 text-xs">
                {results.map((result, index) => (
                  <li key={index} className={result.status === 'ok' ? 'text-emerald-600' : 'text-amber-600'}>{resultText(result)}</li>
                ))}
              </ul>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full min-w-[980px] text-xs">
                <thead className="bg-slate-50 text-slate-500 dark:bg-slate-900/60">
                  <tr>
                    {[t.code, t.name, t.unit, t.quantity, t.price, t.sum, t.documents, t.packaging, t.places, t.grossKg].map(label => (
                      <th key={label} className="px-1.5 py-2 text-start font-semibold">{label}</th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {document.items.map((item, index) => (
                    <tr key={index} className="border-t border-slate-100 align-top dark:border-slate-700">
                      <td className="w-24 p-1"><input aria-label={t.code} value={item.code} onChange={event => setItem(index, { code: event.target.value })} className={cellInput} /></td>
                      <td className="p-1"><textarea aria-label={t.name} rows={1} value={item.name} onChange={event => setItem(index, { name: event.target.value })} className={cn(cellInput, 'min-w-[220px] resize-y')} /></td>
                      <td className="w-14 p-1"><input aria-label={t.unit} value={item.unit} onChange={event => setItem(index, { unit: event.target.value })} className={cellInput} /></td>
                      <td className="w-24 p-1"><NumberInput label={t.quantity} digits={3} value={item.quantity} onChange={value => setItem(index, { quantity: value })} /></td>
                      <td className="w-24 p-1"><NumberInput label={t.price} digits={2} value={item.price} onChange={value => setItem(index, { price: value })} /></td>
                      <td className="w-28 p-1"><NumberInput label={t.sum} digits={2} value={item.sum} onChange={value => setItem(index, { sum: value })} /></td>
                      <td className="w-32 p-1"><input aria-label={t.documents} value={item.documents} onChange={event => setItem(index, { documents: event.target.value })} className={cellInput} /></td>
                      <td className="w-20 p-1"><input aria-label={t.packaging} value={item.packaging} onChange={event => setItem(index, { packaging: event.target.value })} className={cellInput} /></td>
                      <td className="w-16 p-1"><NumberInput label={t.places} digits={0} value={item.places} onChange={value => setItem(index, { places: value })} /></td>
                      <td className="w-24 p-1"><NumberInput label={t.grossKg} digits={3} value={item.grossKg} onChange={value => setItem(index, { grossKg: value })} /></td>
                      <td className="p-1">
                        <button type="button" onClick={() => setDocument(current => ({ ...current, items: current.items.filter((_, at) => at !== index) }))}
                          className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500" title={t.removeRow} aria-label={t.removeRow}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!document.items.length && (
                    <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">{reading ? t.reading : t.noGoods}</td></tr>
                  )}
                </tbody>
                {document.items.length > 0 && (
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200">
                    <tr>
                      <td colSpan={3} className="px-2 py-2">{t.total}</td>
                      <td className="px-2 py-2 text-end tabular-nums" dir="ltr">{format(totals.quantity, 3)}</td>
                      <td />
                      <td className="px-2 py-2 text-end tabular-nums" dir="ltr">{format(totals.sum, 2)}</td>
                      <td colSpan={2} />
                      <td className="px-2 py-2 text-end tabular-nums" dir="ltr">{totals.places ? format(totals.places, 0) : ''}</td>
                      <td className="px-2 py-2 text-end tabular-nums" dir="ltr">{linesHaveMass ? format(totals.grossKg, 3) : ''}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr]">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
                {t.totalGrossKg}
                {linesHaveMass
                  ? <span className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200" dir="ltr">{format(totals.grossKg, 3)} <span className="text-xs text-slate-400">({t.grossFromLines})</span></span>
                  : <NumberInput label={t.totalGrossKg} digits={3} value={document.grossKg} onChange={set('grossKg')} className="py-1.5 text-sm" />}
              </label>
              <div className="space-y-1 text-xs text-slate-500" lang="ru" dir="ltr">
                <div className="font-medium">{t.inWords}</div>
                {totals.sum > 0 && <div className="text-slate-700 dark:text-slate-200">{amountInWords(totals.sum)}</div>}
                {totals.grossKg ? <div className="text-slate-700 dark:text-slate-200">{massInWords(totals.grossKg)}</div> : null}
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 p-4 dark:border-slate-700 sm:p-5">
          {error && <span className="me-auto text-sm text-red-600">{error}</span>}
          <button onClick={onClose} className="crm-button-secondary rounded-lg border px-3 py-2 text-xs font-semibold">{t.cancel}</button>
          <button onClick={() => void download()} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {saving ? t.downloading : t.download}
          </button>
        </div>
      </div>
    </div>
  );
};
