import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  private readonly biteshipBaseUrl = 'https://api.biteship.com/v1';
  private readonly apiKey = process.env.BITESHIP_API_KEY;
  private readonly defaultOriginPostalCode = process.env.STORE_POSTAL_CODE || '55283';

  async checkRates(
    originPostalCode: string,
    destinationPostalCode: string,
    couriers: string = 'jne,jnt,sicepat,tiki,pos',
    items: any[] = [],
  ) {
    const origin = originPostalCode || this.defaultOriginPostalCode;

    const requestBody = {
      origin_postal_code: origin,
      destination_postal_code: destinationPostalCode,
      couriers,
      items,
    };

    this.logger.log(
      `Biteship request (origin: ${origin}): ${JSON.stringify(requestBody)}`,
    );

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
      this.logger.log(`Biteship response: ${response.status} - ${JSON.stringify(data).substring(0, 300)}`);

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

      this.logger.log(
        `Biteship success: ${data?.pricing?.length || 0} rates found`,
      );
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