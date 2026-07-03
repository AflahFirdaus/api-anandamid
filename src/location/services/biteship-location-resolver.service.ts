import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { LocationResolver, LocationResult } from '../interfaces/location-resolver.interface';

@Injectable()
export class BiteshipLocationResolverService implements LocationResolver {
  private readonly logger = new Logger(BiteshipLocationResolverService.name);
  private readonly biteshipBaseUrl = 'https://api.biteship.com/v1';
  private readonly apiKey = process.env.BITESHIP_API_KEY;

  async resolve(latitude: number, longitude: number): Promise<LocationResult> {
    try {
      const areaId = await this.getAreaId(latitude, longitude);
      const mapDetail = await this.getMapDetail(areaId);

      return {
        province: mapDetail.province || '',
        city: mapDetail.city || '',
        district: mapDetail.district || '',
        subdistrict: mapDetail.subdistrict || '',
        postalCode: mapDetail.postal_code || '',
        areaId: areaId,
        latitude,
        longitude,
      };
    } catch (error: any) {
      this.logger.error(`Location resolution error: ${error.message}`);
      throw new HttpException(
        `Failed to resolve location: ${error.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async getAreaId(latitude: number, longitude: number): Promise<string> {
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
        throw new Error(
          data.error || data.message || `Biteship Maps API returned status ${response.status}`,
        );
      }

      // Biteship returns an array of areas; take the closest match (first result)
      if (!data.areas || data.areas.length === 0) {
        throw new Error('No area found for the given coordinates');
      }

      const area = data.areas[0];
      return area.id;
    } catch (error: any) {
      this.logger.error(`Biteship getAreaId error: ${error.message}`);
      throw error;
    }
  }

  private async getMapDetail(areaId: string): Promise<any> {
    try {
      const response = await fetch(`${this.biteshipBaseUrl}/maps/areas/${areaId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || data.message || `Biteship Maps Detail API returned status ${response.status}`,
        );
      }

      return data;
    } catch (error: any) {
      this.logger.error(`Biteship getMapDetail error: ${error.message}`);
      throw error;
    }
  }
}