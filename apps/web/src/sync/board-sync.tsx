import { liveQuery } from 'dexie';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { SyncPill } from '@fem-ho/design-system/femho';
import { api, currentTokens, request } from '../app/api.js';
import type { Subtask, Task } from '../app/types.js';
import { useApi, type QueryResult } from '../app/useApi.js';
import {
  accountDatabase,
  applyBoardResults,
  boardSnapshotRevision,
  isConnectionFailure,
  readSnapshot,
  saveBoardQuery,
} from './cache.js';
import type { FemHoDatabase, OutboxRow } from './db.js';
import {
  calendarSuggestionTaskId,
  discardBoardOperation,
  markSending,
  nextBoardOperations,
  pomodoroTaskIds,
  type OperationResult,
} from './outbox.js';
import { taskListPath } from './subtask-projection.js';

type BoardMutation = Pick<
  OutboxRow,
  | 'entity_id'
  | 'op'
  | 'payload'
  | 'base_version'
  | 'task_title'
  | 'parent_task_id'
  | 'observed_title'
  | 'calendar_suggestion'
> & { entity_type?: OutboxRow['entity_type'] };

interface BoardSync {
  db: FemHoDatabase;
  pending: OutboxRow[];
  revision: number;
  submit: (mutation: BoardMutation, send?: () => Promise<Task>) => Promise<void>;
}

const BoardSyncContext = createContext<BoardSync | null>(null);

export function useOptionalBoardSync(): BoardSync | null {
  return useContext(BoardSyncContext);
}

export function useBoardSync(): BoardSync {
  const sync = useOptionalBoardSync();
  if (sync === null) throw new Error('BoardSyncProvider is required');
  return sync;
}

export function useBoardQuery<T>(path: string | null): QueryResult<T> {
  const sync = useOptionalBoardSync();
  const db = sync?.db;
  const load = useCallback(
    async (url: string, signal: AbortSignal): Promise<T> => {
      if (db === undefined) return api.get<T>(url, signal);
      try {
        const startRevision = await boardSnapshotRevision(db, url);
        const result = await api.get<T>(url, signal);
        return signal.aborted ? result : saveBoardQuery(db, url, result, startRevision);
      } catch (error) {
        if (signal.aborted || !isConnectionFailure(error)) throw error;
        const cached = await readSnapshot<T>(db, url);
        if (cached === undefined) throw error;
        return cached;
      }
    },
    [db],
  );
  return useApi<T>(path, [sync?.revision], load);
}

function queueRows(db: FemHoDatabase): Promise<OutboxRow[]> {
  return db.outbox.orderBy('created_at').toArray();
}

function withQueueLock<T>(db: FemHoDatabase, run: () => Promise<T>): Promise<T> {
  // En tancar una pestanya se n'allibera el pany. L'altra pot reenviar `sending`
  // amb el mateix op_id, també si el servidor havia confirmat però encara no es veia.
  if (navigator.locks !== undefined) return navigator.locks.request(db.name, run);
  return run();
}

async function pushBoardBatch(
  rows: OutboxRow[],
  current: () => boolean,
): Promise<OperationResult[]> {
  const acknowledged: OperationResult[] = [];
  const operations: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row.possibly_sent_direct && row.op === 'move') {
      if (!current()) throw new Error('The account changed.');
      const task = await api.get<Task>(`/api/v1/tasks/${row.entity_id}`).catch((error: unknown) => {
        if (isConnectionFailure(error)) throw error;
        return null;
      });
      if (
        task !== null &&
        task.status === row.payload.status &&
        task.position === row.payload.position
      ) {
        acknowledged.push({ op_id: row.id, status: 'ok', entity: task });
        continue;
      }
    }
    operations.push({
      op_id: row.id,
      entity: row.entity_type,
      op: row.op,
      id: row.entity_id,
      base_version: row.base_version,
      occurred_at: row.created_at,
      data: row.op === 'move' ? { ...row.payload, occurred_at: row.created_at } : row.payload,
    });
  }
  if (operations.length === 0) return acknowledged;
  if (!current()) throw new Error('The account changed.');
  const { results } = await request<{ results: OperationResult[] }>('/api/v1/sync/batch', {
    method: 'POST',
    body: { operations },
    signal: AbortSignal.timeout(15_000),
  });
  return [...acknowledged, ...results];
}

export function BoardSyncProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const db = useMemo(() => accountDatabase(userId), [userId]);
  const [pending, setPending] = useState<OutboxRow[]>([]);
  const [online, setOnline] = useState(navigator.onLine);
  const [revision, setRevision] = useState(0);
  const [confirmedAt, setConfirmedAt] = useState(0);
  const flushing = useRef(false);
  const retry = useRef({ after: 0, delay: 1_000 });
  const current = useCallback(() => currentTokens()?.user_id === userId, [userId]);

  const flush = useCallback(async (): Promise<void> => {
    if (flushing.current || Date.now() < retry.current.after || !navigator.onLine || !current())
      return;
    flushing.current = true;
    try {
      await withQueueLock(db, async () => {
        while (navigator.onLine && current()) {
          const rows = nextBoardOperations(await queueRows(db));
          if (rows.length === 0) break;
          await markSending(db, rows);
          if (!current()) break;
          const results = await pushBoardBatch(rows, current);
          retry.current = { after: 0, delay: 1_000 };
          await applyBoardResults(db, rows, results);
          if (results.some((result) => result.status === 'ok' || result.status === 'conflict')) {
            setRevision((value) => value + 1);
            if ((await db.outbox.count()) === 0) setConfirmedAt(Date.now());
          }
          // Si falten rebuts, el proper intent torna a usar els mateixos IDs; no gira en buit.
          const receipts = new Set(results.map((result) => result.op_id));
          if (rows.some((row) => !receipts.has(row.id))) break;
        }
      });
    } catch {
      // `sending` es conserva: s'ha pogut confirmar al servidor just abans del tall.
      // L'esdeveniment `online` pot arribar abans que la xarxa torni a respondre.
      const { delay } = retry.current;
      retry.current = { after: Date.now() + delay, delay: Math.min(delay * 2, 30_000) };
    } finally {
      flushing.current = false;
    }
  }, [current, db]);

  useEffect(() => {
    const observer = liveQuery(() => queueRows(db)).subscribe({
      next: setPending,
      error: () => undefined,
    });
    const reconnect = (): void => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        retry.current = { after: 0, delay: 1_000 };
        setRevision((value) => value + 1);
        void flush();
      }
    };
    const poll = (): void => void flush();
    window.addEventListener('online', reconnect);
    window.addEventListener('offline', reconnect);
    window.addEventListener('focus', poll);
    const timer = window.setInterval(poll, 1_000);
    poll();
    return () => {
      observer.unsubscribe();
      window.removeEventListener('online', reconnect);
      window.removeEventListener('offline', reconnect);
      window.removeEventListener('focus', poll);
      window.clearInterval(timer);
    };
  }, [db, flush]);

  useEffect(() => {
    if (confirmedAt === 0) return undefined;
    const timer = window.setTimeout(() => setConfirmedAt(0), 2000);
    return () => window.clearTimeout(timer);
  }, [confirmedAt]);

  const submit = async (mutation: BoardMutation, send?: () => Promise<Task>): Promise<void> => {
    // Si la xarxa torna mentre esperem el pany, el lot conserva l'hora del gest fora de línia.
    const canSendDirectly = send !== undefined && navigator.onLine;
    const row: OutboxRow = {
      ...mutation,
      id: uuidv7(),
      created_at: new Date().toISOString(),
      entity_type: mutation.entity_type ?? 'task',
      status: 'pending',
      attempts: 0,
    };
    if (row.entity_type === 'user_settings') {
      await withQueueLock(db, async () => {
        if (!current()) throw new Error('The account changed.');
        await db.transaction('rw', db.outbox, async () => {
          // Un rebuig definitiu no ha d'impedir desar un altre valor de l'ajust.
          await db.outbox
            .where('[entity_type+entity_id]')
            .equals([row.entity_type, row.entity_id])
            .and((previous) => previous.status === 'failed' || previous.status === 'conflict')
            .delete();
          await db.outbox.add(row);
        });
      });
      void flush();
      return;
    }
    if (row.entity_type === 'subtask' && row.parent_task_id !== undefined) {
      const path = taskListPath(row.parent_task_id, 'subtasks');
      // La projecció local no ha d'esperar una petició en curs. IndexedDB només
      // serialitza aquest desament amb la transacció curta que aplica els rebuts.
      await db.transaction('rw', db.outbox, db.meta, async () => {
        if (!current()) throw new Error('The account changed.');
        if (row.op === 'update') {
          const latest = await readSnapshot<Subtask[]>(db, path);
          const canonical = latest?.find((subtask) => subtask.id === row.entity_id);
          // El rebut es pot haver desat mentre es feia el gest.
          if (canonical !== undefined && canonical.title === row.observed_title)
            row.base_version = Math.max(row.base_version ?? 0, canonical.version);
        }
        await db.outbox.add(row);
      });
      void flush();
      return;
    }
    await withQueueLock(db, async () => {
      if (!current()) throw new Error('The account changed.');
      let direct = canSendDirectly && navigator.onLine;
      try {
        const preceding = await db.outbox
          .where('[entity_type+entity_id]')
          .equals([row.entity_type, row.entity_id])
          .count();
        direct = direct && preceding === 0;
        // Un PATCH directe passaria per davant del moviment compost que encara és a la cua.
        if (direct && row.entity_type === 'task') {
          const focus = await db.outbox
            .filter(
              (candidate) =>
                pomodoroTaskIds(candidate).includes(row.entity_id) ||
                calendarSuggestionTaskId(candidate) === row.entity_id,
            )
            .first();
          direct = focus === undefined;
        }
        await db.outbox.add({
          ...row,
          status: direct ? 'sending' : 'pending',
          possibly_sent_direct: direct,
        });
      } catch (error) {
        if (direct && send !== undefined && current()) {
          await send();
          setRevision((value) => value + 1);
          return;
        }
        throw error;
      }
      if (!direct || send === undefined || !current()) return;
      let task: Task;
      try {
        task = await send();
      } catch (error) {
        if (error instanceof TypeError || !navigator.onLine) {
          await db.outbox.update(row.id, { status: 'pending' });
          return;
        }
        await db.outbox.delete(row.id);
        throw error;
      }
      await applyBoardResults(db, [row], [{ op_id: row.id, status: 'ok', entity: task }]);
      setRevision((value) => value + 1);
    });
    void flush();
  };

  const state = !online ? 'offline' : pending.length ? 'pending' : confirmedAt ? 'synced' : 'idle';
  const failures = pending.filter((row) => row.status === 'failed' || row.status === 'conflict');

  return (
    <BoardSyncContext.Provider value={{ db, revision, pending, submit }}>
      {children}
      {state !== 'idle' && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
            left: 20,
            zIndex: 50,
            maxWidth: '90vw',
          }}
        >
          <SyncPill
            data-testid="sync-pill"
            state={state}
            label={
              state === 'offline'
                ? t('sync.offline')
                : state === 'pending'
                  ? t('sync.pending')
                  : t('sync.synced')
            }
            count={pending.length}
          />
          {failures.length > 0 && (
            <details
              className="plou-card"
              style={{ padding: 8, maxHeight: '45vh', overflowY: 'auto' }}
            >
              <summary>
                {t('sync.title')} · {failures.length}
              </summary>
              {failures.map((row) => (
                <div key={row.id} style={{ padding: 8 }}>
                  <p>
                    {row.entity_type === 'pomodoro'
                      ? t('pomodoro.title')
                      : (row.task_title ??
                        (row.entity_type === 'calendar_suggestions'
                          ? t('calendarSuggestions.setting')
                          : row.entity_type === 'user_settings'
                            ? t('settings.doingAutoStop')
                            : undefined))}
                  </p>
                  <p>
                    {row.status === 'conflict'
                      ? t(row.entity_type === 'pomodoro' ? 'pomodoro.conflict' : 'sync.conflict')
                      : (row.last_error ?? t('error.generic'))}
                  </p>
                  <button
                    type="button"
                    className="plou-btn"
                    onClick={() => {
                      void withQueueLock(db, () => discardBoardOperation(db, row)).then(flush);
                    }}
                  >
                    {t(row.status === 'conflict' ? 'sync.keepTheirs' : 'nav.delete')}
                  </button>
                  {row.status === 'failed' && row.entity_type !== 'user_settings' && (
                    <button
                      type="button"
                      className="plou-btn"
                      onClick={() => {
                        void db.outbox.update(row.id, { status: 'pending' }).then(flush);
                      }}
                    >
                      {t('error.retry')}
                    </button>
                  )}
                </div>
              ))}
            </details>
          )}
        </div>
      )}
    </BoardSyncContext.Provider>
  );
}
