import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from '../../order/entities/order.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column()
  order_id: string;

  @Column({ unique: true, length: 50 })
  invoice_number: string;

  @Column({ length: 20, default: 'PROFORMA' })
  invoice_type: string; // PROFORMA | TAX

  @Column({ nullable: true })
  customer_name: string;

  @Column({ type: 'text', nullable: true })
  customer_address: string;

  @Column({ nullable: true })
  customer_email: string;

  @Column({ nullable: true })
  customer_phone: string;

  @Column({ length: 20, nullable: true })
  customer_npwp: string;

  @Column({ nullable: true })
  company_name: string;

  @Column({ type: 'text', nullable: true })
  company_address: string;

  @Column({ nullable: true })
  company_email: string;

  @Column({ type: 'jsonb', nullable: true })
  items: Record<string, any>[];

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  shipping_cost: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  discount: number;

  @Column('decimal', { precision: 10, scale: 2, default: 0 })
  ppn: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ nullable: true })
  payment_method: string;

  @Column({ nullable: true })
  courier_name: string;

  @Column({ nullable: true })
  courier_service: string;

  @Column({ nullable: true })
  tracking_number: string;

  @Column({ length: 20, default: 'ISSUED' })
  status: string; // DRAFT | ISSUED | CANCELLED

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'timestamptz', nullable: true })
  generated_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  issued_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date;

  @Column({ type: 'text', nullable: true })
  pdf_url: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}