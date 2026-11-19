import { v7 as uuidv7 } from 'uuid';
import { ApiError } from '../app/api.js';
import type { Board, Task } from '../app/types.js';
import { FemHoDatabase, readMeta, writeMeta, type OutboxRow } from './db.js';
import { applyResults, type OperationResult } from './outbox.js';

const BOARD_PATH = '/api/v1/board?';
const BOARD_CACHE_REVISION = 'board-cache-revision';

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
    const value = await readMeta(db, `snapshot:${key}`);
    return value === undefined ? undefined : (JSON.parse(value) as T);
  } catch {
    return undefined;
  }
}

export async function writeSnapshot<T>(db: FemHoDatabase, key: string, value: T): Promise<void> {
  // Bloquejar IndexedDB al navegador no ha d'impedir fer servir l'aplicació en línia.
  await writeMeta(db, `snapshot:${key}`, JSON.stringify(value)).catch(() => undefined);
}

export function boardSnapshotRevision(
  db: FemHoDatabase,
  path: string,
): Promise<string | undefined> {
  if (!path.startsWith(BOARD_PATH)) return Promise.resolve(undefined);
  return readMeta(db, BOARD_CACHE_REVISION).catch(() => undefined);
}

export async function saveBoardQuery<T>(
  db: FemHoDatabase,
  path: string,
  value: T,
  startRevision: string | undefined,
): Promise<T> {
  if (!path.startsWith(BOARD_PATH)) {
    await writeSnapshot(db, path, value);
    return value;
  }
  return db
    .transaction('rw', db.meta, async () => {
      // Un GET començat abans del rebut pot tornar la targeta al lloc vell.
      if ((await readMeta(db, BOARD_CACHE_REVISION)) !== startRevision)
        return (await readSnapshot<T>(db, path)) ?? value;
      await writeSnapshot(db, path, value);
      return value;
    })
    .catch(() => value);
}

export async function applyBoardResults(
  db: FemHoDatabase,
  sent: OutboxRow[],
  results: OperationResult[],
): Promise<void> {
  const confirmed = results
    .filter((result) => result.status === 'ok' && result.entity?.id !== undefined)
    .map((result) => result.entity as unknown as Task);
  await db.transaction('rw', db.outbox, db.entities, db.meta, async () => {
    if (confirmed.length > 0) {
      const snapshots = await db.meta.where('key').startsWith(`snapshot:${BOARD_PATH}`).toArray();
      for (const snapshot of snapshots) {
        const scopeIds = new URLSearchParams(snapshot.key.slice(`snapshot:${BOARD_PATH}`.length))
          .get('scope_ids')
          ?.split(',');
        const matching = confirmed.filter((task) => scopeIds?.includes(task.scope_id) ?? true);
        if (matching.length === 0) continue;
        const board = await readSnapshot<Board>(db, snapshot.key.slice('snapshot:'.length));
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
        await db.meta.put({ key: snapshot.key, value: JSON.stringify(board) });
      }
      await writeMeta(db, BOARD_CACHE_REVISION, uuidv7());
    }
    // Després del rebut, la targeta ha de seguir visible en desconnectar abans del GET.
    await applyResults(db, sent, results);
  });
}
