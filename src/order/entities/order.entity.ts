import { 
  Entity, 
  PrimaryGeneratedColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  OneToMany,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { OrderItem } from './order-item.entity';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  user_id: string;

  @Column({ unique: true })
  invoice_number: string;

  @Column('decimal', { precision: 12, scale: 2 })
  total_price: number;

  @Column({ default: 'PENDING' })
  status: string;

  @Column({ type: 'text', nullable: true })
  cancel_reason: string;

  @Column({ type: 'text', nullable: true })
  cancel_reason_detail: string;

  @Column({ type: 'timestamptz', nullable: true })
  cancelled_at: Date;

  // ── Refund Metadata ──
  @Column({ nullable: true })
  refund_transaction_id: string;

  @Column({ nullable: true })
  refund_key: string;

  @Column({ type: 'jsonb', nullable: true })
  refund_response: Record<string, any>;

  @Column({ nullable: true })
  refund_status: string;

  @Column({ type: 'timestamptz', nullable: true })
  refunded_at: Date;

  @Column({ type: 'int', default: 0 })
  refund_retry_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  refund_requested_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  refund_completed_at: Date;

  @Column({ type: 'text', nullable: true })
  refund_note: string;

  @Column({ nullable: true })
  refund_operation_id: string;

  // ── Original Fields ──
  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ nullable: true })
  tracking_number: string;

  @Column({ nullable: true })
  courier_name: string;

  @Column({ nullable: true })
  courier_service: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 0 })
  shipping_cost: number;

  @Column({ type: 'varchar', length: 20, default: 'regular' })
  shipping_type: string;

  @Column({ default: false })
  is_locked: boolean;

  @Column({ nullable: true })
  payment_method: string;

  @Column({ type: 'varchar', nullable: true })
  address_id: string;

  @Column({ nullable: true })
  awb_number: string;

  @Column({ type: 'text', nullable: true })
  awb_url: string;

  @Column({ type: 'text', nullable: true })
  tracking_url: string;

  @Column({ nullable: true })
  biteship_order_id: string;

  @Column({ nullable: true })
  pickup_request_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date;

  @Column({ type: 'json', nullable: true })
  shipping_details: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  shipping_address_snapshot: Record<string, any>;

  @Column({ nullable: true })
  payment_token: string;

  // ── Shipping Label / Packing Slip ──
  @Column({ type: 'jsonb', nullable: true })
  shipping_snapshot: Record<string, any>;

  @Column({ type: 'int', default: 0 })
  label_print_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_label_printed_at: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  printed_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  printed_at: Date;

  @Column({ type: 'varchar', length: 10, default: 'NOT_PRINTED' })
  label_status: string; // NOT_PRINTED | PRINTED | REPRINTED

  @Column({ type: 'varchar', length: 10, default: 'v1' })
  label_version: string;

  // ── Booking Idempotency ──
  @Column({ type: 'varchar', length: 20, default: 'NOT_BOOKED' })
  booking_status: string; // NOT_BOOKED | BOOKING | BOOKED | FAILED

  // ── Fulfillment Status (internal, NOT shown in UI) ──
  @Column({ type: 'varchar', length: 30, default: 'NONE' })
  fulfillment_status: string; // FulfillmentStatus enum value

  // ── Shipping Method (internal) ──
  @Column({ type: 'varchar', length: 20, nullable: true })
  shipping_method: string; // INSTANT | SAME_DAY | REGULAR

  // ── Store Pickup ──
  @Column({ type: 'int', nullable: true })
  pickup_estimate_minutes: number; // Estimated preparation time for store_pickup

  @Column({ type: 'boolean', default: false })
  is_store_pickup: boolean;

  // ── Store Delivery (toko antar) ──
  @Column({ type: 'int', nullable: true })
  delivery_distance_km: number; // Distance in KM from store to customer

  @Column({ type: 'boolean', default: false })
  is_store_delivery: boolean;

  // ── Handover Method (internal, for regular shipping) ──
  @Column({ type: 'varchar', length: 20, nullable: true })
  handover_method: string; // PICKUP | DROP_OFF

  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
