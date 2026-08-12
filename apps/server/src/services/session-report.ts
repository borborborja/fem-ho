/**
 * El Registre: què s'ha fet, quan, per a qui i quanta estona.
 *
 * **ELS CÀLCULS SÓN DEL SERVIDOR.** L'eina que això substitueix baixa la taula sencera al
 * navegador i hi fa els totals amb `reduce`: va bé fins que una casa té tres anys de feina a
 * dins. Aquí es filtra i se suma a la base, i el que viatja és el que es pinta.
 *
 * **UN BLOC ÉS DEL DIA QUE COMENÇA.** El que va de 23:30 a 00:30 surt al dia d'ahir, sencer.
 * L'alternativa —partir-lo— faria que la taula tingués files que ningú ha treballat i que el
 * cronograma hagués de tornar-les a cosir. Les hores extres sí que es reparteixen bé, perquè
 * això es calcula del bloc i no del dia (`policy/work-hours.ts`).
 *
 * **QUI VEU QUÈ.** Cadascú els seus blocs; qui té l'acció `reports` a l'àmbit —el propietari,
 * i l'administrador quan n'hi hagi— els de tothom. No és una preferència de la pantalla: el
 * filtre viu a la consulta, perquè un filtre de pantalla és un filtre que algú es deixa.
 */

import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { missingCapability } from '../policy/errors.js';
import { roleCan } from '../policy/scope-roles.js';
import { needsReview, splitWorkTime } from '../policy/work-hours.js';
import { localDateOf, localDayBounds } from '../time/local-day.js';
import { roleOf } from '../policy/scope-visibility.js';
import { listScopes } from './scopes.js';
import { settingsOfMany } from './scope-settings.js';

export interface SessionFilters {
  /** Dates locals `YYYY-MM-DD`, incloses les dues. */
  from?: string | undefined;
  to?: string | undefined;
  scopeIds?: string[] | undefined;
  /** `'none'` són les tasques sense projecte: l'espai general de l'àmbit. */
  projectId?: string | undefined;
  userId?: string | undefined;
  taskTypeId?: string | undefined;
  search?: string | undefined;
  timezone: string;
}

export interface SessionEntry {
  id: string;
  task_id: string;
  task_title: string;
  scope_id: string;
  project_id: string | null;
  project_name: string | null;
  task_type_id: string | null;
  task_type_name: string | null;
  task_type_color: string | null;
  user_id: string;
  user_name: string | null;
  started_at: string;
  ended_at: string | null;
  /** Minuts del bloc. En un d'obert, els que porta fins ara. */
  minutes: number;
  /** Dels minuts, quants cauen fora de l'horari de l'àmbit. */
  overtime_minutes: number;
  /** Si passa del llindar de l'àmbit i val la pena mirar-se'l. */
  needs_review: boolean;
  /** Cert mentre la tasca s'estigui fent. */
  open: boolean;
  source: string;
}

export interface Bucket {
  key: string;
  label: string;
  minutes: number;
  overtime_minutes: number;
}

export interface SessionReport {
  data: SessionEntry[];
  totals: {
    minutes: number;
    overtime_minutes: number;
    /** Tasques diferents, no blocs: és el que diu «25 tasques» a la capçalera. */
    tasks: number;
    by_user: Bucket[];
    by_project: Bucket[];
    by_day: Bucket[];
  };
}

interface Row {
  id: string;
  task_id: string;
  task_title: string;
  scope_id: string;
  project_id: string | null;
  project_name: string | null;
  task_type_id: string | null;
  task_type_name: string | null;
  task_type_color: string | null;
  user_id: string;
  user_name: string | null;
  started_at: string;
  ended_at: string | null;
  source: string;
}

/**
 * Els blocs que es poden veure, ja resolts amb el nom de tot.
 *
 * Torna també els totals que pinta la capçalera —per persona, per projecte i per dia—,
 * perquè són els mateixos blocs sumats i demanar-los a part seria fer dues vegades la
 * mateixa consulta amb el risc que un dia no diguin el mateix.
 */
export async function sessionReport(
  db: MigrationDb,
  principal: Principal,
  filters: SessionFilters,
): Promise<SessionReport> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const visibles = (await listScopes(db, principal)).map((scope) => scope.id);
  const abast =
    filters.scopeIds === undefined
      ? visibles
      : visibles.filter((id) => filters.scopeIds?.includes(id));

  const buit: SessionReport = {
    data: [],
    totals: { minutes: 0, overtime_minutes: 0, tasks: 0, by_user: [], by_project: [], by_day: [] },
  };
  if (abast.length === 0) return buit;

  const settings = await settingsOfMany(db, abast);
  // Els àmbits amb registre encès. Els altres no en tenen, de blocs, però la consulta seria
  // igual de vàlida: es filtren aquí perquè el que no s'ensenya no viatgi.
  const ambRegistre = abast.filter((id) => settings.get(id)?.time_tracking === true);
  if (ambRegistre.length === 0) return buit;

  /**
   * On es pot veure la dedicació de tothom, i on només la pròpia. Es resol **abans** de la
   * consulta i entra al `WHERE`: un filtre que es fes després seria un filtre que algú es
   * deixa el dia que copiï la funció.
   */
  const senseLimit: string[] = [];
  for (const scopeId of ambRegistre) {
    const role = await roleOf(db, principal.userId, scopeId);
    if (role !== null && roleCan(role, 'reports')) senseLimit.push(scopeId);
  }

  const finestra = window(filters);

  const rows = await sql<Row>`
    SELECT s.id, s.task_id, t.title AS task_title, s.scope_id, t.project_id,
           p.name AS project_name, t.task_type_id, tt.name AS task_type_name,
           tt.color AS task_type_color, s.user_id, u.name AS user_name,
           s.started_at, s.ended_at, s.source
    FROM task_sessions s
    JOIN tasks t ON t.id = s.task_id AND t.deleted_at IS NULL
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN task_types tt ON tt.id = t.task_type_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.deleted_at IS NULL
      AND s.scope_id IN (${sql.join(ambRegistre)})
      AND (${
        senseLimit.length === 0
          ? sql`s.user_id = ${principal.userId}`
          : sql`s.scope_id IN (${sql.join(senseLimit)}) OR s.user_id = ${principal.userId}`
      })
      ${finestra.from === undefined ? sql`` : sql`AND s.started_at >= ${finestra.from}`}
      ${finestra.to === undefined ? sql`` : sql`AND s.started_at < ${finestra.to}`}
      ${filters.userId === undefined ? sql`` : sql`AND s.user_id = ${filters.userId}`}
      ${
        filters.projectId === undefined
          ? sql``
          : filters.projectId === 'none'
            ? sql`AND t.project_id IS NULL`
            : sql`AND t.project_id = ${filters.projectId}`
      }
      ${filters.taskTypeId === undefined ? sql`` : sql`AND t.task_type_id = ${filters.taskTypeId}`}
      ${searchFilter(filters.search)}
    ORDER BY s.started_at DESC, s.id DESC
    LIMIT 2000
  `.execute(db);

  const ara = new Date().toISOString();
  const data = rows.rows.map((row) => enrich(row, filters.timezone, settings, ara));

  return { data, totals: totals(data, filters.timezone) };
}

/** Els límits UTC de la finestra demanada, al fus de qui mira. */
function window(filters: SessionFilters): { from?: string; to?: string } {
  return {
    ...(filters.from === undefined
      ? {}
      : { from: localDayBounds(filters.timezone, filters.from).startUTC }),
    // El `to` és inclusiu per a qui el llegeix: el dia que es demana hi entra sencer.
    ...(filters.to === undefined
      ? {}
      : { to: localDayBounds(filters.timezone, filters.to).endUTC }),
  };
}

function searchFilter(search: string | undefined): ReturnType<typeof sql> {
  const net = (search ?? '').trim().toLowerCase();
  if (net === '') return sql``;
  return sql`AND LOWER(t.title) LIKE ${`%${net}%`}`;
}

function enrich(
  row: Row,
  timezone: string,
  settings: Map<
    string,
    { work_start: string; work_end: string; work_days: string; long_session_hours: number }
  >,
  now: string,
): SessionEntry {
  const config = settings.get(row.scope_id);
  const fins = row.ended_at ?? now;
  const split = splitWorkTime(
    { startedAt: row.started_at, endedAt: fins },
    {
      start: config?.work_start ?? '09:00',
      end: config?.work_end ?? '18:00',
      days: config?.work_days ?? '1111100',
    },
    timezone,
  );

  return {
    ...row,
    minutes: split.total,
    overtime_minutes: split.overtime,
    needs_review: needsReview(split.total, config?.long_session_hours ?? 8),
    open: row.ended_at === null,
  };
}

function totals(data: SessionEntry[], timezone: string): SessionReport['totals'] {
  const perUser = new Map<string, Bucket>();
  const perProject = new Map<string, Bucket>();
  const perDay = new Map<string, Bucket>();
  const tasques = new Set<string>();

  let minutes = 0;
  let overtime = 0;

  for (const entry of data) {
    minutes += entry.minutes;
    overtime += entry.overtime_minutes;
    tasques.add(entry.task_id);

    add(perUser, entry.user_id, entry.user_name ?? '', entry);
    // Sense projecte, la clau és `none` i no una cadena buida: és el mateix que fa el
    // filtre, i així «l'espai general» té nom a tot arreu.
    add(perProject, entry.project_id ?? 'none', entry.project_name ?? '', entry);
    const dia = localDateOf(timezone, new Date(entry.started_at));
    add(perDay, dia, dia, entry);
  }

  const ordenat = (per: Map<string, Bucket>): Bucket[] =>
    [...per.values()].sort((a, b) => b.minutes - a.minutes);

  return {
    minutes,
    overtime_minutes: overtime,
    tasks: tasques.size,
    by_user: ordenat(perUser),
    by_project: ordenat(perProject),
    // Els dies, del més recent al més antic: és l'ordre en què es llegeix la taula.
    by_day: [...perDay.values()].sort((a, b) => (a.key < b.key ? 1 : -1)),
  };
}

function add(per: Map<string, Bucket>, key: string, label: string, entry: SessionEntry): void {
  const bucket = per.get(key) ?? { key, label, minutes: 0, overtime_minutes: 0 };
  bucket.minutes += entry.minutes;
  bucket.overtime_minutes += entry.overtime_minutes;
  per.set(key, bucket);
}
