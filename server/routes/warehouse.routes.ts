import { Router } from "express";
import {
  getWarehouseData,
  getWarehouseChangeLogs,
  saveLocalLogs
} from "../services/warehouse.service.js";
import { db } from "../config/firebase.js";

const router = Router();

// API endpoint for warehouse data from Google Sheets
router.get("/", async (req, res) => {
  try {
    const data = await getWarehouseData(false);
    res.json(data);
  } catch (error: any) {
    console.error("Error fetching warehouses API:", error);
    res.status(500).json({ error: error.message || "Failed to fetch warehouse data" });
  }
});

// Force live sync directly from Google Sheets
router.post("/sync", async (req, res) => {
  try {
    const data = await getWarehouseData(true);
    res.json({
      success: true,
      message: "Данные успешно синхронизированы напрямую из Google Таблиц!",
      data
    });
  } catch (error: any) {
    console.error("Error in forced warehouse sync API:", error);
    res.status(500).json({ error: error.message || "Failed to synchronize warehouse data" });
  }
});

// API endpoint for warehouse change logs
router.get("/logs", async (req, res) => {
  try {
    const logs = await getWarehouseChangeLogs();
    res.json({ logs });
  } catch (error: any) {
    console.error("Error fetching warehouse change logs:", error);
    res.status(500).json({ error: error.message || "Failed to fetch warehouse logs" });
  }
});

router.post("/logs", async (req, res) => {
  try {
    const logData = req.body;
    if (!logData || !logData.title) {
      return res.status(400).json({ error: "Title is required" });
    }
    const newLog = {
      id: `log-manual-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: new Date().toISOString(),
      warehouseId: logData.warehouseId || 'all',
      warehouseName: logData.warehouseName || 'Все склады',
      product: logData.product || '—',
      invNumber: logData.invNumber || '—',
      changeType: logData.changeType || 'manual',
      title: logData.title,
      description: logData.description || '',
      oldValue: logData.oldValue || '',
      newValue: logData.newValue || '',
      palletDelta: typeof logData.palletDelta === 'number' ? logData.palletDelta : 0,
      author: logData.author || 'Оператор склада',
      source: logData.source || 'Manual'
    };

    saveLocalLogs([newLog]);
    try {
      await db.collection('warehouse_change_logs').doc(newLog.id).set(newLog);
    } catch (dbErr) {
      // Handled by local fallback
    }
    res.json({ success: true, log: newLog });
  } catch (error: any) {
    console.error("Error adding manual warehouse log:", error);
    res.status(500).json({ error: error.message || "Failed to add warehouse log" });
  }
});

export default router;
