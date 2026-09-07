import { Server as SocketIOServer, Socket } from "socket.io";
import type { Server as HttpServer } from "http";

export interface TruckPositionUpdatePayload {
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
export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    transports: ["websocket", "polling"],
    pingTimeout: 20000,
    pingInterval: 10000
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
  if (!ioInstance) return;

  const payload = {
    orderId: data.orderId,
    truckNumber: data.truckNumber || "—",
    lat: Number(data.lat),
    lng: Number(data.lng),
    heading: data.heading !== undefined ? Number(data.heading) : 0,
    speed: data.speed !== undefined ? Math.max(0, Math.round(data.speed)) : 0,
    updatedAt: data.updatedAt || new Date().toISOString(),
    driverPhone: data.driverPhone,
    assignedDriver: data.assignedDriver,
    status: data.status || "in_transit",
    etaFormatted: data.etaFormatted
  };

  // Broadcast to all clients
  ioInstance.emit("truck_position_update", payload);

  // Also emit into specific order room
  const cleanId = String(data.orderId).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  ioInstance.to(`order:${data.orderId}`).emit("truck_position_update", payload);
  ioInstance.to(`order:${cleanId}`).emit("truck_position_update", payload);
}

/**
 * Broadcast trip completion event
 */
export function emitDeliveryEnded(orderId: string, orderNumber?: string) {
  if (!ioInstance) return;

  const payload: DeliveryEndedPayload = {
    orderId,
    orderNumber: orderNumber || orderId,
    status: "delivered",
    completedAt: new Date().toISOString()
  };

  ioInstance.emit("delivery_ended", payload);

  const cleanId = String(orderId).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  ioInstance.to(`order:${orderId}`).emit("delivery_ended", payload);
  ioInstance.to(`order:${cleanId}`).emit("delivery_ended", payload);
  if (orderNumber) {
    const cleanNum = String(orderNumber).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
    ioInstance.to(`order:${orderNumber}`).emit("delivery_ended", payload);
    ioInstance.to(`order:${cleanNum}`).emit("delivery_ended", payload);
  }

  console.log(`🏁 [Socket.io] Emitted delivery_ended for order ${orderId}`);
}
