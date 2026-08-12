/**
 * Migració 017 — «no puc seguir sense tu».
 *
 * Un agent que treballa sol es troba amb coses que no pot decidir: quina de les dues
 * factures, si el text va bé, quina credencial. Fins avui ho podia dir en un comentari —la
 * via principal per reportar (docs/09 §6)— i **allà es quedava**: per assabentar-se'n
 * calia obrir la tasca, i el motiu per obrir-la era justament el que no se sabia.
 *
 * Dues columnes, i cadascuna respon una pregunta diferent:
 *
 *   - `needs_attention` — si espera resposta **ara**. És el que fa el punt al commutador i
 *     la targeta destacada.
 *   - `attention_asked_at` — **des de quan**. Una pregunta de fa deu minuts i una de fa
 *     tres dies no volen dir el mateix, i amb un sol indicador no es podrien distingir.
 *
 * **PER QUÈ NO ÉS UN ESTAT DEL COMENTARI**
 * ----------------------------------------
 * La pregunta és un comentari i s'hi queda —surt a l'historial com tota la resta—, però
 * «aquesta tasca espera resposta» és una propietat de la tasca: és el que ha de poder
 * respondre el tauler sense llegir els comentaris de tres-centes targetes.
 *
 * **I QUI HA DIT CADA COSA**
 * ---------------------------
 * `comments.author_agent_id` hi entra amb la mateixa tanda perquè la conversa de la
 * pestanya IA ha de poder dir **qui parla**. Un agent actua sempre en nom d'una persona
 * (D5) i per tant `author_id` és la persona: sense aquesta columna, distingir-ho voldria
 * dir mirar si l'etiqueta comença per «IA · », que és endevinar-ho pel nom.
 *
 * **QUI LA BAIXA**
 * ----------------
 * Una persona que respon, i completar la tasca. **No hi ha «vist»**: el que desencalla
 * l'agent és la resposta, i un botó de vist deixaria l'agent esperant per sempre amb la
 * pantalla neta, que és la pitjor de les dues mentides possibles.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);
  const F = engine === 'postgres' ? 'false' : '0';
  const T = engine === 'postgres' ? 'true' : '1';

  await sql
    .raw(`ALTER TABLE tasks ADD COLUMN needs_attention ${t.bool} NOT NULL DEFAULT ${F}`)
    .execute(db);
  await sql.raw(`ALTER TABLE tasks ADD COLUMN attention_asked_at ${t.text}`).execute(db);

  // `SET NULL` i no `CASCADE`: esborrat l'agent, el que va dir segueix sent cert i s'ha de
  // poder llegir. El que es perd és de qui era, no la conversa.
  await sql
    .raw(
      `ALTER TABLE comments ADD COLUMN author_agent_id ${t.text}
       REFERENCES ai_agents(id) ON DELETE SET NULL`,
    )
    .execute(db);

  /**
   * L'índex és **parcial**: les tasques que esperen resposta són poques i la pregunta que
   * es fa sempre és «quines n'hi ha», mai «quines no». Un índex sencer sobre un booleà on
   * gairebé tot és fals no serveix de res i s'ha de mantenir a cada escriptura.
   */
  await sql
    .raw(`CREATE INDEX idx_tasks_attention ON tasks(scope_id) WHERE needs_attention = ${T}`)
    .execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('DROP INDEX idx_tasks_attention').execute(db);
  await sql.raw('ALTER TABLE tasks DROP COLUMN needs_attention').execute(db);
  await sql.raw('ALTER TABLE tasks DROP COLUMN attention_asked_at').execute(db);
  await sql.raw('ALTER TABLE comments DROP COLUMN author_agent_id').execute(db);
  void engine;
}
