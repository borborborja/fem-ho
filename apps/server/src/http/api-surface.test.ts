/**
 * La superfície de l'API de docs/05 §4, sencera.
 *
 * L'API tenia 48 rutes i el document en demana el doble llarg. El que faltava no eren
 * casos de vora: no es podia llegir ni editar una tasca sola, ni gestionar membres d'un
 * àmbit, ni crear un calendari, ni administrar usuaris. La web no es podia construir
 * perquè la meitat del que necessita no existia.
 *
 * Cada prova d'escriptura comprova **també que deixa rastre** (regla 4). Aquest fitxer és
 * el que `tools/checks/audit-coverage.mjs` cita per a cadascuna: sense la prova, la
 * comprovació falla i l'endpoint no es pot lliurar.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-surface-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

let conn: Connection;
let app: FastifyInstance;
let auth: Record<string, string>;
let userId: string;
let altreId: string;
let scopeIndividual: string;
let scopeCollectiu: string;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function api(
  method: Method,
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

/** Les entrades d'historial d'una entitat, per comprovar la regla 4 sense repetir SQL. */
async function rastre(entityId: string): Promise<{ verb: string; entity_type: string }[]> {
  const rows = await sql<{ verb: string; entity_type: string }>`
    SELECT verb, entity_type FROM activity_log WHERE entity_id = ${entityId}
    ORDER BY created_at, id
  `.execute(conn.db);
  return rows.rows;
}

async function novaTasca(title: string, scopeId = scopeIndividual): Promise<string> {
  const res = await api('POST', '/api/v1/tasks', { scope_id: scopeId, title });
  expect(res.statusCode, res.body).toBeLessThan(400);
  return res.json<{ id: string }>().id;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  altreId = uuidv7();
  const hash = await hashPassword(PASSWORD);
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', ${hash}, 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${altreId}, 'alba@example.com', 'Alba', ${hash}, 'human', 'member', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp, instanceName: 'Casa nostra' },
    { connection: conn, secret: 'x'.repeat(40) },
  );

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'borja@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };

  scopeIndividual = (
    await api('POST', '/api/v1/scopes', { name: 'Personal', color: '--plou-blue' })
  ).json<{ id: string }>().id;
  scopeCollectiu = (
    await api('POST', '/api/v1/scopes', {
      name: 'Família',
      kind: 'collective',
      color: '--plou-green',
    })
  ).json<{ id: string }>().id;
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('àmbits', () => {
  it("se'n pot llegir un de sol", async () => {
    const res = await api('GET', `/api/v1/scopes/${scopeIndividual}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('Personal');
  });

  it("es pot canviar el nom, i queda a l'historial", async () => {
    const res = await api('PATCH', `/api/v1/scopes/${scopeIndividual}`, { name: 'El meu' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('El meu');
    expect((await rastre(scopeIndividual)).map((e) => e.verb)).toContain('updated');

    await api('PATCH', `/api/v1/scopes/${scopeIndividual}`, { name: 'Personal' });
  });

  /**
   * **`kind` sí que es pot canviar, i en un sol sentit.**
   *
   * Abans no es podia, amb l'argument que passar a col·lectiu deixaria les tasques
   * assignades al propietari. Amb àmbits compartits això es gira: quan convides algú al
   * teu àmbit, que les d'abans segueixin sent teves és exactament el que ha de passar.
   * El que es nega és el sentit invers mentre quedi algú, que sí que trauria accés.
   *
   * Va en un àmbit propi i no en el compartit del fitxer: canviar-li el `kind` afectaria
   * l'assignació automàtica de les proves de més avall, i el defecte es veuria a tres
   * proves que no toquen àmbits.
   */
  it('`kind` es pot canviar cap a col·lectiu', async () => {
    const propi = (
      await api('POST', '/api/v1/scopes', { name: 'De prova', color: '--femho-scope-1' })
    ).json<{ id: string }>().id;

    const res = await api('PATCH', `/api/v1/scopes/${propi}`, { kind: 'collective' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ kind: string }>().kind).toBe('collective');

    // I torna, perquè no hi ha ningú més.
    const enrere = await api('PATCH', `/api/v1/scopes/${propi}`, { kind: 'individual' });
    expect(enrere.json<{ kind: string }>().kind).toBe('individual');
  });

  it("un àmbit amb tasques NO s'esborra, i diu quantes en té", async () => {
    const scopeId = (
      await api('POST', '/api/v1/scopes', { name: 'Ple', color: '--plou-red' })
    ).json<{ id: string }>().id;
    await novaTasca('Una cosa', scopeId);

    const res = await api('DELETE', `/api/v1/scopes/${scopeId}`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain('1 tasca');
  });

  it('un de buit sí, i queda registrat', async () => {
    const scopeId = (
      await api('POST', '/api/v1/scopes', { name: 'Buit', color: '--plou-red' })
    ).json<{ id: string }>().id;

    expect((await api('DELETE', `/api/v1/scopes/${scopeId}`)).statusCode).toBe(204);
    expect((await rastre(scopeId)).map((e) => e.verb)).toContain('deleted');
    expect((await api('GET', `/api/v1/scopes/${scopeId}`)).statusCode).toBe(403);
  });
});

describe('membres', () => {
  let memberId: string;

  it("un àmbit individual no en té: afegir-n'hi és 422", async () => {
    const res = await api('POST', `/api/v1/scopes/${scopeIndividual}/members`, {
      user_id: altreId,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('individual');
  });

  it("s'hi pot afegir una persona a un de col·lectiu", async () => {
    const res = await api('POST', `/api/v1/scopes/${scopeCollectiu}/members`, {
      user_id: altreId,
      role: 'collaborator',
    });
    expect(res.statusCode, res.body).toBe(201);
    memberId = res.json<{ id: string }>().id;
    // El nom hi va perquè la interfície no hagi de fer una segona crida per a cada fila.
    expect(res.json<{ name: string }>().name).toBe('Alba');
    expect((await rastre(memberId)).map((e) => e.entity_type)).toContain('scope_member');
  });

  it('ni usuari ni calendari, o tots dos, és 422', async () => {
    expect((await api('POST', `/api/v1/scopes/${scopeCollectiu}/members`, {})).statusCode).toBe(
      422,
    );
    const tots = await api('POST', `/api/v1/scopes/${scopeCollectiu}/members`, {
      user_id: altreId,
      external_calendar_id: uuidv7(),
    });
    expect(tots.statusCode).toBe(422);
  });

  it('el rol es pot canviar', async () => {
    const res = await api('PATCH', `/api/v1/scopes/${scopeCollectiu}/members/${memberId}`, {
      role: 'viewer',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ role: string }>().role).toBe('viewer');
    expect((await rastre(memberId)).map((e) => e.verb)).toContain('updated');
  });

  it("l'últim propietari no es pot degradar ni treure", async () => {
    const membres = await api('GET', `/api/v1/scopes/${scopeCollectiu}/members`);
    const owner = membres.json<{ id: string; role: string }[]>().find((m) => m.role === 'owner');
    expect(owner).toBeDefined();

    const degradat = await api('PATCH', `/api/v1/scopes/${scopeCollectiu}/members/${owner!.id}`, {
      role: 'collaborator',
    });
    expect(degradat.statusCode).toBe(409);
    expect(
      (await api('DELETE', `/api/v1/scopes/${scopeCollectiu}/members/${owner!.id}`)).statusCode,
    ).toBe(409);
  });

  it('i un membre normal sí', async () => {
    expect(
      (await api('DELETE', `/api/v1/scopes/${scopeCollectiu}/members/${memberId}`)).statusCode,
    ).toBe(204);
    expect((await rastre(memberId)).map((e) => e.verb)).toContain('deleted');
  });
});

describe('projectes', () => {
  let projectId: string;

  beforeAll(async () => {
    projectId = (
      await api('POST', '/api/v1/projects', { scope_id: scopeIndividual, name: 'Reforma' })
    ).json<{ id: string }>().id;
  });

  it("se'n pot llegir un de sol", async () => {
    const res = await api('GET', `/api/v1/projects/${projectId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('Reforma');
  });

  it("es pot arxivar i desarxivar, i queda a l'historial", async () => {
    const arxivat = await api('PATCH', `/api/v1/projects/${projectId}`, { archived: true });
    expect(arxivat.statusCode, arxivat.body).toBe(200);
    expect(arxivat.json<{ archived_at: string | null }>().archived_at).not.toBeNull();
    expect((await rastre(projectId)).map((e) => e.verb)).toContain('updated');

    const desarxivat = await api('PATCH', `/api/v1/projects/${projectId}`, { archived: false });
    expect(desarxivat.json<{ archived_at: string | null }>().archived_at).toBeNull();
  });

  it("AQUESTA importa: esborrar-lo NO s'endú les tasques", async () => {
    const taskId = await novaTasca('Dins del projecte');
    await api('PATCH', `/api/v1/tasks/${taskId}`, {});
    await sql`UPDATE tasks SET project_id = ${projectId} WHERE id = ${taskId}`.execute(conn.db);

    const res = await api('DELETE', `/api/v1/projects/${projectId}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ moved: number }>().moved).toBe(1);

    // Torna a l'espai general, que és el filtre `project_id IS NULL` i no una fila.
    const tasca = await api('GET', `/api/v1/tasks/${taskId}`);
    expect(tasca.statusCode).toBe(200);
    expect(tasca.json<{ project_id: string | null }>().project_id).toBeNull();
    expect((await rastre(projectId)).map((e) => e.verb)).toContain('deleted');
  });
});

describe('etiquetes', () => {
  let labelId: string;

  it('es pot crear una etiqueta i queda registrada', async () => {
    const res = await api('POST', '/api/v1/labels', {
      scope_id: scopeIndividual,
      name: 'Urgent',
      color: '--plou-red',
    });
    expect(res.statusCode, res.body).toBe(201);
    labelId = res.json<{ id: string }>().id;
    expect((await rastre(labelId)).map((e) => e.verb)).toContain('created');
  });

  it('crear-la dues vegades torna la mateixa', async () => {
    const res = await api('POST', '/api/v1/labels', { scope_id: scopeIndividual, name: 'Urgent' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ id: string }>().id).toBe(labelId);
  });

  it('sense àmbit es rebutja dient per què', async () => {
    const res = await api('POST', '/api/v1/labels', { name: 'Òrfena' });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('scope');
  });

  it("es pot posar i treure d'una tasca", async () => {
    const taskId = await novaTasca('Amb etiqueta');
    expect((await api('POST', `/api/v1/tasks/${taskId}/labels/${labelId}`)).statusCode).toBe(204);
    expect((await rastre(taskId)).map((e) => e.verb)).toContain('updated');
    expect((await api('DELETE', `/api/v1/tasks/${taskId}/labels/${labelId}`)).statusCode).toBe(204);
  });

  it("una etiqueta d'un altre àmbit no s'hi pot posar", async () => {
    const altra = (
      await api('POST', '/api/v1/labels', { scope_id: scopeCollectiu, name: 'Casa' })
    ).json<{ id: string }>().id;
    const taskId = await novaTasca('Del meu àmbit');

    const res = await api('POST', `/api/v1/tasks/${taskId}/labels/${altra}`);
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('another scope');
  });

  it("s'esborra i deixa rastre", async () => {
    expect((await api('DELETE', `/api/v1/labels/${labelId}`)).statusCode).toBe(204);
    expect((await rastre(labelId)).map((e) => e.verb)).toContain('deleted');
  });
});

describe('una tasca sola', () => {
  it('es pot llegir', async () => {
    const taskId = await novaTasca('Per llegir');
    const res = await api('GET', `/api/v1/tasks/${taskId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ title: string }>().title).toBe('Per llegir');
  });

  it('es pot editar, i el canvi queda amb el valor anterior i el nou', async () => {
    const taskId = await novaTasca('Títol vell');
    const res = await api('PATCH', `/api/v1/tasks/${taskId}`, {
      title: 'Títol nou',
      description: 'Amb descripció',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ title: string }>().title).toBe('Títol nou');

    const canvis = await sql<{ changes: string }>`
      SELECT changes FROM activity_log WHERE entity_id = ${taskId} AND verb = 'updated'
    `.execute(conn.db);
    expect(canvis.rows[0]?.changes).toContain('Títol vell');
    expect(canvis.rows[0]?.changes).toContain('Títol nou');
  });

  it('`null` buida un camp i absent no el toca', async () => {
    const taskId = await novaTasca('Amb data');
    await api('PATCH', `/api/v1/tasks/${taskId}`, { due_date: '2026-09-01' });

    // Absent: la data es queda.
    await api('PATCH', `/api/v1/tasks/${taskId}`, { title: 'Un altre títol' });
    expect(
      (await api('GET', `/api/v1/tasks/${taskId}`)).json<{ due_date: string | null }>().due_date,
    ).toBe('2026-09-01');

    // `null`: la data se'n va. Sense la distinció, buidar-la seria impossible des d'un
    // client que envia només el que ha canviat.
    await api('PATCH', `/api/v1/tasks/${taskId}`, { due_date: null });
    expect(
      (await api('GET', `/api/v1/tasks/${taskId}`)).json<{ due_date: string | null }>().due_date,
    ).toBeNull();
  });

  it("esborrar-la s'endú subtasques i llistes", async () => {
    const taskId = await novaTasca('Amb fills');
    const subtaskId = (
      await api('POST', `/api/v1/tasks/${taskId}/subtasks`, { title: 'Una subtasca' })
    ).json<{ id: string }>().id;
    const listId = (
      await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'Una llista' })
    ).json<{ id: string }>().id;

    expect((await api('DELETE', `/api/v1/tasks/${taskId}`)).statusCode).toBe(204);
    expect((await rastre(taskId)).map((e) => e.verb)).toContain('deleted');

    // Una subtasca no existeix fora de la seva tasca: no té àmbit ni identitat pròpia.
    const vius = await sql<{ n: number }>`
      SELECT
        (SELECT COUNT(*) FROM subtasks WHERE id = ${subtaskId} AND deleted_at IS NULL)
        + (SELECT COUNT(*) FROM checklists WHERE id = ${listId} AND deleted_at IS NULL) AS n
    `.execute(conn.db);
    expect(Number(vius.rows[0]?.n)).toBe(0);
  });
});

describe('assignats', () => {
  it("a un àmbit col·lectiu, qui no n'és membre no s'hi pot assignar", async () => {
    const taskId = await novaTasca('Compartida', scopeCollectiu);
    const res = await api('POST', `/api/v1/tasks/${taskId}/assignees/${altreId}`);
    expect(res.statusCode).toBe(422);
    // Perquè veuria una tasca seva que no pot obrir.
    expect(res.json<{ detail: string }>().detail).toContain('Alba');
  });

  it('i qui sí, sí, amb rastre', async () => {
    await api('POST', `/api/v1/scopes/${scopeCollectiu}/members`, { user_id: altreId });
    const taskId = await novaTasca("Per a l'Alba", scopeCollectiu);

    const res = await api('POST', `/api/v1/tasks/${taskId}/assignees/${altreId}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ assignee_ids: string[] }>().assignee_ids).toContain(altreId);
    expect((await rastre(taskId)).map((e) => e.verb)).toContain('updated');

    const tret = await api('DELETE', `/api/v1/tasks/${taskId}/assignees/${altreId}`);
    expect(tret.json<{ assignee_ids: string[] }>().assignee_ids).not.toContain(altreId);
  });
});

describe('subtasques', () => {
  let taskId: string;
  let subtaskId: string;

  beforeAll(async () => {
    taskId = await novaTasca('Amb subtasques');
    subtaskId = (await api('POST', `/api/v1/tasks/${taskId}/subtasks`, { title: 'Primera' })).json<{
      id: string;
    }>().id;
  });

  it('es creen i es llisten en ordre', async () => {
    await api('POST', `/api/v1/tasks/${taskId}/subtasks`, { title: 'Segona' });
    const res = await api('GET', `/api/v1/tasks/${taskId}/subtasks`);
    expect(res.json<{ title: string }[]>().map((s) => s.title)).toEqual(['Primera', 'Segona']);
    expect((await rastre(subtaskId)).map((e) => e.verb)).toContain('created');
  });

  it('marcar-la és `completed` i desmarcar-la `reopened`', async () => {
    const marcada = await api('PATCH', `/api/v1/subtasks/${subtaskId}`, { done: true });
    expect(marcada.json<{ done: boolean }>().done).toBe(true);
    expect((await rastre(subtaskId)).map((e) => e.verb)).toContain('completed');

    await api('PATCH', `/api/v1/subtasks/${subtaskId}`, { done: false });
    expect((await rastre(subtaskId)).map((e) => e.verb)).toContain('reopened');
  });

  it('esborrar-la DESANCORA les llistes, no les esborra', async () => {
    const listId = (
      await api('POST', `/api/v1/tasks/${taskId}/checklists`, {
        name: 'Ancorada',
        subtask_id: subtaskId,
      })
    ).json<{ id: string }>().id;

    expect((await api('DELETE', `/api/v1/subtasks/${subtaskId}`)).statusCode).toBe(204);

    // Una llista de la compra segueix sent la llista de la compra.
    const llista = await api('GET', `/api/v1/checklists/${listId}`);
    expect(llista.statusCode).toBe(200);
    expect(llista.json<{ subtask_id: string | null }>().subtask_id).toBeNull();
  });
});

describe('comentaris', () => {
  it("es poden escriure i llegir, i surten a l'historial", async () => {
    const taskId = await novaTasca('Per comentar');
    const res = await api('POST', `/api/v1/tasks/${taskId}/comments`, { body: 'Ja ho he fet' });
    expect(res.statusCode, res.body).toBe(201);

    const llista = await api('GET', `/api/v1/tasks/${taskId}/comments`);
    expect(llista.json<{ body: string }[]>().map((c) => c.body)).toContain('Ja ho he fet');

    // És la via principal perquè un agent reporti (docs/09 §6).
    expect((await rastre(taskId)).map((e) => e.verb)).toContain('commented');
  });
});

describe('llistes senzilles, la resta del CRUD', () => {
  let taskId: string;
  let listId: string;

  beforeAll(async () => {
    taskId = await novaTasca('Amb llista completa');
    listId = (await api('POST', `/api/v1/tasks/${taskId}/checklists`, { name: 'La compra' })).json<{
      id: string;
    }>().id;
  });

  it("es pot llegir sola, amb el títol de la tasca d'origen", async () => {
    const res = await api('GET', `/api/v1/checklists/${listId}`);
    expect(res.statusCode).toBe(200);
    // La vista de llista el pinta com a molla de pa clicable (docs/02 §6).
    expect(res.json<{ task_title: string }>().task_title).toBe('Amb llista completa');
  });

  it('es pot canviar el nom i el commutador de completats', async () => {
    const res = await api('PATCH', `/api/v1/checklists/${listId}`, {
      name: 'Compra setmanal',
      show_completed_inline: false,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ name: string; show_completed_inline: boolean }>()).toMatchObject({
      name: 'Compra setmanal',
      show_completed_inline: false,
    });
    expect((await rastre(listId)).map((e) => e.verb)).toContain('updated');
  });

  it("un ítem s'esborra i deixa rastre", async () => {
    const itemId = (await api('POST', `/api/v1/checklists/${listId}/items`, { text: 'Pa' })).json<{
      id: string;
    }>().id;

    expect((await api('DELETE', `/api/v1/checklist-items/${itemId}`)).statusCode).toBe(204);
    expect((await rastre(itemId)).map((e) => e.verb)).toContain('deleted');
  });

  it("i la llista sencera s'endú els seus ítems", async () => {
    const itemId = (await api('POST', `/api/v1/checklists/${listId}/items`, { text: 'Vi' })).json<{
      id: string;
    }>().id;

    expect((await api('DELETE', `/api/v1/checklists/${listId}`)).statusCode).toBe(204);
    expect((await rastre(listId)).map((e) => e.verb)).toContain('deleted');

    const viu = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM checklist_items WHERE id = ${itemId} AND deleted_at IS NULL
    `.execute(conn.db);
    expect(Number(viu.rows[0]?.n)).toBe(0);
  });
});

describe('inbox i dashboard', () => {
  it("l'inbox reparteix el dia, les endarrerides i les sense data", async () => {
    const avui = await novaTasca("D'avui");
    const vella = await novaTasca('Endarrerida');
    await novaTasca('Sense data');

    await api('PATCH', `/api/v1/tasks/${avui}`, { due_date: '2026-08-06' });
    await api('PATCH', `/api/v1/tasks/${vella}`, { due_date: '2026-07-01' });

    const res = await api('GET', '/api/v1/inbox?date=2026-08-06&include_overdue=true');
    expect(res.statusCode, res.body).toBe(200);
    const cos = res.json<{
      dated: { id: string }[];
      overdue: { id: string }[];
      undated: { id: string }[];
    }>();

    expect(cos.dated.map((t) => t.id)).toContain(avui);
    expect(cos.overdue.map((t) => t.id)).toContain(vella);
    expect(cos.undated.length).toBeGreaterThan(0);
  });

  it('i sense demanar-les, les endarrerides no hi són', async () => {
    const res = await api('GET', '/api/v1/inbox?date=2026-08-06&include_overdue=false');
    expect(res.json<{ overdue: unknown[] }>().overdue).toEqual([]);
  });

  it('el dashboard compta per àmbit i ho ensenya tot', async () => {
    const res = await api('GET', '/api/v1/dashboard?date=2026-08-06');
    expect(res.statusCode, res.body).toBe(200);
    const cos = res.json<{
      scopes: { scope_id: string; pending: number }[];
      today: unknown[];
      overdue: unknown[];
      doing: unknown[];
    }>();

    // Ignora la selecció d'àmbits: hi són tots els que l'usuari veu (docs/02 §8).
    expect(cos.scopes.map((s) => s.scope_id)).toContain(scopeIndividual);
    expect(cos.scopes.map((s) => s.scope_id)).toContain(scopeCollectiu);
    expect(cos.scopes.some((s) => s.pending > 0)).toBe(true);
  });
});

describe('cerca i parseig', () => {
  it('la cerca troba amb accents i sense', async () => {
    await novaTasca('Anar al col·legi');

    for (const consulta of ['collegi', 'col·legi', 'COL·LEGI']) {
      const res = await api('GET', `/api/v1/search?q=${encodeURIComponent(consulta)}`);
      expect(res.statusCode, res.body).toBe(200);
      expect(
        res.json<{ data: { title: string }[] }>().data.map((t) => t.title),
        `buscant "${consulta}"`,
      ).toContain('Anar al col·legi');
    }
  });

  it('`/parse` fa servir el mateix parser que els clients', async () => {
    const res = await api('POST', '/api/v1/parse', { text: '#Personal Comprar pa' });
    expect(res.statusCode, res.body).toBe(200);
    const cos = res.json<{ title: string; scopeId: string | null; tokens: unknown[] }>();
    expect(cos.title).toBe('Comprar pa');
    expect(cos.scopeId).toBe(scopeIndividual);
    expect(cos.tokens).toHaveLength(1);
  });

  it("amb més d'un àmbit actiu i sense `#`, ho diu en comptes d'endevinar", async () => {
    const res = await api('POST', '/api/v1/parse', { text: 'Comprar pa' });
    expect(res.json<{ error: string | null }>().error).toBe('scope-required');
  });
});

describe('calendaris', () => {
  let calendarId: string;

  it("se'n pot crear un, i queda registrat", async () => {
    const res = await api('POST', '/api/v1/calendars', {
      scope_id: scopeIndividual,
      name: 'Meu',
      kind: 'events',
    });
    expect(res.statusCode, res.body).toBe(201);
    calendarId = res.json<{ id: string }>().id;
    expect((await rastre(calendarId)).map((e) => e.verb)).toContain('created');
  });

  it('una subscripció sense URL es rebutja', async () => {
    const res = await api('POST', '/api/v1/calendars', {
      scope_id: scopeIndividual,
      name: 'Festius',
      origin: 'subscription',
    });
    expect(res.statusCode).toBe(422);
  });

  it('es pot canviar el nom', async () => {
    const res = await api('PATCH', `/api/v1/calendars/${calendarId}`, { name: 'El meu' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('El meu');
    expect((await rastre(calendarId)).map((e) => e.verb)).toContain('updated');
  });

  it("un calendari local amb esdeveniments NO s'esborra", async () => {
    await api('POST', '/api/v1/events', {
      calendar_id: calendarId,
      summary: 'Dentista',
      starts_at: '2026-09-01T10:00:00.000Z',
      ends_at: '2026-09-01T11:00:00.000Z',
    });

    const res = await api('DELETE', `/api/v1/calendars/${calendarId}`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain('event');
  });

  it('i un de buit sí', async () => {
    const buit = (
      await api('POST', '/api/v1/calendars', { scope_id: scopeIndividual, name: 'Buit' })
    ).json<{ id: string }>().id;
    expect((await api('DELETE', `/api/v1/calendars/${buit}`)).statusCode).toBe(204);
    expect((await rastre(buit)).map((e) => e.verb)).toContain('deleted');
  });
});

describe('esdeveniments', () => {
  let calendarId: string;

  beforeAll(async () => {
    calendarId = (
      await api('POST', '/api/v1/calendars', { scope_id: scopeIndividual, name: 'Per esborrar' })
    ).json<{ id: string }>().id;
  });

  it("se'n pot llegir un de sol", async () => {
    const id = (
      await api('POST', '/api/v1/events', {
        calendar_id: calendarId,
        summary: 'Reunió',
        starts_at: '2026-09-02T10:00:00.000Z',
        ends_at: '2026-09-02T11:00:00.000Z',
      })
    ).json<{ id: string }>().id;

    const res = await api('GET', `/api/v1/events/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ summary: string }>().summary).toBe('Reunió');
  });

  it('i esborrar-lo, amb rastre', async () => {
    const id = (
      await api('POST', '/api/v1/events', {
        calendar_id: calendarId,
        summary: 'Cancel·lada',
        starts_at: '2026-09-03T10:00:00.000Z',
        ends_at: '2026-09-03T11:00:00.000Z',
      })
    ).json<{ id: string }>().id;

    expect((await api('DELETE', `/api/v1/events/${id}`)).statusCode).toBe(204);
    expect((await rastre(id)).map((e) => e.verb)).toContain('deleted');
    expect((await api('GET', `/api/v1/events/${id}`)).statusCode).toBe(404);
  });
});

describe('el compte propi', () => {
  it("es poden canviar el tema i l'accent", async () => {
    const res = await api('PATCH', '/api/v1/auth/me', { theme: 'dark', accent: 'soft' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ theme: string; accent: string }>()).toMatchObject({
      theme: 'dark',
      accent: 'soft',
    });
    expect((await rastre(userId)).map((e) => e.verb)).toContain('updated');
  });

  it('un tema que no existeix es rebutja dient quins hi ha', async () => {
    const res = await api('PATCH', '/api/v1/auth/me', { theme: 'fosc' });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('system, light, dark');
  });

  it('un fus que no existeix, també', async () => {
    const res = await api('PATCH', '/api/v1/auth/me', { timezone: 'Europa/Madrit' });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('IANA');
  });

  it('les preferències es guarden i es tornen a llegir', async () => {
    const res = await api('PATCH', '/api/v1/auth/settings', {
      inbox_position: 'below',
      show_calendar_widget: false,
      collapsed_groups: [scopeIndividual],
    });
    expect(res.statusCode, res.body).toBe(200);

    const llegit = await api('GET', '/api/v1/auth/settings');
    expect(llegit.json<{ settings: { inbox_position: string } }>().settings).toMatchObject({
      inbox_position: 'below',
      show_calendar_widget: false,
      collapsed_groups: [scopeIndividual],
    });
  });

  it("una posició d'Inbox inventada es rebutja", async () => {
    const res = await api('PATCH', '/api/v1/auth/settings', { inbox_position: 'dalt' });
    expect(res.statusCode).toBe(422);
  });
});

describe('agents', () => {
  let agentId: string;

  it("se'n pot crear un, i queda registrat", async () => {
    const res = await api('POST', '/api/v1/ai/agents', { name: 'Claude', can_create_tasks: true });
    expect(res.statusCode, res.body).toBe(201);
    agentId = res.json<{ id: string }>().id;

    // D5: la responsabilitat es queda amb una persona.
    expect(res.json<{ on_behalf_of_user_id: string }>().on_behalf_of_user_id).toBe(userId);
    expect((await rastre(agentId)).map((e) => e.verb)).toContain('created');
  });

  it("l'actor és la fila d'usuari `kind='ai'`, que existeix des de la migració", async () => {
    const res = await api('GET', `/api/v1/ai/agents/${agentId}`);
    const actor = res.json<{ actor_user_id: string }>().actor_user_id;

    const fila = await sql<{ kind: string }>`SELECT kind FROM users WHERE id = ${actor}`.execute(
      conn.db,
    );
    expect(fila.rows[0]?.kind).toBe('ai');
  });

  it('desactivar-lo allibera les seves reserves', async () => {
    const taskId = await novaTasca('Reservada');
    await sql`
      INSERT INTO task_leases (task_id, user_id, agent_id, acquired_at, expires_at)
      VALUES (${taskId}, ${userId}, ${agentId}, ${NOW}, '2099-01-01T00:00:00.000Z')
    `.execute(conn.db);

    const res = await api('PATCH', `/api/v1/ai/agents/${agentId}`, { enabled: false });
    expect(res.statusCode, res.body).toBe(200);
    expect((await rastre(agentId)).map((e) => e.verb)).toContain('updated');

    // Si no, la tasca es queda bloquejada fins que la reserva caduqui sola i, des de
    // fora, sembla que el producte s'hagi encallat.
    const reserves = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM task_leases WHERE agent_id = ${agentId}
    `.execute(conn.db);
    expect(Number(reserves.rows[0]?.n)).toBe(0);
  });

  it('esborrar-lo desdelega les tasques però no se les endú', async () => {
    const taskId = await novaTasca('Delegada');
    await sql`
      UPDATE tasks SET delegate_agent_id = ${agentId}, ai_mode = 'delegated' WHERE id = ${taskId}
    `.execute(conn.db);

    const res = await api('DELETE', `/api/v1/ai/agents/${agentId}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ released: number }>().released).toBe(1);
    expect((await rastre(agentId)).map((e) => e.verb)).toContain('deleted');

    // La feina és de la persona, no de l'agent (D5).
    const tasca = await api('GET', `/api/v1/tasks/${taskId}`);
    expect(tasca.statusCode).toBe(200);
    expect(tasca.json<{ ai_mode: string }>().ai_mode).toBe('manual');
  });

  it("l'agent d'algú altre no existeix", async () => {
    const meu = (await api('POST', '/api/v1/ai/agents', { name: 'Privat' })).json<{ id: string }>()
      .id;

    await sql`UPDATE ai_agents SET on_behalf_of_user_id = ${altreId} WHERE id = ${meu}`.execute(
      conn.db,
    );
    // Dir "existeix però no és teu" ja és dir de qui és.
    expect((await api('GET', `/api/v1/ai/agents/${meu}`)).statusCode).toBe(404);
  });
});

describe('reserves', () => {
  it('`next-task` amb res a fer torna null i no un 404', async () => {
    const res = await api('GET', '/api/v1/ai/next-task');
    expect(res.statusCode, res.body).toBe(200);
    // Un 404 faria que un agent que consulta cada minut ho llegís com un error de
    // configuració.
    expect(res.json<{ task: unknown }>()).toHaveProperty('task');
  });

  it('reservar deixa rastre, i alliberar sense motiu es rebutja', async () => {
    const taskId = await novaTasca('Per reservar');
    await sql`UPDATE tasks SET ai_mode = 'delegated' WHERE id = ${taskId}`.execute(conn.db);

    const reservada = await api('POST', `/api/v1/ai/tasks/${taskId}/claim`);
    expect(reservada.statusCode, reservada.body).toBe(200);
    expect((await rastre(taskId)).map((e) => e.verb)).toContain('claimed');

    const sense = await api('POST', `/api/v1/ai/tasks/${taskId}/release`, { reason: '' });
    expect(sense.statusCode).toBe(422);

    const amb = await api('POST', `/api/v1/ai/tasks/${taskId}/release`, { reason: 'No sé fer-ho' });
    expect(amb.statusCode, amb.body).toBe(204);
    expect((await rastre(taskId)).map((e) => e.verb)).toContain('released');
  });
});

describe('compartits, la resta', () => {
  let shareId: string;

  beforeAll(async () => {
    const taskId = await novaTasca('Per compartir');
    // La creació torna `{url, token, share}`: l'URL sencer surt aquí i enlloc més
    // (docs/10 §6), perquè el token no es pot recuperar del seu HMAC.
    shareId = (await api('POST', '/api/v1/shares', { task_id: taskId, permission: 'view' })).json<{
      share: { id: string };
    }>().share.id;
  });

  it("se'n pot llegir un de sol, i el token no hi surt", async () => {
    const res = await api('GET', `/api/v1/shares/${shareId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('token');
  });

  it('es pot canviar el permís sense canviar el token', async () => {
    const res = await api('PATCH', `/api/v1/shares/${shareId}`, { permission: 'check' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ permission: string }>().permission).toBe('check');
    expect((await rastre(shareId)).map((e) => e.verb)).toContain('updated');
  });

  it('els accessos són pseudònims i no hi ha cap IP', async () => {
    const res = await api('GET', `/api/v1/shares/${shareId}/accesses`);
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/u);
  });

  it('un enllaç revocat no es pot reconfigurar', async () => {
    await api('DELETE', `/api/v1/shares/${shareId}`);
    const res = await api('PATCH', `/api/v1/shares/${shareId}`, { permission: 'view' });
    expect(res.statusCode).toBe(409);
  });
});

describe('administració', () => {
  it('la llista de membres NO inclou la fila de la IA', async () => {
    const res = await api('GET', '/api/v1/admin/users');
    expect(res.statusCode, res.body).toBe(200);
    const usuaris = res.json<{ kind: string; name: string }[]>();
    expect(usuaris.map((u) => u.kind)).not.toContain('ai');
    expect(usuaris.map((u) => u.name)).toContain('Borja');
  });

  it("convidar crea l'usuari SENSE contrasenya i dona un enllaç d'un sol ús", async () => {
    const res = await api('POST', '/api/v1/admin/users/invite', {
      email: 'marta@example.com',
      name: 'Marta',
    });
    expect(res.statusCode, res.body).toBe(201);

    const cos = res.json<{ user: { id: string }; invite_url: string }>();
    expect(cos.invite_url).toContain('/invite/');
    expect((await rastre(cos.user.id)).map((e) => e.verb)).toContain('created');

    // L'administrador no arriba a saber la contrasenya mai.
    const fila = await sql<{ password_hash: string | null }>`
      SELECT password_hash FROM users WHERE id = ${cos.user.id}
    `.execute(conn.db);
    expect(fila.rows[0]?.password_hash).toBeNull();

    // I el token no es guarda en clar enlloc (D10).
    const token = cos.invite_url.split('/invite/')[1]!;
    const guardat = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM user_invites WHERE token_hmac = ${token}
    `.execute(conn.db);
    expect(Number(guardat.rows[0]?.n)).toBe(0);

    // I s'hi pot posar contrasenya, un sol cop.
    const primera = await app.inject({
      method: 'POST',
      url: `/invite/${token}`,
      payload: { password: 'una-contrasenya-llarga' },
    });
    expect(primera.statusCode, primera.body).toBe(200);

    const segona = await app.inject({
      method: 'POST',
      url: `/invite/${token}`,
      payload: { password: 'una-altra-contrasenya' },
    });
    expect(segona.statusCode).toBe(404);
  });

  it('el mateix correu dues vegades és 409', async () => {
    const res = await api('POST', '/api/v1/admin/users/invite', {
      email: 'marta@example.com',
      name: 'Marta altra volta',
    });
    expect(res.statusCode).toBe(409);
  });

  it('un administrador NO es pot esborrar a si mateix', async () => {
    const res = await api('DELETE', `/api/v1/admin/users/${userId}`);
    expect(res.statusCode).toBe(409);
    expect(res.json<{ detail: string }>().detail).toContain('another administrator');
  });

  it('ni deixar la instància sense cap', async () => {
    const res = await api('PATCH', `/api/v1/admin/users/${userId}`, { role: 'member' });
    expect(res.statusCode).toBe(409);
  });

  it('i un altre usuari sí, amb rastre', async () => {
    const res = await api('PATCH', `/api/v1/admin/users/${altreId}`, { name: 'Alba Puig' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ name: string }>().name).toBe('Alba Puig');
    expect((await rastre(altreId)).map((e) => e.verb)).toContain('updated');
  });

  it('el diagnòstic no porta cap secret', async () => {
    const res = await api('GET', '/api/v1/admin/diagnostics');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.body).not.toContain('x'.repeat(40));
    expect(res.body).not.toContain(tmp);
    expect(res.json<{ instance: { name: string } }>().instance.name).toBe('Casa nostra');
  });

  it("l'exportació porta les dades i no les esborrades", async () => {
    const esborrada = await novaTasca('Esborrada de debò');
    await api('DELETE', `/api/v1/tasks/${esborrada}`);

    const res = await api('GET', '/api/v1/export');
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['content-disposition']).toContain('fem-ho-');

    const cos = res.json<{ format: string; tasks: { id: string }[]; scopes: unknown[] }>();
    expect(cos.format).toBe('fem-ho/export');
    expect(cos.scopes.length).toBeGreaterThan(0);
    // Una exportació és el que l'usuari té, no el que va tenir.
    expect(cos.tasks.map((t) => t.id)).not.toContain(esborrada);
  });
});

/**
 * La data límit i el projecte, al `PATCH`.
 *
 * Totes dues surten de docs/02 §7 i cap de les dues existia: `deadline` era una columna
 * que ningú podia omplir, i moure una tasca de projecte no es podia fer des de l'API.
 */
describe('data límit i projecte', () => {
  it('la data límit és SEPARADA del venciment', async () => {
    const taskId = await novaTasca('Amb les dues dates');

    await api('PATCH', `/api/v1/tasks/${taskId}`, {
      due_date: '2026-09-10',
      deadline: '2026-09-30T23:59:59.000Z',
    });

    const res = await api('GET', `/api/v1/tasks/${taskId}`);
    const cos = res.json<{ due_date: string | null; deadline: string | null }>();

    // "Fes-ho el dia 10" i "com a molt tard el 30" conviuen: amb un sol camp, qui té
    // les dues n'hauria de triar una.
    expect(cos.due_date).toBe('2026-09-10');
    expect(cos.deadline).toContain('2026-09-30');
  });

  it("es pot moure de projecte i tornar a l'espai general", async () => {
    const projectId = (
      await api('POST', '/api/v1/projects', { scope_id: scopeIndividual, name: 'Obres' })
    ).json<{ id: string }>().id;
    const taskId = await novaTasca('Per moure de carpeta');

    const moguda = await api('PATCH', `/api/v1/tasks/${taskId}`, { project_id: projectId });
    expect(moguda.statusCode, moguda.body).toBe(200);
    expect(moguda.json<{ project_id: string | null }>().project_id).toBe(projectId);

    // `null` la torna a l'espai general, que és el filtre `project_id IS NULL`.
    const treta = await api('PATCH', `/api/v1/tasks/${taskId}`, { project_id: null });
    expect(treta.json<{ project_id: string | null }>().project_id).toBeNull();
  });

  it("un projecte d'un altre àmbit es rebutja dient per què", async () => {
    const altre = (
      await api('POST', '/api/v1/projects', { scope_id: scopeCollectiu, name: 'Del col·lectiu' })
    ).json<{ id: string }>().id;
    const taskId = await novaTasca('Del meu àmbit');

    const res = await api('PATCH', `/api/v1/tasks/${taskId}`, { project_id: altre });
    expect(res.statusCode).toBe(422);
    // Una tasca no canvia d'àmbit editant-la: altres membres, altres etiquetes, altra
    // assignació automàtica.
    expect(res.json<{ detail: string }>().detail).toContain('another scope');
  });
});

/**
 * La generació de la següent instància. docs/13 M4.
 *
 * "`POST /tasks/{id}/complete` amb cascada i generació de la següent instància si es
 * repeteix, distingint `recurrence_mode` `schedule` de `completion`."
 */
describe('tasques que es repeteixen', () => {
  it('amb `schedule`, la següent surt del VENCIMENT anterior', async () => {
    const taskId = await novaTasca('Treure les escombraries');
    await api('PATCH', `/api/v1/tasks/${taskId}`, {
      due_date: '2026-08-04',
      rrule: 'FREQ=WEEKLY',
      recurrence_mode: 'schedule',
    });

    await api('POST', `/api/v1/tasks/${taskId}/complete`);

    const seguent = await sql<{ id: string; due_date: string; status: string }>`
      SELECT id, due_date, status FROM tasks WHERE recurrence_parent_id = ${taskId}
    `.execute(conn.db);

    expect(seguent.rows).toHaveLength(1);
    // Cada dimarts és cada dimarts, tant si la vas fer dimarts com dijous.
    expect(seguent.rows[0]?.due_date).toBe('2026-08-11');
    // Neix a `todo` i no a la bústia: ja se sap què és i quan toca.
    expect(seguent.rows[0]?.status).toBe('todo');
  });

  it("amb `completion`, surt del dia que s'ha FET", async () => {
    const taskId = await novaTasca('Regar les plantes');
    await api('PATCH', `/api/v1/tasks/${taskId}`, {
      // Un venciment vell a posta: amb `completion` no s'hi ha de mirar.
      due_date: '2026-01-01',
      rrule: 'FREQ=WEEKLY',
      recurrence_mode: 'completion',
    });

    await api('POST', `/api/v1/tasks/${taskId}/complete`);

    const seguent = await sql<{ due_date: string }>`
      SELECT due_date FROM tasks WHERE recurrence_parent_id = ${taskId}
    `.execute(conn.db);

    // Una setmana des d'avui, no des del gener: és la diferència entre `every` i
    // `every!`, i confondre-la fa que la tasca s'acumuli o desaparegui.
    const esperat = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    expect(seguent.rows[0]?.due_date).toBe(esperat);
  });

  it('els assignats van amb la instància nova', async () => {
    const taskId = await novaTasca('Amb responsable');
    await api('PATCH', `/api/v1/tasks/${taskId}`, {
      due_date: '2026-08-04',
      rrule: 'FREQ=DAILY',
    });

    await api('POST', `/api/v1/tasks/${taskId}/complete`);

    const seguent = await sql<{ id: string }>`
      SELECT id FROM tasks WHERE recurrence_parent_id = ${taskId}
    `.execute(conn.db);
    const assignats = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM task_assignees WHERE task_id = ${seguent.rows[0]!.id}
    `.execute(conn.db);

    // Qui treia les escombraries la setmana passada les segueix traient.
    expect(Number(assignats.rows[0]?.n)).toBeGreaterThan(0);
  });

  /**
   * **I arrossegant-la a Fet també**, que és l'únic camí que la interfície fa servir.
   *
   * Les tres proves de sobre van per `/complete`, un endpoint que no crida cap client: si
   * la repetició només hi hagués funcionat, ningú n'hauria vist mai la segona instància.
   */
  it('i arrossegant-la a Fet, que és el que fa la interfície', async () => {
    const taskId = await novaTasca('Cada dimarts');
    await api('PATCH', `/api/v1/tasks/${taskId}`, {
      due_date: '2026-08-04',
      rrule: 'FREQ=WEEKLY',
      recurrence_mode: 'schedule',
    });

    await api('POST', `/api/v1/tasks/${taskId}/move`, { status: 'done' });

    const seguent = await sql<{ due_date: string; status: string }>`
      SELECT due_date, status FROM tasks WHERE recurrence_parent_id = ${taskId}
    `.execute(conn.db);
    expect(seguent.rows).toHaveLength(1);
    expect(seguent.rows[0]?.due_date).toBe('2026-08-11');
  });

  it('una tasca que NO es repeteix no genera res', async () => {
    const taskId = await novaTasca('Una sola vegada');
    await api('POST', `/api/v1/tasks/${taskId}/complete`);

    const seguent = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM tasks WHERE recurrence_parent_id = ${taskId}
    `.execute(conn.db);
    expect(Number(seguent.rows[0]?.n)).toBe(0);
  });
});

describe('netejar la instància', () => {
  it('sense el nom exacte no fa res', async () => {
    const res = await api('POST', '/api/v1/admin/wipe', { confirmation: 'casa nostra' });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('Casa nostra');

    const queden = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM scopes`.execute(conn.db);
    expect(Number(queden.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('i amb el nom exacte, buida i deixa constància', async () => {
    const res = await api('POST', '/api/v1/admin/wipe', { confirmation: 'Casa nostra' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<{ deleted: Record<string, number> }>().deleted).toHaveProperty('tasks');

    const queden = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM tasks`.execute(conn.db);
    expect(Number(queden.rows[0]?.n)).toBe(0);

    // El registre s'escriu DESPRÉS de buidar `activity_log`: netejar la instància ha de
    // deixar constància que algú ho va fer.
    const rastreDelWipe = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM activity_log WHERE entity_type = 'instance'
    `.execute(conn.db);
    expect(Number(rastreDelWipe.rows[0]?.n)).toBe(1);

    // Els usuaris no cauen amb la neteja: la instància segueix sent de qui era.
    const usuaris = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM users WHERE kind = 'human' AND deleted_at IS NULL
    `.execute(conn.db);
    expect(Number(usuaris.rows[0]?.n)).toBeGreaterThan(0);
  });
});
