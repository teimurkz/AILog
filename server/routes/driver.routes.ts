import { Router } from "express";
import { 
  updateDriverLocation, 
  getDriverLocation, 
  linkOrderNumberToId,
  syncActiveOrders,
  getActiveOrdersList,
  updateCachedOrderStatus,
  getPendingFirestoreUpdates,
  acknowledgePendingSync,
  setCachedUserToken
} from "../services/telegram.service.js";

const router = Router();

// Middleware to capture client Firebase Auth JWT token if provided
router.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) setCachedUserToken(token);
  }
  next();
});

// Endpoint for frontend to sync all known regional orders to server for Telegram bot
router.post("/sync-orders", (req, res) => {
  try {
    const { orders } = req.body;
    if (Array.isArray(orders)) {
      syncActiveOrders(orders);
    }
    const pendingUpdates = getPendingFirestoreUpdates();
    return res.json({ success: true, count: orders?.length || 0, pendingUpdates });
  } catch (error: any) {
    console.error("Error syncing active orders:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint for frontend to retrieve queued driver actions to commit to Firestore
router.get("/pending-sync", (req, res) => {
  try {
    const pending = getPendingFirestoreUpdates();
    return res.json({ pending });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint for frontend to acknowledge committed updates
router.post("/ack-sync", (req, res) => {
  try {
    const { orderIds } = req.body;
    if (Array.isArray(orderIds)) {
      acknowledgePendingSync(orderIds);
    }
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint to list all active orders
router.get("/orders", (req, res) => {
  try {
    const list = getActiveOrdersList();
    return res.json(list);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Endpoint for driver Telegram bot or mobile client to post GPS position
router.post("/location", (req, res) => {
  try {
    const { orderId, orderNumber, driverPhone, lat, lng, speed, heading, status } = req.body;
    if (!orderId || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "Missing required fields: orderId, lat, lng" });
    }

    if (orderNumber) {
      linkOrderNumberToId(String(orderId), String(orderNumber));
      if (status) {
        updateCachedOrderStatus(String(orderNumber), status, {
          currentLat: Number(lat),
          currentLng: Number(lng),
          speed: speed !== undefined ? Number(speed) : 68
        });
      }
    }

    const updated = updateDriverLocation({
      orderId: String(orderId),
      driverPhone: driverPhone || 'Мобильный Веб-Трекер',
      lat: Number(lat),
      lng: Number(lng),
      speed: speed !== undefined ? Number(speed) : undefined,
      heading: heading !== undefined ? Number(heading) : undefined,
      updatedAt: new Date().toISOString()
    }, status);

    return res.json({ success: true, location: updated });
  } catch (error: any) {
    console.error("Error updating driver location:", error);
    return res.status(500).json({ error: error.message || "Failed to update driver location" });
  }
});

// Endpoint to retrieve real-time location & ETA for a regional order
router.get("/location/:orderId", (req, res) => {
  try {
    const { orderId } = req.params;
    let destinationCity = (req.query.destinationCity as string) || "";
    const orderNumber = (req.query.orderNumber as string) || undefined;
    let status = (req.query.status as string) || undefined;
    const dispatchedAt = (req.query.dispatchedAt as string) || undefined;

    if (orderNumber) {
      linkOrderNumberToId(String(orderId), String(orderNumber));
    }

    // Lookup destinationCity from known orders if not provided or default
    const allOrders = getActiveOrdersList();
    const cleanId = orderId.toLowerCase();
    const cleanNum = orderNumber ? orderNumber.toLowerCase() : '';
    const matched = allOrders.find(o => 
      o.id.toLowerCase() === cleanId || 
      o.orderNumber.toLowerCase() === cleanNum || 
      o.orderNumber.toLowerCase() === cleanId
    );

    if (matched) {
      if (!destinationCity || destinationCity === 'Астана') {
        destinationCity = matched.destinationCity || destinationCity || 'Астана';
      }
      if (!status) {
        status = matched.status || status;
      }
    }
    if (!destinationCity) {
      destinationCity = "Астана";
    }

    const routeData = getDriverLocation(
      orderId, 
      destinationCity, 
      orderNumber, 
      status, 
      dispatchedAt
    );
    return res.json(routeData);
  } catch (error: any) {
    console.error("Error fetching driver location:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch driver location" });
  }
});

export default router;

