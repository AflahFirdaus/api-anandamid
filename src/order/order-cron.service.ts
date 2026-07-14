import { Injectable, Logger } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * Order Cron Service — handles scheduled tasks for orders.
 * Delegates business logic to OrderService.
 */
@Injectable()
export class OrderCronService {
  private readonly logger = new Logger(OrderCronService.name);

  constructor(private readonly orderService: OrderService) {}

  /**
   * Auto-cancel pending orders that haven't been paid within the configured expiry time.
   * Default: 24 hours. Can be overridden via env AUTO_CANCEL_PENDING_HOURS.
   * Should be called every 15-30 minutes via cron.
   */
  async autoCancelPendingOrders(): Promise<number> {
    const expiryHours = parseInt(process.env.AUTO_CANCEL_PENDING_HOURS || '24', 10);
    this.logger.log(`[CRON] Starting auto-cancel for PENDING orders > ${expiryHours}h old`);

    try {
      const count = await this.orderService.autoCancelPendingOrders(expiryHours);
      if (count > 0) {
        this.logger.log(`[CRON] Auto-cancelled ${count} expired PENDING orders`);
      }
      return count;
    } catch (err: any) {
      this.logger.error(`[CRON] Auto-cancel failed: ${err.message}`);
      return 0;
    }
  }
}