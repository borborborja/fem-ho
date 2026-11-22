import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  await sql
    .raw(
      `CREATE TABLE google_calendar_changes (
    id ${t.text} PRIMARY KEY,
    user_id ${t.text} NOT NULL REFERENCES users(id),
    calendar_id ${t.text} NOT NULL REFERENCES calendars(id),
    remote_calendar_id ${t.text} NOT NULL,
    event_id ${t.text} NOT NULL,
    remote_event_id ${t.text} NOT NULL,
    base_etag ${t.text},
    operation ${t.text} NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    draft ${t.text} NOT NULL,
    status ${t.text} NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'conflict', 'failed')),
    error_code ${t.text},
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at ${t.instant} NOT NULL,
    lock_token ${t.text},
    created_at ${t.instant} NOT NULL,
    updated_at ${t.instant} NOT NULL
  )`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE INDEX idx_google_calendar_changes_due ON
    google_calendar_changes(status, next_attempt_at, created_at)`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE UNIQUE INDEX idx_google_calendar_changes_active ON
    google_calendar_changes(user_id, calendar_id, remote_event_id)
    WHERE status IN ('pending', 'sending')`,
    )
    .execute(db);
  await sql
    .raw(
      `CREATE TABLE google_calendar_write_leases (
    remote_calendar_id ${t.text} PRIMARY KEY,
    token ${t.text} NOT NULL,
    expires_at ${t.instant} NOT NULL
  )`,
    )
    .execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`DROP TABLE google_calendar_write_leases`.execute(db);
  await sql`DROP TABLE google_calendar_changes`.execute(db);
}
