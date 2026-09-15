import React, { useEffect, useState } from 'react';
import { firebaseFetch } from '../../services/firebase-fetch';
import { firebaseApiBase } from '../../../shared/firebase-endpoints';
import type { MailImportSettings, PowerAutomateStatus } from '../../../shared/outlook-import';

const endpoint = firebaseApiBase + '/api/outlook/power-automate/receive';
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm';
const button = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50';
const dateInput = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
async function request<T>(method = 'GET', body?: unknown, suffix = ''): Promise<T> {
  const response = await firebaseFetch('/api/outlook/power-automate' + suffix, { method, signal: AbortSignal.timeout(60000),
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
  async function load(reset = false) {
    const next = await request<PowerAutomateStatus>(); setStatus(next);
    if (reset) setForm(next.settings);
  }
  useEffect(() => {
    void load(true).catch(e => setError(e.message));
    const timer = window.setInterval(() => { void load().catch(e => setError(e.message)); }, 20000);
    return () => window.clearInterval(timer);
  }, []);
  async function save(rotate = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ key?: string }>(rotate ? 'POST' : 'PUT', form, rotate ? '/key' : '');
      if (result.key) setKey(result.key);
      setNotice(rotate ? 'Новый ключ создан. Скопируйте его в HTTP Headers вашего потока. Прежний ключ больше не действует.' : 'Настройки сохранены.');
      await load(true);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const change = <K extends keyof MailImportSettings>(name: K, value: MailImportSettings[K]) => setForm(old => old && ({ ...old, [name]: value }));
  return <section className="min-w-0 space-y-4 rounded-2xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5" aria-label="Подключение Power Automate">
    <div><h4 className="font-bold text-slate-900">Подключение через Power Automate</h4>
      <p className="mt-1 text-sm text-slate-600">Поток Microsoft передаёт письмо с вложениями в CRM. Tenant ID и Client ID здесь не нужны.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800 break-words">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-blue-100 p-3 text-sm text-blue-900">{notice}</p>}
    {!form && !error && <p className="text-sm">Загружаю настройки…</p>}
    {status && form && <>
      <p className="text-sm text-slate-600"><strong>{status.settings.enabled && status.configured ? 'Приём писем включён' : 'Приём писем выключен'}</strong>
        {' · '}{status.lastReceived ? 'Последнее письмо принято: ' + new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(new Date(status.lastReceived)) + ' (Алматы)' : 'Писем от потока ещё не принято'}</p>
      {status.lastError && <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 break-words">
        <p className="font-semibold">Последняя неудачная попытка{status.lastErrorAt && Number.isFinite(Date.parse(status.lastErrorAt)) ? ': ' + new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Almaty' }).format(new Date(status.lastErrorAt)) + ' (Алматы)' : ''}</p>
        <p>{status.lastError}</p>
        <p className="text-xs">Это результат предыдущей передачи письма. Сохранение настроек не запускает повторную проверку. После успешного приёма письма сообщение исчезнет.</p>
      </div>}
      <fieldset disabled={busy} className="space-y-4 min-w-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">Рабочий почтовый адрес<input className={field} type="email" value={form.mailbox} onChange={e => change('mailbox', e.target.value)} /></label>
          <label className="text-sm">Письма от логиста<input className={field} type="email" value={form.sender} onChange={e => change('sender', e.target.value)} /></label>
          <label className="text-sm">Принимать письма начиная с<input className={field} type="date" value={dateInput(form.importFrom)} max={dateInput(new Date().toISOString())} onChange={e => { if (e.target.value) change('importFrom', new Date(e.target.value + 'T00:00:00+05:00').toISOString()); }} /></label>
          <label className="text-sm">Ожидаемый срок перевозки, дней<input className={field} type="number" min="1" max="180" value={form.travelDays} onChange={e => change('travelDays', Number(e.target.value))} /></label>
        </div>
        <p className="text-xs text-slate-500">Если у ящика несколько адресов, используйте один и тот же адрес во всех настройках импорта CRM.</p>
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
