import { sql } from 'kysely';
import { boolLiteral, typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  const f = boolLiteral(engine, false);
  for (const statement of [
    "ALTER TABLE calendars ADD COLUMN source_provider TEXT CHECK (source_provider IS NULL OR source_provider = 'google')",
    `CREATE TABLE google_calendar_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      google_subject TEXT NOT NULL,
      email TEXT NOT NULL,
      client_id TEXT NOT NULL,
      secret_enc TEXT,
      oauth_status TEXT NOT NULL CHECK (oauth_status IN ('connected','reconnect_required','disconnected')),
      oauth_lock TEXT,
      oauth_lock_until ${t.instant},
      created_at ${t.instant} NOT NULL,
      updated_at ${t.instant} NOT NULL,
      UNIQUE (user_id, google_subject)
    )`,
    `CREATE TABLE google_calendar_oauth_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      account_id TEXT NOT NULL,
      reconnect ${t.bool} NOT NULL DEFAULT ${f},
      client_id TEXT NOT NULL,
      source TEXT NOT NULL,
      state_hash TEXT NOT NULL UNIQUE,
      verifier_enc TEXT,
      nonce TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','exchanging','ready','failed','cancelled','completed')),
      result_enc TEXT,
      email TEXT,
      error_code TEXT,
      expires_at ${t.instant} NOT NULL
    )`,
    'CREATE INDEX idx_google_calendar_oauth_expiry ON google_calendar_oauth_attempts(expires_at)',
    `CREATE TABLE google_calendar_links (
      calendar_id TEXT PRIMARY KEY NOT NULL REFERENCES calendars(id),
      scope_id TEXT NOT NULL REFERENCES scopes(id),
      account_id TEXT NOT NULL REFERENCES google_calendar_accounts(id),
      remote_calendar_id TEXT NOT NULL,
      access_role TEXT NOT NULL,
      write_enabled ${t.bool} NOT NULL DEFAULT ${f},
      pull_lock TEXT,
      pull_lock_until ${t.instant},
      projected_at ${t.instant},
      sync_token TEXT,
      sync_window_day TEXT,
      deleted_at ${t.instant}
    )`,
    `CREATE UNIQUE INDEX idx_google_calendar_link_scope ON google_calendar_links(scope_id, remote_calendar_id)
       WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_google_calendar_link_remote ON google_calendar_links(remote_calendar_id)
       WHERE deleted_at IS NULL`,
    `CREATE INDEX idx_google_calendar_link_account ON google_calendar_links(account_id)
       WHERE deleted_at IS NULL`,
    `CREATE TABLE google_calendar_events (
      event_id TEXT PRIMARY KEY NOT NULL REFERENCES events(id),
      calendar_id TEXT NOT NULL REFERENCES calendars(id),
      remote_event_id TEXT NOT NULL,
      remote_etag TEXT NOT NULL,
      writable ${t.bool} NOT NULL DEFAULT ${f},
      has_guests ${t.bool} NOT NULL DEFAULT ${f},
      UNIQUE (calendar_id, remote_event_id)
    )`,
  ]) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  await sql`UPDATE calendars SET deleted_at = COALESCE(deleted_at, updated_at)
    WHERE source_provider = 'google'`.execute(db);
  await sql`DROP TABLE google_calendar_events`.execute(db);
  await sql`DROP TABLE google_calendar_links`.execute(db);
  await sql`DROP TABLE google_calendar_oauth_attempts`.execute(db);
  await sql`DROP TABLE google_calendar_accounts`.execute(db);
  await sql`ALTER TABLE calendars DROP COLUMN source_provider`.execute(db);
}
