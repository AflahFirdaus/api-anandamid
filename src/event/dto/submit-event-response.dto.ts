import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitEventResponseDto {
  @ApiProperty({
    description: 'Nama lengkap pendaftar',
    example: 'Budi Santoso',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description: 'Nomor HP (WhatsApp) pendaftar',
    example: '081234567890',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/^\+?[0-9\s\-()]{8,20}$/, {
    message: 'Nomor HP tidak valid',
  })
  phone: string;

  @ApiProperty({
    description: 'Email pendaftar',
    example: 'budi@example.com',
  })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    description: 'Akun Instagram pendaftar',
    example: '@budisantoso',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  ig_account: string;

  @ApiProperty({
    description: 'Alamat lengkap pendaftar',
    example: 'Jl. Merdeka No. 1, Surabaya',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({
    description:
      'Jawaban untuk pertanyaan tambahan opsional (additional_notes_label)',
    example: 'Tidak ada',
  })
  @IsOptional()
  @IsString()
  additional_notes_answer?: string;
}
