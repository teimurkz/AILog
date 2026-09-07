import React, { useState, useEffect } from 'react';
import { 
  MapPin, 
  Truck, 
  Navigation, 
  Clock, 
  CheckCircle2, 
  X, 
  Send, 
  RefreshCw, 
  Play, 
  ShieldCheck, 
  ExternalLink,
  Zap,
  Info,
  Edit3,
  Check,
  Settings,
  Bot,
  Maximize2,
  Minimize2,
  Smartphone,
  Copy,
  MessageCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ordersApi, subscribeToRealtimeStream } from '../../services/api';
import { onTruckPositionUpdate, onDeliveryEnded, joinOrderRoom, leaveOrderRoom } from '../../services/socket';
import { LeafletRouteMap } from './LeafletRouteMap';
import { RegionalTruckOrder } from '../../types';
import { KAZAKHSTAN_ROADS } from '../../utils/kazakhstanRoads';
import { auth } from '../../firebase';

interface RouteMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: RegionalTruckOrder | null;
}

interface RouteData {
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
  signalStatus?: 'in_transit' | 'parked' | 'idle' | 'offline' | 'waiting' | 'delivered';
  signalStatusText?: string;
  lastPingSecondsAgo?: number;
  updatedAt: string;
  routeWaypoints: Array<{ name: string; lat: number; lng: number; reached: boolean }>;
  detailedRoadPolyline?: Array<{ lat: number; lng: number }>;
  locationHistory?: Array<{ lat: number; lng: number; timestamp?: string }>;
}

export const RouteMapModal: React.FC<RouteMapModalProps> = ({ isOpen, onClose, order }) => {
  const [activeTab, setActiveTab] = useState<'map' | 'telegram'>('map');
  const [loading, setLoading] = useState<boolean>(false);
  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Customizable Telegram Bot Username
  const [botUsername, setBotUsername] = useState<string>(() => {
    return localStorage.getItem('telegram_bot_username') || 'SilkRoadDriverBot';
  });
  const [isEditingBot, setIsEditingBot] = useState<boolean>(false);
  const [tempBotInput, setTempBotInput] = useState<string>(botUsername);

  const saveBotUsername = (newName: string) => {
    const sanitized = newName.replace('@', '').trim() || 'SilkRoadDriverBot';
    setBotUsername(sanitized);
    localStorage.setItem('telegram_bot_username', sanitized);
    setIsEditingBot(false);
  };

  // Open full map in a separate dedicated browser window
  const handleOpenStandaloneWindow = () => {
    if (!order) return;
    const width = 1280;
    const height = 800;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const popup = window.open(
      '',
      `GPS_Map_${order.id}`,
      `width=${width},height=${height},top=${top},left=${left},resizable=yes,scrollbars=yes`
    );

    if (popup) {
      const lat = routeData?.currentLat ?? 46.8481;
      const lng = routeData?.currentLng ?? 74.9804;
      const dest = order.destinationCity || 'Астана';
      const orderNum = order.orderNumber;
      const truck = order.assignedTruckPlate || 'Не указан';
      const driver = order.assignedDriver || 'Не назначен';
      const destKey = (dest || '').toLowerCase().includes('шымкент') || (dest || '').toLowerCase().includes('тараз')
        ? 'shymkent'
        : 'astana';
      const defaultRoad = KAZAKHSTAN_ROADS[destKey] || KAZAKHSTAN_ROADS.astana;
      const roadPointsJson = JSON.stringify(routeData?.detailedRoadPolyline || defaultRoad);
      const historyPointsJson = JSON.stringify(routeData?.locationHistory || [
        { lat: defaultRoad[0]?.lat || 43.2389, lng: defaultRoad[0]?.lng || 76.8897 },
        { lat, lng }
      ]);

      popup.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>📍 GPS Мониторинг Рейса ${orderNum} - ${dest}</title>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <style>
            body { margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: white; }
            #header { padding: 14px 24px; background: #1e293b; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #334155; }
            #map { width: 100vw; height: calc(100vh - 75px); }
            .badge { background: #2563eb; color: white; padding: 5px 12px; border-radius: 10px; font-size: 12px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div id="header">
            <div>
              <div style="font-size:17px;font-weight:bold;display:flex;align-items:center;gap:8px;">
                <span>🚚</span> <span>ФУРА: ${truck} (${driver})</span>
              </div>
              <div style="font-size:12px;color:#94a3b8;margin-top:2px;">Заявка № ${orderNum} • Трасса: Алматы ➔ ${dest}</div>
            </div>
            <div style="margin-left:auto;display:flex;gap:12px;align-items:center;">
              <span class="badge" style="background:#10b981;">🟢 ТРАЕКТОРИЯ АКТИВНА</span>
              <span class="badge" id="etaBadge">ETA: ~4 ч 30 мин</span>
            </div>
          </div>
          <div id="map"></div>
          <script>
            var map = L.map('map').setView([${lat}, ${lng}], 6);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

            var roadCoords = ${roadPointsJson}.map(p => [p.lat, p.lng]);
            var highwayLine = L.polyline(roadCoords, { color: '#3b82f6', weight: 5, opacity: 0.7, dashArray: '8, 8' }).addTo(map);

            var historyCoords = ${historyPointsJson}.map(p => [p.lat, p.lng]);
            var trajectoryLine = L.polyline(historyCoords, { color: '#10b981', weight: 6, opacity: 0.95, lineCap: 'round' }).addTo(map);

            var neatTruckIcon = L.divIcon({
              className: 'truck-marker',
              html: '<div style="position:relative;display:flex;align-items:center;"><div style="background:#10b981;color:white;width:32px;height:32px;border-radius:50%;border:2px solid white;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 4px 14px rgba(0,0,0,0.5);">🚚</div><div style="margin-left:8px;background:rgba(15,23,42,0.9);color:white;padding:3px 8px;border-radius:8px;font-size:11px;font-weight:bold;border:1px solid #10b981;white-space:nowrap;">${truck}</div></div>',
              iconSize: [160, 36],
              iconAnchor: [16, 18]
            });
            var marker = L.marker([${lat}, ${lng}], { icon: neatTruckIcon }).addTo(map);

            setInterval(async () => {
              try {
                const res = await fetch('/api/driver/location/${order.id}?destinationCity=${encodeURIComponent(dest)}&orderNumber=${encodeURIComponent(orderNum)}&status=${encodeURIComponent(order.status || "")}');
                if (res.ok) {
                  const data = await res.json();
                  marker.setLatLng([data.currentLat, data.currentLng]);
                  document.getElementById('etaBadge').innerText = 'ETA: ' + data.etaFormatted;
                  if (data.locationHistory && data.locationHistory.length > 0) {
                    trajectoryLine.setLatLngs(data.locationHistory.map(p => [p.lat, p.lng]));
                  }
                }
              } catch(e) {}
            }, 3000);
          </script>
        </body>
        </html>
      `);
      popup.document.close();
    }
  };

  // Fetch real-time driver GPS data
  const fetchLocationData = async () => {
    if (!order) return;
    try {
      const params = new URLSearchParams({
        destinationCity: order.destinationCity || 'Астана',
        orderNumber: order.orderNumber || '',
        status: order.status || '',
        dispatchedAt: (order as any).dispatchedAt || order.updatedAt || ''
      });

      const token = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => undefined) : undefined;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/driver/location/${order.id}?${params.toString()}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setRouteData(data);
        // Sync driver coordinates to Firestore document directly from authenticated browser
        if (data.currentLat && data.currentLng && order.id) {
          ordersApi.update(order.id, {
            currentLat: data.currentLat,
            currentLng: data.currentLng,
            speed: data.speed !== undefined ? data.speed : 0,
            lastGpsUpdate: new Date().toISOString(),
            ...(order.status === 'new' || order.status === 'loading' ? { status: 'dispatched' } : {})
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Failed to fetch driver GPS data:", e);
    }
  };

  // 1. Real-time WebSocket (Socket.io) & SSE Stream Listener
  useEffect(() => {
    if (!isOpen || !order?.id) return;

    // Join order room in Socket.io
    joinOrderRoom(order.id);
    if (order.orderNumber) joinOrderRoom(order.orderNumber);

    // A. Socket.io position update (sub-second latency without page reload)
    const unsubSocketUpdate = onTruckPositionUpdate((data) => {
      const matches = data?.orderId === order.id ||
                      data?.orderId === order.orderNumber ||
                      data?.truckNumber === order.orderNumber ||
                      data?.truckNumber === order.assignedTruckPlate;
      if (matches) {
        setRouteData(prev => {
          if (!prev) return prev;
          const newHistory = [
            ...(prev.locationHistory || []),
            { lat: data.lat, lng: data.lng, timestamp: data.updatedAt }
          ];
          return {
            ...prev,
            currentLat: data.lat,
            currentLng: data.lng,
            speed: data.speed !== undefined ? data.speed : prev.speed,
            heading: data.heading !== undefined ? data.heading : prev.heading,
            updatedAt: data.updatedAt,
            lastPingSecondsAgo: 0,
            signalStatus: (data.status as any) || (data.speed && data.speed > 5 ? 'in_transit' : 'parked'),
            signalStatusText: (data.speed && data.speed > 5) ? `🟢 В движении (${data.speed} км/ч)` : '🟢 На связи (Стоянка)',
            locationHistory: newHistory
          };
        });
      }
    });

    // B. Socket.io delivery ended event (driver completed trip in bot)
    const unsubDeliveryEnded = onDeliveryEnded((data) => {
      const matches = data?.orderId === order.id ||
                      data?.orderId === order.orderNumber ||
                      data?.orderNumber === order.orderNumber;
      if (matches) {
        order.status = 'delivered';
        setRouteData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            speed: 0,
            signalStatus: 'delivered',
            signalStatusText: '🏁 Груз доставлен (Рейс завершен)'
          };
        });
      }
    });

    // C. SSE Stream Listener (fallback)
    const unsubSSE = subscribeToRealtimeStream((event, data) => {
      if (event === 'telemetry_update' || event === 'order_updated' || event === 'order_completed') {
        const matches = data?.orderId === order.id ||
                        data?.orderNumber === order.orderNumber ||
                        data?.orderNumberOrId === order.orderNumber ||
                        data?.id === order.id;
        if (matches) {
          fetchLocationData();
        }
      }
    });

    return () => {
      leaveOrderRoom(order.id);
      if (order.orderNumber) leaveOrderRoom(order.orderNumber);
      unsubSocketUpdate();
      unsubDeliveryEnded();
      unsubSSE();
    };
  }, [isOpen, order?.id, order?.orderNumber]);

  // 2. Auto-refresh GPS coordinates every 3 seconds while modal is open
  useEffect(() => {
    if (isOpen && order) {
      fetchLocationData();
      const interval = setInterval(() => {
        fetchLocationData();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, order]);

  if (!isOpen || !order) return null;

  const destCity = order.destinationCity || 'Астана';
  const driverName = order.assignedDriver || 'Не назначен';
  const truckPlate = order.assignedTruckPlate || 'Не указан';
  const botLink = `https://t.me/${botUsername}?start=${encodeURIComponent(order.orderNumber || order.id)}`;
  const webTrackerLink = `${window.location.origin}/gps?order=${encodeURIComponent(order.orderNumber || order.id)}`;
  const driverPhoneClean = ((order as any).driverPhone || order.recipientPhone || order.assignedDriver || '').replace(/[^0-9]/g, '');
  const whatsappShareUrl = `https://wa.me/${driverPhoneClean}?text=${encodeURIComponent(
    `Здравствуйте! Подтвердите выезд по рейсу ${order.orderNumber} (Алматы ➔ ${destCity}): откройте мобильный GPS-трекер ${webTrackerLink} и нажмите «Начать рейс» (экран телефона не гаснет, трекер работает автоматически). Либо подтвердите через Telegram-бот @${botUsername}: ${botLink}`
  )}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(webTrackerLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Mark order in transit directly from map modal
  const handleMarkInTransit = async () => {
    if (!order?.id) return;
    try {
      await ordersApi.update(order.id, {
        status: 'dispatched',
        dispatchedAt: new Date().toISOString()
      });
      await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          lat: routeData?.currentLat || 43.2389,
          lng: routeData?.currentLng || 76.8897,
          speed: 0,
          status: 'dispatched'
        })
      });
      fetchLocationData();
    } catch (err) {
      console.warn("Error marking in transit:", err);
    }
  };

  const waypoints = routeData?.routeWaypoints || [
    { name: 'Алматы (Склад)', lat: 43.2389, lng: 76.8897, reached: true },
    { name: 'Балхаш', lat: 46.8481, lng: 74.9804, reached: (routeData?.progressPercent ?? 0) >= 40 },
    { name: 'Караганда', lat: 49.8019, lng: 73.1021, reached: (routeData?.progressPercent ?? 0) >= 75 },
    { name: destCity, lat: 51.1694, lng: 71.4491, reached: (routeData?.progressPercent ?? 0) >= 100 }
  ];

  return (
    <AnimatePresence>
      <div className={`fixed inset-0 z-50 overflow-y-auto bg-slate-900/90 backdrop-blur-md flex items-center justify-center ${isFullscreen ? 'p-2 sm:p-4' : 'p-3 sm:p-6'}`}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className={`bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full overflow-hidden space-y-5 transition-all ${
            isFullscreen ? 'max-w-none h-[96vh] flex flex-col p-6' : 'max-w-4xl p-5 sm:p-6 my-6'
          }`}
        >
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 text-white rounded-2xl shadow-md shadow-blue-500/20">
                <Navigation className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    🗺️ Интерактивная карта & GPS Мониторинг
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                    <span>GPS Active</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Заявка № <strong className="text-slate-700 dark:text-slate-200">{order.orderNumber}</strong> • Маршрут: <strong>Алматы ➔ {destCity}</strong>
                </p>
              </div>
            </div>

            {/* Actions & Tab buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-900 p-1 rounded-xl">
                <button
                  onClick={() => setActiveTab('map')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'map'
                      ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Карта Трассы</span>
                </button>
                <button
                  onClick={() => setActiveTab('telegram')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                    activeTab === 'telegram'
                      ? 'bg-white dark:bg-slate-800 text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Send className="w-3.5 h-3.5 text-blue-500" />
                  <span>Telegram-бот</span>
                </button>
              </div>

              {/* Standalone Window Button */}
              <button
                onClick={handleOpenStandaloneWindow}
                className="px-3 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
                title="Открыть большую карту в отдельном окне браузера"
              >
                <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                <span className="hidden sm:inline">В отдельном окне</span>
              </button>

              {/* Toggle Fullscreen Modal Button */}
              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
                title={isFullscreen ? "Свернуть в окно" : "Развернуть на весь экран"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4 text-amber-500" /> : <Maximize2 className="w-4 h-4 text-blue-500" />}
              </button>

              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ml-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {activeTab === 'map' ? (
            /* TAB 1: INTERACTIVE ROUTE MAP & ETA CALCULATOR */
            <div className="space-y-5">
              {/* ETA & Live Status Cards Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Distance & ETA */}
                <div className="p-4 bg-gradient-to-br from-blue-900 via-indigo-900 to-slate-900 text-white rounded-2xl border border-blue-700/50 shadow-lg relative overflow-hidden">
                  <div className="absolute right-3 top-3 opacity-10">
                    <Clock className="w-16 h-16 text-blue-300" />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-300">Расчетное Время Прибытия (ETA)</p>
                  <p className="text-2xl font-black mt-1 text-white">
                    {routeData?.etaFormatted || '~4 ч 30 мин'}
                  </p>
                  <p className="text-xs text-blue-200 mt-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span>Осталось {routeData?.remainingDistanceKm ?? 380} км (из {routeData?.totalDistanceKm ?? 1250} км)</span>
                  </p>
                </div>

                {/* Speed & Driver Info */}
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Водитель & Фура</span>
                    <span className="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-[10px] rounded-md flex items-center gap-1">
                      <Zap className="w-3 h-3 text-emerald-500" />
                      <span>{routeData?.speed ?? 75} км/ч</span>
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-blue-500" />
                      <span>{truckPlate}</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Водитель: <strong>{driverName}</strong>
                    </p>
                  </div>
                </div>

                {/* Speed & Driver Info */}
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Водитель & Фура</span>
                    <span className={`px-2 py-0.5 font-bold text-[10px] rounded-md flex items-center gap-1 ${
                      (routeData?.speed ?? 0) > 0 
                        ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' 
                        : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                    }`}>
                      <Zap className="w-3 h-3 text-emerald-500" />
                      <span>{(routeData?.speed ?? 0) > 0 ? `${routeData?.speed} км/ч` : 'Стоянка (0 км/ч)'}</span>
                    </span>
                  </div>
                  <div className="mt-2">
                    <p className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-1.5">
                      <Truck className="w-4 h-4 text-blue-500" />
                      <span>{truckPlate}</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Водитель: <strong>{driverName}</strong>
                    </p>
                  </div>
                </div>

                {/* Highway Route Summary */}
                <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Статус Рейса</span>
                    <span className={`text-xs font-bold ${
                      routeData?.signalStatus === 'in_transit' ? 'text-emerald-500' :
                      routeData?.signalStatus === 'parked' || routeData?.signalStatus === 'idle' ? 'text-amber-500' :
                      routeData?.signalStatus === 'offline' ? 'text-rose-500' : 'text-blue-500'
                    }`}>
                      {routeData?.progressPercent ?? 0}%
                    </span>
                  </div>
                  <div className="mt-2">
                    <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-emerald-500 h-full rounded-full transition-all duration-700" 
                        style={{ width: `${routeData?.progressPercent ?? 0}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex items-center justify-between">
                      <span>Алматы</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {routeData?.signalStatusText || 'Ожидание выезда'}
                      </span>
                      <span>{destCity}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Real OpenStreetMap (Leaflet) Interactive Map Container */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                    <Navigation className="w-4 h-4 text-blue-500" />
                    <span>Интерактивная карта OpenStreetMap (Трасса Казахстан)</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={whatsappShareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
                      title="Отправить водителю ссылку на GPS-трекер в WhatsApp"
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      <span>Отправить водителю в WhatsApp</span>
                    </a>
                    {order.status !== 'dispatched' && (
                      <button
                        onClick={handleMarkInTransit}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
                        title="Перевести статус заказа в 'В пути' и активировать трекинг"
                      >
                        <Truck className="w-3.5 h-3.5" />
                        <span>🚚 Отметить «В пути»</span>
                      </button>
                    )}
                    <button
                      onClick={fetchLocationData}
                      disabled={loading}
                      className="p-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl transition-colors"
                      title="Обновить координаты GPS"
                    >
                      <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                <LeafletRouteMap
                  currentLat={routeData?.currentLat ?? 46.8481}
                  currentLng={routeData?.currentLng ?? 74.9804}
                  originCity="Алматы"
                  destinationCity={destCity}
                  speed={routeData?.speed ?? 0}
                  heading={routeData?.heading ?? 0}
                  etaFormatted={routeData?.etaFormatted || 'Ожидает выезда'}
                  waypoints={waypoints}
                  detailedRoadPolyline={routeData?.detailedRoadPolyline}
                  locationHistory={routeData?.locationHistory}
                  truckPlate={truckPlate}
                  driverName={driverName}
                  lastPingSecondsAgo={routeData?.lastPingSecondsAgo ?? 0}
                  signalStatus={routeData?.signalStatus}
                  height={isFullscreen ? "h-[calc(96vh-320px)] min-h-[480px]" : "h-[380px]"}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      routeData?.signalStatus === 'in_transit' ? 'bg-emerald-500 animate-pulse' :
                      routeData?.signalStatus === 'parked' ? 'bg-emerald-400' :
                      routeData?.signalStatus === 'idle' ? 'bg-amber-400' :
                      routeData?.signalStatus === 'offline' ? 'bg-rose-500' :
                      'bg-slate-500'
                    }`} />
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {routeData?.signalStatusText || 'Ожидание сигнала GPS'}
                      {routeData?.lastPingSecondsAgo !== undefined && routeData?.lastPingSecondsAgo < 60 && ` (сигнал ${routeData.lastPingSecondsAgo} сек. назад)`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCopyLink}
                      className="px-2.5 py-1 bg-slate-200 dark:bg-slate-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-bold rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                      title="Скопировать ссылку на мобильный трекер для водителя"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>{copiedLink ? 'Скопировано! ✓' : 'Ссылка водителю'}</span>
                    </button>
                    <div className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                      GPS: {routeData?.currentLat ? routeData.currentLat.toFixed(5) : '—'}° N, {routeData?.currentLng ? routeData.currentLng.toFixed(5) : '—'}° E
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* TAB 2: TELEGRAM BOT INTEGRATION & CUSTOM BOT CONFIG */
            <div className="space-y-5 py-2">
              <div className="p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl flex items-start gap-3">
                <div className="p-2 bg-blue-600 text-white rounded-xl">
                  <Bot className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-blue-900 dark:text-blue-200">
                      Настройка Telegram-бота для водителей
                    </h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-md">
                      Гибкое имя бота
                    </span>
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Укажите юзернейм вашего текущего Telegram-бота. Водитель отправляет локацию в бота ➔ координаты автоматически попадают на карту CRM.
                  </p>
                </div>
              </div>

              {/* Bot Username Configuration Box */}
              <div className="p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-blue-500" />
                    <span>Юзернейм вашего Telegram-бота:</span>
                  </label>

                  {!isEditingBot ? (
                    <button
                      onClick={() => {
                        setTempBotInput(botUsername);
                        setIsEditingBot(true);
                      }}
                      className="px-2.5 py-1 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 rounded-lg transition-colors flex items-center gap-1"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Изменить бота</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => saveBotUsername(tempBotInput)}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Сохранить</span>
                      </button>
                      <button
                        onClick={() => setIsEditingBot(false)}
                        className="px-2 py-1 text-slate-500 text-xs font-medium"
                      >
                        Отмена
                      </button>
                    </div>
                  )}
                </div>

                {isEditingBot ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500">@</span>
                    <input
                      type="text"
                      value={tempBotInput}
                      onChange={(e) => setTempBotInput(e.target.value)}
                      placeholder="например: MyLogisticsDriverBot"
                      className="flex-1 px-3 py-2 bg-white dark:bg-slate-800 border border-blue-400 rounded-xl text-xs font-mono font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none dark:text-white"
                    />
                  </div>
                ) : (
                  <div className="px-3.5 py-2.5 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <span className="text-sm font-mono font-black text-blue-600 dark:text-blue-400">
                      @{botUsername}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Используется для генерации прямых ссылок водителям
                    </span>
                  </div>
                )}
              </div>

              {/* METHOD 1: DIRECT MOBILE GPS TRACKER (NO INSTALLATION / 100% RELIABLE) */}
              <div className="p-5 bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-white rounded-2xl border border-emerald-500/40 shadow-xl space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-emerald-500 text-slate-950 rounded-xl shadow-md">
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black text-white">
                          Способ 1: Мобильный Веб-Трекер (Рекомендуется)
                        </h4>
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full text-[10px] font-bold">
                          Без установки
                        </span>
                      </div>
                      <p className="text-xs text-emerald-200/80 mt-0.5">
                        Водитель просто открывает ссылку на телефоне и нажимает зеленую кнопку. Телефон автоматически транслирует движение каждые 3 сек.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-emerald-500/20 font-mono text-xs text-emerald-300 break-all select-all flex items-center justify-between gap-2">
                  <span>{webTrackerLink}</span>
                  <button
                    onClick={handleCopyLink}
                    className="shrink-0 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copiedLink ? 'Скопировано! ✓' : 'Копировать'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <a
                    href={whatsappShareUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Отправить водителю в WhatsApp</span>
                  </a>

                  <a
                    href={webTrackerLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
                  >
                    <span>Открыть трекер</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                  </a>
                </div>
              </div>

              {/* METHOD 2: TELEGRAM BOT INTEGRATION */}
              <div className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-2xl border border-slate-700 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-blue-600 text-white rounded-xl shadow-md">
                      <Send className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-black text-white">
                          Способ 2: Telegram-бот @{botUsername}
                        </h4>
                        <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-full text-[10px] font-bold">
                          Telegram API
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Водитель подключается к боту для отправки геолокации.
                      </p>
                    </div>
                  </div>

                  <a
                    href={botLink}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-xs shadow-md transition-all flex items-center gap-1.5 active:scale-95 shrink-0"
                  >
                    <span>Открыть бота</span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                  </a>
                </div>

                {/* Telegram Bot Instructions Box */}
                <div className="p-3.5 bg-blue-950/60 border border-blue-800/80 rounded-xl text-xs text-blue-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-blue-300">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Автоматическое GPS-отслеживание через Telegram:</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-300">
                    Водителю не нужно ничего настраивать вручную. В боте @{botUsername} он просто выбирает рейс и нажимает <strong>«📍 Разрешить геопозицию и начать рейс»</strong>. Слежка по трассе включается автоматически и идет непрерывно до нажатия кнопки «Груз доставлен».
                  </p>
                </div>
              </div>

            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-500" />
              <span>Расчет времени прибытия производится на основе реальной скорости автотранспорта.</span>
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors"
            >
              Закрыть
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
