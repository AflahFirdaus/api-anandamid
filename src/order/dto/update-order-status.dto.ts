import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export enum OrderStatus {
  PENDING = 'PENDING',
  LUNAS = 'LUNAS', // PAID
  CANCEL_REQUESTED = 'CANCEL_REQUESTED',
  REFUNDING = 'REFUNDING',
  REFUND_FAILED = 'REFUND_FAILED',
  DIKEMAS = 'DIKEMAS', // PACKING
  DIKIRIM = 'DIKIRIM', // SHIPPED
  SELESAI = 'SELESAI', // COMPLETED
  BATAL = 'BATAL', // CANCELLED
}

export enum CancelReason {
  CHANGE_MIND = 'CHANGE_MIND',
  WRONG_PRODUCT = 'WRONG_PRODUCT',
  WRONG_ADDRESS = 'WRONG_ADDRESS',
  PRICE = 'PRICE',
  OTHER = 'OTHER',
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

export class RequestCancelDto {
  @IsNotEmpty()
  @IsEnum(CancelReason, { message: 'Alasan pembatalan tidak valid' })
  cancel_reason: CancelReason;

  @IsOptional()
  @IsString()
  cancel_reason_detail?: string;
}