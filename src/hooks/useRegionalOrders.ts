import { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  deleteDoc,
  doc,
  orderBy, 
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { RegionalTruckOrder, RegionalOrderStatus } from '../types';

export const playNotificationSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // First chime note (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain1.gain.setValueAtTime(0.3, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.3);

    // Second chime note (A5)
    setTimeout(() => {
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, ctx.currentTime);
      gain2.gain.setValueAtTime(0.4, ctx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start();
      osc2.stop(ctx.currentTime + 0.4);
    }, 130);
  } catch (e) {
    console.warn("Audio Context playback notice:", e);
  }
};

export const triggerBrowserPush = (title: string, body: string) => {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
        });
      } catch (e) {
        console.warn('Browser Push error:', e);
      }
    }
  }
};

const sanitizeFirestoreData = (data: Record<string, any>): Record<string, any> => {
  const clean: Record<string, any> = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (val === undefined) {
      clean[key] = '';
    } else if (typeof val === 'string' && key === 'invoiceFileData' && val.length > 600000) {
      clean[key] = '';
    } else if (Array.isArray(val)) {
      clean[key] = val.map(item => {
        if (item && typeof item === 'object') {
          const cleanItem: Record<string, any> = {};
          for (const ik of Object.keys(item)) {
            const iv = item[ik];
            if (iv === undefined) {
              cleanItem[ik] = '';
            } else if (typeof iv === 'string' && ik === 'fileData' && iv.length > 600000) {
              cleanItem[ik] = '';
            } else {
              cleanItem[ik] = iv;
            }
          }
          return cleanItem;
        }
        return item;
      });
    } else {
      clean[key] = val;
    }
  }
  return clean;
};

export const useRegionalOrders = () => {
  const [orders, setOrders] = useState<RegionalTruckOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastNewOrderAlert, setLastNewOrderAlert] = useState<RegionalTruckOrder | null>(null);
  const initialLoadDoneRef = useRef(false);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const path = 'regional_orders';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetched: RegionalTruckOrder[] = snapshot.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          orderNumber: data.orderNumber || `REG-${d.id.slice(0, 5).toUpperCase()}`,
          destinationCity: data.destinationCity || 'Астана',
          originCity: data.originCity || 'Алматы',
          deliveryAddress: data.deliveryAddress || '',
          recipientPhone: data.recipientPhone || '',
          deliveryPoints: Array.isArray(data.deliveryPoints) ? data.deliveryPoints : [],
          invoiceNumber: data.invoiceNumber || '№000',
          invoiceFileName: data.invoiceFileName,
          invoiceFileData: data.invoiceFileData,
          invoiceFileType: data.invoiceFileType,
          invoices: Array.isArray(data.invoices) ? data.invoices : [],
          shipmentDate: data.shipmentDate || new Date().toISOString().split('T')[0],
          truckType: data.truckType || 'Фура 20т (Рефрижератор)',
          palletsCount: data.palletsCount || '20 паллет',
          weight: data.weight || '15 тонн',
          cargoDescription: data.cargoDescription || 'Молочная продукция',
          managerName: data.managerName || 'Менеджер регионов',
          managerPhone: data.managerPhone || '',
          comments: data.comments || '',
          status: (data.status as RegionalOrderStatus) || 'new',
          assignedTruckPlate: data.assignedTruckPlate || '',
          assignedDriver: data.assignedDriver || '',
          createdAt: data.createdAt || new Date().toISOString(),
          createdByEmail: data.createdByEmail || '',
          createdByName: data.createdByName || '',
          updatedAt: data.updatedAt || '',
        };
      });

      // Check for newly added orders after initial load
      if (initialLoadDoneRef.current) {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const newId = change.doc.id;
            if (!knownOrderIdsRef.current.has(newId)) {
              const newOrder = fetched.find(o => o.id === newId);
              if (newOrder) {
                // Play notification sound
                playNotificationSound();
                // Send browser notification
                triggerBrowserPush(
                  `🚚 Новая заявка на фуру (${newOrder.destinationCity})!`,
                  `Накладная: ${newOrder.invoiceNumber} | Дата отправки: ${newOrder.shipmentDate} | Менеджер: ${newOrder.managerName}`
                );
                // Trigger in-app alert banner
                setLastNewOrderAlert(newOrder);
              }
            }
          }
        });
      }

      // Track known IDs
      fetched.forEach(o => knownOrderIdsRef.current.add(o.id));
      initialLoadDoneRef.current = true;
      setOrders(fetched);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const addOrder = async (orderData: Omit<RegionalTruckOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>) => {
    const path = 'regional_orders';
    try {
      const orderNum = `REG-${Math.floor(1000 + Math.random() * 9000)}`;
      const payload = sanitizeFirestoreData({
        ...orderData,
        orderNumber: orderNum,
        status: 'new',
        createdAt: new Date().toISOString(),
      });
      const docRef = await addDoc(collection(db, path), payload);

      // Play local audio chime immediately for creator
      playNotificationSound();

      // Trigger local browser push
      triggerBrowserPush(
        `🚚 Заявка на фуру (${orderData.destinationCity}) создана!`,
        `Накладная: ${orderData.invoiceNumber} | Дата: ${orderData.shipmentDate}`
      );

      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      throw error;
    }
  };

  const updateOrderStatus = async (
    orderId: string, 
    status: RegionalOrderStatus, 
    assignedData?: { assignedTruckPlate?: string; assignedDriver?: string; comments?: string }
  ) => {
    const path = 'regional_orders';
    try {
      const orderRef = doc(db, path, orderId);
      await updateDoc(orderRef, {
        status,
        ...(assignedData || {}),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
      throw error;
    }
  };

  const deleteOrder = async (orderId: string) => {
    const path = 'regional_orders';
    try {
      await deleteDoc(doc(db, path, orderId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
      throw error;
    }
  };

  const dismissAlert = () => setLastNewOrderAlert(null);

  return {
    orders,
    loading,
    addOrder,
    updateOrderStatus,
    deleteOrder,
    lastNewOrderAlert,
    dismissAlert,
  };
};
