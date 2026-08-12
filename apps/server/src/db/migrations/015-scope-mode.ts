/**
 * Migració 015 — multiàmbit o monoàmbit, per persona.
 *
 * Els àmbits són el primer eix de navegació de Fem-ho, i per a qui fa servir l'eina per a
 * una sola cosa són una barra amb un sol xip que no fa res. El mode diu **què posa la
 * interfície al davant**: els àmbits, o els projectes de l'àmbit on ets. No canvia res del
 * model —tota tasca segueix vivint dins d'un àmbit—, o sigui que aquí només hi ha una
 * columna de preferència, com la 007 amb el primer dia de la setmana.
 *
 * **`NULL` I NO `'multi'`, QUE ÉS TOT EL QUE HI HA DE FI EN AQUESTA MIGRACIÓ**
 * ---------------------------------------------------------------------------
 * `NULL` vol dir «aquesta persona encara no ho ha dit»; `'multi'` voldria dir «ho ha dit i
 * vol multi». Són dues coses diferents i es necessiten totes dues: el wizard ha de sortir
 * exactament a qui no ho ha dit mai, i sense la distinció caldria una segona columna
 * («ja l'ha vist») per saber-ho.
 *
 * Per això la columna **no porta `DEFAULT`**: qui s'apunti demà també ha de començar sense
 * haver dit res. El valor que val mentre no ho digui —`multi`, com funciona l'app avui— no
 * és a la base sinó a `policy/scope-mode.ts`, que és on es decideix.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  await sql.raw(`ALTER TABLE user_settings ADD COLUMN scope_mode ${t.text}`).execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('ALTER TABLE user_settings DROP COLUMN scope_mode').execute(db);
  void engine;
}
