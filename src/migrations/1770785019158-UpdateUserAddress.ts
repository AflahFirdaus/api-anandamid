import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateUserAddress1770785019158 implements MigrationInterface {
  name = 'UpdateUserAddress1770785019158';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add province column
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ADD COLUMN IF NOT EXISTS "province" VARCHAR(100) NULL
    `);

    // Add city column
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ADD COLUMN IF NOT EXISTS "city" VARCHAR(100) NULL
    `);

    // Add district column
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ADD COLUMN IF NOT EXISTS "district" VARCHAR(100) NULL
    `);

    // Add subdistrict column
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ADD COLUMN IF NOT EXISTS "subdistrict" VARCHAR(100) NULL
    `);

    // Add area_id column for Biteship Area ID
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ADD COLUMN IF NOT EXISTS "area_id" VARCHAR(255) NULL
    `);

    // Add deleted_at column for soft delete
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP NULL
    `);

    // Change latitude column precision to NUMERIC(10,7)
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ALTER COLUMN "latitude" TYPE NUMERIC(10,7)
      USING "latitude"::NUMERIC(10,7)
    `);

    // Change longitude column precision to NUMERIC(11,8)
    await queryRunner.query(`
      ALTER TABLE "user_addresses"
      ALTER COLUMN "longitude" TYPE NUMERIC(10,7)
      USING "longitude"::NUMERIC(10,7)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "province"`);
    await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "city"`);
    await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "district"`);
    await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "subdistrict"`);
    await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "area_id"`);
    await queryRunner.query(`ALTER TABLE "user_addresses" DROP COLUMN IF EXISTS "deleted_at"`);
  }
}