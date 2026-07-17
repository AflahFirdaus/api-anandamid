import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiKey: string;
  private readonly senderName: string;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FONTE_API_KEY') ?? '';
    this.senderName = this.configService.get<string>('FONTE_SENDER_NAME') ?? 'Anandam Computer';
    this.apiUrl = this.configService.get<string>('FONTE_API_URL') ?? 'https://api.fonnte.com/send';

    if (!this.apiKey) {
      this.logger.warn(
        'FONTE API Key is missing! Please check FONTE_API_KEY in .env',
      );
    }
  }

  /**
   * Format nomor HP agar sesuai standar internasional (e.g. 628xxx)
   * Tanpa +, tanpa spasi, tanpa strip.
   */
  formatPhoneNumber(phone: string): string {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    return cleaned;
  }

  /**
   * Mengirim kode OTP via WhatsApp menggunakan FONTE API
   */
  async sendOtp(phone: string, otpCode: string): Promise<boolean> {
    const formattedPhone = this.formatPhoneNumber(phone);
    if (!formattedPhone) {
      this.logger.error('Format nomor WhatsApp tidak valid!');
      return false;
    }

    if (!this.apiKey) {
      this.logger.error('Gagal mengirim WhatsApp OTP: API Key FONTE belum dikonfigurasi.');
      return false;
    }

    // Pesan OTP profesional dengan branding Anandam Computer
    const message = `*ANANDAM COMPUTER*
══════════════════

Halo 👋,

Kode verifikasi (OTP) Anda adalah:

*${otpCode}*

Kode ini berlaku selama *5 menit*.
Jangan bagikan kode ini kepada siapa pun, termasuk pihak yang mengaku dari Anandam.

Jika Anda tidak merasa melakukan permintaan ini, abaikan pesan ini.

Terima kasih telah mempercayai Anandam Computer! 🚀

══════════════════
*Anandam Computer*
Toko Komputer & Laptop Terpercaya`;

    const payload = {
      target: formattedPhone,
      message: message,
      countryCode: '62',
      name: this.senderName, // Nama kontak yang muncul di WhatsApp
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(
          `Gagal mengirim WhatsApp OTP ke ${formattedPhone} via FONTE. HTTP Status: ${response.status}. Response: ${JSON.stringify(data)}`,
        );
        return false;
      }

      // FONTE sukses mengembalikan status: true
      if (data.status === true) {
        this.logger.log(`WhatsApp OTP berhasil dikirim ke ${formattedPhone} via FONTE. ID: ${data.id}`);
        return true;
      } else {
        this.logger.error(
          `Gagal mengirim WhatsApp OTP ke ${formattedPhone} via FONTE. Response: ${JSON.stringify(data)}`,
        );
        return false;
      }
    } catch (error) {
      this.logger.error(`Error saat mengirim WhatsApp OTP via FONTE ke ${formattedPhone}:`, error);
      return false;
    }
  }
}