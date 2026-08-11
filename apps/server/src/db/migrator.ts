/**
 * Migrador.
 *
 * docs/12 §5:
 *   - S'executen a l'arrencar, ABANS d'escoltar peticions.
 *   - Còpia de seguretat automàtica abans de migrar, a /data/backups/, amb les últimes 5.
 *   - Si una migració falla, el procés NO arrenca. Res de continuar amb l'esquema a
 *     mitges.
 *   - El log ha de dir de quina versió a quina va, i quant ha trigat.
 *
 * És propi i no el de Kysely perquè cada migració necessita saber el motor: docs/01
 * marca les divergències de dialecte i no es poden amagar darrere d'un constructor
 * d'esquema portable.
 */

import { copyFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sql } from 'kysely';
import type { Engine } from './dialect.js';
import type { MigrationDb } from './migration-db.js';
import * as initialSchema from './migrations/001-initial-schema.js';
import * as taskLeases from './migrations/002-task-leases.js';
import * as instanceSettings from './migrations/003-instance-settings.js';
import * as aiUser from './migrations/004-ai-user.js';
import * as userInvites from './migrations/005-user-invites.js';
import * as calendarSources from './migrations/006-calendar-sources.js';
import * as weekStart from './migrations/007-week-start.js';
import * as sharedScopes from './migrations/008-shared-scopes.js';
import * as federation from './migrations/009-federation.js';
import * as gravatar from './migrations/010-gravatar.js';
import * as inboxSources from './migrations/011-inbox-sources.js';
import * as taskProvenance from './migrations/012-task-provenance.js';
import * as mailSources from './migrations/013-mail-sources.js';

export interface Migration {
  name: string;
  up: (db: MigrationDb, engine: Engine) => Promise<void>;
  down: (db: MigrationDb, engine: Engine) => Promise<void>;
  /**
   * Aquesta migració refà una taula **a la qual altres apunten**.
   *
   * A SQLite, canviar un `CHECK` vol dir crear la taula nova, copiar-hi, esborrar la
   * vella i renombrar. Si la taula té claus foranes entrants, el `DROP TABLE` les viola i
   * la migració peta.
   *
   * **`PRAGMA foreign_keys = OFF` no serveix de res dins d'una transacció**: SQLite
   * l'ignora en silenci, que és exactament el pitjor comportament possible —la migració
   * sembla que el desactiva i no el desactiva—. La 008 se'n va escapar perquè les taules
   * que refeia no tenien ningú apuntant-hi; la 009 refà `users`, que en té una dotzena, i
   * va petar la primera vegada que es va desplegar sobre una base amb dades.
   *
   * El procediment que la documentació de SQLite prescriu és posar el pragma **abans**
   * d'obrir la transacció. Així no es perd l'atomicitat: si la migració falla, es desfà
   * sencera igualment.
   */
  needsForeignKeysOff?: boolean;
}

/**
 * Les migracions, en ordre. El nom porta el número al davant i **no es canvia mai**:
 * és el que hi ha guardat a la base de les instàncies desplegades.
 */
export const MIGRATIONS: Migration[] = [
  { name: '001-initial-schema', up: initialSchema.up, down: initialSchema.down },
  { name: '002-task-leases', up: taskLeases.up, down: taskLeases.down },
  { name: '003-instance-settings', up: instanceSettings.up, down: instanceSettings.down },
  { name: '004-ai-user', up: aiUser.up, down: aiUser.down },
  { name: '005-user-invites', up: userInvites.up, down: userInvites.down },
  { name: '006-calendar-sources', up: calendarSources.up, down: calendarSources.down },
  { name: '007-week-start', up: weekStart.up, down: weekStart.down },
  { name: '008-shared-scopes', up: sharedScopes.up, down: sharedScopes.down },
  { name: '009-federation', up: federation.up, down: federation.down, needsForeignKeysOff: true },
  { name: '010-gravatar', up: gravatar.up, down: gravatar.down },
  { name: '011-inbox-sources', up: inboxSources.up, down: inboxSources.down },
  { name: '012-task-provenance', up: taskProvenance.up, down: taskProvenance.down },
  /**
   * `needsForeignKeysOff`: refà `attachments`, a la qual no apunta ningú avui —però el
   * pragma va al registre i no dins del refet, que és el defecte que la 009 va documentar.
   */
  {
    name: '013-mail-sources',
    up: mailSources.up,
    down: mailSources.down,
    needsForeignKeysOff: true,
  },
];

const MIGRATIONS_TABLE = 'schema_migrations';

async function ensureMigrationsTable(db: MigrationDb, engine: Engine): Promise<void> {
  const instant = engine === 'sqlite' ? 'TEXT' : 'TIMESTAMPTZ';
  await sql
    .raw(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
         name       TEXT PRIMARY KEY,
         applied_at ${instant} NOT NULL
       )`,
    )
    .execute(db);
}

async function appliedMigrations(db: MigrationDb): Promise<Set<string>> {
  const result = await sql.raw(`SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`).execute(db);
  return new Set((result.rows as { name: string }[]).map((r) => r.name));
}

/**
 * Còpia de seguretat abans de migrar.
 *
 * Només per a SQLite, i a propòsit: amb Postgres la còpia la fa qui l'administra amb
 * les seves eines, i intentar-ho des d'aquí seria pitjor que no fer-ho. Es diu clarament
 * al log en comptes de callar.
 *
 * Es fa amb l'API de còpia en línia de better-sqlite3 i no amb `cp`: amb WAL, copiar el
 * fitxer amb el servidor engegat dona una còpia corrupta (docs/12 §6).
 */
export function backupBeforeMigrate(
  engine: Engine,
  databasePath: string,
  dataDir: string,
  now: string,
  keep = 5,
): string | null {
  if (engine !== 'sqlite') return null;
  if (databasePath === ':memory:') return null;

  try {
    statSync(databasePath);
  } catch {
    // Base nova: no hi ha res a copiar.
    return null;
  }

  const backupsDir = join(dataDir, 'backups');
  mkdirSync(backupsDir, { recursive: true });

  const stamp = now.replace(/[:.]/g, '-');
  const destination = join(backupsDir, `femho-${stamp}.db`);
  copyFileSync(databasePath, destination);

  // Es conserven les últimes `keep`. Sense podar, un volum domèstic s'omple sol.
  const existing = readdirSync(backupsDir)
    .filter((f) => f.startsWith('femho-') && f.endsWith('.db'))
    .sort()
    .reverse();
  for (const stale of existing.slice(keep)) {
    unlinkSync(join(backupsDir, stale));
  }

  return destination;
}

export interface MigrateResult {
  from: string | null;
  to: string | null;
  applied: string[];
  durationMs: number;
  backup: string | null;
}

export interface MigrateOptions {
  engine: Engine;
  /** Ruta del fitxer SQLite, per a la còpia prèvia. */
  databasePath?: string;
  dataDir?: string;
  /** Instant actual en ISO. S'injecta per poder-ho provar. */
  now?: string;
  log?: (message: string) => void;
}

export async function migrateToLatest(
  db: MigrationDb,
  options: MigrateOptions,
): Promise<MigrateResult> {
  const started = Date.now();
  const log = options.log ?? (() => {});
  const now = options.now ?? new Date().toISOString();

  await ensureMigrationsTable(db, options.engine);
  const already = await appliedMigrations(db);

  const pending = MIGRATIONS.filter((m) => !already.has(m.name));
  const from = [...already].sort().pop() ?? null;

  if (pending.length === 0) {
    log(`migracions · res a fer, l'esquema ja és a ${from ?? 'buit'}`);
    return { from, to: from, applied: [], durationMs: Date.now() - started, backup: null };
  }

  let backup: string | null = null;
  if (options.databasePath !== undefined && options.dataDir !== undefined) {
    backup = backupBeforeMigrate(options.engine, options.databasePath, options.dataDir, now);
    if (backup !== null) log(`migracions · còpia prèvia a ${backup}`);
    else if (options.engine === 'postgres') {
      log(
        "migracions · amb Postgres la còpia prèvia la fa qui administra la base. No se n'ha fet cap.",
      );
    }
  }

  const applied: string[] = [];
  for (const migration of pending) {
    const each = Date.now();
    /**
     * El pragma va **fora** de la transacció, no a dins, i només per a qui ho demana: a
     * la resta de migracions les claus foranes segueixen actives, que és el que fa que
     * una migració que trenqui una referència es vegi el dia que es fa i no mesos després.
     */
    const relaxFks = options.engine === 'sqlite' && migration.needsForeignKeysOff === true;
    if (relaxFks) await sql.raw('PRAGMA foreign_keys = OFF').execute(db);

    try {
      // Cada migració va dins de la seva pròpia transacció: si la tercera falla, les dues
      // primeres queden aplicades i registrades, i el reintent continua des d'allà.
      await db.transaction().execute(async (trx) => {
        await migration.up(trx, options.engine);
        await sql
          .raw(
            `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES ('${migration.name}', '${now}')`,
          )
          .execute(trx);
      });
    } finally {
      if (relaxFks) await sql.raw('PRAGMA foreign_keys = ON').execute(db);
    }
    applied.push(migration.name);
    log(`migracions · ${migration.name} aplicada en ${Date.now() - each} ms`);
  }

  const to = applied[applied.length - 1] ?? from;
  log(`migracions · de ${from ?? 'buit'} a ${to} en ${Date.now() - started} ms`);

  return { from, to, applied, durationMs: Date.now() - started, backup };
}

/** Desfà l'última migració aplicada. Existeix per a la prova up/down/up de docs/13. */
export async function migrateDown(db: MigrationDb, engine: Engine): Promise<string | null> {
  await ensureMigrationsTable(db, engine);
  const already = [...(await appliedMigrations(db))].sort();
  const last = already.pop();
  if (last === undefined) return null;

  const migration = MIGRATIONS.find((m) => m.name === last);
  if (migration === undefined) {
    throw new Error(`La base diu que s'ha aplicat "${last}", que no és a MIGRATIONS.`);
  }

  await db.transaction().execute(async (trx) => {
    await migration.down(trx, engine);
    await sql.raw(`DELETE FROM ${MIGRATIONS_TABLE} WHERE name = '${last}'`).execute(trx);
  });

  return last;
}

/** Ruta del directori d'un fitxer de base, per si cal crear-lo abans d'obrir-lo. */
export function ensureParentDir(path: string): void {
  if (path === ':memory:') return;
  mkdirSync(dirname(path), { recursive: true });
}
