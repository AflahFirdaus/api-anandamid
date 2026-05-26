import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { WsException } from '@nestjs/websockets';

export const SocketAuthMiddleware = (jwtService: JwtService) => {
  return async (socket: Socket, next: (err?: Error) => void) => {
    try {
      // Ambil token dari handshake (biasanya dikirim di 'auth' object)
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error('Authentication error: Token missing'));
      }

      // Verifikasi token (sesuaikan dengan secret key JWT Anda)
      const payload = jwtService.verify(token); 
      
      // Simpan data user ke dalam socket agar bisa dipakai di gateway
      socket.data.user = payload; 
      
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  };
};