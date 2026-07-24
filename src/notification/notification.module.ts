import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { NotificationGateway } from './notification.gateway';
import { User } from '../user/entities/user.entity';
import { WhatsappService } from './whatsapp.service';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, User]),
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  controllers: [NotificationController, EmailController],
  providers: [NotificationService, NotificationGateway, WhatsappService, EmailService],
  exports: [NotificationService, WhatsappService, EmailService],
})
export class NotificationModule {}
