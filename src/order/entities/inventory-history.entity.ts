import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('inventory_histories')
export class InventoryHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  product_id: string;

  @Column({ length: 100, nullable: true })
  variant_name: string;

  @Column('int')
  qty: number;

  @Column('int')
  before_stock: number;

  @Column('int')
  after_stock: number;

  @Column({ length: 50, default: 'REFUND' })
  source: string;

  @Column({ length: 255 })
  reason: string;

  @Column({ nullable: true })
  reference_id: string;

  @Column({ length: 255, nullable: true })
  product_name: string;

  @Column({ length: 100, nullable: true })
  sku: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}