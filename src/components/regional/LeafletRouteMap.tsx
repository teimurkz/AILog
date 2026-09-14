import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, LocateFixed, Route } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { splitGpsTrail } from '../../lib/gps-trail';
import { ExpandableMap } from './ExpandableMap';

export interface LocationPoint {
  lat: number;
  lng: number;
  timestamp?: string;
  accuracy?: number;
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
  signalStatusText?: string;
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
  signalStatusText,
  height = "h-[360px]",
  hasRealGps = false,
  isTrackingActive = false,
  driverConsent = false,
}) => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const isFirstRenderRef = useRef<boolean>(true);
  const [trailMode, setTrailMode] = useState<'points' | 'line' | 'hidden'>('points');
  const trailSegments = useMemo(() => splitGpsTrail(locationHistory || []), [locationHistory]);

  // Persistent layer references to prevent re-creating and flickering
  const highwayPolylineRef = useRef<L.Polyline | null>(null);
  const trajectoryPolylineRef = useRef<L.Polyline | null>(null);
  const dotsGroupRef = useRef<L.LayerGroup | null>(null);
  const waypointsGroupRef = useRef<L.LayerGroup | null>(null);
  const truckMarkerRef = useRef<L.Marker | null>(null);
  const currentRouteRef = useRef<string>('');

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

    // The route can arrive after GPS, even when the destination is unchanged.
    const routeShape = JSON.stringify([detailedRoadPolyline || [], waypoints]);
    if (currentRouteRef.current !== routeShape) {
      currentRouteRef.current = routeShape;

      if (highwayPolylineRef.current) {
        map.removeLayer(highwayPolylineRef.current);
        highwayPolylineRef.current = null;
      }

      const highwayPoints: L.LatLngExpression[] = (detailedRoadPolyline || []).map(pt => [pt.lat, pt.lng]);

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

        // First position reported by the truck for this trip.
        if (waypoints.length > 1) {
          const startWp = waypoints[0];
          const startIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
              <div style="background:#1e293b;color:white;padding:5px 9px;border-radius:10px;font-size:11px;font-weight:bold;border:2px solid #3b82f6;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:flex;align-items:center;gap:4px;white-space:nowrap;">
                📍 ${startWp.name}
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

    // Do not display a truck or recorded trail until real GPS has arrived.
    if (!hasRealGps) {
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

    const historySegments: L.LatLngExpression[][] = trailMode === 'line'
      ? trailSegments.filter(segment => segment.length > 1).map(segment => segment.map(pt => [pt.lat, pt.lng]))
      : [];

    // Each segment is separate: never draw a chord across missing observations.
    if (historySegments.length) {
      if (!trajectoryPolylineRef.current) {
        trajectoryPolylineRef.current = L.polyline(historySegments, {
          color: '#10b981',
          weight: 3,
          opacity: 0.7,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(map);
      } else {
        trajectoryPolylineRef.current.setLatLngs(historySegments);
      }
    } else if (trajectoryPolylineRef.current) {
      map.removeLayer(trajectoryPolylineRef.current);
      trajectoryPolylineRef.current = null;
    }

    // Small circles replace the large overlapping marker labels. Line mode
    // keeps only segment endpoints and isolated observations visible.
    if (dotsGroupRef.current) {
      dotsGroupRef.current.clearLayers();
      if (trailMode !== 'hidden') {
        const points = trailMode === 'points' ? trailSegments.flat() :
          trailSegments.flatMap(segment => segment.length > 1 ? [segment[0], segment[segment.length - 1]] : segment);
        points.forEach(pt => {
          L.circleMarker([pt.lat, pt.lng], {
            radius: 3, color: '#ffffff', weight: 1, opacity: 0.7,
            fillColor: '#10b981', fillOpacity: 0.8, interactive: false,
          }).addTo(dotsGroupRef.current!);
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

    if (!isTrackingActive) {
      badgeColor = '#64748b';
      gradient = 'linear-gradient(135deg, #64748b, #475569)';
      statusLabel = signalStatusText || 'Последняя точка';
    } else if (isSignalLost) {
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
          ${signalStatusText || (isSignalLost ? 'Нет свежего сигнала' : isMoving ? 'В движении' : 'Стоянка')}
        </div>
      </div>
    `;

    const icon = createTruckIcon(speed, heading, statusLabel, gradient, badgeColor, isMoving);

    if (!truckMarkerRef.current) {
      truckMarkerRef.current = L.marker([currentLat, currentLng], { icon })
        .bindPopup(popupContent)
        .addTo(map);
      if (!map.getBounds().contains([currentLat, currentLng])) {
        map.panTo([currentLat, currentLng]);
      }
    } else {
      // Smooth marker movement with Leaflet setLatLng
      truckMarkerRef.current.setLatLng([currentLat, currentLng]);
      truckMarkerRef.current.setIcon(icon);
      truckMarkerRef.current.setPopupContent(popupContent);
    }
  }, [currentLat, currentLng, speed, heading, etaFormatted, trailSegments, trailMode, waypoints, truckPlate, driverName, lastPingSecondsAgo, signalStatus, signalStatusText, hasRealGps, isTrackingActive]);

  // Resizing the modal, rotating a phone or expanding only the map must not
  // leave Leaflet's tiles using the old container dimensions.
  useEffect(() => {
    if (!mapRef.current) return;
    const observer = new ResizeObserver(() => mapInstanceRef.current?.invalidateSize({ pan: false }));
    observer.observe(mapRef.current);
    return () => observer.disconnect();
  }, []);

  // Recenter map smooth view to truck position
  const handleRecenterTruck = () => {
    if (mapInstanceRef.current && hasRealGps) {
      mapInstanceRef.current.flyTo([currentLat, currentLng], 12, { animate: true, duration: 1 });
    }
  };

  // Recenter map view to whole route
  const handleRecenterRoute = () => {
    if (mapInstanceRef.current) {
      const points: L.LatLngExpression[] = [
        ...(detailedRoadPolyline || []), ...waypoints,
        ...(hasRealGps ? trailSegments.flat() : []),
      ].map(pt => [pt.lat, pt.lng]);
      const bounds = L.latLngBounds(points);
      if (hasRealGps) {
        bounds.extend([currentLat, currentLng]);
      }
      if (bounds.isValid()) mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        highwayPolylineRef.current = null;
        truckMarkerRef.current = null;
        trajectoryPolylineRef.current = null;
        currentRouteRef.current = '';
        isFirstRenderRef.current = true;
      }
    };
  }, []);

  return (
    <ExpandableMap height={height}>{({ expanded, toggleExpanded }) => <>
      {/* CSS for smooth marker transition */}
      <style>{`
        .leaflet-marker-icon.custom-neat-truck-marker {
          transition: transform 1.2s cubic-bezier(0.25, 1, 0.5, 1) !important;
        }
      `}</style>

      <div className="shrink-0 space-y-1 border-b border-slate-700 bg-slate-900 p-2 text-xs text-slate-200"
        style={expanded ? { paddingTop: 'max(8px, env(safe-area-inset-top))', paddingLeft: 'max(8px, env(safe-area-inset-left))', paddingRight: 'max(8px, env(safe-area-inset-right))' } : undefined}>
        <div className="flex flex-wrap items-center gap-1">
          {hasRealGps && <button type="button" onClick={handleRecenterTruck}
            className="flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 font-semibold text-white hover:bg-emerald-500"
            title="Сфокусировать карту на местоположении фуры">
            <LocateFixed size={16} aria-hidden="true" /> Фура
          </button>}
          <button type="button" onClick={handleRecenterRoute}
            className="flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 hover:bg-slate-800">
            <Route size={16} aria-hidden="true" /> Весь маршрут
          </button>
          <button type="button" onClick={toggleExpanded} aria-expanded={expanded}
            aria-label={expanded ? 'Свернуть карту' : 'Развернуть карту на весь экран'}
            className="ml-auto flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-700 px-2.5 font-semibold text-white hover:bg-slate-600">
            {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            {expanded ? 'Свернуть' : 'Развернуть'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Отображение истории GPS">
          <span className="mr-1 text-slate-400">История:</span>
          {([['points', 'Точки'], ['line', 'След'], ['hidden', 'Скрыть']] as const).map(([mode, label]) =>
            <button key={mode} type="button" aria-pressed={trailMode === mode} onClick={() => setTrailMode(mode)}
              className={`min-h-9 rounded-lg px-3 ${trailMode === mode ? 'bg-emerald-900 text-emerald-200' : 'text-slate-300 hover:bg-slate-800'}`}>
              {label}
            </button>)}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {(!hasRealGps || !isTrackingActive) && (
          <div className="pointer-events-none absolute bottom-7 left-3 right-3 z-[400] rounded-xl border border-amber-500/40 bg-slate-900/90 px-3 py-2 text-xs text-slate-300 shadow-xl">
            <div className="font-bold text-amber-300">
              {signalStatusText || (driverConsent ? 'Ожидание геопозиции водителя' : 'GPS-отслеживание не запущено')}
            </div>
            {hasRealGps ? 'На карте сохранена последняя полученная точка.' : 'Машина появится после отправки геопозиции водителем.'}
          </div>
        )}
        <div ref={mapRef} className="h-full w-full z-10" />
      </div>
      <div className="shrink-0 bg-slate-900 px-3 py-1.5 text-[11px] text-slate-400" role="status"
        style={expanded ? { paddingBottom: 'max(6px, env(safe-area-inset-bottom))' } : undefined}>
        {trailMode === 'points' ? 'Зелёные точки — полученные координаты GPS.' :
          trailMode === 'line' ? 'Зелёный след — участки GPS. Пропуски и скачки не соединяются.' : 'История GPS скрыта. Машина и маршрут остаются на карте.'}
      </div>
    </>}</ExpandableMap>
  );
};
