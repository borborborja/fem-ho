/**
 * Migració 005 — invitacions d'un sol ús.
 *
 * `docs/02` §9 (Admin) demana "+ Convidar membre", que crea l'usuari i genera un enllaç
 * d'invitació **d'un sol ús** perquè la persona s'hi posi la contrasenya ella mateixa. I
 * `docs/12` §3 diu que amb `FEMHO_REGISTRATION=invite` aquest és l'únic camí d'alta.
 *
 * L'alternativa —que l'administrador esculli la contrasenya i la digui per WhatsApp— fa
 * que la contrasenya inicial passi per un canal que ningú controla i que sovint no es
 * canvia mai. Aquí l'administrador no arriba a saber-la.
 *
 * **El token no es guarda mai en clar**, igual que als enllaços compartits (D10): a la
 * taula hi ha l'HMAC amb el pebre de la instància. Qui es quedés la base no en podria
 * treure cap invitació utilitzable sense tenir també el secret.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

function ddl(engine: Engine): string[] {
  const t = typeMap(engine);

  return [
    `CREATE TABLE user_invites (
      id           ${t.text} PRIMARY KEY NOT NULL,
      user_id      ${t.text} NOT NULL REFERENCES users(id),
      token_hmac   ${t.text} NOT NULL UNIQUE,
      created_by   ${t.text} NOT NULL REFERENCES users(id),
      expires_at   ${t.instant} NOT NULL,
      used_at      ${t.instant},
      created_at   ${t.instant} NOT NULL
    )`,
    // Es busca per HMAC i es descarten les caducades: és l'única consulta que es fa.
    `CREATE INDEX idx_user_invites_open ON user_invites(token_hmac) WHERE used_at IS NULL`,
  ];
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS user_invites').execute(db);
}
