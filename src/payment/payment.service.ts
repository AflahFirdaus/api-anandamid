import { Injectable, Logger } from '@nestjs/common';
import * as midtransClient from 'midtrans-client';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private snap: any;

  constructor() {
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

  async handleNotification(notificationBody: any) {
    try {
      this.logger.log(`Midtrans notification received: ${JSON.stringify(notificationBody)}`);
      // Midtrans SDK verifies the notification signature
      const statusResponse = await this.snap.transaction.notification(notificationBody);
      
      const orderId = statusResponse.order_id;
      const transactionStatus = statusResponse.transaction_status;
      const fraudStatus = statusResponse.fraud_status;

      this.logger.log(`Transaction notification processed. Order ID: ${orderId}. Status: ${transactionStatus}. Fraud: ${fraudStatus}`);

      // Here is where we will update the database later based on the transactionStatus
      // Expected statuses: 'capture', 'settlement', 'pending', 'deny', 'cancel', 'expire'
      if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
        // TODO: Update order status to PAID in database
        this.logger.log(`Order ${orderId} is successfully PAID.`);
      } else if (transactionStatus === 'cancel' || transactionStatus === 'deny' || transactionStatus === 'expire') {
        // TODO: Update order status to FAILED/EXPIRED in database
        this.logger.log(`Order ${orderId} payment failed or expired.`);
      } else if (transactionStatus === 'pending') {
        // TODO: Update order status to PENDING in database
        this.logger.log(`Order ${orderId} is waiting for payment.`);
      }

      return { status: 'success', message: 'Notification processed' };
    } catch (error: any) {
      this.logger.error(`Failed to process Midtrans notification: ${error.message}`);
      throw new Error(`Failed to process Midtrans notification: ${error.message}`);
    }
  }
}
