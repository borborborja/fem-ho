/**
 * Els dos motors. D11: SQLite per defecte, PostgreSQL suportat, CI prova les dues.
 *
 * docs/01 fixa el DDL en dialecte SQLite i marca les divergències. Aquest mòdul les
 * concentra en un sol lloc perquè no s'escampin per cada migració.
 */

export type Engine = 'sqlite' | 'postgres';

export interface DatabaseTarget {
  engine: Engine;
  /** Ruta del fitxer (SQLite) o cadena de connexió (Postgres). */
  target: string;
}

/**
 * Interpreta FEMHO_DATABASE_URL. Per defecte, `sqlite:///data/femho.db` (docs/12 §3).
 *
 * Formes acceptades:
 *   sqlite:///data/femho.db     ruta absoluta
 *   sqlite://./local.db          ruta relativa
 *   sqlite::memory:              en memòria, per a proves
 *   postgres://user:pw@host/db
 */
export function parseDatabaseUrl(url: string): DatabaseTarget {
  if (url.startsWith('sqlite:')) {
    const rest = url.slice('sqlite:'.length).replace(/^\/\//, '');
    return { engine: 'sqlite', target: rest === '' ? ':memory:' : rest };
  }
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return { engine: 'postgres', target: url };
  }
  throw new Error(
    `FEMHO_DATABASE_URL ha de començar amb sqlite: o postgres:, i és "${url}". ` +
      'Exemple: sqlite:///data/femho.db',
  );
}

/**
 * Els tipus de columna que divergeixen entre motors, i només aquests.
 *
 * docs/01 diu:
 *   - Els instants es guarden com a TEXT ISO-8601 UTC amb Z. A Postgres, timestamptz.
 *   - Els booleans són INTEGER 0/1. A Postgres, boolean.
 *   - change_log.seq és AUTOINCREMENT. A Postgres, BIGSERIAL.
 *
 * Que l'esquema divergeixi no vol dir que el codi d'aplicació ho hagi de saber: el
 * client de Postgres normalitza timestamptz a cadena ISO i boolean a 0/1 en llegir
 * (veure connection.ts), o sigui que per damunt d'aquesta línia els dos motors es
 * comporten igual.
 */
export interface TypeMap {
  /** Text lliure. */
  text: string;
  /** Instant ISO-8601 UTC. */
  instant: string;
  /** Booleà 0/1. */
  bool: string;
  /** Enter. */
  int: string;
  /** Clau primària autoincremental de 64 bits. */
  bigserial: string;
  /**
   * Ordenació binària per a `position`. D3: amb una collation lingüística l'ordre de
   * les claus és incorrecte i les targetes es desordenen sense cap error visible.
   *
   * A SQLite s'escriu `COLLATE BINARY`. A Postgres el que hi correspon és `COLLATE "C"`,
   * que compara byte a byte; el defecte d'una base creada amb locale és lingüístic i
   * ordenaria malament exactament igual.
   */
  binaryCollate: string;
}

export function typeMap(engine: Engine): TypeMap {
  return engine === 'sqlite'
    ? {
        text: 'TEXT',
        instant: 'TEXT',
        bool: 'INTEGER',
        int: 'INTEGER',
        bigserial: 'INTEGER PRIMARY KEY AUTOINCREMENT',
        binaryCollate: 'COLLATE BINARY',
      }
    : {
        text: 'TEXT',
        instant: 'TIMESTAMPTZ',
        bool: 'BOOLEAN',
        int: 'INTEGER',
        bigserial: 'BIGSERIAL PRIMARY KEY',
        binaryCollate: 'COLLATE "C"',
      };
}

/**
 * Literal booleà per defecte. A SQLite, 0/1; a Postgres, false/true.
 * Escriure `DEFAULT 0` en una columna BOOLEAN de Postgres és un error de tipus.
 */
export function boolLiteral(engine: Engine, value: boolean): string {
  if (engine === 'sqlite') return value ? '1' : '0';
  return value ? 'TRUE' : 'FALSE';
}
