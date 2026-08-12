/**
 * El Registre: què torna, què suma i qui ho pot veure.
 *
 * Els números d'aquesta pantalla es facturen. El que decideix aquí és que **els totals
 * quadrin amb els blocs** —si la capçalera i les files no diuen el mateix, la pantalla és
 * pitjor que no tenir-la— i que la dedicació d'una persona no la vegi qui no hi mana.
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

const tmp = mkdtempSync(join(tmpdir(), 'femho-registre-'));
const NOW = '2026-08-12T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let comMarta: { authorization: string };
let borjaId: string;
let martaId: string;
let scopeId: string;
let projectId: string;

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  headers = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers })
    : app.inject({ method, url, headers, payload });
}

interface Report {
  data: {
    id: string;
    task_title: string;
    project_name: string | null;
    user_name: string | null;
    minutes: number;
    overtime_minutes: number;
    started_at: string;
    needs_review: boolean;
  }[];
  totals: {
    minutes: number;
    overtime_minutes: number;
    tasks: number;
    by_user: { key: string; minutes: number }[];
    by_project: { key: string; label: string; minutes: number }[];
    by_day: { key: string; minutes: number }[];
  };
}

/** Una tasca amb un bloc de dedicació ja apuntat, a l'hora que es demani. */
async function feina(
  title: string,
  from: string,
  to: string,
  options: { project?: string; user?: string } = {},
): Promise<string> {
  const created = await api('POST', '/api/v1/tasks', {
    scope_id: scopeId,
    title,
    ...(options.project === undefined ? {} : { project_id: options.project }),
  });
  const taskId = created.json<{ id: string }>().id;

  await api('POST', '/api/v1/sessions', {
    task_id: taskId,
    started_at: from,
    ended_at: to,
    ...(options.user === undefined ? {} : { user_id: options.user }),
  });
  return taskId;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  borjaId = uuidv7();
  martaId = uuidv7();
  for (const [id, email, name] of [
    [borjaId, 'borja@example.com', 'Borja'],
    [martaId, 'marta@example.com', 'Marta'],
  ] as const) {
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, timezone,
                         created_at, updated_at)
      VALUES (${id}, ${email}, ${name}, ${await hashPassword(PASSWORD)}, 'human', 'member',
              'Europe/Madrid', ${NOW}, ${NOW})
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
  comMarta = await entra('marta@example.com');

  scopeId = (
    await api('POST', '/api/v1/scopes', {
      name: 'Feina',
      color: '--plou-orange',
      kind: 'collective',
    })
  ).json<{ id: string }>().id;
  projectId = (
    await api('POST', '/api/v1/projects', { scope_id: scopeId, name: 'Ajuntament de Salt' })
  ).json<{ id: string }>().id;

  // La Marta hi col·labora: veurà les seves hores i no les dels altres.
  await api('POST', `/api/v1/scopes/${scopeId}/members`, {
    user_id: martaId,
    role: 'collaborator',
  });

  await api('PATCH', `/api/v1/scopes/${scopeId}/settings`, { time_tracking: true });
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('els totals quadren amb els blocs', () => {
  it('suma els minuts, compta les tasques i reparteix per dia, projecte i persona', async () => {
    // Dimecres 22/07/2026 a Madrid (UTC+2): 9:25–10:15 i 13:55–14:30.
    await feina('Mirar mencions', '2026-07-22T07:25:00.000Z', '2026-07-22T08:15:00.000Z', {
      project: projectId,
    });
    await feina('Publicacions FM', '2026-07-22T11:55:00.000Z', '2026-07-22T12:30:00.000Z', {
      project: projectId,
    });
    // I una de l'espai general de l'àmbit —el que a la pantalla es diu «Intern»— un altre dia.
    await feina('Crear contenidor al NAS', '2026-07-21T07:00:00.000Z', '2026-07-21T07:50:00.000Z');

    const res = await api('GET', `/api/v1/sessions?from=2026-07-01&to=2026-07-31`);
    expect(res.statusCode, res.body).toBe(200);
    const report = res.json<Report>();

    expect(report.data).toHaveLength(3);
    expect(report.totals.minutes).toBe(50 + 35 + 50);
    expect(report.totals.tasks).toBe(3);

    // Els totals per dia són els mateixos minuts agrupats, i van del més recent al més antic.
    expect(report.totals.by_day.map((d) => d.key)).toEqual(['2026-07-22', '2026-07-21']);
    expect(report.totals.by_day[0]?.minutes).toBe(85);

    // I el projecte: el que no en té surt sota `none`, que és el mateix nom que fa servir el
    // filtre. «Sense projecte» és una fila més, no un forat.
    const perProjecte = new Map(report.totals.by_project.map((b) => [b.key, b.minutes]));
    expect(perProjecte.get(projectId)).toBe(85);
    expect(perProjecte.get('none')).toBe(50);
  });

  it("un bloc fora d'horari compta les seves hores extres", async () => {
    // Dimecres 22/07, 19:00–20:00 local: una hora sencera després de les sis.
    await feina('Enviar la factura', '2026-07-22T17:00:00.000Z', '2026-07-22T18:00:00.000Z');

    const res = await api('GET', '/api/v1/sessions?from=2026-07-22&to=2026-07-22');
    const report = res.json<Report>();
    const extra = report.data.find((entry) => entry.task_title === 'Enviar la factura');

    expect(extra?.minutes).toBe(60);
    expect(extra?.overtime_minutes).toBe(60);
    expect(report.totals.overtime_minutes).toBe(60);
  });

  it('i el filtre de dates deixa fora el que no hi cau', async () => {
    const res = await api('GET', '/api/v1/sessions?from=2026-07-21&to=2026-07-21');
    expect(res.json<Report>().data.map((entry) => entry.task_title)).toEqual([
      'Crear contenidor al NAS',
    ]);
  });
});

describe('escriure blocs a mà', () => {
  it("una entrada manual s'apunta i queda a l'historial", async () => {
    const taskId = await feina('Reunió', '2026-07-20T09:00:00.000Z', '2026-07-20T09:41:00.000Z', {
      project: projectId,
    });

    const files = await sql<{ verb: string }>`
      SELECT verb FROM activity_log WHERE entity_id = ${taskId} AND verb = 'logged'
    `.execute(conn.db);
    expect(files.rows).toHaveLength(1);
  });

  it("arrossegar un bloc el mou i s'ajusta a 5 minuts", async () => {
    /**
     * **L'ajust és el que fa que dos blocs seguits encaixin.** Arrossegar amb el ratolí no té
     * precisió de segons: sense això, les vores quedarien a les 9:03:47 i el cronograma seria
     * una escala.
     */
    const res = await api('GET', '/api/v1/sessions?from=2026-07-20&to=2026-07-20');
    const bloc = res.json<Report>().data[0];

    const mogut = await api('PATCH', `/api/v1/sessions/${bloc?.id ?? ''}`, {
      started_at: '2026-07-20T10:02:00.000Z',
      ended_at: '2026-07-20T10:43:00.000Z',
    });
    expect(mogut.statusCode, mogut.body).toBe(200);

    const desat = mogut.json<{ started_at: string; ended_at: string }>();
    expect(desat.started_at).toBe('2026-07-20T10:00:00.000Z');
    expect(desat.ended_at).toBe('2026-07-20T10:45:00.000Z');
  });

  it('un bloc que acabaria abans de començar es rebutja', async () => {
    const res = await api('GET', '/api/v1/sessions?from=2026-07-20&to=2026-07-20');
    const bloc = res.json<Report>().data[0];

    const mal = await api('PATCH', `/api/v1/sessions/${bloc?.id ?? ''}`, {
      ended_at: '2026-07-20T08:00:00.000Z',
    });
    expect(mal.statusCode).toBe(422);
  });

  it("un bloc s'esborra en suau", async () => {
    const res = await api('GET', '/api/v1/sessions?from=2026-07-20&to=2026-07-20');
    const bloc = res.json<Report>().data[0];

    const fora = await api('DELETE', `/api/v1/sessions/${bloc?.id ?? ''}`);
    expect(fora.statusCode).toBe(204);

    // Ja no surt, però la fila hi és amb la seva tombstone: ha de poder viatjar al sync.
    const despres = await api('GET', '/api/v1/sessions?from=2026-07-20&to=2026-07-20');
    expect(despres.json<Report>().data).toHaveLength(0);

    const fila = await sql<{ deleted_at: string | null }>`
      SELECT deleted_at FROM task_sessions WHERE id = ${bloc?.id ?? ''}
    `.execute(conn.db);
    expect(fila.rows[0]?.deleted_at).not.toBeNull();
  });
});

describe('la dedicació de la gent no la veu qui no hi mana', () => {
  it('un col·laborador només veu els seus blocs', async () => {
    await feina('Cosa de la Marta', '2026-07-23T08:00:00.000Z', '2026-07-23T09:00:00.000Z', {
      user: martaId,
    });

    const seus = await api(
      'GET',
      '/api/v1/sessions?from=2026-07-01&to=2026-07-31',
      undefined,
      comMarta,
    );
    const titols = seus.json<Report>().data.map((entry) => entry.task_title);
    expect(titols).toEqual(['Cosa de la Marta']);
  });

  it('i el propietari els veu tots, amb el nom de qui els va fer', async () => {
    const tots = await api('GET', '/api/v1/sessions?from=2026-07-01&to=2026-07-31');
    const report = tots.json<Report>();

    expect(report.data.length).toBeGreaterThan(1);
    expect(report.totals.by_user.map((b) => b.key).sort()).toEqual([borjaId, martaId].sort());
  });
});

describe('el CSV', () => {
  it('porta el BOM, les columnes de sempre i el que hi ha filtrat', async () => {
    const res = await api('GET', '/api/v1/sessions/export.csv?from=2026-07-21&to=2026-07-21');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    // Els tres bytes del principi: sense ells l'Excel es menja els accents.
    expect(res.body.startsWith('﻿')).toBe(true);

    const linies = res.body.slice(1).split('\r\n');
    expect(linies[0]).toBe('Data,Hora,Projecte,Tasca,Tipologia,Persona,Minuts');
    // La data i l'hora, en local: 9:00 a Madrid, no les 7:00 d'UTC.
    expect(linies[1]).toBe('2026-07-21,09:00,,Crear contenidor al NAS,,Borja,50');
  });
});
