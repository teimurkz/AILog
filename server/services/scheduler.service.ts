import { getWarehouseData } from "./warehouse.service.js";
import { generateWarehouseExcelBufferAsync } from "./excel.service.js";
import {
  getMailingSubscribers,
  markMailingSubscribersSent,
  getMailingSettings,
  saveMailingSettings,
  addMailingLog
} from "./mailing.service.js";
import { sendMailWithResilience } from "./email.service.js";
import { getZonedTime } from "../utils/helpers.js";
import { usesFirebase } from './tracking-context.js';
import { db } from '../config/firebase.js';

let lastAutoSentKey = '';
let lastIntervalSentTime = 0;
let isDispatching = false;
let isPolling = false;
let schedulerStarted = false;
let localAttempt = { key: '', count: 0, notBefore: 0, blocked: false };

export function resetAutoSentKey() {
  lastAutoSentKey = '';
  lastIntervalSentTime = 0;
  localAttempt = { key: '', count: 0, notBefore: 0, blocked: false };
  console.log("🔄 [Cron Scheduler] Кэш планировщика сброшен (обновлены настройки времени).");
}

export function getLastAutoSentKey() {
  return lastAutoSentKey;
}

export async function executeMailingDispatch(options: {
  targetSubscriberIds?: string[];
  customEmail?: string;
  triggerSource?: string;
  warehouseData?: any;
  beforeSend?: () => Promise<void>;
  logId?: string;
}) {
  const { targetSubscriberIds, customEmail, triggerSource = 'automatic' } = options;

  // 1. Fetch stock data & generate formatted Excel
  const warehouseData = options.warehouseData || await getWarehouseData(true, undefined, { requireFresh: true });
  const excelBuffer = await generateWarehouseExcelBufferAsync(warehouseData);
  
  const dateStr = new Date().toISOString().split('T')[0];
  const attachmentName = `Warehouse_Stock_Report_${dateStr}.xlsx`;

  // 2. Recipients
  const allSubscribers = await getMailingSubscribers();
  let recipientsToMessage: any[] = [];

  if (customEmail) {
    recipientsToMessage = [{
      id: 'custom-single',
      name: customEmail.split('@')[0],
      email: customEmail.trim()
    }];
  } else if (targetSubscriberIds && Array.isArray(targetSubscriberIds) && targetSubscriberIds.length > 0) {
    recipientsToMessage = allSubscribers.filter(s => targetSubscriberIds.includes(s.id));
  } else {
    recipientsToMessage = allSubscribers.filter(s => s.isActive);
  }

  if (recipientsToMessage.length === 0) {
    const error = "Нет активных получателей для отправки рассылки (проверьте галочки 'Активен' в списке получателей).";
    await addMailingLog({ id: options.logId || `mail-log-${Date.now()}`, timestamp: new Date().toISOString(), status: 'failed', triggerSource, recipientsCount: 0, recipientEmails: [], fileName: attachmentName, fileSize: `${(excelBuffer.length / 1024).toFixed(1)} KB`, errorMessage: error });
    return {
      success: false,
      retryable: false,
      uncertain: false,
      error,
    };
  }

  const settings = await getMailingSettings();
  const recipientEmails = recipientsToMessage.map(r => r.email);

  let sendStatus: 'success' | 'failed' | 'partial' = 'success';
  let errorMsg: string | undefined = undefined;
  let retryable = false;
  let uncertain = false;
  let acceptedEmails: string[] = [];

  // 3. Resilient SMTP Send
  await options.beforeSend?.();
  try {
    const fromHeader = settings.smtpFrom || `"Логистика и Склад (Silk Road)" <${settings.smtpUser || process.env.SMTP_USER || 'ti07kz@gmail.com'}>`;
    const delivery = await sendMailWithResilience({
      from: fromHeader,
      to: recipientEmails.join(', '),
      subject: settings.emailSubject || '📊 Ежедневный отчет: Статус машин и остатки на складах',
      text: settings.emailBody || 'Актуальный сводный отчет по автотранспорту и складским остаткам из Google Таблицы во вложении.',
      html: `
        <div style="font-family: Arial, sans-serif; color: #1e293b; max-width: 620px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
          <div style="background-color: #1e293b; padding: 18px 24px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
            <h2 style="color: #ffffff; margin: 0; font-size: 19px; font-weight: bold;">📊 Ежедневный отчет по Логистике и Складам</h2>
            <p style="color: #94a3b8; margin: 6px 0 0 0; font-size: 13px;">Синхронизировано с Google Таблицей • Silk Road Logistics</p>
          </div>
          
          <p style="font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-line;">
            ${settings.emailBody || 'Добрый день!\n\nНаправляем актуальный ежедневный сводный отчет компании со статусом прибытия автотранспорта и остатками на складах.'}
          </p>

          <div style="margin: 18px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 8px;">
            <p style="margin: 0 0 8px 0; font-weight: bold; font-size: 13px; color: #1e293b;">📋 Содержимое прикрепленного Excel отчета:</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #334155; line-height: 1.6;">
              <li>🚚 <b>Вкладка «Отчет по машинам»</b>: статус машин, даты прибытия на СВХ и разрешения на выгрузку.</li>
              <li>📦 <b>Вкладка «Сводка по складам»</b>: общие итоги по товарным позициям и сумме паллетомест.</li>
              <li>🏬 <b>Вкладки по складам</b>: детальные остатки (Бекмаханова, Жолдостар, А-Прейд, АСЕМ, ЦЭД, Кусто).</li>
            </ul>
          </div>

          <div style="margin: 16px 0; padding: 14px; background-color: #eff6ff; border-radius: 8px; border: 1px solid #bfdbfe;">
            <p style="margin: 0; font-size: 13px; color: #1e40af; font-weight: bold;">📎 Прикрепленный файл: ${attachmentName}</p>
            <p style="margin: 4px 0 0 0; font-size: 12px; color: #3b82f6;">Форматированная таблица Microsoft Excel (.xlsx) со статусами машин и итогами по паллетам.</p>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
          <p style="font-size: 11px; color: #94a3b8; text-align: center; margin: 0;">
            Автоматическая рассылка • Silk Road Logistics<br/>
            Сформировано: ${new Date().toLocaleString('ru-RU')}
          </p>
        </div>
      `,
      attachments: [
        {
          filename: attachmentName,
          content: excelBuffer
        }
      ]
    }, settings);
    acceptedEmails = (delivery.info.accepted || []).map((address: any) => String(address?.address || address));
    const rejected = delivery.info.rejected || [];
    sendStatus = rejected.length ? (acceptedEmails.length ? 'partial' : 'failed') : 'success';
    if (rejected.length) errorMsg = `SMTP отклонил ${rejected.length} получателей. Принято: ${acceptedEmails.length}.`;
  } catch (mailErr: any) {
    sendStatus = 'failed';
    errorMsg = mailErr.message || "Ошибка отправки через SMTP сервер";
    retryable = mailErr.retryable === true;
    uncertain = mailErr.uncertain !== false && !retryable;
    if (uncertain) errorMsg = `Результат доставки неизвестен. Проверьте почту перед повтором. ${errorMsg}`;
  }

  const nowIso = new Date().toISOString();
  let warning: string | undefined;
  try {
    await markMailingSubscribersSent(allSubscribers.filter(s => acceptedEmails.includes(s.email)), nowIso);
  } catch {
    warning = 'Не удалось обновить время отправки у получателей.';
  }

  const logEntry = {
    id: options.logId || `mail-log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: nowIso,
    recipientsCount: recipientEmails.length,
    recipientEmails,
    status: sendStatus,
    fileName: attachmentName,
    fileSize: `${(excelBuffer.length / 1024).toFixed(1)} KB`,
    triggerSource,
    errorMessage: errorMsg,
    acceptedEmails,
    deliveryUncertain: uncertain,
  };

  try { await addMailingLog(logEntry); }
  catch { warning = 'Результат отправки не удалось записать в журнал. Не повторяйте письмо без проверки.'; }

  return {
    success: sendStatus === 'success',
    message: sendStatus === 'success' ? `SMTP принял письмо для ${acceptedEmails.length} получателей.` : `Ошибка рассылки: ${errorMsg}`,
    error: errorMsg,
    retryable, uncertain, warning,
    log: logEntry,
  };
}

export function startBackgroundSheetsPolling() {
  if (usesFirebase()) return; // Firebase is driven only by warehouseMailing's scheduled trigger.
  console.log("📊 [Sheets Poller] Фоновая проверка обновлений Google Таблиц запущена (каждые 60 сек)...");
  setInterval(async () => {
    if (isPolling) return;
    isPolling = true;
    try {
      await getWarehouseData(true, () => {
        getMailingSettings().then(currentSettings => {
          if (currentSettings && (currentSettings.enabled === true || String(currentSettings.enabled) === 'true') && currentSettings.scheduleType === 'on_change') {
            if (isDispatching) {
              console.log("⏳ [Sheets Poller] Пропуск on_change отправки - уже выполняется другая отправка.");
              return;
            }
            console.log(`🔔 Обнаружены изменения в Google Таблицах. Запуск авто-рассылки (on_change)...`);
            isDispatching = true;
            executeMailingDispatch({ triggerSource: 'on_change' })
              .catch(err => console.error("Error in on_change mailing dispatch:", err))
              .finally(() => { isDispatching = false; });
          }
        });
      });
    } catch (err: any) {
      console.error("[Sheets Poller] Ошибка фоновой проверки Google Таблиц:", err?.message || err);
    } finally {
      isPolling = false;
    }
  }, 60000);
}

export function startMailingScheduler() {
  if (usesFirebase()) return;
  if (schedulerStarted) return;
  schedulerStarted = true;
  console.log("⏰ [Mailing Scheduler] Автоматическая служба рассылки запущена (проверка каждые 15 сек)...");
  
  setInterval(async () => {
    // If a dispatch is currently running, skip to avoid parallel overlapping executions
    if (isDispatching) {
      return;
    }

    try {
      const settings = await getMailingSettings();
      if (!settings || settings.enabled === false || String(settings.enabled) === 'false' || settings.scheduleType === 'manual') {
        return;
      }

      if (settings.scheduleType === 'on_change') {
        return;
      }

      const tz = settings.timezone || 'Asia/Almaty';
      const zoned = getZonedTime(tz);
      const currentHHmm = zoned.HHmm;
      const todayDateStr = zoned.todayDateStr;
      const dayOfWeek = zoned.dayOfWeek;

      // 🧪 Test Interval Mode (e.g. Every N Minutes)
      if (settings.scheduleType === 'test_interval') {
        const intervalMinutes = Math.max(1, Number(settings.intervalMinutes || 1));
        const intervalMs = intervalMinutes * 60 * 1000;
        const nowMs = Date.now();

        if (nowMs - lastIntervalSentTime >= intervalMs) {
          console.log(`🚀 [Cron Scheduler] Сработал тестовый интервал (каждые ${intervalMinutes} мин). Запуск отправки...`);
          lastIntervalSentTime = nowMs;
          isDispatching = true;
          try {
            const result = await executeMailingDispatch({ triggerSource: `test_interval_${intervalMinutes}m` });
            if (result.success) {
              console.log(`✅ [Cron Scheduler] Тестовая авто-рассылка успешно отправлена!`);
            } else {
              console.error(`❌ [Cron Scheduler] Ошибка тестовой рассылки:`, result.error);
            }
          } catch (intErr) {
            console.error("❌ [Cron Scheduler] Ошибка выполнения тестового интервала:", intErr);
          } finally {
            isDispatching = false;
          }
        }
        return;
      }

      // Scheduled Exact Time Modes ('daily', 'workdays', 'weekly', 'custom')
      const normTarget = (settings.sendTime || '09:00').trim().slice(0, 5).padStart(5, '0');
      const normCurrent = currentHHmm.trim().slice(0, 5).padStart(5, '0');
      const sendKey = `${todayDateStr}_${normTarget}_${settings.scheduleType}`;

      // Check in-memory key and persisted key to prevent duplicate sends on same day/time
      if (lastAutoSentKey === sendKey || settings.lastAutoSentKey === sendKey) {
        return;
      }

      // If already sent today for standard daily/workday/weekly schedules, don't re-send
      if (
        (settings.scheduleType === 'daily' || settings.scheduleType === 'workdays' || settings.scheduleType === 'weekly' || settings.scheduleType === 'custom') &&
        settings.lastAutoSentDate === todayDateStr &&
        settings.lastAutoSentTime === normTarget
      ) {
        return;
      }

      const [tH, tM] = normTarget.split(':').map(Number);
      const [cH, cM] = normCurrent.split(':').map(Number);
      const targetMinutes = (tH || 0) * 60 + (tM || 0);
      const currentMinutes = (cH || 0) * 60 + (cM || 0);

      const inTimeWindow = (currentMinutes >= targetMinutes) && (currentMinutes <= targetMinutes + 90);
      if (!inTimeWindow) {
        return;
      }

      let shouldSend = false;
      if (settings.scheduleType === 'daily') {
        shouldSend = true;
      } else if (settings.scheduleType === 'workdays') {
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          shouldSend = true;
        }
      } else if (settings.scheduleType === 'weekly') {
        if (dayOfWeek === 1) {
          shouldSend = true;
        }
      } else if (settings.scheduleType === 'custom' && Array.isArray(settings.scheduleDays)) {
        if (settings.scheduleDays.includes(dayOfWeek)) {
          shouldSend = true;
        }
      }

      if (!shouldSend) {
        return;
      }
      if (localAttempt.key === sendKey && (localAttempt.blocked || localAttempt.count >= 3 || localAttempt.notBefore > Date.now())) return;
      localAttempt = { key: sendKey, count: localAttempt.key === sendKey ? localAttempt.count + 1 : 1, notBefore: Date.now() + 5 * 60_000, blocked: false };

      // Local process mutex; Firebase uses the durable transaction-based runner.
      isDispatching = true;

      console.log(`🚀 [Cron Scheduler] Наступило время рассылки (${normCurrent} по часовому поясу ${tz}). Запуск отправки...`);

      try {
        const result = await executeMailingDispatch({ triggerSource: 'automatic' });
        if (result.success) {
          lastAutoSentKey = sendKey;
          await saveMailingSettings({ ...await getMailingSettings(), lastAutoSentKey: sendKey, lastAutoSentDate: todayDateStr, lastAutoSentTime: normTarget, lastSentTimestamp: new Date().toISOString() });
          console.log(`✅ [Cron Scheduler] Успешно отправлена авто-рассылка:`, result.message);
        } else {
          localAttempt.blocked = !result.retryable;
          console.error(`❌ [Cron Scheduler] Ошибка отправки авто-рассылки:`, result.error || result.message);
        }
      } catch (dispatchErr) {
        console.error("❌ [Cron Scheduler] Исключение при отправке авто-рассылки:", dispatchErr);
      } finally {
        isDispatching = false;
      }

    } catch (schedErr) {
      console.error("Error in background mailing scheduler:", schedErr);
      isDispatching = false;
    }
  }, 15000);
}

export async function getSchedulerDiagnostics() {
  const settings = await getMailingSettings();
  const subscribers = await getMailingSubscribers();
  const activeSubs = subscribers.filter(s => s.isActive);
  const tz = settings?.timezone || 'Asia/Almaty';
  const zoned = getZonedTime(tz);

  const [tH, tM] = (settings?.sendTime || '09:00').trim().slice(0, 5).split(':').map(Number);
  const [cH, cM] = zoned.HHmm.split(':').map(Number);

  const targetMinutes = (tH || 0) * 60 + (tM || 0);
  const currentMinutes = (cH || 0) * 60 + (cM || 0);
  const diffMinutes = targetMinutes - currentMinutes;
  const state = usesFirebase() ? (await db.doc('mailing_scheduler/warehouse').get()).data() : undefined;
  const heartbeatAge = state?.lastCheckedAt ? Date.now() - Date.parse(state.lastCheckedAt) : Infinity;

  return {
    executionMode: usesFirebase() ? 'firebase-scheduled' : 'local',
    schedulerHealthy: usesFirebase() ? heartbeatAge >= 0 && heartbeatAge < 5 * 60000 : schedulerStarted,
    lastCheckedAt: state?.lastCheckedAt || null,
    lastRunStatus: state?.lastRunStatus || null,
    lastError: state?.lastError || null,
    enabled: settings?.enabled ?? true,
    scheduleType: settings?.scheduleType || 'daily',
    sendTime: settings?.sendTime || '09:00',
    intervalMinutes: settings?.intervalMinutes || 1,
    timezone: tz,
    currentServerZonedTime: zoned.fullZonedString,
    currentHHmm: zoned.HHmm,
    targetHHmm: (settings?.sendTime || '09:00').trim().slice(0, 5),
    diffMinutes,
    lastAutoSentKey,
    lastIntervalSentTime: lastIntervalSentTime ? new Date(lastIntervalSentTime).toLocaleString('ru-RU') : null,
    totalSubscribersCount: subscribers.length,
    activeSubscribersCount: activeSubs.length
  };
}
