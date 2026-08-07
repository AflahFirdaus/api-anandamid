import { IsIn, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ResponseStatus,
  RejectionReason,
} from '../entities/event-response.entity';

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

  @ApiProperty({
    description:
      'Alasan penolakan (wajib saat status Rejected). Tiga pilihan standar.',
    enum: RejectionReason,
    required: false,
    example: RejectionReason.INVALID_DATA,
  })
  @IsOptional()
  @IsIn(Object.values(RejectionReason), {
    message: 'Alasan penolakan tidak valid',
  })
  rejection_reason?: RejectionReason;
}
