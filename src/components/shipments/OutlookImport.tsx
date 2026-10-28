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
// Choose the shipment a "needs review" email belongs to. Typing narrows the list by invoice name.
function LinkPicker({ shipments, value, busy, onChange, onCancel, onSubmit }: {
  shipments: ShipmentOption[]; value: { shipmentId: string; filter: string }; busy: boolean;
  onChange: (next: Partial<{ shipmentId: string; filter: string }>) => void; onCancel: () => void; onSubmit: () => void;
}) {
  const query = value.filter.trim().toLowerCase();
  const options = shipments
    .filter(item => !query || item.invoice_id.toLowerCase().includes(query))
    .sort((a, b) => (b.last_updated || '').localeCompare(a.last_updated || ''))
    .slice(0, 200);
  return <div className="basis-full space-y-2 rounded-lg bg-blue-50 p-3">
    <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
      <input className={field.replace('mt-1 ', '')} value={value.filter} onChange={e => onChange({ filter: e.target.value, shipmentId: '' })} placeholder="Поиск по инвойсу" aria-label="Поиск отправления" />
      <select className={field.replace('mt-1 ', '')} value={value.shipmentId} onChange={e => onChange({ shipmentId: e.target.value })} aria-label="Отправление">
        <option value="">{options.length ? 'Выберите отправление' : 'Ничего не найдено'}</option>
        {options.map(item => <option key={item.id} value={item.id}>{item.invoice_id}</option>)}
      </select>
    </div>
    <div className="flex flex-wrap gap-2">
      <button className={`${button} bg-blue-600 text-white`} disabled={busy || !value.shipmentId} onClick={onSubmit}>Добавить документы в отправление</button>
      <button className={`${button} bg-white text-slate-700`} disabled={busy} onClick={onCancel}>Отмена</button>
    </div>
    <p className="text-xs text-slate-500">Все вложения и исходное письмо добавятся к выбранному отправлению. Его название, статус и даты не меняются.</p>
  </div>;
}
const field = 'mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100';
const button = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-wait';

type ShipmentOption = { id: string; invoice_id: string; last_updated?: string };

export function OutlookImport({ onOpenShipment, shipments = [] }: { onOpenShipment: (id: string) => void; shipments?: ShipmentOption[] }) {
  const [status, setStatus] = useState<OutlookStatus>();
  const [form, setForm] = useState<OutlookSettings>();
  const [login, setLogin] = useState<OutlookLogin>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState<{ id: string; shipmentId: string; filter: string } | null>(null);
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
    {(busy || status?.busy) && <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Идёт обработка письма. Кнопки журнала станут доступны после её завершения (обычно до минуты)…</p>}
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
          <label className="text-sm text-slate-700">Принимать документы от<input className={field} value={form.sender} onChange={e => change('sender', e.target.value)} placeholder="@solico-group.ir, @solico-group.com" autoComplete="off" />
            <span className="text-xs text-slate-500">Через запятую: адреса или целые домены, например al.babaei@solico-group.ir, @solico-group.ir. Домен принимает письма любого сотрудника компании.</span></label>
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
      <p className="text-xs leading-relaxed text-slate-500">Читаются письма выбранных отправителей, кроме удалённых и спама. Исходное письмо и документы сохраняются в отправлении. Дата первого письма запускает отсчёт; повторная отправка его не обнуляет. Microsoft запрашивает разрешение на чтение почты, отбор по отправителю выполняет CRM.</p>
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
            {log.status === 'review' && (log.linkable || status.connected) && <button disabled={busy || status.busy} title={status.busy ? 'Идёт импорт письма, подождите минуту' : undefined}
              className="mt-1 block text-blue-600 underline disabled:opacity-50" onClick={() => action(async () => {
                const result = await request<{ status?: string; reason?: string } | { state: string }>(`/retry/${log.id}`, 'POST'); await load();
                setNotice('status' in result && result.status === 'review' ? `Письмо всё ещё требует проверки: ${result.reason || ''}` : 'Повторная проверка выполнена. Результат показан в журнале.');
              })}>Проверить повторно</button>}
            {log.status === 'review' && !log.linkable && !status.connected && <p className="mt-1 max-w-56 text-xs text-slate-500">Исходное письмо не сохранено: в Power Automate откройте этот запуск в истории потока и нажмите Resubmit.</p>}
            {log.linkable && linking?.id !== log.id && <button disabled={busy || status.busy} className="mt-1 block text-blue-600 underline disabled:opacity-50"
              onClick={() => setLinking({ id: log.id, shipmentId: '', filter: log.invoice || '' })}>Привязать к отправлению</button>}
          </div>
          {linking?.id === log.id && <LinkPicker shipments={shipments} value={linking} busy={busy || Boolean(status.busy)}
            onChange={next => setLinking({ ...linking, ...next })} onCancel={() => setLinking(null)}
            onSubmit={() => action(async () => {
              await request(`/link/${log.id}`, 'POST', { shipmentId: linking.shipmentId });
              setLinking(null); await load(); setNotice('Документы письма добавлены в выбранное отправление.');
            })} />}
        </div>)}
      </div>
    </>}
  </section>;
}
