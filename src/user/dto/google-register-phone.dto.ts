import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { UserGender } from '../entities/user.entity';

export class GoogleRegisterPhoneDto {
  @ApiProperty({ description: 'Token Google OAuth', example: 'ya29.a0AfH6SM...' })
  @IsNotEmpty({ message: 'Token Google wajib diisi' })
  @IsString()
  token: string;

  @ApiProperty({ description: 'Nomor WhatsApp', example: '081234567890' })
  @IsNotEmpty({ message: 'Nomor WhatsApp wajib diisi' })
  @Matches(/^(?:\+62|62|0)8[1-9][0-9]{7,11}$/, {
    message: 'Format nomor WhatsApp tidak valid.',
  })
  phone_number: string;

  @ApiPropertyOptional({ description: 'Nama Lengkap (opsional, jika ingin override nama dari Google)', example: 'Aflah Firdaus' })
  @IsOptional()
  @IsString()
  full_name?: string;

  @ApiPropertyOptional({ description: 'Tanggal Lahir (YYYY-MM-DD)', example: '2000-01-01' })
  @IsOptional()
  @IsDateString({}, { message: 'Format tanggal lahir harus YYYY-MM-DD' })
  birth_date?: string;

  @ApiPropertyOptional({ description: 'Jenis Kelamin', enum: UserGender, example: UserGender.MALE })
  @IsOptional()
  @IsEnum(UserGender, { message: 'Gender harus MALE, FEMALE, atau OTHER' })
  gender?: UserGender;
}
