import 'dotenv/config';
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const url = process.env.TELEGRAM_WEBHOOK_URL;
if (!token || !secret || !url || !/^https:\/\//.test(url) || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  throw new Error('Задайте TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и HTTPS TELEGRAM_WEBHOOK_URL.');
}
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url, secret_token: secret, max_connections: 1,
    allowed_updates: ['message', 'edited_message', 'callback_query'], drop_pending_updates: false })
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error('Telegram не подтвердил настройку webhook. Проверьте параметры.');
console.log('Webhook Telegram настроен. Не запускайте polling-процесс для этого бота.');
