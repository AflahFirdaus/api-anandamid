import { ApiProperty } from '@nestjs/swagger';

class RateItemDto {
  @ApiProperty({ description: 'Item name', example: 'Laptop' })
  name: string;

  @ApiProperty({ description: 'Weight in kg', example: 2.5 })
  weight: number;

  @ApiProperty({ description: 'Item value in IDR', example: 15000000 })
  value: number;

  @ApiProperty({ description: 'Quantity', example: 1 })
  quantity: number;
}

export class CheckRatesDto {
  @ApiProperty({
    description: 'Origin postal code',
    example: '65139',
  })
  originPostalCode: string;

  @ApiProperty({
    description: 'Destination postal code',
    example: '12950',
  })
  destinationPostalCode: string;

  @ApiProperty({
    description: 'Comma-separated courier codes (jne, jnt, sicepat, tiki, pos, etc.)',
    example: 'jne,jnt,sicepat',
  })
  couriers: string;

  @ApiProperty({
    description: 'Array of items with weight and value',
    type: [RateItemDto],
    example: [
      { name: 'Laptop', weight: 2.5, value: 15000000, quantity: 1 },
    ],
  })
  items: any[];
}