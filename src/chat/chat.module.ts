import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ChatRoom } from "./entities/chat-room.entity";
import { ChatMessage } from "./entities/chat-message.entity";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";
import { ChatGateway } from "./chat.gateway";
import { User } from "../user/entities/user.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatRoom, ChatMessage, User]),
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>("JWT_SECRET");
        if (!secret) {
          throw new Error("FATAL: JWT_SECRET environment variable is missing in ChatModule!");
        }
        return {
          secret,
        };
      },
    }),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
