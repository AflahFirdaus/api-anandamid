import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { ChatRoom } from "./chat-room.entity";
import { Product } from "src/product/entities/product.entity";

export enum ChatMessageType {
  TEXT = "TEXT",
  IMAGE = "IMAGE",
  VIDEO = "VIDEO",
  FILE = "FILE",
}

@Entity("chat_messages")
export class ChatMessage {
  // Menggunakan increment BIGINT untuk kebutuhan Cursor Pagination
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id: string;

  @ManyToOne(() => ChatRoom, (room) => room.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "room_id" })
  room: ChatRoom;

  @Column({ type: "uuid" })
  sender_id: string;

  @Column({ type: "enum", enum: ChatMessageType, default: ChatMessageType.TEXT })
  message_type: ChatMessageType;

  @Column({ type: "text" })
  content: string;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @ManyToOne(() => Product, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: "product_id" })
  product: Product | null;

  @Column({ type: "uuid", nullable: true })
  product_id: string | null;
}