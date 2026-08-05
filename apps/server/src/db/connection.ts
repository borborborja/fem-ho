/**
 * Connexió a la base de dades.
 *
 * La peça important d'aquest fitxer no és obrir la connexió: és **normalitzar el que
 * torna Postgres perquè el codi d'aplicació no hagi de saber quin motor hi ha a sota**.
 *
 * docs/01 vol timestamptz i boolean a Postgres, però el contracte de l'API i el del
 * sync parlen d'instants ISO-8601 amb Z i de booleans 0/1. Sense normalitzar, cada
 * consulta hauria de recordar en quin motor corre, i la que se n'oblidés fallaria només
 * en un dels dos — que és el pitjor tipus d'error.
 */

import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import pg from 'pg';
import { parseDatabaseUrl, type DatabaseTarget, type Engine } from './dialect.js';
import type { DB } from './types.js';

/** OID dels tipus de Postgres que cal normalitzar. Són estables i estan documentats. */
const PG_OID = {
  BOOL: 16,
  TIMESTAMPTZ: 1184,
  TIMESTAMP: 1114,
  INT8: 20,
} as const;

let pgParsersInstalled = false;

/**
 * Fa que Postgres torni el mateix que SQLite.
 *
 *   - timestamptz  → cadena ISO-8601 UTC amb Z, no un Date
 *   - boolean      → 0/1, no true/false
 *   - int8 (bigint)→ number, no cadena
 *
 * S'instal·la un sol cop per procés: `setTypeParser` és global al mòdul pg.
 */
function installPgTypeParsers(): void {
  if (pgParsersInstalled) return;

  pg.types.setTypeParser(PG_OID.TIMESTAMPTZ, (value) => new Date(value).toISOString());
  pg.types.setTypeParser(PG_OID.TIMESTAMP, (value) => new Date(`${value}Z`).toISOString());
  pg.types.setTypeParser(PG_OID.BOOL, (value) => (value === 't' ? 1 : 0));

  // `change_log.seq` és BIGSERIAL i pg el torna com a cadena per no perdre precisió.
  // El cursor del sync és aquest valor i s'ha de poder comparar com a número. Un
  // Number.MAX_SAFE_INTEGER de files de canvi són 9 bilions: no hi arribarem.
  pg.types.setTypeParser(PG_OID.INT8, (value) => Number(value));

  pgParsersInstalled = true;
}

export interface Connection {
  db: Kysely<DB>;
  engine: Engine;
  target: DatabaseTarget;
  close: () => Promise<void>;
}

export function connect(url: string): Connection {
  const target = parseDatabaseUrl(url);

  if (target.engine === 'sqlite') {
    const sqlite = new SQLite(target.target);

    // WAL: un escriptor i lectors concurrents sense bloquejar-se. És el mode que fa que
    // SQLite sigui viable per a una casa (D11), i el que obliga a no copiar el fitxer
    // amb `cp` amb el servidor engegat (docs/12 §6).
    sqlite.pragma('journal_mode = WAL');
    // Les claus foranes no s'apliquen per defecte a SQLite. Sense això, la meitat de
    // les REFERENCES de docs/01 serien decoratives.
    sqlite.pragma('foreign_keys = ON');
    // Espera si un altre escriptor té el bloqueig, en comptes de fallar de seguida.
    sqlite.pragma('busy_timeout = 5000');

    const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }) });
    return {
      db,
      engine: 'sqlite',
      target,
      close: async () => {
        await db.destroy();
      },
    };
  }

  installPgTypeParsers();
  const pool = new pg.Pool({ connectionString: target.target });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

  return {
    db,
    engine: 'postgres',
    target,
    close: async () => {
      await db.destroy();
    },
  };
}
