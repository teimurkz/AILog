import "dotenv/config";
import http from "http";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { initSocketServer } from "./services/socket.service.js";

import warehouseRoutes from "./routes/warehouse.routes.js";
import mailingRoutes from "./routes/mailing.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";
import driverRoutes from "./routes/driver.routes.js";
import ordersRoutes from "./routes/orders.routes.js";
import shipmentsRoutes from "./routes/shipments.routes.js";
import contactsRoutes from "./routes/contacts.routes.js";
import usersRoutes from "./routes/users.routes.js";
import uploadRoutes from "./routes/upload.routes.js";
import realtimeRoutes from "./routes/realtime.routes.js";
import authRoutes from "./routes/auth.routes.js";
import { authenticateCrm, requireSignedIn } from "./services/crm-auth.service.js";
import { usesFirebase } from './services/tracking-context.js';
import firebaseDataRoutes from './routes/firebase-data.routes.js';

import {
  startBackgroundSheetsPolling,
  startMailingScheduler
} from "./services/scheduler.service.js";
import { startTelegramBotPolling } from "./services/telegram.service.js";

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = initSocketServer(httpServer);
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use('/api', authenticateCrm);
  app.use('/api/auth', authRoutes);

  // Static uploads directory for local documents/invoices
  const uploadsPath = path.join(process.cwd(), "server", "uploads");
  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }
  if (!usesFirebase()) app.use("/uploads", express.static(uploadsPath));

  // Existing Firebase project/database is the production source of truth.
  app.use("/api/orders", ordersRoutes);
  app.use("/api/realtime", realtimeRoutes);

  // Existing service routes
  app.use("/api/warehouses", requireSignedIn, warehouseRoutes);
  app.use("/api/mailing", requireSignedIn, mailingRoutes);
  app.use("/api/parse-invoice", requireSignedIn, invoiceRoutes);
  app.use("/api/driver", driverRoutes);
  if (usesFirebase()) app.use('/api', firebaseDataRoutes);
  else {
    app.use("/api/shipments", requireSignedIn, shipmentsRoutes);
    app.use("/api", contactsRoutes);
    app.use("/api/users", usersRoutes);
    app.use("/api/upload", requireSignedIn, uploadRoutes);
  }

  const distPath = path.join(process.cwd(), "dist");
  app.use((req, res, next) => {
    if (req.path.startsWith('/server/') || /^\/server\.cjs(?:\.map)?$/.test(req.path)) return void res.sendStatus(404);
    next();
  });

  // Vite middleware for development / static serving for production
  if (process.env.NODE_ENV !== "production" && !process.argv[1]?.endsWith('.cjs')) {
    const vite = await createViteServer({
      server: { middlewareMode: true, fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/server/data/**', '**/scratch/**'] } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Start background schedulers & Telegram Bot
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    // Only the successfully listening process may consume driver messages.
    startTelegramBotPolling();
    if (process.env.DISABLE_BACKGROUND_SCHEDULERS !== 'true') {
      startBackgroundSheetsPolling();
      startMailingScheduler();
    }
  });
}

startServer();
