import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  await sql`
    ALTER TABLE user_settings ADD COLUMN doing_auto_stop_minutes INTEGER
      CHECK (doing_auto_stop_minutes BETWEEN 1 AND 10080)
  `.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`ALTER TABLE user_settings DROP COLUMN doing_auto_stop_minutes`.execute(db);
}
