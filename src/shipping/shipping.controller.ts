import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ShippingService } from './shipping.service';
import { CheckRatesDto } from './dto/check-rates.dto';

@ApiTags('Shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('rates')
  @ApiOperation({ summary: 'Check courier rates', description: 'Get shipping rates from multiple couriers via Biteship API.' })
  @ApiBody({ type: CheckRatesDto })
  @ApiResponse({ status: 200, description: 'Shipping rates returned from Biteship' })
  @ApiResponse({ status: 400, description: 'Shipping API error' })
  async getRates(
    @Body()
    body: {
      originPostalCode: string;
      destinationPostalCode: string;
      couriers: string;
      items: any[];
    },
  ) {
    return this.shippingService.checkRates(
      body.originPostalCode,
      body.destinationPostalCode,
      body.couriers,
      body.items,
    );
  }
}