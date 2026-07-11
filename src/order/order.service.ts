import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, LessThan, DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderHistory } from './entities/order-history.entity';
import { InventoryHistory } from './entities/inventory-history.entity';
import { Cart } from '../cart/entities/cart.entity';
import { Product } from '../product/entities/product.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';
import { User } from '../user/entities/user.entity';
import { UserAddress } from '../user/entities/user-address.entity';
import {
  CheckoutCartDto,
  CheckoutDirectDto,
  CreateCheckoutDto,
} from './dto/checkout.dto';
import {
  UpdateOrderStatusDto,
  CancelReason,
  RequestCancelDto,
} from './dto/update-order-status.dto';
import { PaymentService } from '../payment/payment.service';
import { VoucherService } from '../voucher/voucher.service';
import {
  validateStatusTransition,
  validateBookingTransition,
} from './order-state-machine';
import { FulfillmentStatus } from './enums/fulfillment-status.enum';
import { NotificationService } from '../notification/notification.service';

function normalizeCourierCode(courier: string): string {
  const c = courier.toLowerCase().trim();
  if (
    c.includes('j&t') ||
    c.includes('j & t') ||
    c === 'jnt' ||
    c.includes('j&t express')
  )
    return 'jnt';
  if (c === 'jne' || c.includes('jne')) return 'jne';
  if (c.includes('sicepat') || c === 'scp') return 'sicepat';
  if (c === 'tiki' || c.includes('tiki')) return 'tiki';
  if (c === 'pos' || c.includes('pos indonesia')) return 'pos';
  if (c.includes('anteraja') || c === 'anteraja') return 'anteraja';
  if (c.includes('ninja') || c === 'ninjaxpress') return 'ninjaxpress';
  if (c.includes('wahana') || c === 'wahana') return 'wahana';
  if (c.includes('gojek') || c.includes('gosend') || c === 'gojek')
    return 'gojek';
  if (c.includes('grab') || c === 'grabexpress') return 'grab';
  return c.replace(/\s+/g, '');
}

function extractCourierType(courier: string, rawService: string): string {
  const svc = rawService.toLowerCase();
  const c = normalizeCourierCode(courier);
  if (c === 'jne') {
    if (svc.includes('oke')) return 'oke';
    if (svc.includes('yes')) return 'yes';
    if (svc.includes('jtr')) return 'jtr';
    if (svc.includes('ctc')) return 'ctc';
    return 'reg';
  }
  if (c === 'jnt') {
    if (svc.includes('jnd') || svc.includes('next day')) return 'jnd';
    return 'ez';
  }
  if (c === 'sicepat') {
    if (svc.includes('best')) return 'best';
    if (svc.includes('sds') || svc.includes('same day')) return 'sds';
    if (svc.includes('gokil')) return 'gokil';
    return 'reg';
  }
  if (c === 'tiki') {
    if (svc.includes('eco')) return 'eco';
    if (svc.includes('ons') || svc.includes('overnight')) return 'ons';
    if (svc.includes('hds') || svc.includes('same day')) return 'hds';
    return 'reg';
  }
  if (c === 'pos') {
    if (svc.includes('express') || svc.includes('next day'))
      return 'express next day';
    return 'pos kilat khusus';
  }
  if (c === 'anteraja') {
    if (svc.includes('next day') || svc.includes('nd')) return 'next_day';
    if (svc.includes('same day') || svc.includes('sd')) return 'same_day';
    return 'reguler';
  }
  if (svc.includes('regular') || svc.includes('reguler')) return 'reg';
  if (svc.includes('express')) return 'express';
  if (svc.includes('instant')) return 'instant';
  if (svc.includes('same day') || svc.includes('sameday')) return 'same_day';
  if (/^[a-z_]+$/.test(svc) && svc.length <= 20) return svc;
  return 'reg';
}

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    @InjectRepository(Order) private orderRepo: Repository<Order>,
    @InjectRepository(OrderItem) private orderItemRepo: Repository<OrderItem>,
    @InjectRepository(OrderHistory)
    private orderHistoryRepo: Repository<OrderHistory>,
    @InjectRepository(InventoryHistory)
    private inventoryHistoryRepo: Repository<InventoryHistory>,
    @InjectRepository(Cart) private cartRepo: Repository<Cart>,
    @InjectRepository(Product) private productRepo: Repository<Product>,
    @InjectRepository(ProductVariant)
    private variantRepo: Repository<ProductVariant>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(UserAddress) private addressRepo: Repository<UserAddress>,
    private readonly paymentService: PaymentService,
    private readonly voucherService: VoucherService,
    private readonly dataSource: DataSource,
    private readonly notificationService: NotificationService,
  ) {}

  private generateInvoiceNumber(): string {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `INV-${dateStr}-${randomNum}`;
  }

  async deductStock(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });
    if (!order) return;
    for (const item of order.items) {
      if (!item.product) continue;
      let mv = item.product.variants?.find(
        (v) => v.variant_name === item.variasi,
      );
      if (!mv && item.product.variants?.length > 0)
        mv = item.product.variants[0];
      if (mv) {
        if (mv.stock < item.quantity)
          throw new BadRequestException(
            `Stok ${item.product.name} (${mv.variant_name}) tidak mencukupi.`,
          );
        mv.stock -= item.quantity;
        await this.variantRepo.save(mv);
      }
    }
  }

  async restoreStock(orderId: string): Promise<void> {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });
    if (!order) return;
    for (const item of order.items) {
      if (!item.product) continue;
      let mv = item.product.variants?.find(
        (v) => v.variant_name === item.variasi,
      );
      if (!mv && item.product.variants?.length > 0)
        mv = item.product.variants[0];
      if (mv) {
        mv.stock += item.quantity;
        await this.variantRepo.save(mv);
      }
    }
  }

  async checkoutFromCart(userId: string, dto: CheckoutCartDto) {
    const cartItems = await this.cartRepo.find({
      where: { id: In(dto.cart_ids), user_id: userId },
      relations: ['product', 'product.variants'],
    });
    if (cartItems.length === 0)
      throw new BadRequestException('Item keranjang tidak ditemukan.');
    let tp = 0;
    const oi: Partial<OrderItem>[] = [];
    for (const cart of cartItems) {
      if (!cart.product) continue;
      let mv = cart.product.variants?.find(
        (v) => v.variant_name === cart.selected_variasi,
      );
      if (!mv && cart.product.variants?.length > 0)
        mv = cart.product.variants[0];
      if (!mv)
        throw new BadRequestException(
          `Data variasi ${cart.product.name} tidak valid.`,
        );
      if (mv.stock < cart.quantity)
        throw new BadRequestException(
          `Stok ${cart.product.name} (${mv.variant_name}) tidak mencukupi.`,
        );
      const fp =
        Number(mv.price_discount || 0) > 0
          ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0)
          : Number(mv.price_normal || 0);
      tp += fp * cart.quantity;
      oi.push({
        product: { id: cart.product.id } as Product,
        product_name: cart.product.name,
        variasi: mv.variant_name,
        quantity: cart.quantity,
        price: fp,
      });
    }
    const no = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: tp,
      notes: dto.notes,
      items: oi as OrderItem[],
    } as any) as unknown as Order;
    const saved = await this.orderRepo.save(no);
    await this.cartRepo.delete(dto.cart_ids);

    // Notif: pesanan baru (PENDING)
    this.notificationService.sendOrderStatusNotif(userId, saved, 'PENDING').catch(() => {});

    return { message: 'Checkout keranjang berhasil', order: saved };
  }

  async checkoutDirect(userId: string, dto: CheckoutDirectDto) {
    const product = await this.productRepo.findOne({
      where: { id: dto.product_id },
      relations: ['variants'],
    });
    if (!product) throw new NotFoundException('Produk tidak ditemukan');
    let mv = product.variants?.find((v) => v.variant_name === dto.variasi);
    if (!mv && product.variants?.length > 0) mv = product.variants[0];
    if (!mv) throw new BadRequestException('Data variasi produk tidak valid.');
    if (mv.stock < dto.quantity)
      throw new BadRequestException(
        `Stok ${product.name} (${mv.variant_name}) hanya tersisa ${mv.stock}`,
      );
    const fp =
      Number(mv.price_discount || 0) > 0
        ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0)
        : Number(mv.price_normal || 0);
    const no = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: fp * dto.quantity,
      notes: dto.notes,
      items: [
        {
          product: { id: product.id } as Product,
          product_name: product.name,
          variasi: mv.variant_name,
          quantity: dto.quantity,
          price: fp,
        } as OrderItem,
      ],
    } as any) as unknown as Order;
    const saved = await this.orderRepo.save(no);

    // Notif: pesanan baru (PENDING)
    this.notificationService.sendOrderStatusNotif(userId, saved, 'PENDING').catch(() => {});

    return {
      message: 'Checkout langsung berhasil',
      order: saved,
    };
  }

  async findMyOrders(userId: string) {
    return this.orderRepo.find({
      where: { user_id: userId } as any,
      relations: ['items', 'items.product', 'items.product.images'],
      order: { created_at: 'DESC' },
    });
  }

  async retryPayment(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
      relations: ['user'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'PENDING')
      throw new BadRequestException(
        'Hanya pesanan PENDING yang bisa dibayar ulang',
      );
    const tx = await this.paymentService.createTransaction(
      `${order.invoice_number}-R${order.id.slice(0, 8)}`,
      Math.round(order.total_price),
      {
        first_name: order.user.full_name || 'Customer',
        email: order.user.email,
        phone: order.user.phone_number || '',
      },
    );
    order.payment_token = tx.token;
    await this.orderRepo.save(order);
    return {
      message: 'Token pembayaran berhasil dibuat',
      payment: { token: tx.token, redirect_url: tx.redirect_url },
    };
  }

  async checkPaymentStatus(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'PENDING')
      return {
        message: `Status pesanan sudah ${order.status}`,
        status: order.status,
      };
    const sk = process.env.MIDTRANS_SERVER_KEY || '';
    const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
    const base = isProd
      ? 'https://api.midtrans.com/v2'
      : 'https://api.sandbox.midtrans.com/v2';
    const auth = Buffer.from(`${sk}:`).toString('base64');
    let res: Response;
    let data: any;
    try {
      res = await fetch(`${base}/${order.invoice_number}/status`, {
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
      });
      data = await res.json();
      if (!res.ok || res.status === 404) {
        const retryId = `${order.invoice_number}-R${order.id.slice(0, 8)}`;
        res = await fetch(`${base}/${retryId}/status`, {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        });
        data = await res.json();
      }
      if (!res.ok)
        throw new BadRequestException(data.error_messages?.[0] || 'Failed');
    } catch (fetchErr: any) {
      if (fetchErr instanceof BadRequestException) {
        throw fetchErr;
      }
      this.logger.warn(
        `Failed to fetch payment status from Midtrans for ${order.invoice_number} due to network error: ${fetchErr.message}`,
      );
      return {
        message: `Koneksi ke Midtrans terganggu (${fetchErr.message}). Menampilkan status lokal.`,
        status: order.status,
      };
    }
    const ts = data.transaction_status,
      fs = data.fraud_status;
    let ns = order.status;
    if (ts === 'capture' && fs === 'accept') ns = 'LUNAS';
    else if (ts === 'settlement') ns = 'LUNAS';
    else if (['cancel', 'deny', 'expire'].includes(ts)) ns = 'BATAL';
    else if (ts === 'pending') ns = 'PENDING';
    if (order.status !== ns) {
      order.status = ns;
      if (ns === 'LUNAS') {
        await this.deductStock(order.id);
      }
      await this.orderRepo.save(order);

      // Notif: status pembayaran berubah
      this.notificationService.sendOrderStatusNotif(order.user_id, order, ns).catch(() => {});

      return { message: `→ ${ns}`, status: ns };
    }
    return { message: `Status masih ${order.status}`, status: order.status };
  }

  async getTrackingInfo(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    const searchResi = order.awb_number || order.tracking_number;
    if (!searchResi)
      return {
        message: 'Nomor resi belum tersedia',
        tracking_number: null,
        status: order.status,
        courier_name: order.courier_name,
        courier_service: order.courier_service,
        history: [],
      };
    try {
      const key = process.env.BITESHIP_API_KEY || '';
      const res = await fetch(
        `https://api.biteship.com/v1/trackings/${searchResi}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        },
      );
      const data = await res.json();
      if (!res.ok)
        return {
          message: 'Data tracking tidak tersedia',
          tracking_number: searchResi,
          status: order.status,
          courier_name: order.courier_name,
          courier_service: order.courier_service,
          history: [],
          raw_error: data.message,
        };
      return {
        message: 'Data tracking berhasil diambil',
        tracking_number: searchResi,
        status: data.status || order.status,
        courier_name: order.courier_name || data.courier?.name,
        courier_service: order.courier_service,
        history: (data.history || []).map((e: any) => ({
          status: e.status,
          note: e.note,
          updated_at: e.updated_at,
          location: e.location || null,
        })),
        waybill_url: data.waybill_url || null,
      };
    } catch (err: any) {
      return {
        message: 'Gagal mengambil data tracking',
        tracking_number: searchResi,
        status: order.status,
        courier_name: order.courier_name,
        courier_service: order.courier_service,
        history: [],
        error: err.message,
      };
    }
  }

  async cancelOrderUser(userId: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.is_locked)
      throw new BadRequestException('Pesanan sudah diproses admin.');
    if (order.status !== 'PENDING')
      throw new BadRequestException('Hanya PENDING.');
    order.status = 'BATAL';
    return {
      message: 'Pesanan dibatalkan',
      order: await this.orderRepo.save(order),
    };
  }

  // ====================== ENTERPRISE REFUND: SHARED HELPERS ======================

  private async restockItemsAndRecordHistory(
    queryRunner: any,
    orderId: string,
    operationId: string,
  ): Promise<void> {
    const fullOrder = await queryRunner.manager.findOne(Order, {
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });

    if (!fullOrder) return;

    for (const item of fullOrder.items) {
      if (!item.product) continue;
      let mv = item.product.variants?.find(
        (v) => v.variant_name === item.variasi,
      );
      if (!mv && item.product.variants?.length > 0)
        mv = item.product.variants[0];
      if (mv) {
        const beforeStock = mv.stock;
        mv.stock += item.quantity;
        await queryRunner.manager.save(ProductVariant, mv);

        await queryRunner.manager.save(InventoryHistory, {
          product_id: item.product_id,
          variant_name: mv.variant_name,
          qty: item.quantity,
          before_stock: beforeStock,
          after_stock: mv.stock,
          source: 'REFUND',
          reason: 'REFUND_RESTOCK',
          reference_id: orderId,
          product_name: item.product_name,
          sku: mv.sku_seller,
          refund_operation_id: operationId || undefined,
        });
      }
    }
  }

  private async saveOrderHistory(
    queryRunner: any,
    orderId: string,
    actor: string,
    action: string,
    description: string,
    operationId: string,
    beforeStatus?: string,
    afterStatus?: string,
    extraMeta?: Record<string, any>,
  ): Promise<void> {
    const metadata: Record<string, any> = {
      ...(extraMeta || {}),
    };
    if (beforeStatus || afterStatus) {
      metadata.before = { status: beforeStatus || null };
      metadata.after = { status: afterStatus || null };
    }
    if (operationId) {
      metadata.refund_operation_id = operationId;
    }

    await queryRunner.manager.save(OrderHistory, {
      order_id: orderId,
      actor,
      action,
      description,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      refund_operation_id: operationId || undefined,
    });
  }

  // ====================== REQUEST CANCEL + REFUND (HARDENED) ======================

  /**
   * Fulfillment statuses that are considered "before Biteship courier booking".
   * In these states, the order has NOT been sent to Biteship yet, so cancellation + refund is safe.
   * Once fulfillment passes BOOKING_PICKUP or DRIVER_SEARCHING, the courier has been dispatched and cancellation is blocked.
   */
  private readonly CANCELLABLE_FULFILLMENT_STATUSES: string[] = [
    FulfillmentStatus.NONE,
    FulfillmentStatus.PACKING,
    FulfillmentStatus.READY_TO_SHIP,
    FulfillmentStatus.SHIPPING_SETUP,
  ];

  /**
   * User requests cancellation of a PAID/LUNAS order.
   * Uses pessimistic lock + DB transaction to prevent race conditions.
   * Generates refund_operation_id (UUID) for full audit trail.
   *
   * Business rules:
   * - Order must be paid (LUNAS or DIKEMAS)
   * - Fulfillment must NOT have progressed to courier booking stage
   *   (allowed: NONE, PACKING, READY_TO_SHIP, SHIPPING_SETUP)
   * - Once booking is sent to Biteship (BOOKING_PICKUP/DRIVER_SEARCHING+), cancellation is blocked
   * - `is_locked` only protects against double-processing, NOT against cancellation
   */
  async requestCancel(
    userId: string,
    orderId: string,
    dto: { cancel_reason: string; cancel_reason_detail?: string },
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Pessimistic lock: SELECT ... FOR UPDATE
      // NOTE: relations cannot be used with FOR UPDATE on PostgreSQL (nullable side of outer join)
      const order = await queryRunner.manager.findOne(Order, {
        where: { id: orderId, user_id: userId },
        lock: { mode: 'pessimistic_write' },
      } as any);

      if (!order) {
        await queryRunner.rollbackTransaction();
        throw new NotFoundException('Pesanan tidak ditemukan');
      }

      // 2. Validasi awal: pesanan sudah dibayar
      const paidStatuses = ['LUNAS', 'DIKEMAS'];
      if (!paidStatuses.includes(order.status)) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException(
          `Hanya pesanan yang sudah dibayar (${paidStatuses.join('/')}) yang dapat dibatalkan. Status saat ini: ${order.status}`,
        );
      }

      // 3. Validasi fulfillment status — cek apakah sudah masuk tahap booking kurir ke Biteship
      const currentFulfillment = order.fulfillment_status || FulfillmentStatus.NONE;
      if (!this.CANCELLABLE_FULFILLMENT_STATUSES.includes(currentFulfillment)) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException(
          `Pesanan sudah dalam proses pengiriman (${currentFulfillment}) dan tidak dapat dibatalkan. Pesanan hanya dapat dibatalkan sebelum kurir dijadwalkan.`,
        );
      }

      // 4. Booking status guard — extra safety net
      if (order.booking_status === 'BOOKING' || order.booking_status === 'BOOKED') {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException(
          'Pesanan sudah dalam proses booking kurir dan tidak dapat dibatalkan.',
        );
      }

      // 5. Cek status refund/cancel yang tidak valid
      if (
        [
          'CANCEL_REQUESTED',
          'REFUNDING',
          'REFUND_FAILED',
          'CANCELLED',
          'BATAL',
          'DIKIRIM',
          'SELESAI',
        ].includes(order.status)
      ) {
        await queryRunner.rollbackTransaction();
        throw new BadRequestException(
          'Pesanan tidak dapat dibatalkan pada status ini.',
        );
      }

      // 6. Generate correlation ID
      const operationId = require('uuid').v4();
      const oldStatus = order.status;

      // 7. Save cancel reason + status = CANCEL_REQUESTED
      order.cancel_reason = dto.cancel_reason;
      order.cancel_reason_detail = dto.cancel_reason_detail || (null as any);
      order.refund_operation_id = operationId;
      order.refund_requested_at = new Date();
      order.status = 'CANCEL_REQUESTED';
      await queryRunner.manager.save(Order, order);

      // Notif: CANCEL_REQUESTED
      this.notificationService.sendOrderStatusNotif(order.user_id, order, 'CANCEL_REQUESTED').catch(() => {});

      // 8. History: USER_REQUEST_CANCEL
      await this.saveOrderHistory(
        queryRunner,
        order.id,
        'USER',
        'USER_REQUEST_CANCEL',
        `User meminta pembatalan: ${dto.cancel_reason}${dto.cancel_reason_detail ? ` (${dto.cancel_reason_detail})` : ''}`,
        operationId,
        oldStatus,
        'CANCEL_REQUESTED',
        {
          fulfillment_status: currentFulfillment,
          booking_status: order.booking_status,
        },
      );

      // 9. History: SYSTEM_VALIDATE
      await this.saveOrderHistory(
        queryRunner,
        order.id,
        'SYSTEM',
        'SYSTEM_VALIDATE',
        'Validasi pembatalan berhasil',
        operationId,
        'CANCEL_REQUESTED',
        'CANCEL_REQUESTED',
        {
          fulfillment_status: currentFulfillment,
        },
      );

      // 10. Call Midtrans refund API
      try {
        const requestTime = Date.now();
        const refundResult = await this.paymentService.refundTransaction(
          order.invoice_number,
          Math.round(Number(order.total_price)),
          dto.cancel_reason,
        );
        const responseTime = Date.now();
        const responseMs = responseTime - requestTime;

        // Save refund metadata
        order.refund_transaction_id = refundResult?.transaction_id || null;
        order.refund_key = refundResult?.refund_key || null;
        order.refund_status = refundResult?.status || 'pending';
        order.refund_response = refundResult || undefined;
        order.refunded_at = new Date();
        order.status = 'REFUNDING';
        await queryRunner.manager.save(Order, order);

        // 11. History: REFUND_REQUEST_SENT
        await this.saveOrderHistory(
          queryRunner,
          order.id,
          'SYSTEM',
          'REFUND_REQUEST_SENT',
          'Refund request dikirim ke Midtrans',
          operationId,
          'CANCEL_REQUESTED',
          'REFUNDING',
          {
            refund_amount: Math.round(Number(order.total_price)),
            response_time_ms: responseMs,
            refund_key: order.refund_key,
          },
        );

        await queryRunner.commitTransaction();

        this.logger.log(
          `[REFUND] operation_id=${operationId} order=${order.invoice_number} status=REFUNDING amount=${Math.round(Number(order.total_price))} actor=USER fulfillment=${currentFulfillment}`,
        );

        // Notif: REFUNDING
        this.notificationService.sendOrderStatusNotif(order.user_id, order, 'REFUNDING').catch(() => {});

        return {
          message:
            'Pengajuan pembatalan berhasil. Dana akan dikembalikan setelah refund diproses.',
          status: 'REFUNDING',
          refund_operation_id: operationId,
          refund_transaction_id: order.refund_transaction_id,
        };
      } catch (err: any) {
        // Refund API failed → check if it's a timeout
        if (
          err.message?.includes('timeout') ||
          err.message?.includes('ETIMEDOUT') ||
          err.message?.includes('ECONNRESET')
        ) {
          // Don't mark as failed yet — let timeout recovery handle it
          order.status = 'REFUNDING';
          order.refund_status = 'PENDING_VERIFICATION';
          await queryRunner.manager.save(Order, order);

          await this.saveOrderHistory(
            queryRunner,
            order.id,
            'SYSTEM',
            'WAITING_MIDTRANS',
            `Refund timeout — perlu verifikasi: ${err.message}`,
            operationId,
            'CANCEL_REQUESTED',
            'REFUNDING',
            {
              error: err.message,
              requires_verification: true,
            },
          );

          await queryRunner.commitTransaction();
          throw new BadRequestException(
            'Refund diproses, namun perlu diverifikasi. Silakan cek status pesanan beberapa saat lagi.',
          );
        }

        // Real failure
        order.status = 'REFUND_FAILED';
        order.refund_status = 'failed';
        order.refund_response = { error: err.message } as any;
        await queryRunner.manager.save(Order, order);

        await this.saveOrderHistory(
          queryRunner,
          order.id,
          'SYSTEM',
          'REFUND_FAILED',
          `Refund gagal: ${err.message}. Manual action required.`,
          operationId,
          'CANCEL_REQUESTED',
          'REFUND_FAILED',
          {
            error: err.message,
            manual_action_required: true,
          },
        );

        await queryRunner.commitTransaction();

        const isManualRefund =
          err.message?.includes('412') ||
          err.message?.includes('400') ||
          err.message?.includes('406') ||
          err.message?.toLowerCase().includes('transaction status cannot be updated') ||
          err.message?.toLowerCase().includes('refund is not supported');

        if (isManualRefund) {
          this.logger.warn(
            `[REFUND] operation_id=${operationId} order=${order.invoice_number} status=REFUND_FAILED (Manual refund required) info=${err.message}`,
          );
          return {
            message:
              'Pengajuan pembatalan berhasil diterima dan sedang diproses oleh admin. Dana Anda akan dikembalikan dalam 1-3 hari kerja melalui metode pembayaran asal.',
            status: 'REFUND_FAILED',
            refund_operation_id: operationId,
            refund_transaction_id: order.refund_transaction_id,
            next_steps: [
              'Tim kami akan memproses pengembalian dana secara manual.',
              'Dana akan dikembalikan dalam 1-3 hari kerja.',
              'Jika ada pertanyaan, silakan hubungi admin dengan mencantumkan nomor pesanan Anda.',
            ],
            order_number: order.invoice_number,
          };
        }

        this.logger.error(
          `[REFUND] operation_id=${operationId} order=${order.invoice_number} status=REFUND_FAILED error=${err.message}`,
        );

        throw new BadRequestException(
          `Refund gagal: ${err.message}. Silakan hubungi admin.`,
        );
      }
    } catch (err: any) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        if (queryRunner.isTransactionActive)
          await queryRunner.rollbackTransaction();
        await queryRunner.release();
        throw err;
      }
      if (queryRunner.isTransactionActive)
        await queryRunner.rollbackTransaction();
      await queryRunner.release();
      throw err;
    }
  }

  async processRefundSuccess(
    orderId: string,
    operationId?: string,
    webhookMeta?: Record<string, any>,
  ): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) {
      this.logger.warn(
        `[REFUND] operation_id=${operationId || '?'} order=${orderId} not_found=true`,
      );
      return;
    }

    if (order.status === 'CANCELLED' || order.status === 'BATAL') {
      this.logger.log(
        `[REFUND] operation_id=${operationId || order.refund_operation_id || '?'} order=${order.invoice_number} already_cancelled=true`,
      );
      return;
    }
    if (
      operationId &&
      order.refund_operation_id &&
      order.refund_operation_id !== operationId
    ) {
      this.logger.warn(
        `[REFUND] operation_id=${operationId} order=${order.invoice_number} different_operation_exists=${order.refund_operation_id}`,
      );
      return;
    }

    const opId =
      operationId || order.refund_operation_id || require('uuid').v4();

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const webhookReceivedAt = new Date();
      await this.saveOrderHistory(
        queryRunner,
        order.id,
        'MIDTRANS',
        'MIDTRANS_WEBHOOK_RECEIVED',
        'Webhook refund diterima dari Midtrans',
        opId,
        order.status,
        'CANCELLED',
        {
          ...(webhookMeta || {}),
          received_at: webhookReceivedAt.toISOString(),
        },
      );

      await queryRunner.manager.update(Order, order.id, {
        status: 'CANCELLED',
        cancelled_at: new Date(),
        refund_status: 'success',
        refund_completed_at: new Date(),
        refund_operation_id: opId,
      });

      await this.restockItemsAndRecordHistory(queryRunner, order.id, opId);

      await this.saveOrderHistory(
        queryRunner,
        order.id,
        'SYSTEM',
        'REFUND_SUCCESS',
        'Refund berhasil diproses',
        opId,
        'REFUNDING',
        'CANCELLED',
      );

      await this.saveOrderHistory(
        queryRunner,
        order.id,
        'SYSTEM',
        'ORDER_CANCELLED',
        'Order dibatalkan akibat refund',
        opId,
        'REFUNDING',
        'CANCELLED',
      );

      await queryRunner.commitTransaction();

      const refundDuration = order.refund_requested_at
        ? Math.round((Date.now() - order.refund_requested_at.getTime()) / 1000)
        : null;

      this.logger.log(
        `[REFUND] operation_id=${opId} order=${order.invoice_number} status=CANCELLED duration=${refundDuration ? `${refundDuration}s` : '?'} actor=MIDTRANS`,
      );

      // Notif: CANCELLED (refund berhasil)
      this.notificationService.sendOrderStatusNotif(order.user_id, order, 'CANCELLED').catch(() => {});

    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `[REFUND] operation_id=${opId} order=${order.invoice_number} error=${err.message} rolled_back=true`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async retryRefund(orderId: string, note?: string): Promise<any> {
    const maxRetry = parseInt(process.env.MAX_REFUND_RETRY || '3', 10);
    const order = await this.orderRepo.findOne({
      where: { id: orderId } as any,
      lock: { mode: 'pessimistic_write' },
    } as any);
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'REFUND_FAILED')
      throw new BadRequestException(
        'Hanya pesanan REFUND_FAILED yang bisa di-retry.',
      );
    if (order.refund_retry_count >= maxRetry) {
      throw new BadRequestException(
        `Refund sudah di-retry ${maxRetry}x. Proses manual diperlukan.`,
      );
    }

    order.refund_retry_count = (order.refund_retry_count || 0) + 1;
    order.refund_note = note || (null as any);
    order.refund_status = 'retrying';
    await this.orderRepo.save(order);

    try {
      const refundResult = await this.paymentService.refundTransaction(
        order.invoice_number,
        Math.round(Number(order.total_price)),
        order.cancel_reason || 'Retry refund',
      );
      order.refund_transaction_id =
        refundResult?.transaction_id || order.refund_transaction_id;
      order.refund_key = refundResult?.refund_key || order.refund_key;
      order.refund_status = refundResult?.status || 'pending';
      order.refund_response = refundResult || undefined;
      order.status = 'REFUNDING';
      await this.orderRepo.save(order);

      this.logger.log(
        `[REFUND] operation_id=${order.refund_operation_id || '?'} order=${order.invoice_number} retry=${order.refund_retry_count} status=REFUNDING actor=ADMIN`,
      );

      return {
        message: 'Retry refund berhasil, status=REFUNDING',
        status: 'REFUNDING',
      };
    } catch (err: any) {
      order.refund_status = 'failed';
      order.refund_response = { error: err.message } as any;
      await this.orderRepo.save(order);

      this.logger.error(
        `[REFUND] operation_id=${order.refund_operation_id || '?'} order=${order.invoice_number} retry=${order.refund_retry_count} status=REFUND_FAILED error=${err.message}`,
      );

      throw new BadRequestException(
        `Retry refund gagal (${order.refund_retry_count}/${maxRetry}): ${err.message}`,
      );
    }
  }

  async updateOrderStatus(orderId: string, dto: UpdateOrderStatusDto) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['items', 'items.product', 'items.product.variants'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    try {
      validateStatusTransition(order.status, dto.status);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    if (order.status === 'PENDING' && dto.status === 'LUNAS')
      await this.deductStock(orderId);
    if (
      (order.status === 'LUNAS' && dto.status === 'BATAL') ||
      (['REFUNDING', 'REFUND_FAILED', 'CANCEL_REQUESTED', 'LUNAS'].includes(order.status) &&
        ((dto.status as string) === 'CANCELLED' || dto.status === 'BATAL'))
    ) {
      await this.restoreStock(orderId);
    }
    if (dto.status === 'DIKIRIM') order.delivered_at = new Date();
    if (dto.status === 'SELESAI') order.completed_at = new Date();
    order.status = dto.status as string;
    if (dto.tracking_number !== undefined)
      order.tracking_number = dto.tracking_number;
    if (dto.courier_name !== undefined) order.courier_name = dto.courier_name;
    if (dto.courier_service !== undefined)
      order.courier_service = dto.courier_service;
    if (dto.awb_number !== undefined) order.awb_number = dto.awb_number;
    if (dto.awb_url !== undefined) order.awb_url = dto.awb_url;
    const savedOrder = await this.orderRepo.save(order);

    // Notif: update status oleh admin
    this.notificationService.sendOrderStatusNotif(savedOrder.user_id, savedOrder, dto.status as string).catch(() => {});

    return {
      message: `Status diubah: ${dto.status}`,
      order: savedOrder,
    };
  }

  async processOrder(
    orderId: string,
    dto?: {
      tracking_number?: string;
      courier_name?: string;
      courier_service?: string;
    },
  ) {
    const opId = require('uuid').v4();
    this.logger.log(`[PROCESS] operation_id=${opId} order=${orderId}`);

    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'LUNAS')
      throw new BadRequestException('Hanya pesanan LUNAS.');

    try {
      validateStatusTransition(order.status, 'DIKEMAS');
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }

    if (order.booking_status === 'BOOKING')
      throw new BadRequestException('Booking sedang diproses. Mohon tunggu.');
    if (order.booking_status === 'BOOKED')
      throw new BadRequestException('Booking sudah berhasil sebelumnya.');

    order.is_locked = true;
    order.status = 'DIKEMAS';
    if (dto?.tracking_number) order.tracking_number = dto.tracking_number;
    if (dto?.courier_name) order.courier_name = dto.courier_name;
    if (dto?.courier_service) order.courier_service = dto.courier_service;

    if (order.shipping_type === 'regular' && order.courier_name) {
      order.booking_status = 'BOOKING';
      await this.orderRepo.save(order);
      await this.orderHistoryRepo.save({
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'BOOKING_STARTED',
        description: 'Booking kurir dimulai',
        refund_operation_id: opId,
        metadata: {
          courier: order.courier_name,
          service: order.courier_service,
          operation_id: opId,
        },
      });

      try {
        const awb = await this.generateAwb(order);
        if (awb) {
          order.awb_number = awb.awb_number;
          order.awb_url = awb.awb_url;
          order.biteship_order_id = awb.biteship_order_id;
          if (!order.tracking_number) order.tracking_number = awb.awb_number;
          order.booking_status = 'BOOKED';

          const saved = await this.orderRepo.save(order);
          this.logger.log(
            `[PROCESS] ✅ AWB OK: operation_id=${opId} order=${order.invoice_number} biteshipId=${awb.biteship_order_id} awb=${awb.awb_number} booking_status=BOOKED`,
          );

          // Notif: DIKEMAS (setelah AWB berhasil)
          this.notificationService.sendOrderStatusNotif(saved.user_id, saved, 'DIKEMAS').catch(() => {});

          this.fetchAndSaveTrackingUrl(saved).catch((e) =>
            this.logger.warn(
              `[PROCESS] tracking_url fetch failed: ${e.message}`,
            ),
          );

          await this.orderHistoryRepo.save({
            order_id: order.id,
            actor: 'SYSTEM',
            action: 'BOOKING_SUCCESS',
            description: 'Booking kurir berhasil',
            refund_operation_id: opId,
            metadata: {
              awb: awb.awb_number,
              biteship_order_id: awb.biteship_order_id,
              operation_id: opId,
            },
          });

          this.logger.log(
            `[BOOKING] SUCCESS operation_id=${opId} order=${order.invoice_number} awb=${awb.awb_number}`,
          );
          return { message: 'Pesanan diproses.', order: saved };
        } else {
          order.booking_status = 'FAILED';
          await this.orderRepo.save(order);
          await this.orderHistoryRepo.save({
            order_id: order.id,
            actor: 'SYSTEM',
            action: 'BOOKING_FAILED',
            description: 'Booking kurir gagal - AWB null dari Biteship',
            refund_operation_id: opId,
            metadata: { operation_id: opId },
          });
          this.logger.warn(
            `[BOOKING] FAILED operation_id=${opId} order=${order.invoice_number}`,
          );
          return {
            message:
              'Pesanan diproses namun booking kurir gagal. Gunakan Retry Booking.',
            order: order,
          };
        }
      } catch (e: any) {
        order.booking_status = 'FAILED';
        await this.orderRepo.save(order);
        await this.orderHistoryRepo.save({
          order_id: order.id,
          actor: 'SYSTEM',
          action: 'BOOKING_FAILED',
          description: `Booking kurir gagal: ${e.message}`,
          refund_operation_id: opId,
          metadata: { error: e.message, operation_id: opId },
        });
        this.logger.error(
          `[BOOKING] FAILED operation_id=${opId} order=${order.invoice_number} error=${e.message}`,
        );
        return {
          message: `Pesanan diproses namun booking gagal: ${e.message}. Gunakan Retry Booking.`,
          order: order,
        };
      }
    }

    await this.orderRepo.save(order);
    this.logger.log(
      `[PROCESS] Done (no booking) operation_id=${opId} order=${order.invoice_number}`,
    );

    // Notif: DIKEMAS (untuk instant/same-day yang tidak butuh AWB booking)
    this.notificationService.sendOrderStatusNotif(order.user_id, order, 'DIKEMAS').catch(() => {});

    return { message: 'Pesanan diproses.', order: order };
  }

  async retryBooking(orderId: string): Promise<any> {
    const opId = require('uuid').v4();
    this.logger.log(`[RETRY_BOOKING] operation_id=${opId} order=${orderId}`);

    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.booking_status !== 'FAILED')
      throw new BadRequestException(
        'Hanya pesanan dengan booking FAILED yang bisa di-retry.',
      );
    if (!order.courier_name)
      throw new BadRequestException('Kurir belum dipilih.');

    order.booking_status = 'BOOKING';
    await this.orderRepo.save(order);
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'BOOKING_RETRY',
      description: 'Retry booking kurir dimulai',
      refund_operation_id: opId,
      metadata: { courier: order.courier_name, operation_id: opId },
    });

    try {
      let awb: any = null;
      if (order.shipping_type === 'regular') {
        awb = await this.generateAwb(order);
      } else if (order.shipping_type === 'instant') {
        awb = await this.generateInstantBooking(order);
      }

      if (awb) {
        order.awb_number = awb.awb_number;
        order.awb_url = awb.awb_url;
        order.biteship_order_id = awb.biteship_order_id;
        if (!order.tracking_number) order.tracking_number = awb.awb_number;
        order.booking_status = 'BOOKED';
        await this.orderRepo.save(order);

        await this.orderHistoryRepo.save({
          order_id: order.id,
          actor: 'SYSTEM',
          action: 'BOOKING_RETRY_SUCCESS',
          description: 'Retry booking kurir berhasil',
          refund_operation_id: opId,
          metadata: {
            awb: awb.awb_number,
            biteship_order_id: awb.biteship_order_id,
            operation_id: opId,
          },
        });

        this.logger.log(
          `[RETRY_BOOKING] SUCCESS operation_id=${opId} order=${order.invoice_number} awb=${awb.awb_number}`,
        );
        return { message: 'Retry booking berhasil.', order: order };
      } else {
        order.booking_status = 'FAILED';
        await this.orderRepo.save(order);
        throw new BadRequestException(
          'Retry booking gagal. Silakan coba lagi.',
        );
      }
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      order.booking_status = 'FAILED';
      await this.orderRepo.save(order);
      await this.orderHistoryRepo.save({
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'BOOKING_RETRY_FAILED',
        description: `Retry booking gagal: ${e.message}`,
        refund_operation_id: opId,
        metadata: { error: e.message, operation_id: opId },
      });
      throw new BadRequestException(`Retry booking gagal: ${e.message}`);
    }
  }

  private async generateInstantBooking(
    order: Order,
  ): Promise<{
    biteship_order_id: string;
    awb_number: string;
    awb_url: string;
  } | null> {
    const key = process.env.BITESHIP_API_KEY || '';
    if (!key) return null;

    let destLat = '',
      destLng = '';
    let destName = order.user?.full_name || 'Customer';
    let destPhone = order.user?.phone_number || '08123456789';
    let destAddr = '';
    let destPC = '';
    if (order.shipping_address_snapshot) {
      const snap = order.shipping_address_snapshot as any;
      destLat = String(snap.latitude || '');
      destLng = String(snap.longitude || '');
      destAddr = snap.full_address || '';
      destName = snap.recipient_name || destName;
      destPhone = snap.phone_number || destPhone;
      destPC = snap.postal_code || '';
    } else if (order.address_id) {
      const addr = await this.addressRepo.findOne({
        where: { id: order.address_id } as any,
      });
      if (addr?.latitude && addr?.longitude) {
        destLat = String(addr.latitude);
        destLng = String(addr.longitude);
        destAddr = addr.full_address || '';
        destName = addr.recipient_name || destName;
        destPhone = addr.phone_number || destPhone;
        destPC = addr.postal_code || '';
      }
    }
    if (!destLat || !destLng) return null;

    const originLat = parseFloat(process.env.STORE_LATITUDE || '-7.8300');
    const originLng = parseFloat(process.env.STORE_LONGITUDE || '110.3870');
    const courier = normalizeCourierCode(order.courier_name || 'gojek');

    const biteshipBody: any = {
      origin_contact_name: process.env.STORE_CONTACT_NAME || 'Anandam Computer',
      origin_contact_phone: process.env.STORE_PHONE || '6281228134747',
      origin_address: process.env.STORE_ADDRESS || 'Jl. Ringroad Selatan',
      origin_postal_code: parseInt(
        process.env.STORE_POSTAL_CODE || '55283',
        10,
      ),
      origin_coordinate: { latitude: originLat, longitude: originLng },
      destination_contact_name: destName,
      destination_contact_phone: destPhone,
      destination_address: destAddr || 'Alamat Tujuan',
      destination_coordinate: {
        latitude: parseFloat(destLat),
        longitude: parseFloat(destLng),
      },
      courier_company: courier,
      courier_type: 'instant',
      delivery_type: 'now',
      items: order.items.map((item) => ({
        name: item.product_name || 'Product',
        value: Math.max(Number(item.price) || 1000, 100),
        quantity: item.quantity,
        weight: Math.max(
          Math.round((item.product?.weight || 1000) * item.quantity),
          100,
        ),
        length: Number(item.product?.length) || 20,
        width: Number(item.product?.width) || 20,
        height: Number(item.product?.height) || 20,
      })),
    };
    if (destPC) biteshipBody.destination_postal_code = parseInt(destPC, 10);

    const res = await fetch('https://api.biteship.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(biteshipBody),
    });
    const data = await res.json();
    if (!res.ok) {
      this.logger.error(`[INSTANT_BOOKING] FAIL: ${JSON.stringify(data)}`);
      return null;
    }
    return {
      biteship_order_id: data.id || '',
      awb_number: data.waybill_id || '',
      awb_url: data.waybill_url || '',
    };
  }

  async searchDriver(orderId: string) {
    const opId = require('uuid').v4();
    this.logger.log(
      `[INSTANT] Booking driver for order ${orderId} operation_id=${opId}`,
    );

    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException(
        'Hanya pesanan DIKEMAS yang bisa dipesan drivernya.',
      );
    if (order.shipping_type !== 'instant')
      throw new BadRequestException('Hanya pesanan instan.');

    if (order.booking_status === 'BOOKING')
      throw new BadRequestException('Booking sedang diproses. Mohon tunggu.');
    if (order.booking_status === 'BOOKED')
      throw new BadRequestException('Driver sudah dipesan sebelumnya.');

    order.booking_status = 'BOOKING';
    await this.orderRepo.save(order);

    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'BOOKING_STARTED',
      description: 'Pencarian driver instant dimulai',
      refund_operation_id: opId,
      metadata: { courier: order.courier_name, operation_id: opId },
    });

    try {
      const booking = await this.generateInstantBooking(order);
      if (!booking || !booking.awb_number) {
        order.booking_status = 'FAILED';
        await this.orderRepo.save(order);
        await this.orderHistoryRepo.save({
          order_id: order.id,
          actor: 'SYSTEM',
          action: 'BOOKING_FAILED',
          description: 'Pencarian driver gagal - tidak ada driver tersedia',
          refund_operation_id: opId,
          metadata: { operation_id: opId },
        });
        throw new BadRequestException(
          'Tidak ada driver instant tersedia saat ini.',
        );
      }

      order.biteship_order_id = booking.biteship_order_id;
      order.tracking_number =
        booking.awb_number || 'INSTANT-' + order.invoice_number;
      order.awb_number = booking.awb_number;
      order.awb_url = booking.awb_url;
      order.booking_status = 'BOOKED';

      const res = await fetch(
        `https://api.biteship.com/v1/orders/${booking.biteship_order_id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.BITESHIP_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
      let driverInfo: any = {};
      if (res.ok) {
        const data = await res.json();
        driverInfo = data.courier || {};
      }

      order.shipping_details = {
        ...((order.shipping_details as any) || {}),
        driver_name: driverInfo.name || driverInfo.driver_name || null,
        driver_phone: driverInfo.phone || driverInfo.driver_phone || null,
        driver_tracking_url: driverInfo.tracking_url || null,
        driver_vehicle_type: driverInfo.vehicle_type || null,
        driver_photo: driverInfo.photo_url || null,
        instant_booked_at: new Date().toISOString(),
      };

      await this.orderRepo.save(order);

      await this.orderHistoryRepo.save({
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'BOOKING_SUCCESS',
        description: 'Driver instant berhasil dipesan',
        refund_operation_id: opId,
        metadata: {
          awb: booking.awb_number,
          biteship_order_id: booking.biteship_order_id,
          driver: driverInfo.name,
          operation_id: opId,
        },
      });

      this.logger.log(
        `[INSTANT] ✅ Driver dipesan: operation_id=${opId} order=${order.invoice_number} driver=${driverInfo.name} awb=${booking.awb_number} booking_status=BOOKED`,
      );

      return {
        message: 'Driver berhasil dipesan!',
        driver_found: true,
        driver: {
          name: driverInfo.name || driverInfo.driver_name || 'Driver',
          phone: driverInfo.phone || driverInfo.driver_phone || '-',
          tracking_url: driverInfo.tracking_url || null,
        },
        biteship_order_id: booking.biteship_order_id,
      };
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      order.booking_status = 'FAILED';
      await this.orderRepo.save(order);
      await this.orderHistoryRepo.save({
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'BOOKING_FAILED',
        description: `Pencarian driver gagal: ${err.message}`,
        refund_operation_id: opId,
        metadata: { error: err.message, operation_id: opId },
      });
      throw new BadRequestException(`Gagal memesan driver: ${err.message}`);
    }
  }

  private async generateAwb(
    order: Order,
  ): Promise<{
    biteship_order_id: string;
    awb_number: string;
    awb_url: string;
  } | null> {
    const key = process.env.BITESHIP_API_KEY || '';
    if (!key) {
      this.logger.warn('[AWB] No API key');
      return null;
    }
    const originName = process.env.STORE_CONTACT_NAME || 'Anandam Computer';
    const originPhone = process.env.STORE_PHONE || '6281228134747';
    const originAddr =
      process.env.STORE_ADDRESS ||
      'Jl. Ringroad Selatan, Banguntapan, Bantul, Yogyakarta';
    const originPC = process.env.STORE_POSTAL_CODE || '55283';
    const originArea = process.env.STORE_AREA_ID || '';
    let destName = order.user?.full_name || 'Customer';
    let destPhone = order.user?.phone_number || '08123456789';
    let destAddr = '';
    let destPC = '';
    let destArea = '';
    if (order.shipping_address_snapshot) {
      const snap = order.shipping_address_snapshot;
      destName = snap.recipient_name || destName;
      destPhone = snap.phone_number || destPhone;
      destAddr = snap.full_address || '';
      destPC = snap.postal_code || '';
      destArea = snap.area_id || '';
      this.logger.log(
        `[AWB] Loaded from address snapshot: PC=${destPC}, Area=${destArea}`,
      );
    } else if (order.address_id) {
      this.logger.log(
        `[AWB] Snapshot empty. Looking up address ID ${order.address_id}`,
      );
      const addr = await this.addressRepo.findOne({
        where: { id: order.address_id } as any,
      });
      if (addr) {
        destName = addr.recipient_name || destName;
        destPhone = addr.phone_number || destPhone;
        destAddr = addr.full_address || '';
        destPC = addr.postal_code || '';
        destArea = addr.area_id || '';
        this.logger.log(
          `[AWB] Address DB found: PC=${destPC}, Area=${destArea}`,
        );
      } else {
        this.logger.warn(`[AWB] Address ${order.address_id} not found!`);
      }
    } else {
      this.logger.warn(`[AWB] No address_id or address snapshot on order!`);
    }
    const courier = normalizeCourierCode(order.courier_name || 'jne');
    const svc = extractCourierType(courier, order.courier_service || '');
    const body: any = {
      origin_contact_name: originName,
      origin_contact_phone: originPhone,
      origin_address: originAddr,
      origin_postal_code: parseInt(originPC, 10) || 55283,
      destination_contact_name: destName,
      destination_contact_phone: destPhone,
      destination_address: destAddr,
      destination_postal_code: parseInt(destPC, 10) || 55283,
      courier_company: courier,
      courier_type: svc,
      delivery_type: 'now',
      items: order.items.map((item) => ({
        name: item.product_name || 'Product',
        value: Math.max(Number(item.price) || 1000, 100),
        quantity: item.quantity,
        weight: Math.max(
          Math.round((item.product?.weight || 1000) * item.quantity),
          100,
        ),
        length: Number(item.product?.length) || 20,
        width: Number(item.product?.width) || 20,
        height: Number(item.product?.height) || 20,
      })),
    };
    if (originArea) body.origin_area_id = originArea;
    if (destArea) body.destination_area_id = destArea;

    this.logger.log(
      `[AWB] Request: courier=${courier} type=${svc} originPC=${originPC} destPC=${destPC} originArea=${originArea || 'not_set'} destArea=${destArea || 'not_set'}`,
    );

    const res = await fetch('https://api.biteship.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      this.logger.error(`[AWB] API error: ${JSON.stringify(data)}`);
      return null;
    }
    this.logger.log(`[AWB] API success: id=${data.id} waybill=${data.waybill_id}`);
    return {
      biteship_order_id: data.id || '',
      awb_number: data.waybill_id || '',
      awb_url: data.waybill_url || '',
    };
  }

  async findOneOrder(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: [
        'user',
        'items',
        'items.product',
        'items.product.images',
        'items.product.variants',
      ],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    return order;
  }

  async findAllOrders(query: any) {
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.user', 'user')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .orderBy('order.created_at', 'DESC');

    if (query.status) qb.andWhere('order.status = :status', { status: query.status });
    if (query.search) {
      qb.andWhere(
        '(order.invoice_number ILIKE :search OR user.full_name ILIKE :search OR user.email ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }
    if (query.startDate) {
      qb.andWhere('order.created_at >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      qb.andWhere('order.created_at <= :endDate', { endDate: new Date(query.endDate + 'T23:59:59.999Z') });
    }
    if (query.payment_method) qb.andWhere('order.payment_method = :payment_method', { payment_method: query.payment_method });

    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    qb.skip(skip).take(limit);
    const [orders, total] = await qb.getManyAndCount();

    // Count orders per status (without pagination & status filter)
    const countQb = this.orderRepo.createQueryBuilder('order');
    if (query.startDate) {
      countQb.andWhere('order.created_at >= :startDate', { startDate: new Date(query.startDate) });
    }
    if (query.endDate) {
      countQb.andWhere('order.created_at <= :endDate', { endDate: new Date(query.endDate + 'T23:59:59.999Z') });
    }
    const countsRaw = await countQb
      .select('order.status, COUNT(order.id) as count')
      .groupBy('order.status')
      .getRawMany();

    const counts: Record<string, number> = {};
    for (const row of countsRaw) {
      counts[row.status] = parseInt(row.count, 10);
    }

    return {
      data: orders,
      total,
      totalPages: Math.ceil(total / limit),
      page,
      limit,
      counts,
    };
  }

  async findShippingLabelData(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    if (!order.awb_number)
      throw new BadRequestException('AWB number not available. Book courier first.');

    const snapshot = order.shipping_snapshot || {
      recipient_name: order.user?.full_name || '',
      phone_number: order.user?.phone_number || '',
      address: '',
      courier_name: order.courier_name || '',
      courier_service: order.courier_service || '',
      awb_number: order.awb_number || '',
      awb_url: order.awb_url || '',
      items: order.items.map((item) => ({
        name: item.product_name || '',
        quantity: item.quantity,
        price: Number(item.price) || 0,
      })),
      total_weight: order.items.reduce(
        (sum, item) => sum + (item.product?.weight || 200) * item.quantity,
        0,
      ),
    };

    return {
      order: {
        id: order.id,
        invoice_number: order.invoice_number,
        status: order.status,
        created_at: order.created_at,
      },
      shipping: snapshot,
    };
  }

  async requestPickup(orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId },
      relations: ['user', 'items', 'items.product'],
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException('Hanya pesanan DIKEMAS.');

    if (!order.awb_number) {
      const awb = await this.generateAwb(order);
      if (awb) {
        order.awb_number = awb.awb_number;
        order.awb_url = awb.awb_url;
        order.biteship_order_id = awb.biteship_order_id;
        order.booking_status = 'BOOKED';
        await this.orderRepo.save(order);
      } else {
        throw new BadRequestException('Gagal generate AWB.');
      }
    }

    const key = process.env.BITESHIP_API_KEY || '';
    const res = await fetch(
      `https://api.biteship.com/v1/orders/${order.biteship_order_id}/pickup`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pickup_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          pickup_note: 'Silakan ambil paket di toko',
        }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      this.logger.error(`[PICKUP] Failed: ${JSON.stringify(data)}`);
      throw new BadRequestException(
        data.message || data.error || 'Gagal request pickup Biteship.',
      );
    }

    this.logger.log(`[PICKUP] Requested for order ${orderId}`);

    this.fetchAndSaveTrackingUrl(order).catch((e) =>
      this.logger.warn(`[PICKUP] tracking_url fetch failed: ${e.message}`),
    );

    return { message: 'Pickup berhasil dijadwalkan.', pickup_data: data };
  }

  private async fetchAndSaveTrackingUrl(order: Order): Promise<void> {
    if (!order.biteship_order_id || !order.awb_number) return;
    try {
      const key = process.env.BITESHIP_API_KEY || '';
      const res = await fetch(
        `https://api.biteship.com/v1/orders/${order.biteship_order_id}`,
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (data.tracking_url) {
          await this.orderRepo.update(order.id, {
            tracking_url: data.tracking_url,
          });
          this.logger.log(
            `[TRACKING] URL saved for order ${order.id}: ${data.tracking_url}`,
          );
        }
      }
    } catch (e: any) {
      this.logger.warn(`[TRACKING] Failed to fetch tracking URL: ${e.message}`);
    }
  }

  async markDelivered(orderId: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKEMAS')
      throw new BadRequestException('Hanya pesanan DIKEMAS.');

    order.status = 'DIKIRIM';
    order.delivered_at = new Date();
    await this.orderRepo.save(order);
    await this.orderHistoryRepo.save({
      order_id: order.id,
      actor: 'SYSTEM',
      action: 'DELIVERED',
      description: 'Pesanan ditandai terkirim',
    });
    return { message: 'Pesanan ditandai terkirim.', order };
  }

  async confirmReceived(orderId: string, userId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, user_id: userId } as any,
    });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');
    if (order.status !== 'DIKIRIM')
      throw new BadRequestException('Hanya pesanan DIKIRIM.');
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    if (order.delivered_at && order.delivered_at > twoDaysAgo) {
      throw new BadRequestException(
        'Pesanan dapat dikonfirmasi setelah 2x24 jam dari pengiriman, atau hubungi admin.',
      );
    }
    order.status = 'SELESAI';
    order.completed_at = new Date();
    await this.orderRepo.save(order);
    return { message: 'Pesanan selesai.', order };
  }

  async autoCompleteOrders(): Promise<number> {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const result = await this.orderRepo.update(
      {
        status: 'DIKIRIM',
        delivered_at: LessThan(twoDaysAgo),
      } as any,
      { status: 'SELESAI', completed_at: new Date() },
    );
    return result.affected || 0;
  }

  async createCheckout(userId: string, dto: any) {
    // Handle both flat format and nested direct_item format from frontend
    const cart_ids = dto.cart_ids;
    const direct_item = dto.direct_item || null;
    const product_id = dto.product_id || direct_item?.product_id;
    const variasi = dto.variasi || direct_item?.variasi;
    const quantity = dto.quantity || direct_item?.quantity;
    const notes = dto.notes;
    const address_id = dto.address_id;
    const shipping_method = dto.shipping_method;
    const shipping_cost = dto.shipping_cost;
    const courier_name = dto.courier_name;
    const courier_service = dto.courier_service;
    const payment_method = dto.payment_method;
    const voucher_code = dto.voucher_code;

    if (!dto.address_id)
      throw new BadRequestException('Alamat pengiriman wajib diisi.');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    const address = await this.addressRepo.findOne({ where: { id: address_id } as any, relations: ['user'] });
    if (!address) throw new NotFoundException('Alamat tidak ditemukan');
    if (address.user?.id !== userId) throw new BadRequestException('Alamat bukan milik user ini.');

    let discount = 0;
    if (voucher_code) {
      const voucherResult = await (this.voucherService as any).applyVoucher(voucher_code, userId, undefined) as any;
      discount = voucherResult.discount || 0;
    }

    let items: any[] = [];
    let subtotal = 0;

    if (cart_ids && cart_ids.length > 0) {
      const cartItems = await this.cartRepo.find({ where: { id: In(cart_ids), user_id: userId }, relations: ['product', 'product.variants'] });
      for (const cart of cartItems) {
        let mv = cart.product.variants?.find((v) => v.variant_name === cart.selected_variasi);
        if (!mv && cart.product.variants?.length > 0) mv = cart.product.variants[0];
        if (!mv) throw new BadRequestException(`Variasi ${cart.product.name} tidak valid`);
        const fp = Number(mv.price_discount || 0) > 0 ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
        subtotal += fp * cart.quantity;
        items.push({ product: { id: cart.product.id }, product_name: cart.product.name, variasi: mv.variant_name, quantity: cart.quantity, price: fp });
      }
      await this.cartRepo.delete(cart_ids);
    } else if (product_id && variasi && quantity) {
      const product = await this.productRepo.findOne({ where: { id: product_id }, relations: ['variants'] });
      if (!product) throw new NotFoundException('Produk tidak ditemukan');
      let mv = product.variants?.find((v) => v.variant_name === variasi);
      if (!mv && product.variants?.length > 0) mv = product.variants[0];
      if (!mv) throw new BadRequestException('Variasi produk tidak valid.');
      if (mv.stock < quantity) throw new BadRequestException(`Stok ${product.name} tidak mencukupi.`);
      const fp = Number(mv.price_discount || 0) > 0 ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
      subtotal += fp * quantity;
      items.push({ product: { id: product.id }, product_name: product.name, variasi: mv.variant_name, quantity, price: fp });
    } else {
      throw new BadRequestException('cart_ids atau product_id wajib diisi.');
    }

    const shippingCost = shipping_cost || 0;
    const totalPrice = subtotal + Number(shippingCost) - discount;

    const order = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: Math.max(totalPrice, 0),
      notes: notes || null,
      shipping_cost: Number(shippingCost) || 0,
      shipping_method: shipping_method || null,
      shipping_type: shipping_method === 'instant' ? 'instant' : 'regular',
      courier_name: courier_name || null,
      courier_service: courier_service || null,
      payment_method: payment_method || null,
      address_id: address_id,
      items: items as any,
      voucher_code: voucher_code || null,
      discount_amount: discount || 0,
      shipping_address_snapshot: {
        recipient_name: address.recipient_name || user.full_name,
        phone_number: address.phone_number || user.phone_number,
        full_address: address.full_address,
        postal_code: address.postal_code,
        latitude: address.latitude,
        longitude: address.longitude,
        area_id: address.area_id,
        subdistrict: address.subdistrict,
        city: address.city,
        province: address.province,
        label: address.label,
      },
    } as any);

    const savedOrder = await this.orderRepo.save(order) as any;

    const customerName = user.full_name || 'Customer';
    const tx = await this.paymentService.createTransaction(
      savedOrder.invoice_number,
      Math.round(savedOrder.total_price),
      {
        first_name: customerName,
        email: user.email,
        phone: user.phone_number || '',
      },
    );

    savedOrder.payment_token = tx.token;
    savedOrder.payment_redirect_url = tx.redirect_url;
    const result = await this.orderRepo.save(savedOrder);

    await this.orderHistoryRepo.save({
      order_id: result.id,
      actor: 'USER',
      action: 'ORDER_CREATED',
      description: 'Pesanan dibuat',
    });

    return {
      message: 'Checkout berhasil.',
      order: result,
      payment: { token: tx.token, redirect_url: tx.redirect_url },
    };
  }

  async checkoutPCBuilder(userId: string, dto: any) {
    if (!dto.items || dto.items.length === 0)
      throw new BadRequestException('Item tidak boleh kosong.');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User tidak ditemukan');

    let totalPrice = 0;
    const orderItems: any[] = [];
    for (const item of dto.items) {
      const product = await this.productRepo.findOne({
        where: { id: item.product_id },
        relations: ['variants'],
      });
      if (!product) throw new NotFoundException(`Produk ${item.product_id} tidak ditemukan`);
      let mv = product.variants?.find((v) => v.variant_name === item.variasi);
      if (!mv && product.variants?.length > 0) mv = product.variants[0];
      if (!mv) throw new BadRequestException(`Variasi ${product.name} tidak valid`);
      if (mv.stock < (item.quantity || 1))
        throw new BadRequestException(`Stok ${product.name} tidak mencukupi.`);
      const fp = Number(mv.price_discount || 0) > 0 ? Number(mv.price_normal || 0) - Number(mv.price_discount || 0) : Number(mv.price_normal || 0);
      const qty = item.quantity || 1;
      totalPrice += fp * qty;
      orderItems.push({
        product: { id: product.id },
        product_name: product.name,
        variasi: mv.variant_name,
        quantity: qty,
        price: fp,
      });
    }

    const order = this.orderRepo.create({
      user_id: userId,
      invoice_number: this.generateInvoiceNumber(),
      total_price: totalPrice,
      notes: dto.notes || null,
      items: orderItems,
    } as any);

    const saved = await this.orderRepo.save(order);
    return { message: 'Checkout PC Builder berhasil', order: saved };
  }

  async handleBiteshipWebhook(payload: any): Promise<any> {
    this.logger.log(`[WEBHOOK] Biteship payload: ${JSON.stringify(payload)}`);

    const orderId = payload.order_id || payload.id;
    if (!orderId) {
      this.logger.warn('[WEBHOOK] No order_id in payload');
      return { received: true };
    }

    const order = await this.orderRepo.findOne({
      where: { biteship_order_id: orderId } as any,
    });
    if (!order) {
      this.logger.warn(`[WEBHOOK] Order not found for biteship_order_id=${orderId}`);
      return { received: true };
    }

    const status = payload.status || '';
    this.logger.log(`[WEBHOOK] Order ${order.invoice_number} status=${status}`);

    switch (status) {
      case 'dropped_off':
      case 'picked_up':
        order.status = 'DIKIRIM';
        order.delivered_at = new Date();
        await this.orderRepo.save(order);
        await this.orderHistoryRepo.save({
          order_id: order.id,
          actor: 'BITESHIP',
          action: 'PICKED_UP',
          description: `Paket diambil kurir (Biteship webhook: ${status})`,
          metadata: { webhook_payload: payload },
        });
        break;
      case 'delivered':
        order.status = 'DIKIRIM';
        order.delivered_at = new Date();
        await this.orderRepo.save(order);
        await this.orderHistoryRepo.save({
          order_id: order.id,
          actor: 'BITESHIP',
          action: 'DELIVERED',
          description: 'Paket telah terkirim (Biteship webhook)',
          metadata: { webhook_payload: payload },
        });
        break;
      case 'on_delivery':
        break;
      default:
        this.logger.log(`[WEBHOOK] Unhandled status ${status} for order ${order.invoice_number}`);
    }

    return { received: true };
  }

  async repairOrderState(orderId: string): Promise<any> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Pesanan tidak ditemukan');

    const fulfillmentStatus = order.fulfillment_status;
    const currentOrderStatus = order.status;

    let newStatus = currentOrderStatus;

    if (
      (fulfillmentStatus === 'PACKING' ||
        fulfillmentStatus === 'READY_TO_SHIP' ||
        fulfillmentStatus === 'SHIPPING_SETUP') &&
      currentOrderStatus === 'LUNAS'
    ) {
      newStatus = 'DIKEMAS';
      order.is_locked = true;
    }

    if (
      fulfillmentStatus === 'NONE' &&
      currentOrderStatus === 'DIKEMAS'
    ) {
      newStatus = 'LUNAS';
      order.is_locked = false;
    }

    if (newStatus !== currentOrderStatus) {
      order.status = newStatus;
      await this.orderRepo.save(order);
      await this.orderHistoryRepo.save({
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'STATE_REPAIRED',
        description: `Status diperbaiki: ${currentOrderStatus} → ${newStatus} (fulfillment=${fulfillmentStatus})`,
        metadata: {
          before: currentOrderStatus,
          after: newStatus,
          fulfillment_status: fulfillmentStatus,
        },
      });
      this.logger.log(`[REPAIR] order=${order.invoice_number} ${currentOrderStatus}→${newStatus} fulfillment=${fulfillmentStatus}`);
      return { message: `Status diperbaiki: ${currentOrderStatus} → ${newStatus}`, order };
    }

    return { message: 'Tidak ada perbaikan yang diperlukan.', order };
  }
}