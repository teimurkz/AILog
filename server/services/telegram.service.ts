import axios from "axios";

export interface LocationPoint {
  lat: number;
  lng: number;
  timestamp?: string;
}

export interface DriverLocation {
  orderId: string;
  driverPhone?: string;
  lat: number;
  lng: number;
  speed?: number; // km/h
  heading?: number;
  updatedAt: string;
  history?: LocationPoint[];
}

export interface RouteProgress {
  orderId: string;
  currentLat: number;
  currentLng: number;
  speed: number;
  originCity: string;
  destinationCity: string;
  totalDistanceKm: number;
  remainingDistanceKm: number;
  progressPercent: number;
  etaMinutes: number;
  etaFormatted: string;
  updatedAt: string;
  routeWaypoints: Array<{ name: string; lat: number; lng: number; reached: boolean }>;
  detailedRoadPolyline: LocationPoint[];
  locationHistory: LocationPoint[];
}

// In-memory store for driver locations and active chat-order mappings
const driverLocationsMap = new Map<string, DriverLocation>();
const activeChatOrderMap = new Map<number, string>();
let lastGlobalLocation: DriverLocation | null = null;

// Telegram Bot Credentials
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8923191579:AAFdypJwZ5l6vy8yIuYqH4WGM_tXJEn9bZo";
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

import { db } from "../config/firebase.js";

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

// Sync location or status updates directly to Cloud Firestore
export async function syncOrderToFirestore(orderIdOrNumber: string, updates: Record<string, any>) {
  try {
    if (!orderIdOrNumber || orderIdOrNumber === 'all') return;
    
    // Clean string for matching
    const trimmed = orderIdOrNumber.trim();
    const cleanUpper = trimmed.toUpperCase();

    // 1. Try direct doc ref by ID
    const docRef = db.collection('regional_orders').doc(trimmed);
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      await docRef.update({
        ...updates,
        updatedAt: new Date().toISOString()
      });
      console.log(`🔥 [Firestore] Updated regional_orders/${trimmed}`);
      return;
    }

    // 2. Query by exact orderNumber (e.g. REG-1002 or 1002)
    const q1 = await db.collection('regional_orders')
      .where('orderNumber', '==', cleanUpper)
      .limit(1)
      .get();
    if (!q1.empty) {
      await q1.docs[0].ref.update({
        ...updates,
        updatedAt: new Date().toISOString()
      });
      console.log(`🔥 [Firestore] Updated regional_orders matching orderNumber=${cleanUpper}`);
      return;
    }

    // 3. Try with or without 'REG-' prefix
    const altNum = cleanUpper.startsWith('REG-') ? cleanUpper.replace('REG-', '') : `REG-${cleanUpper}`;
    const q2 = await db.collection('regional_orders')
      .where('orderNumber', '==', altNum)
      .limit(1)
      .get();
    if (!q2.empty) {
      await q2.docs[0].ref.update({
        ...updates,
        updatedAt: new Date().toISOString()
      });
      console.log(`🔥 [Firestore] Updated regional_orders matching orderNumber=${altNum}`);
      return;
    }

    // 4. Save to dedicated driver_locations collection as fallback
    const locRef = db.collection('driver_locations').doc(trimmed.toLowerCase());
    await locRef.set({
      ...updates,
      orderId: trimmed,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    console.log(`🔥 [Firestore] Saved driver_locations/${trimmed.toLowerCase()}`);
  } catch (err: any) {
    console.warn(`⚠️ [Firestore Sync Notice] Could not sync order ${orderIdOrNumber}:`, err.message);
  }
}

export function updateDriverLocation(location: DriverLocation, status?: string): DriverLocation {
  const existing = driverLocationsMap.get(location.orderId) || (location.orderId === 'all' ? lastGlobalLocation : null);
  const history: LocationPoint[] = existing?.history && existing.history.length > 0 
    ? [...existing.history] 
    : [
        { lat: HIGHWAY_NODES.almaty.lat, lng: HIGHWAY_NODES.almaty.lng, timestamp: new Date().toISOString() }
      ];

  const now = new Date();
  const lastPoint = history[history.length - 1];

  // Calculate actual driving speed between points if not passed directly
  let calculatedSpeed = location.speed;
  if ((calculatedSpeed === undefined || calculatedSpeed === null) && lastPoint) {
    const distKm = calculateDistanceKm(lastPoint.lat, lastPoint.lng, location.lat, location.lng);
    const dtSeconds = lastPoint.timestamp 
      ? Math.max(1, (now.getTime() - new Date(lastPoint.timestamp).getTime()) / 1000) 
      : 3;
    if (distKm < 0.01 && dtSeconds > 10) {
      calculatedSpeed = 0; // Standing still
    } else {
      const speedKmh = Math.round((distKm / (dtSeconds / 3600)));
      calculatedSpeed = Math.min(110, Math.max(15, speedKmh));
    }
  }
  if (!calculatedSpeed) {
    calculatedSpeed = 68;
  }

  // Append new location point to history if moved by at least 20 meters (0.02 km)
  if (!lastPoint || calculateDistanceKm(lastPoint.lat, lastPoint.lng, location.lat, location.lng) >= 0.02) {
    history.push({
      lat: location.lat,
      lng: location.lng,
      timestamp: now.toISOString()
    });
  }

  const updated: DriverLocation = {
    ...location,
    speed: calculatedSpeed,
    updatedAt: now.toISOString(),
    history
  };

  // Store location under orderId key
  driverLocationsMap.set(location.orderId, updated);
  
  // Store under cleaned key
  const cleanId = location.orderId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  driverLocationsMap.set(cleanId, updated);

  // If there is an alias (e.g. orderNumber <-> docId), update alias key as well
  const alias = orderAliasMap.get(cleanId) || orderAliasMap.get(location.orderId);
  if (alias) {
    driverLocationsMap.set(alias, updated);
    driverLocationsMap.set(alias.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase(), updated);
  }

  // If orderId is 'all' or empty, propagate to all tracked orders in memory so CRM views immediately update
  if (location.orderId === 'all' || !location.orderId) {
    for (const [key, val] of driverLocationsMap.entries()) {
      if (key !== 'all') {
        driverLocationsMap.set(key, {
          ...val,
          lat: location.lat,
          lng: location.lng,
          speed: calculatedSpeed,
          heading: location.heading ?? val.heading,
          updatedAt: now.toISOString(),
          history: [...history]
        });
      }
    }
  }

  lastGlobalLocation = updated;

  // Sync to Cloud Firestore in background
  syncOrderToFirestore(location.orderId, {
    currentLat: location.lat,
    currentLng: location.lng,
    speed: calculatedSpeed,
    heading: location.heading || 0,
    lastGpsUpdate: now.toISOString(),
    locationHistory: history.slice(-50),
    ...(status ? { status } : {})
  });

  console.log(`📍 [GPS Updated] Order: ${location.orderId} | Lat: ${location.lat}, Lng: ${location.lng} | Speed: ${calculatedSpeed} km/h | History: ${history.length} pts`);
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

  // Lookup saved location for exact orderId, cleanId, orderNumber, alias or global fallback
  let saved = driverLocationsMap.get(orderId) 
    || driverLocationsMap.get(cleanId)
    || (cleanOrderNum ? driverLocationsMap.get(cleanOrderNum) : null)
    || (orderNumber ? driverLocationsMap.get(orderNumber) : null);

  const alias = orderAliasMap.get(cleanId) || (cleanOrderNum ? orderAliasMap.get(cleanOrderNum) : null);
  if (!saved && alias) {
    saved = driverLocationsMap.get(alias);
  }
  
  // If global location was recently received from real Telegram/web GPS, prioritize it
  if (lastGlobalLocation) {
    if (!saved) {
      saved = {
        ...lastGlobalLocation,
        orderId
      };
    } else {
      const savedTime = new Date(saved.updatedAt).getTime();
      const globalTime = new Date(lastGlobalLocation.updatedAt).getTime();
      // If global location was updated more recently or saved is older than 5 minutes, use real live GPS
      if (globalTime > savedTime || (Date.now() - savedTime > 300000 && globalTime > Date.now() - 3600000)) {
        saved = {
          ...lastGlobalLocation,
          orderId
        };
      }
    }
  }

  const origin = HIGHWAY_NODES.almaty;
  
  // Resolve destination coordinates
  const destKey = Object.keys(HIGHWAY_NODES).find(k => 
    destinationCity.toLowerCase().includes(k) || HIGHWAY_NODES[k].name.toLowerCase() === destinationCity.toLowerCase()
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

  const totalDistance = calculateDistanceKm(origin.lat, origin.lng, destNode.lat, destNode.lng);

  // Status-aware position determination
  const statusLower = (orderStatus || '').toLowerCase();
  const isDelivered = statusLower === 'delivered' || statusLower === 'доставлено';
  const isPending = statusLower === 'new' || statusLower === 'loading' || statusLower === 'новый' || statusLower === 'на погрузке';
  const isDispatched = statusLower === 'dispatched' || statusLower === 'в пути' || statusLower.includes('пути') || (!isDelivered && !isPending);

  let currentLat = detailedRoadPolyline[0]?.lat || origin.lat;
  let currentLng = detailedRoadPolyline[0]?.lng || origin.lng;
  let speed = 0;

  if (isDelivered) {
    // 100% complete at destination
    currentLat = destNode.lat;
    currentLng = destNode.lng;
    speed = 0;
  } else if (isPending && !saved) {
    // 0% at warehouse origin
    currentLat = origin.lat;
    currentLng = origin.lng;
    speed = 0;
  } else {
    // In transit ('dispatched')
    speed = saved?.speed || 68;
    
    if (saved) {
      // If saved location was recent (< 2 min), use exact driver coordinates
      const timeSinceUpdateSec = (Date.now() - new Date(saved.updatedAt).getTime()) / 1000;
      if (timeSinceUpdateSec < 120) {
        currentLat = saved.lat;
        currentLng = saved.lng;
      } else {
        // Driver hasn't transmitted in > 2 min: advance smoothly along highway from last known position
        let bestIdx = 0;
        let minD = Infinity;
        for (let i = 0; i < detailedRoadPolyline.length; i++) {
          const d = calculateDistanceKm(saved.lat, saved.lng, detailedRoadPolyline[i].lat, detailedRoadPolyline[i].lng);
          if (d < minD) {
            minD = d;
            bestIdx = i;
          }
        }
        // Advance based on elapsed time (at 68 km/h)
        const kmAdvanced = Math.min(250, (speed / 3600) * timeSinceUpdateSec);
        const ptsPerKm = detailedRoadPolyline.length / Math.max(1, totalDistance);
        const ptsToAdvance = Math.round(kmAdvanced * ptsPerKm);
        const targetIdx = Math.min(detailedRoadPolyline.length - 1, bestIdx + ptsToAdvance);

        currentLat = detailedRoadPolyline[targetIdx].lat;
        currentLng = detailedRoadPolyline[targetIdx].lng;
      }
    } else {
      // Dispatched but no driver GPS yet: calculate position along highway based on dispatchedAt or smooth progression
      const startTime = dispatchedAt ? new Date(dispatchedAt).getTime() : Date.now() - 3600000; // default 1 hr ago
      const elapsedHours = Math.max(0.1, (Date.now() - startTime) / 3600000);
      const kmTraveled = Math.min(totalDistance * 0.95, elapsedHours * speed);
      const targetPercent = Math.min(0.95, kmTraveled / Math.max(1, totalDistance));
      const targetIdx = Math.min(detailedRoadPolyline.length - 1, Math.floor(detailedRoadPolyline.length * targetPercent));

      currentLat = detailedRoadPolyline[targetIdx].lat;
      currentLng = detailedRoadPolyline[targetIdx].lng;
    }
  }

  const remainingDistance = isDelivered ? 0 : calculateDistanceKm(currentLat, currentLng, destNode.lat, destNode.lng);

  let progressPercent = isDelivered 
    ? 100 
    : Math.min(100, Math.max(0, Math.round(((totalDistance - remainingDistance) / totalDistance) * 100)));
  if (isNaN(progressPercent)) progressPercent = 0;

  // Mark reached waypoints
  waypoints = waypoints.map((wp) => {
    if (isDelivered) return { ...wp, reached: true };
    const distToWp = calculateDistanceKm(currentLat, currentLng, wp.lat, wp.lng);
    const distOriginToWp = calculateDistanceKm(origin.lat, origin.lng, wp.lat, wp.lng);
    const distOriginToCurrent = calculateDistanceKm(origin.lat, origin.lng, currentLat, currentLng);
    const reached = distOriginToCurrent >= distOriginToWp || distToWp < 25;
    return { ...wp, reached };
  });

  const etaHoursDecimal = remainingDistance / Math.max(speed, 30);
  const etaTotalMinutes = Math.round(etaHoursDecimal * 60);
  const hours = Math.floor(etaTotalMinutes / 60);
  const mins = etaTotalMinutes % 60;
  const etaFormatted = isDelivered 
    ? "Груз доставлен" 
    : isPending 
      ? "Ожидает отправки" 
      : hours > 0 ? `~${hours} ч ${mins} мин` : `~${mins} мин`;

  // Build high-resolution trajectory strictly following the paved highway geometry
  let locationHistory: LocationPoint[] = saved?.history && saved.history.length > 0 ? [...saved.history] : [];
  if (locationHistory.length < 2 && detailedRoadPolyline && detailedRoadPolyline.length > 0) {
    let bestIdx = 0;
    let minD = Infinity;
    for (let i = 0; i < detailedRoadPolyline.length; i++) {
      const d = calculateDistanceKm(currentLat, currentLng, detailedRoadPolyline[i].lat, detailedRoadPolyline[i].lng);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    const step = Math.max(1, Math.floor(bestIdx / 30));
    const sampleHistory: LocationPoint[] = [];
    for (let i = 0; i <= bestIdx; i += step) {
      sampleHistory.push(detailedRoadPolyline[i]);
    }
    const lastSample = sampleHistory[sampleHistory.length - 1];
    if (!lastSample || lastSample.lat !== currentLat || lastSample.lng !== currentLng) {
      sampleHistory.push({ lat: currentLat, lng: currentLng, timestamp: new Date().toISOString() });
    }
    locationHistory = sampleHistory;
  }

  return {
    orderId,
    currentLat,
    currentLng,
    speed: isDelivered || isPending ? 0 : speed,
    originCity: 'Алматы',
    destinationCity: destNode.name,
    totalDistanceKm: totalDistance,
    remainingDistanceKm: remainingDistance,
    progressPercent,
    etaMinutes: isDelivered || isPending ? 0 : etaTotalMinutes,
    etaFormatted,
    updatedAt: saved ? saved.updatedAt : new Date().toISOString(),
    routeWaypoints: waypoints,
    detailedRoadPolyline,
    locationHistory
  };
}

// Send message via Telegram Bot API
async function sendTelegramMessage(chatId: number, text: string, replyMarkup?: any) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    });
  } catch (error: any) {
    console.error("Error sending Telegram message:", error?.response?.data || error.message);
  }
}

// Real-time Telegram Bot Polling Loop
// State and anti-spam tracking for Telegram chats
const chatLastMessageTime = new Map<number, number>();
const chatTripActive = new Map<number, boolean>();

function canSendAntiSpam(chatId: number, minIntervalMs: number = 60000): boolean {
  const last = chatLastMessageTime.get(chatId) || 0;
  return Date.now() - last > minIntervalMs;
}

// 1-Click Keyboard: The ONLY button the driver needs before departure!
const START_KEYBOARD = {
  keyboard: [
    [{ text: "🚚 ВЫЕХАЛ В РЕЙС", request_location: true }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

// While on the road: Only 1 button to finish upon delivery
const TRANSIT_KEYBOARD = {
  keyboard: [
    [{ text: "🏁 Груз доставлен (Завершить)" }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

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
            allowed_updates: JSON.stringify(["message", "edited_message"])
          },
          timeout: 25000
        }
      );

      const updates = response.data?.result || [];
      for (const update of updates) {
        lastUpdateId = update.update_id;

        // Support both regular message and live location streaming edited_message
        const msg = update.message || update.edited_message;
        if (!msg) continue;

        const chatId = msg.chat?.id;
        if (!chatId) continue;

        const activeOrderId = activeChatOrderMap.get(chatId) || 'all';

        // 1. LIVE LOCATION STREAM (edited_message) - STRICT ZERO SPAM:
        // Update coordinates in memory & Firestore silently without sending ANY chat message!
        if (update.edited_message) {
          const loc = update.edited_message.location;
          if (loc) {
            updateDriverLocation({
              orderId: activeOrderId,
              driverPhone: msg.from?.phone_number || msg.from?.username || `id:${chatId}`,
              lat: loc.latitude,
              lng: loc.longitude,
              heading: loc.heading,
              speed: loc.speed !== undefined ? Math.round(loc.speed * 3.6) : undefined,
              updatedAt: new Date().toISOString()
            }, 'dispatched');
            console.log(`📡 [Telegram Live GPS Stream] Order: ${activeOrderId} | Lat: ${loc.latitude.toFixed(5)}, Lng: ${loc.longitude.toFixed(5)}`);
          }
          continue;
        }

        const text = (msg.text || '').trim();
        const location = msg.location;

        // 2. DRIVER PRESSED "🚚 ВЫЕХАЛ В РЕЙС" (location sent with 1-click)
        if (location) {
          const { latitude, longitude } = location;

          updateDriverLocation({
            orderId: activeOrderId,
            driverPhone: msg.from?.phone_number || msg.from?.username || `id:${chatId}`,
            lat: latitude,
            lng: longitude,
            heading: location.heading,
            speed: location.speed !== undefined ? Math.round(location.speed * 3.6) : 68,
            updatedAt: new Date().toISOString()
          }, 'dispatched');

          const isAlreadyActive = chatTripActive.get(chatId);

          if (!isAlreadyActive) {
            chatTripActive.set(chatId, true);
            await syncOrderToFirestore(activeOrderId, {
              status: 'dispatched',
              dispatchedAt: new Date().toISOString(),
              currentLat: latitude,
              currentLng: longitude,
              speed: 68
            });

            // Send EXACTLY ONE confirmation message and switch to transit keyboard
            await sendTelegramMessage(
              chatId,
              `🟢 <b>Рейс начат!</b>\n\nКоординаты приняты. Логисты видят ваше перемещение на карте.\nУдачной дороги! 🛣️`,
              TRANSIT_KEYBOARD
            );
            chatLastMessageTime.set(chatId, Date.now());
          } else {
            // Already in transit - coordinates updated quietly, NO SPAM!
            console.log(`📍 [GPS updated quietly] Order: ${activeOrderId} | ${latitude}, ${longitude}`);
          }
        } 
        // 3. /start COMMAND
        else if (text.startsWith('/start')) {
          const parts = text.split(' ');
          const orderParam = parts.length > 1 ? parts[1].toUpperCase() : 'all';
          activeChatOrderMap.set(chatId, orderParam);
          chatTripActive.set(chatId, false);

          await sendTelegramMessage(
            chatId,
            `👋 <b>Здравствуйте!</b>\n${orderParam !== 'all' ? `📦 <b>Рейс:</b> ${orderParam}\n\n` : ''}Для начала поездки нажмите кнопку <b>«🚚 ВЫЕХАЛ В РЕЙС»</b> ниже 👇`,
            START_KEYBOARD
          );
          chatLastMessageTime.set(chatId, Date.now());
        } 
        // 4. TEXT MESSAGES
        else if (text) {
          const lowerText = text.toLowerCase();

          // Driver marks start of trip via text ("Выехал в рейс" fallback)
          if (
            lowerText.includes('выехал') || 
            lowerText.includes('в путь') || 
            lowerText.includes('рейс') || 
            lowerText.includes('начать') || 
            lowerText.includes('поехал')
          ) {
            chatTripActive.set(chatId, true);
            await syncOrderToFirestore(activeOrderId, {
              status: 'dispatched',
              dispatchedAt: new Date().toISOString(),
              speed: 68
            });

            await sendTelegramMessage(
              chatId,
              `🟢 <b>Рейс начат!</b>\n\nЛогисты видят ваше перемещение на карте.\nУдачной дороги! 🛣️`,
              TRANSIT_KEYBOARD
            );
            chatLastMessageTime.set(chatId, Date.now());
          }
          // Driver marks cargo delivered ("Груз доставлен")
          else if (
            lowerText.includes('доставлен') || 
            lowerText.includes('завершить') || 
            lowerText.includes('приехал') || 
            lowerText.includes('выгруз')
          ) {
            chatTripActive.set(chatId, false);
            await syncOrderToFirestore(activeOrderId, {
              status: 'delivered',
              deliveredAt: new Date().toISOString()
            });

            await sendTelegramMessage(
              chatId,
              `🏁 <b>Рейс успешно завершён!</b>\n\nСпасибо за доставку груза! 🚛✨`,
              START_KEYBOARD
            );
            chatLastMessageTime.set(chatId, Date.now());
          }
          // Driver sent order number e.g. "REG-1002" or "1002"
          else {
            const orderMatch = text.match(/([a-zA-Z]{0,4}-?\d{3,6})/i);
            if (orderMatch) {
              const matchedOrder = orderMatch[1].toUpperCase();
              activeChatOrderMap.set(chatId, matchedOrder);
              chatTripActive.set(chatId, false);

              await sendTelegramMessage(
                chatId,
                `📦 <b>Рейс ${matchedOrder} привязан.</b>\n\nНажмите <b>«🚚 ВЫЕХАЛ В РЕЙС»</b> ниже для старта поездки 👇`,
                START_KEYBOARD
              );
              chatLastMessageTime.set(chatId, Date.now());
            } 
            // Generic text: Anti-spam rate limited to max 1 reply per 60 seconds
            else if (canSendAntiSpam(chatId, 60000)) {
              const isTripActive = chatTripActive.get(chatId);
              await sendTelegramMessage(
                chatId,
                `Для управления рейсом нажмите кнопку внизу 👇`,
                isTripActive ? TRANSIT_KEYBOARD : START_KEYBOARD
              );
              chatLastMessageTime.set(chatId, Date.now());
            }
          }
        }
      }
    } catch (err: any) {
      if (err.code !== 'ECONNABORTED') {
        console.warn("Telegram polling warning:", err.message);
      }
    } finally {
      setTimeout(poll, 1200);
    }
  };

  poll();
}

