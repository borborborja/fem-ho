import { v7 as uuidv7 } from 'uuid';
import type { PomodoroSnapshot } from '@fem-ho/contracts';
import { ApiError } from '../app/api.js';
import type { Board, Checklist, Inbox, Subtask, Task } from '../app/types.js';
import { FemHoDatabase, readMeta, writeMeta, type OutboxRow } from './db.js';
import { applyResults, compareOperations, type OperationResult } from './outbox.js';
import {
  compareSubtasks,
  detachChecklists,
  listProgress,
  taskListPath,
  type ListProgress,
} from './subtask-projection.js';

const BOARD_PATH = '/api/v1/board?';
const INBOX_PATH = '/api/v1/inbox?';
export const POMODORO_PATH = '/api/v1/pomodoro';
export type CachedPomodoro = PomodoroSnapshot & { observed_at_ms?: number };
const BOARD_CACHE_REVISION = 'board-cache-revision';
const SNAPSHOT_PREFIX = 'snapshot:';

function protectsReceipts(path: string): boolean {
  return (
    path.startsWith(BOARD_PATH) ||
    path.startsWith(INBOX_PATH) ||
    path === POMODORO_PATH ||
    /^\/api\/v1\/tasks\/[^/]+\/(subtasks|checklists)$/.test(path)
  );
}

/** IndexedDB ja està aïllat per origen. La base de la demo té un altre nom. */
export function accountDatabase(userId: string): FemHoDatabase {
  return new FemHoDatabase(`fem-ho-account:${userId}`);
}

export function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof ApiError && [502, 503, 504].includes(error.status))
  );
}

export async function readSnapshot<T>(db: FemHoDatabase, key: string): Promise<T | undefined> {
  try {
    const value = await readMeta(db, `${SNAPSHOT_PREFIX}${key}`);
    return value === undefined ? undefined : (JSON.parse(value) as T);
  } catch {
    return undefined;
  }
}

export async function writeSnapshot<T>(db: FemHoDatabase, key: string, value: T): Promise<void> {
  // Bloquejar IndexedDB al navegador no ha d'impedir fer servir l'aplicació en línia.
  await writeMeta(db, `${SNAPSHOT_PREFIX}${key}`, JSON.stringify(value)).catch(() => undefined);
}

export function boardSnapshotRevision(
  db: FemHoDatabase,
  path: string,
): Promise<string | undefined> {
  if (!protectsReceipts(path)) return Promise.resolve(undefined);
  return readMeta(db, BOARD_CACHE_REVISION).catch(() => undefined);
}

export async function saveBoardQuery<T>(
  db: FemHoDatabase,
  path: string,
  value: T,
  startRevision: string | undefined,
): Promise<T> {
  if (!protectsReceipts(path)) {
    await writeSnapshot(db, path, value);
    return value;
  }
  return db
    .transaction('rw', db.meta, async () => {
      // Un GET començat abans del rebut pot desfer un moviment o fer reaparèixer una subtasca.
      if ((await readMeta(db, BOARD_CACHE_REVISION)) !== startRevision)
        return (await readSnapshot<T>(db, path)) ?? value;
      if (path === POMODORO_PATH) {
        const latest = await readSnapshot<CachedPomodoro>(db, path);
        // El GET no porta el moviment del rebut. Mantén-lo fins que el tauler torni a
        // carregar, perquè l'optimisme no faci recular la targeta durant aquest interval.
        const next = { ...value, moved_task: latest?.moved_task, observed_at_ms: Date.now() };
        await writeSnapshot(db, path, next);
        return next;
      }
      await writeSnapshot(db, path, value);
      return value;
    })
    .catch(() => value);
}

function subtaskEntity(entity: Record<string, unknown> | undefined): Subtask | undefined {
  if (
    entity === undefined ||
    typeof entity.id !== 'string' ||
    typeof entity.task_id !== 'string' ||
    typeof entity.title !== 'string' ||
    typeof entity.position !== 'string' ||
    typeof entity.version !== 'number'
  )
    return undefined;

  return {
    id: entity.id,
    task_id: entity.task_id,
    title: entity.title,
    position: entity.position,
    version: entity.version,
    // El lot pot tornar una fila de SQLite. El GET de subtasques ja la normalitza.
    done: entity.done === true || entity.done === 1 || entity.done === '1' || entity.done === 't',
  };
}

async function rebaseFollowingSubtask(
  db: FemHoDatabase,
  confirmed: OutboxRow,
  entity: Subtask,
): Promise<void> {
  const pending = await db.outbox
    .where('[entity_type+entity_id]')
    .equals(['subtask', entity.id])
    .toArray();
  const next = pending
    .filter((row) => compareOperations(row, confirmed) > 0)
    .sort(compareOperations)[0];
  if (next?.op !== 'update' || next.status !== 'pending') return;
  if (next.base_version !== undefined && next.base_version >= entity.version) return;
  // Una confirmació pròpia permet partir de la nova versió. Si ha canviat el títol
  // que es va editar, el servidor encara ha de poder detectar l'edició externa.
  if (next.payload.title !== undefined && next.observed_title !== entity.title) return;
  await db.outbox.update(next.id, { base_version: entity.version });
}

async function applySubtaskReceipt(
  db: FemHoDatabase,
  row: OutboxRow,
  response: OperationResult,
): Promise<{ taskId: string; progress: ListProgress | undefined } | undefined> {
  const taskId = row.parent_task_id;
  if (taskId === undefined || response.status === 'rejected') return undefined;

  const raw = response.status === 'ok' ? response.entity : response.server_entity;
  const deleted = (response.status === 'ok' && row.op === 'delete') || raw?.deleted_at != null;
  const entity = subtaskEntity(raw);
  if (!deleted && (entity?.id !== row.entity_id || entity.task_id !== taskId)) return undefined;

  const subtasksPath = taskListPath(taskId, 'subtasks');
  const current = (await readSnapshot<Subtask[]>(db, subtasksPath)) ?? [];
  const previous = current.find((subtask) => subtask.id === row.entity_id);
  if (entity !== undefined && previous !== undefined && previous.version > entity.version)
    return undefined;

  const remaining = current.filter((subtask) => subtask.id !== row.entity_id);
  if (!deleted && entity !== undefined) {
    remaining.push(entity);
    if (response.status === 'ok') await rebaseFollowingSubtask(db, row, entity);
  }
  await writeMeta(
    db,
    `${SNAPSHOT_PREFIX}${subtasksPath}`,
    JSON.stringify(remaining.sort(compareSubtasks)),
  );

  const checklistsPath = taskListPath(taskId, 'checklists');
  let checklists = await readSnapshot<Checklist[]>(db, checklistsPath);
  if (checklists !== undefined && deleted) {
    checklists = detachChecklists(checklists, new Set([row.entity_id]));
    await writeMeta(db, `${SNAPSHOT_PREFIX}${checklistsPath}`, JSON.stringify(checklists));
  }
  return {
    taskId,
    progress: checklists === undefined ? undefined : listProgress(remaining, checklists),
  };
}

export async function applyBoardResults(
  db: FemHoDatabase,
  sent: OutboxRow[],
  results: OperationResult[],
): Promise<void> {
  const byId = new Map(results.map((result) => [result.op_id, result]));
  await db.transaction('rw', db.outbox, db.entities, db.meta, async () => {
    const confirmed: Task[] = [];
    const taskProgress = new Map<string, ListProgress>();
    let listsChanged = false;
    let pomodoroChanged = false;
    for (const row of sent) {
      const result = byId.get(row.id);
      if (result === undefined) continue;
      if (row.entity_type === 'pomodoro') {
        const raw = result.status === 'ok' ? result.entity : result.server_entity;
        if (typeof raw?.server_time_ms !== 'number' || !Array.isArray(raw.queue)) continue;
        const snapshot = raw as unknown as PomodoroSnapshot;
        const previous = await readSnapshot<PomodoroSnapshot>(db, POMODORO_PATH);
        const moved = snapshot.moved_task;
        if (moved !== undefined) confirmed.push(moved);
        await writeMeta(
          db,
          `${SNAPSHOT_PREFIX}${POMODORO_PATH}`,
          JSON.stringify({
            ...snapshot,
            moved_task: moved ?? previous?.moved_task,
            observed_at_ms: Date.now(),
          }),
        );
        pomodoroChanged = true;
      } else if (
        row.entity_type === 'task' &&
        result.status === 'ok' &&
        result.entity?.id === row.entity_id
      ) {
        const task = result.entity as unknown as Task;
        confirmed.push(task);
        if (row.op === 'create' && task.progress?.lists === 0) {
          // Una tasca nova sense llistes té una base coneguda encara que s'hagi creat
          // en mode avió i no hagi pogut fer les lectures de la targeta.
          for (const collection of ['subtasks', 'checklists'] as const) {
            const key = `${SNAPSHOT_PREFIX}${taskListPath(task.id, collection)}`;
            if ((await readMeta(db, key)) === undefined) await writeMeta(db, key, '[]');
          }
        }
      } else if (row.entity_type === 'subtask') {
        const update = await applySubtaskReceipt(db, row, result);
        if (update === undefined) continue;
        listsChanged = true;
        if (update.progress !== undefined) taskProgress.set(update.taskId, update.progress);
      }
    }
    if (confirmed.length > 0 || taskProgress.size > 0) {
      const snapshots = await db.meta
        .where('key')
        .startsWith(`${SNAPSHOT_PREFIX}${BOARD_PATH}`)
        .toArray();
      for (const snapshot of snapshots) {
        const scopeIds = new URLSearchParams(
          snapshot.key.slice(`${SNAPSHOT_PREFIX}${BOARD_PATH}`.length),
        )
          .get('scope_ids')
          ?.split(',');
        const matching = confirmed.filter((task) => scopeIds?.includes(task.scope_id) ?? true);
        if (matching.length === 0 && taskProgress.size === 0) continue;
        const board = await readSnapshot<Board>(db, snapshot.key.slice(SNAPSHOT_PREFIX.length));
        if (board === undefined) continue;
        for (const task of matching) {
          const groups = board.columns.find((column) => column.status === task.status)?.groups;
          if (groups === undefined) continue;
          const existing = board.columns
            .flatMap((column) => column.groups)
            .flatMap((group) => group.tasks)
            .find((cached) => cached.id === task.id);
          if (existing !== undefined && existing.version > task.version) continue;
          for (const column of board.columns) {
            for (const group of column.groups) {
              group.tasks = group.tasks.filter((cached) => cached.id !== task.id);
            }
          }
          const target = groups.find((group) => group.scope_id === task.scope_id);
          if (target === undefined) groups.push({ scope_id: task.scope_id, tasks: [task] });
          else target.tasks.push(task);
        }
        for (const task of board.columns.flatMap((column) =>
          column.groups.flatMap((group) => group.tasks),
        )) {
          const progress = taskProgress.get(task.id);
          if (progress !== undefined) task.progress = progress;
        }
        await db.meta.put({ key: snapshot.key, value: JSON.stringify(board) });
      }
    }
    if (taskProgress.size > 0) {
      const snapshots = await db.meta
        .where('key')
        .startsWith(`${SNAPSHOT_PREFIX}${INBOX_PATH}`)
        .toArray();
      for (const snapshot of snapshots) {
        const inbox = await readSnapshot<Inbox>(db, snapshot.key.slice(SNAPSHOT_PREFIX.length));
        if (inbox === undefined) continue;
        for (const task of [...inbox.dated, ...inbox.undated, ...inbox.overdue]) {
          const progress = taskProgress.get(task.id);
          if (progress !== undefined) task.progress = progress;
        }
        await db.meta.put({ key: snapshot.key, value: JSON.stringify(inbox) });
      }
    }
    if (confirmed.length > 0 || listsChanged || pomodoroChanged) {
      await writeMeta(db, BOARD_CACHE_REVISION, uuidv7());
    }
    // Després del rebut, la targeta ha de seguir visible en desconnectar abans del GET.
    await applyResults(db, sent, results);
  });
}
