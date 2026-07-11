import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationGateway } from './notification.gateway';

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
      body: `Tim kami lagi sibuk (dengan penuh cinta 💕) masukin pesanan ${inv} ke dalam kotak. Bentar lagi siap dikirim!`,
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

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifRepo: Repository<Notification>,
    private readonly gateway: NotificationGateway,
  ) {}

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

    await this.createAndPush(userId, NotificationType.ORDER_UPDATE, title, body, {
      order_id: order.id,
      invoice_number: order.invoice_number,
      status: newStatus,
    });

    this.logger.log(
      `[NOTIF] Order status notif → userId=${userId} order=${order.invoice_number} status=${newStatus}`,
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
