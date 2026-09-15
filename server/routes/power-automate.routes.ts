import { Router, raw, type ErrorRequestHandler } from 'express';
import { getOutlookImportService } from '../services/outlook-import.service.js';
import { MailIngressError, maxMailBytes } from '../services/power-automate-mail.js';

export function createPowerAutomateReceiver(load = getOutlookImportService) {
  const router = Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return void res.status(405).json({ error: 'Используйте POST.' }); }
    const key = req.get('X-CRM-Ingest-Key') || '';
    if (!/^[a-f0-9]{64}$/.test(key)) return void res.status(401).json({ error: 'Укажите ключ Power Automate.' });
    if (!req.is('message/rfc822')) return void res.status(415).json({ error: 'Content-Type должен быть message/rfc822, Body — оригинал письма.' });
    // Validate the key before parsing/uploading attachments. Revalidate under
    // the shared import lease so rotation and disabling take effect atomically.
    void load().then(service => service.authorizePower(key)).then(() => next()).catch(next);
  });
  router.use(raw({ type: 'message/rfc822', limit: maxMailBytes }));
  router.post('/', (req, res, next) => {
    const bytes = (req as typeof req & { rawBody?: Buffer }).rawBody || req.body;
    void load().then(service => service.receivePower(req.get('X-CRM-Ingest-Key') || '', bytes, req.get('X-CRM-Received-At') || ''))
      .then(result => res.json(result)).catch(next);
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status = error instanceof MailIngressError ? error.status : error?.type === 'entity.too.large' ? 413 : 503;
    if (status === 429 || status === 503) res.setHeader('Retry-After', '60');
    res.status(status).json({ error: error instanceof MailIngressError ? error.message : status === 413 ?
      'Письмо больше 25 МБ. Нужна ручная проверка.' : 'Не удалось принять письмо. Повторите передачу позже.' });
  };
  router.use(errors);
  return router;
}
export default createPowerAutomateReceiver();
