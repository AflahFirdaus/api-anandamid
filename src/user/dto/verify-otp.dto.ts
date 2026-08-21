import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    description: 'Email terdaftar tempat OTP dikirim',
    example: 'aflah@example.com',
  })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  @IsEmail({}, { message: 'Format email tidak valid' })
  email: string;

  @ApiProperty({ description: 'Kode OTP 6-digit', example: '123456' })
  @IsNotEmpty({ message: 'Kode OTP wajib diisi' })
  @IsString()
  @Length(6, 6, { message: 'Kode OTP harus berupa 6 digit angka' })
  otp: string;
}
