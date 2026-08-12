/**
 * Migració 016 — un àmbit, un agent.
 *
 * L'assignació de feina a un agent és **per àmbit** i no per tasca: si «Feina» és d'en
 * Hermes, tota la seva feina delegada és seva i de ningú més. Això vol dir que la relació
 * agent–àmbit no és una llista qualsevol sinó una amb una regla, i la regla va **a la base**:
 *
 *     UNIQUE (scope_id)
 *
 * Podria comprovar-se al servei —i s'hi comprova, per poder dir de qui és l'àmbit en comptes
 * d'un error de clau—, però una regla que només viu al codi la trenca el primer que escrigui
 * pel segon camí: una importació, una restauració, una eina d'administració. Aquí el que la
 * garanteix és la base, i el servei el que la fa entenedora.
 *
 * **`all_scopes` A `ai_agents`, I PER QUÈ NO ÉS UNA FILA PER ÀMBIT**
 * ------------------------------------------------------------------
 * «Aquest agent ho porta tot» ha de seguir sent cert demà. Amb una fila per àmbit, l'àmbit
 * que es creï la setmana que ve no seria de ningú i la feina que hi caigués no la faria mai
 * cap agent, sense que res ho digués. Amb l'indicador, el conjunt es calcula quan es
 * pregunta.
 *
 * Els dos `ON DELETE CASCADE` són els correctes: esborrat l'agent, les seves assignacions no
 * volen dir res; esborrat l'àmbit, tampoc. No hi ha dada que s'hi perdi que no fos d'allò.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  const F = engine === 'postgres' ? 'false' : '0';

  await sql
    .raw(
      `CREATE TABLE agent_scopes (
        agent_id ${t.text} NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
        scope_id ${t.text} NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, scope_id),
        UNIQUE (scope_id)
      )`,
    )
    .execute(db);

  // Per respondre «quins àmbits té aquest agent» sense recórrer la taula sencera.
  await sql.raw('CREATE INDEX idx_agent_scopes_agent ON agent_scopes(agent_id)').execute(db);

  await sql
    .raw(`ALTER TABLE ai_agents ADD COLUMN all_scopes ${t.bool} NOT NULL DEFAULT ${F}`)
    .execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('DROP TABLE agent_scopes').execute(db);
  await sql.raw('ALTER TABLE ai_agents DROP COLUMN all_scopes').execute(db);
  void engine;
}
