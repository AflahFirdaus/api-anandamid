import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as midtransClient from 'midtrans-client';
import * as crypto from 'crypto';
import { Order } from '../order/entities/order.entity';
import { ProductVariant } from '../product/entities/product-variant.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private snap: any;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(ProductVariant)
    private readonly variantRepo: Repository<ProductVariant>,
  ) {
    this.logger.log(`Initializing Midtrans with serverKey: ${process.env.MIDTRANS_SERVER_KEY ? 'SET' : 'NOT SET'}, isProduction: ${process.env.MIDTRANS_IS_PRODUCTION}`);
    this.snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });
  }

  async createTransaction(orderId: string, grossAmount: number, customerDetails?: any) {
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
      this.logger.error(`Midtrans Error for ${orderId}: ${error.message}`, error?.apiResponse || error?.response || '');
      throw new Error(`Midtrans Error: ${error.message}`);
    }
  }

  /**
   * Handle Midtrans webhook notification
   * Updates order status based on payment result
   */
  async handleNotification(notificationBody: any) {
    try {
      this.logger.log(`Midtrans notification received: ${JSON.stringify(notificationBody)}`);

      // 1. Verify signature to prevent unauthorized notifications
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

      this.logger.log(`Order ${orderId}: status=${transactionStatus}, fraud=${fraudStatus}`);

      // 2. Find order in database — cari berdasarkan invoice_number
      // Untuk retry payment, Midtrans mengirim order_id = "INV-xxx-Ruuid"
      // Kita perlu cari order yang invoice_number-nya merupakan prefix dari orderId
      let order = await this.orderRepo.findOne({ where: { invoice_number: orderId } });

      // Jika tidak ditemukan, coba partial match (untuk retry payment)
      if (!order && orderId && orderId.includes('-R')) {
        const baseInvoice = orderId.split('-R')[0];
        this.logger.log(`Trying partial match with base invoice: ${baseInvoice}`);
        const orders = await this.orderRepo.find({ where: { invoice_number: baseInvoice } });
        if (orders.length > 0) {
          order = orders[0];
          this.logger.log(`Order found via partial match: ${order.id}`);
        }
      }

      if (!order) {
        this.logger.warn(`Order ${orderId} not found in database`);
        return { status: 'error', message: 'Order not found' };
      }

      // 3. Update order status based on payment result
      let newStatus: string = order.status;

      if (transactionStatus === 'capture' && fraudStatus === 'accept') {
        newStatus = 'LUNAS';
      } else if (transactionStatus === 'settlement') {
        newStatus = 'LUNAS';
      } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
        newStatus = 'BATAL';
      } else if (transactionStatus === 'pending') {
        newStatus = 'PENDING';
      }

      if (notificationBody.payment_type) {
        order.payment_method = notificationBody.payment_type;
      }

      if (order.status !== newStatus) {
        // Stock deduction on transitioning to LUNAS
        if (order.status === 'PENDING' && newStatus === 'LUNAS') {
          // Dynamically load variant repo to prevent circular dependencies if any (already injected though)
          // Let's call the helper method to deduct stock
          try {
            // We need to deduct stock. We can do it by finding variants.
            const fullOrder = await this.orderRepo.findOne({ 
              where: { id: order.id }, 
              relations: ['items', 'items.product', 'items.product.variants'] 
            });
            if (fullOrder) {
              for (const item of fullOrder.items) {
                if (!item.product) continue;
                let mv = item.product.variants?.find((v) => v.variant_name === item.variasi);
                if (!mv && item.product.variants?.length > 0) mv = item.product.variants[0];
                if (mv) {
                  if (mv.stock >= item.quantity) {
                    mv.stock -= item.quantity;
                    await this.variantRepo.save(mv);
                    this.logger.log(`[Webhook] Deducted stock for ${item.product_name} by ${item.quantity}`);
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
        this.logger.log(`Order ${orderId} status updated: ${order.status} → ${newStatus}`);
      } else {
        this.logger.log(`Order ${orderId} already at status ${newStatus}`);
      }

      return { status: 'success', message: 'Notification processed' };
    } catch (error: any) {
      this.logger.error(`Failed to process Midtrans notification: ${error.message}`);
      throw new Error(`Failed to process Midtrans notification: ${error.message}`);
    }
  }
}
