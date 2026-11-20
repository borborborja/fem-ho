import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  await sql`ALTER TABLE activity_log ADD COLUMN mcp_origin TEXT`.execute(db);
  // El pare queda escrit tal com era quan es va fer el canvi, fins i tot si el fill desapareix.
  await sql`ALTER TABLE activity_log ADD COLUMN task_id TEXT`.execute(db);
  await sql`
    CREATE INDEX idx_activity_mcp_task ON activity_log (task_id, scope_id, created_at, id)
    WHERE source = 'mcp' AND task_id IS NOT NULL
  `.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`DROP INDEX idx_activity_mcp_task`.execute(db);
  await sql`ALTER TABLE activity_log DROP COLUMN task_id`.execute(db);
  await sql`ALTER TABLE activity_log DROP COLUMN mcp_origin`.execute(db);
}
