import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ShippingRateStrategy, ShippingRateRequest } from './strategies/shipping-rate.strategy';
import { RegularCourierStrategy } from './strategies/regular-courier.strategy';
import { InstantCourierStrategy } from './strategies/instant-courier.strategy';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAddress } from '../user/entities/user-address.entity';
import { CheckRatesRefactoredDto } from './dto/check-rates-refactored.dto';

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  private readonly biteshipBaseUrl = 'https://api.biteship.com/v1';
  private readonly apiKey = process.env.BITESHIP_API_KEY;
  private readonly defaultOriginPostalCode = process.env.STORE_POSTAL_CODE || '55283';
  private readonly defaultOriginAreaId = process.env.STORE_AREA_ID || '';

  private strategies: ShippingRateStrategy[];

  constructor(
    private readonly regularStrategy: RegularCourierStrategy,
    private readonly instantStrategy: InstantCourierStrategy,
    @InjectRepository(UserAddress)
    private readonly addressRepo: Repository<UserAddress>,
  ) {
    this.strategies = [this.regularStrategy, this.instantStrategy];
  }

  /**
   * Get the appropriate strategy for the requested couriers.
   */
  private getStrategyForCourier(courier: string): ShippingRateStrategy | null {
    for (const strategy of this.strategies) {
      if (strategy.supports(courier)) {
        return strategy;
      }
    }
    return null;
  }

  /**
   * Resolve Biteship area_id from lat/lng coordinates.
   */
  private async resolveAreaIdFromCoords(latitude: number, longitude: number): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.biteshipBaseUrl}/maps/areas?latitude=${latitude}&longitude=${longitude}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const data = await response.json();

      if (!response.ok) {
        this.logger.warn(`resolveAreaIdFromCoords error: ${JSON.stringify(data)}`);
        return null;
      }

      if (data.areas && data.areas.length > 0) {
        return data.areas[0].id;
      }

      return null;
    } catch (e: any) {
      this.logger.warn(`resolveAreaIdFromCoords fetch error: ${e.message}`);
      return null;
    }
  }

  /**
   * Check shipping rates using the appropriate strategy (Area ID or Lat/Lng).
   */
  async checkRates(dto: CheckRatesRefactoredDto) {
    const {
      originAddressId,
      destinationAddressId,
      originLatitude,
      originLongitude,
      destinationLatitude,
      destinationLongitude,
      couriers = 'jne,jnt,sicepat,tiki,pos',
      items = [],
    } = dto;

    // Resolve origin address if addressId is provided
    let originAreaId: string | undefined;
    let originLat: number | undefined = originLatitude;
    let originLng: number | undefined = originLongitude;

    if (originAddressId) {
      const originAddr = await this.addressRepo.findOne({ where: { id: originAddressId } });
      if (originAddr) {
        originAreaId = originAddr.area_id || undefined;
        originLat = originAddr.latitude || originLat;
        originLng = originAddr.longitude || originLng;
      }
    }

    if (!originAreaId) {
      originAreaId = this.defaultOriginAreaId || undefined;
    }
    if (!originLat || !originLng) {
      originLat = undefined;
      originLng = undefined;
    }

    // Resolve destination address
    let destinationAreaId: string | undefined;
    let destLat: number | undefined = destinationLatitude;
    let destLng: number | undefined = destinationLongitude;

    if (destinationAddressId) {
      const destAddr = await this.addressRepo.findOne({ where: { id: destinationAddressId } });
      if (destAddr) {
        destinationAreaId = destAddr.area_id || undefined;
        destLat = destAddr.latitude || destLat;
        destLng = destAddr.longitude || destLng;
      }
    }

    const courierList = couriers.split(',').map((c) => c.trim().toLowerCase());
    const allResults: any[] = [];

    for (const courier of courierList) {
      const strategy = this.getStrategyForCourier(courier);
      if (!strategy) {
        this.logger.warn(`No strategy found for courier: ${courier}, skipping`);
        continue;
      }

      const request: ShippingRateRequest = {
        originAreaId,
        destinationAreaId: destinationAreaId || undefined,
        originLatitude: originLat,
        originLongitude: originLng,
        destinationLatitude: destLat,
        destinationLongitude: destLng,
        couriers: courier,
        items,
      };

      /* eslint-disable no-unsafe-member-access, no-unsafe-assignment, no-unsafe-call */
      const requestBody = strategy.buildRequest(request);

      // If /rates/couriers endpoint, ensure both area_ids; resolve from lat/lng if DB has none
      if (strategy.getEndpoint() === '/rates/couriers') {
        // Resolve origin area_id from coords if missing
        if (!requestBody.origin_area_id && originLat && originLng) {
          const resolved = await this.resolveAreaIdFromCoords(originLat, originLng);
          if (resolved) {
            requestBody.origin_area_id = resolved;
          }
        }

        // Resolve destination area_id from coords if missing
        if (!requestBody.destination_area_id && destLat && destLng) {
          const resolved = await this.resolveAreaIdFromCoords(destLat, destLng);
          if (resolved) {
            requestBody.destination_area_id = resolved;
          }
        }

        // If EITHER area_id is still missing, switch entirely to postal codes
        if (!requestBody.origin_area_id || !requestBody.destination_area_id) {
          delete requestBody.origin_area_id;
          delete requestBody.destination_area_id;
          requestBody.origin_postal_code = parseInt(this.defaultOriginPostalCode, 10) || 55283;

          const dbDestAddr = destinationAddressId
            ? await this.addressRepo.findOne({ where: { id: destinationAddressId } })
            : null;

          if (dbDestAddr && dbDestAddr.postal_code) {
            requestBody.destination_postal_code = parseInt(dbDestAddr.postal_code, 10);
          } else if (dto.destinationPostalCode) {
            requestBody.destination_postal_code = parseInt(dto.destinationPostalCode.toString(), 10);
          }
        }
      }
      /* eslint-enable no-unsafe-member-access, no-unsafe-assignment, no-unsafe-call */

      const endpoint = strategy.getEndpoint();

      try {
        const result = await this.callBiteshipApi(endpoint, requestBody);
        if (result.pricing) {
          allResults.push(...result.pricing);
        }
      } catch (error: any) {
        this.logger.error(`Biteship error for courier ${courier}: ${error.message}`);
      }
    }

    return { pricing: allResults };
  }

  async checkRatesLegacy(
    originPostalCode: string | undefined,
    destinationPostalCode: string,
    couriers: string = 'jne,jnt,sicepat,tiki,pos',
    items: any[] = [],
  ) {
    const origin =
      parseInt((originPostalCode || this.defaultOriginPostalCode).toString(), 10) || 55283;
    const dest = parseInt((destinationPostalCode || '').toString(), 10) || undefined;
    const itemsInKg = items.map((item) => ({
      ...item,
      weight: item.weight / 1000,
    }));

    const requestBody: any = {
      origin_postal_code: origin,
      couriers,
      items: itemsInKg,
    };
    if (dest) {
      requestBody.destination_postal_code = dest;
    }

    return this.callBiteshipApi('/rates/couriers', requestBody);
  }

  private async callBiteshipApi(endpoint: string, requestBody: any): Promise<any> {
    this.logger.log(`Biteship request to ${endpoint}: ${JSON.stringify(requestBody)}`);

    try {
      const response = await fetch(`${this.biteshipBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();
      this.logger.log(
        `Biteship response: ${response.status} - ${JSON.stringify(data).substring(0, 300)}`,
      );

      if (!response.ok) {
        this.logger.error(`Biteship error response: ${response.status} - ${JSON.stringify(data)}`);
        throw new Error(
          data.error || data.message || `Biteship returned status ${response.status}`,
        );
      }

      return data;
    } catch (error: any) {
      this.logger.error(`Shipping API Error: ${error.message}`);
      throw new HttpException(
        `Shipping API Error: ${error.message || 'Failed to fetch shipping rates'}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}