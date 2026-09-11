import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { isCrmAdmin, authenticateRequest } from './crm-auth.service.js';
import { afterTrackingCommit } from './tracking-context.js';

export interface TruckPositionUpdatePayload {
  orderId: string;
  orderNumber?: string;
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
  hasRealGps?: boolean;
  isTrackingActive?: boolean;
  driverConsent?: boolean;
}

export interface DeliveryEndedPayload {
  orderId: string;
  orderNumber?: string;
  status: 'delivered' | 'completed';
  completedAt: string;
}

let ioInstance: SocketIOServer | null = null;

/**
 * Initialize Socket.io server and bind to HTTP server
 */
export function initSocketServer(httpServer: HttpServer, authenticate = authenticateRequest): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"],
    pingTimeout: 20000,
    pingInterval: 10000
  });

  io.use((socket, next) => {
    authenticate(socket.request, socket.handshake.auth?.token).then(() => next()).catch(() => next(new Error('Firebase authentication required')));
  });
  io.on("connection", (socket: Socket) => {
    // Client joins order-specific room
    socket.on("join_order_room", (orderId: string) => {
      if (orderId) {
        const cleanId = String(orderId).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
        socket.join(`order:${orderId}`);
        socket.join(`order:${cleanId}`);
      }
    });

    // Client leaves order-specific room
    socket.on("leave_order_room", (orderId: string) => {
      if (orderId) {
        const cleanId = String(orderId).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
        socket.leave(`order:${orderId}`);
        socket.leave(`order:${cleanId}`);
      }
    });

    socket.on("disconnect", () => {
      // Disconnect handling
    });
  });

  ioInstance = io;
  console.log("⚡ [Socket.io] Real-time WebSocket server initialized");
  return io;
}

/**
 * Get the active Socket.io server instance
 */
export function getSocketServer(): SocketIOServer | null {
  return ioInstance;
}

/**
 * Broadcast real-time position of a truck along its route.
 * Emits directly to order room and globally to active dispatchers.
 */
export function emitTruckPositionUpdate(data: TruckPositionUpdatePayload) {
  afterTrackingCommit(() => sendTruckPositionUpdate(data));
}
function sendTruckPositionUpdate(data: TruckPositionUpdatePayload) {
  if (!ioInstance) return;

  const payload = {
    orderId: data.orderId,
    orderNumber: data.orderNumber,
    truckNumber: data.truckNumber || "—",
    lat: Number(data.lat),
    lng: Number(data.lng),
    heading: data.heading !== undefined ? Number(data.heading) : 0,
    speed: data.speed !== undefined ? Math.max(0, Math.round(data.speed)) : 0,
    updatedAt: data.updatedAt || new Date().toISOString(),
    driverPhone: data.driverPhone,
    assignedDriver: data.assignedDriver,
    status: data.status || "in_transit",
    etaFormatted: data.etaFormatted,
    hasRealGps: data.hasRealGps,
    isTrackingActive: data.isTrackingActive,
    driverConsent: data.driverConsent
  };

  // Re-check role for every position, including connections opened before revocation.
  for (const socket of ioInstance.sockets.sockets.values()) {
    if (isCrmAdmin(socket.request)) socket.emit("truck_position_update", payload);
  }

}

/**
 * Broadcast trip completion event
 */
export function emitDeliveryEnded(orderId: string, orderNumber?: string) {
  afterTrackingCommit(() => sendDeliveryEnded(orderId, orderNumber));
}
function sendDeliveryEnded(orderId: string, orderNumber?: string) {
  if (!ioInstance) return;

  const payload: DeliveryEndedPayload = {
    orderId,
    orderNumber: orderNumber || orderId,
    status: "delivered",
    completedAt: new Date().toISOString()
  };

  ioInstance.emit("delivery_ended", payload);


  console.log(`🏁 [Socket.io] Emitted delivery_ended for order ${orderId}`);
}
