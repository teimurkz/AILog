import { Router, Request, Response } from 'express';

const router = Router();

// Active SSE client connections
const sseClients = new Set<Response>();

/**
 * Broadcast an event to all connected CRM client browsers
 */
export function broadcastRealtimeEvent(eventType: string, data: any): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Server-Sent Events (SSE) stream endpoint for instant real-time telemetry and order updates
 * Connect in browser via: const es = new EventSource('/api/realtime/stream');
 */
router.get('/stream', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  sseClients.add(res);
  console.log(`🔌 [SSE Realtime] Client connected. Total active clients: ${sseClients.size}`);

  // Heartbeat every 25 seconds to keep connection open through proxies/firewalls
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeatTimer);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sseClients.delete(res);
    console.log(`🔌 [SSE Realtime] Client disconnected. Active clients: ${sseClients.size}`);
  });
});

export default router;
