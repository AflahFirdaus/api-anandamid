import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddOrderPaymentShippingFields
 *
 * Menambahkan kolom-kolom baru pada tabel `orders` untuk mendukung
 * fitur payment gateway (Midtrans) dan shipping (Biteship).
 *
 * Kolom baru:
 *  - shipping_type         : Tipe pengiriman ('regular' atau 'instant')
 *  - is_locked             : Apakah order sudah dikunci oleh admin
 *  - payment_method        : Metode pembayaran dari Midtrans
 *  - address_id            : ID alamat pengiriman yang dipilih user
 *  - awb_number            : Nomor AWB/Resi dari Biteship
 *  - awb_url               : URL cetak label AWB dari Biteship
 *  - biteship_order_id     : ID Order dari Biteship (untuk request pickup)
 *  - pickup_request_id     : ID request pickup dari Biteship
 *  - delivered_at          : Waktu kurir menandai paket terkirim
 *  - completed_at          : Waktu pesanan selesai
 *  - shipping_details      : JSON detail pengiriman (rate, estimasi, dll)
 *  - shipping_address_snapshot : JSONB snapshot alamat saat checkout
 *  - payment_token         : Token Midtrans snap payment
 */
export class AddOrderPaymentShippingFields1751676800000
  implements MigrationInterface
{
  name = 'AddOrderPaymentShippingFields1751676800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. shipping_type
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_type" VARCHAR(20) NOT NULL DEFAULT 'regular'
    `);

    // 2. is_locked
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "is_locked" BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // 3. payment_method
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "payment_method" VARCHAR(255) NULL
    `);

    // 4. address_id
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "address_id" VARCHAR(255) NULL
    `);

    // 5. awb_number
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "awb_number" VARCHAR(255) NULL
    `);

    // 6. awb_url
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "awb_url" TEXT NULL
    `);

    // 7. biteship_order_id — ID internal Biteship untuk request pickup
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "biteship_order_id" VARCHAR(255) NULL
    `);

    // 8. pickup_request_id
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "pickup_request_id" VARCHAR(255) NULL
    `);

    // 9. delivered_at
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivered_at" TIMESTAMPTZ NULL
    `);

    // 10. completed_at
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "completed_at" TIMESTAMPTZ NULL
    `);

    // 11. shipping_details (JSON)
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_details" JSON NULL
    `);

    // 12. shipping_address_snapshot (JSONB) — snapshot alamat saat checkout
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_address_snapshot" JSONB NULL
    `);

    // 13. payment_token
    await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "payment_token" VARCHAR(255) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "payment_token"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_address_snapshot"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_details"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "completed_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivered_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "pickup_request_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "biteship_order_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "awb_url"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "awb_number"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "address_id"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "payment_method"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "is_locked"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "shipping_type"`);
  }
}
