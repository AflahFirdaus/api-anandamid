import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ShippingService } from './shipping.service';
import { CheckRatesDto } from './dto/check-rates.dto';

@ApiTags('Shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('rates')
  @ApiOperation({ summary: 'Check courier rates', description: 'Get shipping rates from multiple couriers via Biteship API using postal code.' })
  @ApiBody({ type: CheckRatesDto })
  @ApiResponse({ status: 200, description: 'Shipping rates returned from Biteship' })
  @ApiResponse({ status: 400, description: 'Shipping API error' })
  async getRates(@Body() dto: CheckRatesDto) {
    return this.shippingService.checkRates(
      dto.originPostalCode,
      dto.destinationPostalCode,
      dto.couriers || 'jne,jnt,sicepat,tiki,pos',
      dto.items,
    );
  }
}