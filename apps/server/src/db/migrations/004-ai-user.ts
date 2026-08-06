/**
 * Migració 004 — la fila d'usuari de la IA (D5).
 *
 * D5 resol un conflicte entre dos dossiers acceptant **totes dues coses**: `ai_agents`
 * és la identitat de *delegació*, amb `on_behalf_of_user_id` perquè la responsabilitat es
 * quedi sempre amb una persona; i una fila a `users` amb `kind='ai'` és **l'actor del
 * registre d'activitat i l'autor dels comentaris**.
 *
 * Sense aquesta fila, la línia de temps i el camí de l'avatar haurien de tractar un
 * actor polimòrfic: cada lloc que pinta "qui ho ha fet" hauria de saber que de vegades
 * no hi ha usuari i llavors s'ha de mirar una altra taula. Amb la fila, un comentari de
 * la IA és un comentari com qualsevol altre.
 *
 * **L'identificador és fix i igual a totes les instàncies.** Un UUID generat per
 * instància obligaria qualsevol exportació, importació o comparació entre instàncies a
 * traduir-lo, i el dia que algú restaurés una còpia en una altra instància els
 * comentaris de la IA quedarien orfes. És un UUIDv7 vàlid, amb el segell de temps a
 * zero, que és el que el marca com a sembrat i no com a creat per ningú.
 */

import { sql } from 'kysely';
import type { Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

/** L'actor d'IA. Fix, documentat, i el mateix a totes les instàncies. */
export const AI_USER_ID = '00000000-0000-7000-8000-000000000001';

export async function up(db: MigrationDb, _engine: Engine): Promise<void> {
  const now = new Date(0).toISOString();

  // `email` es queda a NULL a posta: aquest usuari no inicia mai sessió i un correu
  // fictici acabaria en un formulari d'invitació algun dia.
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, timezone, locale,
                       theme, accent, created_at, updated_at, version)
    VALUES (${AI_USER_ID}, NULL, 'IA', NULL, 'ai', 'member', 'Europe/Madrid', 'ca',
            'system', 'default', ${now}, ${now}, 1)
    ON CONFLICT (id) DO NOTHING
  `.execute(db);
}

export async function down(db: MigrationDb, _engine: Engine): Promise<void> {
  // Només si no ha deixat rastre. Si ha comentat o ha mogut res, esborrar-la trencaria
  // claus foranes i deixaria l'historial mentint sobre qui va fer què.
  await sql`
    DELETE FROM users WHERE id = ${AI_USER_ID}
      AND NOT EXISTS (SELECT 1 FROM activity_log WHERE actor_user_id = ${AI_USER_ID})
      AND NOT EXISTS (SELECT 1 FROM comments WHERE author_id = ${AI_USER_ID})
  `.execute(db);
}
