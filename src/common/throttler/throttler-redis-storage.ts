import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * Implementasi ThrottlerStorage menggunakan Redis.
 *
 * Strategy:
 * - Menggunakan Redis INCR + EXPIRE untuk atomic counter dengan TTL
 * - Key format: `throttler:${key}:${throttlerName}`
 * - Block duration didukung dengan menyimpan timestamp kapan block berakhir
 *
 * Keuntungan:
 * - Persisten (tidak hilang saat server restart)
 * - Shared state (bisa multi-instance)
 * - Atomic operations (INCR) → thread-safe
 */
export class ThrottlerRedisStorage implements ThrottlerStorage {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttler:${key}:${throttlerName}`;
    const blockKey = `${redisKey}:block`;

    // Cek apakah sedang dalam masa block
    const blockTtl = await this.redis.ttl(blockKey);
    if (blockTtl > 0) {
      // Masih dalam masa block
      return {
        totalHits: limit + 1, // Pastikan melebihi limit
        timeToExpire: blockTtl * 1000,
        isBlocked: true,
        timeToBlockExpire: blockTtl * 1000,
      };
    }

    // Increment counter
    const totalHits = await this.redis.incr(redisKey);

    // Set TTL pada first request
    if (totalHits === 1) {
      await this.redis.pexpire(redisKey, ttl);
    }

    // Dapatkan sisa TTL
    const remainingTtl = await this.redis.pttl(redisKey);
    const timeToExpire = remainingTtl > 0 ? remainingTtl : ttl;

    // Jika melebihi limit, set block
    let isBlocked = false;
    let timeToBlockExpire = 0;

    if (totalHits > limit && blockDuration > 0) {
      await this.redis.setex(blockKey, Math.ceil(blockDuration / 1000), '1');
      isBlocked = true;
      timeToBlockExpire = blockDuration;
    }

    return {
      totalHits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire,
    };
  }
}