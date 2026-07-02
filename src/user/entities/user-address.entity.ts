import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn, UpdateDateColumn, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_addresses')
export class UserAddress {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 50, default: 'Rumah' })
    label: string; 
    
    @Column({ type: 'varchar', length: 100 })
    recipient_name: string; 

    @Column({ type: 'varchar', length: 20 })
    phone_number: string; 

    @Column({ type: 'text' })
    full_address: string; 

    @Column({ type: 'varchar', length: 10, nullable: true })
    postal_code: string | null;

    @Column({ type: 'decimal', precision: 10, scale: 8, nullable: true })
    latitude: number;

    @Column({ type: 'decimal', precision: 11, scale: 8, nullable: true })
    longitude: number;

    @Column({ default: false })
    is_default: boolean; 

    @ManyToOne(() => User, (user) => user.addresses, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id' })
    user: User;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
}