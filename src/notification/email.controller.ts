import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { EmailService } from './email.service';
import { IsEmail, IsString, IsOptional, MinLength } from 'class-validator';

export class SendEmailDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsEmail()
  to!: string;

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  html!: string;

  @IsOptional()
  @IsString()
  text?: string;
}

@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  /**
   * POST /email/send
   * Format request/response disamakan dengan Resend API untuk kompatibilitas.
   *
   * Request body:
   * {
   *   "from": "Anandam <noreply@anandam.id>",  // optional
   *   "to": "user@example.com",
   *   "subject": "Notifikasi Pesanan",
   *   "html": "<h1>Hello</h1>",
   *   "text": "Hello"  // optional
   * }
   *
   * Response (sukses):
   * {
   *   "id": "message-id",
   *   "from": "noreply@anandam.id",
   *   "to": "user@example.com",
   *   "subject": "Notifikasi Pesanan",
   *   "created_at": "2026-07-24T..."
   * }
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  async sendEmail(@Body() dto: SendEmailDto) {
    const { data, error } = await this.emailService.send({
      from: dto.from,
      to: dto.to,
      subject: dto.subject,
      html: dto.html,
      text: dto.text,
    });

    if (error) {
      return {
        error: {
          message: error,
          name: 'email_send_failed',
        },
      };
    }

    return data;
  }
}