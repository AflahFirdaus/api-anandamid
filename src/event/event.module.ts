import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Event } from './entities/event.entity';
import { EventResponse } from './entities/event-response.entity';
import { EventService } from './event.service';
import { AdminEventController } from './admin-event.controller';
import { PublicEventController } from './public-event.controller';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Event, EventResponse]),
    NotificationModule,
  ],
  controllers: [AdminEventController, PublicEventController],
  providers: [EventService],
})
export class EventModule {}
