/**
 * Migració 009 — la federació entre instàncies.
 *
 * **Una taula sola, i és a posta.** La temptació era muntar una capa d'identitat nova
 * per a les instàncies remotes: usuaris remots amb la seva taula, un tipus de principal
 * `remote`, claus foranes noves a mig esquema. No cal res d'això.
 *
 * El que fa la instància que rep és **crear un usuari ombra** —`users.kind = 'remote'`,
 * que la 008 ja va admetre al `CHECK`— i donar-li un `api_token` limitat a l'àmbit
 * compartit. A partir d'aquí, la instància remota és un client d'API més: passa per
 * `resolveApiToken`, per `visibleScopesPredicate`, pel filtre del sync i pel tall dels
 * calendaris, sense una sola branca nova a la capa de política. La regla 8 diu que la
 * política viu en un sol lloc; obrir-ne un segon camí per a la federació seria trair-la
 * precisament allà on més mal faria.
 *
 * `instance_links` és, doncs, **només la llibreta del costat que surt**: a quin servidor
 * es va, amb quin token, per quin àmbit i per on anava el cursor.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

/**
 * El `CHECK` de `users.kind`, que la 008 va deixar a mitges.
 *
 * Allà s'hi va escriure que `remote` hi entrava i **a SQLite no hi va entrar**: el que hi
 * havia era un `UPDATE users SET kind = kind`, que no toca cap restricció. A Postgres sí,
 * perquè allà n'hi ha prou amb `DROP CONSTRAINT` / `ADD CONSTRAINT`. Es va veure el dia
 * que el primer usuari ombra va intentar néixer, amb un 500 i un `SQLITE_CONSTRAINT_CHECK`.
 *
 * S'arregla **endavant i no tocant la 008**: hi ha bases que ja la porten aplicada, i una
 * migració que canvia després d'haver-se executat és una base que ningú pot reproduir.
 */
async function widenUserKind(db: MigrationDb, t: ReturnType<typeof typeMap>): Promise<void> {
  const columns = [
    'id',
    'email',
    'name',
    'password_hash',
    'kind',
    'role',
    'timezone',
    'locale',
    'theme',
    'accent',
    'avatar_color',
    'created_at',
    'updated_at',
    'deleted_at',
    'version',
    'instance_link_id',
    'remote_user_id',
  ];

  await sql.raw('PRAGMA foreign_keys = OFF').execute(db);
  try {
    await sql
      .raw(
        `CREATE TABLE users__new (
          id               ${t.text} PRIMARY KEY NOT NULL,
          email            ${t.text} UNIQUE,
          name             ${t.text} NOT NULL,
          password_hash    ${t.text},
          kind             ${t.text} NOT NULL DEFAULT 'human'
                           CHECK (kind IN ('human','ai','caldav_only','remote')),
          role             ${t.text} NOT NULL DEFAULT 'member'
                           CHECK (role IN ('admin','member')),
          timezone         ${t.text} NOT NULL DEFAULT 'Europe/Madrid',
          locale           ${t.text} NOT NULL DEFAULT 'ca',
          theme            ${t.text} NOT NULL DEFAULT 'system'
                           CHECK (theme IN ('system','light','dark')),
          accent           ${t.text} NOT NULL DEFAULT 'default'
                           CHECK (accent IN ('default','soft','mono-warm','mono-cool')),
          avatar_color     ${t.text},
          created_at       ${t.instant} NOT NULL,
          updated_at       ${t.instant} NOT NULL,
          deleted_at       ${t.instant},
          version          ${t.int} NOT NULL DEFAULT 1,
          instance_link_id ${t.text},
          remote_user_id   ${t.text}
        )`,
      )
      .execute(db);

    const cols = columns.join(', ');
    await sql.raw(`INSERT INTO users__new (${cols}) SELECT ${cols} FROM users`).execute(db);
    await sql.raw('DROP TABLE users').execute(db);
    await sql.raw('ALTER TABLE users__new RENAME TO users').execute(db);
    await sql
      .raw('CREATE INDEX idx_users_kind ON users(kind) WHERE deleted_at IS NULL')
      .execute(db);
  } finally {
    await sql.raw('PRAGMA foreign_keys = ON').execute(db);
  }
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);

  if (engine === 'sqlite') await widenUserKind(db, t);

  await sql
    .raw(
      `CREATE TABLE instance_links (
        id             ${t.text} PRIMARY KEY,
        scope_id       ${t.text} NOT NULL REFERENCES scopes(id),
        /**
         * On és l'altra instància. Sempre HTTPS pública: \`safeFetch\` segueix blocant
         * els rangs privats, i federar dues cases per la xarxa local voldria dir obrir
         * un forat que després no es tanca.
         */
        base_url       ${t.text} NOT NULL,
        name           ${t.text},
        /**
         * El token amb què ens hi presentem, xifrat com les credencials CalDAV: clau
         * derivada del secret d'aquesta instància i \`purpose = 'link:<id>'\`. **No es
         * pot transportar**, que és exactament el que ha de passar amb un secret.
         */
        token_enc      ${t.text} NOT NULL,
        /** El cursor del sync remot. Opac: ve de l'altre servidor i no s'interpreta. */
        /**
         * L'àmbit **a l'altra banda**.
         *
         * Sense això la rèplica només podria baixar: per pujar una tasca cal dir a quin
         * àmbit va, i el de l'espill local no vol dir res allà.
         */
        remote_scope_id ${t.text},
        cursor         ${t.text},
        /**
         * Per on anàvem de la nostra banda.
         *
         * És un seq del nostre change_log, no del seu: diu què hem escrit aquí que
         * encara no hem enviat. Barrejar-los seria enviar dues vegades o cap.
         */
        local_seq      ${t.int} NOT NULL DEFAULT 0,
        last_sync_at   ${t.instant},
        last_error     ${t.text},
        last_error_at  ${t.instant},
        created_by     ${t.text} REFERENCES users(id),
        created_at     ${t.instant} NOT NULL,
        updated_at     ${t.instant} NOT NULL
      )`,
    )
    .execute(db);

  // Un àmbit local ve, com a molt, d'un sol enllaç: dos orígens per al mateix tauler
  // serien dues veritats.
  await sql
    .raw('CREATE UNIQUE INDEX idx_instance_links_scope ON instance_links(scope_id)')
    .execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS instance_links').execute(db);
}
