import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  orderBy 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
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
    const path = 'saved_trucks';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: SavedTruck[] = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          plateNumber: data.plateNumber || '',
          driverName: data.driverName || '',
          driverPhone: data.driverPhone || '',
          truckType: data.truckType || 'Фура 20т (Тент)',
          createdAt: data.createdAt || new Date().toISOString(),
        };
      });

      setSavedTrucks(fetched);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fetched));
      } catch (e) {
        console.warn("Error updating localStorage saved trucks:", e);
      }
      setLoading(false);
    }, (error) => {
      console.warn("Firestore listener for saved trucks encountered error, using local state:", error);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const addSavedTruck = async (truck: Omit<SavedTruck, 'id' | 'createdAt'>) => {
    const path = 'saved_trucks';
    
    // Check if already exists in list
    const existing = savedTrucks.find(
      t => t.plateNumber.trim().toUpperCase() === truck.plateNumber.trim().toUpperCase()
    );
    if (existing) {
      return existing.id;
    }

    const newTruck: SavedTruck = {
      id: `local-truck-${Date.now()}`,
      plateNumber: truck.plateNumber.trim().toUpperCase(),
      driverName: truck.driverName.trim(),
      driverPhone: truck.driverPhone.trim(),
      truckType: truck.truckType?.trim() || 'Фура 20т (Тент)',
      createdAt: new Date().toISOString(),
    };

    const updated = [newTruck, ...savedTrucks];
    setSavedTrucks(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Error setting localStorage:", e);
    }

    try {
      const docRef = await addDoc(collection(db, path), {
        plateNumber: truck.plateNumber.trim().toUpperCase(),
        driverName: truck.driverName.trim(),
        driverPhone: truck.driverPhone.trim(),
        truckType: truck.truckType?.trim() || 'Фура 20т (Тент)',
        createdAt: new Date().toISOString(),
      });
      return docRef.id;
    } catch (error) {
      console.warn("Failed to write saved truck to Firestore (saved locally):", error);
      return newTruck.id;
    }
  };

  const deleteSavedTruck = async (id: string) => {
    const path = 'saved_trucks';
    const updated = savedTrucks.filter(t => t.id !== id);
    setSavedTrucks(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.warn("Error updating localStorage after delete:", e);
    }

    if (!id.startsWith('local-truck-')) {
      try {
        await deleteDoc(doc(db, path, id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  };

  return {
    savedTrucks,
    loading,
    addSavedTruck,
    deleteSavedTruck,
  };
};
