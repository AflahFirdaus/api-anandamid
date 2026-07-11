import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateNotificationsTable1775020000002 implements MigrationInterface {
  name = 'CreateNotificationsTable1775020000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for notification type
    await queryRunner.query(`
      CREATE TYPE "public"."notifications_type_enum" AS ENUM (
        'ORDER_UPDATE',
        'WELCOME_VOUCHER',
        'SYSTEM'
      )
    `);

    await queryRunner.createTable(
      new Table({
        name: 'notifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'type',
            type: 'enum',
            enum: ['ORDER_UPDATE', 'WELCOME_VOUCHER', 'SYSTEM'],
            enumName: 'notifications_type_enum',
            default: "'SYSTEM'",
          },
          {
            name: 'title',
            type: 'varchar',
            length: '150',
            isNullable: false,
          },
          {
            name: 'body',
            type: 'text',
            isNullable: false,
          },
          {
            name: 'data',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'is_read',
            type: 'boolean',
            default: false,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Index: user_id + is_read (for unread count queries)
    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'IDX_notifications_user_id_is_read',
        columnNames: ['user_id', 'is_read'],
      }),
    );

    // Index: user_id + created_at (for listing queries)
    await queryRunner.createIndex(
      'notifications',
      new TableIndex({
        name: 'IDX_notifications_user_id_created_at',
        columnNames: ['user_id', 'created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('notifications');
    await queryRunner.query(`DROP TYPE IF EXISTS "public"."notifications_type_enum"`);
  }
}
