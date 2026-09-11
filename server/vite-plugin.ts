import type { Plugin, PreviewServer, ViteDevServer } from 'vite';

export function crmServerPlugin(): Plugin {
  const mountApi = async (server: ViteDevServer | PreviewServer) => {
    const httpServer = server.httpServer;
    if (!httpServer) throw new Error('CRM API requires an HTTP server');
    const { createCrmApi, startCrmBackgroundJobs } = await import('./app.js');
    // Mount before Vite's SPA middleware, including when AI Studio invokes Vite directly.
    server.middlewares.use(createCrmApi(httpServer));
    if (httpServer.listening) startCrmBackgroundJobs();
    else httpServer.once('listening', startCrmBackgroundJobs);
  };
  return {
    name: 'silk-road-crm-server',
    apply: 'serve',
    async configureServer(server) {
      // npm run dev already owns the API and embeds Vite into Express.
      if (!server.config.server.middlewareMode) await mountApi(server);
    },
    configurePreviewServer: mountApi,
  };
}
