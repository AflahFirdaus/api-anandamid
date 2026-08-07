import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateEventDto } from './create-event.dto';

/** DTO untuk update event — semua field opsional (hanya yang dikirim yang diubah). */
export class UpdateEventDto extends PartialType(CreateEventDto) {
  @ApiPropertyOptional({
    description: 'Slug unik (kosongkan untuk tidak mengubah)',
  })
  slug?: string;
}
