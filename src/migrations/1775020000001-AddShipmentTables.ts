import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: AddShipmentTables
 *
 * Membuat tabel-tabel baru untuk Shipment Module:
 *  - shipments           : Main shipment data
 *  - shipment_trackings  : Tracking timeline events
 *  - shipment_items      : Immutable product snapshots
 *  - booking_logs        : Booking attempt audit trail
 *  - shipment_files      : File URLs (label PDF, packing slip, invoice)
 *  - webhook_logs        : Incoming webhook audit trail
 *  - outbox              : Outbox pattern for reliable event publishing
 *  - courier_capabilities: Courier handover support matrix
 */
export class AddShipmentTables1775020000001 implements MigrationInterface {
  name = 'AddShipmentTables1775020000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ====================== SHIPMENTS ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipment_number" character varying(30) NOT NULL,
        "tracking_code" character varying(20) NOT NULL,
        "shipment_version" character varying(10) NOT NULL DEFAULT 'v1',
        "version" integer NOT NULL DEFAULT 1,
        "is_locked" boolean NOT NULL DEFAULT false,
        "locked_by" character varying(50),
        "locked_until" TIMESTAMPTZ,
        "order_id" uuid NOT NULL,
        "external_reference" character varying(100),
        "courier_name" character varying(50),
        "courier_service" character varying(50),
        "shipping_method" character varying(20),
        "handover_method" character varying(20),
        "awb_number" character varying(255),
        "awb_url" text,
        "biteship_order_id" character varying(255),
        "booking_response" jsonb,
        "tracking_url" text,
        "pickup_request_id" character varying(255),
        "driver_info" json,
        "shipment_status" character varying(30) NOT NULL DEFAULT 'PENDING',
        "label_status" character varying(20) NOT NULL DEFAULT 'NOT_READY',
        "label_print_count" integer NOT NULL DEFAULT 0,
        "last_label_printed_at" TIMESTAMPTZ,
        "printed_by" character varying(50),
        "printed_at" TIMESTAMPTZ,
        "shipping_snapshot" jsonb,
        "label_url" text,
        "packing_slip_url" text,
        "invoice_url" text,
        "picked_up_at" TIMESTAMPTZ,
        "delivered_at" TIMESTAMPTZ,
        "failed_at" TIMESTAMPTZ,
        "failure_reason" text,
        "retry_count" integer NOT NULL DEFAULT 0,
        "deleted_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_shipments" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_shipment_number" UNIQUE ("shipment_number"),
        CONSTRAINT "UQ_tracking_code" UNIQUE ("tracking_code"),
        CONSTRAINT "FK_shipments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shipments_order_id" ON "shipments" ("order_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shipments_shipment_status" ON "shipments" ("shipment_status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shipments_awb_number" ON "shipments" ("awb_number")
    `);

    // ====================== SHIPMENT TRACKINGS ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_trackings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipment_id" uuid NOT NULL,
        "event" character varying(50) NOT NULL,
        "description" text,
        "location" text,
        "metadata" jsonb,
        "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_shipment_trackings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trackings_shipment" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shipment_trackings_shipment_id" ON "shipment_trackings" ("shipment_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_shipment_trackings_event" ON "shipment_trackings" ("event")
    `);

    // ====================== SHIPMENT ITEMS ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipment_id" uuid NOT NULL,
        "sku" character varying(255),
        "product_name" character varying(255) NOT NULL,
        "variant_name" character varying(100),
        "quantity" integer NOT NULL,
        "weight_grams" integer NOT NULL,
        "price" numeric(12,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_shipment_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_items_shipment" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE
      )
    `);

    // ====================== BOOKING LOGS ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "booking_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipment_id" uuid NOT NULL,
        "attempt_number" integer NOT NULL DEFAULT 1,
        "courier" character varying(50) NOT NULL,
        "service" character varying(50) NOT NULL,
        "status" character varying(30) NOT NULL,
        "awb_number" character varying(255),
        "request_payload" jsonb,
        "response_data" jsonb,
        "error_message" text,
        "response_time_ms" integer,
        "driver_info" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_booking_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_booking_logs_shipment" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE
      )
    `);

    // ====================== SHIPMENT FILES ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "shipment_files" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shipment_id" uuid NOT NULL,
        "file_type" character varying(50) NOT NULL,
        "file_url" text NOT NULL,
        "file_path" text,
        "file_size_bytes" integer,
        "content_type" character varying(50),
        "download_count" integer NOT NULL DEFAULT 0,
        "last_downloaded_at" TIMESTAMPTZ,
        "downloaded_by" character varying(50),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "expires_at" TIMESTAMPTZ,
        CONSTRAINT "PK_shipment_files" PRIMARY KEY ("id"),
        CONSTRAINT "FK_files_shipment" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE
      )
    `);

    // ====================== WEBHOOK LOGS ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webhook_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "provider" character varying(50) NOT NULL,
        "endpoint" character varying(255) NOT NULL,
        "ip_address" text,
        "headers" jsonb,
        "payload" jsonb,
        "response" jsonb,
        "http_status" integer,
        "processing_status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "error_message" text,
        "processing_time_ms" integer,
        "reference_id" character varying(255),
        "idempotency_key" character varying(255),
        "retry_count" integer NOT NULL DEFAULT 0,
        "processed_at" TIMESTAMPTZ,
        "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_webhook_logs" PRIMARY KEY ("id")
      )
    `);

    // ====================== OUTBOX ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "outbox" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_type" character varying(100) NOT NULL,
        "payload" jsonb NOT NULL,
        "aggregate_type" character varying(100),
        "aggregate_id" character varying(255),
        "status" character varying(20) NOT NULL DEFAULT 'PENDING',
        "retry_count" integer NOT NULL DEFAULT 0,
        "error_message" text,
        "published_at" TIMESTAMPTZ,
        "transaction_id" character varying(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_outbox" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_outbox_status_created" ON "outbox" ("status", "created_at")
    `);

    // ====================== COURIER CAPABILITIES ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courier_capabilities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "courier_code" character varying(50) NOT NULL,
        "courier_name" character varying(100) NOT NULL,
        "supports_pickup" boolean NOT NULL DEFAULT true,
        "supports_drop_off" boolean NOT NULL DEFAULT true,
        "supports_instant" boolean NOT NULL DEFAULT true,
        "supports_same_day" boolean NOT NULL DEFAULT true,
        "supports_regular" boolean NOT NULL DEFAULT true,
        "metadata" jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_courier_capabilities" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_courier_code" UNIQUE ("courier_code")
      )
    `);

    // ====================== SEED COURIER CAPABILITIES ======================
    await queryRunner.query(`
      INSERT INTO "courier_capabilities" ("courier_code", "courier_name", "supports_pickup", "supports_drop_off", "supports_instant", "supports_same_day", "supports_regular")
      VALUES 
        ('jne', 'JNE', true, true, false, false, true),
        ('jnt', 'J&T Express', true, true, false, false, true),
        ('sicepat', 'SiCepat', true, true, false, true, true),
        ('tiki', 'TIKI', true, true, false, false, true),
        ('pos', 'POS Indonesia', false, true, false, false, true),
        ('anteraja', 'AnterAja', true, true, false, true, true),
        ('ninjaxpress', 'Ninja Xpress', true, true, false, false, true),
        ('wahana', 'Wahana', true, true, false, false, true),
        ('gojek', 'GoSend', true, false, true, true, false),
        ('grab', 'GrabExpress', true, false, true, true, false)
      ON CONFLICT ("courier_code") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "courier_capabilities" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webhook_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_files" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booking_logs" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_items" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shipment_trackings" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "shipments" CASCADE`);
  }
}