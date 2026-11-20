import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  await sql`CREATE TABLE task_ai_settings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    method TEXT NOT NULL CHECK (method IN ('copy', 'mcp_events', 'claude_routine')),
    subscription_id TEXT,
    connection_id TEXT,
    routine_id TEXT,
    routine_token_enc TEXT,
    revision TEXT NOT NULL,
    PRIMARY KEY (user_id, scope_id)
  )`.execute(db);

  // Les dates ISO en UTC també s'ordenen com a text i coincideixen amb les d'OAuth.
  await sql`CREATE TABLE task_ai_subscriptions (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,
    oauth_session_id TEXT NOT NULL REFERENCES mcp_oauth_sessions(id) ON DELETE CASCADE,
    callback_enc TEXT NOT NULL,
    secret_enc TEXT NOT NULL,
    previous_secret_enc TEXT,
    rotated_at TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`.execute(db);
  await sql`CREATE INDEX idx_task_ai_subscriptions_owner ON task_ai_subscriptions (user_id, scope_id)`.execute(
    db,
  );

  await sql`CREATE TABLE task_ai_executions (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    method TEXT NOT NULL CHECK (method IN ('mcp_events', 'claude_routine')),
    settings_revision TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    oauth_session_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'cancelled', 'uncertain')),
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    available_at TEXT NOT NULL,
    claim_until TEXT,
    session_url TEXT,
    retry_at TEXT,
    result_comment_id TEXT
  )`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_task_ai_active ON task_ai_executions (user_id, task_id)
    WHERE status IN ('queued', 'sending')`.execute(db);
  await sql`CREATE INDEX idx_task_ai_pending ON task_ai_executions (status, available_at)`.execute(
    db,
  );
  await sql`CREATE INDEX idx_task_ai_history ON task_ai_executions (user_id, task_id, created_at)`.execute(
    db,
  );

  // Una segona petició concurrent pot tenir un UUID diferent i ha de poder reintentar-se.
  await sql`CREATE TABLE task_ai_requests (
    id TEXT NOT NULL PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES task_ai_executions(id) ON DELETE CASCADE
  )`.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`DROP TABLE task_ai_requests`.execute(db);
  await sql`DROP TABLE task_ai_executions`.execute(db);
  await sql`DROP TABLE task_ai_subscriptions`.execute(db);
  await sql`DROP TABLE task_ai_settings`.execute(db);
}
