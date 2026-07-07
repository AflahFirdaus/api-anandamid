 import { ThrottlerFeature } from './throttler-feature.enum';

/**
 * Konfigurasi limit per fitur.
 * ttl dalam milidetik, limit adalah jumlah maksimal request dalam ttl tersebut.
 *
 * Strategi:
 * - Fitur sensitif (AUTH, CHECKOUT, SHIPPING) → limit kecil, window pendek
 * - Fitur baca (SEARCH, PUBLIC) → limit lebih longgar
 * - Admin → limit longgar karena trusted user
 * - Upload → limit kecil untuk cegah abuse bandwidth
 */
export interface FeatureLimitConfig {
  ttl: number;
  limit: number;
  /** Optional: custom error message per fitur */
  errorMessage?: string;
}

export type FeatureLimitsMap = Record<ThrottlerFeature, FeatureLimitConfig>;

export const DEFAULT_FEATURE_LIMITS: FeatureLimitsMap = {
  [ThrottlerFeature.SEARCH]: {
    ttl: 60_000, // 1 menit
    limit: 30,
    errorMessage: 'Terlalu banyak pencarian. Silakan coba lagi dalam 1 menit.',
  },
  [ThrottlerFeature.CHECKOUT]: {
    ttl: 60_000, // 1 menit
    limit: 10,
    errorMessage: 'Terlalu banyak percobaan checkout. Silakan coba lagi nanti.',
  },
  [ThrottlerFeature.SHIPPING]: {
    ttl: 60_000, // 1 menit
    limit: 15,
    errorMessage:
      'Terlalu banyak permintaan cek ongkir. Silakan coba lagi dalam 1 menit.',
  },
  [ThrottlerFeature.AUTH]: {
    ttl: 60_000, // 1 menit
    limit: 5,
    errorMessage:
      'Terlalu banyak percobaan login. Silakan coba lagi dalam 1 menit.',
  },
  [ThrottlerFeature.PUBLIC]: {
    ttl: 60_000, // 1 menit
    limit: 100,
    errorMessage: 'Terlalu banyak permintaan. Silakan coba lagi.',
  },
  [ThrottlerFeature.ADMIN]: {
    ttl: 60_000, // 1 menit
    limit: 200,
    errorMessage: 'Terlalu banyak permintaan admin. Silakan coba lagi.',
  },
  [ThrottlerFeature.REVIEW]: {
    ttl: 60_000, // 1 menit
    limit: 10,
    errorMessage:
      'Terlalu banyak permintaan review. Silakan coba lagi dalam 1 menit.',
  },
  [ThrottlerFeature.CHAT]: {
    ttl: 60_000, // 1 menit
    limit: 60,
    errorMessage: 'Terlalu banyak pesan. Silakan coba lagi nanti.',
  },
  [ThrottlerFeature.UPLOAD]: {
    ttl: 60_000, // 1 menit
    limit: 5,
    errorMessage:
      'Terlalu banyak upload file. Silakan coba lagi dalam 1 menit.',
  },
  [ThrottlerFeature.VOUCHER]: {
    ttl: 60_000, // 1 menit
    limit: 5,
    errorMessage:
      'Terlalu banyak percobaan voucher. Silakan coba lagi dalam 1 menit.',
  },
};
