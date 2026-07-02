import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  private readonly biteshipBaseUrl = 'https://api.biteship.com/v1';
  private readonly apiKey = process.env.BITESHIP_API_KEY;

  async checkRates(originPostalCode: string, destinationPostalCode: string, couriers: string, items: any[]) {
    const requestBody = {
      origin_postal_code: originPostalCode,
      destination_postal_code: destinationPostalCode,
      couriers: couriers,
      items: items,
    };

    this.logger.log(`Biteship request: ${JSON.stringify(requestBody)}`);

    try {
      const response = await fetch(`${this.biteshipBaseUrl}/rates/couriers`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(`Biteship error response: ${response.status} - ${JSON.stringify(data)}`);
        throw new Error(data.error || data.message || `Biteship returned status ${response.status}`);
      }

      this.logger.log(`Biteship success: ${data?.pricing?.length || 0} rates found`);
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
