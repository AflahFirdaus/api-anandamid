import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { EventResponse } from './event-response.entity';

export enum EventStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

@Entity('events')
export class Event {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 255 })
  slug: string;

  @Column({ length: 255 })
  title: string;

  /** Deskripsi event — menyimpan HTML / Rich Text */
  @Column({ type: 'text' })
  description: string;

  /** Syarat & ketentuan — menyimpan HTML / Rich Text */
  @Column({ type: 'text' })
  rules: string;

  @Column({ type: 'timestamptz' })
  registration_start: Date;

  @Column({ type: 'timestamptz' })
  registration_end: Date;

  @Column({ type: 'timestamptz' })
  event_date: Date;

  @Column({ length: 255 })
  location_name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  location_url: string | null;

  @Column({ type: 'int', nullable: true })
  max_quota: number | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  additional_notes_label: string | null;

  /** URL/path poster event (rasio 3:2, mis. 1200x800) di local storage */
  @Column({ type: 'varchar', length: 500, nullable: true })
  poster_url: string | null;

  @Column({ type: 'enum', enum: EventStatus, default: EventStatus.DRAFT })
  status: EventStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => EventResponse, (response) => response.event)
  responses: EventResponse[];
}
