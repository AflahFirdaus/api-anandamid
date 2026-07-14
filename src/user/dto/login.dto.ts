import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ description: 'Alamat Email', example: 'aflah@example.com' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  @IsEmail({}, { message: 'Format email tidak valid' })
  email: string;

  @ApiProperty({ description: 'Password akun', example: 'SecurePass123!' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @IsString()
  password: string;
}
