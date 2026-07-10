import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderHistory } from './entities/order-history.entity';
import { OrderItem } from './entities/order-item.entity';
import { FulfillmentService } from './fulfillment.service';
import { FulfillmentStatus } from './enums/fulfillment-status.enum';
import { ShippingMethod } from './enums/shipping-method.enum';
import { HandoverMethod } from './enums/handover-method.enum';
import { ShipmentService } from '../shipment/services/shipment.service';
import { BookingService } from '../shipment/services/booking.service';
import { LabelService } from '../shipment/services/label.service';
import { PdfLabelService } from '../shipment/services/pdf-label.service';
import { Shipment } from '../shipment/entities/shipment.entity';
import { ShipmentStatus } from '../shipment/enums/shipment-status.enum';
import { LabelStatus } from '../shipment/enums/label-status.enum';
import * as uuid from 'uuid';

@Injectable()
export class FulfillmentWorkflowService {
  private readonly logger = new Logger('FULFILLMENT_WORKFLOW');

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderHistory)
    private readonly orderHistoryRepo: Repository<OrderHistory>,
    private readonly fulfillmentService: FulfillmentService,
    private readonly shipmentService: ShipmentService,
    private readonly bookingService: BookingService,
    private readonly labelService: LabelService,
    private readonly pdfLabelService: PdfLabelService,
    private readonly dataSource: DataSource,
  ) {}

  // ====================== INSTANT FLOW ======================

  /**
   * Complete instant booking flow:
   * 1. Book driver via Biteship
   * 2. Create Shipment
   * 3. Save immutable snapshot
   * 4. Mark label READY
   * 5. Update order fulfillment status LABEL_READY
   */
  async processInstantBooking(orderId: string): Promise<any> {
    const opId = uuid.v4();
    this.logger.log(
      `[WORKFLOW] operation_id=${opId} order=${orderId} action=INSTANT_BOOKING`,
    );

    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException(
        'Hanya pesanan DIKEMAS yang bisa diproses.',
      );
    // Check both shipping_method (new) and shipping_type (legacy)
    const shippingMethod =
      order.shipping_method || order.shipping_type?.toUpperCase();
    if (
      shippingMethod !== ShippingMethod.INSTANT &&
      shippingMethod !== ShippingMethod.SAME_DAY
    ) {
      throw new BadRequestException('Bukan pesanan instant/same-day.');
    }

    // Idempotency: check if shipment already exists
    const existingShipment =
      await this.shipmentService.getShipmentByOrder(orderId);
    if (
      existingShipment &&
      existingShipment.shipment_status === ShipmentStatus.BOOKED
    ) {
      throw new BadRequestException('Driver sudah dipesan sebelumnya.');
    }
    if (
      existingShipment &&
      existingShipment.shipment_status === ShipmentStatus.FAILED
    ) {
      // Allow retry
    }

    // Step 1: Update fulfillment to DRIVER_SEARCHING
    await this.fulfillmentService.startDriverSearch(orderId, 'SYSTEM');

    // Step 2: Book via Biteship
    const destInfo = this.extractDestinationInfo(order);
    const items = this.extractItems(order);

    // Ensure lat/lng are provided as required strings
    const instantDestInfo = {
      recipient_name: destInfo.recipient_name,
      recipient_phone: destInfo.recipient_phone,
      full_address: destInfo.full_address,
      latitude: destInfo.latitude || process.env.STORE_LATITUDE || '-7.8300',
      longitude:
        destInfo.longitude || process.env.STORE_LONGITUDE || '110.3870',
      postal_code: destInfo.postal_code,
    };

    const awbResult = await this.bookingService.generateInstantBooking(
      order.courier_name || 'gojek',
      instantDestInfo,
      items,
    );

    if (!awbResult || !awbResult.awb_number) {
      // Update fulfillment back to PACKING (driver not found)
      if (order.fulfillment_status === FulfillmentStatus.DRIVER_SEARCHING) {
        await this.fulfillmentService.cancelFulfillment(orderId, 'SYSTEM');
      }
      throw new BadRequestException(
        'Tidak ada driver instant tersedia saat ini.',
      );
    }

    // Step 3: Create or update Shipment
    let shipment: Shipment;
    if (existingShipment) {
      shipment = existingShipment;
      shipment.courier_name = order.courier_name;
      shipment.courier_service = order.courier_service || 'instant';
      shipment.shipping_method = order.shipping_method;
      shipment.handover_method = HandoverMethod.PICKUP;
    } else {
      shipment = await this.shipmentService.createShipment(orderId, {
        courier_name: order.courier_name || 'gojek',
        courier_service: order.courier_service || 'instant',
        shipping_method: order.shipping_method || ShippingMethod.INSTANT,
        handover_method: HandoverMethod.PICKUP,
        items: items.map((i) => ({
          product_name: i.product_name,
          variant_name: i.variant_name,
          quantity: i.quantity,
          weight_grams: i.weight,
          price: i.price,
        })),
      });
    }

    // Step 4: Mark booked + save driver info
    shipment = await this.bookingService.markBooked(shipment, awbResult);

    // Step 5: Save immutable snapshot
    await this.pdfLabelService.createShippingSnapshot(shipment, order);

    // Step 6: Mark label READY
    shipment = await this.labelService.markReady(shipment);

    // Step 7: Update order fulfillment status through the chain
    await this.fulfillmentService.handleDriverFound(
      order,
      awbResult.driver_info || {},
      awbResult,
    );

    // Step 8: Update order with shipment reference
    order.shipping_details = {
      ...((order.shipping_details as any) || {}),
      driver_name: awbResult.driver_info?.driver_name || null,
      driver_phone: awbResult.driver_info?.driver_phone || null,
      driver_tracking_url: awbResult.driver_info?.driver_tracking_url || null,
      instant_booked_at: new Date().toISOString(),
      shipment_id: shipment.id,
    };
    await this.orderRepo.save(order);

    // Audit trail
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'WORKFLOW_INSTANT_COMPLETE',
      description: 'Instant booking workflow selesai — label siap cetak',
      refund_operation_id: opId,
      metadata: {
        shipment_id: shipment.id,
        awb: awbResult.awb_number,
        booking_status: 'BOOKED',
        label_status: LabelStatus.READY,
      },
    });

    this.logger.log(
      `[WORKFLOW] ✅ Instant booking complete: operation_id=${opId} order=${order.invoice_number} shipment=${shipment.id} awb=${awbResult.awb_number} label=READY`,
    );

    return {
      message: 'Driver berhasil dipesan! Label siap cetak.',
      driver_found: true,
      driver: awbResult.driver_info || null,
      shipment_id: shipment.id,
      booking_status: 'BOOKED',
      label_status: LabelStatus.READY,
      awb_number: awbResult.awb_number,
      awb_url: awbResult.awb_url,
    };
  }

  // ====================== REGULAR FLOW ======================

  /**
   * Process regular shipping (Pickup or Drop-off):
   * 1. Generate AWB via Biteship
   * 2. Create Shipment
   * 3. Save immutable snapshot
   * 4. Mark label READY
   * 5. Update order fulfillment
   */
  async processRegularBooking(orderId: string): Promise<any> {
    const opId = uuid.v4();
    this.logger.log(
      `[WORKFLOW] operation_id=${opId} order=${orderId} action=REGULAR_BOOKING`,
    );

    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException(
        'Hanya pesanan DIKEMAS yang bisa diproses.',
      );

    const shippingMethod =
      order.shipping_method ||
      (order.shipping_type === 'instant'
        ? ShippingMethod.INSTANT
        : ShippingMethod.REGULAR);
    if (shippingMethod !== ShippingMethod.REGULAR) {
      throw new BadRequestException('Bukan pesanan regular.');
    }

    // Must have handover method set
    if (!order.handover_method) {
      throw new BadRequestException(
        'Metode penyerahan belum dipilih. Gunakan Atur Pengiriman terlebih dahulu.',
      );
    }

    // Idempotency
    const existingShipment =
      await this.shipmentService.getShipmentByOrder(orderId);
    if (
      existingShipment &&
      existingShipment.shipment_status === ShipmentStatus.BOOKED
    ) {
      throw new BadRequestException('Booking sudah berhasil sebelumnya.');
    }

    // Step 1: Generate AWB
    const destInfo = this.extractDestinationInfo(order);
    const items = this.extractItems(order);

    const awbResult = await this.bookingService.generateAWB(
      order.courier_name || 'jne',
      order.courier_service || 'reg',
      destInfo,
      items,
    );

    if (!awbResult || !awbResult.awb_number) {
      throw new BadRequestException('Gagal generate AWB. Silakan coba lagi.');
    }

    // Step 2: Create Shipment
    let shipment: Shipment;
    if (existingShipment) {
      shipment = existingShipment;
      shipment.courier_name = order.courier_name;
      shipment.courier_service = order.courier_service;
      shipment.shipping_method = shippingMethod;
      shipment.handover_method = order.handover_method;
    } else {
      shipment = await this.shipmentService.createShipment(orderId, {
        courier_name: order.courier_name || 'jne',
        courier_service: order.courier_service || 'reg',
        shipping_method: shippingMethod,
        handover_method: order.handover_method,
        items: items.map((i) => ({
          product_name: i.product_name,
          variant_name: i.variant_name,
          quantity: i.quantity,
          weight_grams: i.weight,
          price: i.price,
        })),
      });
    }

    // Step 3: Mark booked
    shipment = await this.bookingService.markBooked(shipment, awbResult);

    // Step 4: Save immutable snapshot
    await this.pdfLabelService.createShippingSnapshot(shipment, order);

    // Step 5: Mark label READY
    shipment = await this.labelService.markReady(shipment);

    // Step 6: Update order fulfillment
    if (order.handover_method === HandoverMethod.PICKUP) {
      await this.fulfillmentService.handleBookingSuccess(order, awbResult);
    } else {
      await this.fulfillmentService.handleDropOffAwbGenerated(order, awbResult);
    }

    // Step 7: Update order tracking info
    order.awb_number = awbResult.awb_number;
    order.awb_url = awbResult.awb_url;
    order.biteship_order_id = awbResult.biteship_order_id;
    order.shipping_details = {
      ...((order.shipping_details as any) || {}),
      shipment_id: shipment.id,
      booked_at: new Date().toISOString(),
    };
    await this.orderRepo.save(order);

    // Step 8: Fetch tracking URL in background
    this.fetchAndSaveTrackingUrl(shipment).catch((e) =>
      this.logger.warn(`[WORKFLOW] tracking_url fetch failed: ${e.message}`),
    );

    // Audit trail
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'WORKFLOW_REGULAR_COMPLETE',
      description: `Regular booking workflow selesai — ${order.handover_method === HandoverMethod.PICKUP ? 'Pickup' : 'Drop-off'}`,
      refund_operation_id: opId,
      metadata: {
        shipment_id: shipment.id,
        awb: awbResult.awb_number,
        handover_method: order.handover_method,
        booking_status: 'BOOKED',
        label_status: LabelStatus.READY,
      },
    });

    this.logger.log(
      `[WORKFLOW] ✅ Regular booking complete: operation_id=${opId} order=${order.invoice_number} shipment=${shipment.id} awb=${awbResult.awb_number} handover=${order.handover_method}`,
    );

    return {
      message: `Booking berhasil. Label siap cetak.`,
      shipment_id: shipment.id,
      booking_status: 'BOOKED',
      label_status: LabelStatus.READY,
      awb_number: awbResult.awb_number,
      awb_url: awbResult.awb_url,
      handover_method: order.handover_method,
    };
  }

  /**
   * Mark as handed over (for DROP_OFF flow — admin brings package to courier outlet).
   * Transitions order status to DIKIRIM.
   */
  async markHandedOver(orderId: string): Promise<any> {
    const opId = uuid.v4();
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException('Hanya pesanan DIKEMAS.');
    if (order.handover_method !== HandoverMethod.DROP_OFF) {
      throw new BadRequestException('Bukan metode drop-off.');
    }

    // Update Shipment to picked up
    const shipment = await this.shipmentService.getShipmentByOrder(orderId);
    if (shipment && shipment.shipment_status === ShipmentStatus.BOOKED) {
      await this.bookingService.markPickedUp(shipment, 'Outlet drop-off');
      await this.bookingService.markInTransit(
        shipment,
        'In transit to courier hub',
      );
    }

    // Update order status
    order.status = 'DIKIRIM';
    order.delivered_at = new Date();
    await this.orderRepo.save(order);

    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'ADMIN',
      action: 'HANDED_OVER',
      description: 'Paket sudah diserahkan ke outlet ekspedisi',
      refund_operation_id: opId,
      metadata: {
        handover_method: HandoverMethod.DROP_OFF,
        shipment_id: shipment?.id,
      },
    });

    return { message: 'Paket ditandai sudah diserahkan.', status: 'DIKIRIM' };
  }

  /**
   * Get the active shipment for an order (for PDF generation, etc.)
   */
  async getActiveShipment(orderId: string): Promise<Shipment> {
    const shipment = await this.shipmentService.getShipmentByOrder(orderId);
    if (!shipment) {
      throw new NotFoundException(
        'Shipment tidak ditemukan untuk pesanan ini.',
      );
    }
    return shipment;
  }

  // ====================== HELPERS ======================

  private extractDestinationInfo(order: Order): {
    recipient_name: string;
    recipient_phone: string;
    full_address: string;
    postal_code: string;
    area_id?: string;
    latitude?: string;
    longitude?: string;
  } {
    if (order.shipping_address_snapshot) {
      const snap = order.shipping_address_snapshot as any;
      return {
        recipient_name:
          snap.recipient_name || order.user?.full_name || 'Customer',
        recipient_phone:
          snap.phone_number || order.user?.phone_number || '08123456789',
        full_address: snap.full_address || '',
        postal_code: snap.postal_code || '',
        area_id: snap.area_id || undefined,
        latitude: snap.latitude ? String(snap.latitude) : undefined,
        longitude: snap.longitude ? String(snap.longitude) : undefined,
      };
    }
    return {
      recipient_name: order.user?.full_name || 'Customer',
      recipient_phone: order.user?.phone_number || '08123456789',
      full_address: '',
      postal_code: '',
    };
  }

  private extractItems(order: Order): Array<{
    product_name: string;
    variant_name?: string;
    quantity: number;
    price: number;
    weight: number;
    length?: number;
    width?: number;
    height?: number;
  }> {
    return (order.items || []).map((item: OrderItem & { product?: any }) => ({
      product_name: item.product_name || 'Product',
      variant_name: item.variasi || undefined,
      quantity: item.quantity,
      price: Number(item.price) || 1000,
      weight: item.product?.weight || 1000,
      length: item.product?.length || 20,
      width: item.product?.width || 20,
      height: item.product?.height || 20,
    }));
  }

  private async fetchAndSaveTrackingUrl(shipment: Shipment): Promise<void> {
    if (!shipment.awb_number) return;
    try {
      const key = process.env.BITESHIP_API_KEY || '';
      if (!key) return;
      const res = await fetch(
        `https://api.biteship.com/v1/trackings/${shipment.awb_number}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const data = await res.json();
      if (res.ok && data.waybill_url) {
        shipment.tracking_url = data.waybill_url;
        await this.shipmentService.getShipment(shipment.id); // reload
        const repo = this.dataSource.getRepository(Shipment);
        await repo.update(shipment.id, { tracking_url: data.waybill_url });
        this.logger.log(
          `[TRACKING_URL] Saved for shipment ${shipment.id}: ${data.waybill_url}`,
        );
      }
    } catch (e: any) {
      this.logger.warn(
        `[TRACKING_URL] Failed for shipment ${shipment.id}: ${e.message}`,
      );
    }
  }
}
