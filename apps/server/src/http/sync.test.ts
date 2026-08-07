/**
 * docs/13 M9 · comprovació de la fita: `test: sync-contract` amb **els vuit casos de
 * docs/06 §10**.
 *
 * "Aquestes són les que decideixen si el sync funciona."
 *
 * Els casos 1, 3 i 5 s'executen a CI en els dos clients; aquí es prova el costat del
 * servidor, que és el que han de compartir tots dos.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { comparePositions, generatePosition } from '@fem-ho/contracts';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { encodeCursor, forgetAllOps } from '../services/sync.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-sync-'));
const NOW = '2026-08-05T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let userId: string;
let auth: { authorization: string };
let scopeId: string;
let altreScopeId: string;

async function api(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

async function novaTasca(title: string, scope = scopeId): Promise<string> {
  const res = await api('POST', '/api/v1/tasks', { scope_id: scope, title });
  return res.json<{ id: string }>().id;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  altreScopeId = uuidv7();
  for (const [id, name] of [
    [scopeId, 'Personal'],
    [altreScopeId, 'Feina'],
  ] as const) {
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${id}, ${name}, 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
    `.execute(conn.db);
  }

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'borja@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  forgetAllOps();
});

describe('el cursor', () => {
  it("és una cadena OPACA que el client no ha d'interpretar", async () => {
    const res = await api('GET', '/api/v1/sync');
    const cursor = res.json<{ next_cursor: string }>().next_cursor;
    // No és un número escrit tal qual: si ho fos, algú l'interpretaria i llavors el
    // format ja no es podria canviar sense trencar clients desplegats (docs/06 §2).
    expect(cursor).not.toMatch(/^\d+$/);
  });

  it('cada resposta porta server_time per detectar desviació de rellotge', async () => {
    const res = await api('GET', '/api/v1/sync');
    const body = res.json<{ server_time: string }>();
    expect(Number.isNaN(Date.parse(body.server_time))).toBe(false);
  });

  it('sense cursor és una sincronització COMPLETA', async () => {
    await novaTasca('Per al delta complet');
    const res = await api('GET', '/api/v1/sync');
    expect(res.json<{ changes: unknown[] }>().changes.length).toBeGreaterThan(0);
  });

  it('el delta va SEMPRE ordenat per seq ascendent', async () => {
    for (let i = 0; i < 5; i += 1) await novaTasca(`Ordre ${i}`);
    const res = await api('GET', '/api/v1/sync');
    const seqs = res.json<{ changes: { seq: number }[] }>().changes.map((c) => c.seq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("un upsert porta l'entitat SENCERA, no un diff", async () => {
    const id = await novaTasca('Amb dades senceres');
    const res = await api('GET', '/api/v1/sync');
    const change = res
      .json<{ changes: { id: string; data?: { title?: string } }[] }>()
      .changes.find((c) => c.id === id);
    expect(change?.data?.title).toBe('Amb dades senceres');
  });
});

describe('CAS 1 · mode avió', () => {
  it('crear, editar, moure i completar sense xarxa, i el servidor acaba idèntic', async () => {
    // El client ho fa tot en local i ho puja després. Els identificadors i les posicions
    // els genera ell (D3, D4), o sigui que res depèn d'una resposta del servidor.
    const id = await novaTasca('Feta en mode avió');

    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        { op_id: uuidv7(), entity: 'task', op: 'update', id, data: { title: 'Editada offline' } },
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'move',
          id,
          data: { status: 'doing', position: generatePosition(null, null) },
        },
        { op_id: uuidv7(), entity: 'task', op: 'update', id, data: { status: 'done' } },
      ],
    });

    const results = res.json<{ results: { status: string }[] }>().results;
    expect(results.every((r) => r.status === 'ok')).toBe(true);

    const final = await sql<{ title: string; status: string }>`
      SELECT title, status FROM tasks WHERE id = ${id}
    `.execute(conn.db);
    expect(final.rows[0]?.title).toBe('Editada offline');
    expect(final.rows[0]?.status).toBe('done');
  });
});

describe('CAS 2 · edició concurrent de camps diferents', () => {
  it('els dos canvis hi són', async () => {
    const id = await novaTasca('Editada per dos');
    const base = 1;

    // Client A canvia la data. Client B canvia l'estat. Tots dos parteixen de la v1.
    await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'update',
          id,
          base_version: base,
          data: { due_date: '2026-08-20' },
        },
      ],
    });
    await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'update',
          id,
          base_version: base,
          data: { status: 'todo' },
        },
      ],
    });

    const final = await sql<{ due_date: string; status: string }>`
      SELECT due_date, status FROM tasks WHERE id = ${id}
    `.execute(conn.db);

    // Camps diferents: no hi ha res a resoldre i els dos canvis sobreviuen.
    expect(final.rows[0]?.due_date).toBe('2026-08-20');
    expect(final.rows[0]?.status).toBe('todo');
  });

  it("però un xoc de TÍTOL sí que es pregunta a l'usuari", async () => {
    // "Només quan els dos costats han canviat el títol o la descripció a coses
    // realment diferents. No es fusiona text automàticament" (docs/06 §5).
    const id = await novaTasca('Títol original');
    await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'update',
          id,
          base_version: 1,
          data: { title: 'A' },
        },
      ],
    });

    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'update',
          id,
          base_version: 1,
          data: { title: 'B' },
        },
      ],
    });

    const result = res.json<{ results: { status: string }[] }>().results[0];
    expect(result?.status).toBe('conflict');

    // I el servidor NO ha aplicat el segon: qui decideix és l'usuari.
    const final = await sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${id}`.execute(
      conn.db,
    );
    expect(final.rows[0]?.title).toBe('A');
  });
});

describe('CAS 3 · reordenació concurrent', () => {
  it('els dos clients acaben amb el mateix ordre i no es perd cap targeta', async () => {
    // "`position` NO és mai un conflicte, i aquesta és tota la raó dels índexs
    // fraccionals" (docs/06 §5).
    const ids = [await novaTasca('R1'), await novaTasca('R2'), await novaTasca('R3')];

    const posicions = await sql<{ id: string; position: string }>`
      SELECT id, position FROM tasks WHERE id IN (${sql.join(ids)}) ORDER BY position
    `.execute(conn.db);
    const [a, b] = posicions.rows;

    // Dos clients insereixen la tercera al MATEIX buit, offline i sense veure's.
    const clientA = generatePosition(a!.position, b!.position);
    const clientB = generatePosition(a!.position, b!.position);

    /**
     * **El jitter fa els xocs improbables, no impossibles**, i afirmar el contrari era
     * una prova que fallava una vegada de cada seixanta: amb 61 dígits de jitter, dos
     * clients cauen a la mateixa clau el 1,6% de les vegades.
     *
     * El que sí que ha de ser cert sempre és que les dues claus **caiguin al buit**, que
     * és el que fa que cap targeta canviï de veïns. L'empat, quan passa, el desfà el
     * desempat per `id` de les consultes, no el jitter.
     */
    for (const key of [clientA, clientB]) {
      expect(comparePositions(a!.position, key)).toBe(-1);
      expect(comparePositions(key, b!.position)).toBe(-1);
    }

    for (const [index, position] of [clientA, clientB].entries()) {
      await api('POST', '/api/v1/sync/batch', {
        operations: [
          {
            op_id: uuidv7(),
            entity: 'task',
            op: 'move',
            id: ids[2]!,
            base_version: 1 + index,
            data: { position },
          },
        ],
      });
    }

    /**
     * Cap targeta perduda, i l'ordre és **total**: `(position, id)` no empata mai, perquè
     * `id` és únic. Comparar només per posició deixava l'ordre a l'atzar del motor el dia
     * que dues claus coincidien, que és exactament el cas que aquesta prova munta.
     */
    const final = await sql<{ id: string; position: string }>`
      SELECT id, position FROM tasks WHERE id IN (${sql.join(ids)}) ORDER BY position, id
    `.execute(conn.db);
    expect(final.rows).toHaveLength(3);
    for (let i = 1; i < final.rows.length; i += 1) {
      const previous = final.rows[i - 1]!;
      const current = final.rows[i]!;
      const byPosition = comparePositions(previous.position, current.position);
      const strictlyBefore = byPosition === -1 || (byPosition === 0 && previous.id < current.id);
      expect(
        strictlyBefore,
        `${previous.position}/${previous.id} abans de ${current.position}/${current.id}`,
      ).toBe(true);
    }
  });
});

describe('CAS 4 · esborrat contra edició', () => {
  it("guanya l'esborrat, i l'edició queda a l'historial", async () => {
    const id = await novaTasca("Esborrada mentre s'editava");

    await api('POST', '/api/v1/sync/batch', {
      operations: [{ op_id: uuidv7(), entity: 'task', op: 'delete', id }],
    });

    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'update',
          id,
          data: { title: 'Editada massa tard' },
        },
      ],
    });

    expect(res.json<{ results: { status: string }[] }>().results[0]?.status).toBe('conflict');

    // La fila segueix esborrada: no reviu.
    const final = await sql<{ deleted_at: string | null; title: string }>`
      SELECT deleted_at, title FROM tasks WHERE id = ${id}
    `.execute(conn.db);
    expect(final.rows[0]?.deleted_at).not.toBeNull();
    expect(final.rows[0]?.title).not.toBe('Editada massa tard');

    // Però el que va voler fer qui editava queda registrat.
    const historial = await sql<{ changes: string }>`
      SELECT changes FROM activity_log
      WHERE entity_id = ${id} AND verb = 'updated' ORDER BY id DESC LIMIT 1
    `.execute(conn.db);
    expect(historial.rows[0]?.changes).toContain('Editada massa tard');
  });

  it('esborrar deixa una TOMBSTONE al delta, no un forat', async () => {
    const id = await novaTasca('Amb tombstone');
    const abans = await api('GET', '/api/v1/sync');
    const cursor = abans.json<{ next_cursor: string }>().next_cursor;

    await api('POST', '/api/v1/sync/batch', {
      operations: [{ op_id: uuidv7(), entity: 'task', op: 'delete', id }],
    });

    const delta = await api('GET', `/api/v1/sync?cursor=${encodeURIComponent(cursor)}`);
    const change = delta
      .json<{ changes: { id: string; op: string }[] }>()
      .changes.find((c) => c.id === id);
    expect(change?.op).toBe('delete');
  });
});

describe('CAS 5 · cursor caducat', () => {
  it('un cursor de fa més de 90 dies obliga a resincronitzar', async () => {
    await novaTasca('Per envellir el log');

    // S'envelleix la fila del cursor: és el que passaria de veritat quan un client
    // torna després de mesos.
    await sql`UPDATE change_log SET created_at = '2020-01-01T00:00:00.000Z'`.execute(conn.db);

    const primerSeq = await sql<{ seq: number }>`SELECT MIN(seq) AS seq FROM change_log`.execute(
      conn.db,
    );
    const cursor = encodeCursor(Number(primerSeq.rows[0]?.seq ?? 1));

    const res = await api('GET', `/api/v1/sync?cursor=${encodeURIComponent(cursor)}`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ type: string }>().type).toContain('cursor-too-old');

    // Es torna a posar la data perquè la resta de proves no la trobin envellida.
    await sql`UPDATE change_log SET created_at = ${NOW}`.execute(conn.db);
  });

  it('un cursor inventat també', async () => {
    const res = await api('GET', '/api/v1/sync?cursor=aixo-no-es-un-cursor');
    expect(res.statusCode).toBe(409);
  });

  it('la comprovació es fa ABANS de servir el delta, no després', async () => {
    // Servir un delta incomplet i avisar després deixa el client amb dades que
    // semblen bones (docs/06 §3).
    await sql`UPDATE change_log SET created_at = '2020-01-01T00:00:00.000Z'`.execute(conn.db);
    const primerSeq = await sql<{ seq: number }>`SELECT MIN(seq) AS seq FROM change_log`.execute(
      conn.db,
    );
    const res = await api(
      'GET',
      `/api/v1/sync?cursor=${encodeURIComponent(encodeCursor(Number(primerSeq.rows[0]?.seq ?? 1)))}`,
    );

    // La resposta NO porta canvis: és un error, no un delta a mitges.
    expect(res.statusCode).toBe(409);
    expect(res.json<{ changes?: unknown }>().changes).toBeUndefined();

    await sql`UPDATE change_log SET created_at = ${NOW}`.execute(conn.db);
  });
});

describe('CAS 6 · reenviament de lot', () => {
  it('enviar el mateix lot dues vegades no duplica res', async () => {
    const id = await novaTasca('Per reenviar');
    const opId = uuidv7();
    const lot = {
      operations: [
        { op_id: opId, entity: 'task', op: 'update', id, data: { title: 'Un sol cop' } },
      ],
    };

    const primera = await api('POST', '/api/v1/sync/batch', lot);
    const segona = await api('POST', '/api/v1/sync/batch', lot);

    expect(primera.json<{ results: { status: string }[] }>().results[0]?.status).toBe('ok');
    expect(segona.json<{ results: { status: string }[] }>().results[0]?.status).toBe('ok');

    // La versió ha pujat UNA vegada, no dues: la segona ha tornat el resultat guardat.
    const final = await sql<{ version: number }>`
      SELECT version FROM tasks WHERE id = ${id}
    `.execute(conn.db);
    expect(final.rows[0]?.version).toBe(2);
  });

  it('una operació que falla no tomba la resta del lot', async () => {
    const bona = await novaTasca('Aquesta sí');
    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        { op_id: uuidv7(), entity: 'task', op: 'update', id: uuidv7(), data: { title: 'X' } },
        { op_id: uuidv7(), entity: 'task', op: 'update', id: bona, data: { title: 'Aplicada' } },
      ],
    });

    const results = res.json<{ results: { status: string }[] }>().results;
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('ok');

    const final = await sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${bona}`.execute(
      conn.db,
    );
    expect(final.rows[0]?.title).toBe('Aplicada');
  });
});

describe("CAS 7 · pèrdua d'accés a un àmbit", () => {
  it('el delta deixa de portar el que el token ja no pot veure', async () => {
    const { generateApiToken } = await import('../auth/tokens.js');
    const { token, hash, prefix } = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, scope_ids, created_at)
      VALUES (${uuidv7()}, ${userId}, 'Només personal', ${prefix}, ${hash},
              ${JSON.stringify(['tasks:read', 'scopes:read'])},
              ${JSON.stringify([scopeId])}, ${NOW})
    `.execute(conn.db);

    await novaTasca('A Feina', altreScopeId);

    const res = await api('GET', '/api/v1/sync', undefined, {
      authorization: `Bearer ${token}`,
    });
    const scopes = new Set(
      res
        .json<{ changes: { data?: { scope_id?: string } }[] }>()
        .changes.map((c) => c.data?.scope_id),
    );
    scopes.delete(undefined);
    expect([...scopes]).toEqual([scopeId]);
  });
});

describe("CAS 8 · el seq s'assigna al final de la transacció", () => {
  it("l'ordre dels seq és l'ordre en què s'han confirmat les escriptures", async () => {
    // docs/06 §2: amb un comptador autoincremental, una transacció llarga que agafa el
    // seq 100 pot fer-se visible DESPRÉS d'una de curta amb el 101, i un client que
    // hagi llegit fins al 101 no veurà mai el 100.
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(await novaTasca(`Seqüència ${i}`));

    const files = await sql<{ entity_id: string; seq: number }>`
      SELECT entity_id, seq FROM change_log
      WHERE entity_id IN (${sql.join(ids)}) AND entity_type = 'task'
      ORDER BY seq
    `.execute(conn.db);

    // L'ordre dels seq coincideix amb l'ordre de creació, sense forats ni salts.
    expect(files.rows.map((r) => r.entity_id)).toEqual(ids);
  });
});

/**
 * **Crear des de la cua de sortida.**
 *
 * `docs/06` §3 llista `create` entre les operacions de l'outbox, i el client d'Android
 * hi encua totes les tasques que es fan sense connexió. El servidor no la sabia fer: la
 * fila no existia, `applyOne` responia `rejected` amb un 404, i el client —que només
 * mira que la crida no peti— la treia de la cua. **La tasca desapareixia sense que ni
 * el telèfon ni el servidor diguessin res.**
 *
 * Es prova amb les quatre entitats que se sincronitzen, perquè el camí és el mateix i
 * el que falla a una fallaria a totes.
 */
describe('crear des del lot', () => {
  it('una tasca creada sense connexió arriba de veritat', async () => {
    const id = uuidv7();
    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'create',
          id,
          base_version: 0,
          data: { id, scope_id: scopeId, title: 'Feta al metro', status: 'todo' },
        },
      ],
    });

    expect(res.statusCode, res.body).toBe(200);
    const result = res.json<{ results: { status: string }[] }>().results[0];
    expect(result?.status, JSON.stringify(result)).toBe('ok');

    const tasca = await api('GET', `/api/v1/tasks/${id}`);
    expect(tasca.statusCode).toBe(200);
    expect(tasca.json<{ title: string; status: string }>().title).toBe('Feta al metro');
    // I **a la columna on es va escriure**, no a la bústia.
    expect(tasca.json<{ status: string }>().status).toBe('todo');
  });

  it('reenviar el mateix op_id no en crea dues', async () => {
    const id = uuidv7();
    const opId = uuidv7();
    const operation = {
      op_id: opId,
      entity: 'task',
      op: 'create',
      id,
      base_version: 0,
      data: { id, scope_id: scopeId, title: 'Repetida' },
    };

    await api('POST', '/api/v1/sync/batch', { operations: [operation] });
    const segona = await api('POST', '/api/v1/sync/batch', { operations: [operation] });
    expect(segona.json<{ results: { status: string }[] }>().results[0]?.status).toBe('ok');

    const totes = await api('GET', '/api/v1/tasks?limit=100');
    const iguals = totes
      .json<{ data: { title: string }[] }>()
      .data.filter((task) => task.title === 'Repetida');
    expect(iguals).toHaveLength(1);
  });

  it('subtasques, llistes i ítems també', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb fills' })
    ).json<{ id: string }>().id;

    const subtaskId = uuidv7();
    const checklistId = uuidv7();
    const itemId = uuidv7();

    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'subtask',
          op: 'create',
          id: subtaskId,
          base_version: 0,
          data: { id: subtaskId, task_id: taskId, title: 'Una subtasca' },
        },
        {
          op_id: uuidv7(),
          entity: 'checklist',
          op: 'create',
          id: checklistId,
          base_version: 0,
          data: { id: checklistId, task_id: taskId, name: 'La compra' },
        },
        {
          op_id: uuidv7(),
          entity: 'checklist_item',
          op: 'create',
          id: itemId,
          base_version: 0,
          data: { id: itemId, checklist_id: checklistId, text: 'Pa' },
        },
      ],
    });

    // **L'ordre topològic importa**: l'ítem va després de la llista dins del mateix lot.
    const results = res.json<{ results: { status: string }[] }>().results;
    expect(results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);

    const subtasques = await api('GET', `/api/v1/tasks/${taskId}/subtasks`);
    expect(subtasques.json<{ id: string }[]>().map((s) => s.id)).toContain(subtaskId);

    const llistes = await api('GET', `/api/v1/tasks/${taskId}/checklists`);
    const llista = llistes
      .json<{ id: string; items: { id: string }[] }[]>()
      .find((c) => c.id === checklistId);
    expect(llista?.items.map((i) => i.id)).toContain(itemId);
  });

  it('una creació sense àmbit es rebutja, i **es queda dient per què**', async () => {
    const id = uuidv7();
    const res = await api('POST', '/api/v1/sync/batch', {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'create',
          id,
          base_version: 0,
          data: { id, title: 'Sense àmbit' },
        },
      ],
    });

    const result = res.json<{ results: { status: string; error?: { detail?: string } }[] }>()
      .results[0];
    expect(result?.status).toBe('rejected');
    expect(result?.error?.detail ?? '').not.toBe('');
  });
});
