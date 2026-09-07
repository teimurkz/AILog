import { useState, useEffect } from 'react';
import { shipmentsApi, subscribeToRealtimeStream } from '../services/api';
import { Shipment } from '../types';

export const useShipments = () => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadShipments = async () => {
      try {
        const list = await shipmentsApi.getAll();
        if (!isCancelled) {
          setShipments(list);
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load shipments from local API:", err);
        if (!isCancelled) setLoading(false);
      }
    };

    loadShipments();

    const unsubscribe = subscribeToRealtimeStream((eventType, data) => {
      if (isCancelled) return;

      if (eventType === 'shipment_created' && data?.id) {
        setShipments(prev => {
          if (prev.some(s => s.id === data.id)) return prev;
          return [data, ...prev];
        });
      } else if (eventType === 'shipment_updated' && data?.id) {
        setShipments(prev => prev.map(s => (s.id === data.id ? { ...s, ...data } : s)));
      } else if (eventType === 'shipment_deleted' && data?.id) {
        setShipments(prev => prev.filter(s => s.id !== data.id));
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, []);

  return { shipments, loading };
};
