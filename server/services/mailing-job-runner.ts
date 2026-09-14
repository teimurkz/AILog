import { createHash, randomUUID } from 'node:crypto';

export interface MailingTransaction {
  get(path: string): Promise<any | undefined>;
  set(path: string, patch: any): void;
}
export interface MailingJobStore {
  transaction<T>(work: (tx: MailingTransaction) => Promise<T>): Promise<T>;
}
export const SCHEDULER_STATE = 'mailing_scheduler/warehouse';
const CONFIG = 'mailing_settings/config';
const LEASE_MS = 6 * 60_000; // Longer than the function's hard five-minute timeout.

function zoned(now: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, minutes: Number(parts.hour) * 60 + Number(parts.minute), weekday: new Date(`${date}T12:00:00Z`).getUTCDay() };
}

export function scheduleSignature(settings: any): string {
  return JSON.stringify([settings.scheduleType || 'daily', settings.sendTime || '09:00', settings.timezone || 'Asia/Almaty', settings.scheduleDays || [], settings.intervalMinutes || 1]);
}

export function dueMailingRun(settings: any, now: Date, activatedAt: string): string | null {
  if (!settings || ![true, 'true'].includes(settings.enabled) || settings.scheduleType === 'manual') return null;
  const type = settings.scheduleType || 'daily';
  if (type === 'on_change') return 'on_change';
  if (type === 'test_interval') {
    const minutes = Number(settings.intervalMinutes || 1);
    if (!Number.isFinite(minutes) || minutes < 1) throw new Error('Некорректный интервал рассылки.');
    return `interval_${minutes}_${Math.floor(now.getTime() / (minutes * 60_000))}`;
  }
  const timezone = settings.timezone || 'Asia/Almaty';
  const current = zoned(now, timezone);
  const activation = zoned(new Date(activatedAt), timezone);
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(settings.sendTime || '09:00').trim());
  if (!match || +match[1] > 23 || +match[2] > 59) throw new Error('Некорректное время рассылки.');
  const minutes = +match[1] * 60 + +match[2];
  const time = `${match[1].padStart(2, '0')}:${match[2]}`;
  const dayMatches = type === 'daily' ||
    (type === 'workdays' && current.weekday >= 1 && current.weekday <= 5) ||
    (type === 'weekly' && current.weekday === 1) ||
    (type === 'custom' && settings.scheduleDays?.map(Number).includes(current.weekday));
  // Recover short service outages, but don't mail old reports on first deployment.
  if (!dayMatches || current.minutes < minutes || current.minutes > minutes + 90 ||
      current.date < activation.date || (current.date === activation.date && minutes < activation.minutes)) return null;
  return `${current.date}_${time}_${type}_${timezone}`;
}

export function reportFingerprint(data: any): string {
  // Exclude download timestamps/logs and generated report dates.
  return createHash('sha256').update(JSON.stringify([data.spreadsheetId,
    data.warehouses.map((w: any) => ({ id: w.id, cols: w.cols, items: w.items.map((i: any) => i.rawRow || i) })),
  ])).digest('hex');
}

export interface MailingJobDependencies {
  store: MailingJobStore;
  now?: () => Date;
  loadWarehouse: () => Promise<any>;
  dispatch: (options: { triggerSource: string; logId: string; warehouseData?: any; beforeSend: () => Promise<void> }) => Promise<any>;
}

export async function runMailingTick(deps: MailingJobDependencies) {
  const now = deps.now || (() => new Date());
  const token = randomUUID();
  const start = now();
  const claim = await deps.store.transaction(async tx => {
    const [settings, state] = await Promise.all([tx.get(CONFIG), tx.get(SCHEDULER_STATE)]);
    tx.set(SCHEDULER_STATE, { lastCheckedAt: start.toISOString(), activatedAt: state?.activatedAt || start.toISOString() });
    // The first invocation establishes a baseline; it never retroactively sends.
    if (!state?.activatedAt || (state.leaseUntil || 0) > start.getTime()) return null;
    const key = dueMailingRun(settings, start, state.activatedAt);
    if (!key) return null;
    tx.set(SCHEDULER_STATE, { token, leaseUntil: start.getTime() + LEASE_MS });
    return { key, settings, state };
  });
  if (!claim) return;

  let jobPath: string | undefined;
  let logId: string | undefined;
  let enteredSmtp = false;
  let attempts = 0;
  try {
    let key = claim.key;
    let warehouseData: any;
    if (key === 'on_change') {
      warehouseData = await deps.loadWarehouse();
      const hash = reportFingerprint(warehouseData);
      key = await deps.store.transaction(async tx => {
        const state = await tx.get(SCHEDULER_STATE);
        if (state?.token !== token) throw new Error('Срок выполнения задания истёк.');
        if (!state.changeHash) {
          tx.set(SCHEDULER_STATE, { changeHash: hash, changeSequence: 0 });
          return '';
        }
        if (state.changeHash === hash) return state.pendingChangeKey || '';
        const sequence = (state.changeSequence || 0) + 1;
        const next = `change_${sequence}_${hash}`;
        tx.set(SCHEDULER_STATE, { changeHash: hash, changeSequence: sequence, pendingChangeKey: next });
        return next;
      });
      if (!key) return;
    }
    const id = createHash('sha256').update(key).digest('hex');
    jobPath = `mailing_runs/${id}`;
    const job = await deps.store.transaction(async tx => {
      const [previous, state] = await Promise.all([tx.get(jobPath!), tx.get(SCHEDULER_STATE)]);
      if (state?.token !== token) throw new Error('Срок выполнения задания истёк.');
      if (previous?.status === 'sending') {
        const receipt = await tx.get(`mailing_logs/${id}-${previous.attempts}`);
        if (receipt?.status === 'success' || receipt?.status === 'partial') {
          const status = receipt.status === 'success' ? 'sent' : 'partial';
          tx.set(jobPath!, { status, retryable: false, finishedAt: receipt.timestamp });
          tx.set(SCHEDULER_STATE, { lastRunStatus: status, lastError: receipt.errorMessage || null, ...(status === 'sent' ? { lastSuccessAt: receipt.timestamp } : {}) });
          return null;
        }
        // A worker died during SMTP. Delivery is unknown: don't generate duplicates.
        const error = 'Предыдущая отправка прервалась без подтверждения результата. Проверьте почту перед повтором.';
        tx.set(jobPath!, { status: 'uncertain', error, retryable: false });
        tx.set(SCHEDULER_STATE, { lastRunStatus: 'uncertain', lastError: error });
        tx.set(`mailing_logs/${id}-${previous.attempts}`, { id: `${id}-${previous.attempts}`, timestamp: now().toISOString(), status: 'failed', triggerSource: 'automatic', fileName: 'Складской отчет', fileSize: '—', recipientsCount: 0, recipientEmails: [], errorMessage: error, deliveryUncertain: true });
        return null;
      }
      if (previous && (previous.attempts >= 3 || ['sent', 'partial', 'uncertain'].includes(previous.status) ||
          (previous.status === 'failed' && (!previous.retryable || previous.attempts >= 3 || previous.nextRetryAt > now().getTime())))) return null;
      const next = { key, status: 'preparing', attempts: (previous?.attempts || 0) + 1, token, startedAt: now().toISOString() };
      tx.set(jobPath!, next);
      return next;
    });
    if (!job) return;
    attempts = job.attempts;
    logId = `${id}-${attempts}`;
    const result = await deps.dispatch({
      warehouseData, logId, triggerSource: claim.key === 'on_change' ? 'on_change' : 'automatic',
      beforeSend: async () => {
        await deps.store.transaction(async tx => {
          const [state, settings] = await Promise.all([tx.get(SCHEDULER_STATE), tx.get(CONFIG)]);
          if (state?.token !== token || state.leaseUntil <= now().getTime() || ![true, 'true'].includes(settings?.enabled) || scheduleSignature(settings) !== scheduleSignature(claim.settings)) {
            throw Object.assign(new Error('Отправка отменена: расписание изменено или срок задания истёк.'), { retryable: false });
          }
          tx.set(jobPath!, { status: 'sending' });
        });
        enteredSmtp = true;
      },
    });
    const status = result.success ? 'sent' : result.log?.status === 'partial' ? 'partial' : result.uncertain ? 'uncertain' : 'failed';
    await finish(status, result.retryable === true, result.error || null, result.log);
  } catch (error: any) {
    // Preparation can be retried; an interrupted send cannot be assumed unsent.
    const message = enteredSmtp ? 'Отправка началась, но результат не подтверждён. Проверьте почту перед повтором.' : String(error?.message || 'Ошибка подготовки рассылки');
    if (jobPath && attempts) {
      await finish(enteredSmtp ? 'uncertain' : 'failed', !enteredSmtp && error?.retryable !== false, message);
    } else {
      await deps.store.transaction(async tx => { tx.set(SCHEDULER_STATE, { lastError: message, lastRunStatus: 'failed' }); });
    }
  } finally {
    await deps.store.transaction(async tx => {
      const state = await tx.get(SCHEDULER_STATE);
      if (state?.token === token) tx.set(SCHEDULER_STATE, { token: null, leaseUntil: 0 });
    });
  }

  async function finish(status: string, retryable: boolean, error: string | null, log?: any) {
    await deps.store.transaction(async tx => {
      const state = await tx.get(SCHEDULER_STATE);
      if (state?.token !== token) throw new Error('Срок выполнения задания истёк.');
      tx.set(jobPath!, { status, retryable, error, finishedAt: now().toISOString(), nextRetryAt: now().getTime() + attempts * 5 * 60_000 });
      // Re-save the receipt with the job atomically, including after a transient
      // journal write failure in dispatch. Same ID makes this idempotent.
      tx.set(`mailing_logs/${logId}`, log || { id: logId, timestamp: now().toISOString(), status: status === 'sent' ? 'success' : status === 'partial' ? 'partial' : 'failed', triggerSource: claim!.key === 'on_change' ? 'on_change' : 'automatic', fileName: 'Складской отчет', fileSize: '—', recipientsCount: 0, recipientEmails: [], errorMessage: error, deliveryUncertain: status === 'uncertain' });
      tx.set(SCHEDULER_STATE, {
        lastRunStatus: status, lastError: error,
        ...(status === 'sent' ? { lastSuccessAt: now().toISOString() } : {}),
        ...(claim!.key === 'on_change' && !(retryable && attempts < 3) ? { pendingChangeKey: null } : {}),
      });
    });
  }
}
