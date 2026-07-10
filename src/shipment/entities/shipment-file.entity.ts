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
 * Shipment File — stores URLs to generated files (label PDF, packing slip, invoice).
 * Files are stored in object storage (S3/Minio), not in DB.
 */
@Entity('shipment_files')
export class ShipmentFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Shipment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'shipment_id' })
  shipment: Shipment;

  @Column()
  shipment_id: string;

  @Column({ length: 50 })
  file_type: string; // LABEL_PDF | PACKING_SLIP | INVOICE

  @Column({ type: 'text' })
  file_url: string;

  @Column({ type: 'text', nullable: true })
  file_path: string; // storage path for re-generation if needed

  @Column({ type: 'int', nullable: true })
  file_size_bytes: number;

  @Column({ length: 50, nullable: true })
  content_type: string; // application/pdf, image/png

  @Column({ type: 'int', default: 0 })
  download_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  last_downloaded_at: Date;

  @Column({ type: 'varchar', length: 50, nullable: true })
  downloaded_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @Column({ type: 'timestamptz', nullable: true })
  expires_at: Date;
}