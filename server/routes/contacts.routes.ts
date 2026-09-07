import { Router } from 'express';
import { storageService, SavedTruckRecord, SavedDeliveryContactRecord } from '../services/storage.service';
import { broadcastRealtimeEvent } from './realtime.routes';

const router = Router();

// --- SAVED TRUCKS ---
router.get('/saved-trucks', (req, res) => {
  try {
    return res.json(storageService.getAllTrucks());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/saved-trucks', (req, res) => {
  try {
    const { plateNumber, model, status } = req.body;
    if (!plateNumber) return res.status(400).json({ error: 'Missing plateNumber' });

    const saved = storageService.saveTruck({
      id: req.body.id || `TRK-${Date.now().toString().slice(-4)}`,
      plateNumber,
      model: model || '',
      status: status || 'Available'
    });

    broadcastRealtimeEvent('truck_updated', saved);
    return res.status(201).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/saved-trucks/:id', (req, res) => {
  try {
    const deleted = storageService.deleteTruck(req.params.id);
    broadcastRealtimeEvent('truck_deleted', { id: req.params.id });
    return res.json({ success: deleted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// --- DELIVERY CONTACTS ---
router.get('/delivery-contacts', (req, res) => {
  try {
    return res.json(storageService.getAllContacts());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/delivery-contacts', (req, res) => {
  try {
    const { title, city, deliveryAddress, recipientPhone, recipientName, notes } = req.body;
    if (!title) return res.status(400).json({ error: 'Missing title' });

    const saved = storageService.saveContact({
      id: req.body.id || `CNT-${Date.now().toString().slice(-4)}`,
      title,
      city: city || 'Астана',
      deliveryAddress: deliveryAddress || '',
      recipientPhone: recipientPhone || '',
      recipientName: recipientName || '',
      notes: notes || ''
    });

    broadcastRealtimeEvent('contact_updated', saved);
    return res.status(201).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/delivery-contacts/:id', (req, res) => {
  try {
    const deleted = storageService.deleteContact(req.params.id);
    broadcastRealtimeEvent('contact_deleted', { id: req.params.id });
    return res.json({ success: deleted });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
