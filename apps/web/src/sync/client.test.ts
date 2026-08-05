/**
 * El client de sincronització: memòria cau, cursor, resincronització i mode avió.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_KEY, FemHoDatabase, readMeta } from './db.js';
import { MustResync, pull, push, sync, type SyncResponse, type SyncTransport } from './client.js';
import { enqueue } from './outbox.js';

let db: FemHoDatabase;

function resposta(patch: Partial<SyncResponse> = {}): SyncResponse {
  return {
    changes: [],
    next_cursor: 'cursor-1',
    has_more: false,
    server_time: '2026-08-05T10:00:00.000Z',
    ...patch,
  };
}

beforeEach(async () => {
  db = new FemHoDatabase(`test-${Math.random()}`);
  await db.open();
});

describe('baixada', () => {
  it('guarda les entitats i el cursor', async () => {
    const transport: SyncTransport = {
      pull: async () => ({
        ok: true,
        body: resposta({
          changes: [
            {
              seq: 1,
              entity: 'task',
              id: 'tasca-1',
              op: 'upsert',
              data: { id: 'tasca-1', title: 'Comprar pa' },
            },
          ],
        }),
      }),
      push: async () => ({ results: [] }),
    };

    await pull(db, transport);

    expect((await db.entities.get('tasca-1'))?.title).toBe('Comprar pa');
    expect(await readMeta(db, CURSOR_KEY)).toBe('cursor-1');
  });

  it('una tombstone esborra la fila local, no la marca', async () => {
    await db.entities.put({ id: 'tasca-1', entity_type: 'task', title: 'Condemnada' });

    await pull(db, {
      pull: async () => ({
        ok: true,
        body: resposta({ changes: [{ seq: 2, entity: 'task', id: 'tasca-1', op: 'delete' }] }),
      }),
      push: async () => ({ results: [] }),
    });

    // Si es deixés amb una marca, la primera consulta que oblidés filtrar-la
    // ensenyaria una tasca que ja no existeix.
    expect(await db.entities.get('tasca-1')).toBeUndefined();
  });

  it('segueix demanant mentre has_more', async () => {
    let crides = 0;
    await pull(db, {
      pull: async () => {
        crides += 1;
        return { ok: true, body: resposta({ has_more: crides < 3, next_cursor: `c${crides}` }) };
      },
      push: async () => ({ results: [] }),
    });
    expect(crides).toBe(3);
  });
});

describe('cursor caducat', () => {
  it('buida la memòria cau i torna a baixar-ho tot', async () => {
    await db.entities.put({ id: 'antiga', entity_type: 'task', title: 'De fa mesos' });
    await db.meta.put({ key: CURSOR_KEY, value: 'cursor-vell' });

    const vistos: (string | undefined)[] = [];
    const resultat = await pull(db, {
      pull: async (cursor) => {
        vistos.push(cursor);
        if (cursor === 'cursor-vell') return { ok: false, mustResync: true };
        return {
          ok: true,
          body: resposta({
            changes: [
              {
                seq: 9,
                entity: 'task',
                id: 'nova',
                op: 'upsert',
                data: { id: 'nova', title: 'Actual' },
              },
            ],
          }),
        };
      },
      push: async () => ({ results: [] }),
    });

    expect(resultat.resynced).toBe(true);
    // El segon intent va SENSE cursor: és una sincronització completa.
    expect(vistos).toEqual(['cursor-vell', undefined]);
    expect(await db.entities.get('antiga')).toBeUndefined();
    expect(await db.entities.get('nova')).toBeDefined();
  });

  it('NO buida la cua de sortida', async () => {
    await db.meta.put({ key: CURSOR_KEY, value: 'cursor-vell' });
    await enqueue(db, {
      op_id: 'op-1',
      entity_type: 'task',
      entity_id: 'tasca-1',
      op: 'update',
      payload: { title: 'Feta offline fa mesos' },
      now: '2026-08-05T10:00:00.000Z',
    });

    await pull(db, {
      pull: async (cursor) =>
        cursor === 'cursor-vell' ? { ok: false, mustResync: true } : { ok: true, body: resposta() },
      push: async () => ({ results: [] }),
    });

    // El que l'usuari va fer sense xarxa no es perd perquè hagi trigat a tornar.
    expect(await db.outbox.count()).toBe(1);
  });

  it('amb resyncOnStale desactivat, avisa en comptes de decidir sol', async () => {
    await expect(
      pull(
        db,
        {
          pull: async () => ({ ok: false, mustResync: true }),
          push: async () => ({ results: [] }),
        },
        { resyncOnStale: false },
      ),
    ).rejects.toBeInstanceOf(MustResync);
  });
});

describe('pujada', () => {
  it('envia el lot i buida el que ha anat bé', async () => {
    await enqueue(db, {
      op_id: 'op-1',
      entity_type: 'task',
      entity_id: 'tasca-1',
      op: 'update',
      payload: { title: 'Puja' },
      base_version: 2,
      now: '2026-08-05T10:00:00.000Z',
    });

    const enviat = vi.fn(async (_operations: unknown[]) => ({
      results: [{ op_id: 'op-1', status: 'ok' as const }],
    }));
    const resultat = await push(db, {
      pull: async () => ({ ok: true, body: resposta() }),
      push: enviat,
    });

    expect(resultat.sent).toBe(1);
    expect(await db.outbox.count()).toBe(0);
    expect(enviat.mock.calls[0]?.[0]).toEqual([
      {
        op_id: 'op-1',
        entity: 'task',
        op: 'update',
        id: 'tasca-1',
        base_version: 2,
        data: { title: 'Puja' },
      },
    ]);
  });

  it('sense xarxa NO gasta un intent', async () => {
    await enqueue(db, {
      op_id: 'op-1',
      entity_type: 'task',
      entity_id: 'tasca-1',
      op: 'update',
      payload: { title: 'En un avió' },
      now: '2026-08-05T10:00:00.000Z',
    });

    for (let i = 0; i < 20; i += 1) {
      await push(db, {
        pull: async () => ({ ok: true, body: resposta() }),
        push: async () => {
          throw new TypeError('Failed to fetch');
        },
      });
    }

    // Un vol de vuit hores no ha de matar la cua.
    const fila = await db.outbox.get('op-1');
    expect(fila?.status).toBe('pending');
    expect(fila?.attempts).toBe(0);
  });
});

describe('una passada sencera', () => {
  it('puja ABANS de baixar', async () => {
    await enqueue(db, {
      op_id: 'op-1',
      entity_type: 'task',
      entity_id: 'tasca-1',
      op: 'update',
      payload: { title: 'Nou' },
      now: '2026-08-05T10:00:00.000Z',
    });

    const ordre: string[] = [];
    await sync(db, {
      pull: async () => {
        ordre.push('pull');
        return { ok: true, body: resposta() };
      },
      push: async () => {
        ordre.push('push');
        return { results: [{ op_id: 'op-1', status: 'ok' as const }] };
      },
    });

    // A l'inrevés, el delta portaria l'estat antic i la pantalla parpellejaria.
    expect(ordre).toEqual(['push', 'pull']);
  });
});
