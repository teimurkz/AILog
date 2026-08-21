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

  return { shipments, loading };
};
