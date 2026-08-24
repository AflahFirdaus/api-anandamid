import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Query,
  UseInterceptors,
  UploadedFile,
  Headers,
  UnauthorizedException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';

import { ChatService } from './chat.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ChatGateway } from './chat.gateway';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/guards/jwt.guards';
import { JwtUserGuard } from '../user/guards/jwt-user.guard';

// Hanya izinkan JPG, PNG, PDF
const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

// Filter file untuk multer
const fileFilter = (
  req: any,
  file: Express.Multer.File,
  cb: (error: any, accept: boolean) => void,
) => {
  const ext = extname(file.originalname).toLowerCase();
  if (
    !ALLOWED_MIMETYPES.includes(file.mimetype) &&
    !ALLOWED_EXTENSIONS.includes(ext)
  ) {
    return cb(
      new BadRequestException(
        'Hanya file JPG, PNG, dan PDF yang diperbolehkan',
      ),
      false,
    );
  }
  cb(null, true);
};

// Konfigurasi upload
const chatMediaStorage = diskStorage({
  destination: './uploads/chat-media',
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() +
      '-' +
      Math.round(Math.random() * 1e9) +
      extname(file.originalname);

    cb(null, uniqueName);
  },
});

// Multer options dengan filter
const chatMediaUpload = {
  storage: chatMediaStorage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
};

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway, // 🔥 Inject Gateway di sini
    private readonly jwtService: JwtService,
  ) {}

  @Post('room')
  @UseGuards(JwtUserGuard)
  getOrCreateRoom(@Body('buyer_id') buyerId: string) {
    return this.chatService.getOrCreateRoom(buyerId);
  }

  @Get('rooms')
  findAllRooms(@Headers('authorization') authHeader?: string) {
    let payload: any = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        payload = this.jwtService.verify(token);
      } catch (err) {
        throw new UnauthorizedException('Invalid token');
      }
    } else {
      throw new UnauthorizedException('Token required');
    }
    return this.chatService.findAllRooms(payload);
  }

  @Get('room/:roomId/messages')
  @UseGuards(JwtUserGuard)
  getMessages(
    @Param('roomId') roomId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const take = limit ? parseInt(limit, 10) : 20;
    return this.chatService.getMessages(roomId, cursor, take);
  }

  @Patch('room/:roomId/read/admin')
  @UseGuards(JwtAuthGuard)
  markAsReadAdmin(@Param('roomId') roomId: string) {
    return this.chatService.markRoomAsReadAdmin(roomId);
  }

  @Patch('room/:roomId/read/buyer')
  @UseGuards(JwtUserGuard)
  markAsReadBuyer(@Param('roomId') roomId: string) {
    return this.chatService.markRoomAsReadBuyer(roomId);
  }

  // 🔥 Fungsi sendMessage HANYA SATU dan sudah dilengkapi Gateway
  @Post('message')
  @UseGuards(JwtUserGuard)
  @UseInterceptors(FileInterceptor('media', chatMediaUpload))
  async sendMessage(
    @Body() dto: CreateMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const mediaUrl = file ? `/uploads/chat-media/${file.filename}` : null;

    // 1. Simpan ke PostgreSQL
    const savedMessage = await this.chatService.saveMessage(dto, mediaUrl);

    // 2. Broadcast secara Real-Time via WebSocket
    this.chatGateway.broadcastNewMessage(dto.room_id, savedMessage);

    // 3. Kembalikan respons ke pengirim (HTTP Response)
    return savedMessage;
  }
}
