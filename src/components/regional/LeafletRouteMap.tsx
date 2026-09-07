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
  etaFormatted: string;
  waypoints: Array<{ name: string; lat: number; lng: number; reached: boolean }>;
  detailedRoadPolyline?: LocationPoint[];
  locationHistory?: LocationPoint[];
  height?: string;
}

export const LeafletRouteMap: React.FC<LeafletRouteMapProps> = ({
  currentLat,
  currentLng,
  originCity,
  destinationCity,
  speed,
  etaFormatted,
  waypoints,
  detailedRoadPolyline,
  locationHistory,
  height = "h-[360px]",
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
          bounds.extend([currentLat, currentLng]);
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

  // 2. Real-time Smooth Update for Truck Position & Trajectory Polyline
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const map = mapInstanceRef.current;

    const historyPoints: L.LatLngExpression[] = locationHistory && locationHistory.length > 1
      ? locationHistory.map(pt => [pt.lat, pt.lng])
      : [];

    // A. Update or create driven trajectory line (Green solid line only if real points exist)
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

    // C. Update or create neat truck marker with smooth CSS transition
    const createTruckIcon = (spd: number, eta: string) => {
      const isMoving = spd > 5;
      const statusLabel = isMoving ? `${spd} км/ч • ${eta}` : `Стоянка • ${eta}`;
      const badgeColor = isMoving ? '#10b981' : '#f59e0b';
      const gradient = isMoving ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #f59e0b, #d97706)';

      return L.divIcon({
        className: 'custom-neat-truck-marker',
        html: `
          <div style="position:relative;display:flex;align-items:center;transition:all 0.8s ease-out;">
            <!-- Pulse Ring when moving -->
            ${isMoving ? '<div style="position:absolute;width:34px;height:34px;background:rgba(16,185,129,0.4);border-radius:50%;animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></div>' : ''}
            
            <!-- Compact Truck Badge -->
            <div style="position:relative;background:${gradient};color:white;width:32px;height:32px;border-radius:50%;border:2px solid white;box-shadow:0 4px 14px rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;font-size:16px;">
              🚚
            </div>

            <!-- Speed & ETA Badge -->
            <div style="position:absolute;left:36px;background:rgba(15,23,42,0.92);color:white;padding:3px 8px;border-radius:8px;font-size:10px;font-weight:bold;border:1px solid ${badgeColor};white-space:nowrap;box-shadow:0 4px 10px rgba(0,0,0,0.3);backdrop-filter:blur(4px);">
              ${statusLabel}
            </div>
          </div>
        `,
        iconSize: [160, 36],
        iconAnchor: [16, 18],
      });
    };

    if (!truckMarkerRef.current) {
      truckMarkerRef.current = L.marker([currentLat, currentLng], {
        icon: createTruckIcon(speed, etaFormatted)
      }).addTo(map);
    } else {
      truckMarkerRef.current.setLatLng([currentLat, currentLng]);
      truckMarkerRef.current.setIcon(createTruckIcon(speed, etaFormatted));
    }
  }, [currentLat, currentLng, speed, etaFormatted, locationHistory, waypoints]);

  // Recenter map smooth view to truck position
  const handleRecenterTruck = () => {
    if (mapInstanceRef.current) {
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
      bounds.extend([currentLat, currentLng]);
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
      {/* Floating View Control Tools */}
      <div className="absolute top-3 right-3 z-[400] flex flex-col gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-700 shadow-xl backdrop-blur-md">
        <button
          onClick={handleRecenterTruck}
          className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
          title="Сфокусировать карту на местоположении фуры"
        >
          <span>🎯 Сфокусировать на фуре</span>
        </button>
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
