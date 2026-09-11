import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { subscribeToOwnerOrders, subscribeToOwnerGps } from '../services/firestore-collections';
import { ordersApi } from '../services/api';
import { mergeOrderGps, type GpsDocument } from '../../shared/gps-projection';
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
  const { isAdmin, user } = useAuth();
  const [orders, setOrders] = useState<RegionalTruckOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  const [lastNewOrderAlert, setLastNewOrderAlert] = useState<RegionalTruckOrder | null>(null);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let fetching = false;
    let ownerOrders: RegionalTruckOrder[] = [];
    let positions: GpsDocument[] = [];
    knownOrderIdsRef.current = new Set();
    initialLoadDoneRef.current = false;
    setOrders([]);
    setLoading(true);
    setError(null);
    setGpsError(null);
    const publish = (list: RegionalTruckOrder[]) => {
      if (cancelled) return;
      if (initialLoadDoneRef.current) for (const order of list) {
        if (!knownOrderIdsRef.current.has(order.id)) {
          playNotificationSound();
          triggerBrowserPush(`Новая заявка ${order.orderNumber}`, `Город: ${order.destinationCity}`);
          setLastNewOrderAlert(order);
        }
      }
      list.forEach(order => knownOrderIdsRef.current.add(order.id));
      initialLoadDoneRef.current = true;
      setOrders([...list].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)));
    };
    const load = async () => {
      if (cancelled || isAdmin || fetching) return;
      clearTimeout(timer);
      fetching = true;
      try {
        // Staff receive existing documents with GPS removed by Firebase Functions.
        // No local API server or new copy of the business database is required.
        if (!document.hidden || !initialLoadDoneRef.current) {
          const list = await ordersApi.getAll();
          if (!cancelled) { publish(list); setError(null); setLoading(false); }
        }
      } catch (error) {
        if (!cancelled) { setError(error instanceof Error ? error.message : 'Не удалось загрузить заявки из Firebase.'); setLoading(false); }
      } finally {
        fetching = false;
        if (!cancelled) timer = setTimeout(() => void load(), 20000);
      }
    };
    const stopOrders = isAdmin ? subscribeToOwnerOrders<RegionalTruckOrder>(state => {
      if (cancelled) return;
      if (state.confirmed || state.data.length) { ownerOrders = state.data; publish(mergeOrderGps(ownerOrders, positions)); }
      setLoading(state.loading);
      setError(state.error);
    }) : () => {};
    const stopGps = isAdmin ? subscribeToOwnerGps<GpsDocument>(state => {
      if (cancelled) return;
      if (state.confirmed || state.data.length) {
        positions = state.data;
        if (initialLoadDoneRef.current) publish(mergeOrderGps(ownerOrders, positions));
      }
      setGpsError(state.error);
    }) : () => {};
    const visible = () => { if (!document.hidden) void load(); };
    if (!isAdmin) void load();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', visible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stopOrders(); stopGps();
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [isAdmin, user?.uid, revision, retry]);

  const addOrder = async (orderData: Omit<RegionalTruckOrder, 'id' | 'orderNumber' | 'createdAt' | 'status'>) => {
    const created = await ordersApi.create({ ...orderData,
      orderNumber: `REG-${Math.floor(1000 + Math.random() * 9000)}`, status: 'new', createdAt: new Date().toISOString() });
    knownOrderIdsRef.current.add(created.id);
    setOrders(prev => [created, ...prev.filter(order => order.id !== created.id)]);
    return created.id;
  };
  const updateOrderStatus = async (orderId: string, status: RegionalOrderStatus,
    assignedData?: { assignedTruckPlate?: string; assignedDriver?: string; comments?: string }) => {
    const now = new Date().toISOString();
    const updated = await ordersApi.update(orderId, { status, ...assignedData,
      ...(status === 'dispatched' ? { dispatchedAt: now } : {}), updatedAt: now });
    setOrders(prev => prev.map(order => order.id === updated.id ? { ...order, ...updated } : order));
    return updated;
  };
  const deleteOrder = async (id: string) => {
    await ordersApi.delete(id);
    setOrders(prev => prev.filter(order => order.id !== id));
  };
  return { orders, loading, error: error || gpsError, retry, addOrder, updateOrderStatus, deleteOrder,
    lastNewOrderAlert, dismissAlert: () => setLastNewOrderAlert(null) };
};
