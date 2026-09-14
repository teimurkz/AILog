type KnownBoolean = boolean | null;

export interface MailingDiagnostics {
  diagnosticsVersion: number | null;
  enabled: KnownBoolean;
  schedulerHealthy: KnownBoolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  scheduleType: string | null;
  timezone: string | null;
  currentHHmm: string | null;
  currentZonedTime: string | null;
  targetSendTime: string | null;
  dayMatched: KnownBoolean;
  timeMatched: KnownBoolean;
  smtpConfigured: KnownBoolean;
  smtpError: string | null;
  activeSubscribersCount: number | null;
  shouldRunNow: KnownBoolean;
  statusMessage: string;
  apiUpdateRequired: boolean;
}

const knownBoolean = (value: unknown): KnownBoolean =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
const knownText = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

export function mailingDiagnosticMessage(d: MailingDiagnostics): string {
  if (d.enabled === false || d.scheduleType === 'manual') return 'Автоматическая отправка выключена.';
  if (d.apiUpdateRequired) return 'Обновите функцию crmApi в Firebase: сервер передаёт неполную диагностику.';
  if (d.schedulerHealthy !== true) return 'Нет свежего сигнала службы. Проверьте публикацию задания warehouseMailing в Firebase.';
  if (d.smtpConfigured === false) return 'Сохраните настройки SMTP перед автоматической отправкой.';
  if (d.smtpConfigured === null) return 'Состояние SMTP не получено от сервера.';
  if (d.activeSubscribersCount === 0) return 'Нет активных получателей.';
  if (d.lastError) return d.lastError;
  if (d.scheduleType === 'on_change') return 'Служба проверяет изменения в Google Таблице.';
  if (d.shouldRunNow === true) return 'Условия выполнены. Ожидается обработка задания службой.';
  if (d.scheduleType === 'test_interval') return 'Служба проверяет отправки по сохранённому интервалу.';
  if (d.dayMatched === false) return 'На сегодня отправка по этому расписанию не назначена.';
  if (d.currentHHmm && d.targetSendTime && d.currentHHmm > d.targetSendTime) return 'Сегодняшнее время рассылки прошло. Проверьте журнал отправок.';
  if (d.targetSendTime) return `Ожидание времени ${d.targetSendTime}.`;
  return 'Недостаточно данных для проверки расписания.';
}

// Compatibility with an older deployed crmApi. Missing fields stay unknown,
// never becoming false configuration errors or a claim that the scheduler runs.
export function normalizeMailingDiagnostics(response: unknown): MailingDiagnostics {
  const raw = response && typeof response === 'object' ? response as Record<string, unknown> : {};
  const target = knownText(raw.targetSendTime) || knownText(raw.targetHHmm) || knownText(raw.sendTime);
  const version = typeof raw.diagnosticsVersion === 'number' ? raw.diagnosticsVersion : null;
  const d: MailingDiagnostics = {
    diagnosticsVersion: version,
    enabled: knownBoolean(raw.enabled),
    schedulerHealthy: knownBoolean(raw.schedulerHealthy),
    lastCheckedAt: knownText(raw.lastCheckedAt), lastError: knownText(raw.lastError),
    scheduleType: knownText(raw.scheduleType), timezone: knownText(raw.timezone),
    currentHHmm: knownText(raw.currentHHmm),
    currentZonedTime: knownText(raw.currentZonedTime) || knownText(raw.currentServerZonedTime),
    targetSendTime: target,
    dayMatched: knownBoolean(raw.dayMatched), timeMatched: knownBoolean(raw.timeMatched),
    smtpConfigured: knownBoolean(raw.smtpConfigured), smtpError: knownText(raw.smtpError),
    activeSubscribersCount: typeof raw.activeSubscribersCount === 'number' && Number.isFinite(raw.activeSubscribersCount) ? raw.activeSubscribersCount : null,
    shouldRunNow: knownBoolean(raw.shouldRunNow),
    statusMessage: '', apiUpdateRequired: version !== 2,
  };
  // Daily means every weekday; this does not depend on the current date.
  if (d.dayMatched === null && d.scheduleType === 'daily') d.dayMatched = true;
  d.statusMessage = knownText(raw.statusMessage) || mailingDiagnosticMessage(d);
  return d;
}
