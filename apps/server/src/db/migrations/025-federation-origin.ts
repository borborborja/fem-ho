import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  // La procedència sobreviu al desenllaç i no depèn d'una FK a la seva configuració.
  await sql`ALTER TABLE change_log ADD COLUMN origin_link_id TEXT`.execute(db);
  await sql`ALTER TABLE change_log ADD COLUMN changed_fields TEXT`.execute(db);
  await sql`ALTER TABLE instance_links ADD COLUMN remote_role TEXT`.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`ALTER TABLE instance_links DROP COLUMN remote_role`.execute(db);
  await sql`ALTER TABLE change_log DROP COLUMN changed_fields`.execute(db);
  await sql`ALTER TABLE change_log DROP COLUMN origin_link_id`.execute(db);
}
