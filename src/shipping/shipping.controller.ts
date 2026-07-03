import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ShippingService } from './shipping.service';
import { CheckRatesDto } from './dto/check-rates.dto';
import { CheckRatesRefactoredDto } from './dto/check-rates-refactored.dto';

@ApiTags('Shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  @Post('rates')
  @ApiOperation({
    summary: 'Check courier rates (new)',
    description:
      'Get shipping rates from multiple couriers via Biteship API. Uses Area ID for regular couriers (JNE, J&T, SiCepat, etc.) and Lat/Lng for instant couriers (GoSend, GrabExpress, etc.). Pass address UUIDs to auto-resolve area_id and coordinates from database.',
  })
  @ApiBody({ type: CheckRatesRefactoredDto })
  @ApiResponse({ status: 200, description: 'Shipping rates returned from Biteship' })
  @ApiResponse({ status: 400, description: 'Shipping API error' })
  async getRates(@Body() dto: CheckRatesRefactoredDto) {
    return this.shippingService.checkRates(dto);
  }

  @Post('rates/legacy')
  @ApiOperation({
    summary: 'Check courier rates (legacy)',
    description:
      'Legacy endpoint using postal code. Kept for backward compatibility. Will be deprecated.',
  })
  @ApiBody({ type: CheckRatesDto })
  @ApiResponse({ status: 200, description: 'Shipping rates returned from Biteship' })
  @ApiResponse({ status: 400, description: 'Shipping API error' })
  async getRatesLegacy(@Body() dto: CheckRatesDto) {
    return this.shippingService.checkRatesLegacy(
      dto.originPostalCode?.toString(),
      dto.destinationPostalCode.toString(),
      dto.couriers || 'jne,jnt,sicepat,tiki,pos',
      dto.items,
    );
  }
}