import { SetMetadata } from '@nestjs/common';
import { ThrottlerFeature } from './throttler-feature.enum';

export const THROTTLER_FEATURE_KEY = 'throttler:feature';

/**
 * Decorator untuk menandai handler/controller dengan fitur throttling tertentu.
 *
 * Contoh penggunaan:
 * ```ts
 * @ThrottleFeature(ThrottlerFeature.SEARCH)
 * @Get('search')
 * async search(@Query() query: SearchDto) { ... }
 * ```
 *
 * Bisa juga di level controller untuk apply ke semua method di dalamnya:
 * ```ts
 * @Controller('shipping')
 * @ThrottleFeature(ThrottlerFeature.SHIPPING)
 * export class ShippingController { ... }
 * ```
 */
export const ThrottleFeature = (feature: ThrottlerFeature) =>
  SetMetadata(THROTTLER_FEATURE_KEY, feature);