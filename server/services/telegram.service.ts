import axios from "axios";
import fs from "fs";
import path from "path";
import { storageService, LocationPoint } from "./storage.service.js";
import { broadcastRealtimeEvent } from "../routes/realtime.routes.js";
import { emitTruckPositionUpdate, emitDeliveryEnded } from "./socket.service.js";
import { processIncomingTelemetry } from "./gps-engine.service.js";
import {
  processGpsTelemetryFrame,
  snapToHighway,
  calculateBearingTurf,
  calculateSpeedGeolib,
  calculateRouteProgressTurf,
  validateCoordinates
} from "./gps-tracking-framework.service.js";

export type { LocationPoint };

export interface DriverLocation {
  orderId: string;
  driverPhone?: string;
  lat: number;
  lng: number;
  speed?: number; // km/h
  heading?: number;
  updatedAt: string;
  history?: LocationPoint[];
  hasRealGps?: boolean;
  isTrackingActive?: boolean;
  driverConsent?: boolean;
}

export interface RouteProgress {
  orderId: string;
  orderNumber?: string;
  currentLat: number;
  currentLng: number;
  speed: number;
  heading?: number;
  originCity: string;
  destinationCity: string;
  totalDistanceKm: number;
  remainingDistanceKm: number;
  progressPercent: number;
  etaMinutes: number;
  etaFormatted: string;
  signalStatus: 'in_transit' | 'parked' | 'idle' | 'offline' | 'waiting' | 'delivered';
  signalStatusText: string;
  lastPingSecondsAgo?: number;
  updatedAt: string;
  routeWaypoints: Array<{ name: string; lat: number; lng: number; reached: boolean }>;
  detailedRoadPolyline: LocationPoint[];
  locationHistory: LocationPoint[];
  hasRealGps: boolean;
  isTrackingActive: boolean;
  driverConsent?: boolean;
}

// In-memory store for driver locations and active chat-order mappings
const driverLocationsMap = new Map<string, DriverLocation>();
const activeChatOrderMap = new Map<number, string>();
let lastGlobalLocation: DriverLocation | null = null;

// Telegram Bot Credentials
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8923191579:AAHboGVIDEFIG-KKOy42lieweakH9uHt58c";
export const TELEGRAM_BOT_USERNAME = "SilkRoadDriverBot";

import { KAZAKHSTAN_ROADS } from "../config/kazakhstanRoads.js";

// High-resolution Kazakhstan Highway Road Polylines (OSRM real asphalt road geometry)
export const DETAILED_HIGHWAYS: Record<string, LocationPoint[]> = KAZAKHSTAN_ROADS;

// Major Kazakhstan Highway Nodes
export const HIGHWAY_NODES: Record<string, { lat: number; lng: number; name: string }> = {
  almaty: { lat: 43.2389, lng: 76.8897, name: 'Алматы' },
  balkhash: { lat: 46.8481, lng: 74.9804, name: 'Балхаш' },
  karaganda: { lat: 49.8019, lng: 73.1021, name: 'Караганда' },
  astana: { lat: 51.1694, lng: 71.4491, name: 'Астана' },
  shymkent: { lat: 42.3417, lng: 69.5901, name: 'Шымкент' },
  taraz: { lat: 42.9000, lng: 71.3667, name: 'Тараз' },
};

// Haversine formula for distance between 2 coordinates in km
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

import { db, isFirebaseAdminConfigured, firebaseProjectId, firestoreDatabaseId } from "../config/firebase.js";

export interface PendingSyncItem {
  orderId: string;
  orderNumber?: string;
  updates: Record<string, any>;
  timestamp: string;
}

const pendingFirestoreSyncMap = new Map<string, PendingSyncItem>();
let cachedUserAuthToken: string | null = null;

export function setCachedUserToken(token: string) {
  if (token && token.trim().length > 10) {
    cachedUserAuthToken = token.trim();
  }
}

export function getPendingFirestoreUpdates(): PendingSyncItem[] {
  return Array.from(pendingFirestoreSyncMap.values());
}

export function acknowledgePendingSync(orderIds: string[]) {
  if (!Array.isArray(orderIds)) return;
  for (const id of orderIds) {
    pendingFirestoreSyncMap.delete(id);
    const clean = id.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
    pendingFirestoreSyncMap.delete(clean);
  }
}

// Multi-key alias mapping (orderId -> orderNumber and vice versa)
const orderAliasMap = new Map<string, string>();

export function linkOrderNumberToId(orderId: string, orderNumber: string) {
  if (!orderId || !orderNumber) return;
  const cleanId = orderId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const cleanNum = orderNumber.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  orderAliasMap.set(cleanId, cleanNum);
  orderAliasMap.set(cleanNum, cleanId);
  orderAliasMap.set(orderId, orderNumber);
  orderAliasMap.set(orderNumber, orderId);

  // Link in locations map if one already has data
  const locA = driverLocationsMap.get(orderId) || driverLocationsMap.get(cleanId);
  const locB = driverLocationsMap.get(orderNumber) || driverLocationsMap.get(cleanNum);
  const target = locA || locB;
  if (target) {
    driverLocationsMap.set(orderId, target);
    driverLocationsMap.set(cleanId, target);
    driverLocationsMap.set(orderNumber, target);
    driverLocationsMap.set(cleanNum, target);
  }
}

export interface RegionalOrderSummary {
  id: string;
  orderNumber: string;
  destinationCity: string;
  originCity?: string;
  status?: string;
  assignedDriver?: string;
  assignedTruckPlate?: string;
  dispatchedAt?: string;
  currentLat?: number;
  currentLng?: number;
  speed?: number;
  heading?: number;
  lastGpsUpdate?: string;
  driverConsent?: boolean;
  driverConsentAt?: string;
  cargoDescription?: string;
}

// Session and chat state maps
const chatSelectedOrder = new Map<number, RegionalOrderSummary>();
const chatTripActive = new Map<number, boolean>();
const chatDriverConsent = new Map<number, boolean>();
const chatLastMessageTime = new Map<number, number>();
const chatPinnedMsgMap = new Map<number, number>();

const ORDERS_CACHE_FILE = path.join(process.cwd(), "server", "data", "regional_orders_cache.json");
const SESSIONS_CACHE_FILE = path.join(process.cwd(), "server", "data", "driver_sessions.json");
const LOCATIONS_CACHE_FILE = path.join(process.cwd(), "server", "data", "driver_locations.json");

let activeOrdersList: RegionalOrderSummary[] = [];

function loadOrdersFromCache(): RegionalOrderSummary[] {
  try {
    if (fs.existsSync(ORDERS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ORDERS_CACHE_FILE, 'utf8'));
      if (Array.isArray(data)) {
        // Filter out any lingering fake test orders
        return data.filter(o => !['REG-1002', 'REG-1003', 'REG-1004', 'REG-1005', 'REG-1006'].includes(o.orderNumber));
      }
    }
  } catch (e) {
    console.warn("Could not load orders cache:", e);
  }
  return [];
}

function loadLocationsFromCache() {
  try {
    if (fs.existsSync(LOCATIONS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(LOCATIONS_CACHE_FILE, 'utf8'));
      if (typeof data === 'object' && data !== null) {
        for (const [k, v] of Object.entries(data)) {
          const loc = v as DriverLocation;
          driverLocationsMap.set(k, loc);
          const clean = k.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
          driverLocationsMap.set(clean, loc);
        }
      }
    }
  } catch (e) {
    console.warn("Could not load driver locations cache:", e);
  }
}

function saveLocationsToCache() {
  try {
    const obj: Record<string, DriverLocation> = {};
    for (const [k, v] of driverLocationsMap.entries()) {
      if (k && k.length > 2) {
        obj[k] = v;
      }
    }
    fs.writeFileSync(LOCATIONS_CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {}
}

function loadSessionsFromCache() {
  try {
    if (fs.existsSync(SESSIONS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_CACHE_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const s of data) {
          if (s.chatId && s.orderNumber) {
            const matched = activeOrdersList.find(o => 
              o.orderNumber.toUpperCase() === s.orderNumber.toUpperCase() ||
              o.id === s.orderId
            );
            if (matched) {
              chatSelectedOrder.set(s.chatId, matched);
            }
            activeChatOrderMap.set(s.chatId, s.orderNumber);
            chatTripActive.set(s.chatId, !!s.tripActive);
            if (s.driverConsent) {
              chatDriverConsent.set(s.chatId, true);
            }
            if (s.pinnedMessageId) {
              chatPinnedMsgMap.set(s.chatId, s.pinnedMessageId);
            }
            if (s.orderId && s.orderNumber) {
              linkOrderNumberToId(s.orderId, s.orderNumber);
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("Could not load driver sessions cache:", e);
  }
}

function saveSessionsToCache() {
  try {
    const list: Array<{
      chatId: number;
      orderId: string;
      orderNumber: string;
      tripActive: boolean;
      driverConsent?: boolean;
      pinnedMessageId?: number;
      lastUpdated: string;
    }> = [];
    for (const [chatId, orderNum] of activeChatOrderMap.entries()) {
      const selected = chatSelectedOrder.get(chatId);
      list.push({
        chatId,
        orderId: selected?.id || orderNum,
        orderNumber: orderNum,
        tripActive: !!chatTripActive.get(chatId),
        driverConsent: !!chatDriverConsent.get(chatId),
        pinnedMessageId: chatPinnedMsgMap.get(chatId),
        lastUpdated: new Date().toISOString()
      });
    }
    fs.writeFileSync(SESSIONS_CACHE_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {}
}

activeOrdersList = loadOrdersFromCache();
activeOrdersList.forEach(o => {
  linkOrderNumberToId(o.id, o.orderNumber);
  if (o.currentLat && o.currentLng && o.status === 'dispatched') {
    const loc: DriverLocation = {
      orderId: o.id,
      lat: o.currentLat,
      lng: o.currentLng,
      speed: o.speed ?? 68,
      updatedAt: o.dispatchedAt || new Date().toISOString(),
      history: [
        { lat: HIGHWAY_NODES.almaty.lat, lng: HIGHWAY_NODES.almaty.lng, timestamp: o.dispatchedAt || new Date().toISOString() },
        { lat: o.currentLat, lng: o.currentLng, timestamp: new Date().toISOString() }
      ]
    };
    driverLocationsMap.set(o.id, loc);
    driverLocationsMap.set(o.orderNumber, loc);
  }
});

loadLocationsFromCache();
loadSessionsFromCache();

export function syncActiveOrders(orders: RegionalOrderSummary[]) {
  if (!Array.isArray(orders) || orders.length === 0) return;
  
  const currentMap = new Map<string, RegionalOrderSummary>();
  activeOrdersList.forEach(o => currentMap.set(o.orderNumber.toUpperCase(), o));
  
  // Rebuild active list purely from real CRM orders
  const updatedList: RegionalOrderSummary[] = [];
  
  orders.forEach(o => {
    // Ignore legacy mock orders if any
    if (['REG-1002', 'REG-1003', 'REG-1004', 'REG-1005', 'REG-1006'].includes(o.orderNumber)) return;
    
    const key = (o.orderNumber || o.id).toUpperCase();
    const existing = currentMap.get(key);
    
    const merged: RegionalOrderSummary = {
      ...o,
      // If driver already dispatched in-flight, keep dispatched status and GPS
      status: existing?.status === 'dispatched' ? 'dispatched' : o.status,
      assignedDriver: o.assignedDriver || existing?.assignedDriver,
      currentLat: existing?.currentLat ?? o.currentLat,
      currentLng: existing?.currentLng ?? o.currentLng,
      speed: existing?.speed ?? o.speed,
      dispatchedAt: existing?.dispatchedAt || o.dispatchedAt
    };
    
    updatedList.push(merged);
    linkOrderNumberToId(o.id, o.orderNumber);
  });

  activeOrdersList = updatedList;

  // Persist to local storageService
  storageService.saveOrders(activeOrdersList.map(o => ({
    id: o.id,
    orderNumber: o.orderNumber,
    destinationCity: o.destinationCity,
    originCity: o.originCity || 'Алматы',
    status: (o.status as any) || 'new',
    assignedDriver: o.assignedDriver,
    assignedTruckPlate: o.assignedTruckPlate,
    dispatchedAt: o.dispatchedAt,
    currentLat: o.currentLat,
    currentLng: o.currentLng,
    speed: o.speed
  })));

  try {
    fs.writeFileSync(ORDERS_CACHE_FILE, JSON.stringify(activeOrdersList, null, 2), 'utf8');
  } catch (e) {}
}

export function getActiveOrdersList(): RegionalOrderSummary[] {
  return activeOrdersList;
}

// Return ONLY genuine unassigned orders from CRM (or orders assigned to this specific driver)
export function getAvailableOrdersForDriver(driverIdentifier?: string, chatId?: number): RegionalOrderSummary[] {
  // Always synchronize directly with local storageService so orders added/updated in CRM appear instantly!
  const storedList = storageService.getUniqueOrders();

  activeOrdersList = storedList.map(o => {
    linkOrderNumberToId(o.id, o.orderNumber);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      destinationCity: o.destinationCity,
      originCity: o.originCity || 'Алматы',
      status: o.status,
      assignedDriver: o.assignedDriver,
      assignedTruckPlate: o.assignedTruckPlate,
      dispatchedAt: o.dispatchedAt,
      currentLat: o.currentLat,
      currentLng: o.currentLng,
      speed: o.speed
    };
  });

  const cleanDriverId = driverIdentifier ? driverIdentifier.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '') : '';
  const currentChatOrderNum = chatId ? activeChatOrderMap.get(chatId) : undefined;

  return activeOrdersList.filter(o => {
    // Exclude delivered, cancelled
    const st = (o.status || '').toLowerCase();
    if (st === 'delivered' || st === 'cancelled' || st === 'доставлено' || st === 'отменено') {
      return false;
    }

    // If this order is the one currently selected by THIS chat, always keep it available
    if (currentChatOrderNum && (o.orderNumber.toUpperCase() === currentChatOrderNum.toUpperCase() || o.id === currentChatOrderNum)) {
      return true;
    }

    // If another driver has already taken this order in an active Telegram session, hide it from other drivers
    for (const [otherChatId, otherOrderNum] of activeChatOrderMap.entries()) {
      if (chatId && otherChatId === chatId) continue;
      if (otherOrderNum && (otherOrderNum.toUpperCase() === o.orderNumber.toUpperCase() || otherOrderNum === o.id)) {
        if (chatTripActive.get(otherChatId)) {
          return false;
        }
      }
    }

    const assigned = (o.assignedDriver || '').trim();
    const cleanAssigned = assigned.toLowerCase().replace(/[^a-z0-9а-яё]/gi, '');

    // If order has an assigned driver
    if (assigned.length > 0) {
      if (cleanDriverId && cleanAssigned) {
        // If it matches this driver's name, phone, or username -> show it to them!
        if (cleanAssigned.includes(cleanDriverId) || cleanDriverId.includes(cleanAssigned)) {
          return true;
        }
      }

      // Orders in 'new' or 'loading' or 'assigned' are shown to drivers so they can accept and start the trip
      if (st === 'new' || st === 'loading' || st === 'assigned' || st === 'новый' || st === 'на погрузке' || st === 'назначена фура') {
        return true;
      }

      // If already dispatched by someone else, hide
      if (st === 'dispatched' || st === 'в пути') {
        return false;
      }
    }

    // Unassigned orders in 'new', 'loading', 'assigned' are available for drivers to take
    return true;
  });
}

export function updateCachedOrderStatus(orderNumberOrId: string, status: string, extra?: Partial<RegionalOrderSummary>) {
  const clean = orderNumberOrId.toLowerCase();
  let found = false;

  activeOrdersList = activeOrdersList.map(o => {
    if (o.id.toLowerCase() === clean || o.orderNumber.toLowerCase() === clean) {
      found = true;
      return { ...o, status, ...(extra || {}) };
    }
    return o;
  });

  // If order was newly created, add it immediately to activeOrdersList
  if (!found) {
    activeOrdersList.unshift({
      id: extra?.id || orderNumberOrId,
      orderNumber: extra?.orderNumber || orderNumberOrId,
      destinationCity: extra?.destinationCity || 'Астана',
      originCity: extra?.originCity || 'Алматы',
      status,
      assignedDriver: extra?.assignedDriver,
      assignedTruckPlate: extra?.assignedTruckPlate,
      dispatchedAt: extra?.dispatchedAt,
      currentLat: extra?.currentLat,
      currentLng: extra?.currentLng,
      speed: extra?.speed
    });
    linkOrderNumberToId(extra?.id || orderNumberOrId, extra?.orderNumber || orderNumberOrId);
  }

  storageService.updateOrderStatus(orderNumberOrId, status as any, extra as any);

  try {
    fs.writeFileSync(ORDERS_CACHE_FILE, JSON.stringify(activeOrdersList, null, 2), 'utf8');
  } catch (e) {}

  broadcastRealtimeEvent('order_updated', {
    orderNumberOrId,
    status,
    ...(extra || {})
  });
}


// Sync location or status updates directly to Cloud Firestore or queue for authenticated client sync
export async function syncOrderToFirestore(orderIdOrNumber: string, updates: Record<string, any>) {
  try {
    if (!orderIdOrNumber || orderIdOrNumber === 'all') return;
    
    const trimmed = orderIdOrNumber.trim();
    const cleanUpper = trimmed.toUpperCase();
    const queueKey = trimmed.toLowerCase();

    // 1. Queue update so authenticated browser CRM client can commit it to Firestore
    pendingFirestoreSyncMap.set(queueKey, {
      orderId: trimmed,
      updates: {
        ...updates,
        updatedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

    // 2. If Firebase Admin is initialized with credentials, use Admin SDK
    if (isFirebaseAdminConfigured) {
      try {
        const docRef = db.collection('regional_orders').doc(trimmed);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          await docRef.update({
            ...updates,
            updatedAt: new Date().toISOString()
          });
          pendingFirestoreSyncMap.delete(queueKey);
          console.log(`🔥 [Firestore Admin] Updated regional_orders/${trimmed}`);
          return;
        }

        const q1 = await db.collection('regional_orders')
          .where('orderNumber', '==', cleanUpper)
          .limit(1)
          .get();
        if (!q1.empty) {
          await q1.docs[0].ref.update({
            ...updates,
            updatedAt: new Date().toISOString()
          });
          pendingFirestoreSyncMap.delete(queueKey);
          console.log(`🔥 [Firestore Admin] Updated regional_orders matching orderNumber=${cleanUpper}`);
          return;
        }
      } catch (err: any) {
        console.warn(`⚠️ [Firestore Admin Notice]`, err.message);
      }
    }

    // 3. If client passed JWT token, use direct Firestore REST API
    if (cachedUserAuthToken) {
      try {
        let targetDocId = trimmed;
        const matched = activeOrdersList.find(o => 
          o.id.toLowerCase() === trimmed.toLowerCase() || 
          o.orderNumber.toLowerCase() === trimmed.toLowerCase()
        );
        if (matched?.id) {
          targetDocId = matched.id;
        }

        const fields: Record<string, any> = {};
        const updateMaskFields: string[] = [];

        for (const [key, val] of Object.entries(updates)) {
          if (val === undefined) continue;
          updateMaskFields.push(key);
          if (typeof val === 'number') {
            fields[key] = Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
          } else if (typeof val === 'string') {
            fields[key] = { stringValue: val };
          } else if (typeof val === 'boolean') {
            fields[key] = { booleanValue: val };
          } else if (Array.isArray(val)) {
            fields[key] = {
              arrayValue: {
                values: val.map(item => ({
                  mapValue: {
                    fields: {
                      lat: { doubleValue: item.lat || 0 },
                      lng: { doubleValue: item.lng || 0 },
                      ...(item.timestamp ? { timestamp: { stringValue: item.timestamp } } : {})
                    }
                  }
                }))
              }
            };
          }
        }

        updateMaskFields.push('updatedAt');
        fields.updatedAt = { stringValue: new Date().toISOString() };

        const maskQuery = updateMaskFields.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
        const restUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/${firestoreDatabaseId}/documents/regional_orders/${targetDocId}?${maskQuery}`;

        const res = await fetch(restUrl, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${cachedUserAuthToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fields })
        });

        if (res.ok) {
          pendingFirestoreSyncMap.delete(queueKey);
          console.log(`🔥 [Firestore REST] Synced regional_orders/${targetDocId}`);
          return;
        } else if (res.status === 401) {
          cachedUserAuthToken = null;
        }
      } catch (err: any) {
        // Fallback to queue
      }
    }

    console.log(`📦 [GPS Stored] Order ${trimmed} saved in server cache & queued for CRM client Firestore commit`);
  } catch (err: any) {
    console.warn(`⚠️ [Firestore Sync Error] ${err.message}`);
  }
}

export function updateDriverLocation(location: DriverLocation, status?: string): DriverLocation {
  const cleanId = location.orderId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const alias = orderAliasMap.get(cleanId) || orderAliasMap.get(location.orderId);
  const now = new Date();

  // Speed is REAL GPS speed (0 if standing still, or reported speed)
  const actualSpeed = location.speed !== undefined && location.speed !== null && !isNaN(location.speed)
    ? Math.max(0, Math.round(location.speed))
    : 0;

  // Append point to local storage service (both under orderId and alias)
  const realHistory = storageService.appendTelemetryPoint(location.orderId, {
    lat: location.lat,
    lng: location.lng,
    speed: actualSpeed,
    heading: location.heading,
    timestamp: location.updatedAt || now.toISOString()
  });

  if (alias && alias !== location.orderId) {
    storageService.appendTelemetryPoint(alias, {
      lat: location.lat,
      lng: location.lng,
      speed: actualSpeed,
      heading: location.heading,
      timestamp: location.updatedAt || now.toISOString()
    });
  }

  const updated: DriverLocation = {
    ...location,
    speed: actualSpeed,
    updatedAt: location.updatedAt || now.toISOString(),
    history: realHistory,
    hasRealGps: true,
    isTrackingActive: location.isTrackingActive !== false,
    driverConsent: true
  };

  driverLocationsMap.set(location.orderId, updated);
  driverLocationsMap.set(cleanId, updated);
  if (alias) {
    driverLocationsMap.set(alias, updated);
    driverLocationsMap.set(alias.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase(), updated);
  }

  lastGlobalLocation = updated;
  saveLocationsToCache();

  // Update order in local activeOrdersList and storage
  const targetStatus = status || 'dispatched';
  updateCachedOrderStatus(location.orderId, targetStatus, {
    currentLat: location.lat,
    currentLng: location.lng,
    speed: actualSpeed,
    heading: location.heading || 0,
    lastGpsUpdate: updated.updatedAt,
    driverConsent: true
  });
  if (alias) {
    updateCachedOrderStatus(alias, targetStatus, {
      currentLat: location.lat,
      currentLng: location.lng,
      speed: actualSpeed,
      heading: location.heading || 0,
      lastGpsUpdate: updated.updatedAt,
      driverConsent: true
    });
  }

  // Sync to Cloud Firestore in background (or queue for client commit)
  syncOrderToFirestore(location.orderId, {
    currentLat: location.lat,
    currentLng: location.lng,
    speed: actualSpeed,
    heading: location.heading || 0,
    lastGpsUpdate: updated.updatedAt,
    ...(status ? { status } : {})
  });

  console.log(`📍 [Real GPS Stored] Order: ${location.orderId} | Lat: ${location.lat.toFixed(5)}, Lng: ${location.lng.toFixed(5)} | Speed: ${actualSpeed} km/h | History: ${realHistory.length} pts`);

  broadcastRealtimeEvent('telemetry_update', {
    orderId: location.orderId,
    lat: location.lat,
    lng: location.lng,
    speed: actualSpeed,
    heading: location.heading || 0,
    status: targetStatus,
    updatedAt: updated.updatedAt
  });

  const storedOrderForSocket = storageService.getOrder(location.orderId) || (alias ? storageService.getOrder(alias) : undefined);
  emitTruckPositionUpdate({
    orderId: location.orderId,
    truckNumber: storedOrderForSocket?.assignedTruckPlate || alias || location.orderId,
    lat: location.lat,
    lng: location.lng,
    speed: actualSpeed,
    heading: location.heading || 0,
    status: targetStatus,
    driverPhone: location.driverPhone,
    assignedDriver: storedOrderForSocket?.assignedDriver,
    updatedAt: updated.updatedAt,
    hasRealGps: true,
    isTrackingActive: location.isTrackingActive !== false,
    driverConsent: true
  });

  return updated;
}

export function getDriverLocation(
  orderId: string, 
  destinationCity: string = 'Астана',
  orderNumber?: string,
  orderStatus?: string,
  dispatchedAt?: string
): RouteProgress {
  const cleanId = orderId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const cleanOrderNum = orderNumber ? orderNumber.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase() : '';
  
  if (orderNumber) {
    linkOrderNumberToId(orderId, orderNumber);
  }

  // Lookup saved location from storageService or driverLocationsMap
  let saved = driverLocationsMap.get(orderId) 
    || driverLocationsMap.get(cleanId)
    || (cleanOrderNum ? driverLocationsMap.get(cleanOrderNum) : null)
    || (orderNumber ? driverLocationsMap.get(orderNumber) : null);

  const alias = orderAliasMap.get(cleanId) || (cleanOrderNum ? orderAliasMap.get(cleanOrderNum) : null);
  if (!saved && alias) {
    saved = driverLocationsMap.get(alias);
  }

  // Also check storageService for order details
  const storedOrder = storageService.getOrder(orderId) 
    || (orderNumber ? storageService.getOrder(orderNumber) : undefined);

  if (!saved && storedOrder?.currentLat && storedOrder?.currentLng) {
    saved = {
      orderId: storedOrder.id,
      driverPhone: storedOrder.assignedDriver || '',
      lat: storedOrder.currentLat,
      lng: storedOrder.currentLng,
      speed: storedOrder.speed ?? 0,
      heading: storedOrder.heading ?? 0,
      updatedAt: storedOrder.lastGpsUpdate || storedOrder.dispatchedAt || new Date().toISOString(),
      history: storageService.getTelemetry(storedOrder.id)
    };
  }

  // Real telemetry history recorded directly from device
  const locationHistory: LocationPoint[] = storageService.getTelemetry(orderId);
  if (locationHistory.length === 0 && orderNumber) {
    const numHistory = storageService.getTelemetry(orderNumber);
    if (numHistory.length > 0) {
      locationHistory.push(...numHistory);
    }
  }
  if (locationHistory.length === 0 && saved?.lat && saved?.lng) {
    locationHistory.push({
      lat: saved.lat,
      lng: saved.lng,
      speed: saved.speed ?? 0,
      timestamp: saved.updatedAt
    });
  }

  const origin = HIGHWAY_NODES.almaty;
  const effectiveDestCity = destinationCity || storedOrder?.destinationCity || 'Астана';
  
  // Resolve destination coordinates
  const destKey = Object.keys(HIGHWAY_NODES).find(k => 
    effectiveDestCity.toLowerCase().includes(k) || HIGHWAY_NODES[k].name.toLowerCase() === effectiveDestCity.toLowerCase()
  ) || 'astana';
  
  const destNode = HIGHWAY_NODES[destKey] || HIGHWAY_NODES.astana;
  const detailedRoadPolyline = DETAILED_HIGHWAYS[destKey] || DETAILED_HIGHWAYS.astana;

  // Build key route waypoints based on destination
  let waypoints = [
    { name: 'Алматы (Склад)', lat: origin.lat, lng: origin.lng, reached: true },
    { name: 'Балхаш', lat: HIGHWAY_NODES.balkhash.lat, lng: HIGHWAY_NODES.balkhash.lng, reached: false },
    { name: 'Караганда', lat: HIGHWAY_NODES.karaganda.lat, lng: HIGHWAY_NODES.karaganda.lng, reached: false },
    { name: destNode.name, lat: destNode.lat, lng: destNode.lng, reached: false }
  ];

  if (destKey === 'shymkent' || destKey === 'taraz') {
    waypoints = [
      { name: 'Алматы (Склад)', lat: origin.lat, lng: origin.lng, reached: true },
      { name: 'Тараз', lat: HIGHWAY_NODES.taraz.lat, lng: HIGHWAY_NODES.taraz.lng, reached: false },
      { name: 'Шымкент', lat: HIGHWAY_NODES.shymkent.lat, lng: HIGHWAY_NODES.shymkent.lng, reached: false }
    ];
  }

  // Status-aware position determination - 100% REAL, NO DEAD RECKONING
  const effectiveStatus = (orderStatus || storedOrder?.status || '').toLowerCase();
  const isDelivered = effectiveStatus === 'delivered' || effectiveStatus === 'доставлено';
  const isPending = effectiveStatus === 'new' || effectiveStatus === 'loading' || effectiveStatus === 'новый' || effectiveStatus === 'на погрузке';
  const driverConsent = Boolean(
    storedOrder?.driverConsent || 
    (saved && saved.driverConsent) ||
    effectiveStatus === 'assigned' ||
    effectiveStatus === 'назначена фура'
  );

  // Real GPS is ONLY true if saved coordinates were explicitly reported by device and tracking is active
  const hasRealGps = Boolean(
    !isDelivered && 
    saved && 
    saved.hasRealGps && 
    saved.isTrackingActive !== false && 
    saved.lat && 
    saved.lng
  );
  const isTrackingActive = Boolean(hasRealGps && saved?.isTrackingActive !== false);

  let currentLat = origin.lat;
  let currentLng = origin.lng;
  let speed = 0;
  let heading = 0;
  let signalStatus: 'in_transit' | 'parked' | 'idle' | 'offline' | 'waiting' | 'delivered' = 'waiting';
  let signalStatusText = 'Ожидание выезда';
  let lastPingSecondsAgo: number | undefined = undefined;

  if (isDelivered) {
    currentLat = destNode.lat;
    currentLng = destNode.lng;
    speed = 0;
    heading = 0;
    signalStatus = 'delivered';
    signalStatusText = 'Груз доставлен';
  } else if (hasRealGps && saved) {
    currentLat = saved.lat;
    currentLng = saved.lng;
    speed = saved.speed ?? 0;
    heading = saved.heading ?? 0;

    const lastTime = saved.updatedAt ? new Date(saved.updatedAt).getTime() : Date.now();
    const elapsedMs = Math.max(0, Date.now() - lastTime);
    lastPingSecondsAgo = Math.round(elapsedMs / 1000);

    if (lastPingSecondsAgo <= 120) {
      if (speed > 5) {
        signalStatus = 'in_transit';
        signalStatusText = `🟢 В движении (${speed} км/ч)`;
      } else {
        signalStatus = 'parked';
        signalStatusText = `🟢 На связи (Стоянка)`;
      }
    } else if (lastPingSecondsAgo <= 600) {
      signalStatus = 'idle';
      const mins = Math.max(1, Math.round(lastPingSecondsAgo / 60));
      signalStatusText = `🟡 Стоянка / Остановка (${mins} мин)`;
    } else {
      signalStatus = 'offline';
      const mins = Math.round(lastPingSecondsAgo / 60);
      signalStatusText = `🔴 Нет сигнала (${mins} мин. назад)`;
    }
  } else if (driverConsent) {
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
    signalStatus = 'waiting';
    signalStatusText = 'Водитель согласился (ожидание Live GPS)';
  } else if (isPending) {
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
    signalStatus = 'waiting';
    signalStatusText = 'На погрузке / Ожидает выезда';
  } else {
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
    signalStatus = 'waiting';
    signalStatusText = 'Ожидание запуска GPS-трансляции';
  }

  // Progress and ETA via Turf.js framework
  let totalDistance = calculateDistanceKm(origin.lat, origin.lng, destNode.lat, destNode.lng);
  let remainingDistance = isDelivered ? 0 : totalDistance;
  let progressPercent = isDelivered ? 100 : 0;
  let etaTotalMinutes = isDelivered ? 0 : Math.round((totalDistance / 70) * 60);

  if (hasRealGps && isTrackingActive) {
    const turfProgress = calculateRouteProgressTurf(
      origin,
      destNode,
      { lat: currentLat, lng: currentLng },
      detailedRoadPolyline
    );
    totalDistance = turfProgress.totalDistanceKm;
    remainingDistance = turfProgress.remainingDistanceKm;
    progressPercent = turfProgress.progressPercent;
    etaTotalMinutes = turfProgress.etaMinutes;
  }

  // Mark reached waypoints
  waypoints = waypoints.map((wp) => {
    if (isDelivered) return { ...wp, reached: true };
    if (!hasRealGps) return { ...wp, reached: wp.lat === origin.lat && wp.lng === origin.lng };
    const distToWp = calculateDistanceKm(currentLat, currentLng, wp.lat, wp.lng);
    const distOriginToWp = calculateDistanceKm(origin.lat, origin.lng, wp.lat, wp.lng);
    const distOriginToCurrent = calculateDistanceKm(origin.lat, origin.lng, currentLat, currentLng);
    const reached = distOriginToCurrent >= distOriginToWp || distToWp < 30;
    return { ...wp, reached };
  });

  const hours = Math.floor(etaTotalMinutes / 60);
  const mins = etaTotalMinutes % 60;
  const etaFormatted = isDelivered 
    ? "Груз доставлен" 
    : !hasRealGps
      ? "Ожидает отправки" 
      : speed >= 30
        ? (hours > 0 ? `~${hours} ч ${mins} мин` : `~${mins} мин`)
        : (hours > 0 ? `~${hours} ч ${mins} мин (при 70 км/ч)` : `~${mins} мин`);

  return {
    orderId,
    orderNumber: orderNumber || storedOrder?.orderNumber,
    currentLat,
    currentLng,
    speed: isDelivered || !hasRealGps ? 0 : speed,
    heading: hasRealGps ? heading : 0,
    originCity: 'Алматы',
    destinationCity: destNode.name,
    totalDistanceKm: totalDistance,
    remainingDistanceKm: remainingDistance,
    progressPercent,
    etaMinutes: isDelivered || !hasRealGps ? 0 : etaTotalMinutes,
    etaFormatted,
    signalStatus,
    signalStatusText,
    lastPingSecondsAgo,
    updatedAt: saved ? saved.updatedAt : new Date().toISOString(),
    routeWaypoints: waypoints,
    detailedRoadPolyline,
    locationHistory,
    hasRealGps,
    isTrackingActive,
    driverConsent
  };
}


// Send message via Telegram Bot API
async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: any): Promise<any> {
  try {
    const res = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });
    return res.data?.result;
  } catch (error: any) {
    console.error("Error sending Telegram message:", error?.response?.data || error.message);
    return null;
  }
}

// Pin message in chat (e.g. for active trip tracking with finish button)
async function pinTelegramChatMessage(chatId: number, messageId: number) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/pinChatMessage`, {
      chat_id: chatId,
      message_id: messageId,
      disable_notification: true
    });
  } catch (e: any) {
    console.warn("Could not pin telegram message:", e?.response?.data?.description || e.message);
  }
}

// Unpin message in chat
async function unpinTelegramChatMessage(chatId: number, messageId?: number) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/unpinChatMessage`, {
      chat_id: chatId,
      ...(messageId ? { message_id: messageId } : {})
    });
  } catch (e) {}
}

// Answer callback query from inline buttons
async function answerCallbackQuery(callbackQueryId: string, text?: string) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text: text || ''
    });
  } catch (error: any) {
    // Ignore callback query ack errors
  }
}

// Edit existing message text and markup (for smooth inline updates)
async function editTelegramMessageText(chatId: number, messageId: number, text: string, replyMarkup?: any) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });
  } catch (error: any) {
    const desc = error?.response?.data?.description || error.message || '';
    if (!desc.includes('message is not modified')) {
      console.warn("Could not edit telegram message:", desc);
    }
  }
}

function canSendAntiSpam(chatId: number, minIntervalMs: number = 60000): boolean {
  const last = chatLastMessageTime.get(chatId) || 0;
  return Date.now() - last > minIntervalMs;
}

// Build dynamic INLINE keyboard with clickable trip buttons
function buildOrderSelectionInlineKeyboard(orders: RegionalOrderSummary[]) {
  const inline_keyboard: Array<Array<{ text: string; callback_data: string }>> = [];
  
  if (!orders || orders.length === 0) {
    inline_keyboard.push([
      { text: "🔄 Проверить новые заявки", callback_data: "refresh_orders" }
    ]);
    return { inline_keyboard };
  }

  const slice = orders.slice(0, 10);
  for (const o of slice) {
    const origin = o.originCity || 'Алматы';
    inline_keyboard.push([
      {
        text: `🚛 ${o.orderNumber}: ${origin} ➔ ${o.destinationCity}`,
        callback_data: `sel_order:${o.orderNumber}`
      }
    ]);
  }
  
  inline_keyboard.push([
    { text: "🔄 Обновить список заявок", callback_data: "refresh_orders" }
  ]);
  
  return { inline_keyboard };
}

// Build dynamic reply keyboard with available new / active trips (fallback)
function buildOrderSelectionKeyboard(orders: RegionalOrderSummary[]) {
  const keyboard: Array<Array<{ text: string }>> = [];
  
  // Show available orders (up to 6 orders)
  const slice = orders.slice(0, 6);
  for (let i = 0; i < slice.length; i += 2) {
    const row = [];
    row.push({ text: `🚛 ${slice[i].orderNumber} (${slice[i].destinationCity})` });
    if (slice[i + 1]) {
      row.push({ text: `🚛 ${slice[i + 1].orderNumber} (${slice[i + 1].destinationCity})` });
    }
    keyboard.push(row);
  }
  
  keyboard.push([{ text: "🔄 Обновить список заявок" }]);
  
  return {
    keyboard,
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function buildActiveTripInlineKeyboard(orderNumber: string) {
  return {
    inline_keyboard: [
      [
        {
          text: "🛑 Завершить рейс",
          callback_data: `finish_trip:${orderNumber}`
        }
      ]
    ]
  };
}

function buildSelectedOrderKeyboard(order: RegionalOrderSummary) {
  return {
    keyboard: [
      [{ text: "🛑 Завершить рейс" }],
      [{ text: "🔄 Сменить рейс" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function buildInTransitKeyboard(order: RegionalOrderSummary) {
  return {
    keyboard: [
      [{ text: "🛑 Завершить рейс" }],
      [{ text: "🔄 Сменить рейс" }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };
}

function findMatchingOrder(text: string, orders: RegionalOrderSummary[]): RegionalOrderSummary | null {
  const lower = text.toLowerCase().trim();
  
  // Match by exact orderNumber (e.g. REG-1002 or 1002)
  for (const o of orders) {
    const cleanNum = o.orderNumber.toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanText = lower.replace(/[^a-z0-9]/g, '');
    if (cleanNum && cleanText.includes(cleanNum)) return o;
    if (o.orderNumber.toLowerCase() === lower) return o;
    if (o.id.toLowerCase() === lower) return o;
  }
  
  // Match by destination city name (e.g. "Астана", "Шымкент", "Караганда")
  for (const o of orders) {
    if (o.destinationCity && lower.includes(o.destinationCity.toLowerCase())) {
      return o;
    }
  }
  
  return null;
}

// Real-time Telegram Bot Polling Loop
let lastUpdateId = 0;
let isPollingStarted = false;

export function startTelegramBotPolling() {
  if (isPollingStarted) return;
  isPollingStarted = true;

  console.log(`🤖 [Telegram Bot] @${TELEGRAM_BOT_USERNAME} polling service active...`);

  const poll = async () => {
    try {
      const response = await axios.get(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`,
        {
          params: {
            offset: lastUpdateId + 1,
            timeout: 20,
            allowed_updates: JSON.stringify(["message", "edited_message", "callback_query"])
          },
          timeout: 25000
        }
      );

      const updates = response.data?.result || [];
      for (const update of updates) {
        lastUpdateId = update.update_id;

        // 0. HANDLE INLINE BUTTON CLICKS (callback_query)
        if (update.callback_query) {
          const cb = update.callback_query;
          const cbId = cb.id;
          const chatId = cb.message?.chat?.id;
          const msgId = cb.message?.message_id;
          const data = (cb.data || '').trim();

          if (!chatId) {
            await answerCallbackQuery(cbId);
            continue;
          }

          if (data.startsWith('sel_order:')) {
            const orderNum = data.replace('sel_order:', '').trim();
            const driverIdent = cb.from?.username || cb.from?.first_name || '';
            const availableNow = getAvailableOrdersForDriver(driverIdent, chatId);
            const matched = availableNow.find(o => o.orderNumber.toUpperCase() === orderNum.toUpperCase())
              || findMatchingOrder(orderNum, availableNow);

            if (!matched) {
              await answerCallbackQuery(cbId, "⚠️ Этот рейс уже взят другим водителем!");
              const fresh = getAvailableOrdersForDriver(driverIdent, chatId);
              if (msgId) {
                await editTelegramMessageText(
                  chatId,
                  msgId,
                  `⚠️ <b>Заявка ${orderNum} уже взята другим водителем.</b>\n\nПожалуйста, выберите доступный рейс из списка:`,
                  buildOrderSelectionInlineKeyboard(fresh)
                );
              }
              continue;
            }

            await answerCallbackQuery(cbId, `Подтверждение рейса ${matched.orderNumber}`);

            const consentText = 
              `📦 <b>Подтверждение рейса: ${matched.orderNumber}</b>\n` +
              `🛣️ <b>Маршрут:</b> ${matched.originCity || 'Алматы'} ➔ <b>${matched.destinationCity}</b>\n` +
              `🚛 <b>Тягач:</b> ${matched.assignedTruckPlate || 'Не назначен'}\n\n` +
              `⚠️ <b>СОГЛАСИЕ НА GPS-МОНИТОРИНГ:</b>\n` +
              `Для онлайн-мониторинга доставки в CRM логистов требуется ваше согласие на непрерывную передачу Live GPS-геопозиции фуры.\n\n` +
              `Вы подтверждаете принятие рейса и даёте согласие на трекинг?`;

            const consentMarkup = {
              inline_keyboard: [
                [
                  {
                    text: `✅ Подтверждаю рейс и даю согласие на GPS`,
                    callback_data: `consent_trip:${matched.orderNumber}`
                  }
                ],
                [
                  {
                    text: `❌ Отмена (назад к списку)`,
                    callback_data: `cancel_select`
                  }
                ]
              ]
            };

            if (msgId) {
              await editTelegramMessageText(chatId, msgId, consentText, consentMarkup);
            } else {
              await sendTelegramMessage(chatId, consentText, consentMarkup);
            }
            continue;
          }

          if (data.startsWith('consent_trip:')) {
            const orderNum = data.replace('consent_trip:', '').trim();
            const driverTitle = cb.from?.first_name 
              ? `${cb.from.first_name}${cb.from.last_name ? ' ' + cb.from.last_name : ''}${cb.from.username ? ' (@' + cb.from.username + ')' : ''}`
              : (cb.from?.username ? `@${cb.from.username}` : `Водитель Telegram (${chatId})`);

            const driverIdent = cb.from?.username || cb.from?.first_name || '';
            const availableNow = getAvailableOrdersForDriver(driverIdent, chatId);
            const matched = availableNow.find(o => o.orderNumber.toUpperCase() === orderNum.toUpperCase())
              || findMatchingOrder(orderNum, availableNow)
              || activeOrdersList.find(o => o.orderNumber.toUpperCase() === orderNum.toUpperCase());

            if (!matched) {
              await answerCallbackQuery(cbId, "⚠️ Этот рейс уже недоступен!");
              continue;
            }

            chatSelectedOrder.set(chatId, matched);
            activeChatOrderMap.set(chatId, matched.orderNumber);
            chatDriverConsent.set(chatId, true);
            chatTripActive.set(chatId, false); // Active tracking begins ONLY when real Live GPS arrives
            linkOrderNumberToId(matched.id, matched.orderNumber);
            saveSessionsToCache();

            updateCachedOrderStatus(matched.orderNumber, 'assigned', {
              assignedDriver: driverTitle,
              driverConsent: true
            });
            storageService.updateOrderStatus(matched.orderNumber, 'assigned', {
              assignedDriver: driverTitle,
              driverConsent: true
            });

            await answerCallbackQuery(cbId, `Рейс ${matched.orderNumber} закреплён за вами!`);

            if (msgId) {
              await editTelegramMessageText(
                chatId,
                msgId,
                `✅ <b>Рейс ${matched.orderNumber} подтверждён! Согласие на GPS получено.</b>\n` +
                `🛣️ <b>Маршрут:</b> ${matched.originCity || 'Алматы'} ➔ <b>${matched.destinationCity}</b>\n` +
                `👤 <b>Водитель:</b> ${driverTitle}\n\n` +
                `<i>Следуйте инструкции ниже для включения Live-трансляции геопозиции 👇</i>`
              );
            }

            await sendTelegramMessage(
              chatId,
              `✅ <b>РЕЙС ${matched.orderNumber} ЗАКРЕПЛЁН ЗА ВАМИ</b>\n` +
              `🛣️ <b>Направление:</b> ${matched.originCity || 'Алматы'} ➔ <b>${matched.destinationCity}</b>\n\n` +
              `🛰️ <b>КАК ВКЛЮЧИТЬ НЕПРЕРЫВНУЮ ТРАНСЛЯЦИЮ ГЕОПОЗИЦИИ:</b>\n` +
              `Чтобы машина появилась на карте логиста и непрерывно двигалась в реальном времени:\n\n` +
              `1️⃣ Нажмите <b>скрепку 📎</b> внизу (слева от поля ввода сообщения)\n` +
              `2️⃣ Нажмите <b>«Геопозиция»</b> 📍\n` +
              `3️⃣ Выберите <b>«Транслировать мою геопозицию...»</b> ➔ выберите <b>«8 часов»</b> ⏱️\n\n` +
              `<i>⚠️ ВНИМАНИЕ: не нажимайте «Отправить свою геопозицию» (это разовая статичная точка, от неё фура не едет). Выбирайте именно «Транслировать геопозицию»!</i>\n\n` +
              `Как только начнётся трансляция, фура сразу появится на карте логиста. 🚛💨`,
              buildSelectedOrderKeyboard(matched)
            );
            chatLastMessageTime.set(chatId, Date.now());
            continue;
          }

          if (data === 'cancel_select') {
            await answerCallbackQuery(cbId, "Выбор отменён");
            const driverIdent = cb.from?.username || cb.from?.first_name || '';
            const fresh = getAvailableOrdersForDriver(driverIdent, chatId);
            if (msgId) {
              await editTelegramMessageText(
                chatId,
                msgId,
                `📋 <b>Доступные заявки на перевозку:</b>\n\nВыберите ваш рейс из списка:`,
                buildOrderSelectionInlineKeyboard(fresh)
              );
            }
            continue;
          }

          if (data.startsWith('finish_trip:')) {
            const orderNum = data.replace('finish_trip:', '').trim();
            await answerCallbackQuery(cbId, "Рейс завершается...");

            chatTripActive.set(chatId, false);
            chatDriverConsent.delete(chatId);
            const selected = chatSelectedOrder.get(chatId);
            const finishedNum = orderNum || selected?.orderNumber || activeChatOrderMap.get(chatId) || '';
            const orderId = selected?.id || finishedNum;

            if (finishedNum) {
              const loc = driverLocationsMap.get(finishedNum);
              if (loc) {
                loc.isTrackingActive = false;
                loc.hasRealGps = false;
              }
              const cleanNum = finishedNum.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
              const cleanLoc = driverLocationsMap.get(cleanNum);
              if (cleanLoc) {
                cleanLoc.isTrackingActive = false;
                cleanLoc.hasRealGps = false;
              }
              updateCachedOrderStatus(finishedNum, 'delivered');
              storageService.updateOrderStatus(finishedNum, 'delivered', {
                deliveredAt: new Date().toISOString()
              });
              emitDeliveryEnded(orderId, finishedNum);
              broadcastRealtimeEvent('order_completed', {
                orderId: finishedNum,
                status: 'delivered',
                deliveredAt: new Date().toISOString()
              });
              await syncOrderToFirestore(finishedNum, {
                status: 'delivered',
                deliveredAt: new Date().toISOString(),
                speed: 0
              });
            }

            // Edit message text to "Рейс завершен, спасибо!"
            if (msgId) {
              await editTelegramMessageText(
                chatId,
                msgId,
                `🏁 <b>Рейс ${finishedNum} завершен, спасибо!</b>\n\n` +
                `Груз успешно доставлен. Отслеживание геопозиции остановлено. 🚛✨`
              );
            }

            // Unpin pinned message
            const pinnedId = chatPinnedMsgMap.get(chatId) || msgId;
            if (pinnedId) {
              await unpinTelegramChatMessage(chatId, pinnedId);
              chatPinnedMsgMap.delete(chatId);
            }

            chatSelectedOrder.delete(chatId);
            activeChatOrderMap.delete(chatId);
            saveSessionsToCache();

            const driverIdent = cb.from?.username || cb.from?.first_name || '';
            const nextOrders = getAvailableOrdersForDriver(driverIdent, chatId);
            await sendTelegramMessage(
              chatId,
              `📦 <b>Выберите следующий рейс:</b>`,
              buildOrderSelectionInlineKeyboard(nextOrders)
            );
            continue;
          }

          if (data === 'refresh_orders') {
            const driverIdent = cb.from?.username || cb.from?.first_name || '';
            const freshOrders = getAvailableOrdersForDriver(driverIdent, chatId);
            await answerCallbackQuery(cbId, "Список обновлён");
            if (msgId) {
              if (freshOrders.length === 0) {
                await editTelegramMessageText(
                  chatId,
                  msgId,
                  `👋 <b>Здравствуйте, Водитель!</b>\n\n` +
                  `📭 <b>Сейчас нет свободных заявок, ожидающих назначения фуры.</b>\n` +
                  `Все текущие рейсы со вкладки «Регионы» уже распределены среди водителей или выполнены.\n\n` +
                  `Как только логист добавит новую заявку в CRM, нажмите кнопку проверки ниже 👇`,
                  buildOrderSelectionInlineKeyboard([])
                );
              } else {
                await editTelegramMessageText(
                  chatId,
                  msgId,
                  `👋 <b>Здравствуйте, Водитель!</b>\n\n` +
                  `📦 <b>Выберите ваш рейс из списка (со вкладки Регионы):</b>\n` +
                  `Логист сразу увидит, какую заявку и в какой город вы везёте:`,
                  buildOrderSelectionInlineKeyboard(freshOrders)
                );
              }
            }
            continue;
          }

          await answerCallbackQuery(cbId);
          continue;
        }

        const msg = update.message || update.edited_message;
        if (!msg) continue;

        const chatId = msg.chat?.id;
        if (!chatId) continue;

        const driverIdent = msg.from?.username || msg.from?.first_name || '';
        const availableOrders = getAvailableOrdersForDriver(driverIdent, chatId);
        let selectedOrder = chatSelectedOrder.get(chatId);

        // 1. LIVE LOCATION STREAM (edited_message) - continuous real-time updates from Telegram
        if (update.edited_message) {
          const loc = update.edited_message.location;
          if (loc) {
            let activeOrder = chatSelectedOrder.get(chatId);
            if (!activeOrder) {
              const orderNum = activeChatOrderMap.get(chatId);
              if (orderNum) {
                const stored = storageService.getOrder(orderNum);
                if (stored) {
                  activeOrder = {
                    id: stored.id,
                    orderNumber: stored.orderNumber,
                    destinationCity: stored.destinationCity,
                    originCity: stored.originCity || 'Алматы',
                    status: stored.status,
                    assignedDriver: stored.assignedDriver,
                    assignedTruckPlate: stored.assignedTruckPlate
                  };
                  chatSelectedOrder.set(chatId, activeOrder);
                }
              }
            }

            if (!activeOrder) {
              // Driver has not selected an order or consented yet
              await sendTelegramMessage(
                chatId,
                `⚠️ <b>Вы ещё не выбрали рейс!</b>\nПожалуйста, сначала выберите рейс из списка и подтвердите согласие на GPS-трекинг: нажмите /start.`,
                buildOrderSelectionInlineKeyboard(getAvailableOrdersForDriver(driverIdent, chatId))
              );
              continue;
            }

            chatTripActive.set(chatId, true);
            chatDriverConsent.set(chatId, true);

            const orderId = activeOrder.id;
            const orderNum = activeOrder.orderNumber;
            const speedKmh = loc.speed !== undefined ? Math.max(0, Math.round(loc.speed * 3.6)) : 0;

            const destCity = activeOrder.destinationCity || 'Астана';
            const destKey = destCity.toLowerCase().includes('шымкент') || destCity.toLowerCase().includes('тараз') ? 'shymkent' : 'astana';
            const highwayPolyline = DETAILED_HIGHWAYS[destKey] || DETAILED_HIGHWAYS.astana;
            const destNode = HIGHWAY_NODES[destKey] || HIGHWAY_NODES.astana;
            const originNode = HIGHWAY_NODES.almaty;

            // Get previous telemetry point for Geolib speed & Turf bearing calculation
            const prevLoc = driverLocationsMap.get(orderId) || driverLocationsMap.get(orderNum);
            const prevPoint = prevLoc ? { lat: prevLoc.lat, lng: prevLoc.lng, timestamp: prevLoc.updatedAt } : undefined;

            const processed = processGpsTelemetryFrame({
              orderId,
              lat: loc.latitude,
              lng: loc.longitude,
              speed: speedKmh,
              heading: loc.heading,
              accuracy: loc.horizontal_accuracy,
              prevPoint,
              highwayPolyline,
              origin: { lat: originNode.lat, lng: originNode.lng },
              destination: { lat: destNode.lat, lng: destNode.lng }
            });

            updateDriverLocation({
              orderId,
              driverPhone: msg.from?.phone_number || msg.from?.username || `id:${chatId}`,
              lat: processed.lat,
              lng: processed.lng,
              heading: processed.heading,
              speed: processed.speed,
              updatedAt: processed.timestamp,
              hasRealGps: true,
              isTrackingActive: true,
              driverConsent: true
            }, 'dispatched');

            if (orderNum !== orderId) {
              linkOrderNumberToId(orderId, orderNum);
            }
            updateCachedOrderStatus(activeOrder.orderNumber, 'dispatched', {
              currentLat: processed.lat,
              currentLng: processed.lng,
              speed: processed.speed,
              heading: processed.heading,
              driverConsent: true
            });
            syncOrderToFirestore(activeOrder.orderNumber, {
              status: 'dispatched',
              currentLat: processed.lat,
              currentLng: processed.lng,
              speed: processed.speed
            });
            console.log(`📡 [GPS Framework Live Stream] Order: ${orderNum} | Lat: ${processed.lat.toFixed(5)}, Lng: ${processed.lng.toFixed(5)} | Snapped: ${processed.snappedToRoad} | Speed: ${processed.speed} km/h | Heading: ${processed.heading}°`);
          }
          continue;
        }

        const text = (msg.text || '').trim();
        const location = msg.location;

        // 2. DRIVER SENDS LOCATION (Initial Live Location or Static Point)
        if (location) {
          const { latitude, longitude } = location;
          const isLive = Boolean(location.live_period);
          
          if (!selectedOrder) {
            const orderNum = activeChatOrderMap.get(chatId);
            if (orderNum) {
              const stored = storageService.getOrder(orderNum);
              if (stored) {
                selectedOrder = {
                  id: stored.id,
                  orderNumber: stored.orderNumber,
                  destinationCity: stored.destinationCity,
                  originCity: stored.originCity || 'Алматы',
                  status: stored.status,
                  assignedDriver: stored.assignedDriver,
                  assignedTruckPlate: stored.assignedTruckPlate
                };
                chatSelectedOrder.set(chatId, selectedOrder);
              }
            }
          }

          if (!selectedOrder) {
            await sendTelegramMessage(
              chatId,
              `⚠️ <b>Вы ещё не выбрали рейс!</b>\nПожалуйста, сначала выберите рейс из списка и подтвердите согласие на трекинг: нажмите /start.`,
              buildOrderSelectionInlineKeyboard(getAvailableOrdersForDriver(driverIdent, chatId))
            );
            continue;
          }

          const driverTitle = msg.from?.first_name 
            ? `${msg.from.first_name}${msg.from.last_name ? ' ' + msg.from.last_name : ''}${msg.from.username ? ' (@' + msg.from.username + ')' : ''}`
            : (msg.from?.username ? `@${msg.from.username}` : `Водитель Telegram (${chatId})`);

          const speedCalculated = location.speed !== undefined ? Math.max(0, Math.round(location.speed * 3.6)) : 0;

          if (isLive) {
            // TRUE LIVE LOCATION STREAM STARTED!
            const destCity = selectedOrder.destinationCity || 'Астана';
            const destKey = destCity.toLowerCase().includes('шымкент') || destCity.toLowerCase().includes('тараз') ? 'shymkent' : 'astana';
            const highwayPolyline = DETAILED_HIGHWAYS[destKey] || DETAILED_HIGHWAYS.astana;
            const destNode = HIGHWAY_NODES[destKey] || HIGHWAY_NODES.astana;
            const originNode = HIGHWAY_NODES.almaty;

            const processed = processGpsTelemetryFrame({
              orderId: selectedOrder.id,
              lat: latitude,
              lng: longitude,
              speed: speedCalculated,
              heading: location.heading,
              accuracy: location.horizontal_accuracy,
              highwayPolyline,
              origin: { lat: originNode.lat, lng: originNode.lng },
              destination: { lat: destNode.lat, lng: destNode.lng }
            });

            updateDriverLocation({
              orderId: selectedOrder.id,
              driverPhone: msg.from?.phone_number || msg.from?.username || `id:${chatId}`,
              lat: processed.lat,
              lng: processed.lng,
              heading: processed.heading,
              speed: processed.speed,
              updatedAt: new Date().toISOString(),
              hasRealGps: true,
              isTrackingActive: true,
              driverConsent: true
            }, 'dispatched');
            linkOrderNumberToId(selectedOrder.id, selectedOrder.orderNumber);

            updateCachedOrderStatus(selectedOrder.orderNumber, 'dispatched', {
              assignedDriver: driverTitle,
              dispatchedAt: selectedOrder.dispatchedAt || new Date().toISOString(),
              currentLat: processed.lat,
              currentLng: processed.lng,
              speed: processed.speed,
              heading: processed.heading,
              driverConsent: true
            });

            chatTripActive.set(chatId, true);
            chatDriverConsent.set(chatId, true);
            saveSessionsToCache();

            const liveHours = location.live_period ? Math.round(location.live_period / 3600) : 8;
            const sentMsg = await sendTelegramMessage(
              chatId,
              `🟢 <b>ТРАНСЛЯЦИЯ ГЕОПОЗИЦИИ АКТИВНА (${liveHours} ч.)!</b> 🛰️\n\n` +
              `📦 <b>Рейс:</b> ${selectedOrder.orderNumber}\n` +
              `🛣️ <b>Маршрут:</b> ${selectedOrder.originCity || 'Алматы'} ➔ <b>${selectedOrder.destinationCity}</b>\n` +
              `🚛 <b>Тягач:</b> ${selectedOrder.assignedTruckPlate || 'Назначен'}\n` +
              `👤 <b>Водитель:</b> ${driverTitle}\n\n` +
              `✅ <b>Ваши координаты непрерывно передаются в CRM логисту в реальном времени!</b>\n` +
              `По завершении разгрузки нажмите кнопку ниже 👇`,
              buildActiveTripInlineKeyboard(selectedOrder.orderNumber)
            );

            if (sentMsg?.message_id) {
              chatPinnedMsgMap.set(chatId, sentMsg.message_id);
              saveSessionsToCache();
              await pinTelegramChatMessage(chatId, sentMsg.message_id);
            }

            await sendTelegramMessage(
              chatId,
              `Удачной дороги! 🛣️ Слежка по GPS активна до момента нажатия «🛑 Завершить рейс».`,
              buildInTransitKeyboard(selectedOrder)
            );
          } else {
            // DRIVER SENT A STATIC (ONE-TIME) POINT!
            // Explicitly warn that Telegram doesn't track motion from a static point and tell them how to start Live Location!
            await sendTelegramMessage(
              chatId,
              `⚠️ <b>ВНИМАНИЕ: Вы отправили РАЗОВУЮ геопозицию (точку), а не трансляцию!</b>\n\n` +
              `📍 От разовой точки фура <b>не будет отображаться и двигаться на карте в реальном времени</b>. Telegram требует включить именно <b>ТРАНСЛЯЦИЮ</b>:\n\n` +
              `👇 <b>Как включить трансляцию за 3 шага:</b>\n` +
              `1️⃣ Нажмите <b>скрепку 📎</b> внизу (слева от поля ввода)\n` +
              `2️⃣ Выберите <b>«Геопозиция»</b> 📍\n` +
              `3️⃣ Выберите <b>«Транслировать мою геопозицию...»</b> ➔ на <b>8 часов</b> ⏱️\n\n` +
              `<i>(Не нажимайте «Отправить свою геопозицию» — выбирайте именно пункт со словом «Транслировать»!)</i>`,
              buildSelectedOrderKeyboard(selectedOrder)
            );
          }
          chatLastMessageTime.set(chatId, Date.now());
          continue;
        }

        // 3. /start COMMAND
        if (text.startsWith('/start')) {
          const parts = text.split(' ');
          const orderParam = parts.length > 1 ? parts[1].toUpperCase() : '';
          
          if (orderParam) {
            const matched = findMatchingOrder(orderParam, activeOrdersList);
            if (matched) {
              chatSelectedOrder.set(chatId, matched);
              activeChatOrderMap.set(chatId, matched.orderNumber);
              linkOrderNumberToId(matched.id, matched.orderNumber);
              chatTripActive.set(chatId, false);
              saveSessionsToCache();

              await sendTelegramMessage(
                chatId,
                `👋 <b>Здравствуйте, Водитель!</b>\n\n` +
                `📦 <b>Ваш рейс:</b> ${matched.orderNumber}\n` +
                `🛣️ <b>Маршрут:</b> ${matched.originCity || 'Алматы'} ➔ <b>${matched.destinationCity}</b>\n\n` +
                `Нажмите кнопку ниже, чтобы начать отслеживание поездки 👇`,
                buildSelectedOrderKeyboard(matched)
              );
              chatLastMessageTime.set(chatId, Date.now());
              continue;
            }
          }

          // If no order param, show available orders list with INLINE buttons
          chatTripActive.set(chatId, false);
          if (availableOrders.length === 0) {
            await sendTelegramMessage(
              chatId,
              `👋 <b>Здравствуйте, Водитель!</b>\n\n` +
              `📭 <b>Сейчас нет свободных заявок, ожидающих назначения фуры.</b>\n` +
              `Все текущие рейсы со вкладки «Регионы» уже распределены среди водителей или выполнены.\n\n` +
              `Как только логист добавит новую заявку в CRM, нажмите кнопку проверки ниже 👇`,
              buildOrderSelectionInlineKeyboard([])
            );
          } else {
            await sendTelegramMessage(
              chatId,
              `👋 <b>Здравствуйте, Водитель!</b>\n\n` +
              `📦 <b>Выберите ваш рейс из списка (со вкладки Регионы):</b>\n` +
              `Логист сразу увидит, какую заявку и в какой город вы везёте:`,
              buildOrderSelectionInlineKeyboard(availableOrders)
            );
          }
          chatLastMessageTime.set(chatId, Date.now());
          continue;
        }

        // 4. TEXT COMMANDS & SELECTIONS
        if (text) {
          const lowerText = text.toLowerCase();

          // Change / Refresh order selection
          if (
            lowerText.includes('выбрать другой') || 
            lowerText.includes('сменить рейс') || 
            lowerText.includes('обновить') ||
            lowerText.includes('список')
          ) {
            chatTripActive.set(chatId, false);
            saveSessionsToCache();
            await sendTelegramMessage(
              chatId,
              `📦 <b>Доступные заявки на выезд:</b>\nВыберите рейс и направление:`,
              buildOrderSelectionInlineKeyboard(getAvailableOrdersForDriver(driverIdent, chatId))
            );
            chatLastMessageTime.set(chatId, Date.now());
            continue;
          }

          // Check if driver selected one of the orders from the keyboard buttons
          const availableNow = getAvailableOrdersForDriver(driverIdent, chatId);
          const matchedOrder = findMatchingOrder(text, availableNow);
          if (matchedOrder && !lowerText.includes('доставлен') && !lowerText.includes('выехал')) {
            chatSelectedOrder.set(chatId, matchedOrder);
            activeChatOrderMap.set(chatId, matchedOrder.orderNumber);
            linkOrderNumberToId(matchedOrder.id, matchedOrder.orderNumber);
            chatTripActive.set(chatId, false);
            saveSessionsToCache();

            await sendTelegramMessage(
              chatId,
              `✅ <b>Выбран рейс: ${matchedOrder.orderNumber}</b>\n` +
              `🛣️ <b>Направление:</b> ${matchedOrder.originCity || 'Алматы'} ➔ <b>${matchedOrder.destinationCity}</b>\n\n` +
              `🛰️ <b>КАК ВКЛЮЧИТЬ НЕПРЕРЫВНУЮ ТРАНСЛЯЦИЮ ГЕОПОЗИЦИИ:</b>\n` +
              `Чтобы машина непрерывно двигалась по карте логиста в реальном времени, включите <b>ТРАНСЛЯЦИЮ</b>:\n\n` +
              `1️⃣ Нажмите <b>скрепку 📎</b> внизу (слева от поля ввода сообщения)\n` +
              `2️⃣ Выберите <b>«Геопозиция»</b> 📍\n` +
              `3️⃣ Выберите <b>«Транслировать мою геопозицию...»</b> ➔ на <b>8 часов</b> ⏱️\n\n` +
              `<i>⚠️ Не нажимайте «Отправить свою геопозицию» (это разовая точка). Выбирайте именно «Транслировать геопозицию»!</i>`,
              buildSelectedOrderKeyboard(matchedOrder)
            );
            chatLastMessageTime.set(chatId, Date.now());
            continue;
          }

          // Driver indicates departure via text ("Выехал в рейс" text fallback)
          if (
            lowerText.includes('выехал') || 
            lowerText.includes('в путь') || 
            lowerText.includes('поехал') || 
            lowerText.includes('начать')
          ) {
            if (!selectedOrder) {
              const freshAvail = getAvailableOrdersForDriver(driverIdent, chatId);
              if (freshAvail.length === 0) {
                await sendTelegramMessage(
                  chatId,
                  `📭 Нет свободных заявок для выезда. Ожидайте назначения в CRM.`,
                  buildOrderSelectionInlineKeyboard([])
                );
                continue;
              }
              await sendTelegramMessage(
                chatId,
                `📦 <b>Сначала выберите рейс из списка:</b>`,
                buildOrderSelectionInlineKeyboard(freshAvail)
              );
              continue;
            }

            await sendTelegramMessage(
              chatId,
              `🛰️ <b>Для отображения фуры на карте логиста включите трансляцию геопозиции:</b>\n\n` +
              `1️⃣ Нажмите <b>скрепку 📎</b> внизу слева\n` +
              `2️⃣ Выберите <b>«Геопозиция»</b> 📍\n` +
              `3️⃣ Выберите <b>«Транслировать мою геопозицию...»</b> ➔ на <b>8 часов</b> ⏱️\n\n` +
              `<i>Как только начнётся трансляция, фура сразу появится на карте логиста. 🚛💨</i>`,
              buildSelectedOrderKeyboard(selectedOrder)
            );
            chatLastMessageTime.set(chatId, Date.now());
            continue;
          }

          // Driver marks cargo delivered ("Груз доставлен")
          if (
            lowerText.includes('доставлен') || 
            lowerText.includes('завершить') || 
            lowerText.includes('приехал') || 
            lowerText.includes('выгруз')
          ) {
            chatTripActive.set(chatId, false);
            const finishedOrder = selectedOrder;
            const orderNum = finishedOrder?.orderNumber || activeChatOrderMap.get(chatId) || '';
            const orderId = finishedOrder?.id || orderNum;

            if (orderNum) {
              updateCachedOrderStatus(orderNum, 'delivered');
              storageService.updateOrderStatus(orderNum, 'delivered', {
                deliveredAt: new Date().toISOString()
              });
              emitDeliveryEnded(orderId, orderNum);
              broadcastRealtimeEvent('order_completed', {
                orderId: orderNum,
                status: 'delivered',
                deliveredAt: new Date().toISOString()
              });
              await syncOrderToFirestore(orderNum, {
                status: 'delivered',
                deliveredAt: new Date().toISOString(),
                speed: 0
              });
              if (orderId && orderId !== orderNum) {
                await syncOrderToFirestore(orderId, {
                  status: 'delivered',
                  deliveredAt: new Date().toISOString(),
                  speed: 0
                });
              }
            }

            // Edit and unpin pinned message
            const pinnedId = chatPinnedMsgMap.get(chatId);
            if (pinnedId) {
              await editTelegramMessageText(
                chatId,
                pinnedId,
                `🏁 <b>Рейс ${orderNum} завершен, спасибо!</b>\n\n` +
                `Груз успешно доставлен. Отслеживание геопозиции остановлено. 🚛✨`
              );
              await unpinTelegramChatMessage(chatId, pinnedId);
              chatPinnedMsgMap.delete(chatId);
            }

            chatSelectedOrder.delete(chatId);
            activeChatOrderMap.delete(chatId);
            saveSessionsToCache();

            const nextOrders = getAvailableOrdersForDriver(driverIdent, chatId);
            await sendTelegramMessage(
              chatId,
              `🏁 <b>Рейс успешно завершён!</b>\n` +
              `Груз доставлен в город ${finishedOrder?.destinationCity || ''}. Отслеживание рейса остановлено. Спасибо за работу! 🚛✨\n\n` +
              (nextOrders.length > 0 ? `Выберите следующий доступный рейс:` : `На данный момент нет новых заявок, ожидающих назначения фуры.`),
              buildOrderSelectionInlineKeyboard(nextOrders)
            );
            chatLastMessageTime.set(chatId, Date.now());
            continue;
          }

          // Anti-spam generic reply
          if (canSendAntiSpam(chatId, 60000)) {
            const kb = selectedOrder
              ? (chatTripActive.get(chatId) ? buildInTransitKeyboard(selectedOrder) : buildSelectedOrderKeyboard(selectedOrder))
              : buildOrderSelectionKeyboard(availableOrders);
            await sendTelegramMessage(
              chatId,
              `Для управления рейсом используйте кнопку внизу 👇`,
              kb
            );
            chatLastMessageTime.set(chatId, Date.now());
          }
        }
      }
    } catch (err: any) {
      if (err.code !== 'ECONNABORTED') {
        if (err?.response?.status === 409) {
          console.warn("⚠️ Telegram polling HTTP 409 Conflict: another bot instance is polling. Waiting 5s... (Revoke token in @BotFather to stop old instance)");
          await new Promise(r => setTimeout(r, 5000));
        } else {
          console.warn("Telegram polling warning:", err.message);
        }
      }
    } finally {
      setTimeout(poll, 1200);
    }
  };

  poll();
}

