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
import { readCrmCollection, readCrmDocument, readShipmentLogs, saveCrmDocument, deleteCrmDocument, addShipmentLog } from './firestore-collections';
const BASE_URL = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await firebaseFetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {})
    },
    ...options
  });

  if (!res.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Не получен ответ Firebase Cloud Functions. Опубликуйте функцию crmApi в существующем Firebase-проекте.');
  }

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
    return readCrmCollection<Shipment>('shipments');
  },

  getById: (id: string) => {
    return readCrmDocument<Shipment>('shipments', id);
  },

  create: (shipment: Partial<Shipment>) => {
    return saveCrmDocument<Shipment>('shipments', { ...shipment, last_updated: new Date().toISOString() }, shipment.id);
  },

  update: (id: string, updates: Partial<Shipment>) => {
    return saveCrmDocument<Shipment>('shipments', { ...updates, last_updated: new Date().toISOString() }, id, true);
  },

  delete: (id: string) => {
    return deleteCrmDocument('shipments', id);
  },

  getLogs: (shipmentId: string) => {
    return readShipmentLogs<ShipmentLog>(shipmentId);
  },

  addLog: (shipmentId: string, log: { location?: string; message: string; updatedBy?: string }) => {
    return addShipmentLog<ShipmentLog>(shipmentId, log);
  }
};

// ---------------------------------------------------------------------------
// 3. Saved Trucks & Delivery Contacts
// ---------------------------------------------------------------------------

export const contactsApi = {
  getTrucks: () => readCrmCollection<Truck>('saved_trucks'),
  saveTruck: (truck: Partial<Truck>) =>
    saveCrmDocument<Truck>('saved_trucks', truck, truck.id),
  deleteTruck: (id: string) =>
    deleteCrmDocument('saved_trucks', id),

  getContacts: () => readCrmCollection<SavedDeliveryContact>('saved_delivery_contacts'),
  saveContact: (contact: Partial<SavedDeliveryContact>) =>
    saveCrmDocument<SavedDeliveryContact>('saved_delivery_contacts', contact, contact.id),
  deleteContact: (id: string) =>
    deleteCrmDocument('saved_delivery_contacts', id)
};

// ---------------------------------------------------------------------------
// 4. Users API
// ---------------------------------------------------------------------------

export const usersApi = {
  getAll: () => readCrmCollection<UserProfile>('users'),
  getById: (uid: string) => readCrmDocument<UserProfile>('users', uid),
  create: (user: Partial<UserProfile>) =>
    saveCrmDocument<UserProfile>('users', user, user.uid),
  update: (uid: string, updates: Partial<UserProfile>) =>
    saveCrmDocument<UserProfile>('users', updates, uid, true),
  delete: (uid: string) =>
    deleteCrmDocument('users', uid)
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
