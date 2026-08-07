import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Event } from './event.entity';

export enum ResponseStatus {
  PENDING = 'Pending',
  APPROVED = 'Approved',
  REJECTED = 'Rejected',
}

/** 3 alasan standar penolakan pendaftaran (dipakai admin & pesan WA). */
export enum RejectionReason {
  INVALID_DATA = 'Data yang diinputkan tidak sesuai',
  QUOTA_FULL = 'Kuota sudah Penuh',
  BANNED_PLAYER = 'Player Komunitas / player banned turnamen ini',
}

@Entity('event_responses')
export class EventResponse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  event_id: string;

  @Column({ length: 255 })
  name: string;

  @Column({ length: 50 })
  phone: string;

  @Column({ length: 255 })
  email: string;

  @Column({ length: 255 })
  ig_account: string;

  @Column({ type: 'text' })
  address: string;

  /** Path file bukti follow di local storage (misal: /uploads/events/xxx.jpg) */
  @Column({ length: 500 })
  proof_of_follow_url: string;

  /** Path file bukti review di local storage (misal: /uploads/events/xxx.jpg) */
  @Column({ length: 500 })
  proof_of_review_url: string;

  @Column({ type: 'text', nullable: true })
  additional_notes_answer: string | null;

  @Column({
    type: 'enum',
    enum: ResponseStatus,
    default: ResponseStatus.PENDING,
  })
  status: ResponseStatus;

  /** Alasan penolakan (terisi saat status = Rejected). Gunakan enum RejectionReason. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  rejection_reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Event, (event) => event.responses, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'event_id' })
  event: Event;
}
