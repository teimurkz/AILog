import { useState, useEffect } from 'react';
import { contactsApi, subscribeToRealtimeStream } from '../services/api';
import { SavedTruck } from '../types';

const STORAGE_KEY = 'regional_saved_trucks_v1';

export const useSavedTrucks = () => {
  const [savedTrucks, setSavedTrucks] = useState<SavedTruck[]>(() => {
    try {
      const localData = localStorage.getItem(STORAGE_KEY);
      if (localData) {
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn("Failed to read saved trucks from localStorage:", e);
    }
    return [];
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadTrucks = async () => {
      try {
        const list = (await contactsApi.getTrucks()) as any[];
        if (!isCancelled && Array.isArray(list)) {
          const mapped: SavedTruck[] = list.map(t => ({
            id: t.id,
            plateNumber: t.plateNumber || '',
            driverName: t.driverName || t.model || '',
            driverPhone: t.driverPhone || '',
            truckType: t.truckType || 'Фура 20т (Тент)',
            createdAt: t.createdAt || new Date().toISOString()
          }));
          setSavedTrucks(mapped);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(mapped));
          setLoading(false);
        }
      } catch (err) {
        console.warn("Failed to load trucks from local API, using local storage:", err);
        if (!isCancelled) setLoading(false);
      }
    };

    loadTrucks();

    const unsubscribe = subscribeToRealtimeStream((eventType, data) => {
      if (isCancelled) return;
      if (eventType === 'truck_updated' && data?.id) {
        setSavedTrucks(prev => {
          const exists = prev.some(t => t.id === data.id);
          const updated = exists ? prev.map(t => (t.id === data.id ? { ...t, ...data } : t)) : [data, ...prev];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      } else if (eventType === 'truck_deleted' && data?.id) {
        setSavedTrucks(prev => {
          const updated = prev.filter(t => t.id !== data.id);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
          return updated;
        });
      }
    });

    return () => {
      isCancelled = true;
      unsubscribe();
    };
  }, []);

  const addSavedTruck = async (truck: Omit<SavedTruck, 'id' | 'createdAt'>) => {
    const existing = savedTrucks.find(
      t => t.plateNumber.trim().toUpperCase() === truck.plateNumber.trim().toUpperCase()
    );
    if (existing) {
      return existing.id;
    }

    const newTruck: SavedTruck = {
      id: `TRK-${Date.now().toString().slice(-5)}`,
      plateNumber: truck.plateNumber.trim().toUpperCase(),
      driverName: truck.driverName.trim(),
      driverPhone: truck.driverPhone.trim(),
      truckType: truck.truckType?.trim() || 'Фура 20т (Тент)',
      createdAt: new Date().toISOString(),
    };

    const updated = [newTruck, ...savedTrucks];
    setSavedTrucks(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    contactsApi.saveTruck(newTruck as any).catch(err => {
      console.warn("Could not sync truck to backend:", err);
    });

    return newTruck.id;
  };

  const deleteSavedTruck = async (id: string) => {
    const updated = savedTrucks.filter(t => t.id !== id);
    setSavedTrucks(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));

    contactsApi.deleteTruck(id).catch(err => {
      console.warn("Could not delete truck from backend:", err);
    });
  };

  return {
    savedTrucks,
    loading,
    addSavedTruck,
    deleteSavedTruck,
  };
};
