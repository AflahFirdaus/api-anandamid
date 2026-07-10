import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Shipment } from './shipment.entity';

/**
 * Booking Log — records every booking attempt for audit trail.
 * Admin can see "I booked on X date, this was the response".
 */
@Entity('booking_logs')
export class BookingLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Shipment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shipment_id' })
  shipment: Shipment;

  @Column()
  shipment_id: string;

  // ── Attempt Info ──
  @Column({ type: 'int', default: 1 })
  attempt_number: number;

  @Column({ length: 50 })
  courier: string;

  @Column({ length: 50 })
  service: string;

  @Column({ length: 30 })
  status: string; // SUCCESS | FAILED | TIMEOUT | DRIVER_REJECT

  // ── Response ──
  @Column({ type: 'text', nullable: true })
  awb_number: string;

  @Column({ type: 'jsonb', nullable: true })
  request_payload: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  response_data: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'int', nullable: true })
  response_time_ms: number;

  // ── Driver Info (instant) ──
  @Column({ type: 'jsonb', nullable: true })
  driver_info: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}