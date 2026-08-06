import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsDateString,
  IsInt,
  IsEnum,
  Min,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventStatus } from '../entities/event.entity';

export class CreateEventDto {
  @ApiPropertyOptional({
    description:
      'Slug unik untuk halaman publik. Jika tidak diisi, akan dibuat otomatis dari title.',
    example: 'grand-opening-anniversary-2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiProperty({
    description: 'Judul event',
    example: 'Grand Opening Anniversary 2026',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    description: 'Deskripsi event (boleh HTML / Rich Text)',
    example: '<p>Event tahunan kami...</p>',
  })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({
    description: 'Syarat & ketentuan event (boleh HTML / Rich Text)',
    example: '<ol><li>Follow Instagram...</li></ol>',
  })
  @IsString()
  @IsNotEmpty()
  rules: string;

  @ApiProperty({
    description: 'Waktu mulai pendaftaran (ISO 8601)',
    example: '2026-08-01T00:00:00.000Z',
  })
  @IsDateString()
  registration_start: string;

  @ApiProperty({
    description: 'Waktu berakhir pendaftaran (ISO 8601)',
    example: '2026-08-20T23:59:59.000Z',
  })
  @IsDateString()
  registration_end: string;

  @ApiProperty({
    description: 'Waktu pelaksanaan event (ISO 8601)',
    example: '2026-08-25T09:00:00.000Z',
  })
  @IsDateString()
  event_date: string;

  @ApiProperty({
    description: 'Nama lokasi event',
    example: 'AnandamID Store, Surabaya',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  location_name: string;

  @ApiPropertyOptional({
    description: 'URL lokasi (Google Maps, dll.)',
    example: 'https://maps.app.goo.gl/xxx',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  location_url?: string;

  @ApiPropertyOptional({
    description: 'Kuota maksimal pendaftar (kosongkan jika tanpa batas)',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  max_quota?: number;

  @ApiPropertyOptional({
    description: 'Label untuk pertanyaan tambahan opsional di form pendaftaran',
    example: 'Kode referral',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  additional_notes_label?: string;

  @ApiPropertyOptional({
    description: 'Status event',
    enum: EventStatus,
    example: EventStatus.DRAFT,
    default: EventStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}
