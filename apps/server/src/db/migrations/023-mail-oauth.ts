import { sql } from 'kysely';
import type { Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, _engine: Engine): Promise<void> {
  for (const definition of [
    "auth_method TEXT NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password','google'))",
    'google_subject TEXT',
    'oauth_status TEXT',
    'oauth_lock TEXT',
    'oauth_lock_until TEXT',
  ])
    await sql.raw(`ALTER TABLE mail_accounts ADD COLUMN ${definition}`).execute(db);
  await sql
    .raw(
      `CREATE TABLE mail_oauth_attempts (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    account_id TEXT NOT NULL,
    reconnect INTEGER NOT NULL,
    source TEXT NOT NULL,
    state_hash TEXT NOT NULL UNIQUE,
    verifier_enc TEXT,
    nonce TEXT NOT NULL,
    status TEXT NOT NULL,
    result_enc TEXT,
    email TEXT,
    error_code TEXT,
    expires_at TEXT NOT NULL
  )`,
    )
    .execute(db);
  await sql
    .raw('CREATE INDEX idx_mail_oauth_owner ON mail_oauth_attempts(user_id, expires_at)')
    .execute(db);
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  // En tornar enrere, un token OAuth no s'ha d'interpretar com una contrasenya IMAP.
  await sql
    .raw("UPDATE mail_accounts SET secret_enc = NULL WHERE auth_method = 'google'")
    .execute(db);
  await sql.raw('DROP TABLE mail_oauth_attempts').execute(db);
  for (const column of [
    'auth_method',
    'google_subject',
    'oauth_status',
    'oauth_lock',
    'oauth_lock_until',
  ]) {
    await sql.raw(`ALTER TABLE mail_accounts DROP COLUMN ${column}`).execute(db);
  }
}
