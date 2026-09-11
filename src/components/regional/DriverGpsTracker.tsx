import React, { useState, useEffect, useRef } from 'react';
import { 
  Navigation, 
  MapPin, 
  ShieldCheck, 
  AlertTriangle, 
  Truck, 
  Send, 
  Clock, 
  ExternalLink,
  Smartphone,
  CheckCircle2,
  Check,
  X,
  Radio
} from 'lucide-react';

export const DriverGpsTracker: React.FC = () => {
  const [orderId, setOrderId] = useState<string>('all');
  const [orderDetails, setOrderDetails] = useState<{
    orderNumber?: string;
    destinationCity?: string;
    originCity?: string;
    status?: string;
    remainingDistanceKm?: number;
  } | null>(null);

  const [isTracking, setIsTracking] = useState<boolean>(false);
  const [currentLat, setCurrentLat] = useState<number | null>(null);
  const [currentLng, setCurrentLng] = useState<number | null>(null);
  const [speed, setSpeed] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [pointsSent, setPointsSent] = useState<number>(0);
  const [lastSentTime, setLastSentTime] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState<boolean>(false);
  const [isDelivered, setIsDelivered] = useState<boolean>(false);
  const [showConfirmDelivery, setShowConfirmDelivery] = useState<boolean>(false);
  const [completing, setCompleting] = useState<boolean>(false);

  const watchIdRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);
  const lastPosRef = useRef<{ lat: number; lng: number; time: number } | null>(null);

  // Read order ID from URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderParam = params.get('order') || params.get('id') || 'all';
    setOrderId(orderParam);

    // Fetch initial order metadata
    const fetchOrderMeta = async () => {
      try {
        const res = await fetch(`/api/driver/trip/${encodeURIComponent(orderParam)}`);
        if (res.ok) {
          const data = await res.json();
          setOrderDetails({
            orderNumber: data.orderNumber || orderParam,
            destinationCity: data.destinationCity,
            originCity: data.originCity,
            status: data.status
          });
          if (data.status === 'delivered') {
            setIsDelivered(true);
          }
        }
      } catch (e) {
        // Continue with URL param
      }
    };
    fetchOrderMeta();
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

  // Send real coordinates directly to backend
  const sendLocation = async (lat: number, lng: number, spdKmh: number, heading?: number | null, acc?: number | null) => {
    try {
      const res = await fetch('/api/driver/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderNumber: orderDetails?.orderNumber || orderId,
          lat,
          lng,
          speed: spdKmh,
          heading: heading !== null && heading !== undefined ? Math.round(heading) : undefined,
          accuracy: acc !== null && acc !== undefined ? Math.round(acc) : undefined,
          status: 'dispatched',
          driverPhone: 'Мобильный Веб-Трекер'
        })
      });

      if (res.ok) {
        setPointsSent(prev => prev + 1);
        setLastSentTime(new Date().toLocaleTimeString());
        setErrorMsg(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error || 'Сервер не принял GPS.');
        if ([403, 404, 409].includes(res.status)) stopTracking();
      }
    } catch (err: any) {
      setErrorMsg("Ошибка связи с сервером CRM. Проверьте интернет-соединение.");
    }
  };

  // Start continuous GPS tracking
  const startTracking = () => {
    if (watchIdRef.current !== null || isDelivered) return;
    if (!window.isSecureContext) {
      setErrorMsg('Для GPS откройте трекер по защищённой HTTPS-ссылке или используйте трансляцию в Telegram.');
      return;
    }
    if (!navigator.geolocation) {
      setErrorMsg("Ваш мобильный браузер не поддерживает GPS геолокацию.");
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
      const now = Date.now();
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
        const dtSeconds = Math.max(1, (now - lastPosRef.current.time) / 1000);
        
        if (distKm > 0.01) {
          spdKmh = Math.min(120, Math.round((distKm / (dtSeconds / 3600))));
        } else {
          spdKmh = 0; // Standing still
        }
      }
      setSpeed(spdKmh);
      lastPosRef.current = { lat: latitude, lng: longitude, time: now };

      sendLocation(latitude, longitude, spdKmh, heading, acc);
    };

    const handleError = (err: GeolocationPositionError) => {
      let msg = "Ошибка GPS: ";
      if (err.code === 1) msg += "Пожалуйста, разрешите доступ к геолокации в настройках браузера.";
      else if (err.code === 2) msg += "Сигнал GPS потерян. Убедитесь, что GPS (Геопозиция) включен в телефоне.";
      else if (err.code === 3) msg += "Поиск спутников GPS...";
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

  // Complete delivery
  const handleConfirmCompleteDelivery = async () => {
    setCompleting(true);
    try {
      const res = await fetch('/api/driver/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          orderNumber: orderDetails?.orderNumber || orderId
        })
      });

      if (res.ok) {
        stopTracking();
        setIsDelivered(true);
        setShowConfirmDelivery(false);
      } else {
        setErrorMsg("Не удалось завершить рейс на сервере. Попробуйте еще раз.");
      }
    } catch (e) {
      setErrorMsg("Ошибка сети при завершении рейса.");
    } finally {
      setCompleting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      releaseWakeLock();
    };
  }, []);

  if (isDelivered) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 font-sans select-none">
        <div className="w-full max-w-md bg-slate-900 border border-emerald-500/40 rounded-3xl p-8 text-center space-y-5 shadow-2xl">
          <div className="w-20 h-20 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto border border-emerald-500/40">
            <CheckCircle2 className="w-12 h-12" />
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Рейс завершен</span>
            <h1 className="text-2xl font-black mt-1 text-white">Груз успешно доставлен!</h1>
            <p className="text-sm text-slate-400 mt-2">
              Рейс <strong className="text-amber-400 font-mono">{orderDetails?.orderNumber || orderId}</strong> отмечен как выполненный в системе CRM.
            </p>
            {orderDetails?.destinationCity && (
              <p className="text-xs text-slate-500 mt-1">
                Пункт назначения: <strong>{orderDetails.destinationCity}</strong>
              </p>
            )}
          </div>
          <div className="p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs text-slate-300">
            ✅ GPS-отслеживание рейса остановлено.<br />
            Спасибо за безопасную доставку! 🚛✨
          </div>
        </div>
      </div>
    );
  }

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
                РЕАЛЬНЫЙ GPS
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              {orderDetails?.destinationCity ? `${orderDetails.originCity || 'Алматы'} ➔ ${orderDetails.destinationCity}` : 'Мониторинг движения фуры'}
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] uppercase font-bold text-slate-400">Рейс</span>
          <p className="text-sm font-black text-amber-400 font-mono">{(orderDetails?.orderNumber || orderId).toUpperCase()}</p>
        </div>
      </div>

      {/* Main Center Display */}
      <div className="w-full max-w-md my-auto py-4 space-y-5">
        {/* Speedometer Gauge & Status Circle */}
        <div className="relative flex flex-col items-center justify-center p-7 bg-gradient-to-b from-slate-900 to-slate-900/60 rounded-3xl border border-slate-800 shadow-2xl overflow-hidden">
          {/* Pulsing Radar when Tracking */}
          {isTracking && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 rounded-full border border-emerald-500/20 animate-ping" />
              <div className="w-48 h-48 rounded-full border border-emerald-500/30 animate-pulse" />
            </div>
          )}

          <div className="relative text-center">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              {isTracking ? "Фактическая скорость по GPS" : "GPS Остановлен"}
            </span>
            <div className="text-6xl sm:text-7xl font-black text-white tracking-tighter my-2 font-mono flex items-baseline justify-center">
              <span>{isTracking ? speed : 0}</span>
              <span className="text-xl font-bold text-slate-500 ml-1">км/ч</span>
            </div>

            <div className="flex items-center justify-center gap-2 mt-2">
              <span className={`w-3 h-3 rounded-full ${isTracking ? (speed > 5 ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400 animate-pulse') : 'bg-slate-600'}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${isTracking ? (speed > 5 ? 'text-emerald-400' : 'text-amber-400') : 'text-slate-400'}`}>
                {isTracking ? (speed > 5 ? "🟢 В ДВИЖЕНИИ (GPS ПЕРЕДАЁТСЯ)" : "🟡 НА СВЯЗИ (СТОЯНКА)") : "⚪ Ожидание выезда"}
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
              {wakeLockActive ? '📱 Экран не гаснет' : 'Обычный режим'}
            </span>
          </div>
        </div>

        {/* Current Coordinates Display */}
        {currentLat !== null && currentLng !== null && (
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

        {/* ACTION BUTTONS */}
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Сначала выберите рейс и дайте согласие в Telegram-боте. Веб-трекер работает при открытой активной странице. Для работы в фоне включите трансляцию геопозиции в Telegram.</p>
          {!isTracking ? (
            <button
              onClick={startTracking}
              className="w-full py-5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-base uppercase tracking-wider rounded-2xl shadow-xl shadow-emerald-900/40 active:scale-95 transition-all flex items-center justify-center gap-3 cursor-pointer"
            >
              <Navigation className="w-6 h-6 fill-current animate-bounce" />
              <span>НАЧАТЬ РЕЙС И ВКЛЮЧИТЬ GPS</span>
            </button>
          ) : (
            <div className="space-y-2">
              <button
                onClick={stopTracking}
                className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm uppercase tracking-wider rounded-2xl border border-slate-700 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>ПАУЗА В ПУТИ</span>
              </button>

              <button
                onClick={() => setShowConfirmDelivery(true)}
                className="w-full py-4 bg-gradient-to-r from-rose-600 to-red-700 hover:from-rose-500 hover:to-red-600 text-white font-black text-base uppercase tracking-wider rounded-2xl shadow-xl shadow-red-900/40 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>🏁 ЗАВЕРШИТЬ РЕЙС (ГРУЗ ДОСТАВЛЕН)</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmDelivery && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-sm w-full p-6 space-y-4 text-center">
            <div className="w-14 h-14 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto border border-amber-500/40">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Завершить рейс?</h3>
              <p className="text-xs text-slate-400 mt-1">
                Вы подтверждаете, что груз по рейсу <strong>{orderDetails?.orderNumber || orderId}</strong> доставлен в пункт назначения{orderDetails?.destinationCity ? ` (${orderDetails.destinationCity})` : ''}?
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => setShowConfirmDelivery(false)}
                disabled={completing}
                className="py-3 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition-all"
              >
                Отмена
              </button>
              <button
                onClick={handleConfirmCompleteDelivery}
                disabled={completing}
                className="py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-900/40 transition-all flex items-center justify-center gap-1.5"
              >
                {completing ? 'Завершение...' : 'Да, доставлен'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Driver Instructions Guide */}
      <div className="w-full max-w-md bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4 text-xs text-slate-400 space-y-2">
        <div className="flex items-center gap-2 text-slate-200 font-bold">
          <Smartphone className="w-4 h-4 text-emerald-400" />
          <span>Памятка для водителя в дороге:</span>
        </div>
        <p className="leading-relaxed">
          1. Нажмите <strong>«НАЧАТЬ РЕЙС И ВКЛЮЧИТЬ GPS»</strong> и разрешите доступ к геопозиции в окне браузера.
        </p>
        <p className="leading-relaxed">
          2. Закрепите телефон в держатель на панели авто. Экран останется включенным, а координаты и реальная скорость будут передаваться каждые 3–5 секунд.
        </p>
        <p className="leading-relaxed">
          3. По прибытии на склад нажмите <strong>«ЗАВЕРШИТЬ РЕЙС»</strong>.
        </p>
      </div>
    </div>
  );
};
