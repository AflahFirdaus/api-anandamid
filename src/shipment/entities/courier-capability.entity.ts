import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('courier_capabilities')
export class CourierCapability {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 50 })
  courier_code: string; // jne, jnt, sicepat, pos, gojek, grab, etc.

  @Column({ length: 100 })
  courier_name: string;

  @Column({ default: true })
  supports_pickup: boolean;

  @Column({ default: true })
  supports_drop_off: boolean;

  @Column({ default: true })
  supports_instant: boolean;

  @Column({ default: true })
  supports_same_day: boolean;

  @Column({ default: true })
  supports_regular: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}