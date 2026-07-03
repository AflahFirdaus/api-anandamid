import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as midtransClient from 'midtrans-client';
import * as crypto from 'crypto';
import { Order } from '../order/entities/order.entity';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private snap: any;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
  ) {
    this.logger.log(`Initializing Midtrans with serverKey: ${process.env.MIDTRANS_SERVER_KEY ? 'SET' : 'NOT SET'}, isProduction: ${process.env.MIDTRANS_IS_PRODUCTION}`);
    this.snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY,
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });
  }

  async createTransaction(orderId: string, grossAmount: number, customerDetails?: any) {
    const parameter = {
      transaction_details: { order_id: orderId, gross_amount: grossAmount },
      customer_details: customerDetails || {}, 
      credit_card: { secure: true },
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

      // 2. Find order in database
      const order = await this.orderRepo.findOne({ where: { invoice_number: orderId } });
      if (!order) {
        // Order might not exist yet (race condition) or invalid orderId
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

      if (order.status !== newStatus) {
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
