import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Board, Checklist, Inbox, Subtask, Task } from '../app/types.js';
import {
  applyBoardResults,
  boardSnapshotRevision,
  readSnapshot,
  saveBoardQuery,
  writeSnapshot,
} from './cache.js';
import { FemHoDatabase, type OutboxRow } from './db.js';
import { discardBoardOperation, nextBoardOperations } from './outbox.js';
import {
  detachChecklists,
  listProgress,
  projectSubtasks,
  taskListPath,
} from './subtask-projection.js';

const taskId = 'task';
const childId = 'subtask';
const timestamp = '2026-11-20T10:00:00.000Z';
const boardPath = '/api/v1/board?scope_ids=scope';
const inboxPath = '/api/v1/inbox?date=2026-11-20';
const subtasksPath = taskListPath(taskId, 'subtasks');
const checklistsPath = taskListPath(taskId, 'checklists');
const child: Subtask = {
  id: childId,
  task_id: taskId,
  title: 'Primer títol',
  position: 'a0',
  done: false,
  version: 1,
};
let db: FemHoDatabase;

beforeEach(async () => {
  db = new FemHoDatabase(`subtasks-${Math.random()}`);
  await db.open();
});

afterEach(async () => {
  await db.delete();
});

function operation(id: string, patch: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id,
    entity_type: 'subtask',
    entity_id: childId,
    parent_task_id: taskId,
    op: 'update',
    payload: {},
    observed_title: child.title,
    base_version: 0,
    created_at: timestamp,
    status: 'pending',
    attempts: 0,
    ...patch,
  };
}

describe('cua web de subtasques', () => {
  it('espera la tasca mare i confirma la creació, el títol i la casella en ordre', async () => {
    const parent = operation('04', {
      entity_type: 'task',
      entity_id: taskId,
      parent_task_id: undefined,
      op: 'create',
    });
    const create = operation('01', {
      op: 'create',
      payload: { task_id: taskId, title: child.title },
    });
    const rename = operation('02', { payload: { title: 'Títol nou' } });
    const complete = operation('03', { payload: { done: true }, observed_title: 'Títol nou' });
    expect(nextBoardOperations([complete, rename, create, parent])).toEqual([parent]);
    expect(nextBoardOperations([create, { ...parent, status: 'failed' }])).toEqual([]);

    await db.outbox.bulkPut([parent, create, rename, complete]);
    db.close();
    await db.open();
    expect(projectSubtasks(taskId, [], await db.outbox.toArray()).subtasks).toMatchObject([
      { id: childId, done: true, title: 'Títol nou' },
    ]);

    expect(nextBoardOperations(await db.outbox.toArray())).toEqual([parent]);
    await applyBoardResults(
      db,
      [parent],
      [{ op_id: parent.id, status: 'ok', entity: { id: taskId, progress: listProgress([], []) } }],
    );
    expect(await readSnapshot(db, subtasksPath)).toEqual([]);
    expect(await readSnapshot(db, checklistsPath)).toEqual([]);
    expect(nextBoardOperations(await db.outbox.toArray())).toEqual([create]);
    await applyBoardResults(db, [create], [{ op_id: create.id, status: 'ok', entity: child }]);
    const rebasedRename = (await db.outbox.get(rename.id))!;
    expect(nextBoardOperations(await db.outbox.toArray())).toEqual([
      { ...rename, base_version: 1 },
    ]);

    const renamed = { ...child, title: 'Títol nou', version: 2 };
    await applyBoardResults(
      db,
      [rebasedRename],
      [{ op_id: rename.id, status: 'ok', entity: renamed }],
    );
    const rebasedCompletion = (await db.outbox.get(complete.id))!;
    expect(rebasedCompletion.base_version).toBe(2);
    await applyBoardResults(
      db,
      [rebasedCompletion],
      [{ op_id: complete.id, status: 'ok', entity: { ...renamed, version: 3, done: 1 } }],
    );
    expect(await db.outbox.count()).toBe(0);
    expect(await readSnapshot(db, subtasksPath)).toEqual([{ ...renamed, version: 3, done: true }]);
  });

  it('descartar una tasca que no s’ha creat també retira la cua de les seves subtasques', async () => {
    const parent = operation('01', {
      entity_type: 'task',
      entity_id: taskId,
      parent_task_id: undefined,
      op: 'create',
      status: 'failed',
    });
    const create = operation('02', {
      op: 'create',
      payload: { task_id: taskId, title: child.title },
    });
    const update = operation('03', { payload: { done: true } });
    const independent = operation('04', { entity_id: 'unrelated', parent_task_id: 'existing' });
    await db.outbox.bulkPut([parent, create, update, independent]);
    expect(nextBoardOperations(await db.outbox.toArray())).toEqual([independent]);
    await discardBoardOperation(db, parent);
    expect(await db.outbox.toArray()).toEqual([independent]);
  });

  it('conserva el conflicte de títol si una confirmació de la casella revela un canvi extern', async () => {
    const complete = operation('01', { payload: { done: true }, base_version: 1 });
    const rename = operation('02', { payload: { title: 'Títol meu' }, base_version: 1 });
    await db.outbox.bulkPut([complete, rename]);
    const server = { ...child, title: 'Títol extern', done: true, version: 3 };
    await applyBoardResults(db, [complete], [{ op_id: complete.id, status: 'ok', entity: server }]);

    const rebasedRename = (await db.outbox.get(rename.id))!;
    expect(rebasedRename.base_version).toBe(1);
    await applyBoardResults(
      db,
      [rebasedRename],
      [{ op_id: rename.id, status: 'conflict', server_entity: server }],
    );
    expect(nextBoardOperations(await db.outbox.toArray())).toEqual([]);
    expect(await readSnapshot(db, subtasksPath)).toEqual([server]);
  });

  it('conserva la llista ancorada i l’esborrat encara que arribi un GET anterior al rebut', async () => {
    const checklist: Checklist = {
      id: 'list',
      task_id: taskId,
      subtask_id: child.id,
      name: 'Llista',
      pinned: false,
      show_completed_inline: true,
      position: 'a0',
      items: [],
      version: 1,
    };
    const task: Task = {
      id: taskId,
      scope_id: 'scope',
      title: 'Tasca',
      status: 'todo',
      position: 'a0',
      ai_mode: 'manual',
      view_mode: 'card',
      needs_attention: false,
      progress: listProgress([child], [checklist]),
      created_at: timestamp,
      updated_at: timestamp,
      version: 1,
    };
    const board = { columns: [{ status: 'todo', groups: [{ scope_id: 'scope', tasks: [task] }] }] };
    const inbox: Inbox = {
      date: '2026-11-20',
      dated: [],
      overdue: [],
      undated: [task],
      events: [],
      mail: [],
    };
    await writeSnapshot(db, boardPath, board);
    await writeSnapshot(db, inboxPath, inbox);
    await writeSnapshot(db, subtasksPath, [child]);
    await writeSnapshot(db, checklistsPath, [checklist]);
    const startRevision = await boardSnapshotRevision(db, subtasksPath);

    const deletion = operation('01', { op: 'delete' });
    await db.outbox.put(deletion);
    const projected = projectSubtasks(taskId, [child], await db.outbox.toArray());
    expect(projected.subtasks).toEqual([]);
    expect(detachChecklists([checklist], projected.deleted)).toEqual([
      { ...checklist, subtask_id: null },
    ]);

    await applyBoardResults(db, [deletion], [{ op_id: deletion.id, status: 'ok' }]);
    expect(await saveBoardQuery(db, subtasksPath, [child], startRevision)).toEqual([]);
    expect(await saveBoardQuery(db, checklistsPath, [checklist], startRevision)).toEqual([
      { ...checklist, subtask_id: null },
    ]);
    db.close();
    await db.open();
    expect(await db.outbox.count()).toBe(0);
    expect(await readSnapshot(db, subtasksPath)).toEqual([]);
    const finalProgress = { done: 0, total: 0, lists: 1 };
    expect(
      (await readSnapshot<Board>(db, boardPath))?.columns[0]?.groups[0]?.tasks[0]?.progress,
    ).toEqual(finalProgress);
    expect((await readSnapshot<Inbox>(db, inboxPath))?.undated[0]?.progress).toEqual(finalProgress);
  });
});
