/**
 * Servei de tasques. docs/01 §4, docs/05 §4.
 *
 * La invariant central del producte viu aquí: **una tasca sempre té àmbit**. Pot no
 * tenir projecte, però mai no tenir àmbit. Ho vigila la base amb `NOT NULL` i ho vigila
 * aquesta capa amb un error que ho explica, perquè un `NOT NULL` no diu res útil a qui
 * el rep.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import {
  TASK_STATUSES,
  generatePosition,
  type SourceKind,
  type TaskStatus,
} from '@fem-ho/contracts';
import { dbBool, isTrue } from '../db/bool.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import type { Mailbox } from '../policy/mailbox.js';
import { visibleScopesPredicate } from '../policy/scope-visibility.js';
import { normalizeForSearch, normalizeQuery } from '../text/search-text.js';
import { clampInt } from '../util/clamp.js';
import { localDayBounds } from '../time/local-day.js';
import { listInboxEvents, type InboxEvent } from './events.js';
import { listInboxMail, type InboxMail } from './mail.js';
import { refusalError, refuseTaskWrite, type WriteIntent } from '../policy/ai-writes.js';
import { clearAttention } from './attention.js';
import { closeSession, openSession } from './sessions.js';
import { leaseOf, releaseIfHeld } from './leases.js';
import { assertScopeAccess, listScopes } from './scopes.js';

export interface TaskRow {
  id: string;
  scope_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  position: string;
  due_date: string | null;
  due_time: string | null;
  deadline: string | null;
  completed_at: string | null;
  view_mode: 'card' | 'simple';
  ai_mode: 'manual' | 'assisted' | 'delegated';
  delegate_agent_id: string | null;
  /** RFC 5545, o `null` si no es repeteix. */
  rrule: string | null;
  /** `schedule` compta des del venciment; `completion`, des que es fa (docs/01 §4). */
  recurrence_mode: 'schedule' | 'completion' | null;
  recurrence_parent_id: string | null;
  /**
   * De quina mena de font ve, o `null` si l'has escrita tu.
   *
   * **Una sola pregunta i una sola resposta.** Les referències específiques —`event_*`,
   * i demà les del correu— diuen *quin* origen concret; això diu *quina mena*, que és el
   * que necessita qui pinta la icona i el que fa que afegir una font nova no obligui a
   * mirar una columna més.
   */
  source_kind: SourceKind | null;
  /**
   * Si un agent espera resposta teva **ara**.
   *
   * Viu a la tasca i no al comentari que la pregunta: «quines esperen resposta» és el que
   * ha de poder respondre el tauler sense llegir els comentaris de tres-centes targetes.
   */
  needs_attention: boolean;
  /** Des de quan. Una pregunta de fa deu minuts i una de fa tres dies no diuen el mateix. */
  attention_asked_at: string | null;
  /**
   * L'última cosa que li ha passat, sigui qui sigui qui la va fer.
   *
   * **No és `updated_at`**: aquell és l'última escriptura a la fila i no veu el que passa
   * al voltant —un comentari, una reserva, una pregunta—. Això és el que fa que la targeta
   * pugui dir «fa 5 min» o «fa tres dies», que és la diferència entre un agent que hi
   * treballa i un que no hi és.
   */
  last_activity_at: string | null;
  /** Quan un agent la va llegir per última vegada, i quin. `null` si cap. */
  ai_last_read_at: string | null;
  ai_last_read_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface Task extends TaskRow {
  assignee_ids: string[];
  /**
   * Subtasques i ítems de llista, comptats junts.
   *
   * La targeta els ensenya sota **un sol** commutador —"3/7 fets"— perquè per a qui
   * mira el tauler són el mateix: coses que falten dins d'aquesta tasca. La distinció
   * entre subtasca i llista només importa en obrir-la.
   *
   * Va al tauler com a agregat i no com a llista: portar tots els ítems de totes les
   * targetes faria que una casa amb tres-centes tasques baixés uns quants milers de
   * files per pintar unes quantes pastilles.
   */
  progress: { done: number; total: number; lists: number };
  /**
   * Fins quan està bloquejada, o `null` si no ho està.
   *
   * **No és una columna de `tasks`**: és la reserva viva (`task_leases`), que ja existia per
   * evitar que dos agents fessin la mateixa feina. El que hi ha de nou és que es vegi: una
   * targeta que no diu que hi ha un agent a dins convida a endur-se-la, i llavors l'agent
   * segueix treballant contra una cosa que ja no és allà.
   */
  locked_until: string | null;
  /** Quin agent la té. `null` amb `locked_until` ple vol dir que la té una persona. */
  locked_by_agent_id: string | null;
}

const TASK_COLUMNS = sql`
  id, scope_id, project_id, title, description, status, position, due_date, due_time,
  deadline, completed_at, view_mode, ai_mode, delegate_agent_id,
  rrule, recurrence_mode, recurrence_parent_id, source_kind,
  needs_attention, attention_asked_at, last_activity_at, ai_last_read_at, ai_last_read_by,
  created_by,
  created_at, updated_at, version
`;

async function withAssignees(db: MigrationDb, rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const links = await sql<{ task_id: string; user_id: string }>`
    SELECT task_id, user_id FROM task_assignees WHERE task_id IN (${sql.join(ids)})
  `.execute(db);

  const byTask = new Map<string, string[]>();
  for (const link of links.rows) {
    const list = byTask.get(link.task_id) ?? [];
    list.push(link.user_id);
    byTask.set(link.task_id, list);
  }

  /**
   * El recompte, en **una** consulta per a tot el tauler i no una per targeta.
   *
   * Subtasques i ítems de llista se sumen: la targeta els ensenya sota un sol
   * commutador. `UNION ALL` i no dues consultes perquè el motor les recorre alhora.
   */
  const progress = await sql<{ task_id: string; done: number; total: number }>`
    SELECT task_id, SUM(done) AS done, COUNT(*) AS total FROM (
      SELECT s.task_id AS task_id, CASE WHEN s.done = ${dbBool(true)} THEN 1 ELSE 0 END AS done
      FROM subtasks s
      WHERE s.deleted_at IS NULL AND s.task_id IN (${sql.join(ids)})
      UNION ALL
      SELECT c.task_id AS task_id, CASE WHEN i.done = ${dbBool(true)} THEN 1 ELSE 0 END AS done
      FROM checklist_items i
      JOIN checklists c ON c.id = i.checklist_id AND c.deleted_at IS NULL
      WHERE i.deleted_at IS NULL AND c.task_id IN (${sql.join(ids)})
    ) AS tot
    GROUP BY task_id
  `.execute(db);

  /**
   * I quants **blocs** hi ha, que no és el mateix que quants ítems.
   *
   * El commutador de la targeta diu "Llistes (2)": les subtasques compten com un bloc
   * —totes juntes, sense nom— i cada llista com un altre. Sense aquest número, saber-lo
   * obligaria a baixar les llistes de cada targeta, que és justament el que l'agregat
   * evita.
   */
  const blocks = await sql<{ task_id: string; lists: number }>`
    SELECT task_id, SUM(n) AS lists FROM (
      SELECT DISTINCT task_id, 1 AS n FROM subtasks
      WHERE deleted_at IS NULL AND task_id IN (${sql.join(ids)})
      UNION ALL
      SELECT task_id, 1 AS n FROM checklists
      WHERE deleted_at IS NULL AND task_id IN (${sql.join(ids)})
    ) AS l
    GROUP BY task_id
  `.execute(db);

  /**
   * **Les etiquetes de cada tasca**, i pel mateix motiu que els assignats: sense saber
   * quines porta, la interfície no pot ensenyar quines hi són. La secció d'etiquetes de
   * la fitxa pintava totes les de l'àmbit exactament iguals —posades i no posades— i
   * l'única manera de treure'n una era clicar-la i esperar que el `POST` fallés.
   */
  const labelLinks = await sql<{ task_id: string; label_id: string }>`
    SELECT task_id, label_id FROM task_labels WHERE task_id IN (${sql.join(ids)})
  `.execute(db);
  const labelsByTask = new Map<string, string[]>();
  for (const link of labelLinks.rows) {
    const list = labelsByTask.get(link.task_id) ?? [];
    list.push(link.label_id);
    labelsByTask.set(link.task_id, list);
  }

  /**
   * **El pany.** Una consulta per a tot el tauler, com la resta: preguntar-ho targeta per
   * targeta serien tres-centes consultes per pintar uns quants cadenats.
   *
   * `new Date()` i no un instant que vingui de fora perquè això és un camí de lectura i no
   * en té cap: una reserva viva ho és **ara**, en el moment de mirar-la.
   */
  const ara = new Date().toISOString();
  const leases = await sql<{ task_id: string; agent_id: string | null; expires_at: string }>`
    SELECT task_id, agent_id, expires_at FROM task_leases
    WHERE task_id IN (${sql.join(ids)}) AND expires_at > ${ara}
  `.execute(db);
  const leaseByTask = new Map(leases.rows.map((row) => [row.task_id, row]));

  const listCounts = new Map(blocks.rows.map((row) => [row.task_id, Number(row.lists)]));
  const counts = new Map(
    progress.rows.map((row) => [row.task_id, { done: Number(row.done), total: Number(row.total) }]),
  );

  return rows.map((row) => ({
    ...row,
    // SQLite dona 0/1 i Postgres un booleà: qui ho llegeix ha de rebre sempre un booleà.
    needs_attention: isTrue(row.needs_attention),
    assignee_ids: (byTask.get(row.id) ?? []).sort(),
    label_ids: (labelsByTask.get(row.id) ?? []).sort(),
    locked_until: leaseByTask.get(row.id)?.expires_at ?? null,
    locked_by_agent_id: leaseByTask.get(row.id)?.agent_id ?? null,
    progress: {
      ...(counts.get(row.id) ?? { done: 0, total: 0 }),
      lists: listCounts.get(row.id) ?? 0,
    },
  }));
}

export async function getTask(db: MigrationDb, principal: Principal, id: string): Promise<Task> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const found = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('task', id);

  // L'abast es comprova SEMPRE, i l'error diu on és la tasca perquè qui el rebi pugui
  // corregir en comptes de reintentar (docs/05 §2).
  await assertScopeAccess(db, principal, row.scope_id, { type: 'La tasca', id });

  /**
   * **Que un agent l'ha llegida es guarda.** És el que respon «t'ha llegit la resposta?»
   * sense haver-li de preguntar, i és mitja explicació quan una tasca porta dies quieta.
   *
   * Va aquí, en un camí de lectura, i no és cap incoherència: `resolve.ts` ja fa el mateix
   * amb `api_tokens.last_used_at`. **No toca `updated_at` ni `version`**: llegir no és un
   * canvi de la tasca i no ha de viatjar pel sync ni marcar-la com a modificada. I no va a
   * l'historial perquè un agent que consulta cada minut hi deixaria mil files al dia i
   * taparia el que sí que va fer.
   */
  if (principal.kind === 'agent' && principal.agentId !== undefined) {
    const ara = new Date().toISOString();
    await sql`
      UPDATE tasks SET ai_last_read_at = ${ara}, ai_last_read_by = ${principal.agentId}
      WHERE id = ${id}
    `.execute(db);
    row.ai_last_read_at = ara;
    row.ai_last_read_by = principal.agentId;
  }

  const [task] = await withAssignees(db, [row]);
  if (task === undefined) throw notFound('task', id);
  return task;
}

export interface ListTasksFilters {
  scopeId?: string | undefined;
  projectId?: string | undefined;
  statuses?: TaskStatus[] | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  /** Text a buscar. Es normalitza igual que `search_text` (docs/01 §11). */
  search?: string | undefined;
  /**
   * Finestra de venciment, inclosa als dos extrems. `YYYY-MM-DD`.
   *
   * És el que el calendari necessita per ser **l'organitzador de la setmana o el mes**:
   * fins ara la graella només sabia d'esdeveniments i de correu, i una tasca amb data no
   * sortia enlloc del calendari —ni al mes, ni a la setmana, ni al dia—. Es filtra al
   * servidor i no al client perquè baixar totes les tasques per quedar-se amb les de
   * trenta dies és la mena de cosa que va bé fins que una casa en té dues mil.
   *
   * `due_date` és **data local sense fus** (docs/01 §11): la comparació és de text i és
   * correcta, i per això aquí no hi entra cap zona horària.
   */
  dueFrom?: string | undefined;
  dueTo?: string | undefined;
  /** Només les que esperen resposta. És el que compta el punt del commutador d'IA. */
  needsAttention?: boolean | undefined;
}

export interface TaskPage {
  data: Task[];
  next_cursor: string | null;
  has_more: boolean;
}

export async function listTasks(
  db: MigrationDb,
  principal: Principal,
  filters: ListTasksFilters = {},
): Promise<TaskPage> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const scopes = await listScopes(db, principal);
  const allowed = scopes
    .map((s) => s.id)
    .filter((id) => filters.scopeId === undefined || id === filters.scopeId);
  if (allowed.length === 0) return { data: [], next_cursor: null, has_more: false };

  const statuses = filters.statuses ?? [...TASK_STATUSES];
  // Paginació per cursor i no per desplaçament: amb dades que canvien, el desplaçament
  // es salta i repeteix files (docs/05 §3).
  const limit = clampInt(filters.limit, { min: 1, max: 200, fallback: 50 });
  const cursor = decodeTaskCursor(filters.cursor);

  const rows = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks
    WHERE deleted_at IS NULL
      AND scope_id IN (${sql.join(allowed)})
      AND status IN (${sql.join(statuses)})
      ${filters.projectId === undefined ? sql`` : sql`AND project_id = ${filters.projectId}`}
      ${filters.dueFrom === undefined ? sql`` : sql`AND due_date >= ${filters.dueFrom}`}
      ${filters.dueTo === undefined ? sql`` : sql`AND due_date <= ${filters.dueTo}`}
      ${filters.needsAttention === true ? sql`AND needs_attention = ${dbBool(true)}` : sql``}
      ${
        cursor === null
          ? sql``
          : sql`AND (position > ${cursor.position}
                     OR (position = ${cursor.position} AND id > ${cursor.id}))`
      }
      ${searchFilter(filters.search)}
    ORDER BY position, id
    LIMIT ${limit + 1}
  `.execute(db);

  const hasMore = rows.rows.length > limit;
  const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
  const last = page[page.length - 1];

  return {
    data: await withAssignees(db, page),
    next_cursor: hasMore && last !== undefined ? encodeTaskCursor(last) : null,
    has_more: hasMore,
  };
}

/**
 * El cursor porta la posició **i** l'identificador.
 *
 * Amb només la posició, dues files que la comparteixen —cosa que el jitter fa
 * improbable però no impossible (D3)— es parteixen entre pàgines i la segona no
 * apareix mai: `position > cursor` la deixa fora i `>=` repetiria la primera. La
 * parella `(position, id)` sí que és única, perquè `id` ho és.
 *
 * El separador és `|`, que no és cap dígit de l'alfabet de posicions.
 */
function encodeTaskCursor(row: TaskRow): string {
  return `${row.position}|${row.id}`;
}

function decodeTaskCursor(raw: string | undefined): { position: string; id: string } | null {
  if (raw === undefined || raw === '') return null;
  const cut = raw.indexOf('|');
  // Un cursor antic, sense identificador, encara ha de servir: es tracta com el primer
  // possible d'aquella posició.
  if (cut === -1) return { position: raw, id: '' };
  return { position: raw.slice(0, cut), id: raw.slice(cut + 1) };
}

/**
 * El filtre de text.
 *
 * Es compara contra `search_text`, que ja està normalitzat, amb la **mateixa** funció
 * que el va generar. Si la consulta es normalitzés diferent, la cerca fallaria
 * justament en les paraules que la normalització existeix per arreglar: "col·legi",
 * "Barça", "l'aigua".
 *
 * Cada paraula ha de sortir-hi: buscar "pa vi" no ha de trobar tot el que porti "pa".
 */
function searchFilter(search: string | undefined): ReturnType<typeof sql> {
  if (search === undefined || search.trim() === '') return sql``;

  const words = normalizeQuery(search)
    .split(' ')
    .filter((word) => word !== '');
  if (words.length === 0) return sql``;

  return sql`AND ${sql.join(
    words.map((word) => sql`search_text LIKE ${`%${word}%`}`),
    sql` AND `,
  )}`;
}

export interface CreateTaskInput {
  id?: string | undefined;
  scope_id?: string | undefined;
  project_id?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  status?: TaskStatus | undefined;
  position?: string | undefined;
  due_date?: string | undefined;
  due_time?: string | undefined;
  assignee_ids?: string[] | undefined;
  /**
   * De quin esdeveniment ve, si ve d'algun.
   *
   * **És una referència morta i no un enllaç viu.** P6 de `docs/14` ja ho va decidir: la
   * tasca neix independent. Un enllaç viu voldria dir que esborrar un esdeveniment d'un
   * calendari compartit esborrés en silenci la tasca que algú altre s'havia apuntat.
   * Serveix per saber d'on ve —i per decidir què passa amb la cita quan s'esborri la
   * tasca—, no per obeir-lo.
   */
  source_event?: { calendar_id: string; uid: string; recurrence_id?: string | null } | undefined;
}

/**
 * L'identificador de la família de bloqueigs de posició.
 *
 * `pg_advisory_xact_lock` amb dos arguments fa servir el primer com a espai de noms:
 * així els bloqueigs de posició no xoquen mai amb el del `change_log`, que en fa servir
 * un de sol.
 */
const POSITION_LOCK_ID = 851_002_027;

export async function createTask(
  ctx: AuditContext,
  principal: Principal,
  input: CreateTaskInput,
  engine: 'sqlite' | 'postgres' = 'sqlite',
): Promise<{ task: Task; created: boolean }> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  // La invariant central. L'error ho diu amb paraules perquè el 422 d'un NOT NULL de la
  // base no li serveix de res a ningú.
  if (input.scope_id === undefined || input.scope_id === '') {
    throw new PolicyError(
      'scope-required',
      'Scope required',
      422,
      'A task always has to have a scope. It can have no project, but never no scope.',
    );
  }
  if (input.title === undefined || input.title.trim() === '') {
    throw new PolicyError('title-required', 'Title required', 422, 'La tasca necessita un títol.');
  }

  const scope = await assertScopeAccess(ctx.tx, principal, input.scope_id);
  const id = input.id ?? uuidv7();

  const existing = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
  `.execute(ctx.tx);
  const already = existing.rows[0];
  if (already !== undefined) {
    ctx.noChange();
    const [task] = await withAssignees(ctx.tx, [already]);
    return { task: task!, created: false };
  }

  /**
   * Si ve d'un esdeveniment, dues invariants abans de res.
   *
   * L'àmbit ha de ser el del calendari: una tasca de la família feta a partir d'una cita
   * de la feina seria una cita que desapareix de la bústia d'un àmbit i una tasca que
   * apareix a un altre, i ningú relacionaria les dues coses. I no n'hi pot haver dues
   * vives de la mateixa cita: si no, la cita marxaria de la bústia i tornaria segons
   * quina de les dues s'esborrés primer.
   */
  let sourceKind: SourceKind | null = null;
  if (input.source_event !== undefined) {
    const cal = await sql<{ scope_id: string; source_kind: SourceKind | null }>`
      SELECT scope_id, source_kind FROM calendars
      WHERE id = ${input.source_event.calendar_id} AND deleted_at IS NULL
    `.execute(ctx.tx);
    const calScope = cal.rows[0]?.scope_id;
    if (calScope === undefined) throw notFound('calendar', input.source_event.calendar_id);
    /**
     * La mena surt del calendari i no és una constant: una tasca feta des d'un `.ics`
     * publicat i una feta des d'un CalDAV bidireccional no vénen del mateix lloc.
     * D'un calendari d'aquesta casa no en surt cap: la cita l'has escrita tu.
     */
    sourceKind = cal.rows[0]?.source_kind ?? null;
    if (calScope !== input.scope_id) {
      throw new PolicyError(
        'event-scope-mismatch',
        'Event is from another scope',
        422,
        'A task made from an event has to live in the same scope as its calendar.',
      );
    }

    const ja = await sql<{ id: string }>`
      SELECT id FROM tasks
      WHERE deleted_at IS NULL AND event_calendar_id = ${input.source_event.calendar_id}
        AND event_uid = ${input.source_event.uid}
    `.execute(ctx.tx);
    if (ja.rows[0] !== undefined) {
      throw new PolicyError(
        'event-already-a-task',
        'Already a task',
        409,
        'There is already a task made from that event.',
        { task_id: ja.rows[0].id },
      );
    }
  }

  const status = input.status ?? 'inbox';

  /**
   * La posició la calcula el client (D3). Si no en dona —clients simples, o creació des
   * del servidor— es posa al final de la columna.
   *
   * **I llavors cal serialitzar la lectura.** Llegir l'última posició i escriure'n una
   * de nova és un `read-then-write`: dues peticions simultànies llegeixen la mateixa
   * última i generen claus que xoquen. El jitter ho fa improbable per a dues, però amb
   * vint alhora l'aniversari mana i xoquen igual.
   *
   * Amb SQLite les transaccions ja es serialitzen i no cal fer res. A Postgres corren de
   * debò, i s'agafa un bloqueig d'assessorament de la mateixa família que el del
   * `change_log`: un per columna, dins de la transacció, i s'allibera sol en acabar.
   */
  let position = input.position;
  if (position === undefined) {
    if (engine === 'postgres') {
      await sql`
        SELECT pg_advisory_xact_lock(${POSITION_LOCK_ID}, hashtext(${`${input.scope_id}:${input.status ?? 'inbox'}`}))
      `.execute(ctx.tx);
    }

    const last = await sql<{ position: string }>`
      SELECT position FROM tasks
      WHERE scope_id = ${input.scope_id} AND status = ${status} AND deleted_at IS NULL
      ORDER BY position DESC, id DESC LIMIT 1
    `.execute(ctx.tx);
    position = generatePosition(last.rows[0]?.position ?? null, null);
  }

  const inserted = await sql`
    INSERT INTO tasks (id, scope_id, project_id, title, description, status, position,
                       due_date, due_time, view_mode, ai_mode, origin, search_text,
                       event_calendar_id, event_uid, event_recurrence_id, source_kind,
                       created_by, created_at, updated_at, version)
    VALUES (${id}, ${input.scope_id}, ${input.project_id ?? null}, ${input.title.trim()},
            ${input.description ?? null}, ${status}, ${position}, ${input.due_date ?? null},
            ${input.due_time ?? null}, 'card', 'manual', 'native',
            ${normalizeForSearch(input.title, input.description)},
            ${input.source_event?.calendar_id ?? null}, ${input.source_event?.uid ?? null},
            ${input.source_event?.recurrence_id ?? null}, ${sourceKind},
            ${principal.userId}, ${ctx.now}, ${ctx.now}, 1)
    ON CONFLICT (id) DO NOTHING
  `.execute(ctx.tx);

  /**
   * **La comprovació de dalt no basta sota concurrència.**
   *
   * Dues peticions amb el mateix identificador de client poden llegir totes dues que no
   * existeix i intentar inserir-lo. Amb SQLite no es veia perquè les transaccions es
   * serialitzen; a Postgres, una de les dues rebia una violació de clau i el client
   * s'enduia un error d'una operació que docs/05 §3 promet idempotent.
   *
   * `ON CONFLICT DO NOTHING` i no un `try`/`catch`: a Postgres, un error dins d'una
   * transacció l'avorta sencera i ja no s'hi pot tornar a consultar res. Aquesta forma
   * funciona igual als dos motors.
   */
  if (Number(inserted.numAffectedRows ?? 0n) === 0) {
    const race = await sql<TaskRow>`
      SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
    `.execute(ctx.tx);
    const winner = race.rows[0];
    if (winner !== undefined) {
      ctx.noChange();
      const [task] = await withAssignees(ctx.tx, [winner]);
      return { task: task!, created: false };
    }
  }

  /**
   * "A un àmbit `individual` totes les tasques s'assignen automàticament al propietari.
   * No es demana." (docs/01 §4)
   */
  const assignees =
    input.assignee_ids !== undefined && input.assignee_ids.length > 0
      ? input.assignee_ids
      : scope.kind === 'individual'
        ? [scope.owner_id]
        : [];

  for (const userId of assignees) {
    await sql`
      INSERT INTO task_assignees (task_id, user_id, assigned_at)
      VALUES (${id}, ${userId}, ${ctx.now})
    `.execute(ctx.tx);
  }

  ctx.record({
    entityType: 'task',
    entityId: id,
    scopeId: input.scope_id,
    verb: 'created',
  });

  const created = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
  `.execute(ctx.tx);
  const [task] = await withAssignees(ctx.tx, created.rows);
  if (task === undefined) throw notFound('task', id);
  return { task, created: true };
}

export interface MoveTaskInput {
  status?: TaskStatus | undefined;
  position?: string | undefined;
  before_id?: string | null | undefined;
  after_id?: string | null | undefined;
}

/**
 * Mou una tasca de columna o de posició.
 *
 * Accepta la posició calculada al client —el camí normal (D3)— o `{before_id, after_id}`
 * perquè el servidor la calculi, per a clients simples. Les dues coses acaben al mateix
 * lloc, i el càlcul és exactament el mateix codi de `packages/contracts`.
 */
/**
 * El pany, aplicat.
 *
 * Una sola porta per als tres camins d'escriptura, perquè la regla no es pugui complir a
 * dos llocs i oblidar-se al tercer. La decisió és pura (`policy/ai-writes.ts`); això és el
 * que hi porta la reserva viva i el nom de l'agent, que és el que fa que el missatge sigui
 * llegible per a qui el rep.
 */
async function assertWritable(
  ctx: AuditContext,
  principal: Principal,
  task: { id: string; ai_mode: TaskRow['ai_mode'] },
  intent: WriteIntent,
): Promise<void> {
  const lease = await leaseOf(ctx.tx, task.id, ctx.now);
  const refusal = refuseTaskWrite(
    { kind: principal.kind, agentId: principal.agentId },
    {
      aiMode: task.ai_mode,
      lease:
        lease === undefined
          ? null
          : { agentId: lease.agentId, userId: lease.userId, expiresAt: lease.expiresAt },
    },
    intent,
  );
  if (refusal === null) return;

  // El nom, no l'identificador: qui llegeix això és una persona mirant una targeta.
  let agentName: string | undefined;
  if (lease?.agentId != null) {
    const found = await sql<{ name: string }>`
      SELECT name FROM ai_agents WHERE id = ${lease.agentId}
    `.execute(ctx.tx);
    agentName = found.rows[0]?.name;
  }
  throw refusalError(refusal, { agentName, now: ctx.now });
}

export async function moveTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: MoveTaskInput,
): Promise<Task> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const current = found.rows[0];
  if (current === undefined) throw notFound('task', id);
  await assertScopeAccess(ctx.tx, principal, current.scope_id, { type: 'La tasca', id });
  await assertWritable(ctx, principal, current, 'move');

  const status = input.status ?? current.status;

  /**
   * **Arribar a Fet ÉS completar-la.**
   *
   * `completed_at` només el segellava `completeTask`, i `POST /tasks/{id}/complete` no el
   * crida ningú: ni la web, ni Android, ni el CalDAV. L'única manera d'acabar una tasca a
   * la interfície —arrossegar-la a Fet, o el commutador de la targeta— passa per aquí.
   * Resultat: la columna Fet, que filtra per `completed_at` dins del dia (docs/14 P?), no
   * podia ensenyar **res mai**, i la targeta que hi deixaves anar desapareixia de les
   * quatre columnes. Tot el codi de `DoneColumn.ts` estava bé i li arribava una llista
   * buida: el defecte era la costura, com sempre.
   *
   * I si en surt, el segell s'esborra: una tasca que torna a Per fer no s'ha fet.
   */
  const entraAFet = status === 'done' && current.status !== 'done';
  const surtDeFet = status !== 'done' && current.status === 'done';
  const completedAt = entraAFet ? ctx.now : surtDeFet ? null : current.completed_at;

  let position = input.position;
  if (position === undefined) {
    const neighbour = async (neighbourId: string | null | undefined): Promise<string | null> => {
      if (neighbourId === null || neighbourId === undefined) return null;
      const row = await sql<{ position: string }>`
        SELECT position FROM tasks WHERE id = ${neighbourId} AND deleted_at IS NULL
      `.execute(ctx.tx);
      return row.rows[0]?.position ?? null;
    };

    const before = await neighbour(input.before_id);
    const after = await neighbour(input.after_id);

    if (before === null && after === null) {
      // Ni posició ni veïns: "mou-la a aquesta columna" i prou. Va al FINAL de la
      // columna de destí, no al principi.
      //
      // Generar-la des de zero seria un error silenciós: dues tasques mogudes seguides
      // rebrien claus quasi idèntiques i l'ordre entre elles quedaria a l'atzar. Va
      // passar de veritat, i la prova de "moure entre columnes conserva l'ordre" és la
      // que ho va veure.
      const last = await sql<{ position: string }>`
        SELECT position FROM tasks
        WHERE scope_id = ${current.scope_id} AND status = ${status}
          AND id != ${id} AND deleted_at IS NULL
        ORDER BY position DESC, id DESC LIMIT 1
      `.execute(ctx.tx);
      position = generatePosition(last.rows[0]?.position ?? null, null);
    } else {
      position = generatePosition(before, after);
    }
  }

  await sql`
    UPDATE tasks
    SET status = ${status}, position = ${position}, completed_at = ${completedAt},
        updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  // El registre guarda el valor anterior i el nou: és el que fa possible desfer un
  // canvi autònom de la IA (docs/01 §7). El segell hi va perquè, si no, desfer un
  // moviment a Fet deixaria la tasca fora de Fet i completada.
  ctx.record({
    entityType: 'task',
    entityId: id,
    scopeId: current.scope_id,
    verb: entraAFet ? 'completed' : 'moved',
    changes: {
      status: { from: current.status, to: status },
      position: { from: current.position, to: position },
      ...(entraAFet || surtDeFet
        ? { completed_at: { from: current.completed_at, to: completedAt } }
        : {}),
    },
  });

  /**
   * **La dedicació s'anota aquí i enlloc més.**
   *
   * Entrar a Fent obre un bloc i sortir-ne el tanca. Va a `moveTask` perquè és l'únic camí
   * pel qual una tasca canvia de columna —el tauler, la fletxa de la targeta, el commutador
   * i l'MCP hi passen tots—, i posar-ho a cada cridador seria posar-ho a quatre llocs perquè
   * un dia en falti un.
   */
  if (status === 'doing' && current.status !== 'doing') {
    await openSession(ctx, principal.userId, current);
  } else if (status !== 'doing' && current.status === 'doing') {
    await closeSession(ctx, id);
  }

  if (entraAFet) {
    // La resta del que vol dir «feta», i el mateix ordre que a `completeTask`: les
    // subtasques cauen amb ella i, si es repeteix, neix la següent. Una tasca que es
    // repeteix i que s'acaba arrossegant-la ha de tornar igual que una que s'acaba
    // amb el commutador; que depengui del gest seria el pitjor dels dos móns.
    await sql`
      UPDATE subtasks SET done = ${dbBool(true)}, updated_at = ${ctx.now}, version = version + 1
      WHERE task_id = ${id} AND done = ${dbBool(false)} AND deleted_at IS NULL
    `.execute(ctx.tx);
    await createNextOccurrence(ctx, principal, id, current);
  }

  const updated = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
  `.execute(ctx.tx);
  const [task] = await withAssignees(ctx.tx, updated.rows);
  if (task === undefined) throw notFound('task', id);
  return task;
}

/**
 * Reclamar una tasca que estava a mans de la IA.
 *
 * **El camí de tornada que no existia.** Fins avui una tasca delegada només sortia del
 * kanban d'IA arrossegant-la a la bústia, que la deixa a `manual` però també la treu de la
 * columna on era: la manera d'agafar una cosa a mig fer era desfer-li el lloc.
 *
 * Tres coses hi passen, i cap n'esborra res:
 *
 *   - Passa a `manual` i **a la columna que triïs**. Per això el paràmetre existeix: una
 *     tasca que l'agent tenia a «Fent» pot ser que la vulguis continuar tu, o pot ser que
 *     la vulguis tornar a la cua. Endevinar-ho seria decidir-ho per tu.
 *   - **Baixa la marca d'atenció**, si esperava resposta: ja no espera ningú.
 *   - **Deixa anar la reserva.** Només arriba aquí si no estava bloquejada —`assertWritable`
 *     ho ha comprovat—, però una reserva caducada que quedés a la taula faria que el pany
 *     tornés a sortir sol quan l'agent la renovés.
 *
 * Els comentaris, els adjunts i l'historial es queden: són de la tasca, no del mode. És
 * literalment el que la fa útil de reclamar —el que l'agent ja hi ha deixat escrit.
 */
export async function takeOverTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  status: 'todo' | 'doing',
): Promise<Task> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const current = found.rows[0];
  if (current === undefined) throw notFound('task', id);
  await assertScopeAccess(ctx.tx, principal, current.scope_id, { type: 'La tasca', id });
  await assertWritable(ctx, principal, current, 'take-over');

  await sql`
    UPDATE tasks
    SET ai_mode = 'manual', status = ${status}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  await clearAttention(ctx, id);
  await releaseIfHeld(ctx, id, 'Una persona ha assumit la tasca.');

  /**
   * **`taken_over` i no `updated`.** L'historial és el que llegeix l'agent per saber què
   * ha passat, i «ha canviat `ai_mode` de delegated a manual» no diu qui se l'ha enduta
   * ni per què la seva següent crida falla.
   */
  ctx.record({
    entityType: 'task',
    entityId: id,
    scopeId: current.scope_id,
    verb: 'taken_over',
    changes: {
      ai_mode: { from: current.ai_mode, to: 'manual' },
      status: { from: current.status, to: status },
    },
  });

  const updated = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
  `.execute(ctx.tx);
  const [task] = await withAssignees(ctx.tx, updated.rows);
  if (task === undefined) throw notFound('task', id);
  return task;
}

export interface CompleteResult {
  task: Task;
  /** La instància següent, si la tasca es repeteix. `null` si no. */
  next: Task | null;
}

export async function completeTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<Task> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const current = found.rows[0];
  if (current === undefined) throw notFound('task', id);
  await assertScopeAccess(ctx.tx, principal, current.scope_id, { type: 'La tasca', id });
  await assertWritable(ctx, principal, current, 'move');

  await sql`
    UPDATE tasks
    SET status = 'done', completed_at = ${ctx.now}, updated_at = ${ctx.now},
        version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  /**
   * **Una tasca feta ja no espera resposta.** Si la marca hi quedés, el punt del
   * commutador comptaria una pregunta d'una tasca que ja no és a cap columna oberta, i
   * l'única manera de treure'l seria respondre-hi una cosa que ja no cal.
   */
  await clearAttention(ctx, id);

  // I si venia de Fent, el bloc de dedicació es tanca: acabar-la per aquí o arrossegant-la
  // ha de deixar el mateix rastre.
  if (current.status === 'doing') await closeSession(ctx, id);

  // Les subtasques cauen amb la tasca. La cascada AMUNT —marcar l'últim ítem d'una
  // llista marca la subtasca i la tasca— arriba a M8, que és quan hi ha llistes.
  await sql`
    UPDATE subtasks SET done = ${dbBool(true)}, updated_at = ${ctx.now}, version = version + 1
    WHERE task_id = ${id} AND done = ${dbBool(false)} AND deleted_at IS NULL
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task',
    entityId: id,
    scopeId: current.scope_id,
    verb: 'completed',
    changes: { status: { from: current.status, to: 'done' } },
  });

  await createNextOccurrence(ctx, principal, id, current);

  const updated = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
  `.execute(ctx.tx);
  const [task] = await withAssignees(ctx.tx, updated.rows);
  if (task === undefined) throw notFound('task', id);
  return task;
}

/**
 * La instància següent d'una tasca que es repeteix. docs/01 §4, docs/13 M4.
 *
 * **`schedule` i `completion` són dues coses diferents**, i és la distinció que Todoist
 * escriu com a `every` contra `every!`: repetir-se cada dimarts contra repetir-se una
 * setmana **després d'haver-la fet**. Per a tasques domèstiques la segona és la que la
 * gent vol, i RRULE no la sap expressar — per això `recurrence_mode` és una columna i
 * no un tros de la regla.
 *
 *   - `schedule`   — la següent surt de la regla comptant des del venciment anterior.
 *   - `completion` — surt de la regla comptant des d'AVUI, que és quan s'ha fet.
 *
 * La nova neix a `todo` i no a `inbox`: ja se sap què és i quan toca, i passar per la
 * bústia obligaria a tornar-la a classificar cada vegada.
 */
async function createNextOccurrence(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  current: TaskRow,
): Promise<void> {
  const rrule = current.rrule;
  if (rrule === null || rrule === '') return;

  const mode = current.recurrence_mode === 'completion' ? 'completion' : 'schedule';
  const from =
    mode === 'completion' ? ctx.now.slice(0, 10) : (current.due_date ?? ctx.now.slice(0, 10));

  const nextDate = nextDueDate(rrule, from);
  if (nextDate === null) return;

  const nextId = uuidv7();
  const last = await sql<{ position: string }>`
    SELECT position FROM tasks
    WHERE scope_id = ${current.scope_id} AND status = 'todo' AND deleted_at IS NULL
    ORDER BY position DESC, id DESC LIMIT 1
  `.execute(ctx.tx);

  await sql`
    INSERT INTO tasks (id, scope_id, project_id, title, description, status, position,
                       due_date, due_time, view_mode, ai_mode, origin, search_text,
                       rrule, recurrence_mode, recurrence_parent_id,
                       created_by, created_at, updated_at, version)
    VALUES (${nextId}, ${current.scope_id}, ${current.project_id}, ${current.title},
            ${current.description}, 'todo',
            ${generatePosition(last.rows[0]?.position ?? null, null)},
            ${nextDate}, ${current.due_time}, ${current.view_mode}, ${current.ai_mode},
            'native', ${normalizeForSearch(current.title, current.description)},
            ${rrule}, ${mode}, ${id},
            ${principal.userId}, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  // Els assignats van amb ella: qui treia les escombraries la setmana passada les
  // segueix traient.
  const assignees = await sql<{ user_id: string }>`
    SELECT user_id FROM task_assignees WHERE task_id = ${id}
  `.execute(ctx.tx);
  for (const row of assignees.rows) {
    await sql`
      INSERT INTO task_assignees (task_id, user_id, assigned_at)
      VALUES (${nextId}, ${row.user_id}, ${ctx.now})
    `.execute(ctx.tx);
  }

  ctx.record({
    entityType: 'task',
    entityId: nextId,
    scopeId: current.scope_id,
    verb: 'created',
    changes: { recurrence_parent_id: { from: null, to: id } },
  });
}

/**
 * La data següent d'una RRULE, a partir d'una data.
 *
 * S'implementa aquí i no amb `expandOccurrences` perquè aquella treballa amb instants i
 * fusos —és per a esdeveniments— i una tasca té una **data sense hora**: passar-la per
 * un instant obligaria a inventar-se una hora i el dia de canvi d'hora sortiria mogut.
 *
 * Se'n suporten les freqüències que una tasca domèstica fa servir. Una regla més
 * complicada torna `null` i **no genera res**, que és millor que generar-la al dia
 * equivocat: una tasca que no apareix es nota; una que apareix el dia que no toca,
 * durant setmanes, no.
 */
export function nextDueDate(rrule: string, from: string): string | null {
  const parts = Object.fromEntries(
    rrule
      .replace(/^RRULE:/u, '')
      .split(';')
      .map((part) => part.split('=') as [string, string]),
  );

  const interval = Number(parts.INTERVAL ?? '1');
  if (!Number.isFinite(interval) || interval < 1) return null;

  const [year, month, day] = from.split('-').map(Number) as [number, number, number];
  // Migdia UTC per no caure a l'altre dia amb cap desplaçament de fus.
  const base = new Date(Date.UTC(year, month - 1, day, 12));

  switch (parts.FREQ) {
    case 'DAILY':
      base.setUTCDate(base.getUTCDate() + interval);
      break;
    case 'WEEKLY':
      base.setUTCDate(base.getUTCDate() + 7 * interval);
      break;
    case 'MONTHLY':
      base.setUTCMonth(base.getUTCMonth() + interval);
      break;
    case 'YEARLY':
      base.setUTCFullYear(base.getUTCFullYear() + interval);
      break;
    default:
      return null;
  }

  // `UNTIL` acaba la sèrie: passat el límit no se'n genera cap més.
  const until = parts.UNTIL;
  const next = base.toISOString().slice(0, 10);
  if (
    until !== undefined &&
    next > until.slice(0, 10).replace(/(\d{4})(\d{2})(\d{2})/u, '$1-$2-$3')
  ) {
    return null;
  }

  return next;
}

export interface BoardGroup {
  scope_id: string;
  tasks: Task[];
}

export interface BoardColumn {
  status: TaskStatus;
  groups: BoardGroup[];
}

/**
 * El tauler sencer en una crida.
 *
 * Torna **sempre les quatre columnes**, encara que alguna sigui buida: si les buides
 * desapareguessin, la interfície hauria de saber quines existeixen i tornaríem a tenir
 * el vocabulari repartit en dos llocs.
 */
export async function getBoard(
  db: MigrationDb,
  principal: Principal,
  options: { scopeIds?: string[] | undefined; projectId?: string | undefined } = {},
): Promise<{ columns: BoardColumn[] }> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const scopes = await listScopes(db, principal);
  const requested = options.scopeIds;
  const allowed = scopes
    .map((s) => s.id)
    .filter((id) => requested === undefined || requested.includes(id));

  const columns: BoardColumn[] = TASK_STATUSES.map((status) => ({ status, groups: [] }));
  if (allowed.length === 0) return { columns };

  const rows = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks
    WHERE deleted_at IS NULL
      AND scope_id IN (${sql.join(allowed)})
      ${options.projectId === undefined ? sql`` : sql`AND project_id = ${options.projectId}`}
    ORDER BY status, scope_id, position, id
  `.execute(db);

  const tasks = await withAssignees(db, rows.rows);

  for (const column of columns) {
    const ofColumn = tasks.filter((t) => t.status === column.status);
    // L'agrupació per àmbit la fa el servidor perquè és el que pinta la interfície
    // (docs/02 §4) i perquè els dos clients l'han de veure igual.
    for (const scopeId of allowed) {
      const group = ofColumn.filter((t) => t.scope_id === scopeId);
      if (group.length > 0) column.groups.push({ scope_id: scopeId, tasks: group });
    }
  }

  return { columns };
}

export interface UpdateTaskInput {
  title?: string | undefined;
  description?: string | null | undefined;
  due_date?: string | null | undefined;
  due_time?: string | null | undefined;
  /**
   * La data límit, **separada del venciment** (docs/01 §4, docs/02 §7).
   *
   * "Fes-ho aquest dijous" i "com a molt tard el dia 30" són dues coses: amb un sol
   * camp, qui té les dues n'ha de triar una i perd l'altra.
   */
  deadline?: string | null | undefined;
  /** `null` la treu del projecte i la torna a l'espai general de l'àmbit. */
  project_id?: string | null | undefined;
  /** RFC 5545. `null` deixa de repetir-se. */
  rrule?: string | null | undefined;
  /** `schedule` compta des del venciment; `completion`, des que es fa (docs/01 §4). */
  recurrence_mode?: 'schedule' | 'completion' | undefined;
  ai_mode?: 'manual' | 'assisted' | 'delegated' | undefined;
  ai_instructions?: string | null | undefined;
}

/**
 * Modifica els camps d'una tasca.
 *
 * **Només els que es donin.** `undefined` vol dir "no el toquis" i `null` vol dir
 * "buida'l": si no es distingissin, buidar una data seria impossible des d'un client que
 * envia només el que ha canviat.
 */
export async function updateTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: UpdateTaskInput,
): Promise<Task> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const before = found.rows[0];
  if (before === undefined) throw notFound('task', id);

  await assertScopeAccess(ctx.tx, principal, before.scope_id);
  await assertWritable(ctx, principal, before, 'edit');

  const fields: Record<string, unknown> = {};
  if (input.title !== undefined) {
    if (input.title.trim() === '') {
      throw new PolicyError(
        'title-required',
        'Title required',
        422,
        'The title cannot be left empty.',
      );
    }
    fields.title = input.title.trim();
  }
  for (const key of [
    'description',
    'due_date',
    'due_time',
    'deadline',
    'rrule',
    'recurrence_mode',
    'ai_mode',
    'ai_instructions',
  ] as const) {
    if (input[key] !== undefined) fields[key] = input[key];
  }

  /**
   * Canviar de projecte sí; canviar d'àmbit, no.
   *
   * Un projecte és una carpeta dins del mateix àmbit i moure-hi la tasca no canvia qui
   * la veu. Canviar d'àmbit sí: altres membres, altres etiquetes, altres calendaris, i
   * l'assignació automàtica dels àmbits individuals. Es fa creant-la on toca.
   */
  if (input.project_id !== undefined) {
    if (input.project_id !== null) {
      const project = await sql<{ scope_id: string; name: string }>`
        SELECT scope_id, name FROM projects WHERE id = ${input.project_id} AND deleted_at IS NULL
      `.execute(ctx.tx);
      const found = project.rows[0];
      if (found === undefined) throw notFound('project', input.project_id);
      if (found.scope_id !== before.scope_id) {
        throw new PolicyError(
          'project-other-scope',
          'Project from another scope',
          422,
          `The ${found.name} project belongs to another scope. A task does not change scope by editing it.`,
          { name: found.name },
        );
      }
    }
    fields.project_id = input.project_id;
  }

  if (Object.keys(fields).length === 0) {
    // Res a canviar: es declara explícitament perquè l'embolcall d'auditoria no es
    // queixi que una transacció d'escriptura no ha deixat rastre.
    ctx.noChange();
    const [task] = await withAssignees(ctx.tx, [before]);
    return task!;
  }

  // El text de cerca es refà amb els valors NOUS, no amb els que hi havia.
  fields.search_text = normalizeForSearch(
    (fields.title as string | undefined) ?? before.title,
    (fields.description as string | null | undefined) ?? before.description,
  );

  const assignments = Object.entries(fields).map(
    ([field, value]) => sql`${sql.raw(field)} = ${value}`,
  );
  await sql`
    UPDATE tasks SET ${sql.join(assignments)}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'task',
    entityId: id,
    scopeId: before.scope_id,
    verb: 'updated',
    changes: Object.fromEntries(
      Object.keys(fields)
        .filter((field) => field !== 'search_text')
        .map((field) => [
          field,
          { from: (before as unknown as Record<string, unknown>)[field], to: fields[field] },
        ]),
    ),
  });

  const after = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${id}
  `.execute(ctx.tx);
  const [task] = await withAssignees(ctx.tx, after.rows);
  return task!;
}

/**
 * Esborrat suau d'una tasca.
 *
 * **Les subtasques i les llistes cauen amb ella**, a diferència del que passa quan
 * s'esborra un projecte. La diferència no és capritxosa: una subtasca no existeix fora
 * de la seva tasca —no té àmbit propi ni identitat pròpia—, mentre que una tasca dins
 * d'un projecte sí que en té i pot viure a l'espai general.
 *
 * Cap DELETE de veritat: `deleted_at` és el que fa que el canvi arribi als altres
 * clients pel sync (docs/06 §7). Una fila esborrada de debò no es pot sincronitzar.
 */
export async function deleteTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'tasks:delete')) throw missingCapability('tasks:delete');

  const found = await sql<
    TaskRow & {
      event_calendar_id: string | null;
      event_uid: string | null;
      event_recurrence_id: string | null;
    }
  >`
    SELECT ${TASK_COLUMNS}, event_calendar_id, event_uid, event_recurrence_id
    FROM tasks WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const task = found.rows[0];
  if (task === undefined) throw notFound('task', id);
  await assertScopeAccess(ctx.tx, principal, task.scope_id, { type: 'La tasca', id });

  await sql`
    UPDATE checklist_items SET deleted_at = ${ctx.now}, updated_at = ${ctx.now},
                               version = version + 1
    WHERE deleted_at IS NULL
      AND checklist_id IN (SELECT id FROM checklists WHERE task_id = ${id})
  `.execute(ctx.tx);
  await sql`
    UPDATE checklists SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE task_id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  await sql`
    UPDATE subtasks SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE task_id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  await sql`
    UPDATE tasks SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'task', entityId: id, scopeId: task.scope_id, verb: 'deleted' });

  /**
   * I si la tasca venia d'un esdeveniment, què li passa a la cita.
   *
   * **Amb el defecte —`return_to_inbox`— no s'escriu res, i és el punt.** La cita havia
   * marxat de la bústia només perquè hi havia una tasca viva; en desaparèixer, torna
   * sola. Cap fila, cap neteja, res que es pugui quedar penjat.
   *
   * `hide_from_inbox` sí que escriu una marca: qui tria això vol dir "d'això ja me n'he
   * ocupat i no vull que em torni a punxar", i llavors cal deixar-ho dit en algun lloc.
   * Segueix al calendari, i des d'allà es pot recuperar.
   */
  if (task.event_uid !== null && task.event_calendar_id !== null) {
    const settings = await sql<{ event_task_deleted: string }>`
      SELECT event_task_deleted FROM user_settings WHERE user_id = ${principal.userId}
    `.execute(ctx.tx);
    if (settings.rows[0]?.event_task_deleted === 'hide_from_inbox') {
      await hideEventFromInbox(ctx, principal.userId, {
        calendarId: task.event_calendar_id,
        uid: task.event_uid,
        recurrenceId: task.event_recurrence_id,
      });
    }
  }
}

/**
 * Amaga una cita de la bústia d'algú, dins de la transacció que esborra la seva tasca.
 *
 * No es crida `setEventInboxVisibility`: aquella comprova capacitats i visibilitat de
 * calendari perquè ve d'una petició de fora, i **aquí ja s'ha comprovat tot** —qui esborra
 * la tasca hi té accés—. Tornar-hi a passar seria demanar `events:read` per esborrar una
 * tasca, i un token d'IA amb abast només de tasques deixaria de poder-ho fer.
 */
async function hideEventFromInbox(
  ctx: AuditContext,
  userId: string,
  ref: { calendarId: string; uid: string; recurrenceId: string | null },
): Promise<void> {
  const existing = await sql<{ id: string }>`
    SELECT id FROM event_inbox_marks
    WHERE deleted_at IS NULL AND user_id = ${userId} AND calendar_id = ${ref.calendarId}
      AND uid = ${ref.uid}
      AND ${ref.recurrenceId === null ? sql`recurrence_id IS NULL` : sql`recurrence_id = ${ref.recurrenceId}`}
  `.execute(ctx.tx);

  const row = existing.rows[0];
  if (row !== undefined) {
    await sql`
      UPDATE event_inbox_marks SET visible = ${dbBool(false)}, deleted_at = NULL,
                                   updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${row.id}
    `.execute(ctx.tx);
    ctx.record({
      entityType: 'event_inbox_mark',
      entityId: row.id,
      scopeId: null,
      verb: 'updated',
    });
    return;
  }

  const markId = uuidv7();
  await sql`
    INSERT INTO event_inbox_marks (id, user_id, calendar_id, uid, recurrence_id, visible,
                                   created_at, updated_at)
    VALUES (${markId}, ${userId}, ${ref.calendarId}, ${ref.uid}, ${ref.recurrenceId},
            ${dbBool(false)}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);
  ctx.record({
    entityType: 'event_inbox_mark',
    entityId: markId,
    // Sense àmbit: és una preferència personal i no ha de viatjar pel sync.
    scopeId: null,
    verb: 'created',
  });
}

/**
 * Assigna o desassigna una persona.
 *
 * És una taula i no una columna perquè el brief demana "persona o persones". Posar dues
 * vegades la mateixa persona no és un error: és una reenviada, i es diu.
 */
export async function setAssignee(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  userId: string,
  assigned: boolean,
): Promise<Task> {
  if (!hasCapability(principal, 'tasks:write')) throw missingCapability('tasks:write');

  const found = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${taskId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const task = found.rows[0];
  if (task === undefined) throw notFound('task', taskId);
  const scope = await assertScopeAccess(ctx.tx, principal, task.scope_id, {
    type: 'La tasca',
    id: taskId,
  });

  const user = await sql<{ id: string; name: string }>`
    SELECT id, name FROM users WHERE id = ${userId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (user.rows[0] === undefined) throw notFound('user', userId);

  if (assigned) {
    // A un àmbit col·lectiu, qui s'assigna ha de ser-ne membre: si no, la persona veuria
    // una tasca seva que no pot obrir.
    if (scope.kind === 'collective') {
      const member = await sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM scopes s
        WHERE s.id = ${task.scope_id} AND ${visibleScopesPredicate(userId)}
      `.execute(ctx.tx);
      if (Number(member.rows[0]?.n ?? 0) === 0) {
        throw new PolicyError(
          'not-a-member',
          'Not a member',
          422,
          `${user.rows[0].name} is not a member of ${scope.name}: they could not open the task.`,
          { person: user.rows[0].name, scope: scope.name },
        );
      }
    }

    const already = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM task_assignees WHERE task_id = ${taskId} AND user_id = ${userId}
    `.execute(ctx.tx);
    if (Number(already.rows[0]?.n ?? 0) > 0) {
      ctx.noChange();
      const [task2] = await withAssignees(ctx.tx, [task]);
      return task2!;
    }

    await sql`
      INSERT INTO task_assignees (task_id, user_id, assigned_at)
      VALUES (${taskId}, ${userId}, ${ctx.now})
    `.execute(ctx.tx);
  } else {
    const removed = await sql`
      DELETE FROM task_assignees WHERE task_id = ${taskId} AND user_id = ${userId}
    `.execute(ctx.tx);
    if (Number(removed.numAffectedRows ?? 0n) === 0) {
      ctx.noChange();
      const [task2] = await withAssignees(ctx.tx, [task]);
      return task2!;
    }
  }

  ctx.record({
    entityType: 'task',
    entityId: taskId,
    scopeId: task.scope_id,
    verb: 'updated',
    changes: { assignee: { from: assigned ? null : userId, to: assigned ? userId : null } },
  });

  const after = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ${taskId}
  `.execute(ctx.tx);
  const [updated] = await withAssignees(ctx.tx, after.rows);
  return updated!;
}

export interface InboxView {
  date: string;
  /** Amb venciment el dia demanat. */
  dated: Task[];
  /** Vençudes i no fetes. Buit si no s'han demanat. */
  overdue: Task[];
  /** Sense data. És la secció "SENSE DIA" del rail (docs/02 §5). */
  undated: Task[];
  /**
   * El que arriba de fora: calendaris subscrits, `.ics` publicats i canals RSS.
   *
   * **Array a part i tipus a part, no barrejat amb les tasques**, i és el que fa que la
   * regla 7 esmenada es pugui comprovar en comptes de discutir: un `InboxEvent` no té
   * `status` ni `position`, no és un `Task` en cap tipus, i cap identificador d'aquí pot
   * arribar mai a `POST /tasks/{id}/move`.
   */
  events: InboxEvent[];
  /**
   * El que ha arribat per correu i encara no és una tasca.
   *
   * Array a part pel mateix motiu que `events`, i **sense filtre de dia**: un correu que
   * ha arribat és pendent fins que en facis alguna cosa, i amagar-lo demà seria perdre'l.
   */
  mail: InboxMail[];
}

/**
 * L'Inbox d'un dia.
 *
 * **És la mateixa font de dades per a la columna del kanban i per al rail del
 * calendari** (P4). Si fossin dues consultes, un dia divergirien i es notaria: el
 * document ho diu amb aquestes paraules i per això aquí n'hi ha una de sola.
 */
export async function getInbox(
  db: MigrationDb,
  principal: Principal,
  options: {
    date: string;
    includeOverdue?: boolean | undefined;
    scopeIds?: string[] | undefined;
    /**
     * Amb `true`, la bústia porta **també el que no és visible**, cada ítem amb el seu
     * `in_inbox`.
     *
     * És el que fa que la columna del kanban i el rail del calendari segueixin sent el
     * mateix component amb **la mateixa font de dades** (P4): el que canvia és la lent. El
     * tauler ensenya el que has decidit que és feina; el calendari ho ensenya tot, difuminat,
     * perquè és des d'allà que decideixes.
     */
    includeHidden?: boolean | undefined;
    /**
     * De quin calaix.
     *
     * **És un commutador, no un filtre**: canvies de calaix, no acotes una llista. Per
     * això es composa amb `scopeIds` en comptes de substituir-lo — els xips d'àmbit de
     * dalt segueixen valent.
     */
    mailbox?: Mailbox | undefined;
    /**
     * El fus de qui pregunta, per tallar el dia on el talla ell.
     *
     * Les tasques no en necessitaven —`due_date` ja és una data local—, però els
     * esdeveniments són instants i sí. Sense això, el dia es tallaria pel fus del
     * servidor i les cites de la nit ballarien de dia.
     */
    timezone?: string | undefined;
  },
): Promise<InboxView> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const scopes = await listScopes(db, principal);
  const requested = options.scopeIds;
  const mailbox = options.mailbox ?? 'all';

  /**
   * «Propi» i «compartit» surten del **tipus de l'àmbit**, no de qui té la tasca
   * assignada.
   *
   * Per assignació semblaria més fi i seria pitjor: a un àmbit individual tot està
   * assignat a tu per la regla d'autoassignació (`docs/01` §4), i a un de compartit una
   * tasca sense assignar no cauria a cap dels dos calaixos. Amb el tipus, cada cosa és
   * exactament d'un costat i es pot explicar en una frase.
   */
  const allowed = scopes
    .filter((s) => {
      if (mailbox === 'all') return true;
      const own = s.kind === 'individual';
      return mailbox === 'own' ? own : !own;
    })
    .map((s) => s.id)
    .filter((id) => requested === undefined || requested.includes(id));

  const empty: InboxView = {
    date: options.date,
    dated: [],
    overdue: [],
    undated: [],
    events: [],
    mail: [],
  };
  if (allowed.length === 0) return empty;

  const rows = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks
    WHERE deleted_at IS NULL AND status = 'inbox' AND scope_id IN (${sql.join(allowed)})
    ORDER BY position, id
  `.execute(db);
  const tasks = await withAssignees(db, rows.rows);

  /**
   * I el que arriba de fora.
   *
   * **El fus és de qui mira, no del servidor.** La bústia parla de dies i els
   * esdeveniments d'instants; sense convertir-ho al fus de qui pregunta, una cita a les
   * 23:30 cauria a la bústia de demà i ningú entendria per què. `localDayBounds` ja fa
   * exactament aquesta conversió des de la fita del calendari.
   *
   * Els esdeveniments **no són d'un usuari abstracte sinó d'aquest**: les marques de
   * visibilitat són personals, i per això cal el `userId` i no només el principal.
   */
  const bounds = localDayBounds(options.timezone ?? 'UTC', options.date);
  const events = await listInboxEvents(db, principal, principal.userId, {
    from: bounds.startUTC,
    to: bounds.endUTC,
    scopeIds: allowed,
    includeHidden: options.includeHidden,
  });

  return {
    date: options.date,
    dated: tasks.filter((t) => t.due_date === options.date),
    overdue:
      options.includeOverdue === true
        ? tasks.filter((t) => t.due_date !== null && t.due_date < options.date)
        : [],
    undated: tasks.filter((t) => t.due_date === null),
    events,
    mail: await listInboxMail(db, principal, {
      scopeIds: allowed,
      includeHidden: options.includeHidden,
    }),
  };
}

export interface DashboardScope {
  scope_id: string;
  name: string;
  color: string;
  pending: number;
  overdue: number;
}

export interface DashboardView {
  date: string;
  scopes: DashboardScope[];
  today: Task[];
  overdue: Task[];
  doing: Task[];
}

/**
 * El dashboard global. docs/02 §8.
 *
 * **Ignora la selecció d'àmbits i de projecte: ho ensenya tot.** És el que el distingeix
 * del tauler, i per això no accepta cap filtre d'àmbit — acceptar-lo convidaria a
 * reutilitzar-lo com un tauler amb una altra cara.
 *
 * Va en una sola crida per la mateixa raó que `/board`: sis peticions paral·leles per a
 * una pantalla són sis estats de càrrega i sis punts de fallada.
 */
export async function getDashboard(
  db: MigrationDb,
  principal: Principal,
  options: { date: string },
): Promise<DashboardView> {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');

  const scopes = await listScopes(db, principal);
  const empty: DashboardView = {
    date: options.date,
    scopes: [],
    today: [],
    overdue: [],
    doing: [],
  };
  if (scopes.length === 0) return empty;

  const ids = scopes.map((s) => s.id);
  const rows = await sql<TaskRow>`
    SELECT ${TASK_COLUMNS} FROM tasks
    WHERE deleted_at IS NULL AND scope_id IN (${sql.join(ids)})
    ORDER BY due_date, position, id
  `.execute(db);
  const tasks = await withAssignees(db, rows.rows);

  const pendents = tasks.filter((t) => t.status !== 'done');

  return {
    date: options.date,
    scopes: scopes.map((scope) => ({
      scope_id: scope.id,
      name: scope.name,
      color: scope.color,
      pending: pendents.filter((t) => t.scope_id === scope.id).length,
      overdue: pendents.filter(
        (t) => t.scope_id === scope.id && t.due_date !== null && t.due_date < options.date,
      ).length,
    })),
    today: pendents.filter((t) => t.due_date === options.date),
    overdue: pendents.filter((t) => t.due_date !== null && t.due_date < options.date),
    doing: pendents.filter((t) => t.status === 'doing'),
  };
}
