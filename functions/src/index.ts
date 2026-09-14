import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import config from '../../firebase-functions-config.json';

const telegramToken = defineSecret('TELEGRAM_BOT_TOKEN');
const webhookSecret = defineSecret('TELEGRAM_WEBHOOK_SECRET');
let application: Promise<ReturnType<typeof import('../../server/app.js').createCrmApi>> | undefined;

// Cloud Scheduler invokes this even with the CRM closed or scaled to zero.
export const warehouseMailing = onSchedule({
  region: config.region,
  schedule: 'every 1 minutes',
  timeZone: 'Asia/Almaty',
  timeoutSeconds: 300,
  memory: '1GiB',
  maxInstances: 1,
  concurrency: 1,
  retryCount: 0, // The durable run ledger controls safe, bounded retries.
}, async () => {
  process.env.CRM_STORAGE_MODE = 'firebase';
  process.env.DISABLE_BACKGROUND_SCHEDULERS = 'true';
  const { runFirebaseMailingTick } = await import('../../server/services/firebase-mailing-scheduler.js');
  await runFirebaseMailingTick();
});

// Loaded on the first request, after Firebase has provided runtime secrets.
// There is no HTTP listener, polling loop, local database or background scheduler.
export const crmApi = onRequest({
  region: config.region,
  cors: true,
  invoker: 'public',
  secrets: [telegramToken, webhookSecret],
  timeoutSeconds: 300,
  memory: '512MiB',
  maxInstances: 10,
  concurrency: 20,
}, async (req, res) => {
  process.env.CRM_STORAGE_MODE = 'firebase';
  process.env.DISABLE_BACKGROUND_SCHEDULERS = 'true';
  process.env.TELEGRAM_BOT_TOKEN = telegramToken.value();
  process.env.TELEGRAM_WEBHOOK_SECRET = webhookSecret.value();
  application ??= import('../../server/app.js').then(({ createCrmApi }) => createCrmApi(undefined, { firebaseFunction: true }));
  const app = await application;
  // Keep execution alive until the Firestore transaction and HTTP response finish.
  await new Promise<void>((resolve, reject) => {
    res.once('finish', resolve);
    res.once('close', resolve);
    // Firebase's Express 5 request types and the existing Express 4 router share
    // Node's HTTP objects; the router installs its own request/response helpers.
    app(req as unknown as Parameters<typeof app>[0], res as unknown as Parameters<typeof app>[1], error => {
      if (error) reject(error);
      else { res.status(404).json({ error: 'Запрос к Firebase CRM не найден.' }); }
    });
  });
});
