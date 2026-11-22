import { sql } from 'kysely';
import type { Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, _engine: Engine): Promise<void> {
  await sql`ALTER TABLE mail_accounts ADD COLUMN transport TEXT NOT NULL DEFAULT 'imap'
    CHECK (transport IN ('imap', 'gmail_api'))`.execute(db);
  await sql`ALTER TABLE mail_oauth_attempts ADD COLUMN transport TEXT NOT NULL DEFAULT 'imap'`.execute(
    db,
  );
  await sql`ALTER TABLE mail_oauth_attempts ADD COLUMN google_client_id TEXT`.execute(db);
  await sql`ALTER TABLE mail_rules ADD COLUMN gmail_label_id TEXT`.execute(db);
  await sql`ALTER TABLE mail_rules ADD COLUMN gmail_history_cursor TEXT`.execute(db);
  await sql`CREATE UNIQUE INDEX idx_mail_rules_gmail_label
    ON mail_rules(account_id, gmail_label_id) WHERE deleted_at IS NULL AND gmail_label_id IS NOT NULL`.execute(
    db,
  );
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  // Les credencials de l'API de Gmail no autoritzen una connexió IMAP.
  await sql`UPDATE mail_accounts SET secret_enc = NULL, oauth_status = 'reconnect_required'
    WHERE transport = 'gmail_api'`.execute(db);
  await sql`DELETE FROM mail_oauth_attempts WHERE transport = 'gmail_api'`.execute(db);
  await sql`DROP INDEX idx_mail_rules_gmail_label`.execute(db);
  await sql`ALTER TABLE mail_rules DROP COLUMN gmail_history_cursor`.execute(db);
  await sql`ALTER TABLE mail_rules DROP COLUMN gmail_label_id`.execute(db);
  await sql`ALTER TABLE mail_oauth_attempts DROP COLUMN google_client_id`.execute(db);
  await sql`ALTER TABLE mail_oauth_attempts DROP COLUMN transport`.execute(db);
  await sql`ALTER TABLE mail_accounts DROP COLUMN transport`.execute(db);
}
