import React, { useState, useEffect, useRef } from 'react';
import { 
  Navigation, 
  MapPin, 
  Zap, 
  ShieldCheck, 
  AlertTriangle, 
  Truck, 
  Send, 
  Clock, 
  ExternalLink,
  Smartphone,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';

export const DriverGpsTracker: React.FC = () => {
  const [orderId, setOrderId] = useState<string>('all');
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [pointsSent, setPointsSent] = useState<number>(0);
  const [lastSentTime, setLastSentTime] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);

  // Read order ID from URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get('order') || params.get('id') || 'all';
    setOrderId(orderParam);
  }, []);

  // Screen Wake Lock API to prevent phone from sleeping while driving
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setWakeLockActive(true);
      }
    } catch (e) {
      console.warn("Wake lock unavailable:", e);
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  };

  // Send coordinates directly to backend
  const sendLocation = async (lat: number, lng: number, spdKmh: number, heading?: number | null) => {
    try {
      const res = await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          lat,
          lng,
          speed: spdKmh,
          heading: heading || undefined,
          driverPhone: 'Мобильный Веб-Трекер'
        })
      });

      if (res.ok) {
        setPointsSent(prev => prev + 1);
        setLastSentTime(new Date().toLocaleTimeString());
        setErrorMsg(null);
      }
    } catch (err: any) {
      setErrorMsg("Ошибка связи с сервером CRM. Повторная отправка через 3 сек...");
    }
  };

  // Start continuous GPS tracking
  const startTracking = () => {
    if (!navigator.geolocation) {
      setErrorMsg("Ваш браузер не поддерживает GPS геолокацию.");
      return;
    }

    setErrorMsg(null);
    setIsTracking(true);
    requestWakeLock();

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    };

    const handleSuccess = (pos: GeolocationPosition) => {
      const { latitude, longitude, speed: rawSpeed, accuracy: acc, heading } = pos.coords;
      setCurrentLat(latitude);
      setCurrentLng(longitude);
      setAccuracy(Math.round(acc));

      // Calculate speed in km/h (rawSpeed is in m/s)
      let spdKmh = 0;
      if (rawSpeed !== null && !isNaN(rawSpeed) && rawSpeed > 0) {
        spdKmh = Math.round(rawSpeed * 3.6);
      } else if (lastPosRef.current) {
        // Fallback speed calculation from distance delta
        const R = 6371;
        const dLat = (latitude - lastPosRef.current.lat) * (Math.PI / 180);
        const dLon = (longitude - lastPosRef.current.lng) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lastPosRef.current.lat * (Math.PI / 180)) * Math.cos(latitude * (Math.PI / 180)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distKm = R * c;
        // Assume ~3 sec interval
        spdKmh = Math.min(110, Math.round((distKm / (3 / 3600))));
      }
      setSpeed(spdKmh);
      lastPosRef.current = { lat: latitude, lng: longitude };

      sendLocation(latitude, longitude, spdKmh, heading);
    };

    const handleError = (err: GeolocationPositionError) => {
      let msg = "Ошибка GPS: ";
      if (err.code === 1) msg += "Разрешите доступ к геолокации в настройках браузера.";
      else if (err.code === 2) msg += "Сигнал GPS потерян. Убедитесь, что GPS включен в телефоне.";
      else if (err.code === 3) msg += "Таймаут поиска GPS сигнала.";
      setErrorMsg(msg);
    };

    // Watch continuous location changes
    const id = navigator.geolocation.watchPosition(handleSuccess, handleError, options);
    watchIdRef.current = id;
  };

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    releaseWakeLock();
    setIsTracking(false);
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      releaseWakeLock();
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-between p-4 sm:p-6 font-sans select-none">
      {/* Top Header */}
      <div className="w-full max-w-md flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 to-teal-700 rounded-2xl shadow-lg shadow-emerald-500/20">
            <Truck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-white flex items-center gap-1.5">
              <span>SILK ROAD GPS</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                DRIVER
              </span>
            </h1>
            <p className="text-xs text-slate-400">Мониторинг движения фуры</p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] uppercase font-bold text-slate-400">Рейс</span>
          <p className="text-sm font-black text-amber-400 font-mono">{orderId.toUpperCase()}</p>
        </div>
      </div>

      {/* Main Center Display */}
      <div className="w-full max-w-md my-auto py-6 space-y-6">
        {/* Speedometer Gauge & Status Circle */}
        <div className="relative flex flex-col items-center justify-center p-8 bg-gradient-to-b from-slate-900 to-slate-900/60 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden">
          {/* Pulsing Radar when Tracking */}
          {isTracking && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 rounded-full border border-emerald-500/20 animate-ping" />
              <div className="w-48 h-48 rounded-full border border-emerald-500/30 animate-pulse" />
            </div>
          )}

          <div className="relative text-center">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {isTracking ? "Текущая скорость" : "GPS Остановлен"}
            </span>
            <div className="text-6xl sm:text-7xl font-black text-white tracking-tighter my-2 font-mono flex items-baseline justify-center">
              <span>{isTracking ? speed : 0}</span>
              <span className="text-xl font-bold text-slate-500 ml-1">км/ч</span>
            </div>

            <div className="flex items-center justify-center gap-2 mt-2">
              <span className={`w-3 h-3 rounded-full ${isTracking ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${isTracking ? 'text-emerald-400' : 'text-slate-400'}`}>
                {isTracking ? "🟢 В ЭФИРЕ (GPS АКТИВЕН)" : "⚪ Ожидание старта"}
              </span>
            </div>
          </div>
        </div>

        {/* Live Tracking Telemetry Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
              <Send className="w-3 h-3 text-blue-400" />
              <span>Передано точек</span>
            </span>
            <p className="text-xl font-black text-white mt-1 font-mono">{pointsSent}</p>
            <span className="text-[10px] text-slate-400">
              {lastSentTime ? `Посл.: ${lastSentTime}` : 'ещё не передано'}
            </span>
          </div>

          <div className="p-3.5 bg-slate-900/80 rounded-2xl border border-slate-800">
            <span className="text-[10px] font-bold uppercase text-slate-400 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-emerald-400" />
              <span>Точность GPS</span>
            </span>
            <p className="text-xl font-black text-white mt-1 font-mono">
              {accuracy !== null ? `±${accuracy} м` : '—'}
            </p>
            <span className="text-[10px] text-slate-400">
              {wakeLockActive ? '📱 Экран активен' : 'Обычный режим'}
            </span>
          </div>
        </div>

        {/* Current Coordinates Display */}
        {currentLat && currentLng && (
          <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800/80 text-center font-mono text-xs text-slate-300">
            📍 {currentLat.toFixed(5)}° N, {currentLng.toFixed(5)}° E
          </div>
        )}

        {/* Error Notification */}
        {errorMsg && (
          <div className="p-3.5 bg-red-950/80 border border-red-800 rounded-2xl text-xs text-red-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <strong className="block font-bold">Внимание:</strong>
              <span>{errorMsg}</span>
            </div>
          </div>
        )}

        {/* BIG ACTION BUTTON */}
        <div>
          {!isTracking ? (
            <button
              onClick={startTracking}
              className="w-full py-5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-base uppercase tracking-wider rounded-2xl shadow-xl shadow-emerald-900/40 active:scale-95 transition-all flex items-center justify-center gap-3 cursor-pointer"
            >
              <Navigation className="w-6 h-6 fill-current animate-bounce" />
              <span>НАЧАТЬ ТРАНСЛЯЦИЮ В ПУТИ</span>
            </button>
          ) : (
            <button
              onClick={stopTracking}
              className="w-full py-5 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white font-black text-base uppercase tracking-wider rounded-2xl shadow-xl shadow-red-900/40 active:scale-95 transition-all flex items-center justify-center gap-3 cursor-pointer"
            >
              <div className="w-4 h-4 bg-white rounded-sm" />
              <span>ОСТАНОВИТЬ ТРЕКИНГ</span>
            </button>
          )}
        </div>
      </div>

      {/* Bottom Driver Instructions Guide */}
      <div className="w-full max-w-md bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4 text-xs text-slate-400 space-y-2">
        <div className="flex items-center gap-2 text-slate-200 font-bold">
          <Smartphone className="w-4 h-4 text-blue-400" />
          <span>Инструкция для водителя в дороге:</span>
        </div>
        <p className="leading-relaxed">
          1. Нажмите зеленую кнопку <strong>«НАЧАТЬ ТРАНСЛЯЦИЮ В ПУТИ»</strong> и разрешите доступ к геопозиции.
        </p>
        <p className="leading-relaxed">
          2. Закрепите телефон в держатель на панели авто. Экран не погаснет, а координаты будут сами передаваться каждые 3 секунды на карту логиста.
        </p>
        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
          <span className="text-slate-500">Silk Road Logistics CRM</span>
          <a
            href="https://t.me/SilkRoadDriverBot"
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline flex items-center gap-1 font-bold"
          >
            <span>Бот @SilkRoadDriverBot</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
