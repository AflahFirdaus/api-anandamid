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
  private readonly defaultFrom: string;

  // Konfigurasi SMTP disimpan agar bisa dibuat transporter baru setiap kirim
  private readonly smtpConfig: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST') ?? 'mail.anandam.id';
    const port = this.configService.get<number>('SMTP_PORT') ?? 587;
    const user = this.configService.get<string>('SMTP_USER') ?? 'noreply@anandam.id';
    const pass = this.configService.get<string>('SMTP_PASS') ?? '';
    this.defaultFrom =
      this.configService.get<string>('SMTP_FROM_EMAIL') ?? 'noreply@anandam.id';

    // Port 465 → SMTPS (TLS dari awal, handshake lambat dari VPS)
    // Port 587 → STARTTLS (greeting dulu, TLS belakangan, jauh lebih cepat)
    const secure = port === 465;

    this.smtpConfig = { host, port, secure, user, pass };

    this.logger.log(
      `[EMAIL] SMTP configured → host=${host} port=${port} secure=${secure} user=${user} from=${this.defaultFrom}`,
    );
  }

  /**
   * Buat transporter baru setiap kali kirim email.
   * Menghindari masalah stale connection yang menyebabkan "Greeting never received".
   */
  private createTransporter(): nodemailer.Transporter {
    const { host, port, secure, user, pass } = this.smtpConfig;
    return nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        // Izinkan self-signed / cert tidak sempurna di server hosting
        rejectUnauthorized: false,
      },
      // Port 587 (STARTTLS): greeting datang SEBELUM TLS → timeout ini cukup
      // Port 465 (SMTPS): TLS dulu baru greeting → timeout lebih longgar
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    });
  }

  /**
   * Kirim email via SMTP sendiri (nodemailer).
   * Format response disamakan dengan Resend API untuk kompatibilitas.
   */
  async send(options: SendEmailOptions): Promise<{ data: SendEmailResult | null; error: string | null }> {
    const { to, subject, html, text, from } = options;

    // Buat koneksi SMTP baru setiap kirim → tidak ada masalah stale connection
    const transporter = this.createTransporter();

    try {
      const info = await transporter.sendMail({
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
    } finally {
      // Tutup koneksi setelah selesai untuk membebaskan resource
      transporter.close();
    }
  }

  /**
   * Kirim kode OTP (6 digit) ke email user.
   * Mengembalikan boolean sukses — interface-nya disamakan dengan
   * WhatsappService.sendOtp() agar mudah mengganti saluran pengiriman.
   */
  async sendOtp(to: string, otpCode: string): Promise<boolean> {
    const subject = 'Kode Verifikasi (OTP) Anandam.ID';

    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f6f8fa;">
        <div style="background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #eee;">
          <div style="background: #2563eb; padding: 22px 28px; text-align: center;">
            <div style="color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: 0.5px;">ANANDAM.ID</div>
          </div>
          <div style="padding: 30px 28px;">
            <h2 style="margin: 0 0 16px; color: #111827; font-size: 18px;">Kode Verifikasi Anda</h2>
            <p style="margin: 0 0 20px; color: #4b5563; font-size: 15px; line-height: 1.6;">
              Gunakan kode berikut untuk verifikasi akun Anandam.ID Anda:
            </p>
            <div style="background: #f3f4f6; border-radius: 10px; padding: 18px; text-align: center; letter-spacing: 12px; font-size: 34px; font-weight: 800; color: #111827;">
              ${otpCode}
            </div>
            <p style="margin: 22px 0 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
              Kode ini berlaku selama <b>5 menit</b> dan hanya untuk satu kali pakai. Jangan bagikan kode ini kepada siapa pun.
            </p>
          </div>
          <div style="border-top: 1px solid #eee; padding: 16px 28px; text-align: center; color: #9ca3af; font-size: 12px;">
            Jika Anda tidak merasa melakukan permintaan ini, silakan abaikan email ini.
          </div>
        </div>
      </div>
    `;

    const { error } = await this.send({ to, subject, html });
    if (error) {
      this.logger.error(`[EMAIL] Gagal kirim OTP ke ${to} | error=${error}`);
      return false;
    }
    return true;
  }

  /**
   * Verifikasi koneksi SMTP (untuk testing/health check).
   */
  async verifyConnection(): Promise<boolean> {
    const transporter = this.createTransporter();
    try {
      await transporter.verify();
      this.logger.log('[EMAIL] SMTP connection verified successfully');
      return true;
    } catch (err: any) {
      this.logger.error(`[EMAIL] SMTP connection failed: ${err.message}`);
      return false;
    } finally {
      transporter.close();
    }
  }
}