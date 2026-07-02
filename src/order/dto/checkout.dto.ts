import { 
  IsArray, IsNotEmpty, IsString, IsOptional, 
  IsNumber, Min, ValidateNested 
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
    description: 'Optional notes',
    example: 'Tolong kirim cepat ya',
  })
  @IsOptional()
  @IsString()
  notes?: string;
}