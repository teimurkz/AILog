import { Router } from 'express';
import { storageService, UserProfileRecord } from '../services/storage.service';
import { broadcastRealtimeEvent } from './realtime.routes';

const router = Router();

// GET /api/users - list all local users
router.get('/', (req, res) => {
  try {
    return res.json(storageService.getAllUsers());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id - single user
router.get('/:id', (req, res) => {
  try {
    const user = storageService.getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/users - create or update user
router.post('/', (req, res) => {
  try {
    const { uid, email, displayName, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    const user: UserProfileRecord = {
      uid: uid || `usr_${Date.now().toString().slice(-6)}`,
      email,
      displayName: displayName || email.split('@')[0],
      role: role || 'viewer'
    };

    const saved = storageService.saveUser(user);
    broadcastRealtimeEvent('user_updated', saved);
    return res.status(201).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id - update user role or profile
router.put('/:id', (req, res) => {
  try {
    const existing = storageService.getUser(req.params.id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    const updated: UserProfileRecord = {
      ...existing,
      ...req.body,
      uid: existing.uid
    };

    const saved = storageService.saveUser(updated);
    broadcastRealtimeEvent('user_updated', saved);
    return res.json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id - delete user
router.delete('/:id', (req, res) => {
  try {
    const deleted = storageService.deleteUser(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'User not found' });
    broadcastRealtimeEvent('user_deleted', { uid: req.params.id });
    return res.json({ success: true, uid: req.params.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
