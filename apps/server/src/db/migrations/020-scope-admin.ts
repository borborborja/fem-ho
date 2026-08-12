/**
 * Migració 020 — torna el rol d'administrador d'un àmbit.
 *
 * **I torna perquè ara sí que fa una cosa diferent.** La 008 el va treure amb un argument
 * que era bo llavors: *«un rol que no fa res diferent és pitjor que no tenir-ne: dona la
 * sensació que hi ha una barrera on no n'hi ha»*. Entre `owner` i `collaborator` no hi havia
 * res a repartir.
 *
 * Ara n'hi ha dues coses, i totes dues les va demanar qui ho farà servir: **convidar i
 * configurar l'àmbit** sense poder-lo **esborrar ni traspassar**, i **veure el Registre i
 * les Estadístiques de tothom**, que és una decisió sobre la dedicació de la gent i no sobre
 * les tasques. Avui l'única manera d'elevar algú és fer-lo propietari, i llavors també pot
 * esborrar l'àmbit sencer.
 *
 * El ball de refer la taula a SQLite és el mateix que documenta la 008 —ampliar una unió
 * tancada no és un `ALTER`— i es fa igual, amb les claus foranes apagades mentre dura i
 * enceses passi el que passi.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

const ROLS_NOUS = "('owner','admin','collaborator','viewer')";
const ROLS_VELLS = "('owner','collaborator','viewer')";

async function rebuildSqlite(db: MigrationDb, engine: Engine, rols: string): Promise<void> {
  const t = typeMap(engine);
  const columns = ['id', 'scope_id', 'user_id', 'external_calendar_id', 'role', 'created_at'];
  const cols = columns.join(', ');

  await sql.raw('PRAGMA foreign_keys = OFF').execute(db);
  try {
    await sql
      .raw(
        `CREATE TABLE scope_members__new (
          id                   ${t.text} PRIMARY KEY NOT NULL,
          scope_id             ${t.text} NOT NULL REFERENCES scopes(id),
          user_id              ${t.text} REFERENCES users(id),
          external_calendar_id ${t.text} REFERENCES calendars(id),
          role                 ${t.text} NOT NULL DEFAULT 'collaborator'
                               CHECK (role IN ${rols}),
          created_at           ${t.instant} NOT NULL,
          UNIQUE (scope_id, user_id),
          CHECK (user_id IS NOT NULL OR external_calendar_id IS NOT NULL)
        )`,
      )
      .execute(db);
    await sql
      .raw(`INSERT INTO scope_members__new (${cols}) SELECT ${cols} FROM scope_members`)
      .execute(db);
    await sql.raw('DROP TABLE scope_members').execute(db);
    await sql.raw('ALTER TABLE scope_members__new RENAME TO scope_members').execute(db);
  } finally {
    await sql.raw('PRAGMA foreign_keys = ON').execute(db);
  }
}

async function setCheck(db: MigrationDb, engine: Engine, rols: string): Promise<void> {
  if (engine === 'sqlite') {
    await rebuildSqlite(db, engine, rols);
    return;
  }
  await sql
    .raw('ALTER TABLE scope_members DROP CONSTRAINT IF EXISTS scope_members_role_check')
    .execute(db);
  await sql
    .raw(
      `ALTER TABLE scope_members ADD CONSTRAINT scope_members_role_check CHECK (role IN ${rols})`,
    )
    .execute(db);
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  await setCheck(db, engine, ROLS_NOUS);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  // Els administradors passen a col·laboradors abans de tancar la unió: si es fes al revés,
  // les seves files violarien el `CHECK` en el moment de copiar-les.
  await sql.raw("UPDATE scope_members SET role = 'collaborator' WHERE role = 'admin'").execute(db);
  await setCheck(db, engine, ROLS_VELLS);
}
