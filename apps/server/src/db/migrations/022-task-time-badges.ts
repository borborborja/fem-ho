/** Preferència personal: dedicació visible a les targetes. */
import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';
export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const defaultValue = engine === 'sqlite' ? '1' : 'TRUE';
  await sql
    .raw(
      `ALTER TABLE user_settings ADD COLUMN show_task_time ${typeMap(engine).bool} NOT NULL DEFAULT ${defaultValue}`,
    )
    .execute(db);
}
export async function down(db: MigrationDb): Promise<void> {
  await sql.raw('ALTER TABLE user_settings DROP COLUMN show_task_time').execute(db);
}
