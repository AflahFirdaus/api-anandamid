import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface QueuedMessage {
  phone: string;
  message: string;
  resolve: (result: boolean) => void;
}

interface SendResult {
  delivered: boolean;
  retryable: boolean;
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiKey: string;
  private readonly apiUrl: string;

  /** Jeda minimum antar pengiriman (ms) untuk menghindari burst yang memicu restrict */
  private readonly sendDelayMs: number;
  /** Berapa kali coba ulang saat status pending */
  private readonly maxRetries: number;
  /** Jeda sebelum retry (ms) */
  private readonly retryDelayMs: number;

  /** Antrean pesan in-process: dikirim satu per satu agar tidak menumpuk */
  private queue: QueuedMessage[] = [];
  private processing = false;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('FONTE_API_KEY') ?? '';
    this.apiUrl =
      this.configService.get<string>('FONTE_API_URL') ??
      'https://api.fonnte.com/send';
    this.sendDelayMs = Number(
      this.configService.get<string>('FONTE_SEND_DELAY_MS') ?? '3000',
    );
    this.maxRetries = Number(
      this.configService.get<string>('FONTE_MAX_RETRIES') ?? '2',
    );
    this.retryDelayMs = Number(
      this.configService.get<string>('FONTE_RETRY_DELAY_MS') ?? '60000',
    );
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
    // Masukkan ke antrean agar pesan dikirim satu per satu dengan jeda,
    // sehingga tidak memicu rate-limit / restrict dari WhatsApp.
    return new Promise<boolean>((resolve) => {
      this.queue.push({ phone: formattedPhone, message, resolve });
      void this.drainQueue();
    });
  }

  /** Proses antrean: kirim satu per satu dengan jeda antar pesan. */
  private async drainQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) break;
        // Beri jeda sebelum setiap pengiriman (kecuali pesan pertama)
        if (this.sendDelayMs > 0) {
          await this.delay(this.sendDelayMs);
        }
        const sent = await this.sendWithRetry(item.phone, item.message);
        item.resolve(sent);
      }
    } finally {
      this.processing = false;
    }
  }

  /** Coba kirim, dan retry otomatis jika Fonnte membalas 'pending'. */
  private async sendWithRetry(
    phone: string,
    message: string,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      const result = await this.sendSingle(phone, message, attempt);
      if (result.delivered) return true;
      if (result.retryable && attempt <= this.maxRetries) {
        this.logger.warn(
          `WA ke ${phone} masih PENDING (percobaan ${attempt}). Akan dicoba lagi dalam ${Math.round(
            this.retryDelayMs / 1000,
          )}s.`,
        );
        await this.delay(this.retryDelayMs);
        continue;
      }
      return false;
    }
    return false;
  }

  /** Satu kali panggilan ke API Fonnte. */
  private async sendSingle(
    phone: string,
    message: string,
    attempt: number,
  ): Promise<SendResult> {
    const payload = {
      target: phone,
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
          `Gagal kirim WA ${phone} via FONTE. HTTP ${response.status}. ${JSON.stringify(
            data,
          )}`,
        );
        return { delivered: false, retryable: false };
      }
      if (data.status === true) {
        const messageId = Array.isArray(data.id) ? data.id[0] : data.id;
        const process: string = data.process ?? 'unknown';
        if (process === 'pending') {
          // 'pending' = device Fonnte belum mengantarkan pesan ke WA.
          // Bisa jadi device disconnect, rate-limited, atau nomor tidak valid.
          this.logger.warn(
            `WA ke ${phone} via FONTE masuk antrian tapi PENDING (percobaan ${attempt}). ID: ${messageId}.`,
          );
          return { delivered: false, retryable: true };
        }
        this.logger.log(
          `WA berhasil ke ${phone} via FONTE. Process: ${process}. ID: ${messageId}.`,
        );
        return { delivered: true, retryable: false };
      }
      this.logger.error(
        `Gagal kirim WA ${phone} via FONTE. ${JSON.stringify(data)}`,
      );
      return { delivered: false, retryable: false };
    } catch (error) {
      this.logger.error(`Error kirim WA via FONTE ke ${phone}`, error);
      return { delivered: false, retryable: false };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async sendOtp(phone: string, otpCode: string): Promise<boolean> {
    const otpMsg =
      '*ANANDAM.ID*\nKode verifikasi (OTP) Anda adalah:\n\n*' +
      otpCode +
      '*\n\nKode ini berlaku selama 5 menit.\nJangan bagikan kode ini kepada siapa pun.\n\nTerima kasih telah mempercayai Anandam.ID!\n\n*Anandam.ID*';
    return this.sendMessage(phone, otpMsg);
  }
}
