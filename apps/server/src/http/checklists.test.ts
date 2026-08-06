/**
 * docs/13 M8 · comprovació de la fita: `test: checklist-cascade`.
 *
 * Els criteris d'acceptació:
 *   - Es pot crear una llista dins d'una tasca i **ancorar-la a una subtasca**.
 *   - **Marcar l'últim ítem marca la subtasca i, si tot està fet, la tasca**, i queda
 *     registrat com a cascada.
 *   - Pinejar-la la posa al rail i **és personal**.
 *   - En completar-se es proposa despinejar.
 *   - El commutador d'inline contra secció funciona.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-checklists-'));
const NOW = '2026-08-05T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let userId: string;
let altreUserId: string;
let auth: { authorization: string };
let altreAuth: { authorization: string };
let scopeId: string;

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

/** Crea una tasca amb una llista i els seus ítems, i torna els identificadors. */
async function muntaLlista(options: {
  titol: string;
  items: string[];
  subtasca?: boolean;
}): Promise<{ taskId: string; checklistId: string; itemIds: string[]; subtaskId?: string }> {
  const taskId = (
    await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: options.titol })
  ).json<{ id: string }>().id;

  let subtaskId: string | undefined;
  if (options.subtasca === true) {
    subtaskId = uuidv7();
    await sql`
      INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at, version)
      VALUES (${subtaskId}, ${taskId}, 'Fer la maleta', 0, 'a1', ${NOW}, ${NOW}, 1)
    `.execute(conn.db);
  }

  const checklistId = (
    await api('POST', `/api/v1/tasks/${taskId}/checklists`, {
      name: 'Maleta Borja',
      ...(subtaskId === undefined ? {} : { subtask_id: subtaskId }),
    })
  ).json<{ id: string }>().id;

  const itemIds: string[] = [];
  for (const text of options.items) {
    const res = await api('POST', `/api/v1/checklists/${checklistId}/items`, { text });
    itemIds.push(res.json<{ id: string }>().id);
  }

  return subtaskId === undefined
    ? { taskId, checklistId, itemIds }
    : { taskId, checklistId, itemIds, subtaskId };
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const hash = await hashPassword(PASSWORD);
  userId = uuidv7();
  altreUserId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${hash}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${altreUserId}, 'alba@example.com', 'Alba', ${hash}, 'human', 'member', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Família', 'collective', '--plou-pink', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);
  // L'altra persona és membre de l'àmbit: si no, no en veuria res i la prova del
  // pinejat personal no distingiria "no ho veu" de "no li surt pinejat".
  for (const member of [userId, altreUserId]) {
    await sql`
      INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
      VALUES (${uuidv7()}, ${scopeId}, ${member}, 'member', ${NOW})
    `.execute(conn.db);
  }

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });

  const entra = async (email: string): Promise<{ authorization: string }> => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: PASSWORD },
    });
    return { authorization: `Bearer ${res.json<{ access_token: string }>().access_token}` };
  };
  auth = await entra('borja@example.com');
  altreAuth = await entra('alba@example.com');
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('crear llistes', () => {
  it("es pot crear una llista dins d'una tasca", async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Fer la maleta' })
    ).json<{ id: string }>().id;

    const res = await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Maleta Borja' });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ name: string; items: unknown[] }>().name).toBe('Maleta Borja');
  });

  it("s'hi poden afegir ítems", async () => {
    const { checklistId } = await muntaLlista({ titol: 'Amb ítems', items: ['Cables'] });
    const res = await api('POST', `/api/v1/checklists/${checklistId}/items`, {
      text: '3 pantalons',
    });
    expect(res.statusCode).toBe(201);
    // Un booleà de veritat, no el 0/1 de la fila: el mateix camp ha de sortir igual
    // per aquí i per `GET /tasks/{id}/checklists` (docs/05 §3).
    expect(res.json<{ done: boolean }>().done).toBe(false);
  });

  it('una llista sense nom es rebutja', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Sense nom' })
    ).json<{ id: string }>().id;
    const res = await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: '   ' });
    expect(res.statusCode).toBe(422);
  });
});

describe('AQUESTA és la de docs/13: la cascada amunt', () => {
  it("marcar l'últim ítem marca la subtasca I la tasca", async () => {
    const { taskId, subtaskId, itemIds } = await muntaLlista({
      titol: 'Fer la maleta',
      items: ['Cables', '3 pantalons', '6 samarretes'],
      subtasca: true,
    });

    // Els dos primers no completen res.
    for (const itemId of itemIds.slice(0, 2)) {
      const res = await api('PATCH', `/api/v1/checklist-items/${itemId}`, { done: true });
      const cascade = res.json<{ cascade: { checklist_completed: boolean } }>().cascade;
      expect(cascade.checklist_completed).toBe(false);
    }

    // L'ÚLTIM sí.
    const ultim = await api('PATCH', `/api/v1/checklist-items/${itemIds[2]}`, { done: true });
    const cascade = ultim.json<{
      cascade: {
        checklist_completed: boolean;
        subtask_completed: boolean;
        task_completed: boolean;
      };
    }>().cascade;

    expect(cascade.checklist_completed).toBe(true);
    expect(cascade.subtask_completed).toBe(true);
    expect(cascade.task_completed).toBe(true);

    // I ha passat de veritat a la base, no només al que retorna l'API.
    const subtasca = await sql<{ done: number }>`
      SELECT done FROM subtasks WHERE id = ${subtaskId}
    `.execute(conn.db);
    expect(subtasca.rows[0]?.done).toBe(1);

    const tasca = await sql<{ status: string; completed_at: string | null }>`
      SELECT status, completed_at FROM tasks WHERE id = ${taskId}
    `.execute(conn.db);
    expect(tasca.rows[0]?.status).toBe('done');
    expect(tasca.rows[0]?.completed_at).toBeTruthy();
  });

  it('la cascada queda registrada com a cascade_complete', async () => {
    const { taskId, itemIds } = await muntaLlista({
      titol: 'Amb historial',
      items: ['Un sol ítem'],
      subtasca: true,
    });

    await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: true });

    const entrades = await sql<{ verb: string; entity_type: string }>`
      SELECT verb, entity_type FROM activity_log
      WHERE verb = 'cascade_complete' AND entity_id IN (
        SELECT id FROM subtasks WHERE task_id = ${taskId}
        UNION SELECT ${taskId}
      )
    `.execute(conn.db);

    // "Es registra amb verb='cascade_complete' perquè es distingeixi d'un gest directe
    // de l'usuari" (docs/01 §4). A l'historial, la diferència importa.
    expect(entrades.rows.length).toBeGreaterThanOrEqual(2);
    expect(entrades.rows.map((r) => r.entity_type).sort()).toEqual(['subtask', 'task']);
  });

  it('desmarcar un ítem no torna a obrir la tasca sola', async () => {
    // La cascada és cap amunt i cap a fet. Reobrir automàticament seria decidir per
    // l'usuari: potser va tancar la tasca a posta.
    const { taskId, itemIds } = await muntaLlista({ titol: 'Desmarcar', items: ['A'] });
    await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: true });
    await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: false });

    const tasca = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId}
    `.execute(conn.db);
    expect(tasca.rows[0]?.status).toBe('done');
  });

  it('una llista BUIDA no completa res', async () => {
    // Sense ítems no hi ha res a completar. Si comptés com a completa, crear una llista
    // buida tancaria la tasca sola.
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb llista buida' })
    ).json<{ id: string }>().id;
    await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Buida' });

    const tasca = await sql<{ status: string }>`
      SELECT status FROM tasks WHERE id = ${taskId}
    `.execute(conn.db);
    expect(tasca.rows[0]?.status).not.toBe('done');
  });

  it('amb DUES llistes, la tasca no es tanca fins que les dues estan fetes', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Dues llistes' })
    ).json<{ id: string }>().id;

    const ids: string[] = [];
    for (const nom of ['Maleta Borja', 'Maleta Alba']) {
      const llista = (await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: nom })).json<{
        id: string;
      }>().id;
      const item = (
        await api('POST', `/api/v1/checklists/${llista}/items`, { text: `Roba de ${nom}` })
      ).json<{ id: string }>().id;
      ids.push(item);
    }

    const primera = await api('PATCH', `/api/v1/checklist-items/${ids[0]}`, { done: true });
    expect(primera.json<{ cascade: { task_completed: boolean } }>().cascade.task_completed).toBe(
      false,
    );

    const segona = await api('PATCH', `/api/v1/checklist-items/${ids[1]}`, { done: true });
    expect(segona.json<{ cascade: { task_completed: boolean } }>().cascade.task_completed).toBe(
      true,
    );
  });

  it('una subtasca pendent impedeix que la tasca es tanqui', async () => {
    const { taskId, itemIds } = await muntaLlista({ titol: 'Amb pendent', items: ['A'] });
    await sql`
      INSERT INTO subtasks (id, task_id, title, done, position, created_at, updated_at, version)
      VALUES (${uuidv7()}, ${taskId}, 'Una subtasca a part', 0, 'a2', ${NOW}, ${NOW}, 1)
    `.execute(conn.db);

    const res = await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: true });
    expect(res.json<{ cascade: { task_completed: boolean } }>().cascade.task_completed).toBe(false);
  });
});

describe('pinejar', () => {
  it('pinejar és PERSONAL', async () => {
    const { checklistId } = await muntaLlista({ titol: 'Per pinejar', items: ['A'] });

    const res = await api('POST', `/api/v1/checklists/${checklistId}/pin`);
    expect(res.statusCode).toBe(204);

    // A qui la va pinejar li surt al rail.
    const meu = await api('GET', '/api/v1/pinned-checklists');
    expect(meu.json<{ id: string }[]>().map((c) => c.id)).toContain(checklistId);

    // A l'altra persona de la casa, NO. El rail és de cadascú (docs/01 §4).
    const seu = await api('GET', '/api/v1/pinned-checklists', undefined, altreAuth);
    expect(seu.json<{ id: string }[]>()).toHaveLength(0);
  });

  it('es pot despinejar', async () => {
    const { checklistId } = await muntaLlista({ titol: 'Per despinejar', items: ['A'] });
    await api('POST', `/api/v1/checklists/${checklistId}/pin`);
    const res = await api('DELETE', `/api/v1/checklists/${checklistId}/pin`);
    expect(res.statusCode).toBe(204);

    const meu = await api('GET', '/api/v1/pinned-checklists');
    expect(meu.json<{ id: string }[]>().map((c) => c.id)).not.toContain(checklistId);
  });

  it('en completar-se una llista pinejada, es PROPOSA despinejar', async () => {
    const { checklistId, itemIds } = await muntaLlista({ titol: 'Pinejada', items: ['A'] });
    await api('POST', `/api/v1/checklists/${checklistId}/pin`);

    const res = await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: true });
    const cascade = res.json<{ cascade: { suggest_unpin: boolean } }>().cascade;

    // Es PROPOSA, no es fa: despinejar-la sola seria decidir per l'usuari (P1).
    expect(cascade.suggest_unpin).toBe(true);

    const encaraPinejada = await api('GET', '/api/v1/pinned-checklists');
    expect(encaraPinejada.json<{ id: string }[]>().map((c) => c.id)).toContain(checklistId);
  });

  it('una llista NO pinejada no proposa res', async () => {
    const { itemIds } = await muntaLlista({ titol: 'Sense pinejar', items: ['A'] });
    const res = await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: true });
    expect(res.json<{ cascade: { suggest_unpin: boolean } }>().cascade.suggest_unpin).toBe(false);
  });
});

describe('el commutador de completats', () => {
  it('per defecte els completats van en línia', async () => {
    const { checklistId, taskId } = await muntaLlista({ titol: 'Commutador', items: ['A'] });
    const res = await api('GET', `/api/v1/tasks/${taskId}/checklists`);
    const llista = res
      .json<{ id: string; show_completed_inline: boolean }[]>()
      .find((c) => c.id === checklistId);
    expect(llista?.show_completed_inline).toBe(true);
  });

  it('es pot crear amb els completats en una secció a part', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb secció' })
    ).json<{ id: string }>().id;

    const res = await api('POST', `/api/v1/tasks/${taskId}/checklists`, {
      name: 'Amb secció',
      show_completed_inline: false,
    });
    expect(res.json<{ show_completed_inline: boolean }>().show_completed_inline).toBe(false);
  });
});

/**
 * L'agregat que la targeta del tauler necessita per pintar-se **plegada**.
 *
 * Sense ell, saber si una tasca té llistes obligaria a baixar-les totes de totes les
 * targetes. Per això el tauler porta els tres números fets: quants ítems hi ha, quants
 * n'hi ha de fets, i quants **blocs** desplegables — que no és el mateix, perquè totes
 * les subtasques compten com un de sol.
 */
describe("l'agregat de la targeta", () => {
  it('compta subtasques i ítems junts, i els blocs a part', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Amb de tot' })
    ).json<{ id: string }>().id;

    // Dues subtasques: un sol bloc.
    for (const title of ['Una', 'Dues']) {
      const res = await api('POST', `/api/v1/tasks/${taskId}/subtasks`, { title });
      expect(res.statusCode, res.body).toBe(201);
    }

    // I una llista amb tres ítems: un altre bloc.
    const listId = (
      await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'La compra' })
    ).json<{ id: string }>().id;
    const itemIds: string[] = [];
    for (const text of ['Pa', 'Llet', 'Ous']) {
      itemIds.push(
        (await api('POST', `/api/v1/checklists/${listId}/items`, { text })).json<{ id: string }>()
          .id,
      );
    }

    await api('PATCH', `/api/v1/checklist-items/${itemIds[0]}`, { done: true });

    const tasca = await api('GET', `/api/v1/tasks/${taskId}`);
    const progress = tasca.json<{ progress: { done: number; total: number; lists: number } }>()
      .progress;
    expect(progress.total).toBe(5);
    expect(progress.done).toBe(1);
    // Dos blocs: el de les subtasques i la llista. No cinc.
    expect(progress.lists).toBe(2);
  });

  it('una tasca pelada no en té cap', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Pelada' })
    ).json<{ id: string }>().id;

    const progress = (await api('GET', `/api/v1/tasks/${taskId}`)).json<{
      progress: { done: number; total: number; lists: number };
    }>().progress;
    expect(progress).toEqual({ done: 0, total: 0, lists: 0 });
  });

  it('una llista buida ja compta com a bloc: hi ha alguna cosa a desplegar', async () => {
    const taskId = (
      await api('POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Llista buida' })
    ).json<{ id: string }>().id;
    await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Encara res' });

    const progress = (await api('GET', `/api/v1/tasks/${taskId}`)).json<{
      progress: { done: number; total: number; lists: number };
    }>().progress;
    expect(progress).toEqual({ done: 0, total: 0, lists: 1 });
  });
});
