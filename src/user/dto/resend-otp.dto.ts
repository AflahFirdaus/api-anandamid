import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({ description: 'Nomor WhatsApp', example: '081234567890' })
  @IsNotEmpty({ message: 'Nomor WhatsApp wajib diisi' })
  @Matches(/^(?:\+62|62|0)8[1-9][0-9]{7,11}$/, {
    message: 'Format nomor WhatsApp tidak valid.',
  })
  phone_number: string;
}
