import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToOwnerOrders } from '../services/firestore-collections';
import { ordersApi, subscribeToRealtimeStream } from '../services/api';
import { onTruckPositionUpdate, onDeliveryEnded } from '../services/socket';
import { RegionalTruckOrder, RegionalOrderStatus } from '../types';

export const playNotificationSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

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

export const useRegionalOrders = () => {
  const { isAdmin } = useAuth();
  const [orders, setOrders] = useState<RegionalTruckOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const [lastNewOrderAlert, setLastNewOrderAlert] = useState<RegionalTruckOrder | null>(null);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);

  // The owner reads existing orders directly; staff use the API that removes GPS fields.
  useEffect(() => {
    let isCancelled = false;

    const loadOrders = async () => {
      if (isAdmin) return;
      try {
        const list = await ordersApi.getAll();
        if (!isCancelled) {
          list.forEach(o => knownOrderIdsRef.current.add(o.id));
          setOrders(list);
          setError(null);
          initialLoadDoneRef.current = true;
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setLoading(false);
          setError(err instanceof Error ? err.message : 'Не удалось загрузить региональные заявки.');
        }
      }
    };

    setLoading(true);
    setError(null);
    const stopOwner = isAdmin ? subscribeToOwnerOrders<RegionalTruckOrder>(state => {
      if (isCancelled) return;
      if (state.confirmed || state.data.length) {
        setOrders([...state.data].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)));
        state.data.forEach(order => knownOrderIdsRef.current.add(order.id));
        initialLoadDoneRef.current = true;
      }
      setLoading(state.loading);
      setError(state.error);
    }) : undefined;
    if (!isAdmin) void loadOrders();
    window.addEventListener('online', retry);

    // 2. Real-time Server-Sent Events (SSE) listener
    const unsubscribe = subscribeToRealtimeStream((eventType, data) => {
      if (isCancelled) return;

      if (eventType === 'connected') {
        void loadOrders();
        return;
      }

      if (eventType === 'order_created' && data?.id) {
        setOrders(prev => {
          if (prev.some(o => o.id === data.id)) return prev;
          const updated = [data, ...prev];

          if (initialLoadDoneRef.current && !knownOrderIdsRef.current.has(data.id)) {
            knownOrderIdsRef.current.add(data.id);
            playNotificationSound();
            triggerBrowserPush(
              `🚚 Новая заявка на фуру (${data.destinationCity})!`,
              `Накладная: ${data.invoiceNumber || 'б/н'} | Дата: ${data.shipmentDate || ''} | Менеджер: ${data.managerName || ''}`
            );
            setLastNewOrderAlert(data);
          }

          return updated;
        });
      } else if (eventType === 'order_updated' && data) {
        const targetId = data.id || data.orderNumberOrId;
        setOrders(prev =>
          prev.map(o => {
            if (o.id === targetId || o.orderNumber === targetId || o.id.toLowerCase() === String(targetId).toLowerCase()) {
              return { ...o, ...data };
            }
            return o;
          })
        );
      } else if (eventType === 'order_deleted' && data?.id) {
        setOrders(prev => prev.filter(o => o.id !== data.id && o.orderNumber !== data.id));
      } else if (eventType === 'telemetry_update' && data?.orderId) {
        setOrders(prev =>
          prev.map(o => {
            if (o.id === data.orderId || o.orderNumber === data.orderId || o.orderNumber === data.orderNumber) {
              return {
                ...o,
                currentLat: data.lat,
                currentLng: data.lng,
                speed: data.speed,
                heading: data.heading,
                lastGpsUpdate: data.updatedAt || new Date().toISOString()
              };
            }
            return o;
          })
        );
      } else if (eventType === 'order_completed' && data?.orderId) {
        setOrders(prev =>
          prev.map(o => {
            if (o.id === data.orderId || o.orderNumber === data.orderId) {
              return { ...o, status: 'delivered', speed: 0, isTrackingActive: false };
            }
            return o;
          })
        );
      }
    });

    // 3. Socket.io Real-time WebSocket Listeners
    const unsubSocketUpdate = onTruckPositionUpdate((data) => {
      if (isCancelled || !data?.orderId) return;
      setOrders(prev =>
        prev.map(o => {
          if (o.id === data.orderId || o.orderNumber === data.orderId || o.orderNumber === data.truckNumber) {
            return {
              ...o,
              currentLat: data.lat,
              currentLng: data.lng,
              speed: data.speed,
              heading: data.heading,
              lastGpsUpdate: data.updatedAt || new Date().toISOString()
            };
          }
          return o;
        })
      );
    });

    const unsubSocketDelivered = onDeliveryEnded((data) => {
      if (isCancelled || !data?.orderId) return;
      setOrders(prev =>
        prev.map(o => {
          if (o.id === data.orderId || o.orderNumber === data.orderId || o.orderNumber === data.orderNumber) {
            return { ...o, status: 'delivered', speed: 0, isTrackingActive: false };
          }
          return o;
        })
      );
    });

    return () => {
      isCancelled = true;
      unsubscribe();
      stopOwner?.();
      window.removeEventListener('online', retry);
      unsubSocketUpdate();
      unsubSocketDelivered();
    };
  }, [isAdmin, revision, retry]);

  // Actions
  const addOrder = async (orderData: Omit<RegionalTruckOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>) => {
    const orderNum = `REG-${Math.floor(1000 + Math.random() * 9000)}`;
    const payload: Partial<RegionalTruckOrder> = {
      ...orderData,
      orderNumber: orderNum,
      status: 'new',
      createdAt: new Date().toISOString()
    };

    const created = await ordersApi.create(payload);

    playNotificationSound();
    triggerBrowserPush(
      `🚚 Заявка на фуру (${created.destinationCity}) создана!`,
      `Накладная: ${created.invoiceNumber || 'б/н'} | Дата: ${created.shipmentDate || ''}`
    );

    return created.id;
  };

  const updateOrderStatus = async (
    orderId: string,
    status: RegionalOrderStatus,
    assignedData?: { assignedTruckPlate?: string; assignedDriver?: string; comments?: string }
  ) => {
    const isDispatched = status === 'dispatched';
    const now = new Date().toISOString();

    const updates: Partial<RegionalTruckOrder> = {
      status,
      ...(assignedData || {}),
      ...(isDispatched ? { dispatchedAt: now } : {}),
      updatedAt: now
    };

    const updated = await ordersApi.update(orderId, updates);

    return updated;
  };

  const deleteOrder = async (orderId: string) => {
    await ordersApi.delete(orderId);
  };

  const dismissAlert = () => setLastNewOrderAlert(null);

  return {
    orders,
    loading,
    error,
    retry,
    addOrder,
    updateOrderStatus,
    deleteOrder,
    lastNewOrderAlert,
    dismissAlert,
  };
};
