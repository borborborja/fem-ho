/**
 * Migració 007 — amb quin dia comença la setmana.
 *
 * L'idioma ja en dona un per defecte: dilluns en català i castellà, diumenge en anglès
 * (`packages/contracts/src/dates.ts`). Però **el primer dia de la setmana no és només
 * una convenció lingüística**: qui treballa el cap de setmana el vol d'una manera i qui
 * no, d'una altra, i tots dos poden tenir la mateixa llengua.
 *
 * `auto` segueix l'idioma i és el que hi ha per defecte, o sigui que ningú ha de tocar
 * res perquè funcioni. Les altres dues manen per damunt.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  await sql
    .raw(`ALTER TABLE user_settings ADD COLUMN week_start ${t.text} NOT NULL DEFAULT 'auto'`)
    .execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('ALTER TABLE user_settings DROP COLUMN week_start').execute(db);
  void engine;
}
