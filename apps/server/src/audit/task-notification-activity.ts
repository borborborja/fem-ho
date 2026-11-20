import { isDeepStrictEqual } from 'node:util';
import { TASK_STATUSES, type TaskStatus } from '@fem-ho/contracts';
import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';
import {
  enqueueTaskActivityNotifications,
  type TaskActivityKind,
} from '../services/task-activity-notifications.js';
import type { AuditEntry, AuditVerb } from './audited-transaction.js';

interface ActivityChange {
  created?: true;
  taskStatus?: true;
  subtaskStatus?: true;
  activity?: true;
}

const taskStatuses = new Set<unknown>(TASK_STATUSES);
const moveFields = new Set(['status', 'position', 'occurred_at', 'completed_at']);
const positionField = new Set(['position']);
const subtaskStatusFields = new Set(['done', 'position']);
const taskChildren = new Set(['subtask', 'checklist', 'checklist_item', 'attachment']);
const childEditVerbs = new Set<AuditVerb>(['updated', 'completed', 'reopened', 'cascade_complete']);
const taskEditVerbs = new Set<AuditVerb>([...childEditVerbs, 'moved', 'taken_over']);

function changesOutside(entry: AuditEntry, ignored: ReadonlySet<string>): boolean {
  return Object.entries(entry.changes ?? {}).some(
    ([field, change]) => !ignored.has(field) && !isDeepStrictEqual(change.from, change.to),
  );
}

function describeChange(entry: AuditEntry): ActivityChange | undefined {
  const { entityType, verb, changes } = entry;
  if (entityType === 'task') {
    if (verb === 'created')
      return changes?.recurrence_parent_id === undefined ? { created: true } : undefined;
    if (verb === 'commented' || verb === 'asked' || verb === 'ai_execution_result')
      return { activity: true };
    if (!taskEditVerbs.has(verb)) return undefined;

    const status = changes?.status;
    const taskStatus =
      status !== undefined &&
      taskStatuses.has(status.from) &&
      taskStatuses.has(status.to) &&
      status.from !== status.to;
    const activity = changesOutside(entry, moveFields);
    return { ...(taskStatus && { taskStatus: true }), ...(activity && { activity: true }) };
  }

  if (!taskChildren.has(entityType)) return undefined;
  if (verb === 'created' || verb === 'deleted') return { activity: true };
  if (!childEditVerbs.has(verb)) return undefined;

  if (entityType !== 'subtask')
    return changesOutside(entry, positionField) ? { activity: true } : undefined;

  const done = changes?.done;
  const subtaskStatus =
    typeof done?.from === 'boolean' && typeof done.to === 'boolean' && done.from !== done.to;
  const activity = changesOutside(entry, subtaskStatusFields);
  return { ...(subtaskStatus && { subtaskStatus: true }), ...(activity && { activity: true }) };
}

function kindsForTask(change: ActivityChange, status: TaskStatus): TaskActivityKind[] {
  // El destí mana per a Inbox. Crear la fitxa o entrar-hi té un interruptor propi,
  // encara que el mateix gest també hagi afegit camps, subtasques o adjunts.
  if (status === 'inbox') return change.created || change.taskStatus ? ['inbox_entry'] : [];
  if (change.created) return ['task_created'];

  const kinds: TaskActivityKind[] = [];
  if (change.taskStatus || change.subtaskStatus) kinds.push('status_changed');
  if (change.activity) kinds.push('task_activity');
  return kinds;
}

export async function enqueueAuditedTaskActivity(
  tx: MigrationDb,
  principal: Principal,
  entries: readonly AuditEntry[],
  now: string,
): Promise<void> {
  if (
    (principal.source !== 'api' && principal.source !== 'mcp') ||
    (principal.credentialType !== 'pat' && principal.credentialType !== 'oauth')
  )
    return;

  const changes = new Map<string, ActivityChange>();
  for (const entry of entries) {
    const taskId = entry.entityType === 'task' ? entry.entityId : entry.taskId;
    if (taskId === undefined) continue;
    const change = describeChange(entry);
    if (change === undefined || Object.keys(change).length === 0) continue;
    changes.set(taskId, { ...changes.get(taskId), ...change });
  }
  if (changes.size === 0) return;

  // L'auditoria pot dur l'àmbit d'origen. La fitxa de destí decideix quins membres
  // poden obrir l'avís i si el canvi ha acabat a Inbox.
  const { rows } = await sql<{ id: string; scope_id: string; status: TaskStatus }>`
    SELECT id, scope_id, status FROM tasks
    WHERE deleted_at IS NULL AND id IN (${sql.join([...changes.keys()])})
  `.execute(tx);
  for (const task of rows) {
    const kinds = kindsForTask(changes.get(task.id)!, task.status);
    if (kinds.length > 0)
      await enqueueTaskActivityNotifications(tx, {
        taskId: task.id,
        scopeId: task.scope_id,
        kinds,
        now,
      });
  }
}
