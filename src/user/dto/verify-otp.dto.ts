import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ description: 'Nomor WhatsApp', example: '081234567890' })
  @IsNotEmpty({ message: 'Nomor WhatsApp wajib diisi' })
  @Matches(/^(?:\+62|62|0)8[1-9][0-9]{7,11}$/, {
    message: 'Format nomor WhatsApp tidak valid.',
  })
  phone_number: string;

  @ApiProperty({ description: 'Kode OTP 6-digit', example: '123456' })
  @IsNotEmpty({ message: 'Kode OTP wajib diisi' })
  @IsString()
  @Length(6, 6, { message: 'Kode OTP harus berupa 6 digit angka' })
  otp: string;
}
