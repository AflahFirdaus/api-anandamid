import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Voucher } from './voucher.entity';

@Entity('user_voucher_eligibilities')
@Unique(['user_id', 'voucher_id'])
export class UserVoucherEligibility {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  user_id: string;

  @ManyToOne(() => Voucher, (voucher) => voucher.eligibility, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voucher_id' })
  voucher: Voucher;

  @Column()
  voucher_id: string;

  @Column({ default: false })
  is_used: boolean;
}