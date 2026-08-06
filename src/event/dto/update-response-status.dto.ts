import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ResponseStatus } from '../entities/event-response.entity';

export class UpdateResponseStatusDto {
  @ApiProperty({
    description: 'Status baru pendaftar. Hanya Approved atau Rejected.',
    enum: [ResponseStatus.APPROVED, ResponseStatus.REJECTED],
    example: ResponseStatus.APPROVED,
  })
  @IsIn([ResponseStatus.APPROVED, ResponseStatus.REJECTED], {
    message: 'Status hanya bisa diubah menjadi Approved atau Rejected',
  })
  status: ResponseStatus;
}
