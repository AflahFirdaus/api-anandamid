import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FONTE_API_KEY') ?? '';
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
    // Bersihkan non-digit, lalu pastikan dalam format lokal Indonesia (08xx...).
    // Berdasarkan pengujian akun ini, format "08..." lebih andal terkirim
    // daripada "628...". Payload tetap menyertakan countryCode '62'
    // sehingga format lokal tetap diproses benar oleh FONTE.
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('62')) {
      cleaned = '0' + cleaned.slice(2);
    }
    return cleaned;
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    const formattedPhone = this.formatPhoneNumber(phone);
    if (!formattedPhone) {
      this.logger.error('Format nomor WhatsApp tidak valid!');
      return false;
    }
    if (!this.apiKey) {
      this.logger.error(
        'Gagal mengirim WhatsApp: API Key FONTE belum dikonfigurasi.',
      );
      return false;
    }
    const payload = {
      target: formattedPhone,
      message,
      countryCode: '62',
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
          'Gagal kirim WA ' +
            formattedPhone +
            ' via FONTE. HTTP ' +
            response.status +
            '. ' +
            JSON.stringify(data),
        );
        return false;
      }
      if (data.status === true) {
        const messageId = Array.isArray(data.id) ? data.id[0] : data.id;
        const process: string = data.process ?? 'unknown';
        if (process === 'pending') {
          // 'pending' = device Fonnte belum mengantarkan pesan ke WA.
          // Bisa jadi device disconnect, rate-limited, atau nomor tidak valid.
          this.logger.warn(
            'WA ke ' +
              formattedPhone +
              ' via FONTE masuk antrian tapi PENDING (belum terkirim). ID: ' +
              messageId +
              '. Cek status device di dashboard Fonnte.',
          );
        } else {
          this.logger.log(
            'WA berhasil ke ' +
              formattedPhone +
              ' via FONTE. Process: ' +
              process +
              '. ID: ' +
              messageId,
          );
        }
        return true;
      } else {
        this.logger.error(
          'Gagal kirim WA ' +
            formattedPhone +
            ' via FONTE. ' +
            JSON.stringify(data),
        );
        return false;
      }
    } catch (error) {
      this.logger.error(
        'Error kirim WA via FONTE ke ' + formattedPhone,
        error,
      );
      return false;
    }
  }

  async sendOtp(phone: string, otpCode: string): Promise<boolean> {
    const otpMsg =
      '*ANANDAM.ID*\nKode verifikasi (OTP) Anda adalah:\n\n*' +
      otpCode +
      '*\n\nKode ini berlaku selama 5 menit.\nJangan bagikan kode ini kepada siapa pun.\n\nTerima kasih telah mempercayai Anandam.ID!\n\n*Anandam.ID*';
    return this.sendMessage(phone, otpMsg);
  }
}
