import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailOtpFields1787400000000 implements MigrationInterface {
    name = 'AddEmailOtpFields1787400000000'

    /**
     * OTP kini dikirim via Email (bukan WhatsApp lagi).
     * Tambahkan kolom email_otp / email_otp_expires / is_email_verified.
     * Kolom whatsapp_otp_* & is_whatsapp_verified dibiarkan di DB (tidak di-drop)
     * untuk jaga-jaga jika ingin rollback, namun tidak dipakai lagi di kode.
     */
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "is_email_verified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email_otp" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "email_otp_expires" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_otp_expires"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "email_otp"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_email_verified"`);
    }
}