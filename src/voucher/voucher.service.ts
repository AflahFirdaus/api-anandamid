import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  LessThanOrEqual,
  MoreThanOrEqual,
  In,
  DataSource,
} from 'typeorm';
import { Voucher, VoucherType, DiscountType } from './entities/voucher.entity';
import { VoucherUsage } from './entities/voucher-usage.entity';
import { UserVoucherEligibility } from './entities/user-voucher-eligibility.entity';
import { Order } from '../order/entities/order.entity';
import { calculateDiscount, DiscountResult } from './voucher.utils';

export interface EligibleVoucherDto {
  id: string;
  code: string;
  name: string;
  type: VoucherType;
  discountType: DiscountType;
  discountValue: number;
  discountResult: DiscountResult;
  minPurchase: number;
  maxDiscount: number | null;
  maxUsage: number;
  currentUsage: number;
  endDate: Date;
}

export interface AppliedVoucherResult {
  voucher: Voucher;
  discountResult: DiscountResult;
  finalTotal: number;
  usageId: string; // ID pemakaian untuk referensi rollback
}

// Status internal untuk VoucherUsage
export const VOUCHER_USAGE_STATUS = {
  RESERVED: 'RESERVED',
  CONFIRMED: 'CONFIRMED',
  RELEASED: 'RELEASED',
} as const;

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    @InjectRepository(Voucher)
    private readonly voucherRepository: Repository<Voucher>,
    @InjectRepository(VoucherUsage)
    private readonly voucherUsageRepository: Repository<VoucherUsage>,
    @InjectRepository(UserVoucherEligibility)
    private readonly eligibilityRepository: Repository<UserVoucherEligibility>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly dataSource: DataSource,
  ) {}

  // ──────────────────────────────────────────────
  //  PUBLIC METHOD 1: getEligibleVouchers
  // ──────────────────────────────────────────────

  /**
   * Mengambil semua voucher yang eligible untuk user berdasarkan orderTotal.
   *
   * Kriteria:
   * - isActive = true
   * - endDate >= today (belum expired)
   * - currentUsage < maxUsage (kuota masih tersedia)
   * - minPurchase <= orderTotal (minimal belanja terpenuhi)
   * - Jika type === 'NEW_USER', user belum pernah melakukan checkout sukses.
   */
  async getEligibleVouchers(
    userId: string,
    orderTotal: number,
  ): Promise<EligibleVoucherDto[]> {
    const now = new Date();

    // --- 1. Ambil semua voucher aktif yang belum expired ---
    const vouchers = await this.voucherRepository.find({
      where: {
        is_active: true,
        start_date: LessThanOrEqual(now),
        end_date: MoreThanOrEqual(now),
      },
    });

    // --- 2. Filter manual: currentUsage < maxUsage & minPurchase terpenuhi ---
    const eligibleVouchers = vouchers.filter((v) => {
      if (v.max_usage > 0 && v.current_usage >= v.max_usage) return false;
      if (Number(v.min_purchase) > orderTotal) return false;
      return true;
    });

    // --- 3. Filter khusus type === 'NEW_USER' ---
    const userHasCompletedOrder = await this.hasUserCompletedOrder(userId);

    const filteredVouchers = eligibleVouchers.filter((v) => {
      if (v.type === VoucherType.NEW_USER) {
        return !userHasCompletedOrder;
      }
      return true;
    });

    // --- 4. Cek eligibility khusus (UserVoucherEligibility) ---
    const eligibilityRecords = await this.eligibilityRepository.find({
      where: { user_id: userId },
    });

    const eligibilityMap = new Map(
      eligibilityRecords.map((e) => [e.voucher_id, e.is_used]),
    );

    // --- 5. Map ke DTO & hitung diskon ---
    return filteredVouchers
      .filter((v) => {
        const isUsed = eligibilityMap.get(v.id);
        if (isUsed === true) return false;
        return true;
      })
      .map((v) => ({
        id: v.id,
        code: v.code,
        name: v.name,
        type: v.type,
        discountType: v.discount_type,
        discountValue: Number(v.discount_value),
        discountResult: calculateDiscount(
          v.discount_type,
          Number(v.discount_value),
          orderTotal,
          v.max_discount ? Number(v.max_discount) : null,
        ),
        minPurchase: Number(v.min_purchase),
        maxDiscount: v.max_discount ? Number(v.max_discount) : null,
        maxUsage: v.max_usage,
        currentUsage: v.current_usage,
        endDate: v.end_date,
      }));
  }

  // ──────────────────────────────────────────────
  //  PUBLIC METHOD 2: validateAndApplyVoucher
  //  (RACE-CONDITION SAFE — Atomic UPDATE)
  // ──────────────────────────────────────────────

  /**
   * Validasi voucher secara ketat dan RESERVE slot pemakaian secara ATOMIK.
   *
   * ─── STRATEGI ──────────────────────────────────
   * Langkah 1: Read-only validation (cepat, tanpa lock).
   *            Jika lolos, lanjut ke langkah 2.
   *
   * Langkah 2: Atomic UPDATE dengan WHERE clause:
   *   UPDATE vouchers
   *   SET current_usage = current_usage + 1
   *   WHERE id = :id
   *     AND is_active = true
   *     AND start_date <= NOW()
   *     AND end_date >= NOW()
   *     AND current_usage < max_usage
   *
   *   Jika affected_rows === 1 → berhasil reserve slot.
   *   Jika affected_rows === 0 → gagal (habis / expired).
   *
   * Langkah 3: INSERT VoucherUsage dengan status 'RESERVED'.
   *
   * Langkah 4: Kembalikan hasil ke caller.
   *            Caller bertanggung jawab untuk CONFIRM atau RELEASE.
   *
   * ─── KENAPA LEBIH AMAN? ───────────────────────
   * ✅ Atomic di level database — PostgreSQL internal lock.
   * ✅ Tidak perlu SELECT FOR UPDATE (tidak hold lock lama).
   * ✅ 1000 request concurrect → hanya 1 yang dapat affected_rows = 1.
   * ✅ Transaction hanya untuk INSERT saja (sangat cepat).
   * ✅ Jika payment gagal → panggil releaseVoucher().
   *
   * @throws BadRequestException jika voucher tidak valid
   * @returns AppliedVoucherResult { voucher, discountResult, finalTotal, usageId }
   */
  async validateAndApplyVoucher(
    userId: string,
    voucherCode: string,
    orderTotal: number,
  ): Promise<AppliedVoucherResult> {
    const now = new Date();

    // ════════════════════════════════════════════
    //  LANGKAH 1 — Read-only Validations (cepat)
    // ════════════════════════════════════════════

    const voucher = await this.voucherRepository.findOne({
      where: { code: voucherCode },
    });

    if (!voucher) {
      throw new NotFoundException('Voucher tidak ditemukan');
    }

    // 1a. Status & Periode
    if (!voucher.is_active) {
      throw new BadRequestException('Voucher sudah tidak aktif');
    }
    if (now < voucher.start_date) {
      throw new BadRequestException('Voucher belum berlaku');
    }
    if (now > voucher.end_date) {
      throw new BadRequestException('Voucher sudah kedaluwarsa');
    }

    // 1b. Minimal belanja
    if (Number(voucher.min_purchase) > orderTotal) {
      throw new BadRequestException(
        `Minimal belanja Rp ${Number(voucher.min_purchase).toLocaleString('id-ID')} belum terpenuhi`,
      );
    }

    // 1c. Tipe NEW_USER
    if (voucher.type === VoucherType.NEW_USER) {
      const hasCompletedOrder = await this.hasUserCompletedOrder(userId);
      if (hasCompletedOrder) {
        throw new BadRequestException('Voucher khusus pengguna baru tidak tersedia');
      }
    }

    // 1d. Duplicate usage check (voucher yang sama)
    const existingUsage = await this.voucherUsageRepository.findOne({
      where: { user_id: userId, voucher_id: voucher.id },
    });
    if (existingUsage) {
      throw new BadRequestException('Anda sudah pernah menggunakan voucher ini');
    }

    // 1d5. Cegah penumpukan reservasi — release reservasi lama user
    // Jika user sudah punya reservasi voucher lain yang belum di-checkout,
    // release dulu sebelum reservasi yang baru.
    // Ini memastikan 1 user hanya memegang 1 kuota voucher aktif.
    const existingReserved = await this.voucherUsageRepository.findOne({
      where: { user_id: userId, status: VOUCHER_USAGE_STATUS.RESERVED },
    });

    if (existingReserved && existingReserved.voucher_id !== voucher.id) {
      this.logger.log(
        `User ${userId} has existing reservation ${existingReserved.id} (voucher ${existingReserved.voucher_id}), releasing...`,
      );
      await this.releaseVoucher(existingReserved.id);
    }

    // 1e. Eligibility check
    const eligibility = await this.eligibilityRepository.findOne({
      where: { user_id: userId, voucher_id: voucher.id },
    });
    if (eligibility && eligibility.is_used) {
      throw new BadRequestException('Voucher sudah pernah digunakan');
    }

    // ════════════════════════════════════════════
    //  LANGKAH 2 — Atomic UPDATE reservasi kuota
    // ════════════════════════════════════════════
    //
    //  Ini adalah inti dari race-condition safety.
    //  UPDATE hanya akan menambah current_usage JIKA
    //  kondisi current_usage < max_usage terpenuhi.
    //
    //  PostgreSQL menjamin atomicity untuk baris ini.
    //  Dua request concurrect → hanya satu yang berhasil.
    //

    const updateResult = await this.voucherRepository
      .createQueryBuilder()
      .update(Voucher)
      .set({ current_usage: () => 'current_usage + 1' })
      .where('id = :id', { id: voucher.id })
      .andWhere('is_active = :isActive', { isActive: true })
      .andWhere('start_date <= :now', { now })
      .andWhere('end_date >= :now', { now })
      .andWhere('current_usage < max_usage')
      .execute();

    // affected = 0 berarti gagal reserve (kuota habis dalam hitungan milidetik)
    if (updateResult.affected === 0) {
      throw new BadRequestException('Kuota voucher sudah habis');
    }

    // ════════════════════════════════════════════
    //  LANGKAH 3 — INSERT VoucherUsage (RESERVED)
    // ════════════════════════════════════════════

    const usage = this.voucherUsageRepository.create({
      voucher_id: voucher.id,
      user_id: userId,
      order_id: `RESERVED_${userId}_${Date.now()}`,
      status: VOUCHER_USAGE_STATUS.RESERVED,
    });

    const savedUsage = await this.voucherUsageRepository.save(usage);

    // Update eligibility jika ada
    if (eligibility && !eligibility.is_used) {
      await this.eligibilityRepository.update(
        { id: eligibility.id },
        { is_used: true },
      );
    }

    // ════════════════════════════════════════════
    //  LANGKAH 4 — Hitung diskon & return
    // ════════════════════════════════════════════

    const discountResult = calculateDiscount(
      voucher.discount_type,
      Number(voucher.discount_value),
      orderTotal,
      voucher.max_discount ? Number(voucher.max_discount) : null,
    );

    const finalTotal = Math.max(orderTotal - discountResult.discountAmount, 0);

    this.logger.log(
      `Voucher ${voucherCode} reserved for user ${userId}: discount=${discountResult.discountAmount}, final=${finalTotal}`,
    );

    return {
      voucher: { ...voucher, current_usage: voucher.current_usage + 1 },
      discountResult,
      finalTotal,
      usageId: savedUsage.id,
    };
  }

  // ──────────────────────────────────────────────
  //  PUBLIC METHOD 3: confirmVoucherUsage
  //  (Dipanggil setelah order berhasil dibuat)
  // ──────────────────────────────────────────────

  /**
   * Konfirmasi pemakaian voucher — ubah status RESERVED → CONFIRMED
   * dan update order_id dengan order yang sesungguhnya.
   *
   * Dipanggil oleh OrderService setelah order berhasil dibuat.
   */
  async confirmVoucherUsage(
    usageId: string,
    orderId: string,
  ): Promise<void> {
    const updateResult = await this.voucherUsageRepository.update(
      { id: usageId, status: VOUCHER_USAGE_STATUS.RESERVED },
      {
        status: VOUCHER_USAGE_STATUS.CONFIRMED,
        order_id: orderId,
        used_at: new Date(),
      },
    );

    if (updateResult.affected === 0) {
      this.logger.warn(
        `Voucher usage ${usageId} not found or already confirmed for order ${orderId}`,
      );
    }
  }

  // ──────────────────────────────────────────────
  //  PUBLIC METHOD 4: releaseVoucher
  //  (Rollback jika pembayaran gagal)
  // ──────────────────────────────────────────────

  /**
   * RELEASE voucher — batalkan reservasi jika pembayaran gagal.
   *
   * Melakukan 2 hal dalam 1 transaction:
   * 1. UPDATE voucher SET current_usage = current_usage - 1
   * 2. UPDATE voucher_usage SET status = 'RELEASED'
   *
   * AMAN dipanggil multiple kali — menggunakan optimistic check
   * dengan WHERE status = 'RESERVED'.
   */
  async releaseVoucher(usageId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Cari usage record dengan status RESERVED
      const usage = await queryRunner.manager.findOne(VoucherUsage, {
        where: { id: usageId, status: VOUCHER_USAGE_STATUS.RESERVED },
        lock: { mode: 'pessimistic_write' },
      });

      if (!usage) {
        this.logger.warn(
          `Voucher usage ${usageId} not found or already processed — skipping release`,
        );
        await queryRunner.rollbackTransaction();
        return;
      }

      // Decrement current_usage secara atomik
      await queryRunner.manager
        .createQueryBuilder()
        .update(Voucher)
        .set({ current_usage: () => 'current_usage - 1' })
        .where('id = :id', { id: usage.voucher_id })
        .andWhere('current_usage > 0')
        .execute();

      // Update status usage jadi RELEASED
      await queryRunner.manager.update(
        VoucherUsage,
        { id: usageId },
        { status: VOUCHER_USAGE_STATUS.RELEASED },
      );

      // Kembalikan eligibility jika ada
      await queryRunner.manager.update(
        UserVoucherEligibility,
        { user_id: usage.user_id, voucher_id: usage.voucher_id },
        { is_used: false },
      );

      await queryRunner.commitTransaction();

      this.logger.log(
        `Voucher usage ${usageId} released — quota restored`,
      );
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Failed to release voucher usage ${usageId}`,
        (error as Error).stack,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ──────────────────────────────────────────────
  //  HELPER: Cek apakah user punya order sukses
  // ──────────────────────────────────────────────

  private async hasUserCompletedOrder(userId: string): Promise<boolean> {
    const completedStatuses = ['LUNAS', 'DIKEMAS', 'DIKIRIM', 'SELESAI'];

    const count = await this.orderRepository.count({
      where: {
        user_id: userId,
        status: In(completedStatuses),
      },
    });

    return count > 0;
  }
}