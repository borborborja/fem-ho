/**
 * Migració 019 — el temps treballat, les tipologies i la configuració per àmbit.
 *
 * **LA PRIMERA VEGADA QUE FEM-HO GUARDA TEMPS**
 * ---------------------------------------------
 * Fins avui no hi havia cap durada enlloc: ni columna, ni taula, ni cronòmetre. Hi havia
 * instants —`completed_at`, `last_activity_at`— i l'historial, que és una altra cosa.
 *
 * **`task_sessions`: UN BLOC PER ESTADA, NO UN ACUMULAT PER TASCA**
 * ----------------------------------------------------------------
 * Podria ser una columna `minutes` a `tasks` —és el que fa l'eina que això substitueix— i
 * seria més barat de sumar. Però llavors una tasca que torna de Fet a Fent hauria de
 * fondre's amb el que ja hi havia, i **el cronograma no existiria**: per pintar un dia en
 * blocs cal saber quan va començar i quan va acabar cada estada, no quant sumen totes.
 *
 * Per això aquí no hi ha cap `minutes`: **la suma es calcula sempre dels blocs**. Guardar
 * el total i els trams és guardar el mateix número dues vegades, i el dia que discrepin
 * ningú sabrà quin dels dos mana.
 *
 * `scope_id` hi és **desnormalitzat** a posta: tot el filtratge del Registre és per àmbit i
 * per dia, i sense la columna cada consulta hauria de passar per `tasks` per un camí que no
 * aporta res. Una tasca no canvia d'àmbit sense que algú ho vulgui, i quan passi, els blocs
 * hi van amb ella.
 *
 * `ended_at` nul vol dir **que hi és ara mateix**. No és una dada que falti: és l'estat
 * normal d'una tasca que s'està fent, i l'índex parcial serveix per trobar-la de pressa en
 * tancar-la.
 *
 * **`scope_settings`: COM ES COMPORTA UN ÀMBIT, SEPARAT DE QUI ÉS**
 * ----------------------------------------------------------------
 * `scopes` guarda la identitat —nom, color, si és col·lectiu—; això guarda el comportament.
 * Van separats perquè són coses de vides diferents: la identitat la mira tothom qui pinta un
 * xip, i el comportament només qui obre el Registre.
 *
 * **La fila absent vol dir «tot per defecte».** És el que fa que aquesta migració no toqui
 * cap àmbit existent: ningú es troba el Registre encès un matí, i els valors vius són els
 * de `policy/scope-settings.ts`, que és on es poden llegir.
 *
 * **`task_types` I PER QUÈ NO SÓN ETIQUETES**
 * -------------------------------------------
 * Una etiqueta és lliure: en pots posar moltes, qualsevol en crea de noves des de la fitxa i
 * no passa res si no n'hi ha cap. Una tipologia és **una i tancada**: la manté qui mana a
 * l'àmbit, i pot ser obligatòria. Amb una sola taula, «quantes n'hi pot haver» dependria d'un
 * indicador i el codi hauria de preguntar-s'ho a cada lloc.
 *
 * `ON DELETE SET NULL` a `tasks.task_type_id`: esborrada la tipologia, la feina feta segueix
 * sent feina feta. El que es perd és la classificació, no la tasca.
 */

import { sql } from 'kysely';
import { typeMap, type Engine } from '../dialect.js';
import type { MigrationDb } from '../migration-db.js';

export async function up(db: MigrationDb, engine: Engine): Promise<void> {
  const t = typeMap(engine);

  await sql
    .raw(
      `CREATE TABLE task_sessions (
        id         ${t.text} PRIMARY KEY NOT NULL,
        task_id    ${t.text} NOT NULL REFERENCES tasks(id),
        scope_id   ${t.text} NOT NULL REFERENCES scopes(id),
        user_id    ${t.text} NOT NULL REFERENCES users(id),
        started_at ${t.instant} NOT NULL,
        ended_at   ${t.instant},
        source     ${t.text} NOT NULL CHECK (source IN ('board','manual','backfill')),
        note       ${t.text},
        created_at ${t.instant} NOT NULL,
        updated_at ${t.instant} NOT NULL,
        deleted_at ${t.instant},
        version    ${t.int} NOT NULL DEFAULT 1
      )`,
    )
    .execute(db);

  // Les dues preguntes que es fan sempre: «què hi ha en aquest àmbit aquests dies» i «què hi
  // ha d'aquesta tasca».
  await sql
    .raw('CREATE INDEX idx_sessions_scope ON task_sessions(scope_id, started_at)')
    .execute(db);
  await sql.raw('CREATE INDEX idx_sessions_task ON task_sessions(task_id)').execute(db);
  // Parcial: les obertes són poques i es busquen a cada moviment de targeta.
  await sql
    .raw('CREATE INDEX idx_sessions_open ON task_sessions(task_id) WHERE ended_at IS NULL')
    .execute(db);

  const F = engine === 'postgres' ? 'false' : '0';
  const T = engine === 'postgres' ? 'true' : '1';

  await sql
    .raw(
      `CREATE TABLE scope_settings (
        scope_id           ${t.text} PRIMARY KEY NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
        time_tracking      ${t.bool} NOT NULL DEFAULT ${F},
        work_start         ${t.text} NOT NULL DEFAULT '09:00',
        work_end           ${t.text} NOT NULL DEFAULT '18:00',
        /* Dilluns a divendres, com a cadena de set caràcters començant en dilluns: es llegeix
           d'un cop d'ull en un bolcat de la base, cosa que una màscara de bits no fa. */
        work_days          ${t.text} NOT NULL DEFAULT '1111100',
        overtime_visible   ${t.bool} NOT NULL DEFAULT ${T},
        long_session_hours ${t.int} NOT NULL DEFAULT 8,
        project_noun       ${t.text} NOT NULL DEFAULT 'project'
                           CHECK (project_noun IN ('project','client')),
        task_types_enabled ${t.bool} NOT NULL DEFAULT ${F},
        task_type_required ${t.bool} NOT NULL DEFAULT ${F},
        created_at         ${t.instant} NOT NULL,
        updated_at         ${t.instant} NOT NULL
      )`,
    )
    .execute(db);

  await sql
    .raw(
      `CREATE TABLE task_types (
        id         ${t.text} PRIMARY KEY NOT NULL,
        scope_id   ${t.text} NOT NULL REFERENCES scopes(id),
        name       ${t.text} NOT NULL,
        color      ${t.text} NOT NULL,
        position   ${t.text} NOT NULL ${t.binaryCollate},
        created_at ${t.instant} NOT NULL,
        updated_at ${t.instant} NOT NULL,
        deleted_at ${t.instant},
        UNIQUE (scope_id, name)
      )`,
    )
    .execute(db);

  await sql
    .raw(
      `ALTER TABLE tasks ADD COLUMN task_type_id ${t.text}
       REFERENCES task_types(id) ON DELETE SET NULL`,
    )
    .execute(db);
}

export async function down(db: MigrationDb, engine: Engine): Promise<void> {
  await sql.raw('ALTER TABLE tasks DROP COLUMN task_type_id').execute(db);
  await sql.raw('DROP TABLE task_types').execute(db);
  await sql.raw('DROP TABLE scope_settings').execute(db);
  await sql.raw('DROP TABLE task_sessions').execute(db);
  void engine;
}
