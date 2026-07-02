import { Injectable, HttpException, HttpStatus } from '@nestjs/common';

@Injectable()
export class ShippingService {
  private readonly biteshipBaseUrl = 'https://api.biteship.com/v1';
  private readonly apiKey = process.env.BITESHIP_API_KEY;

  async checkRates(originPostalCode: string, destinationPostalCode: string, couriers: string, items: any[]) {
    try {
      const response = await fetch(`${this.biteshipBaseUrl}/rates/couriers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin_postal_code: originPostalCode,
          destination_postal_code: destinationPostalCode,
          couriers: couriers, // e.g., "jne,jnt,sicepat"
          items: items, // Array of items with weight and value
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch rates from Biteship');
      }
      return data;
    } catch (error) {
      throw new HttpException(`Shipping API Error: ${error.message}`, HttpStatus.BAD_REQUEST);
    }
  }
}