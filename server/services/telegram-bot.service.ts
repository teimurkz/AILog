import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { usesFirebase } from './tracking-context.js';
import { withFirebaseTracking } from './firebase-tracking.service.js';
import { storageService, type RegionalOrderRecord } from './storage.service.js';
import { resolveFirebaseApiUrl } from '../../shared/firebase-endpoints.js';
import { acceptTelegramLocation, completeDriverTrip, consentToTrip, getAvailableOrdersForDriver,
  getDriverSession, TrackingError } from './driver-tracking.service.js';

const token = process.env.TELEGRAM_BOT_TOKEN || '';
export const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'SilkRoadDriverBot';
const stateFile = path.join(process.cwd(), 'server/data/telegram_polling.json');
let lastUpdateId = 0;
if (!usesFirebase()) try { lastUpdateId = JSON.parse(fs.readFileSync(stateFile, 'utf8')).lastUpdateId || 0; } catch {}
const pollingStatus = { configured: Boolean(token), running: false, username: TELEGRAM_BOT_USERNAME,
  lastPollAt: null as string | null, lastError: null as string | null };
export const getTelegramBotStatus = () => ({ ...pollingStatus });

export type TelegramApi = (method: string, payload: Record<string, unknown>) => Promise<any>;
const telegramApi: TelegramApi = async (method, payload) => {
  const response = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload, { timeout: 30000 });
  if (!response.data?.ok) throw new Error(response.data?.description || 'Telegram API error');
  return response.data.result;
};
export async function inspectTelegramWebhook(api: TelegramApi = telegramApi) {
  if (!usesFirebase() || !token) return getTelegramBotStatus();
  const expected = process.env.TELEGRAM_WEBHOOK_URL || resolveFirebaseApiUrl('/api/driver/telegram/webhook');
  try {
    const info = await api('getWebhookInfo', {});
    const correctUrl = info.url === expected;
    return { ...pollingStatus, mode: 'webhook', running: correctUrl && !info.last_error_message,
      lastError: !correctUrl ? 'Webhook Telegram ещё не подключён к Firebase. Выполните настройку из GPS-TRACKING.md.' : info.last_error_message || null };
  } catch { return { ...pollingStatus, mode: 'webhook', running: false, lastError: 'Не удалось проверить webhook Telegram.' }; }
}
const escapeHtml = (value: string) => value.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const liveInstructions = '📍 <b>Включите трансляцию геопозиции:</b>\n' +
  'Нажмите 📎 → «Геопозиция» → «Транслировать геопозицию». Выберите «Пока не отключу» / без ограничения времени, если этот вариант доступен. ' +
  'Если выбран ограниченный срок, продлите трансляцию до его окончания.\n\n' +
  'Разрешите Telegram доступ к геопозиции в фоне в настройках телефона. После первого сигнала логист увидит машину на карте. ' +
  'В конце доставки нажмите «🛑 Завершить рейс». CRM перестанет принимать координаты этого рейса; трансляцию в Telegram также можно отключить.';

function selectionKeyboard(chatId: number) {
  return { inline_keyboard: [
    ...getAvailableOrdersForDriver(undefined, chatId).slice(0, 30).map(order => [{
      text: `🚛 ${order.orderNumber}: ${order.originCity || 'Алматы'} → ${order.destinationCity}`,
      callback_data: `sel_order:${order.id}`
    }]),
    [{ text: '🔄 Обновить список заявок', callback_data: 'refresh_orders' }]
  ] };
}
const activeKeyboard = (number: string) => ({ inline_keyboard: [
  [{ text: '📍 Как включить GPS', callback_data: 'gps_help' }],
  [{ text: '🛑 Завершить рейс', callback_data: `finish_trip:${number}` }]
] });
const consentKeyboard = (order: RegionalOrderRecord) => ({ inline_keyboard: [
  [{ text: '✅ Принимаю рейс и даю согласие на GPS', callback_data: `consent_trip:${order.id}` }],
  [{ text: 'Назад к заявкам', callback_data: 'cancel_select' }]
] });

// One update handler for polling and tests. Tests inject the Telegram transport;
// no real driver messages or live order records are needed for verification.
export async function processTelegramUpdate(update: any, api: TelegramApi = telegramApi) {
  if (!usesFirebase()) return processUpdate(update, api);
  const commands = await withFirebaseTracking(async () => {
    const commands: { method: string; payload: Record<string, unknown> }[] = [];
    await processUpdate(update, async (method, payload) => { commands.push({ method, payload }); return {}; });
    return commands;
  }, { updateId: Number.isInteger(update.update_id) ? update.update_id : undefined,
    gpsChatId: (update.message?.location || update.edited_message?.location) ? (update.message || update.edited_message).chat?.id : undefined });
  // Telegram delivery is outside retryable Firestore transactions.
  for (const command of commands || []) await api(command.method, command.payload);
  pollingStatus.lastPollAt = new Date().toISOString();
  pollingStatus.lastError = null;
}

async function processUpdate(update: any, api: TelegramApi) {
  const cb = update.callback_query;
  const msg = cb?.message || update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg.chat.type !== 'private') return;
  const from = cb?.from || msg.from;
  if (from?.id !== chatId) return;
  const send = (text: string, reply_markup?: any) => api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', reply_markup });
  const ack = async (text = '') => {
    if (cb?.id) await api('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});
  };
  const showOrders = () => send('📦 Выберите рейс из заявок CRM. После выбора подтвердите согласие на передачу геопозиции.', selectionKeyboard(chatId));
  const showConsent = async (id: string) => {
    const order = storageService.getOrder(id);
    if (!order || !getAvailableOrdersForDriver(undefined, chatId).some(o => o.id === order.id)) {
      throw new TrackingError('Рейс недоступен. Обновите список заявок.');
    }
    const session = getDriverSession(chatId);
    if (session) {
      if (session.orderId !== order.id) throw new TrackingError(`Сначала завершите рейс ${session.orderNumber}.`);
      await send(`📦 Ваш текущий рейс: <b>${escapeHtml(session.orderNumber)}</b>.\n\n${liveInstructions}`, activeKeyboard(session.orderId));
      return;
    }
    await send(`📦 <b>Рейс ${escapeHtml(order.orderNumber)}</b>\n${escapeHtml(order.originCity || 'Алматы')} → ${escapeHtml(order.destinationCity)}\n\n` +
      'Я принимаю рейс и согласен передавать свою геопозицию логисту для отслеживания доставки до завершения этой заявки. ' +
      'Трансляцию можно остановить в Telegram в любой момент.', consentKeyboard(order));
  };
  const finish = async (id: string) => {
    const session = getDriverSession(chatId);
    const order = completeDriverTrip(id, chatId);
    if (session?.pinnedMessageId) {
      await api('unpinChatMessage', { chat_id: chatId, message_id: session.pinnedMessageId }).catch(() => {});
    }
    await send(`🏁 Рейс <b>${escapeHtml(order.orderNumber)}</b> завершён. Приём GPS в CRM остановлен. Спасибо за доставку!\n` +
      'Можете остановить трансляцию геопозиции в Telegram.', selectionKeyboard(chatId));
  };
  try {
    if (cb) {
      const data = String(cb.data || '');
      if (data.startsWith('consent_trip:')) {
        const name = [from.first_name, from.last_name, from.username && `(@${from.username})`].filter(Boolean).join(' ') || `Водитель ${chatId}`;
        const session = consentToTrip(chatId, data.slice('consent_trip:'.length), name);
        await ack('Рейс принят, согласие сохранено.');
        await send(`✅ Рейс <b>${escapeHtml(session.orderNumber)}</b> закреплён за вами.\n\n${liveInstructions}`, activeKeyboard(session.orderId));
      } else if (data.startsWith('sel_order:')) {
        await ack();
        await showConsent(data.slice('sel_order:'.length));
      } else if (data.startsWith('finish_trip:')) {
        // Check ownership before acknowledging success: old buttons cannot end a new trip.
        await finish(data.slice('finish_trip:'.length));
        await ack('Рейс завершён.');
      } else if (data === 'gps_help') {
        await ack();
        const session = getDriverSession(chatId);
        if (session) await send(liveInstructions, activeKeyboard(session.orderId));
        else await showOrders();
      } else {
        await ack();
        await showOrders();
      }
      return;
    }
    if (msg.location) {
      const result = acceptTelegramLocation(msg, Boolean(update.edited_message));
      if (result.kind === 'no_session') {
        // Late live edits after completion are expected; ignore them quietly.
        if (!update.edited_message) await showOrders();
      } else if (result.kind === 'static') {
        await send('📍 Разовая геопозиция сохранена и показана на карте. Для автоматического обновления координат включите трансляцию.\n\n' + liveInstructions,
          activeKeyboard(result.order.id));
      } else if (result.kind === 'stopped') {
        await send('⏸ Трансляция остановлена. Рейс остаётся открытым, логист видит последнюю полученную точку.\n\n' + liveInstructions,
          activeKeyboard(result.order.id));
      } else if (result.kind === 'live' && result.firstLive) {
        const sent = await send(`🟢 GPS рейса <b>${escapeHtml(result.order.orderNumber)}</b> поступает на карту логиста.\n` +
          'После доставки завершите рейс кнопкой ниже.', activeKeyboard(result.order.id));
        const session = getDriverSession(chatId);
        if (session && sent?.message_id) {
          storageService.saveSession({ ...session, pinnedMessageId: sent.message_id });
          await api('pinChatMessage', { chat_id: chatId, message_id: sent.message_id, disable_notification: true }).catch(() => {});
        }
      }
      return;
    }
    if (update.edited_message) return;
    const text = String(msg.text || '').trim();
    const session = getDriverSession(chatId);
    if (/^(🛑\s*)?завершить рейс$|^\/finish$|^груз доставлен$/i.test(text)) {
      if (!session) throw new TrackingError('У вас нет активного рейса.');
      await finish(session.orderId);
    } else if (/^\/start(?:@\w+)?(?:\s|$)/i.test(text)) {
      const requested = text.split(/\s+/)[1];
      if (requested) await showConsent(requested);
      else if (session) await send(`📦 Текущий рейс: <b>${escapeHtml(session.orderNumber)}</b>.\n\n${liveInstructions}`, activeKeyboard(session.orderId));
      else await showOrders();
    } else if (storageService.getOrder(text)) {
      await showConsent(text);
    } else if (/геопозиц|gps|начать|выехал/i.test(text) && session) {
      await send(liveInstructions, activeKeyboard(session.orderId));
    } else {
      await showOrders();
    }
  } catch (error) {
    if (!(error instanceof TrackingError)) throw error;
    await ack(error.message);
    const session = getDriverSession(chatId);
    await send(escapeHtml(error.message), session ? activeKeyboard(session.orderId) : selectionKeyboard(chatId));
  }
}

export function startTelegramBotPolling() {
  if (pollingStatus.running || process.env.TELEGRAM_BOT_DISABLED === 'true') return;
  if (!token) { pollingStatus.lastError = 'Не настроен TELEGRAM_BOT_TOKEN'; return; }
  if (usesFirebase()) {
    pollingStatus.running = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);
    pollingStatus.lastError = pollingStatus.running ? null : 'Для Cloud Run настройте Telegram webhook и TELEGRAM_WEBHOOK_SECRET.';
    return;
  }
  pollingStatus.running = true;
  const poll = async () => {
    let delay = 250;
    try {
      const updates = await telegramApi('getUpdates', { offset: lastUpdateId + 1, timeout: 20,
        allowed_updates: ['message', 'edited_message', 'callback_query'] });
      pollingStatus.lastPollAt = new Date().toISOString();
      pollingStatus.lastError = null;
      for (const update of updates) {
        await processTelegramUpdate(update);
        lastUpdateId = update.update_id;
        const tmp = `${stateFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ lastUpdateId }));
        fs.renameSync(tmp, stateFile);
      }
    } catch (error: any) {
      const code = error.response?.status;
      pollingStatus.lastError = code === 409 ? 'Конфликт Telegram: запущен второй экземпляр бота или настроен webhook.' :
        code === 401 ? 'Telegram отклонил токен бота.' : 'Нет связи с Telegram. Повторное подключение…';
      // Axios errors contain a token in their URL; never log the complete error.
      console.warn('[Telegram]', pollingStatus.lastError);
      delay = 5000;
    }
    setTimeout(poll, delay);
  };
  void poll();
}
