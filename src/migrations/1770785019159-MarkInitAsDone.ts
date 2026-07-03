import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * This migration exists only to mark the old InitDatabase1770785019158 migration
 * as already executed by inserting its record directly, since that migration
 * uses MySQL syntax (backticks) incompatible with PostgreSQL.
 *
 * The actual UpdateUserAddress1770785019158 migration has been executed successfully.
 */
export class MarkInitAsDone1770785019159 implements MigrationInterface {
  name = 'MarkInitAsDone1770785019159';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if the old migration record already exists
    const exists = await queryRunner.query(`
      SELECT id FROM "migrations" WHERE "name" = 'InitDatabase1770785019158'
    `);

    if (exists.length === 0) {
      await queryRunner.query(`
        INSERT INTO "migrations" ("timestamp", "name")
        VALUES (1770785019158, 'InitDatabase1770785019158')
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Do nothing - we only want to mark it, not unmark it
  }
}