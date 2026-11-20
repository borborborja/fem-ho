import { comparePositions, type components } from '@fem-ho/contracts';
import type { Task } from '../app/types.js';
import type { OutboxRow } from './db.js';

type CreateTask = components['schemas']['TaskInput'];
type MoveTask = components['schemas']['MoveInput'] & { ai_mode?: Task['ai_mode'] };

/** El servidor conserva la versió de base. Les posicions i els temps locals s'hi projecten. */
export function projectBoardTasks(base: Task[], pending: OutboxRow[]): Task[] {
  const tasks = new Map(base.map((task) => [task.id, task]));
  const blocked = new Set<string>();
  for (const row of pending) {
    if (row.entity_type !== 'task') continue;
    if (row.status === 'failed' || row.status === 'conflict') blocked.add(row.entity_id);
    if (blocked.has(row.entity_id)) continue;
    if (row.op === 'create' && !tasks.has(row.entity_id)) {
      const data = row.payload as CreateTask;
      tasks.set(row.entity_id, {
        ...data,
        id: row.entity_id,
        scope_id: data.scope_id,
        title: data.title,
        status: data.status ?? 'inbox',
        position: data.position ?? '',
        view_mode: 'card',
        ai_mode: data.ai_mode ?? 'manual',
        needs_attention: false,
        completed_at: data.status === 'done' ? row.created_at : null,
        created_at: row.created_at,
        updated_at: row.created_at,
        version: 0,
      });
    } else if (row.op === 'move') {
      const task = tasks.get(row.entity_id);
      if (task === undefined) continue;
      const data = row.payload as MoveTask;
      const status = data.status ?? task.status;
      tasks.set(task.id, {
        ...task,
        status,
        ai_mode: data.ai_mode ?? task.ai_mode,
        position: data.position ?? task.position,
        completed_at: status !== 'done' ? null : (task.completed_at ?? row.created_at),
      });
    }
  }
  return [...tasks.values()].sort(
    (a, b) => comparePositions(a.position, b.position) || comparePositions(a.id, b.id),
  );
}
