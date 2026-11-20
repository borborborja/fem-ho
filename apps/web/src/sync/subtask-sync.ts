import { generatePosition } from '@fem-ho/contracts';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import type { Checklist, Subtask } from '../app/types.js';
import type { QueryResult } from '../app/useApi.js';
import { useBoardQuery, useOptionalBoardSync } from './board-sync.js';
import { readSnapshot } from './cache.js';
import type { OutboxRow } from './db.js';
import {
  detachChecklists,
  listProgress,
  projectSubtasks,
  taskListPath,
  type ListProgress,
} from './subtask-projection.js';

interface TaskListsSnapshot {
  taskId: string;
  subtasks: Subtask[] | undefined;
  checklists: Checklist[] | undefined;
  pending: OutboxRow[];
}

interface SubtaskSync {
  subtasks: QueryResult<Subtask[]>;
  checklists: QueryResult<Checklist[]>;
  progress: ListProgress;
  createSubtask: (title: string) => Promise<void>;
  updateSubtask: (subtask: Subtask, input: { title?: string; done?: boolean }) => Promise<void>;
  deleteSubtask: (subtask: Subtask) => Promise<void>;
}

export function useSubtaskSync(
  taskId: string | undefined,
  loadLists: boolean,
  fallbackProgress?: ListProgress,
): SubtaskSync {
  const sync = useOptionalBoardSync();
  const db = sync?.db;
  const [snapshot, setSnapshot] = useState<TaskListsSnapshot>();
  const current = snapshot?.taskId === taskId ? snapshot : undefined;
  const queued =
    sync?.pending.filter((row) => row.parent_task_id === taskId && row.entity_type === 'subtask') ??
    [];
  const watchLists = loadLists || queued.length > 0 || current !== undefined;
  const subtasksPath = taskId === undefined ? null : taskListPath(taskId, 'subtasks');
  const checklistsPath = taskId === undefined ? null : taskListPath(taskId, 'checklists');
  const subtasksQuery = useBoardQuery<Subtask[]>(loadLists ? subtasksPath : null);
  const checklistsQuery = useBoardQuery<Checklist[]>(loadLists ? checklistsPath : null);

  useEffect(() => {
    if (
      db === undefined ||
      !watchLists ||
      taskId === undefined ||
      subtasksPath === null ||
      checklistsPath === null
    )
      return undefined;
    const observer = liveQuery(() =>
      db.transaction('r', db.meta, db.outbox, async () => ({
        taskId,
        subtasks: await readSnapshot<Subtask[]>(db, subtasksPath),
        checklists: await readSnapshot<Checklist[]>(db, checklistsPath),
        pending: await db.outbox.where('parent_task_id').equals(taskId).toArray(),
      })),
    ).subscribe({ next: setSnapshot, error: () => setSnapshot(undefined) });
    return () => observer.unsubscribe();
  }, [watchLists, db, taskId, subtasksPath, checklistsPath]);

  // Les lectures de xarxa permeten consultar les llistes amb IndexedDB desactivat.
  // Si la base local està oberta, llegim el rebut i la cua en una sola transacció.
  const baseSubtasks =
    current?.subtasks ?? subtasksQuery.data?.filter((subtask) => subtask.task_id === taskId);
  const baseChecklists =
    current?.checklists ??
    checklistsQuery.data?.filter((checklist) => checklist.task_id === taskId);
  const operations = current?.pending ?? queued;
  const projected =
    taskId === undefined ? undefined : projectSubtasks(taskId, baseSubtasks ?? [], operations);
  const subtasks = projected?.subtasks ?? [];
  const checklists =
    baseChecklists === undefined || projected === undefined
      ? baseChecklists
      : detachChecklists(baseChecklists, projected.deleted);

  let progress = listProgress(subtasks, checklists ?? []);
  if (fallbackProgress !== undefined && !loadLists && operations.length === 0) {
    // La targeta plegada rep el recompte fresc del tauler. Les llistes que es van
    // llegir en un desplegament anterior poden ser més antigues que aquest recompte.
    progress = fallbackProgress;
  } else if (
    fallbackProgress !== undefined &&
    (baseSubtasks === undefined || checklists === undefined)
  ) {
    const before = listProgress(baseSubtasks ?? [], []);
    const after = listProgress(subtasks, []);
    progress = {
      done: Math.max(0, fallbackProgress.done + after.done - before.done),
      total: Math.max(0, fallbackProgress.total + after.total - before.total),
      lists:
        baseSubtasks === undefined && fallbackProgress.lists > 0
          ? fallbackProgress.lists
          : Math.max(0, fallbackProgress.lists + after.lists - before.lists),
    };
  }

  return {
    subtasks: {
      ...subtasksQuery,
      data: baseSubtasks === undefined && subtasks.length === 0 ? undefined : subtasks,
    },
    checklists: { ...checklistsQuery, data: checklists },
    progress,
    createSubtask: async (title) => {
      if (taskId === undefined || title.trim() === '') return;
      // Sense la llista de base, els esborranys locals no revelen on acaba la llista
      // al servidor. En aquest cas deixem que el servei hi afegeixi les files en ordre.
      const last = baseSubtasks === undefined ? undefined : subtasks.at(-1);
      if (sync === null) throw new Error('BoardSyncProvider is required');
      await sync.submit({
        entity_type: 'subtask',
        entity_id: uuidv7(),
        parent_task_id: taskId,
        op: 'create',
        payload: {
          task_id: taskId,
          title: title.trim(),
          ...(last === undefined ? {} : { position: generatePosition(last.position, null) }),
        },
        task_title: title.trim(),
      });
    },
    updateSubtask: async (subtask, input) => {
      if (taskId === undefined || taskId !== subtask.task_id) return;
      const title = input.title?.trim();
      if (title === '' || (title === undefined && input.done === undefined)) return;
      if (sync === null) throw new Error('BoardSyncProvider is required');
      await sync.submit({
        entity_type: 'subtask',
        entity_id: subtask.id,
        parent_task_id: taskId,
        op: 'update',
        payload: {
          ...(title === undefined ? {} : { title }),
          ...(input.done === undefined ? {} : { done: input.done }),
        },
        base_version: subtask.version,
        task_title: subtask.title,
        observed_title: subtask.title,
      });
    },
    deleteSubtask: async (subtask) => {
      if (taskId === undefined || taskId !== subtask.task_id) return;
      if (sync === null) throw new Error('BoardSyncProvider is required');
      await sync.submit({
        entity_type: 'subtask',
        entity_id: subtask.id,
        parent_task_id: taskId,
        op: 'delete',
        payload: {},
        base_version: subtask.version,
        task_title: subtask.title,
      });
    },
  };
}
