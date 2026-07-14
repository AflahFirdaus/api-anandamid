import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, Matches, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { UserGender } from '../entities/user.entity';

export class RegisterDto {
  @ApiProperty({ description: 'Nama lengkap', example: 'Aflah Firdaus' })
  @IsNotEmpty({ message: 'Nama lengkap wajib diisi' })
  @IsString()
  @MinLength(3, { message: 'Nama minimal 3 karakter' })
  @MaxLength(50, { message: 'Nama maksimal 50 karakter' })
  full_name: string;

  @ApiProperty({ description: 'Alamat Email', example: 'aflah@example.com' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  @IsEmail({}, { message: 'Format email tidak valid' })
  email: string;

  @ApiProperty({ description: 'Password akun', example: 'SecurePass123!' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @MinLength(8, { message: 'Password minimal harus 8 karakter' })
  password: string;

  @ApiProperty({ description: 'Nomor WhatsApp', example: '081234567890' })
  @IsNotEmpty({ message: 'Nomor WhatsApp wajib diisi' })
  @Matches(/^(?:\+62|62|0)8[1-9][0-9]{7,11}$/, {
    message: 'Format nomor WhatsApp tidak valid. Gunakan format seperti 08123456789 atau 628123456789',
  })
  phone_number: string;

  @ApiPropertyOptional({ description: 'Tanggal Lahir (YYYY-MM-DD)', example: '2000-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'Format tanggal lahir harus YYYY-MM-DD' })
  birth_date?: string;

  @ApiPropertyOptional({ description: 'Jenis Kelamin', enum: UserGender, example: UserGender.MALE })
  @IsOptional()
  @IsEnum(UserGender, { message: 'Gender harus MALE, FEMALE, atau OTHER' })
  gender?: UserGender;
}
