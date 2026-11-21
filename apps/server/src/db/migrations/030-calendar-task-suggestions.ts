import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  await sql`
    ALTER TABLE user_settings ADD COLUMN calendar_task_suggestions BOOLEAN NOT NULL DEFAULT FALSE
  `.execute(db);
  // La marca és de qui ha dit que no. Un company pot voler fer la mateixa cita.
  await sql`
    CREATE TABLE calendar_suggestion_declines (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      calendar_id TEXT NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
      uid TEXT NOT NULL,
      recurrence_key TEXT NOT NULL,
      PRIMARY KEY (user_id, calendar_id, uid, recurrence_key)
    )
  `.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`DROP TABLE calendar_suggestion_declines`.execute(db);
  await sql`ALTER TABLE user_settings DROP COLUMN calendar_task_suggestions`.execute(db);
}
