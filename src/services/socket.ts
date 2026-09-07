import { io, Socket } from 'socket.io-client';

export interface TruckPositionUpdateData {
  orderId: string;
  truckNumber?: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  updatedAt: string;
  driverPhone?: string;
  assignedDriver?: string;
  status?: string;
  etaFormatted?: string;
}

export interface DeliveryEndedData {
  orderId: string;
  orderNumber?: string;
  status: 'delivered' | 'completed';
  completedAt: string;
}

let socketInstance: Socket | null = null;

/**
 * Get or initialize the singleton Socket.io client instance
 */
export function getSocket(): Socket {
  if (!socketInstance) {
    // In browser, connects to window.location.origin (e.g. http://localhost:3000)
    const serverUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    
    socketInstance = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketInstance.on('connect', () => {
      console.log('⚡ [Socket.io Client] Connected to real-time server:', socketInstance?.id);
    });

    socketInstance.on('disconnect', (reason) => {
      console.warn('⚠️ [Socket.io Client] Disconnected:', reason);
    });

    socketInstance.on('connect_error', (error) => {
      console.warn('❌ [Socket.io Client] Connection error:', error.message);
    });
  }

  return socketInstance;
}

/**
 * Subscribe to real-time truck position updates
 */
export function onTruckPositionUpdate(callback: (data: TruckPositionUpdateData) => void): () => void {
  const socket = getSocket();
  socket.on('truck_position_update', callback);

  return () => {
    socket.off('truck_position_update', callback);
  };
}

/**
 * Subscribe to delivery ended / trip completed events
 */
export function onDeliveryEnded(callback: (data: DeliveryEndedData) => void): () => void {
  const socket = getSocket();
  socket.on('delivery_ended', callback);

  return () => {
    socket.off('delivery_ended', callback);
  };
}

/**
 * Join a specific order room for focused telemetry
 */
export function joinOrderRoom(orderId: string) {
  const socket = getSocket();
  if (socket && orderId) {
    socket.emit('join_order_room', orderId);
  }
}

/**
 * Leave a specific order room
 */
export function leaveOrderRoom(orderId: string) {
  const socket = getSocket();
  if (socket && orderId) {
    socket.emit('leave_order_room', orderId);
  }
}
