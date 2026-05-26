import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { ChatMessage } from "./chat-message.entity";

@Entity("chat_rooms")
export class ChatRoom {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid", unique: true })
  buyer_id: string;

  @Column({ type: "int", default: 0 })
  unread_count_admin: number;

  @Column({ type: "int", default: 0 })
  unread_count_buyer: number;

  @Column({ type: "text", nullable: true })
  last_message_content: string | null;

  @Column({ type: "timestamptz", nullable: true })
  last_message_at: Date | null;

  @OneToMany(() => ChatMessage, (message) => message.room)
  messages: ChatMessage[];

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;
}