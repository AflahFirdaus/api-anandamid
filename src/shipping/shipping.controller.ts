import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { ShippingService } from './shipping.service';
import { CheckRatesRefactoredDto } from './dto/check-rates-refactored.dto';

@ApiTags('Shipping')
@Controller('shipping')
export class ShippingController {
  constructor(private readonly shippingService: ShippingService) {}

  /**
   * Auto-detect endpoint: jika body mengandung originAddressId atau destinationAddressId,
   * gunakan checkRates (strategy pattern). Jika tidak, fallback ke checkRatesLegacy (postal code).
   */
  @Post('rates')
  @ApiOperation({
    summary: 'Check courier rates',
    description:
      'Auto-detect mode: uses Area ID strategy if originAddressId/destinationAddressId provided, otherwise falls back to postal code.',
  })
  @ApiBody({ type: CheckRatesRefactoredDto })
  @ApiResponse({ status: 200, description: 'Shipping rates returned from Biteship' })
  @ApiResponse({ status: 400, description: 'Shipping API error' })
  async getRates(@Body() dto: any) {
    // Jika ada originAddressId atau destinationAddressId, pakai strategy pattern baru
    if (dto.originAddressId || dto.destinationAddressId) {
      return this.shippingService.checkRates(dto);
    }
    // Fallback: legacy postal code
    return this.shippingService.checkRatesLegacy(
      dto.originPostalCode?.toString(),
      dto.destinationPostalCode?.toString() || '',
      dto.couriers || 'jne,jnt,sicepat,tiki,pos',
      dto.items || [],
    );
  }
}
