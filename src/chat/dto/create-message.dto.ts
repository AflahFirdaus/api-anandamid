import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { ChatMessageType } from '../entities/chat-message.entity';

export class CreateMessageDto {
  @IsUUID()
  room_id: string;

  @IsUUID()
  sender_id: string;

  @IsOptional()
  @IsEnum(ChatMessageType)
  message_type?: ChatMessageType;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsUUID()
  product_id?: string;
}