import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { ordersApi } from '../../services/api';
import { subscribeToGpsOrder } from '../../services/firestore-collections';
import { LeafletRouteMap } from './LeafletRouteMap';
import { RegionalTruckOrder } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { firebaseFetch } from '../../services/firebase-fetch';
import { ageGpsSignal } from '../../../shared/gps-projection';



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
  hasRealGps?: boolean;
  isTrackingActive?: boolean;
  driverConsent?: boolean;
  liveLocationExpiresAt?: string;
  routeStatus?: 'waiting' | 'building' | 'road' | 'approximate';
}

export const RouteMapModal: React.FC<RouteMapModalProps> = ({ isOpen, onClose, order }) => {
  const { isAdmin } = useAuth();
  return isAdmin ? <AdminRouteMapModal isOpen={isOpen} onClose={onClose} order={order} /> : null;
};

const AdminRouteMapModal: React.FC<RouteMapModalProps> = ({ isOpen, onClose, order }) => {
  const { refreshSession } = useAuth();
  const [activeTab, setActiveTab] = useState<'map' | 'telegram'>('map');
  const [loading, setLoading] = useState<boolean>(false);
  const [storedRouteData, setRouteData] = useState<RouteData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  const [botStatus, setBotStatus] = useState<{ username: string; configured: boolean; running: boolean; lastError?: string; lastPollAt?: string } | null>(null);
  const [requestError, setGpsError] = useState<string | null>(null);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);
  const gpsError = requestError || firestoreError;
  const requestRef = useRef<AbortController | null>(null);
  const pendingRefresh = useRef(false);
  const [now, setNow] = useState(Date.now);
  const routeData = ageGpsSignal(storedRouteData, now);
  const botUsername = botStatus?.username || 'SilkRoadDriverBot';

  const handleOpenStandaloneWindow = () => {
    if (order) window.open('/gps-map?order=' + encodeURIComponent(order.id), '_blank', 'noopener,noreferrer,width=1280,height=800');
  };

  const fetchLocationData = useCallback(async () => {
    if (!order?.id) return;
    if (requestRef.current) { pendingRefresh.current = true; return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const res = await firebaseFetch('/api/driver/location/' + encodeURIComponent(order.id), { signal: controller.signal, cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setRouteData(null);
        void refreshSession();
        throw new Error('GPS-мониторинг доступен только администратору.');
      }
      if (!res.ok) throw new Error('Не удалось получить GPS рейса. Проверьте соединение с сервером.');
      const data = await res.json();
      if (!controller.signal.aborted) { setRouteData(data); setGpsError(null); }
    } catch (error) {
      if (!controller.signal.aborted) setGpsError(error instanceof Error ? error.message : 'Нет связи с сервером GPS');
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted) {
        setLoading(false);
        if (pendingRefresh.current) { pendingRefresh.current = false; void fetchLocationData(); }
      }
    }
  }, [order?.id, refreshSession]);

  useEffect(() => {
    if (!isOpen || !order?.id) return;
    setRouteData(null);
    setFirestoreError(null);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void fetchLocationData(), 50);
    };
    void fetchLocationData();
    let disposed = false;
    const fetchBotStatus = () => firebaseFetch('/api/driver/bot-status').then(r => r.json()).then(data => {
      if (!disposed) setBotStatus(data);
    }).catch(() => {});
    void fetchBotStatus();
    const stopGps = subscribeToGpsOrder(order.id, refresh, error => setFirestoreError(error.message));
    // Recompute signal age locally; no permanent HTTP stream or GPS polling server.
    const interval = setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('online', refresh);
    return () => {
      disposed = true;
      requestRef.current?.abort();
      requestRef.current = null;
      pendingRefresh.current = false;
      clearTimeout(refreshTimer);
      clearInterval(interval);
      stopGps();
      window.removeEventListener('online', refresh);
    };
  }, [isOpen, order?.id, order?.orderNumber, fetchLocationData]);

  if (!isOpen || !order) return null;

  const destCity = order.destinationCity || 'Астана';
  const lastPingAge = routeData?.updatedAt ? Math.max(0, Math.round((now - Date.parse(routeData.updatedAt)) / 1000)) : undefined;
  const isFreshGps = !gpsError && routeData?.isTrackingActive && lastPingAge !== undefined && lastPingAge <= 120;
  const driverName = order.assignedDriver || 'Не назначен';
  const truckPlate = order.assignedTruckPlate || 'Не указан';
  const botLink = `https://t.me/${botUsername}?start=${encodeURIComponent(order.id)}`;
  const driverPhoneClean = ((order as any).driverPhone || order.recipientPhone || order.assignedDriver || '').replace(/[^0-9]/g, '');
  const whatsappShareUrl = `https://wa.me/${driverPhoneClean}?text=${encodeURIComponent(
    `Здравствуйте! Откройте ${botLink}, выберите рейс ${order.orderNumber}, подтвердите согласие и включите трансляцию геопозиции через скрепку → Геопозиция. После доставки нажмите «Завершить рейс».`
  )}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(botLink);
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
      fetchLocationData();
    } catch (err) {
      console.warn("Error marking in transit:", err);
    }
  };

  const waypoints = routeData?.routeWaypoints || [];

  return (
    <AnimatePresence>
      <div className={`fixed inset-0 z-50 overflow-y-auto bg-slate-900/90 backdrop-blur-md flex items-start justify-center ${isFullscreen ? 'p-2 sm:p-4' : 'p-3 sm:p-6'}`}>
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
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border flex items-center gap-1 ${isFreshGps ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' : 'bg-amber-500/15 text-amber-600 border-amber-500/30'}`}>
                    <span className={`w-2 h-2 rounded-full ${isFreshGps ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                    <span>{gpsError ? 'Нет связи' : routeData?.signalStatus === 'delivered' ? 'Рейс завершён' : routeData?.isTrackingActive && ['parked', 'in_transit'].includes(routeData.signalStatus || '') ? 'GPS на связи' : 'Ожидание GPS'}</span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Заявка № <strong className="text-slate-700 dark:text-slate-200">{order.orderNumber}</strong> • Маршрут: <strong>{routeData?.originCity || 'Ожидание GPS'} ➔ {destCity}</strong>
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

          {gpsError && <p role="alert" className="text-sm text-rose-600">{gpsError}</p>}
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
                    {routeData?.etaFormatted || 'Ожидание GPS'}
                  </p>
                  <p className="text-xs text-blue-200 mt-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    <span>Осталось {routeData?.remainingDistanceKm ?? '—'} км (из {routeData?.totalDistanceKm ?? '—'} км)</span>
                  </p>
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
                      <span>{!isFreshGps ? 'Нет свежего GPS' : (routeData?.speed ?? 0) > 0 ? `${routeData?.speed} км/ч` : 'Стоянка (0 км/ч)'}</span>
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
                      <span>{routeData?.originCity || 'Ожидание GPS'}</span>
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
                    {!['dispatched', 'delivered', 'cancelled'].includes(order.status) && routeData?.signalStatus !== 'delivered' && (
                      <button
                        onClick={handleMarkInTransit}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
                        title="Отметить выезд. GPS поступит после отправки геопозиции водителем"
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
                  currentLat={routeData?.currentLat ?? 43.2389}
                  currentLng={routeData?.currentLng ?? 76.8897}
                  originCity={routeData?.originCity || 'Ожидание GPS'}
                  destinationCity={destCity}
                  speed={routeData?.speed ?? 0}
                  heading={routeData?.heading ?? 0}
                  etaFormatted={routeData?.etaFormatted || 'Ожидает выезда'}
                  waypoints={waypoints}
                  detailedRoadPolyline={routeData?.detailedRoadPolyline || []}
                  locationHistory={routeData?.locationHistory}
                  truckPlate={truckPlate}
                  driverName={driverName}
                  lastPingSecondsAgo={lastPingAge ?? 0}
                  signalStatus={routeData?.signalStatus}
                  signalStatusText={routeData?.signalStatusText}
                  height={isFullscreen ? "h-[calc(96vh-320px)] min-h-[480px]" : "h-[380px]"}
                  hasRealGps={routeData?.hasRealGps}
                  isTrackingActive={routeData?.isTrackingActive}
                  driverConsent={routeData?.driverConsent}
                />

                <p className="text-xs text-slate-500" role="status">
                  {routeData?.routeStatus === 'building' ? 'Строится путь по дорогам от первой GPS-точки машины до города назначения…' :
                    routeData?.routeStatus === 'approximate' ? 'Путь по дорогам временно недоступен. Пунктир показывает ориентировочное направление от старта GPS.' :
                    routeData?.routeStatus === 'road' ? 'Старт маршрута — первая GPS-точка рейса. Зелёная линия — полученная история движения.' :
                    'Маршрут появится после первой геопозиции машины.'}
                </p>

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
                      GPS: {routeData?.hasRealGps ? `${routeData.currentLat.toFixed(5)}°, ${routeData.currentLng.toFixed(5)}°` : 'Ожидание сигнала'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm text-slate-700 dark:text-slate-200">
              <div className="rounded-2xl bg-blue-50 dark:bg-slate-900 p-5 space-y-3">
                <h4 className="font-bold">Отслеживание через Telegram @{botUsername}</h4>
                <ol className="list-decimal pl-5 space-y-2">
                  <li>Водитель открывает бота, выбирает заявку и подтверждает согласие на GPS.</li>
                  <li>Через 📎 → «Геопозиция» включает «Транслировать геопозицию». Для долгого рейса выбирает «Пока не отключу», если доступно, либо продлевает трансляцию.</li>
                  <li>Координаты и время последнего сигнала появляются на карте логиста. Telegram должен иметь разрешение на геопозицию в фоне.</li>
                  <li>После доставки водитель нажимает «Завершить рейс». Приём новых координат этой заявки прекращается.</li>
                </ol>
                <p>Разовая геопозиция отображается как последняя точка и не обновляется автоматически.</p>
              </div>
              <p role="status">{!botStatus ? 'Проверка подключения бота…' : botStatus.lastError ||
                (!botStatus.configured ? 'Бот не настроен на сервере.' : !botStatus.running ? 'Приём сообщений Telegram отключён на этом сервере.' :
                  botStatus.lastPollAt ? 'Бот подключён к Telegram.' : 'Подключение к Telegram…')}</p>
              <div className="flex flex-wrap gap-3">
                <a href={botLink} target="_blank" rel="noreferrer" className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white">Открыть бота для этого рейса</a>
                <button onClick={handleCopyLink} className="rounded-xl bg-slate-200 dark:bg-slate-700 px-4 py-3">{copiedLink ? 'Ссылка скопирована' : 'Копировать ссылку водителю'}</button>
              </div>
              <p className="text-xs text-slate-500">Геопозиция поступает через Telegram в Firebase даже при закрытой CRM. Завершайте рейс в том же боте под аккаунтом водителя.</p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-500" />
              <span>Время прибытия ориентировочное. Координаты обновляются по сигналам телефона водителя.</span>
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

export const StandaloneRouteMap: React.FC = () => {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <div className="p-8 text-center"><h1 className="text-lg font-bold">Доступ ограничен</h1><p className="my-4">GPS-мониторинг доступен только администратору.</p><a href="/" className="text-blue-600 underline">Вернуться в CRM</a></div>;
  return <AdminStandaloneRouteMap />;
};

const AdminStandaloneRouteMap: React.FC = () => {
  const [order, setOrder] = useState<RegionalTruckOrder | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('order');
    if (!id) { setError('Не выбрана заявка.'); return; }
    ordersApi.getById(id).then(setOrder).catch(() => setError('Не удалось открыть заявку.'));
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!order) return <p>Загрузка карты…</p>;
  return <RouteMapModal isOpen order={order} onClose={() => window.close()} />;
};
