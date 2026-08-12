/**
 * La configuració de comportament d'un àmbit: llegir-la i desar-la.
 *
 * La decisió de què val quan no hi ha res dit és a `policy/scope-settings.ts`; això és el
 * tros que toca la base. La fila s'escriu **la primera vegada que algú canvia alguna cosa**
 * (`upsert`), no en crear l'àmbit: així els àmbits que ja existien no en tenen cap i el
 * comportament de tots dos casos és exactament el mateix.
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import { dbBool } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';
import {
  DEFAULT_SCOPE_SETTINGS,
  resolveScopeSettings,
  sanitizeScopeSettings,
  type ScopeSettings,
} from '../policy/scope-settings.js';
import { assertScopeRole } from './scopes.js';

const COLUMNS = sql`
  scope_id, time_tracking, work_start, work_end, work_days, overtime_visible,
  long_session_hours, project_noun, task_types_enabled, task_type_required
`;

type Row = { scope_id: string } & Partial<Record<keyof ScopeSettings, unknown>>;

/** La configuració viva d'un àmbit. */
export async function settingsOf(db: MigrationDb, scopeId: string): Promise<ScopeSettings> {
  const found = await sql<Row>`
    SELECT ${COLUMNS} FROM scope_settings WHERE scope_id = ${scopeId}
  `.execute(db);
  return resolveScopeSettings(found.rows[0]);
}

/**
 * La de molts àmbits alhora, en **una** consulta.
 *
 * El Registre pot creuar diversos àmbits actius i la barra en pinta els xips: preguntar-ho
 * un per un seria una consulta per xip cada vegada que es repinta.
 */
export async function settingsOfMany(
  db: MigrationDb,
  scopeIds: string[],
): Promise<Map<string, ScopeSettings>> {
  const per = new Map<string, ScopeSettings>();
  for (const id of scopeIds) per.set(id, { ...DEFAULT_SCOPE_SETTINGS });
  if (scopeIds.length === 0) return per;

  const found = await sql<Row>`
    SELECT ${COLUMNS} FROM scope_settings WHERE scope_id IN (${sql.join(scopeIds)})
  `.execute(db);
  for (const row of found.rows) per.set(row.scope_id, resolveScopeSettings(row));
  return per;
}

/**
 * Desa el que s'entengui i torna la configuració resultant.
 *
 * Demana l'acció `settings` de l'àmbit: qui pot canviar-ne el nom i el color pot dir com es
 * comporta. Amb el rol d'administrador (fase C-E) això inclou qui el propietari hi hagi posat.
 */
export async function updateScopeSettings(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  input: Record<string, unknown>,
): Promise<ScopeSettings> {
  await assertScopeRole(ctx.tx, principal, scopeId, 'settings');

  const abans = await settingsOf(ctx.tx, scopeId);
  const canvis = sanitizeScopeSettings(input);
  const despres: ScopeSettings = { ...abans, ...canvis };

  await sql`
    INSERT INTO scope_settings
      (scope_id, time_tracking, work_start, work_end, work_days, overtime_visible,
       long_session_hours, project_noun, task_types_enabled, task_type_required,
       created_at, updated_at)
    VALUES
      (${scopeId}, ${dbBool(despres.time_tracking)}, ${despres.work_start}, ${despres.work_end},
       ${despres.work_days}, ${dbBool(despres.overtime_visible)}, ${despres.long_session_hours},
       ${despres.project_noun}, ${dbBool(despres.task_types_enabled)},
       ${dbBool(despres.task_type_required)}, ${ctx.now}, ${ctx.now})
    ON CONFLICT (scope_id) DO UPDATE SET
      time_tracking = ${dbBool(despres.time_tracking)},
      work_start = ${despres.work_start},
      work_end = ${despres.work_end},
      work_days = ${despres.work_days},
      overtime_visible = ${dbBool(despres.overtime_visible)},
      long_session_hours = ${despres.long_session_hours},
      project_noun = ${despres.project_noun},
      task_types_enabled = ${dbBool(despres.task_types_enabled)},
      task_type_required = ${dbBool(despres.task_type_required)},
      updated_at = ${ctx.now}
  `.execute(ctx.tx);

  /**
   * A l'historial hi va **el que ha canviat de debò**, camp per camp. Un «ha canviat els
   * ajustos» sense dir quins no serveix el dia que algú pregunti des de quan es compten les
   * hores extres d'una altra manera.
   */
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(canvis) as (keyof ScopeSettings)[]) {
    if (abans[key] !== despres[key]) changes[key] = { from: abans[key], to: despres[key] };
  }

  if (Object.keys(changes).length === 0) {
    ctx.noChange();
  } else {
    ctx.record({ entityType: 'scope', entityId: scopeId, scopeId, verb: 'updated', changes });
  }

  return despres;
}
