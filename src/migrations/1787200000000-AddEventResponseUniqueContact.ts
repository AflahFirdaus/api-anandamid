import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Enforce keunikan kontak per event untuk status Pending/Approved:
 *  - nomor WhatsApp (ternormalisasi: 08xx → 628xx, non-digit dihapus)
 *  - email (lowercase + trim)
 * Yang berstatus Rejected tetap boleh mendaftar ulang (slot dibebaskan).
 *
 * Menggunakan FUNCTIONAL unique index agar beda format tetap terdeteksi:
 *   "0812..." == "62812...", "Budi@Mail.com" == "budi@mail.com".
 */
export class AddEventResponseUniqueContact1787200000000 implements MigrationInterface {
  name = 'AddEventResponseUniqueContact1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Index lama berbasis nilai mentah (kalau pernah dibuat) — diganti versi ternormalisasi.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_event_responses_event_phone_active"`,
    );

    const phoneExpr = `regexp_replace(regexp_replace(phone, '\\D', '', 'g'), '^0', '62')`;
    const emailExpr = `lower(trim(email))`;

    // 1. Bersihkan duplikat berdasarkan nomor WA ternormalisasi (simpan satu terbaik).
    await queryRunner.query(`
      DELETE FROM event_responses er
      WHERE er.status <> 'Rejected'
        AND er.id NOT IN (
          SELECT DISTINCT ON (event_id, (${phoneExpr})) id
          FROM event_responses
          WHERE status <> 'Rejected'
          ORDER BY event_id, (${phoneExpr}),
                   CASE WHEN status = 'Approved' THEN 0 ELSE 1 END,
                   created_at ASC,
                   id ASC
        )
    `);

    // 2. Bersihkan duplikat berdasarkan email ternormalisasi.
    await queryRunner.query(`
      DELETE FROM event_responses er
      WHERE er.status <> 'Rejected'
        AND er.id NOT IN (
          SELECT DISTINCT ON (event_id, (${emailExpr})) id
          FROM event_responses
          WHERE status <> 'Rejected'
          ORDER BY event_id, (${emailExpr}),
                   CASE WHEN status = 'Approved' THEN 0 ELSE 1 END,
                   created_at ASC,
                   id ASC
        )
    `);

    // 3. Index unik parsial nomor WA ternormalisasi.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_event_responses_event_phone_active"
      ON "event_responses" ("event_id", ${phoneExpr})
      WHERE "status" <> 'Rejected'
    `);

    // 4. Index unik parsial email ternormalisasi.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_event_responses_event_email_active"
      ON "event_responses" ("event_id", ${emailExpr})
      WHERE "status" <> 'Rejected'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_event_responses_event_email_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_event_responses_event_phone_active"`,
    );
  }
}
