import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddEventsPosterColumn
 * Menambahkan kolom poster_url pada tabel events (poster acara, rasio 3:2).
 */
export class AddEventsPosterColumn1786100000000 implements MigrationInterface {
  name = 'AddEventsPosterColumn1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "events"
        ADD COLUMN IF NOT EXISTS "poster_url" character varying(500)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "events" DROP COLUMN IF EXISTS "poster_url"
    `);
  }
}
