/**
 * Entrades hostils contra totes les rutes.
 *
 * No comprova que la resposta sigui una de concreta —cada cas en té una de sensata
 * diferent— sinó que **cap doni un 500**. Un 500 vol dir que una excepció ha arribat
 * fins a dalt sense que ningú l'esperés, i això és sempre un error, digui el que digui
 * la documentació de la ruta.
 *
 * Escrita per anar a buscar aquesta classe d'error i en va trobar tres a la primera
 * passada:
 *
 *   - `?limit=abc` → `Number('abc')` és `NaN`, i `Math.min(Math.max(NaN, 1), 200)` el
 *     deixa passar intacte perquè totes dues comparacions són falses. El `NaN` arribava
 *     al `LIMIT` de SQL i el motor responia `SQLITE_MISMATCH`.
 *   - El mateix a `/sync`.
 *   - Un `null` dins de les operacions d'un lot de sincronització tombava el lot sencer
 *     amb un TypeError, quan docs/06 §4 diu que cada operació es resol per separat.
 *
 * Afegir-hi un cas quan es trobi un forat nou val més que escriure una prova per a cada
 * ruta: el que es vigila aquí és una propietat de tota la superfície, no d'una ruta.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-probe-'));
const NOW = '2026-08-06T09:00:00.000Z';

let conn: Connection;
let app: FastifyInstance;
let auth: Record<string, string>;
let scopeId: string;

beforeAll(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];

  conn = connect(`sqlite://${join(tmp, 't.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const uid = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${uid}, 'b@e.com', 'B', ${await hashPassword('la-contrasenya-de-prova')},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${uid}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp },
    { connection: conn, secret: 'x'.repeat(40) },
  );

  const l = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'b@e.com', password: 'la-contrasenya-de-prova' },
  });
  auth = { authorization: `Bearer ${l.json<{ access_token: string }>().access_token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

const SCOPE = '§SCOPE§';

const CASOS: [string, 'GET' | 'POST', string, unknown][] = [
  ['títol de 10 MB', 'POST', '/api/v1/tasks', { scope_id: SCOPE, title: 'x'.repeat(10_000_000) }],
  ['scope_id que és un objecte', 'POST', '/api/v1/tasks', { scope_id: { $ne: null }, title: 'X' }],
  ['scope_id array', 'POST', '/api/v1/tasks', { scope_id: ['a', 'b'], title: 'X' }],
  ['title null', 'POST', '/api/v1/tasks', { scope_id: SCOPE, title: null }],
  ['title numèric', 'POST', '/api/v1/tasks', { scope_id: SCOPE, title: 42 }],
  ['cos que és un array', 'POST', '/api/v1/tasks', [1, 2, 3]],
  ['limit negatiu', 'GET', '/api/v1/tasks?limit=-5', undefined],
  ['limit enorme', 'GET', '/api/v1/tasks?limit=999999999', undefined],
  ['limit NaN', 'GET', '/api/v1/tasks?limit=abc', undefined],
  ['cursor amb SQL', 'GET', "/api/v1/tasks?cursor=' OR 1=1--", undefined],
  ['id amb travessia', 'GET', '/api/v1/tasks/..%2F..%2Fetc%2Fpasswd', undefined],
  ['id de 100k', 'GET', `/api/v1/tasks/${'a'.repeat(100_000)}`, undefined],
  [
    'due_date absurda',
    'POST',
    '/api/v1/tasks',
    { scope_id: SCOPE, title: 'X', due_date: '9999999-99-99' },
  ],
  ['position buida', 'POST', '/api/v1/tasks', { scope_id: SCOPE, title: 'X', position: '' }],
  ['sync limit negatiu', 'GET', '/api/v1/sync?limit=-1', undefined],
  ['sync limit NaN', 'GET', '/api/v1/sync?limit=abc', undefined],
  ['activity amb id enorme', 'GET', `/api/v1/tasks/${'9'.repeat(500)}/activity`, undefined],
  [
    "token amb nom d'1 MB",
    'POST',
    '/api/v1/tokens',
    { name: 'x'.repeat(1_000_000), capabilities: ['tasks:read'] },
  ],
  ['capabilities no array', 'POST', '/api/v1/tokens', { name: 'X', capabilities: 'tasks:read' }],
  ['capabilities amb objectes', 'POST', '/api/v1/tokens', { name: 'X', capabilities: [{}, []] }],
  ['share sense res', 'POST', '/api/v1/shares', {}],
  ['share amb max_views negatiu', 'POST', '/api/v1/shares', { task_id: 'x', max_views: -1 }],
  ['ai-mode amb objecte', 'POST', '/api/v1/tasks/x/ai-mode', { ai_mode: {} }],
  ['events sense finestra', 'GET', '/api/v1/events', undefined],
  ['events amb from invàlid', 'GET', '/api/v1/events?from=NOPE&to=NOPE', undefined],
  ['events amb rang invertit', 'GET', '/api/v1/events?from=2027-01-01&to=2020-01-01', undefined],
  ['board sense res', 'GET', '/api/v1/board', undefined],
  [
    'sync batch amb operacions rares',
    'POST',
    '/api/v1/sync/batch',
    { operations: [null, 1, 'x', {}] },
  ],
  ['sync batch no array', 'POST', '/api/v1/sync/batch', { operations: 'moltes' }],
  ['push sense res', 'POST', '/api/v1/push/subscriptions', {}],
  [
    'push amb endpoint numèric',
    'POST',
    '/api/v1/push/subscriptions',
    { endpoint: 1, p256dh: 'a', auth: 'b' },
  ],
  ['checklist item amb done no booleà', 'POST', '/api/v1/checklist-items/x', { done: 'sí' }],
];

it('cap entrada hostil dona un 500', async () => {
  const problemes: string[] = [];

  for (const [nom, method, url, payload] of CASOS) {
    const cos =
      payload === undefined
        ? undefined
        : (JSON.parse(JSON.stringify(payload).replaceAll(SCOPE, scopeId)) as unknown);

    let res: Awaited<ReturnType<typeof app.inject>>;
    try {
      res =
        cos === undefined
          ? await app.inject({ method, url, headers: auth })
          : await app.inject({
              method,
              url,
              headers: { ...auth, 'content-type': 'application/json' },
              payload: cos as Record<string, unknown>,
            });
    } catch (error) {
      problemes.push(`${nom} → EXCEPCIÓ ${String(error).slice(0, 100)}`);
      continue;
    }

    if (res.statusCode >= 500) {
      problemes.push(`${nom} → ${String(res.statusCode)} ${res.body.slice(0, 140)}`);
    }
  }

  expect(problemes).toEqual([]);
});
