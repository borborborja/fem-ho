import type { components } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { dbBool } from '../db/bool.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';
import { tick } from '../jobs/scheduler.js';
import type { Principal } from '../policy/principal.js';
import { undo } from '../services/activity.js';
import { claim } from '../services/leases.js';
import { encodeCursor } from '../services/sync.js';
import { createTask, moveTask } from '../services/tasks.js';

const start = Date.now() - 5 * 3_600_000;
const at = (minutes: number, milliseconds = 0) =>
  new Date(start + minutes * 60_000 + milliseconds).toISOString();
const startedAt = at(0);
const syncedAt = at(40);
const almostDue = at(240, -1);
const due = at(240);
const lateTick = at(240, 24_000);
const secret = 'secret-instance-for-doing-auto-stop-tests';
const password = 'contrasenya-de-prova';
const personal = uuidv7();
const shared = uuidv7();
const agentId = uuidv7();
const owner: Principal = {
  userId: uuidv7(),
  kind: 'user',
  capabilities: new Set(['tasks:write']),
  scopeIds: null,
  source: 'web',
};
const other: Principal = { ...owner, userId: uuidv7(), source: 'android' };
const agent: Principal = { ...owner, kind: 'agent', agentId, source: 'mcp' };

let connection: Connection;
let cleanup: () => Promise<void>;
let app: ReturnType<typeof buildApp>;
let ownerHeaders: { authorization: string };
let otherHeaders: { authorization: string };

async function login(email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(response.statusCode, response.body).toBe(200);
  return { authorization: `Bearer ${response.json<{ access_token: string }>().access_token}` };
}

beforeAll(async () => {
  const pg = postgresUrl();
  if (pg === undefined) {
    connection = connect('sqlite::memory:');
    cleanup = connection.close;
  } else {
    const schema = await connectTestSchema(pg, 'doing_auto_stop');
    connection = schema;
    cleanup = schema.drop;
  }
  const { db, engine } = connection;
  await migrateToLatest(db, { engine });
  const hash = await hashPassword(password);
  await sql`
    INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
    VALUES (${owner.userId}, 'auto-stop-owner@example.com', 'Owner', ${hash}, ${startedAt}, ${startedAt}),
      (${other.userId}, 'auto-stop-member@example.com', 'Member', ${hash}, ${startedAt}, ${startedAt})
  `.execute(db);
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${personal}, 'Personal', 'individual', '--plou-blue', ${owner.userId}, 'a0', ${startedAt}, ${startedAt}),
      (${shared}, 'Compartit', 'collective', '--plou-blue', ${owner.userId}, 'a1', ${startedAt}, ${startedAt})
  `.execute(db);
  await sql`
    INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
    VALUES (${uuidv7()}, ${shared}, ${other.userId}, 'collaborator', ${startedAt})
  `.execute(db);
  await sql`
    INSERT INTO scope_settings (scope_id, time_tracking, created_at, updated_at)
    VALUES (${personal}, ${dbBool(true)}, ${startedAt}, ${startedAt})
  `.execute(db);
  await sql`
    INSERT INTO ai_agents (id, name, on_behalf_of_user_id, actor_user_id, can_create_tasks,
                           created_at, updated_at)
    VALUES (${agentId}, 'Agent', ${owner.userId}, ${owner.userId}, ${dbBool(true)}, ${startedAt}, ${startedAt})
  `.execute(db);
  app = buildApp({ ...loadConfig('test'), logLevel: 'silent' }, { connection, secret });
  ownerHeaders = await login('auto-stop-owner@example.com');
  otherHeaders = await login('auto-stop-member@example.com');
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

async function configure(
  data: unknown,
  opId = uuidv7(),
  userId = owner.userId,
  headers = ownerHeaders,
) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/batch',
    headers,
    payload: {
      operations: [{ op_id: opId, entity: 'user_settings', op: 'update', id: userId, data }],
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<components['schemas']['SyncBatchResults']>().results[0]!;
}

async function settings(headers = ownerHeaders) {
  const response = await app.inject({ url: '/api/v1/auth/settings', headers });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<components['schemas']['SettingsBundle']>().settings;
}

it('valida i desa la preferència pròpia, i el reintent confirma el valor actual', async () => {
  expect((await settings()).doing_auto_stop_minutes).toBeNull();
  for (const invalid of [0, 10081, 1.5, '240', undefined]) {
    const result = await configure({ doing_auto_stop_minutes: invalid });
    expect(result).toMatchObject({ status: 'rejected', error: { status: 422 } });
  }
  expect(
    await configure({ doing_auto_stop_minutes: 240 }, uuidv7(), owner.userId, otherHeaders),
  ).toMatchObject({ status: 'rejected' });

  const previous = uuidv7();
  expect(await configure({ doing_auto_stop_minutes: 240 }, previous)).toMatchObject({
    status: 'ok',
    entity: { doing_auto_stop_minutes: 240 },
  });
  expect((await settings()).doing_auto_stop_minutes).toBe(240);
  expect((await settings(otherHeaders)).doing_auto_stop_minutes).toBeNull();
  expect(await configure({ doing_auto_stop_minutes: null })).toMatchObject({
    status: 'ok',
    entity: { doing_auto_stop_minutes: null },
  });
  expect(await configure({ doing_auto_stop_minutes: 240 }, previous)).toMatchObject({
    status: 'ok',
    entity: { doing_auto_stop_minutes: null },
  });
  expect((await settings()).doing_auto_stop_minutes).toBeNull();
});

function schedule(now: string) {
  return tick({ connection, secret, baseUrl: undefined, now: () => now });
}

async function newTask(
  scopeId: string,
  principal = owner,
  status: 'todo' | 'doing' = 'doing',
  aiMode: 'manual' | 'delegated' = 'manual',
) {
  const { task } = await auditedTransaction(
    connection.db,
    principal,
    (ctx) =>
      createTask(
        ctx,
        principal,
        { scope_id: scopeId, title: 'Tasca de prova', status, ai_mode: aiMode },
        connection.engine,
        startedAt,
      ),
    { engine: connection.engine, now: syncedAt },
  );
  return task;
}

async function statusOf(id: string) {
  const row = await sql<{ status: string; position: string; due_date: string | null }>`
    SELECT status, position, due_date FROM tasks WHERE id = ${id}
  `.execute(connection.db);
  return row.rows[0]!;
}

it('el tic mou una estada vençuda una sola vegada, tanca el tram i publica el canvi', async () => {
  await configure({ doing_auto_stop_minutes: 240 });
  const resting = await newTask(personal, owner, 'todo');
  const tracked = await newTask(personal);
  const untracked = await newTask(shared);
  const restarted = await newTask(shared);
  const anotherAccount = await newTask(shared, other);
  await auditedTransaction(
    connection.db,
    owner,
    (ctx) => moveTask(ctx, owner, tracked.id, { status: 'doing', position: 'a2' }),
    { engine: connection.engine, now: almostDue },
  );
  for (const [status, now] of [
    ['todo', at(41)],
    ['doing', at(42)],
  ] as const) {
    await auditedTransaction(
      connection.db,
      owner,
      (ctx) => moveTask(ctx, owner, restarted.id, { status }),
      { engine: connection.engine, now },
    );
  }
  const { rows } = await sql<{ seq: number }>`
    SELECT MAX(seq) AS seq FROM change_log
  `.execute(connection.db);
  const cursor = encodeCursor(rows[0]!.seq);

  expect((await schedule(almostDue)).errors).toBe(0);
  expect(await statusOf(tracked.id)).toMatchObject({ status: 'doing' });
  expect(await statusOf(untracked.id)).toMatchObject({ status: 'doing' });

  const concurrent = await Promise.all([schedule(due), schedule(due)]);
  expect(concurrent.map((result) => result.errors)).toEqual([0, 0]);
  const moved = await statusOf(tracked.id);
  expect(moved).toMatchObject({ status: 'todo', due_date: tracked.due_date });
  expect(moved.position > resting.position).toBe(true);
  expect(await statusOf(untracked.id)).toMatchObject({ status: 'todo' });
  expect(await statusOf(restarted.id)).toMatchObject({ status: 'doing' });
  expect(await statusOf(anotherAccount.id)).toMatchObject({ status: 'doing' });

  const work = await sql<{ started_at: string; ended_at: string }>`
    SELECT started_at, ended_at FROM task_sessions WHERE task_id = ${tracked.id}
  `.execute(connection.db);
  expect(work.rows).toEqual([{ started_at: startedAt, ended_at: due }]);
  const audit = await sql<{
    actor_type: string;
    actor_user_id: string | null;
    source: string;
    changes: string;
  }>`
    SELECT actor_type, actor_user_id, source, changes FROM activity_log
    WHERE entity_id = ${tracked.id} AND source = 'system' AND verb = 'moved'
  `.execute(connection.db);
  expect(audit.rows).toHaveLength(1);
  expect(audit.rows[0]).toMatchObject({
    actor_type: 'system',
    actor_user_id: null,
    source: 'system',
  });
  expect(JSON.parse(audit.rows[0]!.changes)).toMatchObject({
    status: { from: 'doing', to: 'todo' },
    occurred_at: { to: due },
  });
  const sync = await app.inject({ url: `/api/v1/sync?cursor=${cursor}`, headers: ownerHeaders });
  expect(sync.statusCode, sync.body).toBe(200);
  expect(sync.json<components['schemas']['SyncResponse']>().changes).toContainEqual(
    expect.objectContaining({
      entity: 'task',
      id: tracked.id,
      data: expect.objectContaining({ status: 'todo' }),
    }),
  );
});

it('espera que caduqui la reserva i registra l’hora efectiva de l’aturada', async () => {
  await configure({ doing_auto_stop_minutes: 240 });
  const task = await newTask(personal, owner, 'todo', 'delegated');
  await auditedTransaction(
    connection.db,
    agent,
    async (ctx) => {
      await claim(ctx, agent, task.id);
      await moveTask(ctx, agent, task.id, { status: 'doing', occurred_at: startedAt });
    },
    { engine: connection.engine, now: at(210, 10_000) },
  );
  expect((await schedule(due)).errors).toBe(0);
  expect(await statusOf(task.id)).toMatchObject({ status: 'doing' });
  expect((await schedule(lateTick)).errors).toBe(0);
  expect(await statusOf(task.id)).toMatchObject({ status: 'todo' });
  const work = await sql<{ ended_at: string }>`
    SELECT ended_at FROM task_sessions WHERE task_id = ${task.id}
  `.execute(connection.db);
  expect(work.rows).toEqual([{ ended_at: lateTick }]);
});

it('desfer un moviment de l’agent obre una estada nova amb l’hora de desfer-lo', async () => {
  await configure({ doing_auto_stop_minutes: 240 });
  const task = await newTask(personal, owner, 'doing', 'delegated');
  await auditedTransaction(
    connection.db,
    agent,
    async (ctx) => {
      await claim(ctx, agent, task.id);
      await moveTask(ctx, agent, task.id, { status: 'todo' });
    },
    { engine: connection.engine, now: at(80) },
  );
  const moved = await sql<{ id: string }>`
    SELECT id FROM activity_log WHERE entity_id = ${task.id} AND source = 'mcp' AND verb = 'moved'
  `.execute(connection.db);
  await auditedTransaction(connection.db, owner, (ctx) => undo(ctx, owner, moved.rows[0]!.id), {
    engine: connection.engine,
    now: at(120),
  });
  expect((await schedule(due)).errors).toBe(0);
  expect(await statusOf(task.id)).toMatchObject({ status: 'doing' });
  expect((await schedule(at(360))).errors).toBe(0);
  expect(await statusOf(task.id)).toMatchObject({ status: 'todo' });
  const work = await sql<{ started_at: string; ended_at: string }>`
    SELECT started_at, ended_at FROM task_sessions WHERE task_id = ${task.id}
    ORDER BY started_at
  `.execute(connection.db);
  expect(work.rows).toEqual([
    { started_at: startedAt, ended_at: at(80) },
    { started_at: at(120), ended_at: at(360) },
  ]);
});
