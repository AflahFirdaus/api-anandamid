import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { VoucherUsage } from './voucher-usage.entity';
import { UserVoucherEligibility } from './user-voucher-eligibility.entity';

export enum VoucherType {
  NEW_USER = 'NEW_USER',
  GLOBAL_PROMO = 'GLOBAL_PROMO',
}

export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED_AMOUNT = 'FIXED_AMOUNT',
}

@Entity('vouchers')
export class Voucher {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  code: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'enum', enum: VoucherType })
  type: VoucherType;

  @Column({ type: 'enum', enum: DiscountType })
  discount_type: DiscountType;

  @Column('decimal', { precision: 12, scale: 2 })
  discount_value: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  min_purchase: number;

  @Column('decimal', { precision: 12, scale: 2, nullable: true })
  max_discount: number;

  @Column('int', { default: 0 })
  max_usage: number;

  @Column('int', { default: 0 })
  current_usage: number;

  @Column({ type: 'timestamptz' })
  start_date: Date;

  @Column({ type: 'timestamptz' })
  end_date: Date;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @OneToMany(() => VoucherUsage, (usage) => usage.voucher)
  usages: VoucherUsage[];

  @OneToMany(() => UserVoucherEligibility, (eligibility) => eligibility.voucher)
  eligibility: UserVoucherEligibility[];
}