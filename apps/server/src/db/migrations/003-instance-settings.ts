/**
 * Migració 003 — la taula de configuració de la instància.
 *
 * Existeix per una raó concreta i seriosa: **les claus VAPID s'han de persistir**
 * (docs/11 §2).
 *
 * El parell de claus identifica el servidor davant dels serveis de push. Canviar-lo
 * obliga a **resubscriure tots els navegadors**, i no hi ha manera de migrar-ho: les
 * subscripcions existents deixen de funcionar i l'usuari només ho pot arreglar esborrant
 * els permisos del lloc. Generar-les a l'arrencada del contenidor mata silenciosament
 * totes les subscripcions a cada reinici, i ningú se n'assabenta fins que algú es queixa
 * que ja no li arriben els recordatoris.
 *
 * Per això van a la base de dades i no a una variable d'entorn ni a un fitxer temporal:
 * la base ja és el que es copia a `/data/backups/`, i `docs/12` §5 ja la té al
 * procediment de restauració.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

function ddl(engine: Engine): string[] {
  const t = typeMap(engine);

  return [
    `CREATE TABLE instance_settings (
      key        ${t.text} PRIMARY KEY NOT NULL,
      value      ${t.text} NOT NULL,
      created_at ${t.instant} NOT NULL,
      updated_at ${t.instant} NOT NULL
    )`,
  ];
}

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  for (const statement of ddl(engine)) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS instance_settings').execute(db);
}
