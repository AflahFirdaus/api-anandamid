import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Konfigurasi ThrottlerModule.
 *
 * STRATEGI:
 * - Hanya 1 throttler default dengan limit besar sebagai safety net global
 * - Custom guard (ThrottlerFeatureGuard) akan membaca metadata @ThrottleFeature()
 *   dan hanya mengecek throttler yang sesuai dengan fitur yang ditandai
 * - Endpoint tanpa @ThrottleFeature() hanya kena limit default (100/menit)
 *
 * Dengan pendekatan ini, endpoint yang berbeda tidak saling mempengaruhi
 * karena masing-masing hanya dicek terhadap throttler fiturnya sendiri.
 */
export const throttlerConfig: ThrottlerModuleOptions = {
  errorMessage: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
  throttlers: [
    {
      name: 'default',
      ttl: 60_000, // 1 menit
      limit: 100, // 100 request per menit sebagai safety net
    },
  ],
};