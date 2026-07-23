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
    this.senderName =
      this.configService.get<string>('FONTE_SENDER_NAME') ?? 'Anandam Computer';
    this.apiUrl =
      this.configService.get<string>('FONTE_API_URL') ??
      'https://api.fonnte.com/send';
    if (!this.apiKey) {
      this.logger.warn(
        'FONTE API Key is missing! Please check FONTE_API_KEY in .env',
      );
    }
  }

  formatPhoneNumber(phone: string): string {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.substring(1);
    }
    return cleaned;
  }

  async sendOtp(phone: string, otpCode: string): Promise<boolean> {
    const formattedPhone = this.formatPhoneNumber(phone);
    if (!formattedPhone) {
      this.logger.error('Format nomor WhatsApp tidak valid!');
      return false;
    }
    if (!this.apiKey) {
      this.logger.error(
        'Gagal mengirim WhatsApp OTP: API Key FONTE belum dikonfigurasi.',
      );
      return false;
    }
    const otpMsg =
      '*ANANDAM.ID*\nKode verifikasi (OTP) Anda adalah:\n\n*' +
      otpCode +
      '*\n\nKode ini berlaku selama 5 menit.\nJangan bagikan kode ini kepada siapa pun.\n\nTerima kasih telah mempercayai Anandam.ID!\n\n*Anandam.ID*';
    const payload = {
      target: formattedPhone,
      message: otpMsg,
      countryCode: '62',
      name: this.senderName,
    };
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        this.logger.error(
          'Gagal kirim WA OTP ' +
            formattedPhone +
            ' via FONTE. HTTP ' +
            response.status +
            '. ' +
            JSON.stringify(data),
        );
        return false;
      }
      if (data.status === true) {
        this.logger.log(
          'WA OTP berhasil ke ' + formattedPhone + ' via FONTE. ID: ' + data.id,
        );
        return true;
      } else {
        this.logger.error(
          'Gagal kirim WA OTP ' +
            formattedPhone +
            ' via FONTE. ' +
            JSON.stringify(data),
        );
        return false;
      }
    } catch (error) {
      this.logger.error(
        'Error kirim WA OTP via FONTE ke ' + formattedPhone,
        error,
      );
      return false;
    }
  }
}
