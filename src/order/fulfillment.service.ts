import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderHistory } from './entities/order-history.entity';
import {
  FulfillmentStatus,
  FULFILLMENT_STATUS_LABELS,
} from './enums/fulfillment-status.enum';
import { ShippingMethod } from './enums/shipping-method.enum';
import { HandoverMethod } from './enums/handover-method.enum';
import {
  validateFulfillmentTransition,
  canPrintLabel,
} from './fulfillment-state-machine';
import * as uuid from 'uuid';
import { NotificationService } from '../notification/notification.service';

interface FulfillmentLogContext {
  operation_id: string;
  order_invoice: string;
  order_id: string;
  fulfillment_status?: string;
  shipping_method?: string;
  handover?: string;
  courier?: string;
  awb?: string;
  [key: string]: any;
}

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger('FULFILLMENT');

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderHistory)
    private readonly orderHistoryRepo: Repository<OrderHistory>,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {}

  private logFulfillment(
    context: FulfillmentLogContext,
    message: string,
    level: 'log' | 'warn' | 'error' = 'log',
  ): void {
    const prefix = '[FULFILLMENT]';
    const fields = Object.entries(context)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const msg = `${prefix} ${fields} ${message}`;
    if (level === 'error') {
      this.logger.error(msg);
    } else if (level === 'warn') {
      this.logger.warn(msg);
    } else {
      this.logger.log(msg);
    }
  }

  /**
   * Log fulfillment audit trail entry.
   */
  private async recordHistory(
    orderId: string,
    actor: string,
    action: string,
    description: string,
    operationId: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.orderHistoryRepo.save({
      order_id: orderId,
      actor,
      action,
      description,
      refund_operation_id: operationId,
      metadata: metadata || {},
    });
  }

  /**
   * Transition fulfillment status with validation.
   * Returns the context for logging.
   */
  async transitionFulfillmentStatus(
    order: Order,
    newStatus: FulfillmentStatus,
    operationId: string,
    actor: string = 'SYSTEM',
    extraMetadata?: Record<string, any>,
  ): Promise<FulfillmentLogContext> {
    const currentStatus = order.fulfillment_status || FulfillmentStatus.NONE;

    // Validate transition
    try {
      validateFulfillmentTransition(
        currentStatus,
        newStatus,
        order.shipping_method || order.shipping_type?.toUpperCase(),
        order.handover_method,
      );
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }

    const oldStatus = currentStatus;
    order.fulfillment_status = newStatus;
    await this.orderRepo.save(order);

    // Record audit trail
    const action = `FULFILLMENT_${newStatus}`;
    const description = `${FULFILLMENT_STATUS_LABELS[newStatus] || newStatus}`;
    const metadata: Record<string, any> = {
      ...(extraMetadata || {}),
      before: oldStatus,
      after: newStatus,
      shipping_method: order.shipping_method || order.shipping_type,
      handover_method: order.handover_method,
    };

    await this.recordHistory(
      order.id,
      actor,
      action,
      description,
      operationId,
      metadata,
    );

    const context: FulfillmentLogContext = {
      operation_id: operationId,
      order_invoice: order.invoice_number,
      order_id: order.id,
      fulfillment_status: newStatus,
      shipping_method: order.shipping_method || order.shipping_type,
      handover: order.handover_method,
      courier: order.courier_name,
      awb: order.awb_number,
    };

    this.logFulfillment(context, `transition=${oldStatus}→${newStatus}`);

    return context;
  }

  // ====================== START PACKING ======================

  /**
   * Start packing an order. Transitions: NONE → PACKING
   * Admin clicks "Mulai Packing" on a LUNAS order.
   */
  async startPacking(orderId: string, actor: string = 'ADMIN'): Promise<any> {
    const opId = uuid.v4();
    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${orderId} action=START_PACKING`,
    );

    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'LUNAS') {
      throw new BadRequestException('Hanya pesanan LUNAS yang bisa dipacking.');
    }

    const oldFulfillment = order.fulfillment_status || FulfillmentStatus.NONE;

    // Determine shipping method from order
    const shippingMethod = this.determineShippingMethod(order);

    try {
      validateFulfillmentTransition(
        oldFulfillment,
        FulfillmentStatus.PACKING,
        shippingMethod,
        order.handover_method,
      );
    } catch (e: any) {
      // If fulfillment is already PACKING but order.status is still LUNAS (corrupt state from previous bug),
      // allow it to proceed — just fix the order status
      if (
        oldFulfillment === FulfillmentStatus.PACKING &&
        order.status === 'LUNAS'
      ) {
        this.logger.warn(
          `[FULFILLMENT] Corrupt state detected: order=${orderId} fulfillment=PACKING but status=LUNAS. Repairing.`,
        );
        order.is_locked = true;
        order.status = 'DIKEMAS';
        await this.orderRepo.save(order);
        return {
          message: 'Pesanan sudah dalam proses packing. Status diperbaiki.',
          fulfillment_status: FulfillmentStatus.PACKING,
          order: order,
        };
      }
      throw new BadRequestException(e.message);
    }

    order.fulfillment_status = FulfillmentStatus.PACKING;
    order.is_locked = true;
    order.status = 'DIKEMAS';
    const savedOrder = await this.orderRepo.save(order);

    // ── Notifikasi ke user: pesanan mulai dikemas ────────────────────────────
    if (savedOrder.user_id) {
      this.notificationService
        .sendOrderStatusNotif(savedOrder.user_id, savedOrder, 'DIKEMAS')
        .catch((err) =>
          this.logger.warn(`[FULFILLMENT] Notif DIKEMAS failed: ${err.message}`),
        );
    }

    // Record histories
    await this.recordHistory(
      order.id,
      actor,
      'FULFILLMENT_STARTED',
      'Fulfillment dimulai',
      opId,
      {
        before: oldFulfillment,
        after: FulfillmentStatus.PACKING,
        shipping_method: shippingMethod,
      },
    );
    await this.recordHistory(
      order.id,
      actor,
      'PACKING_STARTED',
      'Packing dimulai',
      opId,
      {
        shipping_method: shippingMethod,
      },
    );

    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${savedOrder.invoice_number} fulfillment=PACKING shipping_method=${shippingMethod}`,
    );

    return {
      message: 'Packing dimulai.',
      fulfillment_status: FulfillmentStatus.PACKING,
      order: savedOrder,
    };
  }

  // ====================== COMPLETE PACKING (REGULAR) ======================

  /**
   * Complete packing for regular orders. Transitions: PACKING → READY_TO_SHIP
   */
  async completePacking(
    orderId: string,
    actor: string = 'ADMIN',
  ): Promise<any> {
    const opId = uuid.v4();
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.fulfillment_status !== FulfillmentStatus.PACKING) {
      throw new BadRequestException(
        'Pesanan sedang tidak dalam status packing.',
      );
    }

    const shippingMethod = this.determineShippingMethod(order);
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.READY_TO_SHIP,
      opId,
      actor,
    );

    // Also update OrderStatus to DIKEMAS (for UI) if not already
    if (order.status !== 'DIKEMAS') {
      order.status = 'DIKEMAS';
      await this.orderRepo.save(order);
    }

    return {
      message: 'Packing selesai. Silakan atur pengiriman.',
      fulfillment_status: FulfillmentStatus.READY_TO_SHIP,
      order: order,
    };
  }

  // ====================== SHIPPING SETUP ======================

  /**
   * Setup shipping for regular orders (choose handover method).
   * Transitions: READY_TO_SHIP → SHIPPING_SETUP
   */
  async setupShipping(
    orderId: string,
    handoverMethod: HandoverMethod,
    actor: string = 'ADMIN',
  ): Promise<any> {
    const opId = uuid.v4();
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    let currentStatus = order.fulfillment_status || FulfillmentStatus.NONE;
    const shippingMethod = this.determineShippingMethod(order);

    // Validate: shipping setup only for regular
    if (
      shippingMethod === ShippingMethod.INSTANT ||
      shippingMethod === ShippingMethod.SAME_DAY
    ) {
      throw new BadRequestException(
        'Pesanan instant tidak perlu atur pengiriman. Gunakan Cari Driver.',
      );
    }

    // Auto-transition from PACKING or NONE → READY_TO_SHIP if needed
    // Handles legacy orders where processOrder didn't set fulfillment_status
    if (
      currentStatus === FulfillmentStatus.PACKING ||
      currentStatus === FulfillmentStatus.NONE
    ) {
      if (currentStatus === FulfillmentStatus.NONE) {
        // Legacy order: set fulfillment to PACKING first, then transition to READY_TO_SHIP
        order.fulfillment_status = FulfillmentStatus.PACKING;
        await this.orderRepo.save(order);
        await this.recordHistory(
          order.id,
          actor,
          'FULFILLMENT_STARTED',
          'Fulfillment dimulai (legacy recovery)',
          opId,
          { before: 'NONE', after: FulfillmentStatus.PACKING },
        );
      }
      await this.transitionFulfillmentStatus(
        order,
        FulfillmentStatus.READY_TO_SHIP,
        opId,
        actor,
      );
      currentStatus = order.fulfillment_status || FulfillmentStatus.READY_TO_SHIP;
    }

    // Validate transition from current status (should be READY_TO_SHIP) to SHIPPING_SETUP
    try {
      validateFulfillmentTransition(
        currentStatus,
        FulfillmentStatus.SHIPPING_SETUP,
        shippingMethod,
        handoverMethod,
      );
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }

    order.fulfillment_status = FulfillmentStatus.SHIPPING_SETUP;
    order.handover_method = handoverMethod;
    await this.orderRepo.save(order);

    // Record audit trail
    await this.recordHistory(
      order.id,
      actor,
      'SHIPPING_SETUP_SELECTED',
      'Metode penyerahan dipilih',
      opId,
      {
        handover_method: handoverMethod,
        shipping_method: shippingMethod,
      },
    );
    if (handoverMethod === HandoverMethod.PICKUP) {
      await this.recordHistory(
        order.id,
        actor,
        'HANDOVER_PICKUP',
        'Pickup Kurir dipilih',
        opId,
      );
    } else {
      await this.recordHistory(
        order.id,
        actor,
        'HANDOVER_DROPOFF',
        'Antar ke Outlet dipilih',
        opId,
      );
    }

    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${order.invoice_number} fulfillment=SHIPPING_SETUP handover=${handoverMethod}`,
    );

    return {
      message: `Metode penyerahan: ${handoverMethod === HandoverMethod.PICKUP ? 'Pickup Kurir' : 'Antar ke Outlet'}`,
      fulfillment_status: FulfillmentStatus.SHIPPING_SETUP,
      handover_method: handoverMethod,
      order: order,
    };
  }

  // ====================== BOOKING PICKUP (REGULAR PICKUP) ======================

  /**
   * For regular pickup: generate AWB via Biteship booking.
   * Transitions: SHIPPING_SETUP → BOOKING_PICKUP → BOOKING_SUCCESS → AWB_GENERATED → LABEL_READY
   */
  async bookingPickup(orderId: string, actor: string = 'SYSTEM'): Promise<any> {
    const opId = uuid.v4();
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    if (order.fulfillment_status !== FulfillmentStatus.SHIPPING_SETUP) {
      throw new BadRequestException(
        'Status tidak valid. Harus atur pengiriman dulu.',
      );
    }
    if (order.handover_method !== HandoverMethod.PICKUP) {
      throw new BadRequestException(
        'Metode penyerahan bukan pickup. Gunakan metode yang sesuai.',
      );
    }

    // Idempotency guard
    if (order.booking_status === 'BOOKING')
      throw new BadRequestException('Booking sedang diproses.');
    if (order.booking_status === 'BOOKED')
      throw new BadRequestException('Booking sudah berhasil sebelumnya.');

    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.BOOKING_PICKUP,
      opId,
      actor,
    );

    // Initiate booking
    order.booking_status = 'BOOKING';
    await this.orderRepo.save(order);

    return {
      message: 'Booking pickup sedang diproses.',
      operation_id: opId,
    };
  }

  /**
   * Mark booking as successful (called after AWB generation succeeds).
   * Transitions: BOOKING_PICKUP → BOOKING_SUCCESS → AWB_GENERATED → LABEL_READY
   */
  async handleBookingSuccess(
    order: Order,
    awbData: { biteship_order_id: string; awb_number: string; awb_url: string },
    actor: string = 'SYSTEM',
  ): Promise<void> {
    const opId = uuid.v4();

    // Update order with AWB data
    order.awb_number = awbData.awb_number;
    order.awb_url = awbData.awb_url;
    order.biteship_order_id = awbData.biteship_order_id;
    if (!order.tracking_number) order.tracking_number = awbData.awb_number;
    order.booking_status = 'BOOKED';

    // Transition: → BOOKING_SUCCESS
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.BOOKING_SUCCESS,
      opId,
      actor,
      {
        awb: awbData.awb_number,
        biteship_order_id: awbData.biteship_order_id,
      },
    );

    // Transition: BOOKING_SUCCESS → AWB_GENERATED
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.AWB_GENERATED,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    // Generate shipping snapshot (immutable)
    // This is handled by ShippingLabelService

    // Transition: AWB_GENERATED → LABEL_READY
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.LABEL_READY,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${order.invoice_number} fulfillment=LABEL_READY shipping_method=${order.shipping_method || order.shipping_type} handover=PICKUP awb=${awbData.awb_number}`,
    );
  }

  // ====================== REGULAR DROP-OFF: GENERATE AWB DIRECTLY ======================

  /**
   * For regular drop-off: generate AWB directly without booking pickup.
   * Transitions: SHIPPING_SETUP → AWB_GENERATED → LABEL_READY
   */
  async handleDropOffAwbGenerated(
    order: Order,
    awbData: { biteship_order_id: string; awb_number: string; awb_url: string },
    actor: string = 'SYSTEM',
  ): Promise<void> {
    const opId = uuid.v4();

    order.awb_number = awbData.awb_number;
    order.awb_url = awbData.awb_url;
    order.biteship_order_id = awbData.biteship_order_id;
    if (!order.tracking_number) order.tracking_number = awbData.awb_number;
    order.booking_status = 'BOOKED';

    // Transition: SHIPPING_SETUP → AWB_GENERATED
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.AWB_GENERATED,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    // Transition: AWB_GENERATED → LABEL_READY
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.LABEL_READY,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${order.invoice_number} fulfillment=LABEL_READY shipping_method=${order.shipping_method || order.shipping_type} handover=DROP_OFF awb=${awbData.awb_number}`,
    );
  }

  // ====================== INSTANT: SEARCH DRIVER ======================

  /**
   * For instant/same-day: search driver.
   * Transitions: PACKING → DRIVER_SEARCHING → DRIVER_FOUND → BOOKING_SUCCESS → AWB_GENERATED → LABEL_READY
   */
  async startDriverSearch(
    orderId: string,
    actor: string = 'ADMIN',
  ): Promise<any> {
    const opId = uuid.v4();
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    let currentStatus = order.fulfillment_status || FulfillmentStatus.NONE;
    const shippingMethod = this.determineShippingMethod(order);

    if (
      shippingMethod !== ShippingMethod.INSTANT &&
      shippingMethod !== ShippingMethod.SAME_DAY
    ) {
      throw new BadRequestException(
        'Hanya pesanan instant/same-day yang bisa cari driver.',
      );
    }

    // Must be in PACKING state (or NONE for legacy orders)
    // Auto-transition from NONE → PACKING for legacy orders
    if (currentStatus === FulfillmentStatus.NONE) {
      order.fulfillment_status = FulfillmentStatus.PACKING;
      await this.orderRepo.save(order);
      await this.recordHistory(
        order.id,
        actor,
        'FULFILLMENT_STARTED',
        'Fulfillment dimulai (legacy recovery for instant)',
        opId,
        { before: 'NONE', after: FulfillmentStatus.PACKING },
      );
      currentStatus = FulfillmentStatus.PACKING;
    }
    if (currentStatus !== FulfillmentStatus.PACKING) {
      throw new BadRequestException('Pesanan harus dalam status packing.');
    }

    // Idempotency
    if (order.booking_status === 'BOOKING')
      throw new BadRequestException('Pencarian driver sedang berlangsung.');
    if (order.booking_status === 'BOOKED')
      throw new BadRequestException('Driver sudah ditemukan sebelumnya.');

    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.DRIVER_SEARCHING,
      opId,
      actor,
    );

    order.booking_status = 'BOOKING';
    await this.orderRepo.save(order);

    return {
      message: 'Mencari driver...',
      operation_id: opId,
    };
  }

  /**
   * Mark driver as found (called after Biteship instant booking succeeds).
   */
  async handleDriverFound(
    order: Order,
    driverInfo: any,
    awbData: { biteship_order_id: string; awb_number: string; awb_url: string },
    actor: string = 'SYSTEM',
  ): Promise<void> {
    const opId = uuid.v4();

    // Store driver info
    order.shipping_details = {
      ...((order.shipping_details as any) || {}),
      driver_name: driverInfo.name || driverInfo.driver_name || null,
      driver_phone: driverInfo.phone || driverInfo.driver_phone || null,
      driver_tracking_url: driverInfo.tracking_url || null,
      driver_vehicle_type: driverInfo.vehicle_type || null,
      driver_photo: driverInfo.photo_url || null,
      instant_booked_at: new Date().toISOString(),
    };

    // Store AWB data
    order.awb_number = awbData.awb_number;
    order.awb_url = awbData.awb_url;
    order.biteship_order_id = awbData.biteship_order_id;
    if (!order.tracking_number) order.tracking_number = awbData.awb_number;
    order.booking_status = 'BOOKED';
    order.handover_method = HandoverMethod.PICKUP; // Instant always pickup

    // Transition: DRIVER_SEARCHING → DRIVER_FOUND
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.DRIVER_FOUND,
      opId,
      actor,
      {
        driver: driverInfo.name,
        awb: awbData.awb_number,
      },
    );

    // Transition: DRIVER_FOUND → BOOKING_SUCCESS
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.BOOKING_SUCCESS,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    // Transition: BOOKING_SUCCESS → AWB_GENERATED
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.AWB_GENERATED,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    // Transition: AWB_GENERATED → LABEL_READY
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.LABEL_READY,
      opId,
      actor,
      {
        awb: awbData.awb_number,
      },
    );

    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${order.invoice_number} fulfillment=LABEL_READY shipping_method=INSTANT driver=${driverInfo.name} awb=${awbData.awb_number}`,
    );
  }

  // ====================== LABEL PRINTED ======================

  /**
   * Mark label as printed. Transition: LABEL_READY → LABEL_PRINTED
   */
  async markLabelPrinted(order: Order, actor: string = 'ADMIN'): Promise<void> {
    const opId = uuid.v4();

    if (!canPrintLabel(order.fulfillment_status)) {
      throw new BadRequestException('Label belum siap dicetak.');
    }

    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.LABEL_PRINTED,
      opId,
      actor,
    );

    this.logger.log(
      `[FULFILLMENT] operation_id=${opId} order=${order.invoice_number} fulfillment=LABEL_PRINTED`,
    );
  }

  // ====================== MARK WAITING PICKUP ======================

  /**
   * Mark as waiting pickup. Transition: LABEL_PRINTED → WAITING_PICKUP
   */
  async markWaitingPickup(
    order: Order,
    actor: string = 'ADMIN',
  ): Promise<void> {
    const opId = uuid.v4();

    if (order.fulfillment_status !== FulfillmentStatus.LABEL_PRINTED) {
      throw new BadRequestException('Label harus dicetak terlebih dahulu.');
    }

    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.WAITING_PICKUP,
      opId,
      actor,
    );
  }

  // ====================== MARK PICKED UP ======================

  /**
   * Mark as picked up. Transition: WAITING_PICKUP → PICKED_UP
   */
  async markPickedUp(order: Order, actor: string = 'SYSTEM'): Promise<void> {
    const opId = uuid.v4();

    if (order.fulfillment_status !== FulfillmentStatus.WAITING_PICKUP) {
      throw new BadRequestException(
        'Pesanan tidak dalam status menunggu pickup.',
      );
    }

    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.PICKED_UP,
      opId,
      actor,
    );
  }

  // ====================== MARK SHIPPING ======================

  /**
   * Mark as in shipping. Transition: PICKED_UP → SHIPPING
   */
  async markShipping(order: Order, actor: string = 'SYSTEM'): Promise<void> {
    const opId = uuid.v4();
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.SHIPPING,
      opId,
      actor,
    );
  }

  // ====================== MARK DELIVERED ======================

  /**
   * Mark as delivered. Transition: SHIPPING → DELIVERED
   */
  async markDelivered(order: Order, actor: string = 'SYSTEM'): Promise<void> {
    const opId = uuid.v4();
    await this.transitionFulfillmentStatus(
      order,
      FulfillmentStatus.DELIVERED,
      opId,
      actor,
    );
  }

  // ====================== CANCEL FULFILLMENT ======================

  /**
   * Cancel fulfillment (revert to NONE). Only allowed from certain states.
   */
  async cancelFulfillment(
    orderId: string,
    actor: string = 'ADMIN',
  ): Promise<any> {
    const opId = uuid.v4();
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    const currentStatus = order.fulfillment_status || FulfillmentStatus.NONE;

    // Only allow cancel from early states
    const cancellableStates = [
      FulfillmentStatus.PACKING,
      FulfillmentStatus.READY_TO_SHIP,
      FulfillmentStatus.SHIPPING_SETUP,
    ];
    if (!cancellableStates.includes(currentStatus as FulfillmentStatus)) {
      throw new BadRequestException(
        'Tidak dapat membatalkan fulfillment pada status ini.',
      );
    }

    order.fulfillment_status = FulfillmentStatus.NONE;
    order.is_locked = false;
    await this.orderRepo.save(order);

    await this.recordHistory(
      order.id,
      actor,
      'FULFILLMENT_CANCELLED',
      'Fulfillment dibatalkan',
      opId,
      {
        before: currentStatus,
        after: FulfillmentStatus.NONE,
      },
    );

    return {
      message: 'Fulfillment dibatalkan.',
      fulfillment_status: FulfillmentStatus.NONE,
    };
  }

  // ====================== HELPERS ======================

  /**
   * Determine shipping method from order fields.
   */
  determineShippingMethod(order: Order): string {
    if (order.shipping_method) return order.shipping_method;
    const type = order.shipping_type || 'regular';
    if (type === 'instant') return ShippingMethod.INSTANT;
    return ShippingMethod.REGULAR;
  }

  /**
   * Get current fulfillment status of an order.
   */
  getFulfillmentStatus(orderId: string): Promise<Order | null> {
    return this.orderRepo.findOne({
      where: { id: orderId },
      select: [
        'id',
        'fulfillment_status',
        'shipping_method',
        'handover_method',
        'booking_status',
        'awb_number',
        'shipping_snapshot',
      ],
    });
  }

  /**
   * Check if label can be printed.
   */
  isLabelReady(fulfillmentStatus: string): boolean {
    return canPrintLabel(fulfillmentStatus);
  }
}
