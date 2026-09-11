import fs from 'fs';
import path from 'path';
import { usesFirebase } from './tracking-context.js';

export interface LocationPoint {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp?: string;
}

export interface InvoiceItem {
  id: string;
  invoiceNumber: string;
  fileName?: string;
  fileData?: string;
  fileType?: string;
  fileSize?: string;
}

export interface DeliveryPoint {
  id: string;
  address: string;
  recipientPhone?: string;
  recipientName?: string;
  note?: string;
}

export interface RegionalOrderRecord {
  id: string;
  orderNumber: string;
  destinationCity: string;
  originCity?: string;
  deliveryAddress?: string;
  recipientPhone?: string;
  deliveryPoints?: DeliveryPoint[];
  invoiceNumber?: string;
  invoiceFileName?: string;
  invoiceFileData?: string;
  invoiceFileType?: string;
  invoices?: InvoiceItem[];
  shipmentDate?: string;
  truckType?: string;
  palletsCount?: string;
  weight?: string;
  cargoDescription?: string;
  managerName?: string;
  managerPhone?: string;
  comments?: string;
  status: 'new' | 'assigned' | 'loading' | 'dispatched' | 'delivered' | 'cancelled';
  assignedDriver?: string;
  assignedTruckPlate?: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  currentLat?: number;
  currentLng?: number;
  speed?: number;
  heading?: number;
  lastGpsUpdate?: string;
  driverConsent?: boolean;
  driverConsentAt?: string;
  hasRealGps?: boolean;
  isTrackingActive?: boolean;
  trackingSource?: 'telegram_live' | 'telegram_static' | 'web';
  trackingStartLocation?: LocationPoint;
  liveLocationExpiresAt?: string;
  trackingStoppedAt?: string;
  locationHistory?: Array<{ lat: number; lng: number; timestamp?: string }>;
  createdAt?: string;
  createdByEmail?: string;
  createdByName?: string;
  updatedAt?: string;
}

export interface ShipmentRecord {
  id: string;
  invoice_id: string;
  week?: string | number;
  shipment_type?: string;
  destination?: string;
  goods?: string;
  driver_name?: string;
  driver_phone?: string;
  plate_number?: string;
  truck_driver?: string;
  loading_date?: string;
  ex_border_date?: string;
  customs_arrival_date?: string;
  unl_date?: string;
  transit_time?: string | number;
  route: 'Tehran - Almaty' | 'Amol - Almaty';
  departure_date: string;
  est_travel_time: number;
  arrival_deadline: string;
  actual_arrival_date?: string;
  customs_date?: string;
  status: 'In Transit' | 'Customs' | 'Delivered' | 'Delay';
  status_message?: string;
  documents_url: string[];
  last_updated: string;
  createdBy: string;
  items: string[];
  isArchived?: boolean;
}

export interface ShipmentLogRecord {
  id: string;
  shipmentId: string;
  timestamp: string;
  location: string;
  message: string;
  updatedBy: string;
}

export interface SavedTruckRecord {
  id: string;
  plateNumber: string;
  model: string;
  status: 'Available' | 'On Route' | 'Maintenance';
}

export interface SavedDeliveryContactRecord {
  id: string;
  title: string;
  city: string;
  deliveryAddress: string;
  recipientPhone?: string;
  recipientName?: string;
  notes?: string;
}

export interface UserProfileRecord {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'logistics' | 'viewer' | 'regional_manager';
}

export interface DriverSessionRecord {
  chatId: number;
  orderId: string;
  orderNumber: string;
  driverName?: string;
  tripActive: boolean;
  driverConsent?: boolean;
  consentAt?: string;
  liveMessageId?: number;
  liveStartedAt?: number;
  liveExpiresAt?: string;
  lastLocationAt?: string;
  pinnedMessageId?: number;
  startedAt?: string;
  lastUpdated: string;
}

const DATA_DIR = path.join(process.cwd(), 'server', 'data');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

const FILES = {
  regionalOrders: path.join(DATA_DIR, 'regional_orders_cache.json'),
  regionalOrdersMain: path.join(DATA_DIR, 'regional_orders.json'),
  shipments: path.join(DATA_DIR, 'shipments.json'),
  shipmentLogs: path.join(DATA_DIR, 'shipment_logs.json'),
  trucks: path.join(DATA_DIR, 'saved_trucks.json'),
  contacts: path.join(DATA_DIR, 'delivery_contacts.json'),
  users: path.join(DATA_DIR, 'users.json'),
  telemetry: path.join(DATA_DIR, 'telemetry_history.json'),
  sessions: path.join(DATA_DIR, 'driver_sessions.json')
};

// Ensure directories exist
if (!usesFirebase()) [DATA_DIR, BACKUPS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
  if (usesFirebase()) return;
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
    try {
      fs.renameSync(tempFile, filePath);
    } catch {
      // If rename fails (e.g. Windows lock), copy and unlink
      fs.copyFileSync(tempFile, filePath);
      fs.unlinkSync(tempFile);
    }
  } catch (err) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (fallbackErr) {
      console.error(`[Storage] Failed to write ${path.basename(filePath)}:`, fallbackErr);
    }
  } finally {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }
}

class StorageService {
  private orders: Map<string, RegionalOrderRecord> = new Map();
  private shipments: Map<string, ShipmentRecord> = new Map();
  private shipmentLogs: Map<string, ShipmentLogRecord[]> = new Map();
  private trucks: Map<string, SavedTruckRecord> = new Map();
  private contacts: Map<string, SavedDeliveryContactRecord> = new Map();
  private users: Map<string, UserProfileRecord> = new Map();
  private telemetry: Map<string, LocationPoint[]> = new Map();
  private sessions: Map<number, DriverSessionRecord> = new Map();

  constructor() {
    if (!usesFirebase()) { this.loadAll(); this.seedDefaultsIfEmpty(); }
  }

  public replaceTrackingState(state: { orders: RegionalOrderRecord[]; sessions: DriverSessionRecord[]; telemetry: Record<string, LocationPoint[]> }) {
    this.orders.clear(); this.sessions.clear(); this.telemetry.clear();
    for (const order of state.orders) {
      this.orders.set(order.id, order);
      if (!usesFirebase() && order.orderNumber) this.orders.set(order.orderNumber.toUpperCase(), order);
    }
    state.sessions.forEach(session => this.sessions.set(session.chatId, session));
    Object.entries(state.telemetry).forEach(([id, history]) => this.telemetry.set(id.toUpperCase(), history));
  }

  public trackingState() {
    return { orders: this.getUniqueOrders(), sessions: this.getAllSessions(), telemetry: Object.fromEntries(this.telemetry) };
  }

  private loadAll() {
    // 1. Regional orders (support both files for seamless migration)
    const rawOrders = safeReadJson<RegionalOrderRecord[]>(
      fs.existsSync(FILES.regionalOrdersMain) ? FILES.regionalOrdersMain : FILES.regionalOrders,
      []
    );
    rawOrders.forEach(order => {
      if (order.id) this.orders.set(order.id, order);
      if (order.orderNumber) this.orders.set(order.orderNumber.toUpperCase(), order);
    });

    // 2. International Shipments
    const rawShipments = safeReadJson<ShipmentRecord[]>(FILES.shipments, []);
    rawShipments.forEach(s => {
      if (s.id) this.shipments.set(s.id, s);
    });

    // 3. Shipment Logs
    const rawLogs = safeReadJson<Record<string, ShipmentLogRecord[]>>(FILES.shipmentLogs, {});
    for (const [k, v] of Object.entries(rawLogs)) {
      if (Array.isArray(v)) this.shipmentLogs.set(k, v);
    }

    // 4. Saved Trucks
    const rawTrucks = safeReadJson<SavedTruckRecord[]>(FILES.trucks, []);
    rawTrucks.forEach(t => {
      if (t.id) this.trucks.set(t.id, t);
    });

    // 5. Delivery Contacts
    const rawContacts = safeReadJson<SavedDeliveryContactRecord[]>(FILES.contacts, []);
    rawContacts.forEach(c => {
      if (c.id) this.contacts.set(c.id, c);
    });

    // 6. Users
    const rawUsers = safeReadJson<UserProfileRecord[]>(FILES.users, []);
    rawUsers.forEach(u => {
      if (u.uid) this.users.set(u.uid, u);
      if (u.email) this.users.set(u.email.toLowerCase(), u);
    });

    // 7. Telemetry History
    const rawTelemetry = safeReadJson<Record<string, LocationPoint[]>>(FILES.telemetry, {});
    for (const [k, v] of Object.entries(rawTelemetry)) {
      if (Array.isArray(v)) this.telemetry.set(k.toUpperCase(), v);
    }

    // 8. Driver Sessions
    const rawSessions = safeReadJson<DriverSessionRecord[]>(FILES.sessions, []);
    rawSessions.forEach(s => {
      if (s.chatId) this.sessions.set(s.chatId, s);
    });

    console.log(
      `💾 [Local DB] Loaded: ` +
      `${this.getUniqueOrders().length} regional orders, ` +
      `${this.shipments.size} shipments, ` +
      `${this.trucks.size} trucks, ` +
      `${this.contacts.size} contacts, ` +
      `${this.users.size} users, ` +
      `${this.telemetry.size} telemetry trails.`
    );
  }

  private seedDefaultsIfEmpty() {
    // Default admin user
    if (this.users.size === 0) {
      const defaultAdmin: UserProfileRecord = {
        uid: 'admin_local',
        email: 'ti07kz@gmail.com',
        displayName: 'Главный Администратор',
        role: 'admin'
      };
      this.saveUser(defaultAdmin);
    }
  }

  // =========================================================================
  // 1. REGIONAL ORDERS
  // =========================================================================

  public getUniqueOrders(): RegionalOrderRecord[] {
    const seen = new Set<string>();
    const list: RegionalOrderRecord[] = [];
    for (const o of this.orders.values()) {
      const key = usesFirebase() ? o.id : (o.orderNumber || o.id).toUpperCase();
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
    if (usesFirebase()) return this.orders.get(orderIdOrNumber.trim()) ||
      Array.from(this.orders.values()).find(order => order.orderNumber?.toUpperCase() === clean);
    return this.orders.get(clean) || this.orders.get(orderIdOrNumber.trim());
  }

  public saveOrder(order: RegionalOrderRecord): RegionalOrderRecord {
    const id = order.id || `REG-${Date.now().toString().slice(-4)}`;
    const now = new Date().toISOString();
    const existing = usesFirebase() ? this.orders.get(id) :
      this.getOrder(id) || (order.orderNumber ? this.getOrder(order.orderNumber) : undefined);

    const record: RegionalOrderRecord = {
      ...existing,
      ...order,
      id,
      createdAt: existing?.createdAt || order.createdAt || now,
      updatedAt: now
    };

    this.orders.set(record.id, record);
    if (!usesFirebase() && record.orderNumber) {
      this.orders.set(record.orderNumber.toUpperCase(), record);
    }

    const unique = this.getUniqueOrders();
    safeWriteJson(FILES.regionalOrdersMain, unique);
    safeWriteJson(FILES.regionalOrders, unique);
    return record;
  }

  public saveOrders(orders: RegionalOrderRecord[]): void {
    orders.forEach(o => this.saveOrder(o));
  }

  public updateOrderStatus(
    orderIdOrNumber: string,
    status: RegionalOrderRecord['status'],
    extra?: Partial<RegionalOrderRecord>
  ): RegionalOrderRecord | undefined {
    const existing = this.getOrder(orderIdOrNumber);
    if (!existing) return undefined;

    const updated: RegionalOrderRecord = {
      ...existing,
      status,
      ...(extra || {}),
      ...(status === 'dispatched' && !existing.dispatchedAt ? { dispatchedAt: new Date().toISOString() } : {}),
      ...(status === 'delivered' ? { deliveredAt: new Date().toISOString(), speed: 0 } : {}),
      updatedAt: new Date().toISOString()
    };

    if (updated.id) this.orders.set(updated.id, updated);
    if (!usesFirebase() && updated.orderNumber) this.orders.set(updated.orderNumber.toUpperCase(), updated);

    const unique = this.getUniqueOrders();
    safeWriteJson(FILES.regionalOrdersMain, unique);
    safeWriteJson(FILES.regionalOrders, unique);
    return updated;
  }

  public deleteOrder(orderIdOrNumber: string): boolean {
    const existing = this.getOrder(orderIdOrNumber);
    if (!existing) return false;

    this.orders.delete(existing.id);
    if (!usesFirebase() && existing.orderNumber) this.orders.delete(existing.orderNumber.toUpperCase());

    const unique = this.getUniqueOrders();
    safeWriteJson(FILES.regionalOrdersMain, unique);
    safeWriteJson(FILES.regionalOrders, unique);
    return true;
  }

  // =========================================================================
  // 2. INTERNATIONAL SHIPMENTS
  // =========================================================================

  public getAllShipments(): ShipmentRecord[] {
    return Array.from(this.shipments.values()).sort((a, b) =>
      new Date(b.last_updated || 0).getTime() - new Date(a.last_updated || 0).getTime()
    );
  }

  public getShipment(id: string): ShipmentRecord | undefined {
    return this.shipments.get(id);
  }

  public saveShipment(shipment: ShipmentRecord): ShipmentRecord {
    const id = shipment.id || `SHIP-${Date.now().toString().slice(-5)}`;
    const now = new Date().toISOString();
    const existing = this.shipments.get(id);

    const record: ShipmentRecord = {
      ...existing,
      ...shipment,
      id,
      last_updated: now,
      documents_url: shipment.documents_url || existing?.documents_url || [],
      items: shipment.items || existing?.items || []
    };

    this.shipments.set(id, record);
    safeWriteJson(FILES.shipments, Array.from(this.shipments.values()));
    return record;
  }

  public deleteShipment(id: string): boolean {
    const existed = this.shipments.delete(id);
    if (existed) {
      safeWriteJson(FILES.shipments, Array.from(this.shipments.values()));
      this.shipmentLogs.delete(id);
      this.persistShipmentLogs();
    }
    return existed;
  }

  // =========================================================================
  // 3. SHIPMENT LOGS
  // =========================================================================

  public getShipmentLogs(shipmentId: string): ShipmentLogRecord[] {
    return (this.shipmentLogs.get(shipmentId) || []).sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  public addShipmentLog(log: Omit<ShipmentLogRecord, 'id'>): ShipmentLogRecord {
    const list = this.shipmentLogs.get(log.shipmentId) || [];
    const entry: ShipmentLogRecord = {
      ...log,
      id: `LOG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    };
    list.unshift(entry);
    this.shipmentLogs.set(log.shipmentId, list);
    this.persistShipmentLogs();
    return entry;
  }

  private persistShipmentLogs() {
    const obj: Record<string, ShipmentLogRecord[]> = {};
    for (const [k, v] of this.shipmentLogs.entries()) {
      obj[k] = v;
    }
    safeWriteJson(FILES.shipmentLogs, obj);
  }

  // =========================================================================
  // 4. SAVED TRUCKS
  // =========================================================================

  public getAllTrucks(): SavedTruckRecord[] {
    return Array.from(this.trucks.values());
  }

  public saveTruck(truck: SavedTruckRecord): SavedTruckRecord {
    const id = truck.id || `TRUCK-${Date.now().toString().slice(-4)}`;
    const record = { ...truck, id };
    this.trucks.set(id, record);
    safeWriteJson(FILES.trucks, Array.from(this.trucks.values()));
    return record;
  }

  public deleteTruck(id: string): boolean {
    const existed = this.trucks.delete(id);
    if (existed) safeWriteJson(FILES.trucks, Array.from(this.trucks.values()));
    return existed;
  }

  // =========================================================================
  // 5. DELIVERY CONTACTS
  // =========================================================================

  public getAllContacts(): SavedDeliveryContactRecord[] {
    return Array.from(this.contacts.values());
  }

  public saveContact(contact: SavedDeliveryContactRecord): SavedDeliveryContactRecord {
    const id = contact.id || `CONT-${Date.now().toString().slice(-4)}`;
    const record = { ...contact, id };
    this.contacts.set(id, record);
    safeWriteJson(FILES.contacts, Array.from(this.contacts.values()));
    return record;
  }

  public deleteContact(id: string): boolean {
    const existed = this.contacts.delete(id);
    if (existed) safeWriteJson(FILES.contacts, Array.from(this.contacts.values()));
    return existed;
  }

  // =========================================================================
  // 6. USERS & ROLES
  // =========================================================================

  public getAllUsers(): UserProfileRecord[] {
    const seen = new Set<string>();
    const list: UserProfileRecord[] = [];
    for (const u of this.users.values()) {
      if (!seen.has(u.uid)) {
        seen.add(u.uid);
        list.push(u);
      }
    }
    return list;
  }

  public getUser(uidOrEmail: string): UserProfileRecord | undefined {
    if (!uidOrEmail) return undefined;
    const clean = uidOrEmail.toLowerCase().trim();
    return this.users.get(uidOrEmail) || this.users.get(clean);
  }

  public saveUser(user: UserProfileRecord): UserProfileRecord {
    this.users.set(user.uid, user);
    if (user.email) this.users.set(user.email.toLowerCase(), user);
    safeWriteJson(FILES.users, this.getAllUsers());
    return user;
  }

  public deleteUser(uid: string): boolean {
    const existing = this.users.get(uid);
    if (!existing) return false;
    this.users.delete(uid);
    if (existing.email) this.users.delete(existing.email.toLowerCase());
    safeWriteJson(FILES.users, this.getAllUsers());
    return true;
  }

  // =========================================================================
  // 7. TELEMETRY & GPS HISTORY
  // =========================================================================

  public getTelemetry(orderIdOrNumber: string): LocationPoint[] {
    const clean = orderIdOrNumber.trim().toUpperCase();
    return this.telemetry.get(clean) || [];
  }

  public appendTelemetryPoint(orderIdOrNumber: string, point: LocationPoint): LocationPoint[] {
    const clean = orderIdOrNumber.trim().toUpperCase();
    const history = this.telemetry.get(clean) || [];

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

      const lastTime = lastPoint.timestamp ? new Date(lastPoint.timestamp).getTime() : 0;
      const nowTime = point.timestamp ? new Date(point.timestamp).getTime() : Date.now();
      if (distMeters < 15 && (nowTime - lastTime) < 300000) {
        shouldAppend = false;
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

      if (history.length > 1000) {
        history.shift();
      }
      this.telemetry.set(clean, history);

      const obj: Record<string, LocationPoint[]> = {};
      for (const [k, v] of this.telemetry.entries()) {
        obj[k] = v;
      }
      safeWriteJson(FILES.telemetry, obj);
    }

    return history;
  }

  // =========================================================================
  // 8. SESSIONS
  // =========================================================================

  public getSession(chatId: number): DriverSessionRecord | undefined {
    return this.sessions.get(chatId);
  }

  public saveSession(session: DriverSessionRecord): void {
    this.sessions.set(session.chatId, session);
    safeWriteJson(FILES.sessions, Array.from(this.sessions.values()));
  }

  public deleteSession(chatId: number): void {
    this.sessions.delete(chatId);
    safeWriteJson(FILES.sessions, Array.from(this.sessions.values()));
  }

  public getAllSessions(): DriverSessionRecord[] {
    return Array.from(this.sessions.values());
  }
}

export const storageService = new StorageService();
