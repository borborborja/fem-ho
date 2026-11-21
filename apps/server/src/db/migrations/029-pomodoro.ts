import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  // L'absència de fila fa servir els valors per defecte sense activar el Pomodoro a ningú.
  await sql`CREATE TABLE pomodoro_states (
    user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL
  )`.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`DROP TABLE pomodoro_states`.execute(db);
}
