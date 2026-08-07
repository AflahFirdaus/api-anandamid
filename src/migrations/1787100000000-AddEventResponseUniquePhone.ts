import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mencegah pendaftaran ganda per orang per event sekaligus masih membiarkan
 * yang berstatus Rejected untuk mendaftar ulang (slot dibebaskan).
 * Index unik parsial: (event_id, phone) hanya untuk status Pending/Approved.
 */
export class AddEventResponseUniquePhone1787100000000
  implements MigrationInterface
{
  name = 'AddEventResponseUniquePhone1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_event_responses_event_phone_active"
      ON "event_responses" ("event_id", "phone")
      WHERE "status" <> 'Rejected'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "UQ_event_responses_event_phone_active"`,
    );
  }
}
