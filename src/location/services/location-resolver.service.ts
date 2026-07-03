import { Injectable, Logger } from '@nestjs/common';
import { LocationResolver, LocationResult } from '../interfaces/location-resolver.interface';
import { BiteshipLocationResolverService } from './biteship-location-resolver.service';

@Injectable()
export class LocationResolverService {
  private readonly logger = new Logger(LocationResolverService.name);
  private resolver: LocationResolver;

  constructor(private readonly biteshipResolver: BiteshipLocationResolverService) {
    // Default to Biteship; can be swapped via setResolver()
    this.resolver = biteshipResolver;
  }

  /**
   * Swap the underlying location resolver provider.
   * Allows switching between Biteship, Google Maps, OpenStreetMap, etc.
   */
  setResolver(resolver: LocationResolver): void {
    this.logger.log(`Switching location resolver to: ${resolver.constructor.name}`);
    this.resolver = resolver;
  }

  /**
   * Resolve full location details from latitude/longitude coordinates.
   * Returns province, city, district, subdistrict, postalCode, areaId, lat, lng.
   */
  async resolve(latitude: number, longitude: number): Promise<LocationResult> {
    this.logger.log(`Resolving location: ${latitude}, ${longitude}`);
    return this.resolver.resolve(latitude, longitude);
  }

  /**
   * Get Biteship Area ID from coordinates.
   */
  async getAreaId(latitude: number, longitude: number): Promise<string> {
    return this.resolver.getAreaId(latitude, longitude);
  }
}