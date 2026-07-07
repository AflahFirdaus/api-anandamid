import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler/dist/throttler-storage.interface';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface';
import { THROTTLER_FEATURE_KEY } from './throttler-feature.decorator';
import { ThrottlerFeature } from './throttler-feature.enum';
import { DEFAULT_FEATURE_LIMITS } from './throttler-feature-limits';

/**
 * Custom ThrottlerGuard yang mendukung:
 * 1. Feature-based throttling via @ThrottleFeature() decorator
 * 2. Diferensiasi Guest (by IP) vs User (by user_id)
 * 3. Custom error message per feature
 * 4. Retry-After header yang informatif
 *
 * STRATEGI:
 * - Config hanya punya 1 throttler 'default' dengan limit 100/menit sebagai safety net
 * - Jika endpoint punya @ThrottleFeature(), guard akan mengecek limit spesifik fitur tersebut
 *   dengan cara memanggil storage.increment() secara manual
 * - Jika endpoint tidak punya @ThrottleFeature(), hanya kena limit default (100/menit)
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
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (req.user?.id) {
      return `user_${req.user.id}`;
    }

    const ip =
      req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.headers?.['x-real-ip'] ||
      req.connection?.remoteAddress ||
      req.ip ||
      'unknown';

    return `ip_${ip}`;
  }

  /**
   * Override handleRequest untuk menerapkan feature-based throttling.
   *
   * - Jika endpoint punya @ThrottleFeature(), hitung limit spesifik fitur
   * - Jika tidak, gunakan limit default dari config
   */
  protected async handleRequest(requestProps: {
    context: ExecutionContext;
    limit: number;
    ttl: number;
    throttler: any;
    blockDuration: number;
    getTracker: any;
    generateKey: any;
  }): Promise<boolean> {
    const { context } = requestProps;
    const feature = this.getFeatureFromContext(context);

    // Jika endpoint punya @ThrottleFeature(), gunakan limit spesifik fitur
    if (feature && DEFAULT_FEATURE_LIMITS[feature]) {
      const featureLimit = DEFAULT_FEATURE_LIMITS[feature];
      const tracker = await this.getTracker(
        this.getRequestResponse(context).req,
      );
      const key = this.generateKey(context, tracker, feature);

      const { totalHits, timeToExpire } = await this.storageService.increment(
        key,
        featureLimit.ttl,
        featureLimit.limit,
        0,
        feature,
      );

      // Set headers
      const { res } = this.getRequestResponse(context);
      res.header('X-RateLimit-Limit', featureLimit.limit);
      res.header('X-RateLimit-Remaining', Math.max(0, featureLimit.limit - totalHits));
      res.header('X-RateLimit-Reset', String(Date.now() + timeToExpire));

      if (totalHits > featureLimit.limit) {
        const retryAfter = Math.ceil(timeToExpire / 1000);
        res.header('Retry-After', retryAfter.toString());

        const message = featureLimit.errorMessage || 'Terlalu banyak permintaan. Silakan coba lagi nanti.';
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message,
            error: 'Too Many Requests',
            retryAfter,
            feature,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      return true;
    }

    // Tanpa @ThrottleFeature(), gunakan limit default
    return super.handleRequest(requestProps);
  }

  /**
   * Override generateKey untuk menyertakan nama fitur dalam key.
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

  private getFeatureFromContext(context: ExecutionContext): ThrottlerFeature | null {
    const methodFeature = this.reflector.get<ThrottlerFeature>(
      THROTTLER_FEATURE_KEY,
      context.getHandler(),
    );

    if (methodFeature) {
      return methodFeature;
    }

    const classFeature = this.reflector.get<ThrottlerFeature>(
      THROTTLER_FEATURE_KEY,
      context.getClass(),
    );

    return classFeature || null;
  }
}