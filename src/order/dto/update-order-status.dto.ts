import { IsEnum, IsNotEmpty } from 'class-validator';

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
}