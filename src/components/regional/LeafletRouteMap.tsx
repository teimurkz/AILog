import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { KAZAKHSTAN_ROADS } from '../../utils/kazakhstanRoads';

export interface LocationPoint {
  lat: number;
  lng: number;
  timestamp?: string;
}

interface LeafletRouteMapProps {
  currentLat: number;
  currentLng: number;
  originCity: string;
  destinationCity: string;
  speed: number;
  heading?: number;
  etaFormatted: string;
  waypoints: Array<{ name: string; lat: number; lng: number; reached: boolean }>;
  detailedRoadPolyline?: LocationPoint[];
  locationHistory?: LocationPoint[];
  truckPlate?: string;
  driverName?: string;
  lastPingSecondsAgo?: number;
  signalStatus?: string;
  height?: string;
  hasRealGps?: boolean;
  isTrackingActive?: boolean;
  driverConsent?: boolean;
}

export const LeafletRouteMap: React.FC<LeafletRouteMapProps> = ({
  currentLat,
  currentLng,
  originCity,
  destinationCity,
  speed,
  heading = 0,
  etaFormatted,
  waypoints,
  detailedRoadPolyline,
  locationHistory,
  truckPlate = 'Госномер не указан',
  driverName = 'Водитель не назначен',
  lastPingSecondsAgo = 0,
  signalStatus = 'in_transit',
  height = "h-[360px]",
  hasRealGps = false,
  isTrackingActive = false,
  driverConsent = false,
}) => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const isFirstRenderRef = useRef<boolean>(true);

  // Persistent layer references to prevent re-creating and flickering
  const highwayPolylineRef = useRef<L.Polyline | null>(null);
  const trajectoryPolylineRef = useRef<L.Polyline | null>(null);
  const dotsGroupRef = useRef<L.LayerGroup | null>(null);
  const waypointsGroupRef = useRef<L.LayerGroup | null>(null);
  const truckMarkerRef = useRef<L.Marker | null>(null);
  const currentDestRef = useRef<string>('');

  // 1. Map Initialization & Static Layers Setup
  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapRef.current, {
        center: [currentLat, currentLng],
        zoom: 6,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      // Create LayerGroups for dots & waypoints
      const dotsGroup = L.layerGroup().addTo(map);
      const waypointsGroup = L.layerGroup().addTo(map);
      dotsGroupRef.current = dotsGroup;
      waypointsGroupRef.current = waypointsGroup;

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // If destination city changed, rebuild highway polyline and static waypoint markers
    if (currentDestRef.current !== destinationCity || !highwayPolylineRef.current) {
      currentDestRef.current = destinationCity;

      if (highwayPolylineRef.current) {
        map.removeLayer(highwayPolylineRef.current);
      }

      const destKey = destinationCity.toLowerCase().includes('шымкент') || destinationCity.toLowerCase().includes('тараз')
        ? 'shymkent'
        : 'astana';
      const defaultRoad = KAZAKHSTAN_ROADS[destKey] || KAZAKHSTAN_ROADS.astana;

      const highwayPoints: L.LatLngExpression[] = detailedRoadPolyline && detailedRoadPolyline.length > 0
        ? detailedRoadPolyline.map(pt => [pt.lat, pt.lng])
        : defaultRoad.map(pt => [pt.lat, pt.lng]);

      if (highwayPoints.length > 1) {
        const polyline = L.polyline(highwayPoints, {
          color: '#3b82f6',
          weight: 5,
          opacity: 0.7,
          dashArray: '8, 8',
        }).addTo(map);
        highwayPolylineRef.current = polyline;

        if (isFirstRenderRef.current) {
          const bounds = polyline.getBounds();
          if (hasRealGps && isTrackingActive) {
            bounds.extend([currentLat, currentLng]);
          }
          map.fitBounds(bounds, { padding: [40, 40] });
          isFirstRenderRef.current = false;
        }
      }

      // Rebuild Waypoints Markers
      if (waypointsGroupRef.current) {
        waypointsGroupRef.current.clearLayers();

        // Warehouse start
        if (waypoints.length > 0) {
          const startWp = waypoints[0];
          const startIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
              <div style="background:#1e293b;color:white;padding:5px 9px;border-radius:10px;font-size:11px;font-weight:bold;border:2px solid #3b82f6;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:4px;white-space:nowrap;">
                🏭 ${startWp.name}
              </div>
            `,
            iconSize: [120, 32],
            iconAnchor: [60, 16],
          });
          L.marker([startWp.lat, startWp.lng], { icon: startIcon }).addTo(waypointsGroupRef.current);
        }

        // Destination city
        if (waypoints.length > 1) {
          const endWp = waypoints[waypoints.length - 1];
          const endIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
              <div style="background:#065f46;color:white;padding:5px 9px;border-radius:10px;font-size:11px;font-weight:bold;border:2px solid #10b981;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:4px;white-space:nowrap;">
                🏙️ ${endWp.name}
              </div>
            `,
            iconSize: [120, 32],
            iconAnchor: [60, 16],
          });
          L.marker([endWp.lat, endWp.lng], { icon: endIcon }).addTo(waypointsGroupRef.current);
        }

        // Intermediate stops
        for (let i = 1; i < waypoints.length - 1; i++) {
          const wp = waypoints[i];
          const wpIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
              <div style="background:${wp.reached ? '#10b981' : '#475569'};color:white;padding:4px 8px;border-radius:8px;font-size:10px;font-weight:bold;box-shadow:0 2px 6px rgba(0,0,0,0.2);white-space:nowrap;">
                ${wp.reached ? '✓' : '📍'} ${wp.name}
              </div>
            `,
            iconSize: [85, 26],
            iconAnchor: [42, 13],
          });
          L.marker([wp.lat, wp.lng], { icon: wpIcon }).addTo(waypointsGroupRef.current);
        }
      }
    }
  }, [destinationCity, detailedRoadPolyline, waypoints]);

  // 2. Real-time Smooth Update for Truck Position, Heading, Popup & Trajectory Polyline
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    // Strict condition: If no real GPS or tracking is inactive, clean up any marker/trajectory and do not draw truck
    if (!hasRealGps || !isTrackingActive) {
      if (truckMarkerRef.current) {
        map.removeLayer(truckMarkerRef.current);
        truckMarkerRef.current = null;
      }
      if (trajectoryPolylineRef.current) {
        map.removeLayer(trajectoryPolylineRef.current);
        trajectoryPolylineRef.current = null;
      }
      if (dotsGroupRef.current) {
        dotsGroupRef.current.clearLayers();
      }
      return;
    }

    const historyPoints: L.LatLngExpression[] = locationHistory && locationHistory.length > 1
      ? locationHistory.map(pt => [pt.lat, pt.lng])
      : [];

    // A. Update or create driven trajectory line (Green solid line)
    if (historyPoints.length > 1) {
      if (!trajectoryPolylineRef.current) {
        trajectoryPolylineRef.current = L.polyline(historyPoints, {
          color: '#10b981',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(map);
      } else {
        trajectoryPolylineRef.current.setLatLngs(historyPoints);
      }
    } else if (trajectoryPolylineRef.current) {
      map.removeLayer(trajectoryPolylineRef.current);
      trajectoryPolylineRef.current = null;
    }

    // B. Update breadcrumb dots
    if (dotsGroupRef.current) {
      dotsGroupRef.current.clearLayers();
      if (historyPoints.length > 1) {
        historyPoints.forEach((pt, idx) => {
          if (idx % 2 === 0 || idx === historyPoints.length - 1) {
            const dotIcon = L.divIcon({
              className: 'trajectory-dot-icon',
              html: `<div style="width:8px;height:8px;background:#10b981;border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
              iconSize: [12, 12],
              iconAnchor: [6, 6]
            });
            L.marker(pt, { icon: dotIcon }).addTo(dotsGroupRef.current!);
          }
        });
      }
    }

    // C. Signal loss evaluation (> 15 minutes = 900 seconds)
    const isSignalLost = lastPingSecondsAgo > 900;
    const isStationary = speed < 4;
    const isMoving = speed >= 4 && !isSignalLost;

    // Formatting last activity text
    let lastActiveText = "только что";
    if (lastPingSecondsAgo >= 60) {
      const mins = Math.floor(lastPingSecondsAgo / 60);
      lastActiveText = `${mins} мин. назад`;
    } else if (lastPingSecondsAgo > 5) {
      lastActiveText = `${lastPingSecondsAgo} сек. назад`;
    }

    // Badge styling and labels
    let badgeColor = '#10b981'; // Green
    let gradient = 'linear-gradient(135deg, #10b981, #059669)';
    let statusLabel = `${speed} км/ч • ${etaFormatted}`;

    if (isSignalLost) {
      badgeColor = '#ef4444'; // Red
      gradient = 'linear-gradient(135deg, #64748b, #475569)';
      statusLabel = `⚠️ Связь потеряна (${lastActiveText})`;
    } else if (isStationary) {
      badgeColor = '#f59e0b'; // Amber
      gradient = 'linear-gradient(135deg, #f59e0b, #d97706)';
      statusLabel = `Стоянка • ${etaFormatted}`;
    }

    // D. Truck Icon with heading rotation (0-360°) and heading arrow
    const createTruckIcon = (
      spd: number, 
      headDeg: number, 
      label: string, 
      grad: string, 
      bColor: string, 
      pulse: boolean
    ) => {
      // Smooth heading angle rotation
      const rotationDeg = Math.round(headDeg || 0);

      return L.divIcon({
        className: 'custom-neat-truck-marker',
        html: `
          <div style="position:relative;display:flex;align-items:center;">
            <!-- Pulse Ring when moving actively -->
            ${pulse ? '<div style="position:absolute;width:38px;height:38px;background:rgba(16,185,129,0.35);border-radius:50%;animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></div>' : ''}
            
            <!-- Rotating Directional Truck Badge -->
            <div style="position:relative;background:${grad};color:white;width:36px;height:36px;border-radius:50%;border:2px solid white;box-shadow:0 4px 14px rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;transform:rotate(${rotationDeg}deg);transition:transform 0.6s cubic-bezier(0.4, 0, 0.2, 1);z-index:2;">
              <!-- Front Pointer Triangle -->
              <div style="position:absolute;top:-4px;width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-bottom:7px solid white;"></div>
              <span style="font-size:16px;display:inline-block;transform:rotate(-${rotationDeg}deg);transition:transform 0.6s cubic-bezier(0.4,0,0.2,1);">🚚</span>
            </div>

            <!-- Plate, Speed & Status Badge -->
            <div style="position:absolute;left:40px;background:rgba(15,23,42,0.94);color:white;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:bold;border:1px solid ${bColor};white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,0.3);backdrop-filter:blur(4px);z-index:1;">
              <span style="color:#94a3b8;margin-right:4px;">${truckPlate}</span> ${label}
            </div>
          </div>
        `,
        iconSize: [220, 38],
        iconAnchor: [18, 19],
      });
    };

    // E. Interactive Leaflet Popup Content
    const popupContent = `
      <div style="font-family:system-ui,-apple-system,sans-serif;padding:6px;min-width:190px;color:#0f172a;">
        <div style="font-weight:bold;font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:6px;color:#0f172a;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">
          <span style="font-size:15px;">🚚</span> <span>${truckPlate}</span>
        </div>
        <div style="font-size:11px;color:#475569;margin-bottom:3px;">
          👤 <b>Водитель:</b> ${driverName}
        </div>
        <div style="font-size:11px;color:#475569;margin-bottom:3px;">
          ⚡ <b>Скорость:</b> <span style="color:${isMoving ? '#059669' : '#d97706'};font-weight:bold;">${speed} км/ч</span>
        </div>
        <div style="font-size:11px;color:#475569;margin-bottom:3px;">
          🧭 <b>Курс:</b> ${Math.round(heading)}°
        </div>
        <div style="font-size:11px;color:#475569;margin-bottom:3px;">
          ⏱️ <b>Сигнал:</b> ${lastActiveText}
        </div>
        <div style="font-size:10px;padding:3px 8px;border-radius:6px;background:${isSignalLost ? '#fee2e2' : isMoving ? '#d1fae5' : '#fef3c7'};color:${isSignalLost ? '#dc2626' : isMoving ? '#065f46' : '#92400e'};font-weight:bold;margin-top:6px;text-align:center;">
          ${isSignalLost ? '🔴 Связь потеряна (>15 мин)' : isMoving ? '🟢 В движении по трассе' : '🟡 Стоянка / Остановка'}
        </div>
      </div>
    `;

    const icon = createTruckIcon(speed, heading, statusLabel, gradient, badgeColor, isMoving);

    if (!truckMarkerRef.current) {
      truckMarkerRef.current = L.marker([currentLat, currentLng], { icon })
        .bindPopup(popupContent)
        .addTo(map);
    } else {
      // Smooth marker movement with Leaflet setLatLng
      truckMarkerRef.current.setLatLng([currentLat, currentLng]);
      truckMarkerRef.current.setIcon(icon);
      truckMarkerRef.current.setPopupContent(popupContent);
    }
  }, [currentLat, currentLng, speed, heading, etaFormatted, locationHistory, waypoints, truckPlate, driverName, lastPingSecondsAgo, signalStatus, hasRealGps, isTrackingActive]);

  // Recenter map smooth view to truck position
  const handleRecenterTruck = () => {
    if (mapInstanceRef.current && hasRealGps && isTrackingActive) {
      mapInstanceRef.current.flyTo([currentLat, currentLng], 12, { animate: true, duration: 1 });
    }
  };

  // Recenter map view to whole route
  const handleRecenterRoute = () => {
    if (mapInstanceRef.current && waypoints.length > 1) {
      const highwayPoints: L.LatLngExpression[] = detailedRoadPolyline && detailedRoadPolyline.length > 0
        ? detailedRoadPolyline.map(pt => [pt.lat, pt.lng])
        : waypoints.map(wp => [wp.lat, wp.lng]);

      const polyline = L.polyline(highwayPoints);
      const bounds = polyline.getBounds();
      if (hasRealGps && isTrackingActive) {
        bounds.extend([currentLat, currentLng]);
      }
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40] });
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div className={`relative w-full ${height} rounded-2xl overflow-hidden border border-slate-700 shadow-inner group`}>
      {/* CSS for smooth marker transition */}
      <style>{`
        .leaflet-marker-icon.custom-neat-truck-marker {
          transition: transform 1.2s cubic-bezier(0.25, 1, 0.5, 1) !important;
        }
      `}</style>

      {/* Informative banner when GPS tracking is not active / waiting for real driver Live GPS */}
      {(!hasRealGps || !isTrackingActive) && (
        <div className="absolute top-3 left-3 z-[400] max-w-[80%] bg-slate-900/92 backdrop-blur-md text-white px-3.5 py-2.5 rounded-xl border border-amber-500/40 shadow-xl flex items-center gap-2.5 text-xs pointer-events-none">
          <span className="text-base animate-pulse">🛰️</span>
          <div>
            <div className="font-bold text-amber-300">
              {driverConsent ? 'Водитель согласился на рейс (ожидание Live GPS)' : 'GPS-отслеживание не запущено'}
            </div>
            <div className="text-[11px] text-slate-300">
              Машина появится на карте сразу после первого сигнала Live-трансляции из Telegram-бота.
            </div>
          </div>
        </div>
      )}

      {/* Floating View Control Tools */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-700 shadow-xl backdrop-blur-md">
        {hasRealGps && isTrackingActive && (
          <button
            onClick={handleRecenterTruck}
            className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
            title="Сфокусировать карту на местоположении фуры"
          >
            <span>🎯 Сфокусировать на фуре</span>
          </button>
        )}
        <button
          onClick={handleRecenterRoute}
          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer"
          title="Показать весь маршрут полностью"
        >
          <span>🛣️ Весь маршрут</span>
        </button>
      </div>

      <div ref={mapRef} className="w-full h-full z-10" />
    </div>
  );
};
