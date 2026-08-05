/**
 * Aplica les migracions a una base nova, a la ruta que rep com a argument.
 *
 * L'única raó per la qual existeix és alimentar kysely-codegen amb un esquema real
 * (veure codegen.mjs). No es fa servir en producció.
 */

import { connect } from '../src/db/connection.js';
import { migrateToLatest } from '../src/db/migrator.js';

const path = process.argv[2];
if (path === undefined) {
  console.error('Ús: tsx scripts/build-schema-db.ts <ruta-del-fitxer>');
  process.exit(1);
}

const conn = connect(`sqlite://${path}`);
await migrateToLatest(conn.db, { engine: 'sqlite', log: (m) => console.log(`  ${m}`) });
await conn.close();
