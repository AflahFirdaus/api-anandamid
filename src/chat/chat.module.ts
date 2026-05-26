import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { ChatRoom } from "./entities/chat-room.entity";
import { ChatMessage } from "./entities/chat-message.entity";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatRoom, ChatMessage]),
    JwtModule.register({ secret: 'AditPrabowoAnisJokowiCrazyKiller9999+' }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService], // Export jika Gateway (WebSockets) butuh service ini nantinya
})
export class ChatModule {}