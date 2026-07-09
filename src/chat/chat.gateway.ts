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

  // Event untuk Admin bergabung ke channel global admin
  @SubscribeMessage('join_admin')
  handleJoinAdmin(@ConnectedSocket() client: Socket) {
    console.log(`[WS AUDIT] join_admin received from socket ${client.id}`);
    client.join('admin-global');
    const roomSize = this.server.sockets.adapter.rooms.get('admin-global')?.size || 0;
    console.log(`[WS AUDIT] Socket ${client.id} joined admin-global. Total in admin-global: ${roomSize}`);
    return { status: 'joined', room: 'admin-global' };
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

  // Fungsi publik untuk broadcast pesan baru - dipanggil oleh Controller
  broadcastNewMessage(roomId: string, message: any) {
    console.log(`[WS AUDIT] broadcastNewMessage called for roomId: ${roomId}, content: ${message.content?.substring(0, 30)}`);
    
    // 1. Kirim pesan realtime ke User & Admin yang sedang membuka room tersebut
    const roomChannel = `room_${roomId}`;
    const roomSize = this.server.sockets.adapter.rooms.get(roomChannel)?.size || 0;
    console.log(`[WS AUDIT] Emitting 'new_message' to ${roomChannel} (${roomSize} clients)`);
    this.server.to(roomChannel).emit('new_message', message);
    
    // 2. Kirim notifikasi ringan ke semua admin (sidebar update) via admin-global channel
    const adminGlobalSize = this.server.sockets.adapter.rooms.get('admin-global')?.size || 0;
    console.log(`[WS AUDIT] Emitting 'chat:list-updated' to admin-global (${adminGlobalSize} clients) - roomId: ${roomId}`);
    this.server.to('admin-global').emit('chat:list-updated', {
      roomId,
      last_message_content: message.content,
      last_message_at: message.created_at,
      sender_id: message.sender_id,
      buyer_id: message.room?.buyer_id || message.buyer_id,
    });
  }
}