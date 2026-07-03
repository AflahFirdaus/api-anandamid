import { Injectable } from '@nestjs/common';
import { ShippingRateStrategy, ShippingRateRequest } from './shipping-rate.strategy';

/**
 * Regular couriers: JNE, J&T, SiCepat, Ninja, AnterAja, Pos Indonesia, etc.
 * These use Area ID for shipping rate calculation.
 */
const REGULAR_COURIERS = ['jne', 'jnt', 'sicepat', 'ninja', 'anteraja', 'pos', 'tiki', 'wahana', 'lion', 'repex'];

@Injectable()
export class RegularCourierStrategy implements ShippingRateStrategy {
  supports(courier: string): boolean {
    return REGULAR_COURIERS.some((c) => courier.toLowerCase().startsWith(c));
  }

  getEndpoint(): string {
    return '/rates/couriers';
  }

  buildRequest(request: ShippingRateRequest): any {
    const itemsInKg = request.items.map((item) => ({
      ...item,
      weight: item.weight / 1000, // grams → kg
    }));

    return {
      origin_area_id: request.originAreaId,
      destination_area_id: request.destinationAreaId,
      couriers: request.couriers,
      items: itemsInKg,
    };
  }
}