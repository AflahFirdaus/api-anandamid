import type { ThrottlerStorage } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ThrottlerRedisStorage } from './throttler-redis-storage';

/**
 * Factory function untuk membuat ThrottlerStorage.
 *
 * Strategy:
 * - Jika env REDIS_HOST tersedia → buat Redis client dan gunakan ThrottlerRedisStorage
 * - Jika tidak → return undefined agar @nestjs/throttler menggunakan in-memory storage default
 *
 * Redis configuration dari environment variables:
 * - REDIS_HOST (required for Redis)
 * - REDIS_PORT (default: 6379)
 * - REDIS_PASSWORD (optional)
 * - REDIS_DB (default: 0)
 *
 * NOTE: ioredis di-import secara dinamis (require) agar tidak gagal build
 * jika package ioredis belum terinstall di server.
 */
export function createThrottlerStorage(
  configService: ConfigService,
): ThrottlerStorage | undefined {
  const redisHost = configService.get<string>('REDIS_HOST');

  // Fallback: jika Redis tidak dikonfigurasi, gunakan in-memory storage
  if (!redisHost) {
    return undefined;
  }

  const redisPort = configService.get<number>('REDIS_PORT', 6379);
  const redisPassword = configService.get<string>('REDIS_PASSWORD');
  const redisDb = configService.get<number>('REDIS_DB', 0);

  // Dynamic import agar tidak error saat build jika ioredis belum diinstall
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = require('ioredis');

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    db: redisDb,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 200, 30_000);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  return new ThrottlerRedisStorage(redis);
}