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

export function updateDriverLocation(location: DriverLocation): DriverLocation {
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
    calculatedSpeed = 65;
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

  console.log(`📍 [GPS Updated] Order: ${location.orderId} | Lat: ${location.lat}, Lng: ${location.lng} | Speed: ${calculatedSpeed} km/h | History: ${history.length} pts`);
  return updated;
}

export function getDriverLocation(orderId: string, destinationCity: string = 'Астана'): RouteProgress {
  const cleanId = orderId.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  
  // Lookup saved location for exact orderId, cleanId, or global fallback
  let saved = driverLocationsMap.get(orderId) || driverLocationsMap.get(cleanId);
  
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

  // Current truck location coordinates
  let currentLat = saved ? saved.lat : detailedRoadPolyline[Math.floor(detailedRoadPolyline.length * 0.4)].lat;
  let currentLng = saved ? saved.lng : detailedRoadPolyline[Math.floor(detailedRoadPolyline.length * 0.4)].lng;
  const speed = saved?.speed || 72; // km/h

  const totalDistance = calculateDistanceKm(origin.lat, origin.lng, destNode.lat, destNode.lng);
  const remainingDistance = calculateDistanceKm(currentLat, currentLng, destNode.lat, destNode.lng);

  let progressPercent = Math.min(100, Math.max(0, Math.round(((totalDistance - remainingDistance) / totalDistance) * 100)));
  if (isNaN(progressPercent)) progressPercent = 0;

  // Mark reached waypoints
  waypoints = waypoints.map((wp) => {
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
  const etaFormatted = hours > 0 ? `~${hours} ч ${mins} мин` : `~${mins} мин`;

  // Provide initial trajectory strictly following the paved highway geometry
  let locationHistory: LocationPoint[] = saved?.history && saved.history.length > 0 ? saved.history : [];
  if (locationHistory.length === 0 && detailedRoadPolyline && detailedRoadPolyline.length > 0) {
    let bestIdx = 0;
    let minD = Infinity;
    for (let i = 0; i < detailedRoadPolyline.length; i++) {
      const d = calculateDistanceKm(currentLat, currentLng, detailedRoadPolyline[i].lat, detailedRoadPolyline[i].lng);
      if (d < minD) {
        minD = d;
        bestIdx = i;
      }
    }
    const step = Math.max(1, Math.floor(bestIdx / 25));
    const sampleHistory: LocationPoint[] = [];
    for (let i = 0; i <= bestIdx; i += step) {
      sampleHistory.push(detailedRoadPolyline[i]);
    }
    const lastSample = sampleHistory[sampleHistory.length - 1];
    if (!lastSample || lastSample.lat !== currentLat || lastSample.lng !== currentLng) {
      sampleHistory.push({ lat: currentLat, lng: currentLng });
    }
    locationHistory = sampleHistory;
  }

  return {
    orderId,
    currentLat,
    currentLng,
    speed,
    originCity: 'Алматы',
    destinationCity: destNode.name,
    totalDistanceKm: totalDistance,
    remainingDistanceKm: remainingDistance,
    progressPercent,
    etaMinutes: etaTotalMinutes,
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
let lastUpdateId = 0;
let isPollingStarted = false;

export function startTelegramBotPolling() {
  if (isPollingStarted) return;
  isPollingStarted = true;

  console.log(`🤖 [Telegram Bot] @${TELEGRAM_BOT_USERNAME} polling service active...`);

  const liveLocationAckChats = new Set<number>();

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

        const text = (msg.text || '').trim();
        const location = msg.location;

        // Check if driver sent location coordinates (button click or live location stream)
        if (location) {
          const { latitude, longitude } = location;
          const activeOrderId = activeChatOrderMap.get(chatId) || 'all';

          updateDriverLocation({
            orderId: activeOrderId,
            driverPhone: msg.from?.phone_number || msg.from?.username || `id:${chatId}`,
            lat: latitude,
            lng: longitude,
            heading: location.heading,
            speed: location.speed !== undefined ? Math.round(location.speed * 3.6) : undefined,
            updatedAt: new Date().toISOString()
          });

          // Case A: Driver sent a one-time location snapshot
          if (update.message) {
            await sendTelegramMessage(
              chatId,
              `✅ <b>Координаты приняты!</b>\n\n📍 <b>Точка:</b> ${latitude.toFixed(5)}° N, ${longitude.toFixed(5)}° E\n\n🚨 <b>ВАЖНО ДЛЯ ДВИЖЕНИЯ В ПУТИ:</b>\nКнопка отправляет точку <b>только 1 раз</b>. Чтобы фура <b>двигалась на карте автоматически, пока вы за рулём</b>:\n\n📡 <b>Включите непрерывную трансляцию:</b>\n1️⃣ Нажмите 📎 <b>(Скрепку)</b> возле поля ввода текста\n2️⃣ Выберите 📍 <b>«Геолокация»</b>\n3️⃣ Нажмите <b>«Транслировать мою геопозицию...»</b> ➔ выберите <b>8 часов</b>!\n\n<i>После этого Telegram будет автоматически передавать ваше движение на карту в фоновом режиме! 🚛💨</i>`
            );
          } 
          // Case B: Driver is streaming Live Location while driving
          else if (update.edited_message) {
            console.log(`📡 [Telegram Live GPS Stream] Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)} | Heading: ${location.heading || 0}°`);
            if (!liveLocationAckChats.has(chatId)) {
              liveLocationAckChats.add(chatId);
              await sendTelegramMessage(
                chatId,
                `🟢 <b>Прямая трансляция движения АКТИВНА!</b>\n\nВаше перемещение в реальном времени отображается на мониторе логиста CRM. Удачной дороги! 🛣️`
              );
            }
          }
        } else if (text.startsWith('/start')) {
          // Extract order ID if passed as parameter e.g. /start REG-1002
          const parts = text.split(' ');
          const orderParam = parts.length > 1 ? parts[1] : 'all';
          activeChatOrderMap.set(chatId, orderParam);

          await sendTelegramMessage(
            chatId,
            `👋 <b>Здравствуйте, Водитель!</b>\n\nВы подключились к системе GPS-мониторинга <b>Silk Road Logistics CRM</b>.\n${orderParam !== 'all' ? `📦 <b>Ваш рейс:</b> ${orderParam}\n\n` : ''}📍 <b>Как начать передачу движения:</b>\n\n1️⃣ <b>Разовая точка:</b> Нажмите кнопку внизу <b>«📍 Отправить геолокацию»</b>.\n\n2️⃣ <b>Постоянный трекинг в пути:</b> Нажмите 📎 (Скрепка) ➔ «Геолокация» ➔ <b>«Транслировать геопозицию на 8 часов»</b>. Фура будет двигаться на мониторе логиста автоматически!`,
            {
              keyboard: [
                [
                  {
                    text: "📍 Отправить геолокацию",
                    request_location: true
                  }
                ]
              ],
              resize_keyboard: true,
              one_time_keyboard: false
            }
          );
        } else if (text) {
          // Check if driver typed an order code e.g. "REG-1002" or "1002"
          const orderMatch = text.match(/([a-zA-Z]{0,4}-?\d{3,6})/i);
          if (orderMatch) {
            const matchedOrder = orderMatch[1].toUpperCase();
            activeChatOrderMap.set(chatId, matchedOrder);
            await sendTelegramMessage(
              chatId,
              `✅ <b>Рейс успешно привязан: ${matchedOrder}</b>\n\nТеперь нажмите <b>«📍 Отправить геолокацию»</b> или включите трансляцию геопозиции через скрепку 📎.`
            );
          } else {
            await sendTelegramMessage(
              chatId,
              `🚚 <b>Silk Road Logistics CRM</b>\n\n• Нажмите кнопку <b>«📍 Отправить геолокацию»</b>\n• Или включите <b>Трансляцию геопозиции</b> через скрепку 📎 на 8 часов для постоянного трекинга в пути.\n• Вы также можете написать номер своего рейса (например: <code>1002</code>).`
            );
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
