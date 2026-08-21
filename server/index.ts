import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

import warehouseRoutes from "./routes/warehouse.routes.js";
import mailingRoutes from "./routes/mailing.routes.js";
import invoiceRoutes from "./routes/invoice.routes.js";

import {
  startBackgroundSheetsPolling,
  startMailingScheduler
} from "./services/scheduler.service.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.use("/api/warehouses", warehouseRoutes);
  app.use("/api/mailing", mailingRoutes);
  app.use("/api/parse-invoice", invoiceRoutes);

  // Vite middleware for development / static serving for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Start background schedulers
  startBackgroundSheetsPolling();
  startMailingScheduler();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

startServer();
