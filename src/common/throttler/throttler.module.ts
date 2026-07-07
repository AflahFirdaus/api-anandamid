import { Module, Global } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule as NestThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { throttlerConfig } from '../../config/throttler.config';
import { ThrottlerFeatureGuard } from './throttler-feature.guard';
import { createThrottlerStorage } from './throttler-storage.factory';

/**
 * ThrottlerModule kustom yang:
 * 1. Meregister ThrottlerModule NestJS dengan konfigurasi multi-feature
 * 2. Menyediakan Redis storage (fallback ke in-memory jika Redis tidak dikonfigurasi)
 * 3. Mendaftarkan ThrottlerFeatureGuard sebagai global guard
 *
 * Modul ini di-import oleh AppModule.
 */
@Global()
@Module({
  imports: [
    NestThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        ...throttlerConfig,
        storage: createThrottlerStorage(configService),
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerFeatureGuard,
    },
  ],
  exports: [],
})
export class ThrottlerModule {}