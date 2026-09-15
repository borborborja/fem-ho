import { sql } from 'kysely';
import type { Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';
import { visibleScopeIds } from '../../policy/scope-visibility.js';

export async function up(db: MigrationDb, _engine: Engine): Promise<void> {
  await sql
    .raw(
      `CREATE TABLE external_access (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    api_enabled INTEGER NOT NULL DEFAULT 0,
    mcp_enabled INTEGER NOT NULL DEFAULT 0
  )`,
    )
    .execute(db);
  await sql
    .raw('ALTER TABLE api_tokens ADD COLUMN channels TEXT NOT NULL DEFAULT \'["api","mcp"]\'')
    .execute(db);
  await sql
    .raw("ALTER TABLE api_tokens ADD COLUMN credential_type TEXT NOT NULL DEFAULT 'pat'")
    .execute(db);
  await sql.raw('ALTER TABLE activity_log ADD COLUMN credential_id TEXT').execute(db);
  // Congelar només els tokens personals: els agents conserven l'assignació pròpia.
  const tokens = await sql<{ id: string; user_id: string }>`SELECT t.id, t.user_id FROM api_tokens t
    JOIN users u ON u.id = t.user_id WHERE t.scope_ids IS NULL AND t.ai_agent_id IS NULL AND u.kind = 'human'`.execute(
    db,
  );
  for (const token of tokens.rows) {
    const ids = [...(await visibleScopeIds(db, token.user_id))];
    await sql`UPDATE api_tokens SET scope_ids = ${JSON.stringify(ids)} WHERE id = ${token.id}`.execute(
      db,
    );
  }
  await sql
    .raw(
      `CREATE TABLE mcp_oauth_clients (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL,
    secret_hash TEXT, auth_method TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE mcp_oauth_requests (
    id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL, state TEXT NOT NULL, challenge TEXT NOT NULL,
    scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
  )`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE mcp_oauth_codes (
    hash TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES mcp_oauth_requests(id) ON DELETE CASCADE,
    token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE, expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE mcp_oauth_sessions (
    id TEXT PRIMARY KEY, token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(id) ON DELETE CASCADE,
    resource TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE,
    access_expires_at TEXT NOT NULL, refresh_expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE mcp_oauth_used_refresh (
    hash TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES mcp_oauth_sessions(id) ON DELETE CASCADE
  )`,
    )
    .execute(db);
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  for (const table of [
    'mcp_oauth_used_refresh',
    'mcp_oauth_sessions',
    'mcp_oauth_codes',
    'mcp_oauth_requests',
    'mcp_oauth_clients',
    'external_access',
  ])
    await sql.raw(`DROP TABLE ${table}`).execute(db);
  for (const column of ['channels', 'credential_type'])
    await sql.raw(`ALTER TABLE api_tokens DROP COLUMN ${column}`).execute(db);
  await sql.raw('ALTER TABLE activity_log DROP COLUMN credential_id').execute(db);
}
