import React, { useCallback, useEffect, useState } from 'react';
import { Mail, RefreshCw, ExternalLink, AlertCircle } from 'lucide-react';
import { firebaseFetch } from '../../services/firebase-fetch';
import type { OutlookSettings, OutlookStatus, OutlookLogin } from '../../../shared/outlook-import';
import { PowerAutomateImport } from './PowerAutomateImport';

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await firebaseFetch('/api/outlook' + path, { method,
    headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(path === '/run' || path.startsWith('/retry/') ? 290000 : 60000) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Не получен ответ службы импорта Outlook.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос к Outlook.');
  return data;
}
const dateText = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ?
  new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(new Date(value)) : 'Ещё не было';
const dateInput = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100';
const button = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-wait';

export function OutlookImport({ onOpenShipment }: { onOpenShipment: (id: string) => void }) {
  const [status, setStatus] = useState<OutlookStatus>();
  const [form, setForm] = useState<OutlookSettings>();
  const [login, setLogin] = useState<OutlookLogin>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (resetForm = false) => {
    const next = await request<OutlookStatus>('/status');
    setStatus(next);
    if (resetForm) setForm(next.settings);
    return next;
  }, []);
  useEffect(() => {
    void load(true).catch(error => setError(error.message));
    const timer = window.setInterval(() => { void load().catch(error => setError(error.message)); }, 20000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!login) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (Date.now() >= Date.parse(login.expiresAt)) { setLogin(undefined); setError('Время входа истекло. Подключите почту заново.'); return; }
      try {
        const result = await request<{ state: 'pending' | 'connected' }>(`/connect/${login.flowId}/poll`, 'POST');
        if (stopped) return;
        if (result.state === 'connected') {
          setLogin(undefined); setNotice('Почта подключена. Проверьте период и включите автоматический импорт.'); await load(true); return;
        }
        timer = setTimeout(poll, Math.max(login.interval, 5) * 1000);
      } catch (error) { if (!stopped) { setLogin(undefined); setError((error as Error).message); } }
    };
    timer = setTimeout(poll, login.interval * 1000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [login, load]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    await request('/settings', 'PUT', form);
    await load(true);
  }
  const change = <K extends keyof OutlookSettings>(key: K, value: OutlookSettings[K]) => setForm(old => old && ({ ...old, [key]: value }));
  const fresh = status?.lastHeartbeat && Date.now() - Date.parse(status.lastHeartbeat) < 12 * 60000;
  return <section className="min-w-0 rounded-2xl border border-blue-100 bg-white p-4 sm:p-6 space-y-5" aria-label="Импорт отправлений из Outlook">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900"><Mail className="h-5 w-5 text-blue-600" />Отправления из Outlook</h3>
        <p className="mt-1 text-sm text-slate-500">Один инвойс — одна фура. Новые документы дополняют существующее отправление.</p>
      </div>
      <button className={`${button} bg-slate-100 text-slate-700`} disabled={busy} onClick={() => action(async () => { await load(); })}><RefreshCw className="inline h-4 w-4 mr-2" />Обновить статус</button>
    </div>
    <PowerAutomateImport />
    {error && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 break-words"><AlertCircle className="inline h-4 w-4 mr-2" />{error}</div>}
    {notice && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
    {!status && !error && <p className="text-sm text-slate-500">Загружаю состояние подключения…</p>}
    {status && form && <>
      <details className="space-y-4 rounded-xl border border-slate-200 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-700">Прямое подключение через Microsoft Entra</summary>
      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div className="rounded-xl bg-slate-50 p-3 min-w-0"><p className="text-slate-500">Почта</p><p className="font-semibold break-all">{status.connected ? status.connectedMailbox : 'Не подключена'}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">Автоматический импорт</p><p className="font-semibold">{!status.settings.enabled ? 'Выключен' : fresh ? 'Включён, служба на связи' : 'Включён, нет сигнала службы'}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-slate-500">Последняя проверка</p><p className="font-semibold">{dateText(status.lastSuccess)}</p><p className="text-xs text-slate-500">Время Алматы</p></div>
      </div>
      {status.lastError && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{status.lastError}</p>}
      <fieldset disabled={busy || Boolean(login) || status.busy} className="space-y-4 min-w-0">
        <details open={!status.settings.clientId} className="rounded-xl border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Настройки подключения Microsoft</summary>
          <p className="my-3 text-xs text-slate-500">Идентификаторы выдаёт администратор Microsoft 365 при регистрации приложения. Они не являются паролем почты.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-700">Tenant ID<input className={field} value={form.tenantId} disabled={status.connected} onChange={e => change('tenantId', e.target.value.trim())} autoComplete="off" /></label>
            <label className="text-sm text-slate-700">Client ID<input className={field} value={form.clientId} disabled={status.connected} onChange={e => change('clientId', e.target.value.trim())} autoComplete="off" /></label>
          </div>
        </details>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm text-slate-700">Рабочая почта Outlook<input type="email" className={field} value={form.mailbox} disabled={status.connected} onChange={e => change('mailbox', e.target.value)} placeholder="Ваш рабочий адрес" /></label>
          <label className="text-sm text-slate-700">Принимать документы от<input type="email" className={field} value={form.sender} onChange={e => change('sender', e.target.value)} placeholder="Адрес логиста" /></label>
          <label className="text-sm text-slate-700">Импортировать письма начиная с<input type="date" className={field} value={dateInput(form.importFrom)} max={dateInput(new Date().toISOString())} onChange={e => { if (e.target.value) change('importFrom', new Date(e.target.value + 'T00:00:00+05:00').toISOString()); }} /><span className="text-xs text-slate-500">Дата получения письма, время Алматы</span></label>
          <label className="text-sm text-slate-700">Ожидаемый срок перевозки, дней<input type="number" min="1" max="180" className={field} value={form.travelDays} onChange={e => change('travelDays', Number(e.target.value))} /></label>
        </div>
        <label className="flex items-center gap-3 text-sm font-medium text-slate-700"><input type="checkbox" className="h-4 w-4" checked={form.enabled} disabled={!status.connected} onChange={e => change('enabled', e.target.checked)} />Автоматически импортировать новые письма каждые 5 минут</label>
        <div className="flex flex-wrap gap-2">
          <button className={`${button} bg-blue-600 text-white`} onClick={() => action(async () => { await save(); setNotice('Настройки сохранены.'); })}>Сохранить настройки</button>
          {!status.connected ? <button className={`${button} bg-slate-900 text-white`} onClick={() => action(async () => { await save(); setLogin(await request<OutlookLogin>('/connect', 'POST')); })}>Подключить Outlook</button> : <>
            <button className={`${button} bg-emerald-600 text-white`} onClick={() => action(async () => {
              await save(); const result = await request<{ state: string }>('/run', 'POST'); await load();
              setNotice(result.state === 'idle' ? 'Проверка уже выполняется.' : result.state === 'continuing' ? 'Первые письма обработаны. Есть ещё письма: запустите проверку повторно или включите автоматический импорт.' : 'Проверка завершена. Результаты показаны ниже.');
            })}>Импортировать сейчас</button>
            <button className={`${button} bg-slate-100 text-slate-700`} onClick={() => action(async () => { await request('/connection', 'DELETE'); await load(true); setNotice('Почта отключена. Созданные отправления и документы сохранены.'); })}>Отключить почту</button>
          </>}
        </div>
      </fieldset>
      {(busy || status.busy) && <p role="status" className="text-sm text-blue-700">Обрабатываю запрос. Загрузка пакетов документов может занять несколько минут…</p>}
      {login && <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
        <p className="font-semibold text-blue-950">Войдите в Microsoft под рабочей почтой и введите код</p>
        <p className="select-all text-2xl tracking-widest font-mono font-bold text-blue-900">{login.userCode}</p>
        <a href={login.verificationUri} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Открыть Microsoft<ExternalLink className="h-4 w-4" /></a>
        <p className="text-sm text-blue-800">Код действует до {dateText(login.expiresAt)}. После входа подключение появится здесь автоматически.</p>
      </div>}
      <p className="text-xs leading-relaxed text-slate-500">Читаются письма выбранного отправителя, кроме удалённых и спама. Исходное письмо и документы сохраняются в отправлении. Дата первого письма запускает отсчёт; повторная отправка его не обнуляет. Microsoft запрашивает разрешение на чтение почты, отбор по отправителю выполняет CRM.</p>
      </details>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-slate-800">Последние результаты</h4>
        {!status.logs.length && <p className="text-sm text-slate-500">Писем ещё не обработано.</p>}
        {status.logs.map(log => <div key={log.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-slate-100 p-3 text-sm">
          <div className="min-w-0 flex-1 basis-48"><p className="font-semibold text-slate-800 break-words">{log.invoice || log.subject}</p><p className="text-xs text-slate-500">Письмо получено {dateText(log.receivedAt)}</p>
            {log.reason && <p className="mt-1 text-amber-800 break-words">{log.reason}</p>}
          </div>
          <div className="text-right"><p className={log.status === 'review' ? 'text-amber-700' : 'text-emerald-700'}>{log.status === 'created' ? 'Отправление создано' : log.status === 'updated' ? 'Документы дополнены' : 'Нужна проверка'}</p>
            {log.documents !== undefined && <p className="text-xs text-slate-500">Файлов в письме: {log.documents}</p>}
            {log.shipmentId && <button className="mt-1 text-blue-600 underline" onClick={() => onOpenShipment(log.shipmentId!)}>Открыть отправление</button>}
            {log.status === 'review' && <button disabled={busy || status.busy || !status.connected} className="mt-1 text-blue-600 underline disabled:opacity-50" onClick={() => action(async () => { await request(`/retry/${log.id}`, 'POST'); await load(); })}>Проверить повторно</button>}
          </div>
        </div>)}
      </div>
    </>}
  </section>;
}
