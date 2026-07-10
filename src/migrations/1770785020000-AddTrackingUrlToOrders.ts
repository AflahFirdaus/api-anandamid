import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddMissingOrderColumns
 *
 * Adds columns to the `orders` table that are defined in the Order entity
 * but missing from the actual database schema.
 *
 * Missing columns identified by comparing Order entity vs existing migrations:
 *  - tracking_url, shipping_snapshot, label-related, booking-related
 *  - refund-related columns
 *  - cancel_reason, cancel_reason_detail, cancelled_at
 */
export class AddTrackingUrlToOrders1770785020000 implements MigrationInterface {
  name = 'AddTrackingUrlToOrders1770785020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Cancel reason fields
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "cancel_reason" TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "cancel_reason_detail" TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMPTZ NULL
    `);

    // Refund metadata fields
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_transaction_id" VARCHAR(255) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_key" VARCHAR(255) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_response" JSONB NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_status" VARCHAR(255) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refunded_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_retry_count" INTEGER NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_requested_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_completed_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_note" TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_operation_id" VARCHAR(255) NULL
    `);

    // Tracking & shipping
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "tracking_url" TEXT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_snapshot" JSONB NULL
    `);

    // Label / packing slip
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "label_print_count" INTEGER NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "last_label_printed_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "printed_by" VARCHAR(50) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "printed_at" TIMESTAMPTZ NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "label_status" VARCHAR(10) NOT NULL DEFAULT 'NOT_PRINTED'
    `);
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "label_version" VARCHAR(10) NOT NULL DEFAULT 'v1'
    `);

    // Booking idempotency
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "booking_status" VARCHAR(20) NOT NULL DEFAULT 'NOT_BOOKED'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "booking_status"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "label_version"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "label_status"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "printed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "printed_by"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "last_label_printed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "label_print_count"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_snapshot"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "tracking_url"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_operation_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_note"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_completed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_requested_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_retry_count"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refunded_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_status"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_response"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_key"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "refund_transaction_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "cancelled_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "cancel_reason_detail"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "cancel_reason"`);
  }
}