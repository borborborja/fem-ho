import { sql } from 'kysely';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb): Promise<void> {
  // Les subscripcions que ja rebien recordatoris els han de continuar rebent.
  await sql`ALTER TABLE push_subscriptions ADD COLUMN activity_only INTEGER NOT NULL DEFAULT 0
    CHECK (activity_only IN (0, 1))`.execute(db);
  await sql`CREATE TABLE notification_devices (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    platform TEXT NOT NULL CHECK (platform IN ('web', 'android')),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    subscription_id TEXT UNIQUE REFERENCES push_subscriptions(id) ON DELETE SET NULL
  )`.execute(db);
  await sql`CREATE TABLE task_activity_preferences (
    device_id TEXT NOT NULL REFERENCES notification_devices(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('task_created', 'status_changed', 'task_activity', 'inbox_entry')),
    PRIMARY KEY (device_id, scope_id, kind)
  )`.execute(db);
  await sql`CREATE INDEX idx_task_activity_preferences_scope ON task_activity_preferences
    (scope_id, kind, device_id)`.execute(db);
  await sql`CREATE TABLE task_activity_notifications (
    id TEXT PRIMARY KEY NOT NULL,
    device_id TEXT NOT NULL REFERENCES notification_devices(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('task_created', 'status_changed', 'task_activity', 'inbox_entry')),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    available_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    claim_token TEXT,
    claim_until TEXT,
    push_finished INTEGER NOT NULL DEFAULT 0 CHECK (push_finished IN (0, 1))
  )`.execute(db);
  await sql`CREATE INDEX idx_task_activity_push ON task_activity_notifications
    (available_at, id) WHERE push_finished = 0`.execute(db);
  await sql`CREATE INDEX idx_task_activity_device ON task_activity_notifications
    (device_id, created_at, id)`.execute(db);
  await sql`CREATE INDEX idx_task_activity_expiry ON task_activity_notifications
    (expires_at)`.execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql`DROP TABLE task_activity_notifications`.execute(db);
  await sql`DROP TABLE task_activity_preferences`.execute(db);
  await sql`DROP TABLE notification_devices`.execute(db);
  await sql`ALTER TABLE push_subscriptions DROP COLUMN activity_only`.execute(db);
}
