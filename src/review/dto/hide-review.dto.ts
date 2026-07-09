import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class HideReviewDto {
  @ApiProperty({ description: 'Alasan menyembunyikan review' })
  @IsString()
  @IsNotEmpty()
  hide_reason: string;
}
