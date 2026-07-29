import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OrderService } from './order.service';

/**
 * Order Cron Service — handles scheduled tasks for orders.
 * Delegates business logic to OrderService.
 *
 * Menggunakan setInterval native (tanpa @nestjs/schedule) untuk menjalankan
 * cron job secara otomatis saat aplikasi berjalan.
 */
@Injectable()
export class OrderCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderCronService.name);

  /** Interval handle untuk auto-cancel pending (setiap 30 menit) */
  private autoCancelInterval: ReturnType<typeof setInterval> | null = null;

  /** Interval handle untuk auto-complete delivered (setiap 1 jam) */
  private autoCompleteInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly orderService: OrderService) {}

  // ─── Lifecycle Hooks ────────────────────────────────────────────────────────

  onModuleInit() {
    // Jalankan sekali saat startup (tunda 10 detik agar DB siap)
    setTimeout(() => {
      this.runAutoCancelPending();
      this.runAutoCompleteDelivered();
    }, 10_000);

    // Auto-cancel PENDING: setiap 30 menit
    this.autoCancelInterval = setInterval(
      () => this.runAutoCancelPending(),
      30 * 60 * 1000,
    );

    // Auto-complete DIKIRIM > 2x24 jam: setiap 1 jam
    this.autoCompleteInterval = setInterval(
      () => this.runAutoCompleteDelivered(),
      60 * 60 * 1000,
    );

    this.logger.log(
      '[CRON] Scheduler aktif — auto-cancel setiap 30 menit, auto-complete setiap 1 jam',
    );
  }

  onModuleDestroy() {
    if (this.autoCancelInterval) clearInterval(this.autoCancelInterval);
    if (this.autoCompleteInterval) clearInterval(this.autoCompleteInterval);
    this.logger.log('[CRON] Scheduler dihentikan');
  }

  // ─── Auto-Cancel Pending ────────────────────────────────────────────────────

  /**
   * Auto-cancel pesanan PENDING yang belum dibayar melebihi batas waktu.
   * Default: 24 jam. Dapat di-override via env AUTO_CANCEL_PENDING_HOURS.
   */
  async autoCancelPendingOrders(): Promise<number> {
    const expiryHours = parseInt(
      process.env.AUTO_CANCEL_PENDING_HOURS || '24',
      10,
    );
    this.logger.log(
      `[CRON] Auto-cancel PENDING orders > ${expiryHours}h old`,
    );

    try {
      const count = await this.orderService.autoCancelPendingOrders(expiryHours);
      if (count > 0) {
        this.logger.log(`[CRON] Auto-cancelled ${count} expired PENDING orders`);
      }
      return count;
    } catch (err: any) {
      this.logger.error(`[CRON] Auto-cancel PENDING failed: ${err.message}`);
      return 0;
    }
  }

  // ─── Auto-Complete Delivered ─────────────────────────────────────────────────

  /**
   * Auto-complete pesanan DIKIRIM yang tidak dikonfirmasi pelanggan dalam 2x24 jam.
   * Jika pelanggan tidak konfirmasi setelah 2x24 jam sejak dikirim, pesanan
   * otomatis berubah menjadi SELESAI.
   */
  async autoCompleteDeliveredOrders(): Promise<number> {
    this.logger.log(
      '[CRON] Auto-complete DIKIRIM orders yang belum dikonfirmasi > 2x24 jam',
    );

    try {
      const count = await this.orderService.autoCompleteOrders();
      if (count > 0) {
        this.logger.log(
          `[CRON] Auto-completed ${count} pesanan DIKIRIM > 2x24 jam`,
        );
      }
      return count;
    } catch (err: any) {
      this.logger.error(`[CRON] Auto-complete DIKIRIM failed: ${err.message}`);
      return 0;
    }
  }

  // ─── Private runner wrappers (untuk setInterval) ─────────────────────────────

  private async runAutoCancelPending() {
    await this.autoCancelPendingOrders().catch((err) =>
      this.logger.error(`[CRON] runAutoCancelPending error: ${err.message}`),
    );
  }

  private async runAutoCompleteDelivered() {
    await this.autoCompleteDeliveredOrders().catch((err) =>
      this.logger.error(`[CRON] runAutoCompleteDelivered error: ${err.message}`),
    );
  }
}