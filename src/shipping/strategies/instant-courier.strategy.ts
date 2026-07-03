import { Injectable } from '@nestjs/common';
import { ShippingRateStrategy, ShippingRateRequest } from './shipping-rate.strategy';

/**
 * Instant couriers: GoSend, GrabExpress, Lalamove, Borzo, etc.
 * These use Latitude and Longitude for shipping rate calculation.
 */
const INSTANT_COURIERS = ['gosend', 'grabexpress', 'lalamove', 'borzo', 'deliveree', 'sicepat', 'sicepat instant'];

@Injectable()
export class InstantCourierStrategy implements ShippingRateStrategy {
  supports(courier: string): boolean {
    return INSTANT_COURIERS.some((c) => courier.toLowerCase().startsWith(c.toLowerCase()));
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
      origin_latitude: request.originLatitude,
      origin_longitude: request.originLongitude,
      destination_latitude: request.destinationLatitude,
      destination_longitude: request.destinationLongitude,
      couriers: request.couriers,
      items: itemsInKg,
    };
  }
}