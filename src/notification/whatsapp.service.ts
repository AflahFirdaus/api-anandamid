import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly templateName: string;
  private readonly languageCode: string;
  private readonly apiVersion: string;

  constructor(private readonly configService: ConfigService) {
    this.accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN') ?? '';
    this.phoneNumberId = this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') ?? '';
    this.templateName = this.configService.get<string>('WHATSAPP_TEMPLATE_NAME') ?? 'otp_verification';
    this.languageCode = this.configService.get<string>('WHATSAPP_LANGUAGE_CODE') ?? 'id';
    this.apiVersion = this.configService.get<string>('WHATSAPP_API_VERSION') ?? 'v20.0';

    if (!this.accessToken || !this.phoneNumberId) {
      this.logger.warn(
        'WhatsApp Credentials are missing! Please check WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env',
      );
    }
  }

  /**
   * Format nomor HP agar sesuai standar internasional Meta (e.g. 628xxx)
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
   * Mengirim kode OTP via WhatsApp menggunakan Meta Cloud API
   */
  async sendOtp(phone: string, otpCode: string): Promise<boolean> {
    const formattedPhone = this.formatPhoneNumber(phone);
    if (!formattedPhone) {
      this.logger.error('Format nomor WhatsApp tidak valid!');
      return false;
    }

    if (!this.accessToken || !this.phoneNumberId) {
      this.logger.error('Gagal mengirim WhatsApp OTP: Kredensial Meta Developer belum dikonfigurasi.');
      return false;
    }

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    
    // Payload Meta Cloud API untuk template message OTP
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'template',
      template: {
        name: this.templateName,
        language: {
          code: this.languageCode,
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: otpCode,
              },
            ],
          },
        ],
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        this.logger.error(
          `Gagal mengirim WhatsApp OTP ke ${formattedPhone}. HTTP Status: ${response.status}. Error: ${JSON.stringify(data)}`,
        );
        return false;
      }

      this.logger.log(`WhatsApp OTP berhasil dikirim ke ${formattedPhone}. Message ID: ${data.messages?.[0]?.id}`);
      return true;
    } catch (error) {
      this.logger.error(`Error saat mengirim WhatsApp OTP ke ${formattedPhone}:`, error);
      return false;
    }
  }
}
