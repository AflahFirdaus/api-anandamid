import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler/dist/throttler-storage.interface';
import { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';
import { THROTTLER_FEATURE_KEY } from './throttler-feature.decorator';
import { ThrottlerFeature } from './throttler-feature.enum';
import { DEFAULT_FEATURE_LIMITS } from './throttler-feature-limits';

/**
 * Custom ThrottlerGuard yang mendukung:
 * 1. Feature-based throttling via @ThrottleFeature() decorator
 * 2. Diferensiasi Guest (by IP) vs User (by user_id)
 * 3. Custom error message per feature
 * 4. Retry-After header yang informatif
 */
@Injectable()
export class ThrottlerFeatureGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Override getTracker untuk membedakan Guest vs User.
   *
   * - Jika request memiliki user yang terautentikasi (req.user?.id),
   *   gunakan `user_${userId}` sebagai tracker.
   * - Jika guest (tidak login), gunakan IP address.
   *
   * Dengan cara ini, rate limit dihitung per-user untuk user yang login,
   * dan per-IP untuk guest. Seorang user tidak akan terkena limit
   * hanya karena sharing IP (misal kantor atau warnet).
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Prioritaskan user_id jika user terautentikasi
    if (req.user?.id) {
      return `user_${req.user.id}`;
    }

    // Fallback ke IP address untuk guest
    const ip =
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers?.['x-real-ip'] ||
      req.connection?.remoteAddress ||
      req.ip ||
      'unknown';

    return `ip_${ip}`;
  }

  /**
   * Override generateKey untuk menyertakan nama fitur dalam key Redis.
   * Format: `throttler:${feature}:${tracker}`
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const feature = this.getFeatureFromContext(context);
    const prefix = feature ? `throttler:${feature}` : 'throttler';
    return `${prefix}:${suffix}`;
  }

  /**
   * Override getErrorMessage untuk memberikan pesan error spesifik per fitur.
   */
  protected async getErrorMessage(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<string> {
    const feature = this.getFeatureFromContext(context);

    if (feature && DEFAULT_FEATURE_LIMITS[feature]?.errorMessage) {
      return DEFAULT_FEATURE_LIMITS[feature].errorMessage;
    }

    return 'Terlalu banyak permintaan. Silakan coba lagi nanti.';
  }

  /**
   * Override throwThrottlingException untuk menyertakan Retry-After header.
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    const retryAfter = Math.ceil(throttlerLimitDetail.ttl / 1000);

    // Set Retry-After header (dalam detik)
    res.header('Retry-After', retryAfter.toString());
    res.header('X-RateLimit-Reset', String(Date.now() + throttlerLimitDetail.ttl));

    const message = await this.getErrorMessage(context, throttlerLimitDetail);
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        error: 'Too Many Requests',
        retryAfter,
        feature: this.getFeatureFromContext(context) || 'unknown',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * Membaca fitur dari metadata yang diset oleh @ThrottleFeature() decorator.
   * Priority: method level > class level
   */
  private getFeatureFromContext(context: ExecutionContext): ThrottlerFeature | null {
    // Cek di level method handler terlebih dahulu
    const methodFeature = this.reflector.get<ThrottlerFeature>(
      THROTTLER_FEATURE_KEY,
      context.getHandler(),
    );

    if (methodFeature) {
      return methodFeature;
    }

    // Fallback ke level class/controller
    const classFeature = this.reflector.get<ThrottlerFeature>(
      THROTTLER_FEATURE_KEY,
      context.getClass(),
    );

    return classFeature || null;
  }
}