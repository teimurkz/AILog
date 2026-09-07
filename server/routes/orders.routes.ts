import { Router } from 'express';
import { storageService, RegionalOrderRecord } from '../services/storage.service';
import { broadcastRealtimeEvent } from './realtime.routes';
import { updateCachedOrderStatus } from '../services/telegram.service';

const router = Router();

// GET /api/orders/regional - list all regional orders with optional filtering
router.get('/regional', (req, res) => {
  try {
    let orders = storageService.getUniqueOrders();

    const { status, city, driver, search } = req.query;

    if (status && typeof status === 'string') {
      const allowed = status.split(',').map(s => s.trim().toLowerCase());
      orders = orders.filter(o => allowed.includes(o.status.toLowerCase()));
    }

    if (city && typeof city === 'string') {
      const cleanCity = city.toLowerCase().trim();
      orders = orders.filter(o =>
        (o.destinationCity && o.destinationCity.toLowerCase().includes(cleanCity)) ||
        (o.originCity && o.originCity.toLowerCase().includes(cleanCity))
      );
    }

    if (driver && typeof driver === 'string') {
      const cleanDriver = driver.toLowerCase().trim();
      orders = orders.filter(o =>
        o.assignedDriver && o.assignedDriver.toLowerCase().includes(cleanDriver)
      );
    }

    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      orders = orders.filter(o =>
        (o.orderNumber && o.orderNumber.toLowerCase().includes(q)) ||
        (o.destinationCity && o.destinationCity.toLowerCase().includes(q)) ||
        (o.assignedDriver && o.assignedDriver.toLowerCase().includes(q)) ||
        (o.assignedTruckPlate && o.assignedTruckPlate.toLowerCase().includes(q)) ||
        (o.invoiceNumber && o.invoiceNumber.toLowerCase().includes(q))
      );
    }

    // Sort by created/dispatched descending
    orders.sort((a, b) => {
      const tA = new Date(a.createdAt || a.shipmentDate || 0).getTime();
      const tB = new Date(b.createdAt || b.shipmentDate || 0).getTime();
      return tB - tA;
    });

    return res.json(orders);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/regional/:id - single order
router.get('/regional/:id', (req, res) => {
  try {
    const order = storageService.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json(order);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/orders/regional - create order
router.post('/regional', (req, res) => {
  try {
    const data = req.body as Partial<RegionalOrderRecord>;
    if (!data.orderNumber || !data.destinationCity) {
      return res.status(400).json({ error: 'Missing required fields: orderNumber, destinationCity' });
    }

    const newOrder: RegionalOrderRecord = {
      id: data.id || `REG-${Math.floor(1000 + Math.random() * 9000)}`,
      orderNumber: data.orderNumber,
      destinationCity: data.destinationCity,
      originCity: data.originCity || 'Алматы',
      status: data.status || 'new',
      deliveryAddress: data.deliveryAddress,
      recipientPhone: data.recipientPhone,
      deliveryPoints: data.deliveryPoints || [],
      invoiceNumber: data.invoiceNumber,
      invoiceFileName: data.invoiceFileName,
      invoiceFileData: data.invoiceFileData,
      invoiceFileType: data.invoiceFileType,
      invoices: data.invoices || [],
      shipmentDate: data.shipmentDate || new Date().toISOString().split('T')[0],
      truckType: data.truckType || 'Фура 20т',
      palletsCount: data.palletsCount,
      weight: data.weight,
      cargoDescription: data.cargoDescription,
      managerName: data.managerName || 'Логист',
      managerPhone: data.managerPhone,
      comments: data.comments,
      assignedDriver: data.assignedDriver,
      assignedTruckPlate: data.assignedTruckPlate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = storageService.saveOrder(newOrder);
    updateCachedOrderStatus(saved.orderNumber, saved.status, saved);
    broadcastRealtimeEvent('order_created', saved);

    return res.status(201).json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/orders/regional/:id - update order
router.put('/regional/:id', (req, res) => {
  try {
    const existing = storageService.getOrder(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const updates = req.body as Partial<RegionalOrderRecord>;
    const merged: RegionalOrderRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      updatedAt: new Date().toISOString()
    };

    const saved = storageService.saveOrder(merged);
    updateCachedOrderStatus(saved.orderNumber, saved.status, saved);
    broadcastRealtimeEvent('order_updated', saved);

    return res.json(saved);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/orders/regional/:id - delete order
router.delete('/regional/:id', (req, res) => {
  try {
    const deleted = storageService.deleteOrder(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Order not found' });
    }

    broadcastRealtimeEvent('order_deleted', { id: req.params.id });
    return res.json({ success: true, id: req.params.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
