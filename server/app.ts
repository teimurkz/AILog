import 'dotenv/config';
import express, { type ErrorRequestHandler } from 'express';
import path from 'node:path';
import { initSocketServer } from './services/socket.service.js';
import warehouseRoutes from './routes/warehouse.routes.js';
import mailingRoutes from './routes/mailing.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import driverRoutes from './routes/driver.routes.js';
import ordersRoutes from './routes/orders.routes.js';
import shipmentsRoutes from './routes/shipments.routes.js';
import contactsRoutes from './routes/contacts.routes.js';
import usersRoutes from './routes/users.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import realtimeRoutes from './routes/realtime.routes.js';
import authRoutes from './routes/auth.routes.js';
import firebaseDataRoutes from './routes/firebase-data.routes.js';
import { authenticateCrm, requireSignedIn } from './services/crm-auth.service.js';
import { usesFirebase } from './services/tracking-context.js';
import { startBackgroundSheetsPolling, startMailingScheduler } from './services/scheduler.service.js';
import { startTelegramBotPolling } from './services/telegram.service.js';

// The Node entry point and both Vite launch modes use the same protected API.
export function createCrmApi(httpServer: Parameters<typeof initSocketServer>[0]) {
  const app = express();
  initSocketServer(httpServer);
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
  app.use('/api/realtime', realtimeRoutes);
  app.use('/api/warehouses', requireSignedIn, warehouseRoutes);
  app.use('/api/mailing', requireSignedIn, mailingRoutes);
  app.use('/api/parse-invoice', requireSignedIn, invoiceRoutes);
  app.use('/api/driver', driverRoutes);
  if (usesFirebase()) app.use('/api', firebaseDataRoutes);
  else {
    app.use('/api/shipments', requireSignedIn, shipmentsRoutes);
    app.use('/api', contactsRoutes);
    app.use('/api/users', usersRoutes);
    app.use('/api/upload', requireSignedIn, uploadRoutes);
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
    startBackgroundSheetsPolling();
    startMailingScheduler();
  }
}
