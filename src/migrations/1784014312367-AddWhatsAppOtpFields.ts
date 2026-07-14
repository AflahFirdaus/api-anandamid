import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWhatsAppOtpFields1784014312367 implements MigrationInterface {
    name = 'AddWhatsAppOtpFields1784014312367'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "is_whatsapp_verified" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "users" ADD "whatsapp_otp" character varying(10)`);
        await queryRunner.query(`ALTER TABLE "users" ADD "whatsapp_otp_expires" TIMESTAMP`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "whatsapp_otp_expires"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "whatsapp_otp"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_whatsapp_verified"`);
    }
}
