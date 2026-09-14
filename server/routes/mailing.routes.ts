import { Router } from "express";
import {
  getMailingSubscribers,
  saveMailingSubscribers,
  getMailingSettings,
  saveMailingSettings,
  getMailingLogs
} from "../services/mailing.service.js";
import {
  getSmtpTransporter
} from "../services/email.service.js";
import {
  generateWarehouseExcelBufferAsync
} from "../services/excel.service.js";
import {
  getWarehouseData
} from "../services/warehouse.service.js";
import {
  executeMailingDispatch,
  resetAutoSentKey,
  getSchedulerDiagnostics
} from "../services/scheduler.service.js";
import { getZonedTime } from "../utils/helpers.js";
import { db } from "../config/firebase.js";

const router = Router();

// GET Subscribers
router.get("/subscribers", async (req, res) => {
  try {
    const subscribers = await getMailingSubscribers();
    res.json({ subscribers });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to load subscribers" });
  }
});

// POST Subscriber (Add / Update)
router.post("/subscribers", async (req, res) => {
  try {
    const subData = req.body;
    if (!subData.email) {
      return res.status(400).json({ error: "Email address is required" });
    }

    let subscribers = await getMailingSubscribers();
    
    if (subData.id) {
      // Update
      subscribers = subscribers.map(s => s.id === subData.id ? { ...s, ...subData, updatedAt: new Date().toISOString() } : s);
    } else {
      // Add
      const newSub = {
        id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: subData.name || subData.email.split('@')[0],
        email: subData.email.trim(),
        department: subData.department || 'Логистика / Склад',
        isActive: subData.isActive !== false,
        selectedWarehouses: subData.selectedWarehouses || ['all'],
        formatPreference: subData.formatPreference || 'xlsx',
        comments: subData.comments || '',
        createdAt: new Date().toISOString()
      };
      subscribers.unshift(newSub);
    }

    await saveMailingSubscribers(subscribers);
    res.json({ success: true, subscribers });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to save subscriber" });
  }
});

// DELETE Subscriber
router.delete("/subscribers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    let subscribers = await getMailingSubscribers();
    subscribers = subscribers.filter(s => s.id !== id);
    await saveMailingSubscribers(subscribers);

    try {
      await db.collection('mailing_subscribers').doc(id).delete();
    } catch (e) {}

    res.json({ success: true, subscribers });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to delete subscriber" });
  }
});

// GET Settings
router.get("/settings", async (req, res) => {
  try {
    const settings = await getMailingSettings();
    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get settings" });
  }
});

// POST Settings
router.post("/settings", async (req, res) => {
  try {
    const newSettings = req.body;
    const current = await getMailingSettings();
    
    // Check if time schedule parameters actually changed
    const scheduleChanged =
      newSettings.sendTime !== undefined && newSettings.sendTime !== current.sendTime ||
      newSettings.scheduleType !== undefined && newSettings.scheduleType !== current.scheduleType ||
      newSettings.timezone !== undefined && newSettings.timezone !== current.timezone;

    const updated = { ...current, ...newSettings };

    if (scheduleChanged) {
      updated.lastAutoSentKey = '';
      resetAutoSentKey();
    }

    await saveMailingSettings(updated);
    res.json({ success: true, settings: updated });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to save settings" });
  }
});

// POST Set Quick Time for Instant Testing (Now + 1 min or + 2 mins)
router.post("/set-quick-time", async (req, res) => {
  try {
    const offsetMinutes = Number(req.body?.offsetMinutes || 1);
    const currentSettings = await getMailingSettings();
    const tz = currentSettings.timezone || 'Asia/Almaty';
    
    const zoned = getZonedTime(tz);
    const [cH, cM] = zoned.HHmm.split(':').map(Number);
    const targetDate = new Date();
    targetDate.setHours(cH || 0, (cM || 0) + offsetMinutes, 0, 0);
    
    const targetH = String(targetDate.getHours()).padStart(2, '0');
    const targetM = String(targetDate.getMinutes()).padStart(2, '0');
    const quickTimeStr = `${targetH}:${targetM}`;

    const updated = {
      ...currentSettings,
      sendTime: quickTimeStr,
      enabled: true,
      lastAutoSentKey: '',
      lastAutoSentDate: '',
      lastAutoSentTime: ''
    };

    await saveMailingSettings(updated);
    resetAutoSentKey();

    res.json({
      success: true,
      sendTime: quickTimeStr,
      message: `Время рассылки установлено на ${quickTimeStr} (${tz}). Ожидайте срабатывания планировщика!`,
      settings: updated
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to set quick time" });
  }
});

// GET Scheduler Diagnostics
router.get("/check-scheduler", async (req, res) => {
  try {
    const diag = await getSchedulerDiagnostics();
    res.json(diag);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to check scheduler" });
  }
});

// GET Mailing Live Status & Scheduler State
router.get("/status", async (req, res) => {
  try {
    const settings = await getMailingSettings();
    const subscribers = await getMailingSubscribers();
    const activeSubs = subscribers.filter(s => s.isActive);
    const logs = await getMailingLogs();
    const lastLog = logs.length > 0 ? logs[0] : null;

    const tz = settings?.timezone || 'Asia/Almaty';
    const zoned = getZonedTime(tz);
    const diag = await getSchedulerDiagnostics();

    res.json({
      enabled: settings?.enabled ?? true,
      scheduleType: settings?.scheduleType || 'daily',
      sendTime: settings?.sendTime || '09:00',
      intervalMinutes: settings?.intervalMinutes || 1,
      timezone: tz,
      currentZonedTime: zoned.fullZonedString,
      currentHHmm: zoned.HHmm,
      todayDateStr: zoned.todayDateStr,
      dayOfWeek: zoned.dayOfWeek,
      subscribersCount: subscribers.length,
      activeSubscribersCount: activeSubs.length,
      smtpUser: settings?.smtpUser || process.env.SMTP_USER || '',
      hasSmtpPass: !!(settings?.smtpPass || process.env.SMTP_PASS),
      lastLog,
      diagnostics: diag
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to get mailing status" });
  }
});

// GET Download Live Excel File
router.get("/download-excel", async (req, res) => {
  try {
    const warehouseData = await getWarehouseData();
    const excelBuffer = await generateWarehouseExcelBufferAsync(warehouseData);

    const dateStr = new Date().toISOString().split('T')[0];
    const filename = `Daily_Report_Vehicles_and_Stock_${dateStr}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (error: any) {
    console.error("Error generating Excel download:", error);
    res.status(500).json({ error: error.message || "Failed to generate Excel file" });
  }
});

// Verify authentication/TLS without sending a message.
router.post('/test-smtp', async (req, res) => {
  let smtp: Awaited<ReturnType<typeof getSmtpTransporter>> | undefined;
  try {
    smtp = await getSmtpTransporter({ ...await getMailingSettings(), ...req.body });
    if (!smtp.configured || !smtp.transporter) return res.status(400).json({ success: false, error: smtp.error });
    await smtp.transporter.verify();
    res.json({ success: true, message: `Подключение к SMTP проверено (${smtp.host}:${smtp.port}). Письмо не отправлялось.` });
  } catch {
    res.status(400).json({ success: false, error: 'Не удалось подключиться к SMTP. Проверьте хост, порт и пароль приложения.' });
  } finally { smtp?.transporter?.close(); }
});

// POST Send Auto-Mailing
router.post("/send", async (req, res) => {
  try {
    const { targetSubscriberIds, customEmail, triggerSource = 'manual' } = req.body;
    const result = await executeMailingDispatch({ targetSubscriberIds, customEmail, triggerSource });

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error: any) {
    console.error("Error sending mailing:", error);
    res.status(500).json({ error: error.message || "Failed to process mailing request" });
  }
});

// POST Force Auto-Mailing Trigger
router.post("/force-cron-trigger", async (req, res) => {
  try {
    const result = await executeMailingDispatch({ triggerSource: 'automatic_test' });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to force trigger auto-mailing" });
  }
});

// GET Mailing Logs
router.get("/logs", async (req, res) => {
  try {
    const logs = await getMailingLogs();
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to fetch mailing logs" });
  }
});

export default router;
