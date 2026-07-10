import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Webhook Log — records every incoming webhook for audit trail.
 * Supports Midtrans, Biteship, RajaOngkir, etc.
 */
@Entity('webhook_logs')
export class WebhookLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  provider: string; // midtrans, biteship, rajaongkir, google

  @Column({ length: 255 })
  endpoint: string; // /orders/webhook/biteship

  @Column({ type: 'text', nullable: true })
  ip_address: string;

  @Column({ type: 'jsonb', nullable: true })
  headers: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  response: Record<string, any>;

  @Column({ type: 'int', nullable: true })
  http_status: number;

  @Column({ length: 20, default: 'PENDING' })
  processing_status: string; // PENDING | SUCCESS | FAILED | RETRY

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'int', nullable: true })
  processing_time_ms: number;

  @Column({ nullable: true })
  reference_id: string; // Order ID, Shipment ID, etc.

  @Column({ nullable: true })
  idempotency_key: string; // Prevent duplicate processing

  @Column({ type: 'int', default: 0 })
  retry_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  received_at: Date;
}