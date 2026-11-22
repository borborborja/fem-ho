import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { Capability } from '../policy/capabilities.js';
import { visibleCalendarIds } from '../policy/calendar-visibility.js';
import { missingCapability, notFound, PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertWritable, type CalendarRow } from './events.js';
import { assertScopeRole } from './scopes.js';
import { assertWritable as assertTaskWritable, type Task } from './tasks.js';

export const SYNC_WRITES = {
  task: { table: 'tasks', edit: 'tasks:write', remove: 'tasks:delete' },
  subtask: { table: 'subtasks', edit: 'tasks:write', remove: 'tasks:write' },
  checklist: { table: 'checklists', edit: 'checklists:write', remove: 'checklists:write' },
  checklist_item: {
    table: 'checklist_items',
    edit: 'checklists:write',
    remove: 'checklists:write',
  },
  comment: { table: 'comments', edit: 'comments:write', remove: 'comments:write' },
  project: { table: 'projects', edit: 'projects:write', remove: 'projects:write' },
  event: { table: 'events', edit: 'events:write', remove: 'events:delete' },
} as const satisfies Record<string, { table: string; edit: Capability; remove: Capability }>;

export type SyncWritable = keyof typeof SYNC_WRITES;
export type SyncChild = Exclude<SyncWritable, 'task'>;

const SYNC_EDITABLE_FIELDS = {
  subtask: ['title', 'done', 'position'],
  checklist: ['name', 'show_completed_inline', 'subtask_id', 'position'],
  checklist_item: ['text', 'done', 'position'],
  comment: ['body'],
  project: ['name', 'ai_instructions', 'ai_description', 'position', 'archived_at'],
  event: [
    'summary',
    'description',
    'location',
    'starts_at',
    'ends_at',
    'all_day',
    'timezone',
    'status',
    'transparency',
    'rrule',
  ],
} satisfies Record<SyncChild, readonly string[]>;

export function assertSyncEditableFields(entity: SyncChild, fields: readonly string[]): void {
  const valid: readonly string[] = SYNC_EDITABLE_FIELDS[entity];
  if (fields.some((field) => !valid.includes(field))) {
    throw new PolicyError(
      'invalid-sync-field',
      'Invalid sync field',
      422,
      'Immutable or invalid field.',
    );
  }
}

const SYNC_READS: Readonly<Partial<Record<string, Capability>>> = {
  task: 'tasks:read',
  subtask: 'tasks:read',
  checklist: 'checklists:read',
  checklist_item: 'checklists:read',
  comment: 'comments:read',
  scope: 'scopes:read',
  project: 'projects:read',
  event: 'events:read',
  calendar: 'events:read',
  attachment: 'attachments:read',
};

export function canReadSyncEntity(principal: Principal, entity: string): boolean {
  const capability = Object.hasOwn(SYNC_READS, entity) ? SYNC_READS[entity] : undefined;
  return capability !== undefined && hasCapability(principal, capability);
}

export function assertSyncWriteCapability(
  principal: Principal,
  entity: SyncWritable,
  op: 'create' | 'update' | 'delete' | 'move',
): void {
  const { edit, remove } = SYNC_WRITES[entity];
  const capability = op === 'delete' ? remove : edit;
  if (!hasCapability(principal, capability)) throw missingCapability(capability);
}

function parentId(row: Record<string, unknown>, entity: SyncWritable, field: string): string {
  const value = row[field];
  if (typeof value === 'string' && value !== '') return value;
  throw new PolicyError(
    'parent-required',
    'Parent required',
    422,
    `A "${entity}" needs "${field}".`,
    { entity, field },
  );
}

/** La fila del servidor governa les edicions. La cua només tria el pare quan crea la fila. */
export async function assertSyncContentAccess(
  ctx: Pick<AuditContext, 'tx' | 'now'>,
  principal: Principal,
  entity: SyncWritable,
  row: Record<string, unknown>,
  operation: 'create' | 'update' | 'move' | 'delete',
): Promise<string> {
  const db = ctx.tx;
  if (entity === 'event') {
    const calendarId = parentId(row, entity, 'calendar_id');
    const calendars = await visibleCalendarIds(db, principal.userId);
    if (!calendars.has(calendarId)) throw notFound('calendar', calendarId);
    const found = await sql<
      Pick<
        CalendarRow,
        'scope_id' | 'origin' | 'source_kind' | 'source_provider' | 'writable' | 'name'
      >
    >`
      SELECT scope_id, origin, source_kind, source_provider, writable, name
      FROM calendars WHERE id = ${calendarId} AND deleted_at IS NULL
    `.execute(db);
    const calendar = found.rows[0];
    if (calendar === undefined) throw notFound('calendar', calendarId);
    if (calendar.source_provider === 'google') {
      throw new PolicyError(
        'google-calendar-queued-write',
        'Google Calendar',
        422,
        'Use the Google Calendar outbox.',
      );
    }
    await assertScopeRole(db, principal, calendar.scope_id, 'content');
    assertWritable(calendar);
    return calendar.scope_id;
  }

  let scopeId: string;
  let task: { id: string; ai_mode: Task['ai_mode'] } | undefined;
  // El pare segueix donant l'àmbit a una tombstone per poder confirmar-ne un reintent.
  const tombstone = row.deleted_at != null;
  if (entity === 'task' || entity === 'project') {
    scopeId = parentId(row, entity, 'scope_id');
    if (entity === 'task' && operation !== 'create') {
      task = { id: parentId(row, entity, 'id'), ai_mode: row.ai_mode as Task['ai_mode'] };
    }
  } else if (entity === 'checklist_item') {
    const checklistId = parentId(row, entity, 'checklist_id');
    const found = await sql<{ id: string; scope_id: string; ai_mode: Task['ai_mode'] }>`
      SELECT t.id, t.scope_id, t.ai_mode FROM checklists c JOIN tasks t ON t.id = c.task_id
      WHERE c.id = ${checklistId}
        AND (${tombstone ? sql`1 = 1` : sql`c.deleted_at IS NULL AND t.deleted_at IS NULL`})
    `.execute(db);
    const parent = found.rows[0];
    if (parent === undefined) throw notFound('checklist', checklistId);
    scopeId = parent.scope_id;
    task = parent;
  } else {
    const taskId = parentId(row, entity, 'task_id');
    const found = await sql<{ id: string; scope_id: string; ai_mode: Task['ai_mode'] }>`
      SELECT id, scope_id, ai_mode FROM tasks WHERE id = ${taskId}
      ${tombstone ? sql`` : sql`AND deleted_at IS NULL`}
    `.execute(db);
    const parent = found.rows[0];
    if (parent === undefined) throw notFound('task', taskId);
    scopeId = parent.scope_id;
    if (entity !== 'comment' || operation !== 'create') task = parent;
  }

  await assertScopeRole(db, principal, scopeId, 'content');
  if (principal.kind === 'agent' && task !== undefined)
    await assertTaskWritable(ctx, principal, task, 'edit');
  return scopeId;
}
