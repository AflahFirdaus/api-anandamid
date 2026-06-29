import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, LessThan, In } from "typeorm";


import { ChatRoom } from "./entities/chat-room.entity";
import { ChatMessage, ChatMessageType } from "./entities/chat-message.entity";
import { CreateMessageDto } from "./dto/create-message.dto";
import { User } from "../user/entities/user.entity";

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRoom)
    private roomRepository: Repository<ChatRoom>,

    @InjectRepository(ChatMessage)
    private messageRepository: Repository<ChatMessage>,

    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  // 1. Inisialisasi atau ambil room user
  async getOrCreateRoom(buyerId: string) {
    let room = await this.roomRepository.findOne({
      where: { buyer_id: buyerId },
    });

    if (!room) {
      room = this.roomRepository.create({ buyer_id: buyerId });
      await this.roomRepository.save(room);
    }
    return room;
  }

  // 2. Ambil list room untuk Dashboard Admin atau User
  async findAllRooms(userPayload: any) {
    // Admin payload: { sub, username }
    // User payload: { sub, email, role: 'USER' }
    const isAdmin = userPayload?.username !== undefined || userPayload?.role === 'admin' || (userPayload?.role !== 'USER' && !userPayload?.email);

    if (isAdmin) {
      // Admin: ambil semua room beserta nama pembeli
      const rooms = await this.roomRepository.find({
        order: { last_message_at: "DESC" },
      });

      // Ambil data user untuk setiap room
      const buyerIds = rooms.map(room => room.buyer_id);
      const users = buyerIds.length > 0 ? await this.userRepository.findBy({ id: In(buyerIds) }) : [];
      const userMap = new Map(users.map(u => [u.id, u.full_name]));

      return rooms.map(room => ({
        ...room,
        buyer_name: userMap.get(room.buyer_id) || null,
      }));
    } else {
      // Jika user biasa, ambil hanya room miliknya
      const userId = userPayload?.sub || userPayload?.id;
      const rooms = await this.roomRepository.find({
        where: { buyer_id: userId },
        order: { last_message_at: "DESC" },
      });

      return rooms.map(room => ({
        ...room,
        buyer_name: null,
      }));
    }
  }

  // 3. Simpan pesan (TEXT atau MEDIA)
  async saveMessage(dto: CreateMessageDto, mediaUrl?: string | null) {
    const room = await this.roomRepository.findOne({
      where: { id: dto.room_id },
    });

    if (!room) {
      throw new NotFoundException("Chat room not found");
    }

    // 🔥 PERBAIKAN DI SINI: Gunakan || "" agar dipaksa menjadi string murni
    const finalContent = mediaUrl || dto.content || "";
    
    // Opsional: Validasi untuk mencegah pesan kosong masuk ke database
    if (!finalContent) {
      throw new BadRequestException("Message content cannot be empty");
    }

    const messageType = dto.message_type || ChatMessageType.TEXT;

    const message = this.messageRepository.create({
      room,
      sender_id: dto.sender_id,
      message_type: messageType,
      content: finalContent, // Sekarang finalContent murni bertipe 'string'
      product_id: dto.product_id || null,
    });

    const savedMessage = await this.messageRepository.save(message);

    // Update data denormalisasi di tabel Room
    room.last_message_content =
      messageType === ChatMessageType.TEXT ? finalContent : `[${messageType}]`;
    room.last_message_at = new Date();

    // Logika unread count: Jika pengirim adalah pembeli, tambah unread admin
    if (dto.sender_id === room.buyer_id) {
      room.unread_count_admin += 1;
    } else {
      room.unread_count_buyer += 1;
    }

    await this.roomRepository.save(room);

    const fullyLoadedMessage = await this.messageRepository.findOne({
      where: { id: savedMessage.id },
      relations: ['room', 'product', 'product.images']
    });

    return fullyLoadedMessage;
  }

  // 4. Ambil pesan dengan Cursor-Based Pagination
  async getMessages(roomId: string, cursorId?: string, limit: number = 20) {
    const whereCondition: any = { room: { id: roomId } };

    if (cursorId) {
      whereCondition.id = LessThan(cursorId);
    }

    const messages = await this.messageRepository.find({
      where: whereCondition,
      order: { id: "DESC" }, // Urutkan dari terbaru
      take: limit,
      relations: ['product', 'product.images'],
    });

    // Balik urutan untuk frontend agar yang terlama di atas
    return messages.reverse(); 
  }

  // 5. Reset unread count saat admin membuka chat
  async markRoomAsReadAdmin(roomId: string) {
    await this.roomRepository.update(roomId, { unread_count_admin: 0 });
    return { message: "Room marked as read by admin" };
  }

  // 6. Reset unread count saat buyer membuka chat
  async markRoomAsReadBuyer(roomId: string) {
    await this.roomRepository.update(roomId, { unread_count_buyer: 0 });
    return { message: "Room marked as read by buyer" };
  }
}