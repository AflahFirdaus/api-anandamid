import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddFulfillmentFields
 *
 * Menambahkan kolom fulfillment_status, shipping_method, handover_method ke tabel orders
 * untuk mendukung internal fulfillment workflow.
 *
 * Kolom baru:
 *  - fulfillment_status  : Internal status fulfillment (NONE, PACKING, etc.) — NOT shown in UI
 *  - shipping_method     : INSTANT | SAME_DAY | REGULAR
 *  - handover_method     : PICKUP | DROP_OFF
 */
export class AddFulfillmentFields1775020000000 implements MigrationInterface {
  name = 'AddFulfillmentFields1775020000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. fulfillment_status
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "fulfillment_status" VARCHAR(30) NOT NULL DEFAULT 'NONE'
    `);

    // 2. shipping_method
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_method" VARCHAR(20) NULL
    `);

    // 3. handover_method
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "handover_method" VARCHAR(20) NULL
    `);

    // 4. Index for faster queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_orders_fulfillment_status" ON "orders" ("fulfillment_status")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_orders_shipping_method" ON "orders" ("shipping_method")
    `);

    // 5. Update existing orders: set shipping_method based on shipping_type
    await queryRunner.query(`
      UPDATE "orders" SET "shipping_method" = 
        CASE 
          WHEN "shipping_type" = 'instant' THEN 'INSTANT'
          ELSE 'REGULAR'
        END
      WHERE "shipping_method" IS NULL
    `);

    // 6. Update existing DIKEMAS orders to PACKING fulfillment status
    await queryRunner.query(`
      UPDATE "orders" SET "fulfillment_status" = 'PACKING' 
      WHERE "status" IN ('DIKEMAS') AND "fulfillment_status" = 'NONE'
    `);

    // 7. Update existing DIKIRIM orders to LABEL_READY
    await queryRunner.query(`
      UPDATE "orders" SET "fulfillment_status" = 'LABEL_READY'
      WHERE "status" IN ('DIKIRIM') AND "fulfillment_status" = 'NONE'
    `);

    // 8. Update existing SELESAI orders to DELIVERED
    await queryRunner.query(`
      UPDATE "orders" SET "fulfillment_status" = 'DELIVERED'
      WHERE "status" IN ('SELESAI') AND "fulfillment_status" = 'NONE'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_shipping_method"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_orders_fulfillment_status"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "handover_method"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_method"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "fulfillment_status"`);
  }
}