import { 
  IsArray, IsNotEmpty, IsString, IsOptional, 
  IsNumber, Min, ValidateNested, IsBoolean, Matches, IsEmail 
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ================= CHECKOUT CART =================
export class CheckoutCartDto {
  @ApiProperty({
    description: 'Array of cart item IDs to checkout',
    type: [String],
    example: ['cart-uuid-1', 'cart-uuid-2'],
  })
  @IsArray()
  @IsNotEmpty()
  @IsString({ each: true })
  cart_ids: string[];

  @ApiPropertyOptional({
    description: 'Optional notes from buyer',
    example: 'Tolong dibungkus kado ya',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ================= CHECKOUT DIRECT =================
export class CheckoutDirectDto {
  @ApiProperty({
    description: 'Product ID for direct purchase',
    example: 'product-uuid-123',
  })
  @IsNotEmpty()
  @IsString()
  product_id: string;

  @ApiProperty({
    description: 'Quantity to purchase',
    example: 2,
    minimum: 1,
  })
  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Selected product variant name (e.g., "Hitam 128GB")',
    example: 'Hitam 128GB',
  })
  @IsOptional()
  @IsString()
  variasi?: string;

  @ApiPropertyOptional({
    description: 'Optional notes from buyer',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ================= BUILDER ITEM =================
class BuilderItemDto {
  @ApiProperty({
    description: 'Product ID for PC builder component',
    example: 'product-uuid-456',
  })
  @IsNotEmpty()
  @IsString()
  product_id: string;

  @ApiProperty({
    description: 'Quantity',
    example: 1,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity: number;
}

// ================= CHECKOUT BUILDER =================
export class CheckoutBuilderDto {
  @ApiProperty({
    description: 'Array of PC builder components',
    type: [BuilderItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderItemDto)
  items: BuilderItemDto[];

  @ApiPropertyOptional({
    description: 'Optional notes',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}

// ================= TAX INVOICE REQUEST DTO (declare before CreateCheckoutDto) =================
export class TaxInvoiceRequestDto {
  @ApiProperty({ description: 'Nama Perusahaan', example: 'PT. Contoh Makmur' })
  @IsNotEmpty()
  @IsString()
  company_name: string;

  @ApiProperty({ description: 'Nomor NPWP (15 atau 16 digit)', example: '0123456789123456' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{15,16}$/, { message: 'Format NPWP tidak valid. Harus 15 atau 16 digit angka.' })
  npwp_number: string;

  @ApiProperty({ description: 'Email Perusahaan', example: 'perusahaan@email.com' })
  @IsNotEmpty()
  @IsEmail()
  company_email: string;

  @ApiProperty({ description: 'Alamat Perusahaan', example: 'Jl. Bisnis No.456' })
  @IsNotEmpty()
  @IsString()
  company_address: string;

  @ApiProperty({ description: 'URL foto/dokumen NPWP', example: '/uploads/tax-invoices/npwp/npwp-xxx.jpg' })
  @IsNotEmpty()
  @IsString()
  npwp_document_url: string;
}

// ================= CHECKOUT WITH PAYMENT =================
export class CreateCheckoutDto {
  @ApiPropertyOptional({
    description: 'Cart item IDs to process (cart-based checkout)',
    type: [String],
    example: ['cart-uuid-1', 'cart-uuid-2'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cart_ids?: string[];

  @ApiPropertyOptional({
    description: 'Direct purchase item details (single product checkout)',
    type: CheckoutDirectDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutDirectDto)
  direct_item?: CheckoutDirectDto;

  @ApiPropertyOptional({
    description: 'PC builder component items (multi-item checkout)',
    type: [BuilderItemDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BuilderItemDto)
  builder_items?: BuilderItemDto[];

  @ApiPropertyOptional({
    description: 'Shipping cost in IDR (added to total)',
    example: 15000,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipping_cost?: number;

  @ApiPropertyOptional({
    description: 'User address ID for shipping (fetched from UserAddress)',
    example: 'address-uuid-789',
  })
  @IsOptional()
  @IsString()
  address_id?: string;

  @ApiPropertyOptional({
    description: 'Shipping type: "regular", "instant", "store_pickup", or "store_delivery"',
    example: 'regular',
    default: 'regular',
  })
  @IsOptional()
  @IsString()
  shipping_type?: string;

  @ApiPropertyOptional({
    description: 'For store_pickup: estimated preparation time in minutes',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pickup_estimate_minutes?: number;

  @ApiPropertyOptional({
    description: 'For store_delivery: distance in KM from store to customer (max 25)',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  delivery_distance_km?: number;

  @ApiPropertyOptional({
    description: 'Selected courier name (e.g., JNE, GoSend)',
    example: 'jne',
  })
  @IsOptional()
  @IsString()
  courier_name?: string;

  @ApiPropertyOptional({
    description: 'Selected courier service (e.g., REG, YES)',
    example: 'REG',
  })
  @IsOptional()
  @IsString()
  courier_service?: string;

  @ApiPropertyOptional({
    description: 'Shipping details (rate, duration, etc.)',
    example: { rate: 15000, duration: '2-3 hari' },
  })
  @IsOptional()
  shipping_details?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Voucher usage IDs from apply-voucher endpoint (max 2 vouchers)',
    example: ['usage-uuid-abc', 'usage-uuid-def'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  voucher_usage_ids?: string[];

  @ApiPropertyOptional({
    description: 'Request faktur pajak?',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  is_tax_invoice_requested?: boolean;

  @ApiPropertyOptional({
    description: 'Data faktur pajak (wajib jika is_tax_invoice_requested = true)',
    type: TaxInvoiceRequestDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TaxInvoiceRequestDto)
  tax_invoice_request?: TaxInvoiceRequestDto;

  @ApiPropertyOptional({
    description: 'Optional notes',
    example: 'Tolong kirim cepat ya',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}