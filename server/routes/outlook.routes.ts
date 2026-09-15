import { Router, type RequestHandler } from 'express';
import { getCrmUser, requireSameOrigin } from '../services/crm-auth.service.js';
import { getOutlookImportService } from '../services/outlook-import.service.js';
import { ImportReview } from '../services/outlook-invoice.js';
import { OutlookError } from '../services/outlook-graph.js';
import { validateOutlookSettings } from '../../shared/outlook-import.js';

const router = Router();
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const user = getCrmUser(req);
  if (!user) return void res.status(401).json({ error: 'Войдите в CRM.' });
  if (user.role !== 'admin') return void res.status(403).json({ error: 'Подключение почты доступно только администратору.' });
  next();
});
const route = (fn: (service: Awaited<ReturnType<typeof getOutlookImportService>>, req: any) => Promise<unknown>): RequestHandler => (req, res) => {
  void getOutlookImportService().then(service => fn(service, req)).then(result => res.json(result || { success: true })).catch(error => {
    const known = error instanceof ImportReview || error instanceof OutlookError;
    res.status(known ? 400 : 503).json({ error: known ? error.message : 'Не удалось выполнить запрос. Проверьте публикацию функции и доступ Firebase.' });
  });
};
router.get('/status', route(service => service.status()));
router.put('/settings', requireSameOrigin, (req, res, next) => {
  try { req.body = validateOutlookSettings(req.body); next(); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); }
}, route((service, req) => service.saveSettings(req.body)));
router.post('/connect', requireSameOrigin, route((service, req) => service.beginLogin(getCrmUser(req)!.uid)));
router.post('/connect/:id/poll', requireSameOrigin, route((service, req) => service.pollLogin(getCrmUser(req)!.uid, req.params.id)));
router.delete('/connection', requireSameOrigin, route(service => service.disconnect()));
router.post('/run', requireSameOrigin, route(service => service.run(true)));
router.post('/retry/:id', requireSameOrigin, route((service, req) => service.retry(req.params.id)));
export default router;
