import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EventStatus } from '../entities/event.entity';

export class UpdateEventStatusDto {
  @ApiProperty({
    description: 'Status baru event (draft untuk draft, published untuk tampil publik)',
    enum: EventStatus,
    example: EventStatus.PUBLISHED,
  })
  @IsEnum(EventStatus)
  status: EventStatus;
}
