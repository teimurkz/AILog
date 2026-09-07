/**
 * Local REST & Realtime API Client
 * 100% Local, zero external cloud dependencies.
 */

import {
  RegionalTruckOrder,
  Shipment,
  ShipmentLog,
  Truck,
  SavedDeliveryContact,
  UserProfile
} from '../types';

const BASE_URL = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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

let activeEventSource: EventSource | null = null;
const listeners = new Set<RealtimeEventHandler>();

export function subscribeToRealtimeStream(handler: RealtimeEventHandler): () => void {
  listeners.add(handler);

  if (!activeEventSource && typeof window !== 'undefined' && 'EventSource' in window) {
    try {
      activeEventSource = new EventSource('/api/realtime/stream');

      const eventNames = [
        'order_created',
        'order_updated',
        'order_deleted',
        'order_completed',
        'telemetry_update',
        'shipment_created',
        'shipment_updated',
        'shipment_deleted',
        'shipment_log_added',
        'truck_updated',
        'truck_deleted',
        'contact_updated',
        'contact_deleted',
        'user_updated',
        'user_deleted'
      ];

      eventNames.forEach(name => {
        activeEventSource?.addEventListener(name, (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            listeners.forEach(cb => cb(name, data));
          } catch (e) {
            console.warn(`[SSE Parse Error] ${name}:`, e);
          }
        });
      });

      activeEventSource.onerror = () => {
        // EventSource automatically retries connection
      };
    } catch (e) {
      console.warn('[SSE Init Error]:', e);
    }
  }

  return () => {
    listeners.delete(handler);
    if (listeners.size === 0 && activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
  };
}
