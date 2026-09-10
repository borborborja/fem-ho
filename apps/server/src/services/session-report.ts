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
import { missingCapability, PolicyError } from '../policy/errors.js';
import { canEditSession, canReadOthersSessions } from '../policy/session-writes.js';
import { type ScopeRole } from '../policy/scope-roles.js';
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
  projectIds?: string[] | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  userId?: string | undefined;
  taskTypeId?: string | undefined;
  search?: string | undefined;
  timezone: string;
}

export interface SessionEntry {
  version: number;
  can_edit: boolean;
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
  writable_scope_ids?: string[];
  data: SessionEntry[];
  next_cursor?: string | null;
  generated_at?: string | undefined;
  open_sessions?: number | undefined;
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
  version: number;
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
  const roles = new Map<string, ScopeRole | null>();
  for (const scopeId of ambRegistre) {
    const role = await roleOf(db, principal.userId, scopeId);
    roles.set(scopeId, role);
    if (canReadOthersSessions(role)) senseLimit.push(scopeId);
  }

  const finestra = window(filters);

  const ara = new Date().toISOString();
  const entries: SessionEntry[] = [];
  let after: { started_at: string; id: string } | undefined;
  // Els lots limiten la lectura, mai el període ni els totals de l'informe.
  for (;;) {
    const rows = await sql<Row>`
    SELECT s.id, s.task_id, t.title AS task_title, s.scope_id, t.project_id,
           p.name AS project_name, t.task_type_id, tt.name AS task_type_name,
           tt.color AS task_type_color, s.user_id, u.name AS user_name,
           s.started_at, s.ended_at, s.source, s.version
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
      ${filters.projectIds === undefined ? sql`` : sql`AND (t.project_id IN (${sql.join(filters.projectIds)}) ${filters.projectIds.includes('none') ? sql`OR t.project_id IS NULL` : sql``})`}
      ${filters.taskTypeId === undefined ? sql`` : filters.taskTypeId === 'none' ? sql`AND t.task_type_id IS NULL` : sql`AND t.task_type_id = ${filters.taskTypeId}`}
      ${after === undefined ? sql`` : sql`AND (s.started_at < ${after.started_at} OR (s.started_at = ${after.started_at} AND s.id < ${after.id}))`}
      ${searchFilter(filters.search)}
    ORDER BY s.started_at DESC, s.id DESC
    LIMIT 500
  `.execute(db);

    entries.push(
      ...rows.rows.map((row) => ({
        ...enrich(row, filters.timezone, settings, ara),
        can_edit: canEditSession(principal, roles.get(row.scope_id) ?? null, row.user_id),
      })),
    );
    after = rows.rows.at(-1);
    if (rows.rows.length < 500) break;
  }
  // El cursor porta la posició, no depèn que el bloc anterior continuï existint.
  let offset = 0;
  if (filters.cursor !== undefined && filters.limit !== undefined) {
    const [startedAt, id] = filters.cursor.split('|');
    if (!startedAt || !id || !Number.isFinite(Date.parse(startedAt))) {
      throw new PolicyError(
        'invalid-report-filter',
        'Invalid report filter',
        400,
        'Invalid session cursor.',
      );
    }
    const index = entries.findIndex(
      (row) => row.started_at < startedAt || (row.started_at === startedAt && row.id < id),
    );
    offset = index < 0 ? entries.length : index;
  }
  const data =
    filters.limit === undefined ? entries : entries.slice(offset, offset + filters.limit);
  return {
    data,
    writable_scope_ids: ambRegistre.filter((id) =>
      canEditSession(principal, roles.get(id) ?? null, principal.userId),
    ),
    totals: totals(entries, filters.timezone),
    generated_at: ara,
    open_sessions: entries.filter((row) => row.open).length,
    next_cursor:
      filters.limit !== undefined && offset + data.length < entries.length
        ? `${data.at(-1)!.started_at}|${data.at(-1)!.id}`
        : null,
  };
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
): Omit<SessionEntry, 'can_edit'> {
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

export interface StatsPoint {
  /** `YYYY-MM-DD`: el dia, o el primer dia de la setmana quan s'agrupa. */
  key: string;
  minutes: number;
}

export interface SessionStats {
  generated_at?: string | undefined;
  open_sessions?: number | undefined;
  tasks: number;
  minutes: number;
  overtime_minutes: number;
  projects: number;
  /** Minuts per tasca, no per bloc ni per dia. `0` si no hi ha res. */
  average_minutes: number;
  /** Per dia, o per setmana si el rang passa dels 70 dies. */
  evolution: StatsPoint[];
  /** Cert si l'evolució està agrupada per setmanes. */
  weekly: boolean;
  by_type: Bucket[];
  by_project: Bucket[];
  by_user: Bucket[];
  /** Les hores extres, per projecte: per saber per a qui s'han fet. */
  overtime_by_project: Bucket[];
}

/**
 * A partir d'aquí, un punt per setmana.
 *
 * Amb un any de punts diaris el gràfic és una tanca i no s'hi llegeix cap tendència. El
 * llindar és el mateix de l'eina que això substitueix, i s'hi arriba pel mateix camí: un
 * trimestre encara es llegeix dia a dia, un any no.
 */
const DIES_PER_SETMANES = 70;

/**
 * Les Estadístiques: els mateixos blocs, mirats de lluny.
 *
 * Passa pel mateix `sessionReport` —els mateixos filtres, la mateixa visibilitat— perquè el
 * dia que un número no quadri amb el Registre, la culpa sigui d'una sola consulta i no de
 * dues que s'assemblen.
 */
export async function sessionStats(
  db: MigrationDb,
  principal: Principal,
  filters: SessionFilters,
): Promise<SessionStats> {
  const report = await sessionReport(db, principal, {
    ...filters,
    limit: undefined,
    cursor: undefined,
  });
  const { data, totals } = report;

  const perTipus = new Map<string, Bucket>();
  const extresPerProjecte = new Map<string, Bucket>();
  for (const entry of data) {
    // «Sense tipologia» és una fila més i no un forat: compta als totals i s'ha de poder
    // veure quant pesa, que és el que fa que algú es decideixi a classificar-ho.
    add(perTipus, entry.task_type_id ?? 'none', entry.task_type_name ?? '', entry);
    if (entry.overtime_minutes > 0) {
      add(extresPerProjecte, entry.project_id ?? 'none', entry.project_name ?? '', entry);
    }
  }

  return {
    generated_at: report.generated_at,
    open_sessions: report.open_sessions,
    tasks: totals.tasks,
    minutes: totals.minutes,
    overtime_minutes: totals.overtime_minutes,
    projects: totals.by_project.filter((bucket) => bucket.key !== 'none').length,
    average_minutes: totals.tasks === 0 ? 0 : Math.round(totals.minutes / totals.tasks),
    ...evolution(data, filters),
    by_type: [...perTipus.values()].sort((a, b) => b.minutes - a.minutes),
    by_project: totals.by_project,
    by_user: totals.by_user,
    overtime_by_project: [...extresPerProjecte.values()].sort(
      (a, b) => b.overtime_minutes - a.overtime_minutes,
    ),
  };
}

/**
 * L'evolució, **amb els dies buits inclosos**.
 *
 * Un gràfic que només porta els dies amb feina menteix: dues barres seguides poden ser dilluns
 * i divendres, i la línia que les uneix insinua una continuïtat que no hi va ser. Els dies a
 * zero són informació.
 */
function evolution(
  data: SessionEntry[],
  filters: SessionFilters,
): { evolution: StatsPoint[]; weekly: boolean } {
  if (data.length === 0) return { evolution: [], weekly: false };

  const perDia = new Map<string, number>();
  for (const entry of data) {
    const dia = localDateOf(filters.timezone, new Date(entry.started_at));
    perDia.set(dia, (perDia.get(dia) ?? 0) + entry.minutes);
  }

  const dies = [...perDia.keys()].sort();
  const desde = filters.from ?? dies[0] ?? '';
  const fins = filters.to ?? dies[dies.length - 1] ?? '';
  if (desde === '' || fins === '') return { evolution: [], weekly: false };

  const span = Math.round((Date.parse(fins) - Date.parse(desde)) / 86_400_000) + 1;
  const weekly = span > DIES_PER_SETMANES;
  const step = weekly ? 7 : 1;
  const points: StatsPoint[] = [];
  for (let offset = 0; offset < span; offset += step) {
    const key = new Date(Date.parse(desde) + offset * 86_400_000).toISOString().slice(0, 10);
    let minutes = 0;
    for (let d = 0; d < step && offset + d < span; d++) {
      const day = new Date(Date.parse(desde) + (offset + d) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      minutes += perDia.get(day) ?? 0;
    }
    points.push({ key, minutes });
  }
  return { evolution: points, weekly };
}
