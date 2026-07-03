import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
  IsUUID,
} from 'class-validator';

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

export class CheckRatesRefactoredDto {
  @ApiPropertyOptional({
    description: 'Origin address UUID (resolves area_id, lat, lng from database)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  @IsUUID()
  originAddressId?: string;

  @ApiPropertyOptional({
    description: 'Destination address UUID (resolves area_id, lat, lng from database)',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsOptional()
  @IsUUID()
  destinationAddressId?: string;

  @ApiPropertyOptional({
    description: 'Origin latitude (for instant courier, overrides address lookup)',
    example: -7.447,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  originLatitude?: number;

  @ApiPropertyOptional({
    description: 'Origin longitude (for instant courier, overrides address lookup)',
    example: 112.718,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  originLongitude?: number;

  @ApiPropertyOptional({
    description: 'Destination latitude (for instant courier, overrides address lookup)',
    example: -7.45,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  destinationLatitude?: number;

  @ApiPropertyOptional({
    description: 'Destination longitude (for instant courier, overrides address lookup)',
    example: 112.721,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  destinationLongitude?: number;

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