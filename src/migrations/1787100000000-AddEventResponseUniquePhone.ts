import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mencegah pendaftaran ganda per orang per event sekaligus masih membiarkan
 * yang berstatus Rejected untuk mendaftar ulang (slot dibebaskan).
 * Index unik parsial: (event_id, phone) hanya untuk status Pending/Approved.
 */
export class AddEventResponseUniquePhone1787100000000 implements MigrationInterface {
  name = 'AddEventResponseUniquePhone1787100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Bersihkan duplikat sebelum membuat index unik.
    //    Untuk tiap grup (event_id, phone) non-Rejected, hanya satu yang
    //    dipertahankan (prioritas Approved, lalu yang paling awal daftar).
    await queryRunner.query(`
      DELETE FROM event_responses er
      WHERE er.status <> 'Rejected'
        AND er.id NOT IN (
          SELECT DISTINCT ON (event_id, phone) id
          FROM event_responses
          WHERE status <> 'Rejected'
          ORDER BY event_id, phone,
                   CASE WHEN status = 'Approved' THEN 0 ELSE 1 END,
                   created_at ASC,
                   id ASC
        )
    `);

    // 2. Buat unique index parsial untuk status Pending/Approved.
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
