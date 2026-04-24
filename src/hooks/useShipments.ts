import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  orderBy, 
  getDocs,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Shipment } from '../types';
import { addDays } from 'date-fns';

export const useShipments = () => {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const path = 'shipments';
    const q = query(collection(db, path), orderBy('last_updated', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setShipments(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Shipment)));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Seed initial data if empty
  useEffect(() => {
    const seedData = async () => {
      const path = 'shipments';
      try {
        const snapshot = await getDocs(collection(db, path));
        if (snapshot.empty) {
          const now = new Date();
          const initialShipments = [
            {
              invoice_id: 'Mehkaz 61',
              route: 'Tehran - Almaty',
              status: 'In Transit',
              departure_date: addDays(now, -4).toISOString(),
              est_travel_time: 12,
              arrival_deadline: addDays(now, 8).toISOString(),
              documents_url: [],
              last_updated: now.toISOString(),
              createdBy: 'system'
            },
            {
              invoice_id: 'Mehkaz 62',
              route: 'Amol - Almaty',
              status: 'Delay',
              departure_date: addDays(now, -15).toISOString(),
              est_travel_time: 12,
              arrival_deadline: addDays(now, -3).toISOString(),
              documents_url: [],
              last_updated: now.toISOString(),
              createdBy: 'system'
            }
          ];

          for (const s of initialShipments) {
            await addDoc(collection(db, path), s);
          }
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
      }
    };
    seedData();
  }, []);

  return { shipments, loading };
};
