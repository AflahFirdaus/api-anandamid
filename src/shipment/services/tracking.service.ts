import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShipmentTracking } from '../entities/shipment-tracking.entity';
import { Shipment } from '../entities/shipment.entity';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectRepository(ShipmentTracking)
    private readonly trackingRepo: Repository<ShipmentTracking>,
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
  ) {}

  /**
   * Record a tracking event for a shipment.
   */
  async recordEvent(
    shipmentId: string,
    event: string,
    description?: string,
    location?: string,
    metadata?: Record<string, any>,
  ): Promise<ShipmentTracking> {
    const tracking = this.trackingRepo.create({
      shipment_id: shipmentId,
      event,
      description,
      location,
      metadata,
    });
    const saved = await this.trackingRepo.save(tracking);
    this.logger.log(`[TRACKING] shipment=${shipmentId} event=${event} location=${location || '-'}`);
    return saved;
  }

  /**
   * Get all tracking events for a shipment, ordered by time.
   */
  async getEvents(shipmentId: string): Promise<ShipmentTracking[]> {
    return this.trackingRepo.find({
      where: { shipment_id: shipmentId },
      order: { occurred_at: 'ASC' },
    });
  }

  /**
   * Get tracking events for an order (via shipment).
   */
  async getEventsByOrder(orderId: string): Promise<ShipmentTracking[]> {
    const shipments = await this.shipmentRepo.find({
      where: { order_id: orderId },
    });
    if (shipments.length === 0) return [];
    const shipmentIds = shipments.map((s) => s.id);
    return this.trackingRepo.find({
      where: shipmentIds.map((id) => ({ shipment_id: id })),
      order: { occurred_at: 'ASC' },
    });
  }

  /**
   * Build a timeline from tracking events for customer display.
   */
  buildTimeline(events: ShipmentTracking[]): any[] {
    return events.map((e) => ({
      event: e.event,
      description: e.description,
      location: e.location,
      time: e.occurred_at,
    }));
  }
}