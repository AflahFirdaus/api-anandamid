import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

/**
 * NotificationGateway — Real-time push notification via Socket.io
 *
 * Client connects, lalu join room `user_{userId}`.
 * Server dapat push event `notification` ke room user tertentu.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: [
      'http://localhost:5173',
      'http://192.168.1.178:5173',
      'https://staging.anandam.id',
      'https://anandam.id',
    ],
    credentials: true,
  },
})
export class NotificationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  afterInit(_server: Server) {
    this.logger.log('NotificationGateway initialized');
  }

  handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string) ||
        (client.handshake.headers?.authorization as string)?.replace(
          'Bearer ',
          '',
        );

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      const userId: string = payload.sub;

      // Store userId on socket for later reference
      (client as any).userId = userId;

      // User join their personal room
      client.join(`user_${userId}`);
      this.logger.log(`Client connected: userId=${userId} socketId=${client.id}`);
    } catch {
      this.logger.warn(`Unauthorized socket connection: ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as any).userId;
    this.logger.log(`Client disconnected: userId=${userId ?? 'unknown'} socketId=${client.id}`);
  }

  /**
   * Client can re-join their room manually (e.g. after reconnect)
   */
  @SubscribeMessage('join_notification_room')
  handleJoinRoom(@ConnectedSocket() client: Socket) {
    const userId = (client as any).userId;
    if (userId) {
      client.join(`user_${userId}`);
    }
    return { status: 'joined' };
  }

  /**
   * Push a notification payload to a specific user's room.
   * Called by NotificationService after saving to DB.
   */
  pushToUser(userId: string, payload: Record<string, any>) {
    this.server.to(`user_${userId}`).emit('notification', payload);
  }
}
