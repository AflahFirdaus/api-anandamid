import { IsString, IsNotEmpty } from 'class-validator';

export class UpdatePhoneDto {
  @IsString()
  @IsNotEmpty()
  current_phone: string;

  @IsString()
  @IsNotEmpty()
  new_phone: string;
}