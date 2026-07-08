import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
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
import { CreateVoucherDto } from './dto/create-voucher.dto';

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
  usageId: string;
}

export interface VoucherStatsDto {
  id: string;
  code: string;
  name: string;
  type: VoucherType;
  discountType: DiscountType;
  discountValue: number;
  minPurchase: number;
  maxDiscount: number | null;
  maxUsage: number;
  currentUsage: number;
  startDate: Date;
  endDate: Date;
  isActive: boolean;
  createdAt: Date;
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
   */
  async getEligibleVouchers(
    userId: string,
    orderTotal: number,
  ): Promise<EligibleVoucherDto[]> {
    const now = new Date();

    const vouchers = await this.voucherRepository.find({
      where: {
        is_active: true,
        start_date: LessThanOrEqual(now),
        end_date: MoreThanOrEqual(now),
      },
    });

    const eligibleVouchers = vouchers.filter((v) => {
      if (v.max_usage > 0 && v.current_usage >= v.max_usage) return false;
      if (Number(v.min_purchase) > orderTotal) return false;
      return true;
    });

    const userHasCompletedOrder = await this.hasUserCompletedOrder(userId);

    const filteredVouchers = eligibleVouchers.filter((v) => {
      if (v.type === VoucherType.NEW_USER) {
        return !userHasCompletedOrder;
      }
      return true;
    });

    const eligibilityRecords = await this.eligibilityRepository.find({
      where: { user_id: userId },
    });

    const eligibilityMap = new Map(
      eligibilityRecords.map((e) => [e.voucher_id, e.is_used]),
    );

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
  // ──────────────────────────────────────────────

  async validateAndApplyVoucher(
    userId: string,
    voucherCode: string,
    orderTotal: number,
  ): Promise<AppliedVoucherResult> {
    const now = new Date();

    const voucher = await this.voucherRepository.findOne({
      where: { code: voucherCode },
    });

    if (!voucher) {
      throw new NotFoundException('Voucher tidak ditemukan');
    }

    if (!voucher.is_active) {
      throw new BadRequestException('Voucher sudah tidak aktif');
    }
    if (now < voucher.start_date) {
      throw new BadRequestException('Voucher belum berlaku');
    }
    if (now > voucher.end_date) {
      throw new BadRequestException('Voucher sudah kedaluwarsa');
    }

    if (Number(voucher.min_purchase) > orderTotal) {
      throw new BadRequestException(
        `Minimal belanja Rp ${Number(voucher.min_purchase).toLocaleString('id-ID')} belum terpenuhi`,
      );
    }

    if (voucher.type === VoucherType.NEW_USER) {
      const hasCompletedOrder = await this.hasUserCompletedOrder(userId);
      if (hasCompletedOrder) {
        throw new BadRequestException(
          'Voucher khusus pengguna baru tidak tersedia',
        );
      }
    }

    const existingUsage = await this.voucherUsageRepository.findOne({
      where: { user_id: userId, voucher_id: voucher.id },
    });
    if (existingUsage) {
      throw new BadRequestException(
        'Anda sudah pernah menggunakan voucher ini',
      );
    }

    const existingReserved = await this.voucherUsageRepository.findOne({
      where: { user_id: userId, status: VOUCHER_USAGE_STATUS.RESERVED },
    });

    if (existingReserved && existingReserved.voucher_id !== voucher.id) {
      this.logger.log(
        `User ${userId} has existing reservation ${existingReserved.id} (voucher ${existingReserved.voucher_id}), releasing...`,
      );
      await this.releaseVoucher(existingReserved.id);
    }

    const eligibility = await this.eligibilityRepository.findOne({
      where: { user_id: userId, voucher_id: voucher.id },
    });
    if (eligibility && eligibility.is_used) {
      throw new BadRequestException('Voucher sudah pernah digunakan');
    }

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

    if (updateResult.affected === 0) {
      throw new BadRequestException('Kuota voucher sudah habis');
    }

    const usage = this.voucherUsageRepository.create({
      voucher_id: voucher.id,
      user_id: userId,
      order_id: `RESERVED_${userId}_${Date.now()}`,
      status: VOUCHER_USAGE_STATUS.RESERVED,
    });

    const savedUsage = await this.voucherUsageRepository.save(usage);

    if (eligibility && !eligibility.is_used) {
      await this.eligibilityRepository.update(
        { id: eligibility.id },
        { is_used: true },
      );
    }

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
  // ──────────────────────────────────────────────

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
  // ──────────────────────────────────────────────

  async releaseVoucher(usageId: string): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
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

      await queryRunner.manager
        .createQueryBuilder()
        .update(Voucher)
        .set({ current_usage: () => 'current_usage - 1' })
        .where('id = :id', { id: usage.voucher_id })
        .andWhere('current_usage > 0')
        .execute();

      await queryRunner.manager.update(
        VoucherUsage,
        { id: usageId },
        { status: VOUCHER_USAGE_STATUS.RELEASED },
      );

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
  //  ADMIN METHOD 1: createVoucher
  // ──────────────────────────────────────────────

  /**
   * Membuat voucher baru dari admin dashboard.
   * Kode voucher otomatis di-UPPERCASE dan divalidasi unique.
   */
  async createVoucher(dto: CreateVoucherDto): Promise<Voucher> {
    const normalizedCode = dto.code.trim().toUpperCase();

    // Cek duplikat kode
    const existing = await this.voucherRepository.findOne({
      where: { code: normalizedCode },
    });
    if (existing) {
      throw new ConflictException(
        `Kode voucher "${normalizedCode}" sudah digunakan`,
      );
    }

    const insertResult = await this.voucherRepository.insert({
      code: normalizedCode,
      name: dto.name.trim(),
      type: dto.type,
      discount_type: dto.discountType,
      discount_value: dto.discountValue,
      min_purchase: dto.minPurchase ?? 0,
      max_discount: dto.maxDiscount ?? undefined,
      max_usage: dto.maxUsage ?? 0,
      current_usage: 0,
      start_date: new Date(dto.startDate),
      end_date: new Date(dto.endDate),
      is_active: true,
    });

    const saved = await this.voucherRepository.findOneOrFail({
      where: { id: insertResult.identifiers[0].id },
    });

    this.logger.log(`Voucher "${saved.code}" created by admin`);

    return saved;
  }

  // ──────────────────────────────────────────────
  //  ADMIN METHOD 2: getAllVouchersWithStats
  // ──────────────────────────────────────────────

  /**
   * Mengambil semua voucher (aktif & non-aktif) lengkap dengan statistik
   * currentUsage vs maxUsage untuk dashboard admin.
   */
  async getAllVouchersWithStats(): Promise<VoucherStatsDto[]> {
    const vouchers = await this.voucherRepository.find({
      order: { created_at: 'DESC' },
    });

    return vouchers.map((v) => ({
      id: v.id,
      code: v.code,
      name: v.name,
      type: v.type,
      discountType: v.discount_type,
      discountValue: Number(v.discount_value),
      minPurchase: Number(v.min_purchase),
      maxDiscount: v.max_discount ? Number(v.max_discount) : null,
      maxUsage: v.max_usage,
      currentUsage: v.current_usage,
      startDate: v.start_date,
      endDate: v.end_date,
      isActive: v.is_active,
      createdAt: v.created_at,
    }));
  }

  // ──────────────────────────────────────────────
  //  ADMIN METHOD 3: toggleVoucherStatus
  // ──────────────────────────────────────────────

  /**
   * Toggle isActive voucher.
   * Aktif → Non-aktif, dan sebaliknya.
   */
  async toggleVoucherStatus(id: string): Promise<{ code: string; isActive: boolean }> {
    const voucher = await this.voucherRepository.findOne({
      where: { id },
    });

    if (!voucher) {
      throw new NotFoundException('Voucher tidak ditemukan');
    }

    const newStatus = !voucher.is_active;

    await this.voucherRepository.update({ id }, { is_active: newStatus });

    this.logger.log(
      `Voucher "${voucher.code}" status changed to ${newStatus ? 'ACTIVE' : 'INACTIVE'} by admin`,
    );

    return { code: voucher.code, isActive: newStatus };
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