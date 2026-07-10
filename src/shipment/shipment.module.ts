import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Shipment } from './entities/shipment.entity';
import { ShipmentTracking } from './entities/shipment-tracking.entity';
import { ShipmentItem } from './entities/shipment-item.entity';
import { BookingLog } from './entities/booking-log.entity';
import { ShipmentFile } from './entities/shipment-file.entity';
import { WebhookLog } from './entities/webhook-log.entity';
import { Outbox } from './entities/outbox.entity';
import { CourierCapability } from './entities/courier-capability.entity';
import { ShipmentService } from './services/shipment.service';
import { BookingService } from './services/booking.service';
import { LabelService } from './services/label.service';
import { PdfLabelService } from './services/pdf-label.service';
import { TrackingService } from './services/tracking.service';
import { CourierCapabilityService } from './services/courier-capability.service';
import { OutboxService } from './services/outbox.service';
import { WebhookLogService } from './services/webhook-log.service';
import { ShipmentCronService } from './shipment-cron.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Shipment, ShipmentTracking, ShipmentItem, BookingLog, ShipmentFile, WebhookLog, Outbox, CourierCapability]),
  ],
  providers: [
    ShipmentService,
    BookingService,
    LabelService,
    PdfLabelService,
    TrackingService,
    CourierCapabilityService,
    OutboxService,
    WebhookLogService,
    ShipmentCronService,
  ],
  exports: [
    ShipmentService,
    BookingService,
    LabelService,
    PdfLabelService,
    TrackingService,
    CourierCapabilityService,
    OutboxService,
    WebhookLogService,
    ShipmentCronService,
  ],
})
export class ShipmentModule implements OnModuleInit {
  constructor(
    private readonly courierCapabilityService: CourierCapabilityService,
  ) {}

  async onModuleInit() {
    await this.courierCapabilityService.seedDefaults();
  }
}
