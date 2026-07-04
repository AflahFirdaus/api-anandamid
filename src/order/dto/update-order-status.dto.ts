import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum OrderStatus {
  PENDING = 'PENDING',
  LUNAS = 'LUNAS',
  DIKEMAS = 'DIKEMAS',
  DIKIRIM = 'DIKIRIM',
  SELESAI = 'SELESAI',
  BATAL = 'BATAL',
}

export class UpdateOrderStatusDto {
  @IsNotEmpty()
  @IsEnum(OrderStatus, { message: 'Status pesanan tidak valid' })
  status: OrderStatus;

  @IsOptional()
  @IsString()
  tracking_number?: string;

  @IsOptional()
  @IsString()
  courier_name?: string;

  @IsOptional()
  @IsString()
  courier_service?: string;

  @IsOptional()
  @IsString()
  awb_number?: string;

  @IsOptional()
  @IsString()
  awb_url?: string;
}