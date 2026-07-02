import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsUUID,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class UpdateVariantItemDto {
  @IsOptional()
  id?: string;

  @IsOptional()
  @IsString()
  variant_name?: string;

  @IsOptional()
  @IsNumber()
  price_normal?: number;

  @IsOptional()
  @IsNumber()
  price_discount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  sku_seller?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  length?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  height?: number;
}

export class UpdateProductDto {

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsString()
  sku_seller?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  price_normal?: number;

  @IsOptional()
  @IsNumber()
  price_discount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  warranty?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  is_popular?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  length?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  socket_type?: string;

  @IsOptional()
  @IsString()
  ram_type?: string;

  @IsOptional()
  brand_id?: string;

  @IsOptional()
  @IsArray()
  images?: any[];

  // 🔥 TAMBAHAN BARU
  @IsOptional()
  @IsBoolean()
  has_variants?: boolean;

  @IsOptional()
  @IsString()
  variant_type_name?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateVariantItemDto)
  variants?: UpdateVariantItemDto[];
}