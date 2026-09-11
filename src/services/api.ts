/**
 * Firebase-backed REST & realtime API client.
 */

import {
  RegionalTruckOrder,
  Shipment,
  ShipmentLog,
  Truck,
  SavedDeliveryContact,
  UserProfile
} from '../types';

import { firebaseFetch } from './firebase-fetch';
const BASE_URL = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await firebaseFetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    let msg = `HTTP error ${res.status}`;
    try {
      const err = await res.json();
      if (err.error) msg = err.error;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// 1. Regional Orders API
// ---------------------------------------------------------------------------

export const ordersApi = {
  getAll: (params?: { status?: string; city?: string; driver?: string; search?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.city) query.set('city', params.city);
    if (params?.driver) query.set('driver', params.driver);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return fetchJson<RegionalTruckOrder[]>(`${BASE_URL}/orders/regional${qs ? '?' + qs : ''}`);
  },

  getById: (id: string) => {
    return fetchJson<RegionalTruckOrder>(`${BASE_URL}/orders/regional/${encodeURIComponent(id)}`);
  },

  create: (order: Partial<RegionalTruckOrder>) => {
    return fetchJson<RegionalTruckOrder>(`${BASE_URL}/orders/regional`, {
      method: 'POST',
      body: JSON.stringify(order)
    });
  },

  update: (id: string, updates: Partial<RegionalTruckOrder>) => {
    return fetchJson<RegionalTruckOrder>(`${BASE_URL}/orders/regional/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  delete: (id: string) => {
    return fetchJson<{ success: boolean; id: string }>(`${BASE_URL}/orders/regional/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  }
};

// ---------------------------------------------------------------------------
// 2. International Shipments API
// ---------------------------------------------------------------------------

export const shipmentsApi = {
  getAll: () => {
    return fetchJson<Shipment[]>(`${BASE_URL}/shipments`);
  },

  getById: (id: string) => {
    return fetchJson<Shipment>(`${BASE_URL}/shipments/${encodeURIComponent(id)}`);
  },

  create: (shipment: Partial<Shipment>) => {
    return fetchJson<Shipment>(`${BASE_URL}/shipments`, {
      method: 'POST',
      body: JSON.stringify(shipment)
    });
  },

  update: (id: string, updates: Partial<Shipment>) => {
    return fetchJson<Shipment>(`${BASE_URL}/shipments/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updates)
    });
  },

  delete: (id: string) => {
    return fetchJson<{ success: boolean; id: string }>(`${BASE_URL}/shipments/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  getLogs: (shipmentId: string) => {
    return fetchJson<ShipmentLog[]>(`${BASE_URL}/shipments/${encodeURIComponent(shipmentId)}/logs`);
  },

  addLog: (shipmentId: string, log: { location?: string; message: string; updatedBy?: string }) => {
    return fetchJson<ShipmentLog>(`${BASE_URL}/shipments/${encodeURIComponent(shipmentId)}/logs`, {
      method: 'POST',
      body: JSON.stringify(log)
    });
  }
};

// ---------------------------------------------------------------------------
// 3. Saved Trucks & Delivery Contacts
// ---------------------------------------------------------------------------

export const contactsApi = {
  getTrucks: () => fetchJson<Truck[]>(`${BASE_URL}/saved-trucks`),
  saveTruck: (truck: Partial<Truck>) =>
    fetchJson<Truck>(`${BASE_URL}/saved-trucks`, { method: 'POST', body: JSON.stringify(truck) }),
  deleteTruck: (id: string) =>
    fetchJson<{ success: boolean }>(`${BASE_URL}/saved-trucks/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getContacts: () => fetchJson<SavedDeliveryContact[]>(`${BASE_URL}/delivery-contacts`),
  saveContact: (contact: Partial<SavedDeliveryContact>) =>
    fetchJson<SavedDeliveryContact>(`${BASE_URL}/delivery-contacts`, { method: 'POST', body: JSON.stringify(contact) }),
  deleteContact: (id: string) =>
    fetchJson<{ success: boolean }>(`${BASE_URL}/delivery-contacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
};

// ---------------------------------------------------------------------------
// 4. Users API
// ---------------------------------------------------------------------------

export const usersApi = {
  getAll: () => fetchJson<UserProfile[]>(`${BASE_URL}/users`),
  getById: (uid: string) => fetchJson<UserProfile>(`${BASE_URL}/users/${encodeURIComponent(uid)}`),
  create: (user: Partial<UserProfile>) =>
    fetchJson<UserProfile>(`${BASE_URL}/users`, { method: 'POST', body: JSON.stringify(user) }),
  update: (uid: string, updates: Partial<UserProfile>) =>
    fetchJson<UserProfile>(`${BASE_URL}/users/${encodeURIComponent(uid)}`, { method: 'PUT', body: JSON.stringify(updates) }),
  delete: (uid: string) =>
    fetchJson<{ success: boolean }>(`${BASE_URL}/users/${encodeURIComponent(uid)}`, { method: 'DELETE' })
};

// ---------------------------------------------------------------------------
// 5. File Upload API (Local server storage)
// ---------------------------------------------------------------------------

export const uploadApi = {
  uploadFile: async (fileData: string, fileName?: string, fileType?: string) => {
    return fetchJson<{ success: boolean; url: string; fileName: string; fileSize: number }>(`${BASE_URL}/upload`, {
      method: 'POST',
      body: JSON.stringify({ fileData, fileName, fileType })
    });
  }
};

// ---------------------------------------------------------------------------
// 6. Server-Sent Events (SSE) Realtime Event Stream
// ---------------------------------------------------------------------------

export type RealtimeEventHandler = (eventType: string, data: any) => void;
const listeners = new Set<RealtimeEventHandler>();
let streamController: AbortController | null = null;
export function subscribeToRealtimeStream(handler: RealtimeEventHandler): () => void {
  listeners.add(handler);
  if (!streamController) {
    const controller = new AbortController();
    streamController = controller;
    void (async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await firebaseFetch('/api/realtime/stream', { signal: controller.signal });
          if (!response.ok || !response.body) throw new Error('Realtime unavailable');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            let end: number;
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const message = buffer.slice(0, end); buffer = buffer.slice(end + 2);
              const type = message.match(/^event: (.+)$/m)?.[1];
              const json = message.match(/^data: (.+)$/m)?.[1];
              if (type && json) {
                try { const data = JSON.parse(json); listeners.forEach(cb => cb(type, data)); } catch {}
              }
            }
          }
        } catch { /* Retry with a refreshed Firebase token. */ }
        if (!controller.signal.aborted) await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 1500);
          controller.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
    })();
  }
  return () => {
    listeners.delete(handler);
    if (!listeners.size) { streamController?.abort(); streamController = null; }
  };
}
