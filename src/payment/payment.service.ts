import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as midtransClient from 'midtrans-client';
import * as crypto from 'crypto';
import { Order } from '../order/entities/order.entity';
import { OrderHistory } from '../order/entities/order-history.entity';
import { InventoryHistory } from '../order/entities/inventory-history.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private snap: any;
  private core: any;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(OrderHistory)
    private readonly orderHistoryRepo: Repository<OrderHistory>,
    @InjectRepository(InventoryHistory)
    private readonly inventoryHistoryRepo: Repository<InventoryHistory>,
    @InjectRepository(ProductVariant)
    private readonly variantRepo: Repository<ProductVariant>,
    private readonly notificationService: NotificationService,
  ) {
    this.logger.log(
      `Initializing Midtrans with serverKey: ${process.env.MIDTRANS_SERVER_KEY ? 'SET' : 'NOT SET'}, isProduction: ${process.env.MIDTRANS_IS_PRODUCTION}`,
    );
    this.snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });
    this.core = new midtransClient.CoreApi({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });
  }

  /**
   * Determine which payment methods to show based on gross amount.
   * Rules:
   *   - < 100.000   : QRIS only
   *   - 100k - 500k : QRIS + Bank Transfer (VA)
   *   - > 500.000   : Bank Transfer (VA) only
   *
   * Returns a list of payment method channels enabled for this transaction amount.
   */
  private resolveEnabledPayments(grossAmount: number): string[] {
    if (grossAmount < 100000) {
      return ['qris'];
    }
    if (grossAmount > 500000) {
      return ['bca', 'bni', 'mandiri', 'bri', 'permata'];
    }
    // 100.000 <= grossAmount <= 500.000
    return ['qris', 'bca', 'bni', 'mandiri', 'bri', 'permata'];
  }

  /**
   * Validate that the payment method used in a transaction matches the allowed methods
   * for the given amount. Called from webhook when payment is settled.
   * Throws an error if payment method is not allowed, triggering auto-refund.
   */
  private validatePaymentMethod(grossAmount: number, paymentType: string): boolean {
    const allowed = this.resolveEnabledPayments(grossAmount);
    // paymentType from Midtrans: "qris", "bank_transfer", "bca", "bni", etc.
    const normalizedType = paymentType?.toLowerCase() || '';
    
    // Check if payment type is in allowed list
    // For bank_transfer, check if any VA channel is allowed
    if (normalizedType === 'bank_transfer') {
      // Bank transfer is allowed if any bank channel is in the list
      return allowed.some(p => ['bca', 'bni', 'mandiri', 'bri', 'permata', 'bank_transfer'].includes(p));
    }
    
    return allowed.some(p => normalizedType.includes(p));
  }

  async createTransaction(
    orderId: string,
    grossAmount: number,
    customerDetails?: any,
  ) {
    const finishUrl = `${process.env.VITE_SITE_URL || 'https://anandam.id'}/user/purchase`;
    const parameter = {
      transaction_details: { order_id: orderId, gross_amount: grossAmount },
      customer_details: customerDetails || {},
      credit_card: { secure: true },
      callbacks: { finish: finishUrl },
    };
    this.logger.log(`Creating Midtrans transaction for ${orderId} amount ${grossAmount}`);
    try {
      const result = await this.snap.createTransaction(parameter);
      this.logger.log(`Midtrans transaction created: ${orderId}`);
      return result;
    } catch (error: any) {
      this.logger.error(
        `Midtrans Error for ${orderId}: ${error.message}`,
        error?.apiResponse || error?.response || '',
      );
      throw new Error(`Midtrans Error: ${error.message}`);
    }
  }

  /**
   * Refund a transaction via Midtrans Core API.
   * - If status is 'capture' (credit card not yet settled), calls cancel/void API.
   * - If status is 'settlement', calls refund API.
   */
  async refundTransaction(
    orderId: string,
    amount: number,
    reason: string,
  ): Promise<any> {
    this.logger.log(
      `[REFUND] Requesting refund for ${orderId}, amount=${amount}, reason=${reason}`,
    );
    try {
      // Step 1: Check current transaction status from Midtrans
      const isProd = process.env.MIDTRANS_IS_PRODUCTION === 'true';
      const base = isProd
        ? 'https://api.midtrans.com/v2'
        : 'https://api.sandbox.midtrans.com/v2';
      const auth = Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString(
        'base64',
      );

      let transactionStatus: string | null = null;
      try {
        const statusRes = await fetch(`${base}/${orderId}/status`, {
          method: 'GET',
          headers: { Authorization: `Basic ${auth}` },
        });
        const statusData = await statusRes.json();
        transactionStatus = statusData?.transaction_status || null;
        this.logger.log(
          `[REFUND] Midtrans transaction_status for ${orderId}: ${transactionStatus}`,
        );
      } catch (statusErr: any) {
        this.logger.warn(
          `[REFUND] Could not fetch transaction status for ${orderId}: ${statusErr.message}`,
        );
      }

      let result: any;

      // Step 2: If status is 'capture', call cancel (void) — refund is not possible yet
      if (transactionStatus === 'capture') {
        this.logger.log(
          `[REFUND] Status is 'capture', calling cancel (void) API for ${orderId}`,
        );
        const cancelRes = await fetch(`${base}/${orderId}/cancel`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
        });
        result = await cancelRes.json();
        if (!cancelRes.ok && result?.status_code !== '200') {
          throw new Error(
            `Cancel (void) API error: HTTP ${cancelRes.status}. API response: ${JSON.stringify(result)}`,
          );
        }
        this.logger.log(
          `[REFUND] Cancel (void) success for ${orderId}: ${JSON.stringify(result)}`,
        );
        return result;
      }

      // Step 3: For 'settlement' and other statuses, call refund API
      const parameter = { amount, reason };

      if (typeof this.core.transaction?.refundDirect === 'function') {
        result = await this.core.transaction.refundDirect(orderId, parameter);
      } else if (typeof this.core.transaction?.refund === 'function') {
        result = await this.core.transaction.refund(orderId, parameter);
      } else if (typeof this.core.transactions?.refundDirect === 'function') {
        result = await this.core.transactions.refundDirect(orderId, parameter);
      } else {
        // Fallback: call REST API directly
        const res = await fetch(`${base}/${orderId}/refund`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(parameter),
        });
        result = await res.json();
        if (!res.ok) {
          throw new Error(
            `Refund API error: HTTP ${res.status}. API response: ${JSON.stringify(result)}`,
          );
        }
      }

      this.logger.log(
        `[REFUND] Success for ${orderId}: ${JSON.stringify(result)}`,
      );
      return result;
    } catch (error: any) {
      const apiResponse = error?.ApiResponse || error?.apiResponse;
      this.logger.error(
        `[REFUND] Failed for ${orderId}: ${error.message}`,
        apiResponse ? JSON.stringify(apiResponse) : '',
      );
      throw new Error(`Refund failed: ${error.message}`);
    }
  }

  /**
   * Process refund notification from Midtrans webhook.
   * Direct refunds complete immediately, so Midtrans may not send a separate "refund" webhook.
   * This is called as part of handleNotification when refund status is detected.
   */
  async processRefundNotification(order: Order): Promise<void> {
    this.logger.log(
      `[REFUND NOTIFICATION] Processing refund for order ${order.id} (${order.invoice_number})`,
    );

    // Idempotency: sudah CANCELLED/BATAL → skip
    if (order.status === 'CANCELLED' || order.status === 'BATAL') {
      this.logger.log(
        `[REFUND NOTIFICATION] Order already cancelled, skipping duplicate`,
      );
      return;
    }

    const queryRunner = this.orderRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Update status
      await queryRunner.manager.update(Order, order.id, {
        status: 'CANCELLED',
        cancelled_at: new Date(),
      });

      // 2. Restock items
      const fullOrder = await queryRunner.manager.findOne(Order, {
        where: { id: order.id },
        relations: ['items', 'items.product', 'items.product.variants'],
      });

      if (fullOrder) {
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

            // Inventory history
            await queryRunner.manager.save(InventoryHistory, {
              product_id: item.product_id,
              variant_name: mv.variant_name,
              qty: item.quantity,
              before_stock: beforeStock,
              after_stock: mv.stock,
              reason: 'REFUND_RESTOCK',
              reference_id: order.id,
            });
          }
        }
      }

      // 3. Order history
      await queryRunner.manager.save(OrderHistory, {
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'REFUND_SUCCESS',
        description: 'Refund berhasil, order dibatalkan',
      });

      await queryRunner.manager.save(OrderHistory, {
        order_id: order.id,
        actor: 'SYSTEM',
        action: 'STOCK_RESTORED',
        description: 'Stok dikembalikan akibat refund',
      });

      await queryRunner.commitTransaction();
      this.logger.log(
        `[REFUND NOTIFICATION] Successfully processed refund for order ${order.invoice_number}`,
      );

      // Kirim notifikasi CANCELLED ke user (WebSocket + email)
      // Dipanggil setelah commitTransaction agar data sudah tersimpan
      if (order.user_id) {
        this.notificationService
          .sendOrderStatusNotif(
            order.user_id,
            {
              id: order.id,
              invoice_number: order.invoice_number,
              courier_name: (order as any).courier_name ?? null,
            },
            'CANCELLED',
          )
          .catch((err: any) => {
            this.logger.warn(
              `[REFUND NOTIFICATION] Notif gagal untuk ${order.invoice_number}: ${err?.message}`,
            );
          });
      }
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `[REFUND NOTIFICATION] Failed, rolled back: ${err.message}`,
      );
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Handle Midtrans webhook notification
   */
  async handleNotification(notificationBody: any) {
    try {
      this.logger.log(
        `Midtrans notification received: ${JSON.stringify(notificationBody)}`,
      );

      // Verify signature
      const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
      const orderId = notificationBody.order_id;
      const statusCode = notificationBody.status_code;
      const grossAmount = notificationBody.gross_amount;
      const inputSignature = notificationBody.signature_key;
      const calculatedSignature = crypto
        .createHash('sha512')
        .update(orderId + statusCode + grossAmount + serverKey)
        .digest('hex');

      if (inputSignature !== calculatedSignature) {
        this.logger.warn(`Invalid Midtrans signature for order ${orderId}`);
        throw new Error('Invalid signature');
      }

      const transactionStatus = notificationBody.transaction_status;
      const fraudStatus = notificationBody.fraud_status;

      this.logger.log(
        `Order ${orderId}: status=${transactionStatus}, fraud=${fraudStatus}`,
      );

      // Find order
      let order = await this.orderRepo.findOne({
        where: { invoice_number: orderId },
      });

      if (!order && orderId && orderId.includes('-R')) {
        const baseInvoice = orderId.split('-R')[0];
        this.logger.log(
          `Trying partial match with base invoice: ${baseInvoice}`,
        );
        const orders = await this.orderRepo.find({
          where: { invoice_number: baseInvoice },
        });
        if (orders.length > 0) {
          order = orders[0];
          this.logger.log(`Order found via partial match: ${order.id}`);
        }
      }

      if (!order) {
        this.logger.warn(`Order ${orderId} not found in database`);
        return { status: 'error', message: 'Order not found' };
      }

      // Handle refund notifications (settlement refund)
      if (
        transactionStatus === 'refund' ||
        transactionStatus === 'refund_complete' ||
        transactionStatus === 'return'
      ) {
        await this.processRefundNotification(order);
        return { status: 'success', message: 'Refund processed' };
      }

      // Handle cancel webhook triggered by void (credit card capture → cancel/void flow)
      // If order is already in REFUNDING or CANCEL_REQUESTED, this cancel is part of the refund flow
      if (
        transactionStatus === 'cancel' &&
        (order.status === 'REFUNDING' || order.status === 'CANCEL_REQUESTED')
      ) {
        this.logger.log(
          `Order ${orderId}: cancel webhook received while order is in ${order.status} — treating as refund success (void)`,
        );
        await this.processRefundNotification(order);
        return { status: 'success', message: 'Refund via void processed' };
      }

      // Normal payment status update
      let newStatus: string = order.status;

      if (transactionStatus === 'capture' && fraudStatus === 'accept') {
        newStatus = 'LUNAS';
      } else if (transactionStatus === 'settlement') {
        newStatus = 'LUNAS';
      } else if (
        transactionStatus === 'cancel' ||
        transactionStatus === 'deny' ||
        transactionStatus === 'expire'
      ) {
        newStatus = 'BATAL';
      } else if (transactionStatus === 'pending') {
        newStatus = 'PENDING';
      }

      if (notificationBody.payment_type) {
        order.payment_method = notificationBody.payment_type;
      }

      if (order.status !== newStatus) {
        if (order.status === 'PENDING' && newStatus === 'LUNAS') {
          try {
            const fullOrder = await this.orderRepo.findOne({
              where: { id: order.id },
              relations: ['items', 'items.product', 'items.product.variants'],
            });
            if (fullOrder) {
              for (const item of fullOrder.items) {
                if (!item.product) continue;
                let mv = item.product.variants?.find(
                  (v) => v.variant_name === item.variasi,
                );
                if (!mv && item.product.variants?.length > 0)
                  mv = item.product.variants[0];
                if (mv) {
                  if (mv.stock >= item.quantity) {
                    mv.stock -= item.quantity;
                    await this.variantRepo.save(mv);
                    this.logger.log(
                      `[Webhook] Deducted stock for ${item.product_name} by ${item.quantity}`,
                    );
                  }
                }
              }
            }
          } catch (e: any) {
            this.logger.error(`[Webhook] Error deducting stock: ${e.message}`);
          }
        }
        order.status = newStatus;
        await this.orderRepo.save(order);
        this.logger.log(`Order ${orderId} status updated: → ${newStatus}`);

        // ── Kirim notifikasi ke user setelah status berubah ──────────────────
        if (order.user_id) {
          try {
            await this.notificationService.sendOrderStatusNotif(
              order.user_id,
              {
                id: order.id,
                invoice_number: order.invoice_number ?? orderId,
                courier_name: (order as any).courier_name ?? null,
              },
              newStatus,
            );
          } catch (notifErr: any) {
            this.logger.warn(
              `[Webhook] Notification failed for ${orderId}: ${notifErr.message}`,
            );
          }
        }
      } else {
        this.logger.log(`Order ${orderId} already at status ${newStatus}`);
      }

      return { status: 'success', message: 'Notification processed' };
    } catch (error: any) {
      this.logger.error(
        `Failed to process Midtrans notification: ${error.message}`,
      );
      throw new Error(
        `Failed to process Midtrans notification: ${error.message}`,
      );
    }
  }
}
