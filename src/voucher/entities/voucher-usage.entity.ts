import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Voucher } from './voucher.entity';

@Entity('voucher_usages')
export class VoucherUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Voucher, (voucher) => voucher.usages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'voucher_id' })
  voucher: Voucher;

  @Column()
  voucher_id: string;

  @Column()
  user_id: string;

  @Column()
  order_id: string;

  @Column({ type: 'varchar', length: 20, default: 'RESERVED' })
  status: string; // RESERVED | CONFIRMED | RELEASED

  @CreateDateColumn({ nullable: true })
  used_at: Date;
}