import type { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Konfigurasi ThrottlerModule.
 *
 * STRATEGI:
 * - 1 throttler default dengan limit SANGAT BESAR sebagai safety net DDoS
 * - Custom guard (ThrottlerFeatureGuard) akan membaca metadata @ThrottleFeature()
 *   dan menerapkan limit spesifik per fitur (AUTH=5, CHECKOUT=10, dll)
 * - Endpoint tanpa @ThrottleFeature() hanya kena limit default (1000/menit)
 *
 * Dengan pendekatan ini, user bisa browsing produk dengan leluasa,
 * tapi fitur sensitif seperti login/checkout tetap dilindungi.
 */
export const throttlerConfig: ThrottlerModuleOptions = {
  errorMessage: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
  throttlers: [
    {
      name: 'default',
      ttl: 60_000, // 1 menit
      limit: 1000, // 1000 request per menit sebagai safety net DDoS
    },
  ],
};