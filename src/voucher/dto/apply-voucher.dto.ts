import { IsString, IsNotEmpty, IsNumber, Min, IsOptional, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApplyVoucherDto {
  @ApiProperty({
    description: 'Kode voucher yang akan diaplikasikan',
    example: 'NEWUSER50',
  })
  @IsString()
  @IsNotEmpty({ message: 'Kode voucher wajib diisi' })
  voucherCode: string;

  @ApiProperty({
    description: 'Total belanja sebelum diskon',
    example: 250000,
    minimum: 0,
  })
  @IsNumber()
  @Min(0, { message: 'Total belanja tidak boleh negatif' })
  orderTotal: number;

  @ApiPropertyOptional({
    description: 'Array product IDs yang ada di keranjang checkout (untuk validasi voucher target)',
    example: ['product-uuid-1', 'product-uuid-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}