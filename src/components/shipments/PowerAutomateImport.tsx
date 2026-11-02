import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { firebaseFetch } from '../../services/firebase-fetch';
import { firebaseApiBase } from '../../../shared/firebase-endpoints';
import { useSectionText } from '../../i18n/useSectionText';
import { SHIPMENTS_TEXT, shipmentDateTime } from './shipments-i18n';
import { SHIPMENT_ROUTES, autoShipmentName, type MailImportSettings, type MailRefreshResult, type PowerAutomateStatus } from '../../../shared/outlook-import';

const endpoint = firebaseApiBase + '/api/outlook/power-automate/receive';
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const button = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50';
const dateInput = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
type RequestTexts = { updateFunction: string; loadFailed: string };
async function requestPowerAutomate<T>(errors: RequestTexts, method = 'GET', body?: unknown, suffix = '', timeout = 60000): Promise<T> {
  const response = await firebaseFetch('/api/outlook/power-automate' + suffix, { method, signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(errors.updateFunction);
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 404 ? errors.updateFunction : result.error || errors.loadFailed);
  return result;
}
export function PowerAutomateImport() {
  const { text: sectionText, locale } = useSectionText(SHIPMENTS_TEXT);
  const text = sectionText.powerAutomate;
  // load() also runs from a timer started once; the ref keeps its error texts in the current language.
  const textRef = useRef(text);
  textRef.current = text;
  const request = <T,>(method?: string, body?: unknown, suffix?: string, timeout?: number) => requestPowerAutomate<T>(textRef.current, method, body, suffix, timeout);
  const almatyText = (value: string) => shipmentDateTime(value, locale, 'Asia/Almaty');
  // Period days come as yyyy-mm-dd and are shown as written, without a time zone shift.
  const dayText = (value: string) => new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
  const [status, setStatus] = useState<PowerAutomateStatus>();
  const [form, setForm] = useState<MailImportSettings>();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const today = dateInput(new Date().toISOString());
  const [period, setPeriod] = useState({ from: dateInput(new Date(Date.now() - 7 * 86400000).toISOString()), to: today });
  const [flowUrl, setFlowUrl] = useState('');
  async function load(reset = false) {
    const next = await request<PowerAutomateStatus>(); setStatus(next);
    if (reset) setForm(next.settings);
  }
  useEffect(() => {
    void load(true).catch(e => setError(e.message));
    const timer = window.setInterval(() => { void load().catch(e => setError(e.message)); }, 20000);
    return () => window.clearInterval(timer);
  }, []);
  async function run(work: () => Promise<string | void>) {
    setBusy(true); setError(''); setNotice('');
    try { const message = await work(); if (message) setNotice(message); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const save = (rotate = false) => run(async () => {
    const result = await request<{ key?: string }>(rotate ? 'POST' : 'PUT', form, rotate ? '/key' : '');
    if (result.key) setKey(result.key);
    await load(true);
    return rotate ? text.keyCreated : text.settingsSaved;
  });
  const saveFlowUrl = (url: string | null) => run(async () => {
    await request('PUT', { url }, '/refresh-url');
    setFlowUrl(''); await load();
    return url ? text.flowUrlSaved : text.flowUrlRemoved;
  });
  const refresh = () => run(async () => {
    const result = await request<MailRefreshResult>('POST', period, '/refresh', 290000);
    await load();
    return text.refreshSent(result.days, dayText(result.from), dayText(result.to))
      + (result.rechecked ? text.refreshRechecked(result.rechecked, result.resolved) : '');
  });
  const change = <K extends keyof MailImportSettings>(name: K, value: MailImportSettings[K]) => setForm(old => old && ({ ...old, [name]: value }));
  // A refresh takes Power Automate a while; a second click would only run in parallel with it.
  const refreshStarted = Date.parse(status?.lastRefresh?.requestedAt || '');
  const refreshBusyUntil = Number.isFinite(refreshStarted) ? refreshStarted + 15 * 60000 : 0;
  const refreshBusy = refreshBusyUntil > Date.now();
  return <section className="min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5" aria-label={text.sectionLabel}>
    <div><h4 className="font-bold text-slate-900">{text.title}</h4>
      <p className="mt-1 text-sm text-slate-600">{text.subtitle}</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 break-words">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-blue-100 p-3 text-sm text-blue-900">{notice}</p>}
    {!form && !error && <p className="text-sm">{text.loading}</p>}
    {status && form && <>
      <p className="text-sm text-slate-600"><strong>{status.settings.enabled && status.configured ? text.receivingOn : text.receivingOff}</strong>
        {' · '}{status.lastReceived ? text.lastReceived(almatyText(status.lastReceived)) : text.noneReceived}</p>
      {status.lastError && <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 break-words">
        <p className="font-semibold">{status.lastErrorAt && Number.isFinite(Date.parse(status.lastErrorAt)) ? text.lastFailureAt(almatyText(status.lastErrorAt)) : text.lastFailure}</p>
        <p>{status.lastError}</p>
        <p className="text-xs">{text.failureHint}</p>
      </div>}

      <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-3 sm:p-4">
        <div>
          <p className="font-semibold text-slate-900">{text.refreshTitle}</p>
          <p className="mt-0.5 text-xs text-slate-500">{text.refreshHint}</p>
        </div>
        {status.refreshConfigured ? <>
          <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">{text.from}<input className={field} type="date" value={period.from} max={period.to} onChange={e => setPeriod(old => ({ ...old, from: e.target.value }))} /></label>
            <label className="text-sm">{text.to}<input className={field} type="date" value={period.to} min={period.from} max={today} onChange={e => setPeriod(old => ({ ...old, to: e.target.value }))} /></label>
            <button className={`${button} flex items-center gap-2 bg-emerald-600 text-white`} disabled={!period.from || !period.to || !status.settings.enabled || refreshBusy} onClick={refresh}>
              <RefreshCw className={'h-4 w-4' + (busy ? ' animate-spin' : '')} />{text.refresh}
            </button>
          </fieldset>
          {status.lastRefresh && <p className="text-xs text-slate-500">{text.lastRefresh(almatyText(status.lastRefresh.requestedAt), dayText(status.lastRefresh.from), dayText(status.lastRefresh.to))}</p>}
          {refreshBusy && <p className="text-xs font-medium text-amber-700">{text.refreshBusy(almatyText(new Date(refreshBusyUntil).toISOString()))}</p>}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{text.flowConnected(status.refreshHost || '')}</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={field + ' mt-0 flex-1'} value={flowUrl} onChange={e => setFlowUrl(e.target.value)} placeholder={text.newFlowUrl} autoComplete="off" />
              <button className={`${button} bg-slate-900 text-white`} disabled={busy || !flowUrl.trim()} onClick={() => saveFlowUrl(flowUrl.trim())}>{text.save}</button>
              <button className={`${button} bg-white text-slate-700 border border-slate-200`} disabled={busy} onClick={() => saveFlowUrl(null)}>{text.remove}</button>
            </div>
          </details>
        </> : <div className="space-y-2">
          <p className="text-sm text-slate-600">{text.createFlow}</p>
          <div className="flex flex-wrap gap-2">
            <input className={field + ' mt-0 flex-1'} value={flowUrl} onChange={e => setFlowUrl(e.target.value)} placeholder="https://…logic.azure.com/workflows/…" autoComplete="off" />
            <button className={`${button} bg-slate-900 text-white`} disabled={busy || !flowUrl.trim()} onClick={() => saveFlowUrl(flowUrl.trim())}>{text.saveLink}</button>
          </div>
          <p className="text-xs text-slate-500">{text.linkPrivate}</p>
        </div>}
      </div>

      <fieldset disabled={busy} className="space-y-4 min-w-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">{text.mailbox}<input className={field} type="email" value={form.mailbox} onChange={e => change('mailbox', e.target.value)} /></label>
          <label className="text-sm">{text.mailFrom}<input className={field} value={form.sender} onChange={e => change('sender', e.target.value)} placeholder="@solico-group.ir, @solico-group.com" autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">{text.sendersHint}</span></label>
          <label className="text-sm">{text.acceptFrom}<input className={field} type="date" value={dateInput(form.importFrom)} max={today} onChange={e => { if (e.target.value) change('importFrom', new Date(e.target.value + 'T00:00:00+05:00').toISOString()); }} /></label>
          <label className="text-sm">{text.travelDays}<input className={field} type="number" min="1" max="180" value={form.travelDays} onChange={e => change('travelDays', Number(e.target.value))} /></label>
          <label className="text-sm">{text.namePrefix}<input className={field} value={form.namePrefix || ''} onChange={e => change('namePrefix', e.target.value)} placeholder={text.namePrefixPlaceholder} maxLength={40} autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">{text.namePrefixHint(autoShipmentName('478', form.namePrefix))}</span></label>
          <label className="text-sm">{text.defaultRoute}<select className={field} value={form.defaultRoute || 'Amol - Almaty'} onChange={e => change('defaultRoute', e.target.value as MailImportSettings['defaultRoute'])}>
            {SHIPMENT_ROUTES.map(route => <option key={route} value={route}>{route}</option>)}
          </select><span className="mt-1 block text-xs text-slate-500">{text.defaultRouteHint}</span></label>
        </div>
        <p className="text-xs text-slate-500">{text.sameAddress}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => change('enabled', e.target.checked)} />{text.accept}</label>
        <div className="flex flex-wrap gap-2">
          <button className={`${button} bg-blue-600 text-white`} onClick={() => save()}>{text.saveSettings}</button>
          <button className={`${button} bg-slate-900 text-white`} onClick={() => save(true)}>{status.configured ? text.replaceKey : text.createKey}</button>
        </div>
      </fieldset>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-sm min-w-0">
        <p className="font-semibold">{text.httpAction}</p>
        <label className="block">URI<input readOnly className={field} value={endpoint} onFocus={e => e.currentTarget.select()} /></label>
        <p><strong>Method:</strong> POST</p>
        <p><strong>Header Content-Type:</strong> message/rfc822</p>
        <p className="break-words"><strong>Header X-CRM-Received-At:</strong> {text.receivedAtValue}</p>
        {key ? <label className="block">Header X-CRM-Ingest-Key<input readOnly className={field + ' font-mono'} value={key} onFocus={e => e.currentTarget.select()} />
          <span className="mt-1 block text-xs text-slate-500">{text.keyOnce}</span></label> : <p className="text-slate-500">{text.keyMissing}</p>}
        <p><strong>Body:</strong> {text.bodyValue}</p>
        <p className="text-xs text-slate-500">{text.secureHint}</p>
      </div>
    </>}
  </section>;
}
