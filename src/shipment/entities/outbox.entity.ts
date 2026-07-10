import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Outbox — stores domain events for reliable publishing.
 * Transaction → Save Aggregate + Save Outbox → Commit → Worker → Publish
 * Prevents event loss if server crashes after commit.
 */
@Entity('outbox')
@Index(['status', 'created_at'])
export class Outbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  event_type: string; // ShipmentCreatedEvent, ShipmentBookedEvent, etc.

  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ length: 100, nullable: true })
  aggregate_type: string; // shipment, order, payment

  @Column({ nullable: true })
  aggregate_id: string;

  @Column({ length: 20, default: 'PENDING' })
  status: string; // PENDING | PUBLISHED | FAILED

  @Column({ type: 'int', default: 0 })
  retry_count: number;

  @Column({ type: 'text', nullable: true })
  error_message: string;

  @Column({ type: 'timestamptz', nullable: true })
  published_at: Date;

  @Column({ nullable: true })
  transaction_id: string; // For tracing

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}