/**
 * Pàgina de prova de la sincronització offline (M9).
 *
 * El "servidor" viu dins de la pàgina i es pot apagar amb un botó: així la prova de
 * navegador pot fer el mode avió de debò —cua a IndexedDB, fusió, reenviament— sense
 * dependre d'un backend engegat ni de l'API de xarxa del navegador.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { t } from '@fem-ho/contracts';
import { FemHoDatabase, type CachedRow, type OutboxRow } from './sync/db.js';
import { sync, type SyncResponse, type SyncTransport } from './sync/client.js';
import { enqueue, resolveConflict, type OperationResult } from './sync/outbox.js';

interface ServerTask {
  id: string;
  title: string;
  status: string;
  version: number;
  deleted: boolean;
}

/** El servidor de mentida: guarda l'estat, el `seq` i els `op_id` que ja ha vist. */
function createServer() {
  const tasks = new Map<string, ServerTask>([
    ['tasca-1', { id: 'tasca-1', title: 'Comprar pa', status: 'todo', version: 1, deleted: false }],
    [
      'tasca-2',
      { id: 'tasca-2', title: 'Trucar al fuster', status: 'doing', version: 1, deleted: false },
    ],
  ]);
  const log: { seq: number; id: string; op: 'upsert' | 'delete' }[] = [
    { seq: 1, id: 'tasca-1', op: 'upsert' },
    { seq: 2, id: 'tasca-2', op: 'upsert' },
  ];
  const seen = new Map<string, OperationResult>();
  let seq = 2;

  return {
    tasks,
    seen,
    /** Quantes operacions ha aplicat de debò: el comptador que la prova mira. */
    applied: 0,
    /** Un canvi que ve d'un altre client, per poder provocar un conflicte. */
    editFromElsewhere(id: string, title: string) {
      const task = tasks.get(id);
      if (task === undefined) return;
      task.title = title;
      task.version += 1;
      seq += 1;
      log.push({ seq, id, op: 'upsert' });
    },
    pull(cursor: string | undefined): SyncResponse {
      const from = cursor === undefined ? 0 : Number(atob(cursor).split(':')[1]);
      const changes = log
        .filter((entry) => entry.seq > from)
        .map((entry) => ({
          seq: entry.seq,
          entity: 'task' as const,
          id: entry.id,
          op: entry.op,
          data: entry.op === 'upsert' ? { ...tasks.get(entry.id) } : undefined,
        }));
      return {
        changes,
        next_cursor: btoa(`v1:${seq}`),
        has_more: false,
        server_time: new Date().toISOString(),
      };
    },
    push(
      operations: {
        op_id: string;
        id: string;
        base_version?: number;
        data?: Record<string, unknown>;
      }[],
    ) {
      const results: OperationResult[] = [];
      for (const operation of operations) {
        const abans = seen.get(operation.op_id);
        if (abans !== undefined) {
          results.push(abans);
          continue;
        }

        const task = tasks.get(operation.id);
        if (task === undefined) {
          const rejected: OperationResult = {
            op_id: operation.op_id,
            status: 'rejected',
            error: {},
          };
          seen.set(operation.op_id, rejected);
          results.push(rejected);
          continue;
        }

        const title = operation.data?.title as string | undefined;
        const xoc =
          title !== undefined &&
          operation.base_version !== undefined &&
          operation.base_version < task.version;

        if (xoc) {
          const conflict: OperationResult = {
            op_id: operation.op_id,
            status: 'conflict',
            server_entity: { ...task },
          };
          seen.set(operation.op_id, conflict);
          results.push(conflict);
          continue;
        }

        Object.assign(task, operation.data);
        task.version += 1;
        this.applied += 1;
        seq += 1;
        log.push({ seq, id: task.id, op: 'upsert' });

        const ok: OperationResult = { op_id: operation.op_id, status: 'ok', entity: { ...task } };
        seen.set(operation.op_id, ok);
        results.push(ok);
      }
      return { results };
    },
  };
}

export function OfflineProof(): React.JSX.Element {
  const db = useMemo(() => new FemHoDatabase('fem-ho-proof'), []);
  const server = useRef(createServer());
  const [online, setOnline] = useState(true);
  const [rows, setRows] = useState<CachedRow[]>([]);
  const [queue, setQueue] = useState<OutboxRow[]>([]);
  const [estat, setEstat] = useState('');

  const transport = useMemo<SyncTransport>(
    () => ({
      pull: async (cursor) => {
        if (!online) throw new TypeError('Failed to fetch');
        return { ok: true, body: server.current.pull(cursor) };
      },
      push: async (operations) => {
        if (!online) throw new TypeError('Failed to fetch');
        return server.current.push(operations as never);
      },
    }),
    [online],
  );

  const refresh = useCallback(async () => {
    setRows(await db.entities.orderBy('id').toArray());
    setQueue(await db.outbox.toArray());
  }, [db]);

  useEffect(() => {
    void (async () => {
      // No es buida res: Playwright ja dona un perfil nou a cada prova, i buidar-ho
      // aquí faria que una segona pestanya del MATEIX perfil perdés la cua.
      await db.open();
      await sync(db, {
        pull: async (cursor) => ({ ok: true, body: server.current.pull(cursor) }),
        push: async () => ({ results: [] }),
      });
      await refresh();
    })();
  }, [db, refresh]);

  const edit = async (id: string, patch: Record<string, unknown>): Promise<void> => {
    const cached = await db.entities.get(id);
    await db.entities.put({ ...(cached as CachedRow), ...patch });
    await enqueue(db, {
      op_id: uuidv7(),
      entity_type: 'task',
      entity_id: id,
      op: 'update',
      payload: patch,
      base_version: cached?.version,
      now: new Date().toISOString(),
    });
    await refresh();
  };

  const sincronitza = async (): Promise<void> => {
    try {
      const resultat = await sync(db, transport);
      setEstat(`enviades ${resultat.sent}, rebudes ${resultat.applied}`);
    } catch {
      setEstat('sense connexió');
    }
    await refresh();
  };

  const conflictes = queue.filter((row) => row.status === 'conflict');

  return (
    <main
      style={{ padding: '24px', fontFamily: 'Roboto, sans-serif', color: 'var(--text-primary)' }}
    >
      <h1 style={{ font: 'var(--font-h1)' }}>{t('sync.title')}</h1>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <button type="button" data-testid="toggle-network" onClick={() => setOnline(!online)}>
          {online ? t('sync.goOffline') : t('sync.goOnline')}
        </button>
        <button type="button" data-testid="sync" onClick={() => void sincronitza()}>
          {t('sync.now')}
        </button>
        <button
          type="button"
          data-testid="remote-edit"
          onClick={() => server.current.editFromElsewhere('tasca-1', 'Comprar pa de pagès')}
        >
          {t('sync.remoteEdit')}
        </button>
      </div>

      <p data-testid="network" data-online={String(online)}>
        {online ? t('sync.online') : t('sync.offline')}
      </p>
      <p data-testid="queue" data-count={String(queue.length)}>
        {t('sync.pending')}: {queue.length}
      </p>
      <p data-testid="applied" data-count={String(server.current.applied)}>
        {t('sync.appliedByServer')}: {server.current.applied}
      </p>
      <p data-testid="status">{estat}</p>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {rows.map((row) => (
          <li
            key={row.id}
            data-testid={`task-${row.id}`}
            data-title={String(row.title)}
            data-status={String(row.status)}
            style={{ marginBottom: '8px' }}
          >
            <span>{String(row.title)}</span>{' '}
            <button
              type="button"
              data-testid={`rename-${row.id}`}
              onClick={() =>
                void edit(row.id, { title: `${String(row.title)} ${t('sync.renameSuffix')}` })
              }
            >
              {t('sync.rename')}
            </button>{' '}
            <button
              type="button"
              data-testid={`complete-${row.id}`}
              onClick={() => void edit(row.id, { status: 'done' })}
            >
              {t('sync.complete')}
            </button>
          </li>
        ))}
      </ul>

      {conflictes.map((row) => (
        <div key={row.id} data-testid="conflict" style={{ marginTop: '16px' }}>
          <p>{t('sync.conflict')}</p>
          <button
            type="button"
            data-testid="keep-mine"
            onClick={() => void resolveConflict(db, row.id, 'mine').then(refresh)}
          >
            {t('sync.keepMine')}
          </button>{' '}
          <button
            type="button"
            data-testid="keep-theirs"
            onClick={() => void resolveConflict(db, row.id, 'theirs').then(refresh)}
          >
            {t('sync.keepTheirs')}
          </button>
        </div>
      ))}
    </main>
  );
}
