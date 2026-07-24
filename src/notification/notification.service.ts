import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationGateway } from './notification.gateway';
import { User } from '../user/entities/user.entity';
import { EmailService } from './email.service';

// ── Copy template pesan ala Shopee/Gojek ──────────────────────────────────

interface OrderNotifTemplate {
  title: string;
  body: string;
}

function getOrderNotifTemplate(
  status: string,
  invoice: string,
  courierName?: string,
): OrderNotifTemplate {
  const inv = invoice ? `#${invoice}` : '';
  const courier = courierName ? ` via ${courierName}` : '';

  const templates: Record<string, OrderNotifTemplate> = {
    PENDING: {
      title: '📋 Pesanan Masuk!',
      body: `Pesanan ${inv} udah kami terima nih! Selesaikan pembayaranmu sekarang supaya pesanan segera diproses ya~ 🛍️`,
    },
    LUNAS: {
      title: '💳 Pembayaran Berhasil!',
      body: `Yeay! Pembayaran pesanan ${inv} sudah kami terima. Kami langsung siapkan pesananmu secepat kilat! ⚡`,
    },
    DIKEMAS: {
      title: '📦 Pesananmu Lagi Dikemas!',
      body: `Pesanan ${inv} sedang kami kemas dengan rapi. Mohon tunggu sebentar ya, pesananmu akan segera dikirim!`,
    },
    SIAP: {
      title: '📬 Pesanan Siap!',
      body: `Halo! Pesanan ${inv} sudah siap nih! Yuk segera ambil ke toko kami ya 🏪 Jangan lupa bawa nomor pesanan saat ambil~`,
    },
    DIKIRIM: {
      title: '🚀 Pesananmu Udah Jalan!',
      body: `Yeyyy! Pesanan ${inv} lagi ngebut menuju alamatmu${courier}. Siap-siap di rumah ya~ 🏠`,
    },
    SELESAI: {
      title: '🎉 Pesanan Sampai!',
      body: `Horeee! Pesanan ${inv} sudah tiba di tanganmu. Gimana? Jangan lupa kasih ulasan bintang 5 ya, biar semangat terus! ⭐`,
    },
    BATAL: {
      title: '😔 Pesanan Dibatalkan',
      body: `Pesanan ${inv} telah dibatalkan. Ada yang bisa kami bantu? Yuk belanja lagi, banyak promo menarik! 🎁`,
    },
    CANCELLED: {
      title: '✅ Pembatalan Berhasil',
      body: `Pesanan ${inv} berhasil dibatalkan dan dana sedang dalam proses pengembalian. Tunggu sebentar ya! 💰`,
    },
    CANCEL_REQUESTED: {
      title: '⏳ Pengajuan Pembatalan Diterima',
      body: `Kami sudah terima pengajuan pembatalanmu untuk pesanan ${inv}. Proses sedang berjalan, mohon tunggu ya~ 🙏`,
    },
    REFUNDING: {
      title: '💰 Refund Sedang Diproses',
      body: `Dana pesanan ${inv} sedang kami kembalikan ke kamu. Estimasi 1–3 hari kerja tergantung metode pembayaran. Sabar ya! 🤗`,
    },
    REFUND_FAILED: {
      title: '⚠️ Refund Perlu Diproses Manual',
      body: `Refund pesanan ${inv} memerlukan proses manual oleh tim kami. Tenang, kami akan segera menghubungimu! 📞`,
    },
  };

  return (
    templates[status] ?? {
      title: '🔔 Update Pesanan',
      body: `Status pesanan ${inv} telah diperbarui menjadi ${status}.`,
    }
  );
}

// ── Email HTML template ────────────────────────────────────────────────────

/**
 * Semua status order akan memicu pengiriman email notifikasi.
 * Setiap perubahan status dari dibuat sampai selesai akan dikirim email.
 */
const EMAIL_TRIGGER_STATUSES = new Set([
  'PENDING',
  'LUNAS',
  'DIKEMAS',
  'SIAP',
  'DIKIRIM',
  'SELESAI',
  'BATAL',
  'CANCELLED',
  'CANCEL_REQUESTED',
  'REFUNDING',
  'REFUND_FAILED',
]);

interface EmailTemplateData {
  userName: string;
  invoice: string;
  status: string;
  title: string;
  message: string;
  frontendUrl: string;
}

function buildEmailHtml(data: EmailTemplateData): string {
  const { userName, invoice, status, title, message, frontendUrl } = data;

  const statusColorMap: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: '#FFF7ED', text: '#C2410C', label: 'Menunggu Pembayaran' },
    LUNAS: { bg: '#F0FDF4', text: '#15803D', label: 'Pembayaran Berhasil' },
    DIKEMAS: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Sedang Dikemas' },
    SIAP: { bg: '#F0FDF4', text: '#15803D', label: 'Siap Diambil' },
    DIKIRIM: { bg: '#F0FDF4', text: '#15803D', label: 'Sedang Dikirim' },
    SELESAI: { bg: '#F0FDF4', text: '#15803D', label: 'Pesanan Selesai' },
    BATAL: { bg: '#FEF2F2', text: '#B91C1C', label: 'Dibatalkan' },
    CANCELLED: { bg: '#FEF2F2', text: '#B91C1C', label: 'Dibatalkan' },
    CANCEL_REQUESTED: { bg: '#FFF7ED', text: '#C2410C', label: 'Menunggu Pembatalan' },
    REFUNDING: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Refund Diproses' },
    REFUND_FAILED: { bg: '#FEF2F2', text: '#B91C1C', label: 'Refund Gagal' },
  };

  const badge = statusColorMap[status] ?? {
    bg: '#F9FAFB',
    text: '#374151',
    label: status,
  };

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1A1A2E 0%,#16213E 50%,#0F3460 100%);padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Anandam</p>
              <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.6);letter-spacing:1px;text-transform:uppercase;">Notifikasi Pesanan</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 40px;">

              <!-- Greeting -->
              <p style="margin:0 0 8px;font-size:15px;color:#6B7280;">Halo, <strong style="color:#111827;">${userName}</strong> 👋</p>

              <!-- Title -->
              <h1 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${title}</h1>

              <!-- Status Badge -->
              <div style="display:inline-block;background-color:${badge.bg};color:${badge.text};font-size:12px;font-weight:600;padding:4px 12px;border-radius:100px;letter-spacing:0.5px;margin-bottom:20px;">
                ${badge.label}
              </div>

              <!-- Invoice Box -->
              <div style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;padding:16px 20px;margin-bottom:20px;">
                <p style="margin:0;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">Nomor Pesanan</p>
                <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:#111827;letter-spacing:0.5px;">#${invoice}</p>
              </div>

              <!-- Message -->
              <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">${message}</p>

              <!-- CTA Button -->
              <div style="text-align:center;">
                <a href="${frontendUrl}/orders"
                   style="display:inline-block;background:linear-gradient(135deg,#1A1A2E,#0F3460);color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px;letter-spacing:0.3px;">
                  Lihat Pesanan Saya →
                </a>
              </div>

            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 40px;">
              <hr style="border:none;border-top:1px solid #F3F4F6;margin:0;" />
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">
                Email ini dikirim otomatis, mohon jangan membalas email ini.<br/>
                Butuh bantuan? Hubungi kami di
                <a href="mailto:support@anandam.id" style="color:#0F3460;text-decoration:none;">support@anandam.id</a>
              </p>
              <p style="margin:12px 0 0;font-size:11px;color:#D1D5DB;">
                © ${new Date().getFullYear()} Anandam. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly frontendUrl: string;

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly gateway: NotificationGateway,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {
    this.frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'https://anandam.id';

    this.logger.log(
      `[EMAIL] NotificationService initialized → frontend=${this.frontendUrl}`,
    );
  }

  // ── Internal: create + push ───────────────────────────────────────────────

  private async createAndPush(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<Notification> {
    const notif = this.notifRepo.create({ user_id: userId, type, title, body, data: data ?? null });
    const saved = await this.notifRepo.save(notif);

    // Real-time push via WebSocket (fire-and-forget, non-blocking)
    try {
      this.gateway.pushToUser(userId, {
        id: saved.id,
        type: saved.type,
        title: saved.title,
        body: saved.body,
        data: saved.data,
        is_read: false,
        created_at: saved.created_at,
      });
    } catch (err: any) {
      // Gateway push failure must NOT crash the main flow
      this.logger.warn(`[NOTIF] Push WS failed userId=${userId}: ${err.message}`);
    }

    return saved;
  }

  // ── Email: kirim dengan retry maksimal 2 percobaan ────────────────────────

  /**
   * Mengirim email via SMTP sendiri (EmailService) dengan maksimal 2 percobaan.
   * - Percobaan 1: langsung kirim
   * - Jika gagal, percobaan 2 (terakhir): kirim sekali lagi
   * - Jika keduanya gagal: log warning, berhenti (tidak throw error)
   */
  private async sendEmailWithRetry(
    to: string,
    subject: string,
    html: string,
    invoiceNumber: string,
  ): Promise<void> {
    const MAX_ATTEMPTS = 2;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { error } = await this.emailService.send({
          to,
          subject,
          html,
        });

        if (error) {
          throw new Error(error);
        }

        this.logger.log(
          `[EMAIL] Terkirim ke ${to} | invoice=${invoiceNumber} | attempt=${attempt}/${MAX_ATTEMPTS}`,
        );
        return; // Berhasil, keluar dari loop
      } catch (err: any) {
        if (attempt < MAX_ATTEMPTS) {
          this.logger.warn(
            `[EMAIL] Percobaan ${attempt}/${MAX_ATTEMPTS} gagal ke ${to} | invoice=${invoiceNumber} | error=${err.message} | Mencoba lagi...`,
          );
          // Tidak ada delay, langsung retry (hemat waktu)
        } else {
          // Percobaan ke-2 (terakhir) juga gagal → stop, jangan crash
          this.logger.error(
            `[EMAIL] GAGAL setelah ${MAX_ATTEMPTS} percobaan ke ${to} | invoice=${invoiceNumber} | error=${err.message}`,
          );
        }
      }
    }
  }

  // ── Internal: kirim email notifikasi order ────────────────────────────────

  /**
   * Mengambil email user dari DB lalu mengirim email notifikasi order.
   * Hanya dipanggil untuk status yang ada di EMAIL_TRIGGER_STATUSES.
   * Fire-and-forget — tidak akan crash flow utama.
   */
  private async dispatchOrderEmail(
    userId: string,
    order: { id: string; invoice_number: string; courier_name?: string | null },
    status: string,
  ): Promise<void> {
    try {
      // Ambil email user dari DB
      const user = await this.userRepo.findOne({
        where: { id: userId },
        select: ['id', 'full_name', 'email'],
      });

      if (!user?.email) {
        this.logger.warn(`[EMAIL] User tidak ditemukan atau tidak punya email | userId=${userId}`);
        return;
      }

      this.logger.log(
        `[EMAIL] Memulai pengiriman → to=${user.email} invoice=${order.invoice_number} status=${status}`,
      );

      const { title, body } = getOrderNotifTemplate(
        status,
        order.invoice_number,
        order.courier_name ?? undefined,
      );

      const html = buildEmailHtml({
        userName: user.full_name?.split(' ')[0] ?? 'Pelanggan',
        invoice: order.invoice_number,
        status,
        title,
        message: body,
        frontendUrl: this.frontendUrl,
      });

      await this.sendEmailWithRetry(user.email, title, html, order.invoice_number);
    } catch (err: any) {
      // Jangan pernah crash flow utama karena kegagalan email
      // Error ini HARUS ter-log agar bisa dideteksi di PM2 logs
      this.logger.error(
        `[EMAIL] dispatchOrderEmail FATAL | userId=${userId} invoice=${order.invoice_number} status=${status} | ${err.message}`,
      );
    }
  }

  // ── Welcome Voucher (on new user register) ────────────────────────────────

  /**
   * Dipanggil setelah user baru berhasil register.
   * Jika ada voucher NEW_USER aktif di DB, kode voucher disertakan dalam notif.
   * Jika tidak ada, notif tetap terkirim dengan pesan selamat datang umum.
   */
  async sendWelcomeVoucherNotif(
    userId: string,
    fullName: string,
    voucherCode?: string | null,
  ): Promise<void> {
    const firstName = fullName?.split(' ')[0] ?? 'Kamu';
    const title = `🎉 Selamat Datang, ${firstName}!`;
    const body = voucherCode
      ? `Halo ${firstName}! Sebagai pelanggan baru Anandam, kamu dapat voucher diskon spesial. Gunakan kode 🏷️ **${voucherCode}** saat checkout. Selamat berbelanja! 🛍️`
      : `Halo ${firstName}! Selamat datang di Anandam. Ada voucher diskon spesial menunggumu — cek halaman Voucher sekarang! 🎁`;

    await this.createAndPush(userId, NotificationType.WELCOME_VOUCHER, title, body, {
      voucher_code: voucherCode ?? null,
    });

    this.logger.log(`[NOTIF] Welcome voucher sent → userId=${userId} voucher=${voucherCode ?? 'none'}`);
  }

  // ── Order Status Update ───────────────────────────────────────────────────

  /**
   * Dipanggil setiap kali status pesanan berubah.
   * - Push WebSocket: semua status
   * - Kirim email: SEMUA status (dari dibuat sampai selesai)
   *
   * order param: minimal butuh { id, invoice_number, user_id, courier_name? }
   */
  async sendOrderStatusNotif(
    userId: string,
    order: {
      id: string;
      invoice_number: string;
      courier_name?: string | null;
    },
    newStatus: string,
  ): Promise<void> {
    const { title, body } = getOrderNotifTemplate(
      newStatus,
      order.invoice_number,
      order.courier_name ?? undefined,
    );

    // 1. Simpan ke DB + push WebSocket (semua status)
    await this.createAndPush(userId, NotificationType.ORDER_UPDATE, title, body, {
      order_id: order.id,
      invoice_number: order.invoice_number,
      status: newStatus,
    });

    // 2. Kirim email untuk SEMUA perubahan status (fire-and-forget)
    if (EMAIL_TRIGGER_STATUSES.has(newStatus)) {
      this.dispatchOrderEmail(userId, order, newStatus).catch((err: any) => {
        this.logger.error(`[EMAIL] Unhandled dispatch error | userId=${userId} status=${newStatus} | ${err?.message}`);
      });
    }

    this.logger.log(
      `[NOTIF] Order status notif → userId=${userId} order=${order.invoice_number} status=${newStatus} email=${EMAIL_TRIGGER_STATUSES.has(newStatus) ? 'YES' : 'NO'}`,
    );
  }

  // ── REST: Query & Mutations ───────────────────────────────────────────────

  async getMyNotifications(userId: string, limit = 50) {
    return this.notifRepo.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notifRepo.count({
      where: { user_id: userId, is_read: false },
    });
    return { count };
  }

  async markAsRead(userId: string, notifId: string): Promise<{ success: boolean }> {
    await this.notifRepo.update({ id: notifId, user_id: userId }, { is_read: true });
    return { success: true };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notifRepo.update(
      { user_id: userId, is_read: false },
      { is_read: true },
    );
    return { updated: result.affected ?? 0 };
  }

  async deleteNotification(userId: string, notifId: string): Promise<{ success: boolean }> {
    await this.notifRepo.delete({ id: notifId, user_id: userId });
    return { success: true };
  }
}