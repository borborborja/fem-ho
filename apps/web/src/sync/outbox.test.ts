/**
 * La cua de sortida contra un IndexedDB de debò (`fake-indexeddb`), no contra un doble.
 * Les transaccions de Dexie i els índexs compostos són justament el que es prova.
 */

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { FemHoDatabase, type OutboxRow } from './db.js';
import {
  applyResults,
  enqueue,
  markSending,
  mergeInto,
  nextBatch,
  resolveConflict,
  topologicalOrder,
} from './outbox.js';

let db: FemHoDatabase;
let contador = 0;

function row(patch: Partial<OutboxRow>): OutboxRow {
  contador += 1;
  return {
    id: `op-${contador}`,
    entity_type: 'task',
    entity_id: 'tasca-1',
    op: 'update',
    payload: {},
    created_at: `2026-08-05T10:00:0${contador}.000Z`,
    attempts: 0,
    status: 'pending',
    ...patch,
  };
}

beforeEach(async () => {
  db = new FemHoDatabase(`test-${Math.random()}`);
  await db.open();
  contador = 0;
});

describe('fusió', () => {
  it('marcar fet, desfer i tornar a marcar produeix UNA operació', async () => {
    // L'exemple literal de docs/06 §4.
    for (const [i, status] of ['done', 'todo', 'done'].entries()) {
      await enqueue(db, {
        op_id: `op-${i}`,
        entity_type: 'task',
        entity_id: 'tasca-1',
        op: 'update',
        payload: { status },
        base_version: 3,
        now: `2026-08-05T10:00:0${i}.000Z`,
      });
    }

    const cua = await db.outbox.toArray();
    expect(cua).toHaveLength(1);
    expect(cua[0]?.payload).toEqual({ status: 'done' });
  });

  it('conserva la base_version MÉS ANTIGA', () => {
    // La versió que el client va veure del servidor és la de la primera edició; les
    // següents són locals i no serveixen com a base.
    const pendents = [row({ payload: { title: 'A' }, base_version: 3 })];
    const [fusionada] = mergeInto(pendents, row({ payload: { title: 'B' }, base_version: 99 }));
    expect(fusionada?.base_version).toBe(3);
  });

  it('NO fusiona una edició amb un esborrat', () => {
    const pendents = [row({ op: 'update', payload: { title: 'A' } })];
    const resultat = mergeInto(pendents, row({ op: 'delete' }));
    expect(resultat).toHaveLength(2);
  });

  it('NO fusiona res que ja estigui a la xarxa', () => {
    // Canviar el cos d'una operació en `sending` faria que el servidor rebés dades
    // diferents sota un `op_id` que ja ha vist.
    const pendents = [row({ status: 'sending', payload: { title: 'Enviant-se' } })];
    const resultat = mergeInto(pendents, row({ payload: { title: 'Nou' } }));
    expect(resultat).toHaveLength(2);
  });

  it('la fusió NO reordena la cua', () => {
    const primera = row({ entity_id: 'tasca-1', payload: { title: 'A' } });
    const altra = row({ entity_id: 'tasca-2' });
    const fusionada = mergeInto([primera, altra], row({ entity_id: 'tasca-1', payload: { s: 1 } }));
    expect(fusionada.map((r) => r.id)).toEqual([primera.id, altra.id]);
  });

  it('fusiona per entitat, no per taula', async () => {
    for (const entityId of ['tasca-1', 'tasca-2']) {
      await enqueue(db, {
        op_id: `op-${entityId}`,
        entity_type: 'task',
        entity_id: entityId,
        op: 'update',
        payload: { title: entityId },
        now: '2026-08-05T10:00:00.000Z',
      });
    }
    expect(await db.outbox.count()).toBe(2);
  });
});

describe('ordre', () => {
  it('la tasca va abans que la seva subtasca', () => {
    const subtasca = row({
      entity_type: 'subtask',
      entity_id: 'sub-1',
      op: 'create',
      created_at: '2026-08-05T10:00:01.000Z',
      depends_on: ['tasca-1'],
    });
    const tasca = row({
      entity_id: 'tasca-1',
      op: 'create',
      created_at: '2026-08-05T10:00:02.000Z',
    });

    // Encara que la subtasca s'hagi encuat ABANS, la tasca surt primer.
    const ordenades = topologicalOrder([subtasca, tasca]);
    expect(ordenades.map((r) => r.entity_id)).toEqual(['tasca-1', 'sub-1']);
  });

  it("entre operacions independents es manté l'ordre de creació", () => {
    const rows = ['c', 'a', 'b'].map((letra, i) =>
      row({ entity_id: letra, created_at: `2026-08-05T10:00:0${i}.000Z` }),
    );
    expect(topologicalOrder(rows).map((r) => r.entity_id)).toEqual(['c', 'a', 'b']);
  });

  it('dues edicions de la mateixa entitat mantenen el seu ordre relatiu', () => {
    const primera = row({ status: 'sending', created_at: '2026-08-05T10:00:01.000Z' });
    const segona = row({ created_at: '2026-08-05T10:00:02.000Z' });
    expect(topologicalOrder([segona, primera]).map((r) => r.id)).toEqual([primera.id, segona.id]);
  });

  it('un cicle no penja el procés', () => {
    const a = row({ entity_id: 'a', depends_on: ['b'], created_at: '2026-08-05T10:00:01.000Z' });
    const b = row({ entity_id: 'b', depends_on: ['a'], created_at: '2026-08-05T10:00:02.000Z' });
    expect(topologicalOrder([a, b])).toHaveLength(2);
  });
});

describe('el proper lot', () => {
  it("no inclou el que espera que decideixi l'usuari", async () => {
    await db.outbox.bulkPut([row({ status: 'conflict' }), row({ entity_id: 'tasca-2' })]);
    const lot = await nextBatch(db);
    expect(lot.map((r) => r.entity_id)).toEqual(['tasca-2']);
  });

  it('sí que reintenta les fallades, fins a un límit', async () => {
    await db.outbox.bulkPut([
      row({ status: 'failed', attempts: 2 }),
      row({ entity_id: 'tasca-2', status: 'failed', attempts: 99 }),
    ]);
    const lot = await nextBatch(db);
    expect(lot.map((r) => r.entity_id)).toEqual(['tasca-1']);
  });
});

describe('resultats', () => {
  it('una operació correcta surt de la cua i actualitza la memòria cau', async () => {
    const enviada = row({});
    await db.outbox.put(enviada);
    await markSending(db, [enviada]);

    await applyResults(
      db,
      [enviada],
      [
        {
          op_id: enviada.id,
          status: 'ok',
          entity: { id: 'tasca-1', title: 'Confirmada', version: 4 },
        },
      ],
    );

    expect(await db.outbox.count()).toBe(0);
    expect((await db.entities.get('tasca-1'))?.title).toBe('Confirmada');
  });

  it("una resposta perduda deixa l'operació en pending, no la perd", async () => {
    const enviada = row({});
    await db.outbox.put(enviada);
    await markSending(db, [enviada]);

    // El lot va sortir però la resposta no va arribar mai.
    await applyResults(db, [enviada], []);

    const desada = await db.outbox.get(enviada.id);
    expect(desada?.status).toBe('pending');
    // I reenviar-la no duplica res: l'`op_id` és el mateix.
    expect(desada?.id).toBe(enviada.id);
  });

  it("un conflicte guarda l'entitat del servidor perquè es pugui ensenyar", async () => {
    const enviada = row({ payload: { title: 'El meu' } });
    await db.outbox.put(enviada);

    await applyResults(
      db,
      [enviada],
      [
        {
          op_id: enviada.id,
          status: 'conflict',
          server_entity: { id: 'tasca-1', title: 'El seu', version: 7 },
        },
      ],
    );

    const desada = await db.outbox.get(enviada.id);
    expect(desada?.status).toBe('conflict');
    expect(desada?.server_entity?.title).toBe('El seu');
  });

  it('triar el meu reencua sobre la versió NOVA del servidor', async () => {
    const enviada = row({ payload: { title: 'El meu' }, base_version: 3 });
    await db.outbox.put({ ...enviada, status: 'conflict', server_entity: { id: 'x', version: 7 } });

    await resolveConflict(db, enviada.id, 'mine', 'op-nova');

    // L'`op_id` vell ja té resposta del servidor: reenviar-lo tornaria el mateix
    // conflicte per sempre, perquè el servidor memoritza el resultat per `op_id`.
    expect(await db.outbox.get(enviada.id)).toBeUndefined();

    const desada = await db.outbox.get('op-nova');
    expect(desada?.status).toBe('pending');
    expect(desada?.payload).toEqual({ title: 'El meu' });
    // Sense això el segon intent xocaria exactament igual que el primer.
    expect(desada?.base_version).toBe(7);
  });

  it("triar el seu descarta l'operació", async () => {
    const enviada = row({});
    await db.outbox.put({ ...enviada, status: 'conflict' });
    await resolveConflict(db, enviada.id, 'theirs');
    expect(await db.outbox.count()).toBe(0);
  });
});
