/**
 * Migració 010 — l'interruptor de Gravatar, per persona.
 *
 * **Per què no n'hi ha prou amb la variable d'entorn.**
 *
 * `FEMHO_GRAVATAR` la posa qui administra la instància, i el que s'envia a un tercer és el
 * hash del correu **de cadascú**. Es llegeix sovint que "només s'envia un hash": per a una
 * adreça que algú ja sospita, comprovar-la és calcular-ne el SHA-256 i comparar. O sigui
 * que encendre-ho és dir a Automattic quines adreces hi ha en aquesta casa, i qui ha de
 * poder dir que no és la persona a qui pertany l'adreça.
 *
 * Per defecte **sí**, perquè si l'operador ho ha encès és que ho vol i el cas normal és
 * que la gent de casa hi estigui d'acord; però hi ha la casella per treure-ho, i mentre la
 * variable estigui apagada no es pregunta res de ningú.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  const cert = engine === 'sqlite' ? '1' : 'TRUE';
  await sql
    .raw(`ALTER TABLE user_settings ADD COLUMN gravatar ${t.bool} NOT NULL DEFAULT ${cert}`)
    .execute(db);
}

export async function down(db: MigrationDb): Promise<void> {
  await sql.raw('ALTER TABLE user_settings DROP COLUMN gravatar').execute(db);
}
