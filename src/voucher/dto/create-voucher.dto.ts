import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  MaxLength,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VoucherType, DiscountType } from '../entities/voucher.entity';

// ──────────────────────────────────────────────
//  Custom Validator: endDate > startDate
// ──────────────────────────────────────────────

@ValidatorConstraint({ name: 'isAfterStartDate', async: false })
export class IsAfterStartDate implements ValidatorConstraintInterface {
  validate(endDate: string, args: ValidationArguments) {
    const dto = args.object as CreateVoucherDto;
    if (!dto.startDate || !endDate) return true; // Biarkan @IsNotEmpty yang handle
    return new Date(endDate) > new Date(dto.startDate);
  }

  defaultMessage(): string {
    return 'endDate harus lebih besar dari startDate';
  }
}

// ──────────────────────────────────────────────
//  DTO
// ──────────────────────────────────────────────

export class CreateVoucherDto {
  @ApiProperty({
    description: 'Kode voucher unik (huruf kapital)',
    example: 'PROMO100',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @ApiProperty({
    description: 'Nama promo / deskripsi singkat',
    example: 'Promo Tahun Baru 100RB',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Tipe voucher',
    enum: VoucherType,
    example: VoucherType.GLOBAL_PROMO,
  })
  @IsEnum(VoucherType)
  type: VoucherType;

  @ApiProperty({
    description: 'Tipe diskon',
    enum: DiscountType,
    example: DiscountType.FIXED_AMOUNT,
  })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({
    description: 'Nilai diskon (nominal atau persentase)',
    example: 25000,
  })
  @IsNumber()
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({
    description:
      'Minimal total belanja agar voucher bisa digunakan (default: 0)',
    example: 100000,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPurchase?: number;

  @ApiPropertyOptional({
    description:
      'Batas maksimal potongan (khusus diskon persentase). Wajib diisi jika discountType = PERCENTAGE',
    example: 50000,
  })
  @ValidateIf((o: CreateVoucherDto) => o.discountType === DiscountType.PERCENTAGE)
  @IsNumber()
  @Min(0)
  maxDiscount?: number;

  @ApiProperty({
    description:
      'Kuota maksimal pemakaian voucher (0 = unlimited)',
    example: 100,
    default: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxUsage?: number;

  @ApiProperty({
    description: 'Tanggal mulai berlaku voucher (ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'Tanggal kadaluarsa voucher (ISO 8601)',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsDateString()
  @Validate(IsAfterStartDate)
  endDate: string;
}