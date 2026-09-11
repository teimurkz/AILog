import 'dotenv/config';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import path from 'node:path';
import { initSocketServer } from './services/socket.service.js';
import driverRoutes from './routes/driver.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import realtimeRoutes from './routes/realtime.routes.js';
import authRoutes from './routes/auth.routes.js';
import { authenticateCrm, requireSignedIn } from './services/crm-auth.service.js';
import { usesFirebase } from './services/tracking-context.js';
import { startTelegramBotPolling } from './services/telegram.service.js';

// Heavy invoice/email/warehouse integrations load only when requested. GPS and
// health requests do not need to initialize their SDKs during a cold start.
function lazyRoute(load: () => Promise<{ default: RequestHandler }>): RequestHandler {
  let module: ReturnType<typeof load> | undefined;
  return (req, res, next) => {
    module ??= load();
    void module.then(({ default: route }) => route(req, res, next)).catch(next);
  };
}

// The Node entry point and both Vite launch modes use the same protected API.
export function createCrmApi(httpServer?: Parameters<typeof initSocketServer>[0], options: { firebaseFunction?: boolean } = {}) {
  const app = express();
  if (httpServer) initSocketServer(httpServer);
  if (options.firebaseFunction) app.use((_req, res, next) => { res.locals.firebaseFunction = true; next(); });
  app.disable('x-powered-by');
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ service: 'silk-road-crm', status: 'ok' });
  });
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use('/api', authenticateCrm);
  app.use('/api/auth', authRoutes);

  if (!usesFirebase()) app.use('/uploads', express.static(path.join(process.cwd(), 'server', 'uploads')));
  app.use('/api/orders', ordersRoutes);
  if (!options.firebaseFunction) app.use('/api/realtime', realtimeRoutes);
  if (options.firebaseFunction) app.post(['/api/driver/location', '/api/driver/complete'], (_req, res) => {
    res.status(403).json({ error: 'Передавайте геопозицию и завершайте рейс через Telegram-бота под своей учётной записью водителя.' });
  });
  app.use('/api/warehouses', requireSignedIn, lazyRoute(() => import('./routes/warehouse.routes.js')));
  app.use('/api/mailing', requireSignedIn, lazyRoute(() => import('./routes/mailing.routes.js')));
  app.use('/api/parse-invoice', requireSignedIn, lazyRoute(() => import('./routes/invoice.routes.js')));
  app.use('/api/driver', driverRoutes);
  if (usesFirebase()) app.use('/api', lazyRoute(() => import('./routes/firebase-data.routes.js')));
  else {
    app.use('/api/shipments', requireSignedIn, lazyRoute(() => import('./routes/shipments.routes.js')));
    app.use('/api', lazyRoute(() => import('./routes/contacts.routes.js')));
    app.use('/api/users', lazyRoute(() => import('./routes/users.routes.js')));
    app.use('/api/upload', requireSignedIn, lazyRoute(() => import('./routes/upload.routes.js')));
  }

  // API requests must never fall through to Vite's HTML application fallback.
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Запрос к серверу CRM не найден.' }));
  const apiError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error?.type === 'entity.parse.failed' ? 400 : error?.type === 'entity.too.large' ? 413 : 500;
    res.status(status).json({ error: status === 400 ? 'Некорректный формат запроса.' :
      status === 413 ? 'Превышен допустимый размер запроса.' : 'Не удалось обработать запрос к серверу CRM.' });
  };
  app.use('/api', apiError);
  app.use((req, res, next) => {
    if (req.path.startsWith('/server/') || /^\/server\.cjs(?:\.map)?$/.test(req.path)) return void res.sendStatus(404);
    next();
  });
  return app;
}

let backgroundStarted = false;
export function startCrmBackgroundJobs() {
  if (backgroundStarted) return;
  backgroundStarted = true;
  startTelegramBotPolling();
  if (process.env.DISABLE_BACKGROUND_SCHEDULERS !== 'true') {
    void import('./services/scheduler.service.js').then(({ startBackgroundSheetsPolling, startMailingScheduler }) => {
      startBackgroundSheetsPolling();
      startMailingScheduler();
    });
  }
}
