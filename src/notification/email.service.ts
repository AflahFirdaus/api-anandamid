import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendEmailOptions {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  id: string;
  from: string;
  to: string;
  subject: string;
  created_at: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;
  private readonly defaultFrom: string;

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST') ?? 'mail.anandam.id';
    const port = this.configService.get<number>('SMTP_PORT') ?? 465;
    const user = this.configService.get<string>('SMTP_USER') ?? 'noreply@anandam.id';
    const pass = this.configService.get<string>('SMTP_PASS') ?? '';
    this.defaultFrom =
      this.configService.get<string>('SMTP_FROM_EMAIL') ?? 'noreply@anandam.id';

    const secure = port === 465;

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
      // Timeout 30 detik untuk koneksi (server mail kadang lambat)
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 45000,
    });

    this.logger.log(
      `[EMAIL] SMTP configured → host=${host} port=${port} secure=${secure} user=${user} from=${this.defaultFrom}`,
    );
  }

  /**
   * Kirim email via SMTP sendiri (nodemailer).
   * Format response disamakan dengan Resend API untuk kompatibilitas.
   */
  async send(options: SendEmailOptions): Promise<{ data: SendEmailResult | null; error: string | null }> {
    const { to, subject, html, text, from } = options;

    try {
      const info = await this.transporter.sendMail({
        from: `Anandam <${from ?? this.defaultFrom}>`,
        to,
        subject,
        html,
        text,
      });

      const result: SendEmailResult = {
        id: info.messageId,
        from: from ?? this.defaultFrom,
        to,
        subject,
        created_at: new Date().toISOString(),
      };

      this.logger.log(
        `[EMAIL] Terkirim ke ${to} | subject="${subject}" | messageId=${info.messageId}`,
      );

      return { data: result, error: null };
    } catch (err: any) {
      const errorMsg = err.message ?? JSON.stringify(err);
      this.logger.error(
        `[EMAIL] Gagal kirim ke ${to} | subject="${subject}" | error=${errorMsg}`,
      );
      return { data: null, error: errorMsg };
    }
  }

  /**
   * Verifikasi koneksi SMTP (untuk testing/health check).
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('[EMAIL] SMTP connection verified successfully');
      return true;
    } catch (err: any) {
      this.logger.error(`[EMAIL] SMTP connection failed: ${err.message}`);
      return false;
    }
  }
}