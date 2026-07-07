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
      `[Cron] Starting auto-release cron every ${VoucherCronService.CRON_INTERVAL_MS / 60000} minutes`,
    );
    this.intervalHandle = setInterval(() => {
      this.releaseStaleReservations();
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
}