import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTransactionDto {
  @ApiProperty({
    description: 'Unique order ID from your system (e.g., invoice number)',
    example: 'INV-20260207-1234',
  })
  orderId: string;

  @ApiProperty({
    description: 'Total gross amount in IDR',
    example: 250000,
  })
  grossAmount: number;

  @ApiPropertyOptional({
    description: 'Customer details for Midtrans (name, email, phone, shipping_address)',
    example: {
      first_name: 'Budi',
      email: 'budi@example.com',
      phone: '081234567890',
    },
  })
  customerDetails?: any;
}