import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Shipment } from '../entities/shipment.entity';
import { ShipmentItem } from '../entities/shipment-item.entity';
import { ShipmentStatus } from '../enums/shipment-status.enum';
import { LabelStatus } from '../enums/label-status.enum';
import { BookingService } from './booking.service';
import { LabelService } from './label.service';
import { TrackingService } from './tracking.service';
import { ShipmentCreatedEvent } from '../events/shipment.event';

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    @InjectRepository(Shipment)
    private readonly shipmentRepo: Repository<Shipment>,
    @InjectRepository(ShipmentItem)
    private readonly shipmentItemRepo: Repository<ShipmentItem>,
    private readonly bookingService: BookingService,
    private readonly labelService: LabelService,
    private readonly trackingService: TrackingService,
  ) {}

  /**
   * Create a new shipment for an order with product snapshots.
   * One order can have multiple shipments (split shipping).
   */
  async createShipment(
    orderId: string,
    data: {
      courier_name?: string;
      courier_service?: string;
      shipping_method?: string;
      handover_method?: string;
      items?: Array<{
        sku?: string;
        product_name: string;
        variant_name?: string;
        quantity: number;
        weight_grams: number;
        price?: number;
      }>;
    },
  ): Promise<Shipment> {
    const shipment = this.shipmentRepo.create({
      order_id: orderId,
      courier_name: data.courier_name,
      courier_service: data.courier_service,
      shipping_method: data.shipping_method,
      handover_method: data.handover_method,
      shipment_status: ShipmentStatus.PENDING,
      label_status: LabelStatus.NOT_READY,
    });
    const saved = await this.shipmentRepo.save(shipment);

    // Create shipment items (immutable product snapshots)
    if (data.items && data.items.length > 0) {
      const items = data.items.map((item) =>
        this.shipmentItemRepo.create({
          shipment_id: saved.id,
          sku: item.sku,
          product_name: item.product_name,
          variant_name: item.variant_name,
          quantity: item.quantity,
          weight_grams: item.weight_grams,
          price: item.price || 0,
        }),
      );
      await this.shipmentItemRepo.save(items);
    }

    // Tracking event
    await this.trackingService.recordEvent(
      saved.id, 'SHIPMENT_CREATED', 'Shipment created',
    );

    // Domain event
    const event = new ShipmentCreatedEvent(
      saved.id, orderId, data.shipping_method || 'REGULAR',
    );

    this.logger.log(`[SHIPMENT] Created shipment=${saved.id} for order=${orderId} items=${data.items?.length || 0}`);
    return saved;
  }

  /**
   * Get active shipment for an order.
   */
  async getShipmentByOrder(orderId: string): Promise<Shipment | null> {
    return this.shipmentRepo.findOne({
      where: { order_id: orderId },
      order: { created_at: 'DESC' },
      relations: ['tracking_events', 'items', 'booking_logs', 'files'],
    });
  }

  /**
   * Get shipment by ID with all relations.
   */
  async getShipment(id: string): Promise<Shipment> {
    const shipment = await this.shipmentRepo.findOne({
      where: { id },
      relations: ['tracking_events', 'items', 'booking_logs', 'files'],
    });
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  /**
   * Get all shipments for an order (supports split shipping).
   */
  async getShipmentsByOrder(orderId: string): Promise<Shipment[]> {
    return this.shipmentRepo.find({
      where: { order_id: orderId },
      order: { created_at: 'DESC' },
      relations: ['tracking_events', 'items', 'booking_logs', 'files'],
    });
  }

  /**
   * Update shipment with courier info.
   */
  async updateCourierInfo(
    shipmentId: string,
    data: { courier_name?: string; courier_service?: string; shipping_method?: string; handover_method?: string },
  ): Promise<Shipment> {
    const shipment = await this.getShipment(shipmentId);
    if (data.courier_name) shipment.courier_name = data.courier_name;
    if (data.courier_service) shipment.courier_service = data.courier_service;
    if (data.shipping_method) shipment.shipping_method = data.shipping_method;
    if (data.handover_method) shipment.handover_method = data.handover_method;
    return this.shipmentRepo.save(shipment);
  }

  /**
   * Update driver info for instant shipments.
   */
  async updateDriverInfo(shipmentId: string, driverInfo: Record<string, any>): Promise<Shipment> {
    const shipment = await this.getShipment(shipmentId);
    shipment.driver_info = {
      ...((shipment.driver_info as any) || {}),
      ...driverInfo,
    };
    return this.shipmentRepo.save(shipment);
  }

  /**
   * Save shipping snapshot (immutable) with full product data.
   * Snapshot includes: receiver, address, phone, items (sku, name, variant, qty, weight).
   */
  async saveSnapshot(shipmentId: string, snapshot: {
    receiver: { name: string; phone: string };
    address: string;
    courier: { name: string; service: string };
    items: Array<{ sku?: string; name: string; variant?: string; qty: number; weight: number }>;
  }): Promise<Shipment> {
    const shipment = await this.getShipment(shipmentId);
    if (shipment.shipping_snapshot) {
      this.logger.log(`[SNAPSHOT] Already exists for shipment=${shipmentId}, skipping`);
      return shipment;
    }
    shipment.shipping_snapshot = {
      ...snapshot,
      version: 'v2',
      created_at: new Date().toISOString(),
    };
    return this.shipmentRepo.save(shipment);
  }

  /**
   * Record a booking log entry.
   */
  async recordBookingLog(
    shipmentId: string,
    data: {
      attempt_number: number;
      courier: string;
      service: string;
      status: string;
      awb_number?: string;
      request_payload?: any;
      response_data?: any;
      error_message?: string;
      response_time_ms?: number;
      driver_info?: any;
    },
  ) {
    return this.bookingService.recordBookingLog(shipmentId, data);
  }

  // ── Delegated methods ──

  async markBooked(shipment: Shipment, awbData: { biteship_order_id: string; awb_number: string; awb_url: string }): Promise<Shipment> {
    return this.bookingService.markBooked(shipment, awbData);
  }

  async markPickedUp(shipment: Shipment, location?: string): Promise<Shipment> {
    return this.bookingService.markPickedUp(shipment, location);
  }

  async markInTransit(shipment: Shipment, location?: string): Promise<Shipment> {
    return this.bookingService.markInTransit(shipment, location);
  }

  async markDelivered(shipment: Shipment, location?: string): Promise<Shipment> {
    return this.bookingService.markDelivered(shipment, location);
  }

  async markFailed(shipment: Shipment, reason: string): Promise<Shipment> {
    return this.bookingService.markFailed(shipment, reason);
  }

  async retryShipment(shipment: Shipment): Promise<Shipment> {
    return this.bookingService.retry(shipment);
  }

  async markLabelReady(shipment: Shipment): Promise<Shipment> {
    return this.labelService.markReady(shipment);
  }

  async markLabelPrinted(shipment: Shipment, printedBy?: string): Promise<Shipment> {
    return this.labelService.markPrinted(shipment, printedBy);
  }

  canPrintLabel(shipment: Shipment): boolean {
    return this.labelService.canPrint(shipment);
  }

  async getTrackingEvents(shipmentId: string) {
    return this.trackingService.getEvents(shipmentId);
  }

  async getTrackingEventsByOrder(orderId: string) {
    return this.trackingService.getEventsByOrder(orderId);
  }
}