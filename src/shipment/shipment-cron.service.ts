import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Shipment } from './entities/shipment.entity';
import { ShipmentStatus } from './enums/shipment-status.enum';
import { ShipmentService } from './services/shipment.service';

/**
 * Shipment Cron Service — handles scheduled tasks for shipments.
 * Does NOT contain business logic directly; delegates to ShipmentService.
 */
@Injectable()
export class ShipmentCronService {
  private readonly logger = new Logger(ShipmentCronService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    private readonly shipmentService: ShipmentService,
  ) {}

  /**
   * Retry shipments stuck in BOOKING for more than 5 minutes.
   * Should be called every minute via cron.
   */
  async retryStuckBooking(): Promise<number> {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuck = await this.shipmentRepo.find({
      where: {
        shipment_status: ShipmentStatus.PENDING, // PENDING with no booking after 5 min
        created_at: LessThan(fiveMinAgo),
      },
    });

    let count = 0;
    for (const shipment of stuck) {
      try {
        // If no AWB after 5 minutes, mark as failed so admin can retry
        if (!shipment.awb_number) {
          await this.shipmentService.markFailed(shipment, 'Booking timeout — no AWB generated within 5 minutes');
          this.logger.warn(`[CRON] Booking timeout: shipment=${shipment.id}`);
          count++;
        }
      } catch (err: any) {
        this.logger.error(`[CRON] Failed to process stuck shipment ${shipment.id}: ${err.message}`);
      }
    }
    return count;
  }

  /**
   * Auto-retry failed shipments (up to 3 retries).
   * Should be called every 30 minutes via cron.
   */
  async autoRetryFailedShipments(): Promise<number> {
    const failed = await this.shipmentRepo.find({
      where: { shipment_status: ShipmentStatus.FAILED },
    });

    let count = 0;
    for (const shipment of failed) {
      if (shipment.retry_count >= 3) continue; // Max 3 retries
      try {
        await this.shipmentService.retryShipment(shipment);
        this.logger.log(`[CRON] Auto-retry: shipment=${shipment.id} attempt=${shipment.retry_count + 1}`);
        count++;
      } catch (err: any) {
        this.logger.warn(`[CRON] Auto-retry failed for ${shipment.id}: ${err.message}`);
      }
    }
    return count;
  }

  /**
   * Notify admin for shipments stuck in WAITING_PICKUP for more than 24 hours.
   * Should be called every hour via cron.
   */
  async notifyStuckPickup(): Promise<number> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const stuck = await this.shipmentRepo.find({
      where: {
        shipment_status: ShipmentStatus.BOOKED,
        created_at: LessThan(oneDayAgo),
        picked_up_at: null as any,
      },
    });

    if (stuck.length > 0) {
      this.logger.warn(`[CRON] ${stuck.length} shipments stuck in BOOKED > 24 hours`);
      // Emit notification event here (Notification module subscribes)
    }
    return stuck.length;
  }
}