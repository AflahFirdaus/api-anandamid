import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: CreateEventTables
 *
 * Membuat tabel dan enum untuk fitur Event Registration & Management:
 *  - events          : konfigurasi event (halaman pendaftaran ala Google Form)
 *  - event_responses : data pendaftar + bukti persyaratan + status review
 */
export class CreateEventTables1786000000000 implements MigrationInterface {
  name = 'CreateEventTables1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Enum status event (draft/published)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."events_status_enum" AS ENUM ('draft', 'published');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // Enum status pendaftar (Pending/Approved/Rejected)
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."event_responses_status_enum" AS ENUM ('Pending', 'Approved', 'Rejected');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);

    // ====================== TABEL EVENTS ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying(255) NOT NULL,
        "title" character varying(255) NOT NULL,
        "description" text NOT NULL,
        "rules" text NOT NULL,
        "registration_start" TIMESTAMPTZ NOT NULL,
        "registration_end" TIMESTAMPTZ NOT NULL,
        "event_date" TIMESTAMPTZ NOT NULL,
        "location_name" character varying(255) NOT NULL,
        "location_url" character varying(500),
        "max_quota" integer,
        "additional_notes_label" character varying(255),
        "status" "public"."events_status_enum" NOT NULL DEFAULT 'draft',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_events_slug" UNIQUE ("slug")
      )
    `);

    // ====================== TABEL EVENT RESPONSES ======================
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "event_responses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "event_id" uuid NOT NULL,
        "name" character varying(255) NOT NULL,
        "phone" character varying(50) NOT NULL,
        "email" character varying(255) NOT NULL,
        "ig_account" character varying(255) NOT NULL,
        "address" text NOT NULL,
        "proof_of_follow_url" character varying(500) NOT NULL,
        "proof_of_review_url" character varying(500) NOT NULL,
        "additional_notes_answer" text,
        "status" "public"."event_responses_status_enum" NOT NULL DEFAULT 'Pending',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "PK_event_responses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_event_responses_event_id" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE
      )
    `);

    // Index pendukung query
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_event_responses_event_id" ON "event_responses" ("event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_event_responses_status" ON "event_responses" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "event_responses" CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "events" CASCADE`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."event_responses_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."events_status_enum"`,
    );
  }
}
