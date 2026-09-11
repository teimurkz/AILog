import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { createCrmApi, startCrmBackgroundJobs } from './app.js';

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(createCrmApi(httpServer));
  const portFlag = process.argv.indexOf('--port');
  const portArgument = portFlag >= 0 ? process.argv[portFlag + 1] : process.argv.find(arg => arg.startsWith('--port='))?.slice(7);
  const port = Number(process.env.PORT || portArgument || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid server port');

  if (process.env.NODE_ENV !== 'production' && !process.argv[1]?.endsWith('.cjs')) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`CRM server running on http://localhost:${port}`);
    // Only the successfully listening process may consume driver messages.
    startCrmBackgroundJobs();
  });
}

startServer().catch(error => {
  console.error('CRM server failed to start:', error);
  process.exitCode = 1;
});
