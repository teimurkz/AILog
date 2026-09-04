import { Router } from "express";
import { updateDriverLocation, getDriverLocation } from "../services/telegram.service.js";

const router = Router();

// Endpoint for driver Telegram bot or mobile client to post GPS position
router.post("/location", (req, res) => {
  try {
    const { orderId, driverPhone, lat, lng, speed } = req.body;
    if (!orderId || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "Missing required fields: orderId, lat, lng" });
    }

    const updated = updateDriverLocation({
      orderId,
      driverPhone,
      lat: Number(lat),
      lng: Number(lng),
      speed: speed ? Number(speed) : undefined,
      updatedAt: new Date().toISOString()
    });

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

    const routeData = getDriverLocation(orderId, destinationCity);
    return res.json(routeData);
  } catch (error: any) {
    console.error("Error fetching driver location:", error);
    return res.status(500).json({ error: error.message || "Failed to fetch driver location" });
  }
});

export default router;
