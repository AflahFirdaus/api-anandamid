import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Menambahkan kolom untuk notifikasi WhatsApp pendaftar event:
 *  - events.whatsapp_group_url      : link join grup WA (dipakai di pesan "diterima")
 *  - event_responses.rejection_reason : alasan penolakan (3 opsi standar)
 */
export class AddWANotificationFields1787000000000 implements MigrationInterface {
  name = 'AddWANotificationFields1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" ADD "whatsapp_group_url" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "event_responses" ADD "rejection_reason" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "event_responses" DROP COLUMN "rejection_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "whatsapp_group_url"`,
    );
  }
}
