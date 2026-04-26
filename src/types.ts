export type ShipmentStatus = 'In Transit' | 'Customs' | 'Delivered' | 'Delay';
export type RouteType = 'Tehran - Almaty' | 'Amol - Almaty';

export interface Shipment {
  id: string;
  invoice_id: string; // e.g., "Mehkaz 61"
  route: RouteType;
  departure_date: string; // ISO string for Firestore Timestamp conversion
  est_travel_time: number; // Days
  arrival_deadline: string; // Computed: departure_date + est_travel_time
  actual_arrival_date?: string;
  customs_date?: string;
  status: ShipmentStatus;
  status_message?: string;
  documents_url: string[]; // Links to Firebase Storage
  last_updated: string;
  createdBy: string;
  items: string[];
  isArchived?: boolean;
}

export type TruckStatus = 'Available' | 'On Route' | 'Maintenance';

export interface Truck {
  id: string;
  plateNumber: string;
  model: string;
  status: TruckStatus;
}

export interface ShipmentLog {
  id: string;
  shipmentId: string;
  timestamp: string;
  location: string;
  message: string;
  updatedBy: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'logistics' | 'viewer';
}
