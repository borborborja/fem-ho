import {
  eventDateOf,
  generatePosition,
  isCurrentCalendarSuggestion,
  localDateOf,
  localDayBounds,
} from '@fem-ho/contracts';
import type { components } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { Connection } from '../db/connection.js';
import type { MigrationDb } from '../db/migration-db.js';
import { visibleCalendarIds } from '../policy/calendar-visibility.js';
import { PolicyError, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { roleCan } from '../policy/scope-roles.js';
import { roleOf } from '../policy/scope-visibility.js';
import {
  listCalendars,
  listEventOccurrences,
  markKey,
  type EventOccurrenceView,
} from './events.js';
import { requireHumanSession } from './external-access.js';
import { assertScopeRole, listScopes } from './scopes.js';
import { settingsOfMany } from './scope-settings.js';
import { lockSyncOp, recallOp, rememberOp, type BatchOperation, type BatchResult } from './sync.js';
import { taskTimeSummaries } from './task-time.js';
import { createTask, getTask, lockEventTaskSeries, moveTask, type Task } from './tasks.js';
import { getProfile, getSettings } from './users.js';

type Snapshot = components['schemas']['CalendarSuggestionSnapshot'];
type EventRef = components['schemas']['CalendarSuggestionOccurrence'];
type Result = components['schemas']['CalendarSuggestionResult'];
type Engine = Connection['engine'];

const occurrenceRef = z.strictObject({
  calendar_id: z.uuid(),
  uid: z.string().min(1),
  recurrence_id: z.string().min(1).nullable(),
});
const actionFields = {
  occurrence: occurrenceRef,
  starts_at: z.iso.datetime({ offset: true }),
  action_at: z.iso.datetime({ offset: true }),
};
const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('configure'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('decline'), ...actionFields }),
  z.strictObject({
    type: z.literal('start'),
    ...actionFields,
    start: z.enum(['now', 'planned']),
    task_id: z.uuid(),
    position: z.string().min(1).max(512),
    confirm_share: z.boolean().optional(),
    task_type_id: z.uuid().optional(),
  }),
]);
type Action = Exclude<z.infer<typeof commandSchema>, { type: 'configure' }>;

type EventTask = EventRef & {
  id: string;
  title: string;
  due_date: string | null;
  project_id: string | null;
  status: 'inbox' | 'todo' | 'doing' | 'done';
  ai_mode: string;
  version: number;
};

const keyOf = (ref: EventRef): string => markKey(ref.calendar_id, ref.uid, ref.recurrence_id);

async function dayEvents(
  db: MigrationDb,
  principal: Principal,
  date: string,
  timezone: string,
  calendarIds: string[],
) {
  const civil = localDayBounds('UTC', date);
  const local = localDayBounds(timezone, date);
  const events = await listEventOccurrences(db, principal, {
    from: civil.startUTC < local.startUTC ? civil.startUTC : local.startUTC,
    to: civil.endUTC > local.endUTC ? civil.endUTC : local.endUTC,
    calendarIds,
  });

  return events.filter((event) => {
    const { startUTC, endUTC } = event.all_day ? civil : local;
    const start = Date.parse(event.starts_at);
    return (
      event.status !== 'CANCELLED' &&
      start < Date.parse(endUTC) &&
      (start >= Date.parse(startUTC) || Date.parse(event.ends_at) > Date.parse(startUTC))
    );
  });
}

async function linkedTasks(db: MigrationDb, refs: EventRef[]) {
  const pairs = [
    ...new Map(refs.map((ref) => [markKey(ref.calendar_id, ref.uid, null), ref])).values(),
  ];
  const tasks: EventTask[] = [];
  for (let offset = 0; offset < pairs.length; offset += 400) {
    const values = pairs
      .slice(offset, offset + 400)
      .map(({ calendar_id, uid }) => sql`(${calendar_id}, ${uid})`);
    const result = await sql<EventTask>`
      SELECT id, title, event_calendar_id AS calendar_id, event_uid AS uid,
             event_recurrence_id AS recurrence_id, due_date, project_id, status, ai_mode, version
      FROM tasks WHERE deleted_at IS NULL AND event_uid IS NOT NULL
        AND (event_calendar_id, event_uid) IN (VALUES ${sql.join(values)})
      ORDER BY created_at, id
    `.execute(db);
    tasks.push(...result.rows);
  }
  return tasks;
}

function indexTasks(tasks: EventTask[], events: EventOccurrenceView[], timezone: string) {
  const byOccurrence = new Map<string, EventTask>();
  for (const task of tasks) if (!byOccurrence.has(keyOf(task))) byOccurrence.set(keyOf(task), task);

  // Una conversió antiga amb data però sense RECURRENCE-ID només pot ocupar una cita.
  const assigned = new Set<string>();
  for (const event of events) {
    if (event.recurrence_id === null || byOccurrence.has(keyOf(event))) continue;
    const legacy = byOccurrence.get(markKey(event.calendar_id, event.uid, null));
    if (
      legacy === undefined ||
      assigned.has(legacy.id) ||
      legacy.due_date !== eventDateOf(timezone, event.starts_at, event.all_day)
    )
      continue;
    byOccurrence.set(keyOf(event), legacy);
    assigned.add(legacy.id);
  }
  return byOccurrence;
}

async function alreadyStarted(db: MigrationDb, tasks: EventTask[]): Promise<Set<string>> {
  const pending = tasks.filter((task) => task.status === 'inbox' || task.status === 'todo');
  const started = new Set(
    tasks
      .filter((task) => task.status === 'doing' || task.status === 'done')
      .map((task) => task.id),
  );
  for (let offset = 0; offset < pending.length; offset += 500) {
    const ids = pending.slice(offset, offset + 500).map((task) => task.id);
    const result = await sql<{ entity_id: string; changes: string }>`
      SELECT entity_id, changes FROM activity_log
      WHERE entity_type = 'task' AND entity_id IN (${sql.join(ids)}) AND changes IS NOT NULL
        AND verb IN ('created', 'moved', 'completed', 'reopened', 'resumed', 'taken_over', 'updated')
    `.execute(db);
    for (const row of result.rows) {
      const status = (JSON.parse(row.changes) as { status?: { from: unknown; to: unknown } })
        .status;
      if ([status?.from, status?.to].some((value) => value === 'doing' || value === 'done'))
        started.add(row.entity_id);
    }
  }
  return started;
}

async function getSnapshot(db: MigrationDb, principal: Principal, now: Date): Promise<Snapshot> {
  const profile = await getProfile(db, principal.userId);
  const settings = await getSettings(db, principal.userId);
  const timezone = profile.timezone;
  const date = localDateOf(timezone, now);
  const snapshot: Snapshot = {
    enabled: settings.calendar_task_suggestions,
    date,
    timezone,
    day_ends_at: localDayBounds(timezone, date).endUTC,
    items: [],
  };
  if (!snapshot.enabled) return snapshot;

  const calendars = (await listCalendars(db, principal)).filter(
    (calendar) =>
      calendar.kind === 'events' &&
      calendar.source_kind !== 'rss' &&
      !settings.hidden_calendar_ids.includes(calendar.id),
  );
  if (calendars.length === 0) return snapshot;
  const byCalendar = new Map(calendars.map((calendar) => [calendar.id, calendar]));
  const events = await dayEvents(db, principal, date, timezone, [...byCalendar.keys()]);
  if (events.length === 0) return snapshot;

  const calendarIds = [...new Set(events.map((event) => event.calendar_id))];
  const scopes = new Map((await listScopes(db, principal)).map((scope) => [scope.id, scope]));
  const scopeIds = [...new Set(events.map((event) => event.scope_id))];
  const roles = new Map(
    await Promise.all(
      scopeIds.map(async (id) => [id, await roleOf(db, principal.userId, id)] as const),
    ),
  );
  const configs = await settingsOfMany(db, scopeIds);
  const tasks = await linkedTasks(db, events);
  const byOccurrence = indexTasks(tasks, events, timezone);
  const started = await alreadyStarted(db, tasks);
  const marks = await sql<EventRef>`
    SELECT calendar_id, uid, NULLIF(recurrence_key, '') AS recurrence_id
    FROM calendar_suggestion_declines WHERE user_id = ${principal.userId}
      AND calendar_id IN (${sql.join(calendarIds)})
  `.execute(db);
  const declined = new Set(marks.rows.map(keyOf));

  for (const event of events) {
    const calendar = byCalendar.get(event.calendar_id)!;
    const task = byOccurrence.get(keyOf(event));
    if (task !== undefined && (started.has(task.id) || task.ai_mode !== 'manual')) continue;
    const role = roles.get(event.scope_id);
    const config = configs.get(event.scope_id);
    snapshot.items.push({
      calendar_id: event.calendar_id,
      uid: event.uid,
      recurrence_id: event.recurrence_id,
      scope_id: event.scope_id,
      project_id: task === undefined ? calendar.project_id : task.project_id,
      title: task?.title ?? event.summary,
      calendar_name: calendar.name,
      starts_at: event.starts_at,
      ends_at: event.ends_at,
      all_day: event.all_day,
      declined: declined.has(keyOf(event)),
      can_start:
        role != null &&
        roleCan(role, 'content') &&
        hasCapability(principal, task === undefined ? 'tasks:create' : 'tasks:move'),
      requires_share_confirmation:
        task === undefined &&
        scopes.get(event.scope_id)?.kind === 'collective' &&
        !isTrue(calendar.shared_with_scope),
      requires_task_type:
        task === undefined && config?.task_types_enabled === true && config.task_type_required,
      task_id: task?.id ?? null,
    });
  }
  return snapshot;
}

export async function getCalendarTaskSuggestions(
  db: MigrationDb,
  principal: Principal,
): Promise<Snapshot> {
  requireHumanSession(principal);
  return getSnapshot(db, principal, new Date());
}

function invalid(detail: string): PolicyError {
  return new PolicyError('invalid-calendar-suggestion', 'Invalid calendar suggestion', 422, detail);
}

async function applyAction(
  ctx: AuditContext,
  principal: Principal,
  engine: Engine,
  command: Action,
): Promise<Task | undefined> {
  const now = Date.parse(ctx.now);
  const supplied = Date.parse(command.action_at);
  if (!Number.isFinite(supplied) || supplied > now + 300_000)
    throw invalid('The device time is invalid.');
  const actionAt = new Date(Math.min(supplied, now));
  const settings = await getSettings(ctx.tx, principal.userId);
  if (!settings.calendar_task_suggestions) throw invalid('Calendar suggestions are turned off.');
  const calendar = (await listCalendars(ctx.tx, principal)).find(
    (row) => row.id === command.occurrence.calendar_id,
  );
  if (
    calendar === undefined ||
    calendar.kind !== 'events' ||
    calendar.source_kind === 'rss' ||
    settings.hidden_calendar_ids.includes(calendar.id)
  )
    throw notFound('calendar', command.occurrence.calendar_id);

  await lockEventTaskSeries(ctx.tx, engine, command.occurrence);
  const timezone = (await getProfile(ctx.tx, principal.userId)).timezone;
  const date = localDateOf(timezone, actionAt);
  const events = await dayEvents(ctx.tx, principal, date, timezone, [calendar.id]);
  const event = events.find((candidate) => keyOf(candidate) === keyOf(command.occurrence));
  if (event === undefined || Date.parse(event.starts_at) !== Date.parse(command.starts_at))
    throw new PolicyError(
      'calendar-suggestion-changed',
      'Calendar suggestion changed',
      409,
      'Refresh the board and choose a start time again.',
    );

  const { calendar_id, uid, recurrence_id } = event;
  const recurrenceKey = recurrence_id ?? '';
  const planned = Date.parse(event.starts_at);
  const during = isCurrentCalendarSuggestion({ ...event, declined: false }, actionAt.getTime());

  if (command.type === 'decline') {
    if (!during) throw invalid('Only an active suggestion can be declined.');
    const inserted = await sql`
      INSERT INTO calendar_suggestion_declines (user_id, calendar_id, uid, recurrence_key)
      VALUES (${principal.userId}, ${calendar_id}, ${uid}, ${recurrenceKey})
      ON CONFLICT DO NOTHING
    `.execute(ctx.tx);
    if (Number(inserted.numAffectedRows ?? 0) === 0) ctx.noChange();
    else
      ctx.record({
        entityType: 'calendar_suggestion',
        entityId: event.event_id,
        verb: 'updated',
        changes: {
          declined: { from: false, to: true },
          recurrence_id: { from: null, to: recurrence_id },
        },
      });
    return undefined;
  }

  const scope = await assertScopeRole(ctx.tx, principal, calendar.scope_id, 'content');
  const existing = indexTasks(await linkedTasks(ctx.tx, [event]), events, timezone).get(
    keyOf(event),
  );
  if (existing !== undefined && (await alreadyStarted(ctx.tx, [existing])).has(existing.id)) {
    ctx.noChange();
    return getTask(ctx.tx, principal, existing.id);
  }

  const position = command.position;
  try {
    generatePosition(position, null, () => 0);
  } catch {
    throw invalid('Provide a valid task position.');
  }
  if (command.start === 'planned') {
    const mark = await sql<{ found: number }>`
      SELECT 1 AS found FROM calendar_suggestion_declines WHERE user_id = ${principal.userId}
        AND calendar_id = ${calendar_id} AND uid = ${uid} AND recurrence_key = ${recurrenceKey}
    `.execute(ctx.tx);
    if (!during || mark.rows.length > 0) throw invalid('The planned start is no longer available.');
  }
  const occurredAt =
    command.start === 'planned' ? new Date(planned).toISOString() : actionAt.toISOString();
  if (existing !== undefined) {
    if (existing.ai_mode !== 'manual') throw invalid('The task is on the AI board.');
    // Una versió esperada evita trepitjar un moviment que ha entrat pel tauler normal.
    return moveTask(ctx, principal, existing.id, {
      status: 'doing',
      position,
      occurred_at: occurredAt,
      from_status: existing.status,
      expected_version: existing.version,
    });
  }

  if (
    scope.kind === 'collective' &&
    !isTrue(calendar.shared_with_scope) &&
    command.confirm_share !== true
  )
    throw invalid('Confirm that the task title will be visible in the shared scope.');
  const reserved = await sql<{
    id: string;
  }>`SELECT id FROM tasks WHERE id = ${command.task_id}`.execute(ctx.tx);
  if (reserved.rows.length > 0) throw invalid('Use an unused task identifier.');

  const { task, created } = await createTask(
    ctx,
    principal,
    {
      id: command.task_id,
      scope_id: scope.id,
      project_id: calendar.project_id,
      title: event.summary,
      status: 'doing',
      position,
      task_type_id: command.task_type_id,
      source_event: { calendar_id, uid, recurrence_id },
    },
    engine,
    occurredAt,
  );
  if (!created) throw invalid('Use an unused task identifier.');
  return task;
}

export async function syncCalendarTaskSuggestions(
  connection: Connection,
  principal: Principal,
  operation: BatchOperation,
): Promise<BatchResult> {
  requireHumanSession(principal);
  if (operation.op !== 'update' || operation.id !== principal.userId)
    throw invalid('Calendar suggestions must update your own account.');
  const decoded = commandSchema.safeParse(operation.data);
  if (!decoded.success) throw invalid('Provide a calendar suggestion command.');
  const command = decoded.data;

  return auditedTransaction(
    connection.db,
    principal,
    async (ctx): Promise<BatchResult> => {
      await lockSyncOp(ctx.tx, connection.engine, principal, operation.op_id);
      if (connection.engine === 'postgres') {
        await sql`SELECT pg_advisory_xact_lock(851007, hashtext(${principal.userId}))`.execute(
          ctx.tx,
        );
      }
      const previous = await recallOp(ctx.tx, principal, operation);
      let task: Task | undefined;
      if (previous?.status === 'ok') {
        ctx.noChange();
        const taskId = previous.entity?.task_id;
        if (
          command.type === 'start' &&
          typeof taskId === 'string' &&
          (await visibleCalendarIds(ctx.tx, principal.userId)).has(command.occurrence.calendar_id)
        ) {
          try {
            task = await getTask(ctx.tx, principal, taskId);
          } catch (error) {
            if (!(error instanceof PolicyError) || ![403, 404].includes(error.status)) throw error;
          }
        }
      } else if (command.type === 'configure') {
        const before = (await getSettings(ctx.tx, principal.userId)).calendar_task_suggestions;
        if (before === command.enabled) ctx.noChange();
        else {
          await sql`
          INSERT INTO user_settings (user_id, calendar_task_suggestions, updated_at)
          VALUES (${principal.userId}, ${dbBool(command.enabled)}, ${ctx.now})
          ON CONFLICT (user_id) DO UPDATE SET calendar_task_suggestions = excluded.calendar_task_suggestions,
            updated_at = excluded.updated_at
        `.execute(ctx.tx);
          ctx.record({
            entityType: 'user_settings',
            entityId: principal.userId,
            verb: 'updated',
            changes: { calendar_task_suggestions: { from: before, to: command.enabled } },
          });
        }
      } else {
        task = await applyAction(ctx, principal, connection.engine, command);
      }

      if (previous === undefined)
        await rememberOp(
          ctx.tx,
          principal,
          operation,
          {
            op_id: operation.op_id,
            status: 'ok',
            ...(task === undefined ? {} : { entity: { task_id: task.id } }),
          },
          ctx.now,
        );
      if (task !== undefined) {
        const summary = (await taskTimeSummaries(ctx.tx, principal, [task])).get(task.id);
        if (summary !== undefined) task.time_summary = summary;
      }
      const entity: Result = {
        snapshot: await getSnapshot(ctx.tx, principal, new Date(ctx.now)),
        ...(task === undefined ? {} : { task: task as components['schemas']['Task'] }),
      };
      return { op_id: operation.op_id, status: 'ok', entity };
    },
    { engine: connection.engine },
  );
}
