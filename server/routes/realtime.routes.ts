import { Router, Request, Response } from 'express';
import { isCrmAdmin, getCrmUser } from '../services/crm-auth.service.js';
import { eventForRole } from '../services/gps-access.service.js';
import { afterTrackingCommit, usesFirebase } from '../services/tracking-context.js';
import { requireSignedIn } from '../services/crm-auth.service.js';

const router = Router();

// Active SSE client connections
const sseClients = new Map<Response, Request>();
let stopFirebaseListeners: (() => void) | undefined;
let startingListeners = false;
function serialize(data: any): any {
  if (data?.toDate instanceof Function) return data.toDate().toISOString();
  if (Array.isArray(data)) return data.map(serialize);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, serialize(v)]));
  return data;
}
async function watchFirebase() {
  if (!usesFirebase() || stopFirebaseListeners || startingListeners) return;
  startingListeners = true;
  try {
    const { db } = await import('../config/firebase.js');
    if (!sseClients.size) return;
    const stops = [
      ['regional_orders', 'order'], ['shipments', 'shipment'], ['saved_trucks', 'truck'],
      ['saved_delivery_contacts', 'contact'], ['users', 'user'], ['gps_tracking', 'gps']
    ].map(([collection, event]) => db.collection(collection).onSnapshot(snapshot => {
      for (const change of snapshot.docChanges()) {
        const id = change.doc.id, data = serialize(change.doc.data());
        if (event === 'gps') broadcastRealtimeEvent('telemetry_update', { ...data.position, orderId: id });
        else broadcastRealtimeEvent(event + (change.type === 'removed' ? '_deleted' : change.type === 'added' && ['order', 'shipment'].includes(event) ? '_created' : '_updated'), {
          ...data, [event === 'user' ? 'uid' : 'id']: id
        });
      }
    }, () => sendRealtimeEvent('sync_error', { error: 'Firebase realtime unavailable' })));
    stopFirebaseListeners = () => { stops.forEach(stop => stop()); stopFirebaseListeners = undefined; };
  } finally { startingListeners = false; }
}

/**
 * Broadcast an event to all connected CRM client browsers
 */
export function broadcastRealtimeEvent(eventType: string, data: any): void {
  afterTrackingCommit(() => sendRealtimeEvent(eventType, data));
}
function sendRealtimeEvent(eventType: string, data: any): void {
  for (const [client, request] of sseClients) {
    try {
      if (!getCrmUser(request)) { client.end(); sseClients.delete(client); continue; }
      const visible = eventForRole(eventType, data, isCrmAdmin(request));
      if (visible !== undefined) client.write(`event: ${eventType}\ndata: ${JSON.stringify(visible)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Server-Sent Events (SSE) stream endpoint for instant real-time telemetry and order updates
 * Connect in browser via: const es = new EventSource('/api/realtime/stream');
 */
router.get('/stream', requireSignedIn, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

  sseClients.set(res, req);
  void watchFirebase();
  console.log(`🔌 [SSE Realtime] Client connected. Total active clients: ${sseClients.size}`);

  // Heartbeat every 25 seconds to keep connection open through proxies/firewalls
  const heartbeatTimer = setInterval(() => {
    try {
      if (!getCrmUser(req)) { res.end(); return; }
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeatTimer);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sseClients.delete(res);
    if (!sseClients.size) stopFirebaseListeners?.();
    console.log(`🔌 [SSE Realtime] Client disconnected. Active clients: ${sseClients.size}`);
  });
});

export default router;
