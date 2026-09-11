import { Router } from 'express';
import { getCrmUser, requireSignedIn } from '../services/crm-auth.service.js';
const router = Router();
router.get('/session', requireSignedIn, (req, res) => res.json({ user: getCrmUser(req) }));
export default router;
