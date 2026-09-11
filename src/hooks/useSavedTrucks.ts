import { useState } from 'react';
import { useFirestoreCollection } from './useFirestoreCollection';
import { contactsApi } from '../services/api';
import { dataLoadError } from '../services/collection-state';
import type { SavedTruck } from '../types';

export const useSavedTrucks = () => {
  const { data, ...state } = useFirestoreCollection<SavedTruck>('saved_trucks');
  const [writeError, setWriteError] = useState<string | null>(null);
  const savedTrucks = data.map(truck => ({ ...truck, plateNumber: truck.plateNumber || '', driverName: truck.driverName || '', driverPhone: truck.driverPhone || '', truckType: truck.truckType || 'Фура 20т (Тент)' }));
  const addSavedTruck = async (truck: Omit<SavedTruck, 'id' | 'createdAt'>) => {
    const existing = savedTrucks.find(item => item.plateNumber.trim().toUpperCase() === truck.plateNumber.trim().toUpperCase());
    if (existing) return existing.id;
    setWriteError(null);
    try {
      const saved = await contactsApi.saveTruck({ ...truck, plateNumber: truck.plateNumber.trim().toUpperCase(), createdAt: new Date().toISOString() } as any);
      return saved.id;
    } catch (error) { setWriteError(dataLoadError(error)); throw error; }
  };
  const deleteSavedTruck = async (id: string) => {
    setWriteError(null);
    try { await contactsApi.deleteTruck(id); }
    catch (error) { setWriteError(dataLoadError(error)); throw error; }
  };
  return { savedTrucks, ...state, error: writeError || state.error, retry: () => { setWriteError(null); state.retry(); }, addSavedTruck, deleteSavedTruck };
};
