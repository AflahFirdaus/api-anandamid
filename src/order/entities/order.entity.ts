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

  // Relasi ke tabel users
  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  user_id: string; // Otomatis terisi karena JoinColumn

  @Column({ unique: true })
  invoice_number: string;

  @Column('decimal', { precision: 12, scale: 2 })
  total_price: number;

  @Column({ default: 'PENDING' })
  status: string; // PENDING, LUNAS, DIKEMAS, DIKIRIM, SELESAI, BATAL

  @Column({ type: 'text', nullable: true })
  notes: string; // Opsional: Catatan dari pembeli

  @Column({ nullable: true })
  tracking_number: string; // Nomor resi / AWB dari kurir

  @Column({ nullable: true })
  courier_name: string; // Nama kurir yang dipilih (JNE, J&T, etc.)

  @Column({ nullable: true })
  courier_service: string; // Layanan kurir (REG, YES, OKE, etc.)

  @Column('decimal', { precision: 10, scale: 2, nullable: true, default: 0 })
  shipping_cost: number; // Ongkos kirim

  // --- NEW FIELDS for Payment & Shipping Flow ---

  @Column({ type: 'varchar', length: 20, default: 'regular' })
  shipping_type: string; // 'regular' atau 'instant'

  @Column({ default: false })
  is_locked: boolean; // Order dikunci (admin sudah proses, buyer tidak bisa cancel)

  @Column({ nullable: true })
  payment_method: string; // Metode pembayaran dari Midtrans (qris, bank_transfer, etc.)

  @Column({ type: 'varchar', nullable: true })
  address_id: string; // ID alamat pengiriman yang dipilih

  @Column({ nullable: true })
  awb_number: string; // Nomor AWB/Resi dari Biteship (berbeda dengan tracking_number)

  @Column({ type: 'text', nullable: true })
  awb_url: string; // URL cetak label AWB dari Biteship

  @Column({ nullable: true })
  biteship_order_id: string; // ID Order dari Biteship (digunakan untuk request pickup)

  @Column({ nullable: true })
  pickup_request_id: string; // ID request pickup dari Biteship

  @Column({ type: 'timestamptz', nullable: true })
  delivered_at: Date; // Waktu kurir menandai paket terkirim

  @Column({ type: 'timestamptz', nullable: true })
  completed_at: Date; // Waktu pesanan selesai (konfirmasi buyer atau auto-complete)

  @Column({ type: 'json', nullable: true })
  shipping_details: Record<string, any>; // Detail pengiriman tambahan (rate, duration, dll)

  @Column({ type: 'jsonb', nullable: true })
  shipping_address_snapshot: Record<string, any>;

  @Column({ nullable: true })
  payment_token: string;

  // Relasi ke order_items
  @OneToMany(() => OrderItem, (item) => item.order, { cascade: true })
  items: OrderItem[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}