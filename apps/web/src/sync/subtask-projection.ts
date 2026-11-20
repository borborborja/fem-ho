import { comparePositions, generatePosition } from '@fem-ho/contracts';
import type { Checklist, Subtask } from '../app/types.js';
import type { OutboxRow } from './db.js';
import { compareOperations } from './outbox.js';

export type ListProgress = { done: number; total: number; lists: number };

export function taskListPath(taskId: string, collection: 'subtasks' | 'checklists'): string {
  return `/api/v1/tasks/${taskId}/${collection}`;
}

export function projectSubtasks(
  taskId: string,
  base: Subtask[],
  rows: OutboxRow[],
): { subtasks: Subtask[]; deleted: Set<string> } {
  const subtasks = new Map(base.map((subtask) => [subtask.id, subtask]));
  const deleted = new Set<string>();
  const blocked = new Set<string>();
  const pending = rows
    .filter((row) => row.entity_type === 'subtask' && row.parent_task_id === taskId)
    .sort(compareOperations);
  for (const row of pending) {
    if (row.status === 'failed' || row.status === 'conflict') blocked.add(row.entity_id);
    if (blocked.has(row.entity_id)) continue;
    const current = subtasks.get(row.entity_id);
    const { title, done, position } = row.payload;
    if (row.op === 'delete') {
      deleted.add(row.entity_id);
      subtasks.delete(row.entity_id);
    } else if (row.op === 'create' && current === undefined && typeof title === 'string') {
      const last = [...subtasks.values()].sort(compareSubtasks).at(-1);
      subtasks.set(row.entity_id, {
        id: row.entity_id,
        task_id: taskId,
        title,
        done: false,
        position:
          typeof position === 'string'
            ? position
            : generatePosition(last?.position ?? null, null, () => 0.5),
        version: 0,
      });
    } else if (row.op === 'update' && current !== undefined) {
      subtasks.set(row.entity_id, {
        ...current,
        title: typeof title === 'string' ? title : current.title,
        done: typeof done === 'boolean' ? done : current.done,
      });
    }
  }
  return { subtasks: [...subtasks.values()].sort(compareSubtasks), deleted };
}

export function compareSubtasks(a: Subtask, b: Subtask): number {
  return comparePositions(a.position, b.position) || comparePositions(a.id, b.id);
}

export function detachChecklists(checklists: Checklist[], deleted: Set<string>): Checklist[] {
  return checklists.map((checklist) =>
    checklist.subtask_id != null && deleted.has(checklist.subtask_id)
      ? { ...checklist, subtask_id: null }
      : checklist,
  );
}

export function listProgress(subtasks: Subtask[], checklists: Checklist[]): ListProgress {
  let done = subtasks.filter((subtask) => subtask.done).length;
  let total = subtasks.length;
  for (const { items } of checklists) {
    done += items.filter((item) => item.done).length;
    total += items.length;
  }
  return { done, total, lists: Number(subtasks.length > 0) + checklists.length };
}
