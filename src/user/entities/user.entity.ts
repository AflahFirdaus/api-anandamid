import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { UserAddress } from './user-address.entity';

export enum UserGender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    OTHER = 'OTHER'
}

@Entity('users')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 100 })
    full_name: string;

    @Column({ type: 'varchar', unique: true })
    email: string;

    @Column({ type: 'text' })
    password: string;

    @Column({ type: 'varchar', length: 20, nullable: true })
    phone_number: string;

    @Column({ type: 'date', nullable: true })
    birth_date: Date | null;

    @Column({
        type: 'enum',
        enum: UserGender,
        nullable: true,
    })
    gender: UserGender | null;

    @OneToMany(() => UserAddress, (address) => address.user)
    addresses: UserAddress[];

    @Column({ type: 'text', nullable: true })
    avatar_url: string;

    @Column({ default: true })
    is_active: boolean;

    @Column({ type: 'text', nullable: true })
    hashed_refresh_token: string | null;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;

    @Column({ type: 'varchar', nullable: true })
    reset_token: string | null; 

    @Column({ type: 'timestamp', nullable: true })
    reset_token_expires: Date | null;

    // ── OTP via Email ────────────────────────────────────────────
    @Column({ default: false })
    is_email_verified: boolean;

    @Column({ type: 'varchar', length: 10, nullable: true })
    email_otp: string | null;

    @Column({ type: 'timestamp', nullable: true })
    email_otp_expires: Date | null;

    // ── OTP via WhatsApp (DINONAKTIFKAN sementara) ───────────────
    // Kolom masih ada di DB (migration AddWhatsAppOtpFields), namun tidak
    // dipakai lagi karena OTP sekarang dikirim via Email.
    // @Column({ default: false })
    // is_whatsapp_verified: boolean;

    // @Column({ type: 'varchar', length: 10, nullable: true })
    // whatsapp_otp: string | null;

    // @Column({ type: 'timestamp', nullable: true })
    // whatsapp_otp_expires: Date | null;
}