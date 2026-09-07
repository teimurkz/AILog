import fs from 'fs';
import path from 'path';

export interface LocationPoint {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp?: string;
}

export interface RegionalOrderRecord {
  id: string;
  orderNumber: string;
  destinationCity: string;
  originCity?: string;
  status: 'new' | 'loading' | 'dispatched' | 'delivered' | 'cancelled';
  assignedDriver?: string;
  assignedTruckPlate?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  currentLat?: number;
  currentLng?: number;
  speed?: number;
  heading?: number;
  lastGpsUpdate?: string;
}

export interface DriverSessionRecord {
  chatId: number;
  orderId: string;
  orderNumber: string;
  driverName?: string;
  tripActive: boolean;
  startedAt?: string;
  lastUpdated: string;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'regional_orders_cache.json');
const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry_history.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'driver_sessions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (content) {
        return JSON.parse(content) as T;
      }
    }
  } catch (err) {
    console.warn(`[Storage] Failed to read ${path.basename(filePath)}:`, err);
  }
  return fallback;
}

function safeWriteJson(filePath: string, data: any): void {
  try {
    const tempFile = `${filePath}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempFile, filePath);
  } catch (err) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (fallbackErr) {
      console.error(`[Storage] Failed to write ${path.basename(filePath)}:`, fallbackErr);
    }
  }
}

class StorageService {
  private orders: Map<string, RegionalOrderRecord> = new Map();
  private telemetry: Map<string, LocationPoint[]> = new Map();
  private sessions: Map<number, DriverSessionRecord> = new Map();

  constructor() {
    this.loadAll();
  }

  private loadAll() {
    // 1. Load orders
    const rawOrders = safeReadJson<RegionalOrderRecord[]>(ORDERS_FILE, []);
    rawOrders.forEach(order => {
      if (order.id) this.orders.set(order.id, order);
      if (order.orderNumber) this.orders.set(order.orderNumber.toUpperCase(), order);
    });

    // 2. Load telemetry history
    const rawTelemetry = safeReadJson<Record<string, LocationPoint[]>>(TELEMETRY_FILE, {});
    for (const [key, points] of Object.entries(rawTelemetry)) {
      if (Array.isArray(points)) {
        this.telemetry.set(key.toUpperCase(), points);
      }
    }

    // 3. Load driver sessions
    const rawSessions = safeReadJson<DriverSessionRecord[]>(SESSIONS_FILE, []);
    rawSessions.forEach(session => {
      if (session.chatId) {
        this.sessions.set(session.chatId, session);
      }
    });

    console.log(`💾 [Local DB] Loaded ${this.getUniqueOrders().length} orders, ${this.telemetry.size} telemetry trails, ${this.sessions.size} driver sessions.`);
  }

  // --- ORDERS ---
  public getUniqueOrders(): RegionalOrderRecord[] {
    const seen = new Set<string>();
    const list: RegionalOrderRecord[] = [];
    for (const o of this.orders.values()) {
      const key = (o.orderNumber || o.id).toUpperCase();
      if (!seen.has(key)) {
        seen.add(key);
        list.push(o);
      }
    }
    return list;
  }

  public getOrder(orderIdOrNumber: string): RegionalOrderRecord | undefined {
    if (!orderIdOrNumber) return undefined;
    const clean = orderIdOrNumber.trim().toUpperCase();
    return this.orders.get(clean) || this.orders.get(orderIdOrNumber.trim());
  }

  public saveOrders(orders: RegionalOrderRecord[]): void {
    orders.forEach(order => {
      const keyId = order.id;
      const keyNum = order.orderNumber ? order.orderNumber.toUpperCase() : '';
      
      const existing = this.orders.get(keyNum) || (keyId ? this.orders.get(keyId) : undefined);
      const merged: RegionalOrderRecord = {
        ...existing,
        ...order,
        // Keep active status and GPS if in flight
        status: existing?.status === 'dispatched' && order.status !== 'delivered' ? 'dispatched' : order.status,
        currentLat: order.currentLat ?? existing?.currentLat,
        currentLng: order.currentLng ?? existing?.currentLng,
        speed: order.speed ?? existing?.speed,
        lastGpsUpdate: order.lastGpsUpdate ?? existing?.lastGpsUpdate
      };

      if (keyId) this.orders.set(keyId, merged);
      if (keyNum) this.orders.set(keyNum, merged);
    });

    safeWriteJson(ORDERS_FILE, this.getUniqueOrders());
  }

  public updateOrderStatus(orderIdOrNumber: string, status: RegionalOrderRecord['status'], extra?: Partial<RegionalOrderRecord>): RegionalOrderRecord | undefined {
    const existing = this.getOrder(orderIdOrNumber);
    if (!existing) return undefined;

    const updated: RegionalOrderRecord = {
      ...existing,
      status,
      ...(extra || {}),
      ...(status === 'dispatched' && !existing.dispatchedAt ? { dispatchedAt: new Date().toISOString() } : {}),
      ...(status === 'delivered' ? { deliveredAt: new Date().toISOString(), speed: 0 } : {})
    };

    if (updated.id) this.orders.set(updated.id, updated);
    if (updated.orderNumber) this.orders.set(updated.orderNumber.toUpperCase(), updated);

    safeWriteJson(ORDERS_FILE, this.getUniqueOrders());
    return updated;
  }

  // --- TELEMETRY & GPS HISTORY ---
  public getTelemetry(orderIdOrNumber: string): LocationPoint[] {
    const clean = orderIdOrNumber.trim().toUpperCase();
    return this.telemetry.get(clean) || [];
  }

  public appendTelemetryPoint(orderIdOrNumber: string, point: LocationPoint): LocationPoint[] {
    const clean = orderIdOrNumber.trim().toUpperCase();
    const history = this.telemetry.get(clean) || [];

    // Check distance to last point to prevent bloated stationary duplicates
    const lastPoint = history[history.length - 1];
    let shouldAppend = true;
    if (lastPoint) {
      const dLat = (point.lat - lastPoint.lat) * (Math.PI / 180);
      const dLon = (point.lng - lastPoint.lng) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lastPoint.lat * (Math.PI / 180)) * Math.cos(point.lat * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distMeters = 6371000 * c;

      // Only append new point to breadcrumb trail if moved by at least 15 meters
      // or if last point is older than 5 minutes
      const lastTime = lastPoint.timestamp ? new Date(lastPoint.timestamp).getTime() : 0;
      const nowTime = point.timestamp ? new Date(point.timestamp).getTime() : Date.now();
      if (distMeters < 15 && (nowTime - lastTime) < 300000) {
        shouldAppend = false;
        // Just update latest speed and timestamp on last point
        lastPoint.speed = point.speed;
        lastPoint.timestamp = point.timestamp || new Date().toISOString();
      }
    }

    if (shouldAppend) {
      history.push({
        lat: point.lat,
        lng: point.lng,
        speed: point.speed,
        heading: point.heading,
        accuracy: point.accuracy,
        timestamp: point.timestamp || new Date().toISOString()
      });

      // Keep up to last 1000 real points for high resolution route breadcrumbs
      if (history.length > 1000) {
        history.shift();
      }
      this.telemetry.set(clean, history);

      // Save to disk
      const obj: Record<string, LocationPoint[]> = {};
      for (const [k, v] of this.telemetry.entries()) {
        obj[k] = v;
      }
      safeWriteJson(TELEMETRY_FILE, obj);
    }

    // Also update order's current coordinates
    this.updateOrderStatus(orderIdOrNumber, 'dispatched', {
      currentLat: point.lat,
      currentLng: point.lng,
      speed: point.speed,
      heading: point.heading,
      lastGpsUpdate: point.timestamp || new Date().toISOString()
    });

    return history;
  }

  // --- SESSIONS ---
  public getSession(chatId: number): DriverSessionRecord | undefined {
    return this.sessions.get(chatId);
  }

  public saveSession(session: DriverSessionRecord): void {
    this.sessions.set(session.chatId, session);
    safeWriteJson(SESSIONS_FILE, Array.from(this.sessions.values()));
  }

  public deleteSession(chatId: number): void {
    this.sessions.delete(chatId);
    safeWriteJson(SESSIONS_FILE, Array.from(this.sessions.values()));
  }

  public getAllSessions(): DriverSessionRecord[] {
    return Array.from(this.sessions.values());
  }
}

export const storageService = new StorageService();
