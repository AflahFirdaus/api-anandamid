import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAddressDto {
  @ApiProperty({
    description: 'Recipient name',
    example: 'John Doe',
  })
  @IsNotEmpty()
  @IsString()
  recipient_name: string;

  @ApiProperty({
    description: 'Recipient phone number',
    example: '08123456789',
  })
  @IsNotEmpty()
  @IsString()
  phone_number: string;

  @ApiProperty({
    description: 'Address label',
    example: 'Rumah',
  })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({
    description: 'Full street address',
    example: 'Jl. Merdeka No. 10, RT 05 RW 02',
  })
  @IsNotEmpty()
  @IsString()
  full_address: string;

  @ApiPropertyOptional({
    description: 'Province name',
    example: 'Daerah Istimewa Yogyakarta',
  })
  @IsOptional()
  @IsString()
  province?: string;

  @ApiPropertyOptional({
    description: 'City / Kabupaten name',
    example: 'Sleman',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    description: 'District / Kecamatan name',
    example: 'Depok',
  })
  @IsOptional()
  @IsString()
  district?: string;

  @ApiPropertyOptional({
    description: 'Subdistrict / Kelurahan name',
    example: 'Caturtunggal',
  })
  @IsOptional()
  @IsString()
  subdistrict?: string;

  @ApiPropertyOptional({
    description: 'Postal code',
    example: '55281',
  })
  @IsOptional()
  @IsString()
  postal_code?: string;

  @ApiPropertyOptional({
    description: 'Biteship Area ID for regular courier shipping rate calculation',
    example: '5f8a7b3c-2d1e-4f6a-8c9b-0d1e2f3a4b5c',
  })
  @IsOptional()
  @IsString()
  area_id?: string;

  @ApiPropertyOptional({
    description: 'Latitude (-90 to 90) for instant courier',
    example: -7.447,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Longitude (-180 to 180) for instant courier',
    example: 112.718,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Set as default address',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;
}