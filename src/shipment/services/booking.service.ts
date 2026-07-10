import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../entities/shipment.entity';
import { BookingLog } from '../entities/booking-log.entity';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { validateShipmentTransition } from '../shipment-state-machine';
import { TrackingService } from './tracking.service';
import {
  ShipmentBookedEvent,
  ShipmentPickedUpEvent,
  ShipmentDeliveredEvent,
  ShipmentFailedEvent,
  ShipmentRetriedEvent,
} from '../events/shipment.event';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(BookingLog)
    private readonly bookingLogRepo: Repository<BookingLog>,
    private readonly trackingService: TrackingService,
  ) {}

  /**
   * Record a booking attempt (for audit trail).
   */
  async recordBookingLog(
    shipmentId: string,
    data: {
      attempt_number: number;
      courier: string;
      service: string;
      status: string; // SUCCESS | FAILED | TIMEOUT | DRIVER_REJECT
      awb_number?: string;
      request_payload?: any;
      response_data?: any;
      error_message?: string;
      response_time_ms?: number;
      driver_info?: any;
    },
  ): Promise<BookingLog> {
    const log = this.bookingLogRepo.create({
      shipment_id: shipmentId,
      ...data,
    });
    return this.bookingLogRepo.save(log);
  }

  /**
   * Mark shipment as booked (AWB generated).
   * Uses state machine validation. Emits ShipmentBookedEvent.
   */
  async markBooked(
    shipment: Shipment,
    awbData: { biteship_order_id: string; awb_number: string; awb_url: string },
    bookingLogData?: {
      request_payload?: any;
      response_data?: any;
      response_time_ms?: number;
      driver_info?: any;
    },
  ): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.BOOKED);

    shipment.awb_number = awbData.awb_number;
    shipment.awb_url = awbData.awb_url;
    shipment.biteship_order_id = awbData.biteship_order_id;
    shipment.shipment_status = ShipmentStatus.BOOKED;

    const saved = await this.shipmentRepo.save(shipment);

    // Tracking event
    await this.trackingService.recordEvent(
      shipment.id,
      'BOOKED',
      `AWB ${awbData.awb_number} generated`,
      undefined,
      { awb: awbData.awb_number, biteship_order_id: awbData.biteship_order_id },
    );

    // Domain event
    const event = new ShipmentBookedEvent(
      shipment.id, shipment.order_id, awbData.awb_number,
      shipment.courier_name || '', shipment.courier_service || '',
    );

    this.logger.log(`[BOOKING] shipment=${shipment.id} awb=${awbData.awb_number} status=BOOKED`);
    return saved;
  }

  /**
   * Mark shipment as picked up.
   */
  async markPickedUp(shipment: Shipment, location?: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.PICKED_UP);

    shipment.shipment_status = ShipmentStatus.PICKED_UP;
    shipment.picked_up_at = new Date();
    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id, 'PICKUP', 'Package picked up by courier', location,
    );

    return saved;
  }

  /**
   * Mark shipment as in transit.
   */
  async markInTransit(shipment: Shipment, location?: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.IN_TRANSIT);

    shipment.shipment_status = ShipmentStatus.IN_TRANSIT;
    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id, 'TRANSIT', 'Package in transit', location,
    );

    return saved;
  }

  /**
   * Mark shipment as delivered.
   */
  async markDelivered(shipment: Shipment, location?: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.DELIVERED);

    shipment.shipment_status = ShipmentStatus.DELIVERED;
    shipment.delivered_at = new Date();
    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id, 'DELIVERED', 'Package delivered', location,
    );

    return saved;
  }

  /**
   * Mark shipment as failed.
   */
  async markFailed(shipment: Shipment, reason: string): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.FAILED);

    shipment.shipment_status = ShipmentStatus.FAILED;
    shipment.failed_at = new Date();
    shipment.failure_reason = reason;
    shipment.retry_count = (shipment.retry_count || 0) + 1;
    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id, 'FAILED', reason,
    );

    this.logger.warn(`[BOOKING] shipment=${shipment.id} status=FAILED reason=${reason}`);
    return saved;
  }

  /**
   * Retry a failed shipment (reset to PENDING for rebooking).
   */
  async retry(shipment: Shipment): Promise<Shipment> {
    validateShipmentTransition(shipment.shipment_status, ShipmentStatus.PENDING);

    shipment.shipment_status = ShipmentStatus.PENDING;
    shipment.failed_at = null as any;
    shipment.failure_reason = null as any;
    shipment.awb_number = null as any;
    shipment.awb_url = null as any;
    shipment.biteship_order_id = null as any;
    const saved = await this.shipmentRepo.save(shipment);

    await this.trackingService.recordEvent(
      shipment.id, 'RETRY', `Retry attempt #${shipment.retry_count}`,
    );

    return saved;
  }
}