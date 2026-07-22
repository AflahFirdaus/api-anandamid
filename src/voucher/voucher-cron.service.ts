import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { VoucherUsage } from './entities/voucher-usage.entity';
import { VoucherService, VOUCHER_USAGE_STATUS } from './voucher.service';

@Injectable()
export class VoucherCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoucherCronService.name);

  // Interval timer untuk cron setiap 15 menit
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  // 15 menit dalam milidetik
  private static readonly CRON_INTERVAL_MS = 15 * 60 * 1000;

  // Stale threshold: 1 jam
  private static readonly STALE_THRESHOLD_MS = 60 * 60 * 1000;

  // Max batch size per run
  private static readonly MAX_BATCH_SIZE = 500;

  constructor(
    @InjectRepository(VoucherUsage)
    private readonly voucherUsageRepository: Repository<VoucherUsage>,
    private readonly voucherService: VoucherService,
  ) {}

  /**
   * Called by NestJS after module initialization.
   * Starts the cron interval.
   */
  onModuleInit(): void {
    this.logger.log(
      `[Cron] Starting auto-release & auto-hide cron every ${VoucherCronService.CRON_INTERVAL_MS / 60000} minutes`,
    );
    this.intervalHandle = setInterval(async () => {
      await this.releaseStaleReservations();
      await this.autoHideExpiredVouchers();
    }, VoucherCronService.CRON_INTERVAL_MS);
  }

  /**
   * Called by NestJS when module is destroyed.
   * Cleans up the interval to prevent memory leaks.
   */
  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log('[Cron] Auto-release cron stopped.');
    }
  }

  /**
   * Cron Job: Auto-Release Stale Reservations
   *
   * Runs every 15 minutes.
   * Finds VoucherUsage with status RESERVED that was created
   * more than 1 hour ago (stale), then releases their quota.
   */
  async releaseStaleReservations(): Promise<void> {
    this.logger.log('[Cron] Starting: releaseStaleReservations');

    const startedAt = Date.now();
    const oneHourAgo = new Date(Date.now() - VoucherCronService.STALE_THRESHOLD_MS);

    try {
      // Find all VoucherUsage with status RESERVED older than 1 hour
      const staleUsages = await this.voucherUsageRepository.find({
        where: {
          status: VOUCHER_USAGE_STATUS.RESERVED,
          used_at: LessThan(oneHourAgo),
        },
        // Batch processing to prevent memory issues
        take: VoucherCronService.MAX_BATCH_SIZE,
      });

      if (staleUsages.length === 0) {
        this.logger.log('[Cron] No stale reservations found.');
        return;
      }

      this.logger.log(
        `[Cron] Found ${staleUsages.length} stale reservation(s). Releasing...`,
      );

      let successCount = 0;
      let failureCount = 0;

      // Release one by one - each release is an atomic transaction
      for (const usage of staleUsages) {
        try {
          await this.voucherService.releaseVoucher(usage.id);
          successCount++;
        } catch (error) {
          failureCount++;
          this.logger.error(
            `[Cron] Failed to release stale usage ${usage.id}: ${(error as Error).message}`,
          );
          // Continue to next record
        }
      }

      const elapsed = Date.now() - startedAt;

      this.logger.log(
        `[Cron] Finished in ${elapsed}ms: ${successCount} released, ${failureCount} failed out of ${staleUsages.length} stale`,
      );
    } catch (error) {
      this.logger.error(
        `[Cron] releaseStaleReservations failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  /**
   * Cron Job: Auto-Hide Expired or Exhausted Vouchers
   *
   * Runs every 15 minutes alongside releaseStaleReservations.
   * Voucher yang sudah expired (end_date < now) atau sudah habis kuota
   * (max_usage > 0 && current_usage >= max_usage) akan di-set is_hidden = true.
   * Admin tetap bisa melihatnya dengan query param ?showHidden=true.
   */
  async autoHideExpiredVouchers(): Promise<void> {
    try {
      const hiddenCount = await this.voucherService.autoHideExpiredOrExhaustedVouchers();
      if (hiddenCount > 0) {
        this.logger.log(`[Cron] Auto-hide ${hiddenCount} expired/exhausted voucher(s)`);
      }
    } catch (error) {
      this.logger.error(
        `[Cron] autoHideExpiredVouchers failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
