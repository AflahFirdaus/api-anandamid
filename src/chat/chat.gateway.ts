import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { SocketAuthMiddleware } from './chat.gateway.middleware';

// Mengizinkan CORS agar frontend (Vite) bisa terhubung
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayInit {
  constructor(private jwtService: JwtService) {}

  @WebSocketServer()
  server: Server;

  afterInit(server: Server) {
    server.use(SocketAuthMiddleware(this.jwtService));
  }

  // Event saat User membuka widget chat atau Admin memilih room
  @SubscribeMessage('join_room')
  handleJoinRoom(
    @MessageBody() payload: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`room_${payload.roomId}`);
    return { status: 'joined', room: payload.roomId };
  }

  // Event khusus untuk Admin agar mendapat notifikasi global
  @SubscribeMessage('join_admin')
  handleJoinAdmin(@ConnectedSocket() client: Socket) {
    client.join('room_admins');
    return { status: 'joined', room: 'room_admins' };
  }

  // Event untuk leave room (saat admin pindah ke room lain)
  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @MessageBody() payload: { roomId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`room_${payload.roomId}`);
    return { status: 'left', room: payload.roomId };
  }

  // Fungsi publik ini akan dipanggil oleh Controller setelah HTTP POST sukses
  broadcastNewMessage(roomId: string, message: any) {
    // 1. Sebarkan pesan ke User & Admin yang sedang berada di room tersebut
    this.server.to(`room_${roomId}`).emit('new_message', message);
    
    // 2. Sebarkan sinyal ke dashboard semua Admin untuk update unread badge
    this.server.to('room_admins').emit('new_message_notification', {
      roomId,
      message,
    });
  }
}