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
 * Shipment Item — immutable product snapshot at time of shipment.
 * Prevents label/product name changes from affecting historical shipments.
 */
@Entity('shipment_items')
export class ShipmentItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Shipment, (shipment) => shipment.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shipment_id' })
  shipment: Shipment;

  @Column()
  shipment_id: string;

  // ── Product Snapshot (immutable) ──
  @Column({ length: 255, nullable: true })
  sku: string;

  @Column()
  product_name: string;

  @Column({ length: 100, nullable: true })
  variant_name: string;

  @Column('int')
  quantity: number;

  @Column('int')
  weight_grams: number;

  @Column('decimal', { precision: 12, scale: 2, default: 0 })
  price: number;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}