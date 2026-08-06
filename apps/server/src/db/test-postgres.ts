/**
 * Un esquema de Postgres per a cada suite de proves.
 *
 * Tres fitxers de prova corren contra la mateixa base i cadascun feia
 * `DROP SCHEMA public CASCADE` per començar net. Amb Vitest executant-los en paral·lel,
 * un esborrava l'esquema mentre un altre hi migrava, i el que perdia la cursa fallava
 * amb `schema "public" does not exist` — un error que no diu res del que passa i que
 * apareix i desapareix segons quantes proves hi hagi.
 *
 * La solució no és serialitzar-les —això fa la suite més lenta a cada fitxer nou— sinó
 * **donar-los un esquema propi**. Cadascuna crea el seu, hi posa el `search_path` i el
 * deixa net en acabar. No es toquen entre elles i es poden afegir més sense pensar-hi.
 *
 * El `search_path` va a la cadena de connexió i no a un `SET` després de connectar: el
 * pool obre connexions noves quan li convé, i un `SET` només val per a la que el va
 * rebre. Amb `options=-c search_path=…`, cada connexió del pool neix ja apuntant-hi.
 */

import { sql } from 'kysely';
import { connect, type Connection } from './connection.js';

/** La base de proves, si n'hi ha. Sense això, les proves de Postgres se salten. */
export function postgresUrl(): string | undefined {
  const url = process.env.FEMHO_TEST_POSTGRES_URL;
  return url === undefined || url === '' ? undefined : url;
}

export interface TestSchema extends Connection {
  /** Esborra l'esquema i tanca la connexió. */
  drop: () => Promise<void>;
}

/**
 * Obre una connexió a un esquema propi, buit.
 *
 * `name` ha de ser estable per fitxer de prova: si es reutilitza, l'esquema es recrea
 * buit, o sigui que una execució anterior interrompuda no deixa brutícia.
 */
export async function connectTestSchema(url: string, name: string): Promise<TestSchema> {
  const schema = `test_${name.replace(/[^a-z0-9_]/giu, '_').toLowerCase()}`;

  // Es crea des d'una connexió a part: la definitiva ja ha d'apuntar a un esquema que
  // existeixi, o el `search_path` no resol res i tot cau a `public`.
  const admin = connect(url);
  await sql.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).execute(admin.db);
  await sql.raw(`CREATE SCHEMA ${schema}`).execute(admin.db);
  await admin.close();

  const separator = url.includes('?') ? '&' : '?';
  const scoped = connect(`${url}${separator}options=${encodeURIComponent(`-c search_path=${schema}`)}`);

  return {
    ...scoped,
    drop: async () => {
      await scoped.close();
      const cleaner = connect(url);
      await sql.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).execute(cleaner.db);
      await cleaner.close();
    },
  };
}
