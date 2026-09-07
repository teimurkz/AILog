import { Router } from "express";
import { updateDriverLocation, getDriverLocation, linkOrderNumberToId } from "../services/telegram.service.js";

const router = Router();

// Endpoint for driver Telegram bot or mobile client to post GPS position
router.post("/location", (req, res) => {
  try {
    const { orderId, orderNumber, driverPhone, lat, lng, speed, heading, status } = req.body;
    if (!orderId || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "Missing required fields: orderId, lat, lng" });
    }

    if (orderNumber) {
      linkOrderNumberToId(String(orderId), String(orderNumber));
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
    const destinationCity = (req.query.destinationCity as string) || "Астана";
    const orderNumber = (req.query.orderNumber as string) || undefined;
    const status = (req.query.status as string) || undefined;
    const dispatchedAt = (req.query.dispatchedAt as string) || undefined;

    if (orderNumber) {
      linkOrderNumberToId(String(orderId), String(orderNumber));
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
