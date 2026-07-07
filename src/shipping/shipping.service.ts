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
  private get defaultOriginLatitude(): number | undefined {
    return process.env.STORE_LATITUDE ? parseFloat(process.env.STORE_LATITUDE) : -7.8300;
  }
  private get defaultOriginLongitude(): number | undefined {
    return process.env.STORE_LONGITUDE ? parseFloat(process.env.STORE_LONGITUDE) : 110.3870;
  }

  private strategies: ShippingRateStrategy[];

  constructor(
    private readonly regularStrategy: RegularCourierStrategy,
    private readonly instantStrategy: InstantCourierStrategy,
    @InjectRepository(UserAddress)
    private readonly addressRepo: Repository<UserAddress>,
  ) {
    this.strategies = [this.regularStrategy, this.instantStrategy];
  }

  private getStrategyForCourier(courier: string): ShippingRateStrategy | null {
    for (const strategy of this.strategies) {
      if (strategy.supports(courier)) {
        return strategy;
      }
    }
    return null;
  }

  /**
   * Resolve Biteship area_id from lat/lng coordinates via Maps API.
   */
  private async resolveAreaIdFromCoords(
    latitude: number,
    longitude: number,
  ): Promise<string | null> {
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
        this.logger.log(`Resolved area_id from coords: ${data.areas[0].id}`);
        return data.areas[0].id;
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`resolveAreaIdFromCoords fetch error: ${e.message}`);
      return null;
    }
  }

  /**
   * Resolve area_id using Biteship /maps/areas search by input (postal code / address text).
   * This returns precise area_id with IDZ suffix.
   */
  private async resolveAreaIdFromSearch(
    input: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${this.biteshipBaseUrl}/maps/areas?countries=ID&input=${encodeURIComponent(input)}&type=single`,
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
        this.logger.warn(`resolveAreaIdFromSearch error for "${input}": ${JSON.stringify(data)}`);
        return null;
      }
      if (data.areas && data.areas.length > 0) {
        this.logger.log(`Resolved area_id from search "${input}": ${data.areas[0].id}`);
        return data.areas[0].id;
      }
      return null;
    } catch (e: any) {
      this.logger.warn(`resolveAreaIdFromSearch fetch error for "${input}": ${e.message}`);
      return null;
    }
  }

  /**
   * Resolve area_id from postal_code for destination when lat/lng unavailable.
   * Uses Biteship /maps/areas search by input (postal code / address text).
   */
  private async resolveAreaIdFromPostalCode(
    postalCode: string,
  ): Promise<string | null> {
    return this.resolveAreaIdFromSearch(postalCode);
  }

  /**
   * Resolve destination area_id by trying: 1) lat/lng, 2) postal_code, 3) null
   */
  private async ensureDestinationAreaId(
    destLat: number | undefined,
    destLng: number | undefined,
    destinationPostalCode: string | number | undefined,
    destinationAddressId: string | undefined,
    storedAreaId?: string,
  ): Promise<string | undefined> {
    // PRIORITY ORDER NOTE:
    // Biteship /maps/areas?latitude=&longitude= returns area_id WITHOUT postal code suffix (IDZ)
    // e.g. "IDNP6IDNC147IDND829" → imprecise, fails for same-city routes (error 40001010)
    //
    // Biteship /maps/areas?input={postalCode} returns area_id WITH postal code suffix (IDZ)
    // e.g. "IDNP6IDNC147IDND829IDZ52281" → precise, works for same-city routes
    //
    // Therefore: POSTAL CODE or structured text search must be tried FIRST for regular courier area_id resolution.

    // Load DB address if available so we can do fallback searches
    let dbAddr: UserAddress | null = null;
    if (destinationAddressId) {
      dbAddr = await this.addressRepo.findOne({
        where: { id: destinationAddressId },
      });
    }

    // First: try postal_code from DTO (highest precision — includes IDZ suffix)
    if (destinationPostalCode) {
      const resolved = await this.resolveAreaIdFromSearch(
        destinationPostalCode.toString(),
      );
      if (resolved) return resolved;
    }

    // Second: try DB address postal_code (also precise — includes IDZ suffix)
    if (dbAddr && dbAddr.postal_code) {
      const resolved = await this.resolveAreaIdFromSearch(dbAddr.postal_code);
      if (resolved) return resolved;
    }

    // Third: try DB address subdistrict, district, city (also precise — includes IDZ suffix)
    // This serves as an extremely robust fallback if the postal code was incorrect or unrecognized
    if (dbAddr) {
      const addressParts = [
        dbAddr.subdistrict,
        dbAddr.district,
        dbAddr.city,
      ].filter((part) => part && part.trim() !== '');

      if (addressParts.length > 0) {
        const searchText = addressParts.join(', ');
        const resolved = await this.resolveAreaIdFromSearch(searchText);
        if (resolved) return resolved;

        // Try a broader search if the specific one failed (e.g. just "Ngaglik, Sleman")
        if (addressParts.length > 1) {
          const broadSearchText = addressParts.slice(1).join(', ');
          const resolvedBroad = await this.resolveAreaIdFromSearch(broadSearchText);
          if (resolvedBroad) return resolvedBroad;
        }
      }
    }

    // Fourth: try lat/lng — fallback only, returns area_id WITHOUT IDZ suffix (imprecise)
    // May still fail for same-city routes if no postal_code is available
    if (destLat && destLng) {
      const resolved = await this.resolveAreaIdFromCoords(destLat, destLng);
      if (resolved) return resolved;
    }

    // Last resort: use stored area_id from DB (also imprecise, no IDZ suffix)
    if (storedAreaId) {
      this.logger.warn(
        `Using stored area_id as last resort (imprecise, no IDZ suffix — same-city may fail): ${storedAreaId}`,
      );
      return storedAreaId;
    }

    return undefined;
  }

  /**
   * Resolve origin area_id by trying: 1) store default postal_code, 2) postal_code from DTO, 3) DB address postal_code, 4) lat/lng fallback
   * NOTE: postal_code is prioritized over lat/lng because Biteship's coordinate API returns
   * area_id WITHOUT postal code suffix (IDZ), which causes error 40001010 for same-city routes.
   * Postal code search returns precise area_id WITH IDZ suffix.
   */
  private async ensureOriginAreaId(
    originLat: number | undefined,
    originLng: number | undefined,
    originPostalCode: string | number | undefined,
    originAddressId: string | undefined,
  ): Promise<string | undefined> {
    // First: try store default postal_code (highest precision — includes IDZ suffix)
    if (this.defaultOriginPostalCode) {
      const resolved = await this.resolveAreaIdFromSearch(this.defaultOriginPostalCode);
      if (resolved) return resolved;
    }

    // Second: try postal_code from DTO
    if (originPostalCode) {
      const resolved = await this.resolveAreaIdFromSearch(originPostalCode.toString());
      if (resolved) return resolved;
    }

    // Third: try DB address postal_code
    if (originAddressId) {
      const addr = await this.addressRepo.findOne({
        where: { id: originAddressId },
      });
      if (addr && addr.postal_code) {
        const resolved = await this.resolveAreaIdFromSearch(addr.postal_code);
        if (resolved) return resolved;
      }
    }

    // Fourth: lat/lng fallback — returns area_id WITHOUT IDZ suffix (imprecise)
    if (originLat && originLng) {
      const resolved = await this.resolveAreaIdFromCoords(originLat, originLng);
      if (resolved) return resolved;
    }

    return undefined;
  }

  async checkRates(dto: CheckRatesRefactoredDto) {
    const {
      originAddressId,
      destinationAddressId,
      originLatitude,
      originLongitude,
      destinationLatitude,
      destinationLongitude,
      originPostalCode,
      destinationPostalCode,
      couriers = 'jne,jnt,sicepat,tiki,pos',
      items = [],
    } = dto;

    let originAreaId: string | undefined;
    let originLat: number | undefined = originLatitude ? parseFloat(originLatitude.toString()) : undefined;
    let originLng: number | undefined = originLongitude ? parseFloat(originLongitude.toString()) : undefined;

    if (originAddressId) {
      const originAddr = await this.addressRepo.findOne({
        where: { id: originAddressId },
      });
      if (originAddr) {
        originAreaId = originAddr.area_id || undefined;
        originLat = originAddr.latitude ? parseFloat(originAddr.latitude.toString()) : originLat;
        originLng = originAddr.longitude ? parseFloat(originAddr.longitude.toString()) : originLng;
      }
    }

    if (!originAreaId) {
      originAreaId = this.defaultOriginAreaId || undefined;
    }
    if (!originLat || !originLng) {
      originLat = this.defaultOriginLatitude || undefined;
      originLng = this.defaultOriginLongitude || undefined;
    }

    let destinationAreaId: string | undefined;
    let destLat: number | undefined = destinationLatitude ? parseFloat(destinationLatitude.toString()) : undefined;
    let destLng: number | undefined = destinationLongitude ? parseFloat(destinationLongitude.toString()) : undefined;
    let storedDestAreaId: string | undefined;

    if (destinationAddressId) {
      const destAddr = await this.addressRepo.findOne({
        where: { id: destinationAddressId },
      });
      if (destAddr) {
        // Store the DB area_id as fallback only — do NOT use directly.
        // Stored area_id may lack postal code suffix (e.g. IDND829 vs IDZ55283)
        // which causes Biteship error 40001010 for same-city routes.
        storedDestAreaId = destAddr.area_id || undefined;
        destLat = destAddr.latitude ? parseFloat(destAddr.latitude.toString()) : destLat;
        destLng = destAddr.longitude ? parseFloat(destAddr.longitude.toString()) : destLng;
      }
    }

    // Always re-resolve destination area_id from lat/lng or postal_code
    // for maximum precision. Stored area_id is passed as last resort only.
    destinationAreaId = await this.ensureDestinationAreaId(
      destLat,
      destLng,
      destinationPostalCode,
      destinationAddressId,
      storedDestAreaId,
    );

    // If origin has no area_id, try to resolve it from store default postal code
    if (!originAreaId) {
      originAreaId = await this.ensureOriginAreaId(
        originLat,
        originLng,
        originPostalCode,
        originAddressId,
      );
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
        originPostalCode: originPostalCode || this.defaultOriginPostalCode,
        destinationPostalCode,
        couriers: courier,
        items,
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const requestBody = strategy.buildRequest(request);
      const endpoint = strategy.getEndpoint();

      // For /rates/couriers: if BOTH area_ids missing, fallback to postal codes
      // Only do this for regular couriers (not instant strategy, which uses coordinates)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (endpoint === '/rates/couriers' && !(strategy instanceof InstantCourierStrategy)) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const hasOriginArea = !!requestBody.origin_area_id;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const hasDestArea = !!requestBody.destination_area_id;

        if (!hasOriginArea && !hasDestArea) {
          // Fallback: use postal codes entirely (Biteship requires at least one approach)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          requestBody.origin_postal_code =
            parseInt(this.defaultOriginPostalCode, 10) || 55283;

          const dbDestAddr = destinationAddressId
            ? await this.addressRepo.findOne({
                where: { id: destinationAddressId },
              })
            : null;

          const destPostal =
            (dbDestAddr && dbDestAddr.postal_code) ||
            destinationPostalCode?.toString() ||
            '';
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          requestBody.destination_postal_code =
            parseInt(destPostal, 10) || 0;
        }
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await this.callBiteshipApi(endpoint, requestBody);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (result.pricing) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
          allResults.push(...result.pricing);
        }
      } catch (error: any) {
        this.logger.error(
          `Biteship error for courier ${courier}: ${error.message}`,
        );
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
      parseInt(
        (originPostalCode || this.defaultOriginPostalCode).toString(),
        10,
      ) || 55283;
    const dest =
      parseInt((destinationPostalCode || '').toString(), 10) || undefined;
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

  private async callBiteshipApi(
    endpoint: string,
    requestBody: any,
  ): Promise<any> {
    this.logger.log(
      `Biteship request to ${endpoint}: ${JSON.stringify(requestBody)}`,
    );

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
        this.logger.error(
          `Biteship error response: ${response.status} - ${JSON.stringify(data)}`,
        );
        throw new Error(
          data.error ||
            data.message ||
            `Biteship returned status ${response.status}`,
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