import { ThrottlerStorageRedisService } from '@nestjs/throttler/dist/throttler-storage-redis.service';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Factory untuk membuat ThrottlerStorageRedisService.
 *
 * Membaca konfigurasi Redis dari environment variable:
 * - REDIS_HOST (default: localhost)
 * - REDIS_PORT (default: 6379)
 * - REDIS_PASSWORD (optional)
 * - REDIS_DB (default: 0)
 *
 * Jika REDIS_HOST tidak di-set, fallback ke in-memory storage (tidak menggunakan Redis).
 */
export const throttlerStorageRedisFactory = {
  provide: 'THROTTLER_STORAGE',
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const redisHost = configService.get<string>('REDIS_HOST');

    // Fallback: jika Redis tidak dikonfigurasi, return null agar ThrottlerModule
    // menggunakan default in-memory storage
    if (!redisHost) {
      return null;
    }

    const redisPort = configService.get<number>('REDIS_PORT', 6379);
    const redisPassword = configService.get<string>('REDIS_PASSWORD');
    const redisDb = configService.get<number>('REDIS_DB', 0);

    const redis = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      db: redisDb,
      retryStrategy: (times) => {
        // Exponential backoff: max 30 detik
        const delay = Math.min(times * 200, 30_000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    return new ThrottlerStorageRedisService(redis);
  },
};