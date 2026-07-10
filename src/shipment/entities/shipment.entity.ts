import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { Order } from '../../order/entities/order.entity';
import { ShipmentTracking } from './shipment-tracking.entity';
import { ShipmentItem } from './shipment-item.entity';
import { BookingLog } from './booking-log.entity';
import { ShipmentFile } from './shipment-file.entity';

@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Human-Readable Identifier ──
  @Column({ unique: true, length: 30 })
  shipment_number: string; // SHIP-20260710-00001

  // ── Internal Tracking Code (survives courier changes) ──
  @Column({ unique: true, length: 20 })
  tracking_code: string; // ANM-XXXXXX

  // ── Version ──
  @Column({ length: 10, default: 'v1' })
  shipment_version: string; // v1 → v2 (split) → v3 (courier change)

  @VersionColumn({ default: 1 })
  version: number; // Optimistic locking

  // ── Locking ──
  @Column({ default: false })
  is_locked: boolean;

  @Column({ length: 50, nullable: true })
  locked_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  locked_until: Date;

  // ── Relations ──
  @ManyToOne(() => Order, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column()
  order_id: string;

  // ── External Reference ──
  @Column({ length: 100, nullable: true })
  external_reference: string; // Biteship/Shopee/Tokopedia order ID

  // ── Courier ──
  @Column({ length: 50, nullable: true })
  courier_name: string;

  @Column({ length: 50, nullable: true })
  courier_service: string;

  @Column({ length: 20, nullable: true })
  shipping_method: string; // INSTANT | SAME_DAY | REGULAR

  @Column({ length: 20, nullable: true })
  handover_method: string; // PICKUP | DROP_OFF

  // ── AWB ──
  @Column({ nullable: true })
  awb_number: string;

  @Column({ type: 'text', nullable: true })
  awb_url: string;

  @Column({ nullable: true })
  biteship_order_id: string;

  // ── Courier Full Response (for dispute) ──
  @Column({ type: 'jsonb', nullable: true })
  booking_response: Record<string, any>;

  // ── Tracking ──
  @Column({ type: 'text', nullable: true })
  tracking_url: string;

  @Column({ nullable: true })
  pickup_request_id: string;

  // ── Driver (Instant) ──
  @Column({ type: 'json', nullable: true })
  driver_info: Record<string, any>;

  // ── Status ──
  @Column({ length: 30, default: 'PENDING' })
  shipment_status: string; // ShipmentStatus enum

  @Column({ length: 20, default: 'NOT_READY' })
  label_status: string; // LabelStatus enum

  @Column({ type: 'int', default: 0 })
  label_print_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_label_printed_at: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  printed_by: string;

  @Column({ type: 'timestamptz', nullable: true })
  printed_at: Date;

  // ── Snapshot (immutable) ──
  @Column({ type: 'jsonb', nullable: true })
  shipping_snapshot: Record<string, any>;

  // ── File URLs (object storage) ──
  @Column({ type: 'text', nullable: true })
  label_url: string;

  @Column({ type: 'text', nullable: true })
  packing_slip_url: string;

  @Column({ type: 'text', nullable: true })
  invoice_url: string;

  // ── Timestamps ──
  @Column({ type: 'timestamptz', nullable: true })
  picked_up_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  failed_at: Date;

  @Column({ type: 'text', nullable: true })
  failure_reason: string;

  @Column({ type: 'int', default: 0 })
  retry_count: number;

  // ── Soft Delete ──
  @Column({ type: 'timestamptz', nullable: true })
  deleted_at: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ── Relations ──
  @OneToMany(() => ShipmentTracking, (tracking) => tracking.shipment, { cascade: true })
  tracking_events: ShipmentTracking[];

  @OneToMany(() => ShipmentItem, (item) => item.shipment, { cascade: true })
  items: ShipmentItem[];

  @OneToMany(() => BookingLog, (log) => log.shipment, { cascade: true })
  booking_logs: BookingLog[];

  @OneToMany(() => ShipmentFile, (file) => file.shipment, { cascade: true })
  files: ShipmentFile[];
}