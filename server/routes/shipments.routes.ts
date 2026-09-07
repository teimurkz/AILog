import { Router } from 'express';
import { storageService, ShipmentRecord, ShipmentLogRecord } from '../services/storage.service';
import { broadcastRealtimeEvent } from './realtime.routes';

const router = Router();

// GET /api/shipments - list all shipments
router.get('/', (req, res) => {
  try {
    const list = storageService.getAllShipments();
    return res.json(list);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/shipments/:id - single shipment
router.get('/:id', (req, res) => {
  try {
    const item = storageService.getShipment(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Shipment not found' });
    }
    return res.json(item);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/shipments - create shipment
router.post('/', (req, res) => {
  try {
    const body = req.body as Partial<ShipmentRecord>;
    if (!body.invoice_id) {
      return res.status(400).json({ error: 'Missing required field: invoice_id' });
    }

    const newShipment: ShipmentRecord = {
      id: body.id || `SHIP-${Date.now().toString().slice(-6)}`,
      invoice_id: body.invoice_id,
      week: body.week,
      shipment_type: body.shipment_type || 'Direct-Land',
      destination: body.destination || 'Almaty - Kazakhstan',
      goods: body.goods || '',
      driver_name: body.driver_name || '',
      driver_phone: body.driver_phone || '',
      plate_number: body.plate_number || '',
      truck_driver: body.truck_driver || '',
      loading_date: body.loading_date || '',
      ex_border_date: body.ex_border_date || '',
      customs_arrival_date: body.customs_arrival_date || '',
      unl_date: body.unl_date || '',
      transit_time: body.transit_time || 0,
      route: body.route || 'Tehran - Almaty',
      departure_date: body.departure_date || new Date().toISOString(),
      est_travel_time: Number(body.est_travel_time) || 7,
      arrival_deadline: body.arrival_deadline || new Date().toISOString(),
      actual_arrival_date: body.actual_arrival_date,
      customs_date: body.customs_date,
      status: body.status || 'In Transit',
      status_message: body.status_message,
      documents_url: body.documents_url || [],
      last_updated: new Date().toISOString(),
      createdBy: body.createdBy || 'Логист',
      items: body.items || [],
      isArchived: Boolean(body.isArchived)
    };

    const saved = storageService.saveShipment(newShipment);
    broadcastRealtimeEvent('shipment_created', saved);

    return res.status(201).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/shipments/:id - update shipment
router.put('/:id', (req, res) => {
  try {
    const existing = storageService.getShipment(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    const updates = req.body as Partial<ShipmentRecord>;
    const merged: ShipmentRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      last_updated: new Date().toISOString()
    };

    const saved = storageService.saveShipment(merged);
    broadcastRealtimeEvent('shipment_updated', saved);

    return res.json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shipments/:id - delete shipment
router.delete('/:id', (req, res) => {
  try {
    const deleted = storageService.deleteShipment(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    broadcastRealtimeEvent('shipment_deleted', { id: req.params.id });
    return res.json({ success: true, id: req.params.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/shipments/:id/logs - list logs for a shipment
router.get('/:id/logs', (req, res) => {
  try {
    const logs = storageService.getShipmentLogs(req.params.id);
    return res.json(logs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/shipments/:id/logs - add a log entry
router.post('/:id/logs', (req, res) => {
  try {
    const { location, message, updatedBy } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }

    const log = storageService.addShipmentLog({
      shipmentId: req.params.id,
      timestamp: new Date().toISOString(),
      location: location || '',
      message,
      updatedBy: updatedBy || 'Логист'
    });

    broadcastRealtimeEvent('shipment_log_added', log);
    return res.status(201).json(log);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
