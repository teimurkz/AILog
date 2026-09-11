import { tracked } from '../services/firebase-tracking.service.js';
import { Router } from 'express';
import { storageService, RegionalOrderRecord } from '../services/storage.service';
import { broadcastRealtimeEvent } from './realtime.routes';
import { updateCachedOrderStatus, stopOrderTracking } from '../services/telegram.service';
import { isCrmAdmin, requireSameOrigin, requireSignedIn, getCrmUser } from '../services/crm-auth.service.js';
import { withoutGps } from '../services/gps-access.service.js';

const router = Router();
router.use(requireSignedIn);
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return requireSameOrigin(req, res, next);
  next();
});

// GET /api/orders/regional - list all regional orders with optional filtering
router.get('/regional', tracked((req, res) => {
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

    return res.json(isCrmAdmin(req) ? orders : withoutGps(orders));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}));

// GET /api/orders/regional/:id - single order
router.get('/regional/:id', tracked((req, res) => {
  try {
    const order = storageService.getOrder(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.json(isCrmAdmin(req) ? order : withoutGps(order));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}));

// POST /api/orders/regional - create order
router.post('/regional', tracked((req, res) => {
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
      createdByEmail: getCrmUser(req)?.email,
      createdByName: getCrmUser(req)?.displayName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const saved = storageService.saveOrder(newOrder);
    updateCachedOrderStatus(saved.orderNumber, saved.status, saved);
    broadcastRealtimeEvent('order_created', saved);

    return res.status(201).json(isCrmAdmin(req) ? saved : withoutGps(saved));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}));

// PUT /api/orders/regional/:id - update order
router.put('/regional/:id', tracked((req, res) => {
  try {
    const existing = storageService.getOrder(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // GPS and driver consent are written exclusively by the tracking service.
    const updates = withoutGps(req.body) as Partial<RegionalOrderRecord>;
    if (['delivered', 'cancelled'].includes(existing.status) && updates.status && updates.status !== existing.status) {
      return res.status(409).json({ error: 'Рейс уже закрыт. Создайте новую заявку для следующей доставки.' });
    }
    const merged: RegionalOrderRecord = {
      ...existing,
      ...updates,
      id: existing.id,
      createdByEmail: existing.createdByEmail,
      createdByName: existing.createdByName,
      updatedAt: new Date().toISOString()
    };

    const saved = storageService.saveOrder(merged);
    updateCachedOrderStatus(saved.orderNumber, saved.status, saved);
    broadcastRealtimeEvent('order_updated', saved);

    return res.json(isCrmAdmin(req) ? saved : withoutGps(saved));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}));

// DELETE /api/orders/regional/:id - delete order
router.delete('/regional/:id', tracked((req, res) => {
  try {
    const existing = storageService.getOrder(req.params.id);
    const user = getCrmUser(req)!;
    if (existing && user.role !== 'admin' && user.role !== 'logistics' &&
        (!user.email || existing.createdByEmail !== user.email)) return res.status(403).json({ error: 'Недостаточно прав для удаления этой заявки.' });
    stopOrderTracking(req.params.id);
    const deleted = storageService.deleteOrder(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Order not found' });
    }

    broadcastRealtimeEvent('order_deleted', { id: req.params.id });
    return res.json({ success: true, id: req.params.id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}));

export default router;
