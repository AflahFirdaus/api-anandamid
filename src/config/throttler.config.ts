import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerFeature, DEFAULT_FEATURE_LIMITS } from '../common/throttler';

/**
 * Konfigurasi ThrottlerModule dengan multiple throttlers per fitur.
 *
 * Setiap fitur memiliki throttler sendiri dengan nama yang sesuai.
 * Custom guard (ThrottlerFeatureGuard) akan membaca metadata @ThrottleFeature()
 * untuk menentukan throttler mana yang dipakai.
 *
 * Storage akan diisi oleh throttlerStorageRedisFactory jika Redis tersedia,
 * fallback ke in-memory jika tidak.
 */
export const throttlerConfig: ThrottlerModuleOptions = {
  // Error message default (akan di-override oleh feature-specific message)
  errorMessage: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',

  // Storage akan diisi via factory/provider di modul
  // Jika tidak diset, @nestjs/throttler akan menggunakan in-memory storage

  // Multiple throttlers: satu per fitur
  throttlers: [
    {
      name: ThrottlerFeature.SEARCH,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.SEARCH].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.SEARCH].limit,
    },
    {
      name: ThrottlerFeature.CHECKOUT,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.CHECKOUT].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.CHECKOUT].limit,
    },
    {
      name: ThrottlerFeature.SHIPPING,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.SHIPPING].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.SHIPPING].limit,
    },
    {
      name: ThrottlerFeature.AUTH,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.AUTH].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.AUTH].limit,
    },
    {
      name: ThrottlerFeature.PUBLIC,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.PUBLIC].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.PUBLIC].limit,
    },
    {
      name: ThrottlerFeature.ADMIN,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.ADMIN].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.ADMIN].limit,
    },
    {
      name: ThrottlerFeature.REVIEW,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.REVIEW].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.REVIEW].limit,
    },
    {
      name: ThrottlerFeature.CHAT,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.CHAT].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.CHAT].limit,
    },
    {
      name: ThrottlerFeature.UPLOAD,
      ttl: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.UPLOAD].ttl,
      limit: DEFAULT_FEATURE_LIMITS[ThrottlerFeature.UPLOAD].limit,
    },
  ],
};