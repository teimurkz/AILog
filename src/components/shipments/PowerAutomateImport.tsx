import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { firebaseFetch } from '../../services/firebase-fetch';
import { firebaseApiBase } from '../../../shared/firebase-endpoints';
import { SHIPMENT_ROUTES, autoShipmentName, type MailImportSettings, type MailRefreshResult, type PowerAutomateStatus } from '../../../shared/outlook-import';

const endpoint = firebaseApiBase + '/api/outlook/power-automate/receive';
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const button = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50';
const dateInput = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const almatyText = (value: string) => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(new Date(value));
const dayText = (value: string) => value.split('-').reverse().join('.');
async function request<T>(method = 'GET', body?: unknown, suffix = '', timeout = 60000): Promise<T> {
  const response = await firebaseFetch('/api/outlook/power-automate' + suffix, { method, signal: AbortSignal.timeout(timeout),
    headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Обновите функцию crmApi в Firebase для подключения Power Automate.');
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 404 ? 'Обновите функцию crmApi в Firebase для подключения Power Automate.' : result.error || 'Не удалось получить настройки.');
  return result;
}
export function PowerAutomateImport() {
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
    return rotate ? 'Новый ключ создан. Скопируйте его в HTTP Headers вашего потока. Прежний ключ больше не действует.' : 'Настройки сохранены.';
  });
  const saveFlowUrl = (url: string | null) => run(async () => {
    await request('PUT', { url }, '/refresh-url');
    setFlowUrl(''); await load();
    return url ? 'Ссылка потока «Обновить отправления» сохранена.' : 'Ссылка потока удалена.';
  });
  const refresh = () => run(async () => {
    const result = await request<MailRefreshResult>('POST', period, '/refresh', 290000);
    await load();
    return `Запрос отправлен в Power Automate: ${result.days} дн. (${dayText(result.from)} — ${dayText(result.to)}). Письма придут в течение нескольких минут; уже загруженные пропускаются.`
      + (result.rechecked ? ` Повторно проверено писем из «Нужна проверка»: ${result.rechecked}, из них разобрано: ${result.resolved}.` : '');
  });
  const change = <K extends keyof MailImportSettings>(name: K, value: MailImportSettings[K]) => setForm(old => old && ({ ...old, [name]: value }));
  return <section className="min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5" aria-label="Подключение Power Automate">
    <div><h4 className="font-bold text-slate-900">Подключение через Power Automate</h4>
      <p className="mt-1 text-sm text-slate-600">Поток Microsoft передаёт письмо с вложениями в CRM, и CRM сама создаёт или дополняет отправления. Tenant ID и Client ID здесь не нужны.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 break-words">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-blue-100 p-3 text-sm text-blue-900">{notice}</p>}
    {!form && !error && <p className="text-sm">Загружаю настройки…</p>}
    {status && form && <>
      <p className="text-sm text-slate-600"><strong>{status.settings.enabled && status.configured ? 'Приём писем включён' : 'Приём писем выключен'}</strong>
        {' · '}{status.lastReceived ? 'Последнее письмо принято: ' + almatyText(status.lastReceived) + ' (Алматы)' : 'Писем от потока ещё не принято'}</p>
      {status.lastError && <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 break-words">
        <p className="font-semibold">Последняя неудачная попытка{status.lastErrorAt && Number.isFinite(Date.parse(status.lastErrorAt)) ? ': ' + almatyText(status.lastErrorAt) + ' (Алматы)' : ''}</p>
        <p>{status.lastError}</p>
        <p className="text-xs">Это результат предыдущей передачи письма. Сохранение настроек не запускает повторную проверку. После успешного приёма письма сообщение исчезнет.</p>
      </div>}

      <div className="space-y-3 rounded-xl border border-emerald-200 bg-white p-3 sm:p-4">
        <div>
          <p className="font-semibold text-slate-900">Обновить отправления за период</p>
          <p className="mt-0.5 text-xs text-slate-500">Power Automate заново отправит в CRM письма за выбранные дни. Новые отправления создадутся с датами и документами, уже загруженные письма пропускаются. Письма из «Нужна проверка» за этот период проверяются повторно.</p>
        </div>
        {status.refreshConfigured ? <>
          <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">С<input className={field} type="date" value={period.from} max={period.to} onChange={e => setPeriod(old => ({ ...old, from: e.target.value }))} /></label>
            <label className="text-sm">По<input className={field} type="date" value={period.to} min={period.from} max={today} onChange={e => setPeriod(old => ({ ...old, to: e.target.value }))} /></label>
            <button className={`${button} flex items-center gap-2 bg-emerald-600 text-white`} disabled={!period.from || !period.to || !status.settings.enabled} onClick={refresh}>
              <RefreshCw className={'h-4 w-4' + (busy ? ' animate-spin' : '')} />Обновить отправления
            </button>
          </fieldset>
          {status.lastRefresh && <p className="text-xs text-slate-500">Последнее обновление: {almatyText(status.lastRefresh.requestedAt)} (Алматы), период {dayText(status.lastRefresh.from)} — {dayText(status.lastRefresh.to)}.</p>}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">Поток подключён ({status.refreshHost}). Заменить ссылку</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={field + ' mt-0 flex-1'} value={flowUrl} onChange={e => setFlowUrl(e.target.value)} placeholder="Новая ссылка HTTP POST URL" autoComplete="off" />
              <button className={`${button} bg-slate-900 text-white`} disabled={busy || !flowUrl.trim()} onClick={() => saveFlowUrl(flowUrl.trim())}>Сохранить</button>
              <button className={`${button} bg-white text-slate-700 border border-slate-200`} disabled={busy} onClick={() => saveFlowUrl(null)}>Удалить</button>
            </div>
          </details>
        </> : <div className="space-y-2">
          <p className="text-sm text-slate-600">Один раз создайте в Power Automate поток «Обновить отправления» по инструкции POWER-AUTOMATE.md и вставьте сюда ссылку <strong>HTTP POST URL</strong> из его триггера «When a HTTP request is received».</p>
          <div className="flex flex-wrap gap-2">
            <input className={field + ' mt-0 flex-1'} value={flowUrl} onChange={e => setFlowUrl(e.target.value)} placeholder="https://…logic.azure.com/workflows/…" autoComplete="off" />
            <button className={`${button} bg-slate-900 text-white`} disabled={busy || !flowUrl.trim()} onClick={() => saveFlowUrl(flowUrl.trim())}>Сохранить ссылку</button>
          </div>
          <p className="text-xs text-slate-500">Ссылка хранится только на сервере и в браузер больше не передаётся.</p>
        </div>}
      </div>

      <fieldset disabled={busy} className="space-y-4 min-w-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Рабочий почтовый адрес<input className={field} type="email" value={form.mailbox} onChange={e => change('mailbox', e.target.value)} /></label>
          <label className="text-sm">Письма от<input className={field} value={form.sender} onChange={e => change('sender', e.target.value)} placeholder="@solico-group.ir, @solico-group.com" autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">Через запятую: адреса или целые домены, например al.babaei@solico-group.ir, @solico-group.ir. Домен принимает письма любого сотрудника компании.</span></label>
          <label className="text-sm">Принимать письма начиная с<input className={field} type="date" value={dateInput(form.importFrom)} max={today} onChange={e => { if (e.target.value) change('importFrom', new Date(e.target.value + 'T00:00:00+05:00').toISOString()); }} /></label>
          <label className="text-sm">Ожидаемый срок перевозки, дней<input className={field} type="number" min="1" max="180" value={form.travelDays} onChange={e => change('travelDays', Number(e.target.value))} /></label>
          <label className="text-sm">Название для писем без Excel<input className={field} value={form.namePrefix || ''} onChange={e => change('namePrefix', e.target.value)} placeholder="Например: Mehkaz" maxLength={40} autoComplete="off" />
            <span className="mt-1 block text-xs text-slate-500">Письмо «478» со сканами создаст отправление «{autoShipmentName('478', form.namePrefix)}». Когда придёт Excel этого инвойса, CRM дополнит его маршрутом, товарами и номером машины.</span></label>
          <label className="text-sm">Маршрут для писем без Excel<select className={field} value={form.defaultRoute || 'Amol - Almaty'} onChange={e => change('defaultRoute', e.target.value as MailImportSettings['defaultRoute'])}>
            {SHIPMENT_ROUTES.map(route => <option key={route} value={route}>{route}</option>)}
          </select><span className="mt-1 block text-xs text-slate-500">По сканам маршрут не определить; Excel позже его уточнит.</span></label>
        </div>
        <p className="text-xs text-slate-500">Если у ящика несколько адресов, используйте один и тот же адрес во всех настройках импорта CRM. В потоке Power Automate поле From в триггере оставьте пустым: отправителей отбирает CRM по списку выше.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => change('enabled', e.target.checked)} />Принимать письма от Power Automate</label>
        <div className="flex flex-wrap gap-2">
          <button className={`${button} bg-blue-600 text-white`} onClick={() => save()}>Сохранить настройки</button>
          <button className={`${button} bg-slate-900 text-white`} onClick={() => save(true)}>{status.configured ? 'Заменить ключ подключения' : 'Создать ключ подключения'}</button>
        </div>
      </fieldset>
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 text-sm min-w-0">
        <p className="font-semibold">Для действия HTTP в Power Automate</p>
        <label className="block">URI<input readOnly className={field} value={endpoint} onFocus={e => e.currentTarget.select()} /></label>
        <p><strong>Method:</strong> POST</p>
        <p><strong>Header Content-Type:</strong> message/rfc822</p>
        <p className="break-words"><strong>Header X-CRM-Received-At:</strong> Received Time из триггера письма</p>
        {key ? <label className="block">Header X-CRM-Ingest-Key<input readOnly className={field + ' font-mono'} value={key} onFocus={e => e.currentTarget.select()} />
          <span className="mt-1 block text-xs text-slate-500">Ключ показывается один раз. Скопируйте его в поток; после закрытия панели восстановить его нельзя.</span></label> : <p className="text-slate-500">X-CRM-Ingest-Key: создайте ключ кнопкой выше и сохраните его в потоке.</p>}
        <p><strong>Body:</strong> Body действия Export email (V2). Полное письмо до 25 МБ.</p>
        <p className="text-xs text-slate-500">В настройках HTTP включите Secure inputs и Secure outputs, чтобы ключ и документы не отображались в истории запусков потока.</p>
      </div>
    </>}
  </section>;
}
