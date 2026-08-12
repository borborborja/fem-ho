/**
 * Migració 018 — quan va passar l'última cosa, i quan la va llegir l'agent.
 *
 * Delegar feina a un agent i no saber-ne res és el mateix que no delegar-la: la targeta es
 * queda quieta al kanban d'IA i no hi ha manera de distingir «hi està treballant» de «fa
 * tres dies que ningú l'ha tocada». Tres columnes ho responen, i cap és una taula nova.
 *
 * **`last_activity_at` I NO `updated_at`**
 * ----------------------------------------
 * `updated_at` és l'última escriptura **a la fila**, i per tant no veu res del que passa al
 * voltant: un comentari, una reserva, una pregunta. La marca de la targeta ha de dir
 * l'última cosa que ha passat **a la tasca**, i això és exactament el que ja registra
 * `activity_log`. Es manté a `audit/audited-transaction.ts`, que és per on passa tota
 * escriptura (regla 4): un sol lloc, i el dia que hi hagi un verb nou ja hi entra sol.
 *
 * **PER QUÈ LES LECTURES NO VAN A L'HISTORIAL**
 * ---------------------------------------------
 * «Quan ho va llegir l'agent» és una pregunta legítima —diu si t'ha llegit la resposta— i
 * podria semblar una entrada més d'`activity_log`. No ho és: un agent que consulta cada
 * minut hi deixaria mil quatre-centes files al dia i taparia el que sí que va fer. Una
 * columna que es reescriu diu el mateix i no s'acumula.
 *
 * **CAP DE LES TRES NEIX INVENTADA.** `NULL` a tot arreu: una tasca d'abans d'avui no s'ha
 * llegit mai, i posar-hi la data de la migració seria escriure una activitat que no va
 * existir. La interfície ja sap què fer amb un buit; amb una data falsa no.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);

  await sql.raw(`ALTER TABLE tasks ADD COLUMN last_activity_at ${t.text}`).execute(db);
  await sql.raw(`ALTER TABLE tasks ADD COLUMN ai_last_read_at ${t.text}`).execute(db);

  // `SET NULL` i no `CASCADE`: esborrat l'agent, que algú ho va llegir segueix sent cert.
  await sql
    .raw(
      `ALTER TABLE tasks ADD COLUMN ai_last_read_by ${t.text}
       REFERENCES ai_agents(id) ON DELETE SET NULL`,
    )
    .execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('ALTER TABLE tasks DROP COLUMN last_activity_at').execute(db);
  await sql.raw('ALTER TABLE tasks DROP COLUMN ai_last_read_at').execute(db);
  await sql.raw('ALTER TABLE tasks DROP COLUMN ai_last_read_by').execute(db);
  void engine;
}
