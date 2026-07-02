import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class RateItemDto {
  @ApiProperty({ description: 'Item name', example: 'Laptop ASUS ROG' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Item description', example: 'Gaming laptop 16GB RAM, hitam' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'Item value in IDR', example: 15000000 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  value: number;

  @ApiProperty({ description: 'Item length in cm', example: 35 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  length: number;

  @ApiProperty({ description: 'Item width in cm', example: 25 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  width: number;

  @ApiProperty({ description: 'Item height in cm', example: 5 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  height: number;

  @ApiProperty({ description: 'Item weight in grams', example: 2500 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  weight: number;

  @ApiProperty({ description: 'Item quantity', example: 1 })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CheckRatesDto {
  @ApiPropertyOptional({
    description: 'Origin postal code (number)',
    example: 55283,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  originPostalCode?: number;

  @ApiProperty({
    description: 'Destination postal code (number)',
    example: 12950,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  destinationPostalCode: number;

  @ApiPropertyOptional({
    description: 'Comma-separated courier codes',
    example: 'jne,jnt,sicepat',
    default: 'jne,jnt,sicepat,tiki,pos',
  })
  @IsOptional()
  @IsString()
  couriers?: string;

  @ApiProperty({
    description: 'Array of items with dimensions, weight, and value',
    type: [RateItemDto],
    example: [
      { name: 'Laptop ASUS ROG', description: 'Gaming laptop 16GB', value: 15000000, length: 35, width: 25, height: 5, weight: 2500, quantity: 1 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateItemDto)
  items: RateItemDto[];
}