import {
  POMODORO_DEFAULTS,
  type PomodoroCommand,
  type PomodoroSnapshot,
  type PomodoroTimer,
} from '@fem-ho/contracts';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { generateApiToken } from '../auth/tokens.js';
import { loadConfig } from '../config.js';
import { dbBool } from '../db/bool.js';
import { connect, type Connection } from '../db/connection.js';
import { MIGRATIONS, migrateDown, migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';

const owner = uuidv7();
const member = uuidv7();
const personal = uuidv7();
const shared = uuidv7();
const pass = 'contrasenya-de-prova';
const credential = generateApiToken();
const now = new Date().toISOString();
const path = '/api/v1/pomodoro';
const batch = '/api/v1/sync/batch';

let app: ReturnType<typeof buildApp>;
let db: Connection;
let teardown: () => Promise<void>;
let web: { authorization: string };
let phone: { authorization: string; 'user-agent': string };
let other: { authorization: string };

async function login(email: string) {
  const reply = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: pass },
  });
  expect(reply.statusCode, reply.body).toBe(200);
  return { authorization: 'Bearer ' + reply.json<{ access_token: string }>().access_token };
}

beforeAll(async () => {
  const pg = postgresUrl();
  if (pg === undefined) {
    db = connect('sqlite::memory:');
    teardown = db.close;
  } else {
    const schema = await connectTestSchema(pg, 'pomodoro');
    db = schema;
    teardown = schema.drop;
  }

  await migrateToLatest(db.db, { engine: db.engine });
  const pomodoro = MIGRATIONS.findIndex((migration) => migration.name === '029-pomodoro');
  expect(pomodoro).toBeGreaterThanOrEqual(0);
  for (const migration of MIGRATIONS.slice(pomodoro).reverse()) {
    expect(await migrateDown(db.db, db.engine)).toBe(migration.name);
  }
  const password = await hashPassword(pass);
  await sql`INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${owner}, 'pomodoro-owner@example.com', 'Owner', ${password}, 'human', 'admin', ${now}, ${now}),
      (${member}, 'pomodoro-member@example.com', 'Member', ${password}, 'human', 'member', ${now}, ${now})`.execute(
    db.db,
  );
  await sql`INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${personal}, 'Personal', 'individual', '--plou-blue', ${owner}, 'a0', ${now}, ${now}),
      (${shared}, 'Compartit', 'collective', '--plou-blue', ${owner}, 'a1', ${now}, ${now})`.execute(
    db.db,
  );
  await sql`INSERT INTO user_settings (user_id, inbox_position, updated_at)
    VALUES (${owner}, 'right', ${now})`.execute(db.db);
  await sql`INSERT INTO scope_settings (scope_id, time_tracking, created_at, updated_at)
    VALUES (${personal}, ${dbBool(true)}, ${now}, ${now})`.execute(db.db);
  await sql`INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, scope_ids, created_at)
    VALUES (${uuidv7()}, ${owner}, 'Connector', ${credential.prefix}, ${credential.hash},
      '["tasks:read","tasks:write","tasks:move","scopes:read"]', ${JSON.stringify([personal])}, ${now})`.execute(
    db.db,
  );
  await sql`INSERT INTO external_access (user_id,api_enabled,mcp_enabled) VALUES (${owner},1,0)`.execute(
    db.db,
  );
  await migrateToLatest(db.db, { engine: db.engine });

  app = buildApp(
    { ...loadConfig('test'), logLevel: 'silent' },
    {
      connection: db,
      secret: 'secret-instance-for-pomodoro-tests',
    },
  );
  web = await login('pomodoro-owner@example.com');
  phone = { ...(await login('pomodoro-owner@example.com')), 'user-agent': 'okhttp' };
  other = await login('pomodoro-member@example.com');
});

beforeEach(async () => {
  await sql`DELETE FROM pomodoro_states`.execute(db.db);
  await sql`DELETE FROM activity_log WHERE entity_type = 'pomodoro'`.execute(db.db);
  await sql`DELETE FROM scope_members WHERE user_id = ${member}`.execute(db.db);
});

afterAll(async () => {
  await app?.close();
  await teardown?.();
});

async function addTask(status = 'todo', scope = personal): Promise<string> {
  const id = uuidv7();
  await sql`INSERT INTO tasks (id, scope_id, title, status, position, created_by, created_at, updated_at)
    VALUES (${id}, ${scope}, 'Tasca de prova privada', ${status}, 'a0', ${owner}, ${now}, ${now})`.execute(
    db.db,
  );
  return id;
}

async function snapshot(headers = web): Promise<PomodoroSnapshot> {
  const reply = await app.inject({ method: 'GET', url: path, headers });
  expect(reply.statusCode, reply.body).toBe(200);
  expect(reply.headers['cache-control']).toBe('no-store');
  return reply.json<PomodoroSnapshot>();
}

async function send(
  data: PomodoroCommand | Record<string, unknown>,
  { headers = web, id = owner, opId = uuidv7() } = {},
) {
  const reply = await app.inject({
    method: 'POST',
    url: batch,
    headers,
    payload: { operations: [{ op_id: opId, entity: 'pomodoro', op: 'update', id, data }] },
  });
  expect(reply.statusCode, reply.body).toBe(200);
  return reply.json<{
    results: {
      status: 'ok' | 'conflict' | 'rejected';
      entity?: PomodoroSnapshot;
      server_entity?: PomodoroSnapshot;
      error?: { status: number; detail: string };
    }[];
  }>().results[0]!;
}

const enable: PomodoroCommand = { kind: 'settings', patch: { enabled: true } };
function start(taskId: string | null, at = Date.now()): PomodoroCommand {
  return { kind: 'start', timer_id: uuidv7(), device_id: 'device-1', task_id: taskId, at_ms: at };
}

describe('Pomodoro personal', () => {
  it('migra sense tocar preferències prèvies i comparteix només els ajustos del compte', async () => {
    expect(await snapshot()).toMatchObject({
      settings: POMODORO_DEFAULTS,
      queue: [],
      queue_version: 0,
      timer: null,
    });
    expect((await sql`SELECT state FROM pomodoro_states`.execute(db.db)).rows).toHaveLength(0);
    const previous =
      await sql`SELECT inbox_position FROM user_settings WHERE user_id = ${owner}`.execute(db.db);
    expect(previous.rows).toEqual([{ inbox_position: 'right' }]);

    expect(
      await send({
        kind: 'settings',
        patch: { enabled: true, mode: 'serious', focus_minutes: 43 },
      }),
    ).toMatchObject({ status: 'ok' });
    expect((await snapshot(phone)).settings).toEqual({
      ...POMODORO_DEFAULTS,
      enabled: true,
      mode: 'serious',
      focus_minutes: 43,
    });
    expect((await snapshot(other)).settings).toEqual(POMODORO_DEFAULTS);
    expect((await send(enable, { headers: other })).status).toBe('rejected');
    const external = { authorization: 'Bearer ' + credential.token };
    const pat = await app.inject({
      method: 'GET',
      url: path,
      headers: external,
    });
    expect(pat.statusCode).toBe(403);
    expect(await send(enable, { headers: external })).toMatchObject({
      status: 'rejected',
      error: { status: 403 },
    });
    expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
  });

  it('valida la cua, la configura en ordre i rebutja edicions sobre una versió antiga', async () => {
    const first = await addTask();
    const second = await addTask();
    const doing = await addTask('doing');
    expect(await send({ kind: 'settings', patch: { focus_minutes: 0 } })).toMatchObject({
      status: 'rejected',
      error: { status: 422 },
    });
    expect(
      await send({ kind: 'queue', expected_version: 0, task_ids: [first, first] }),
    ).toMatchObject({ status: 'rejected' });
    expect(await send({ kind: 'queue', expected_version: 0, task_ids: [doing] })).toMatchObject({
      status: 'rejected',
    });
    expect(
      await send({ kind: 'queue', expected_version: 0, task_ids: [second, first] }),
    ).toMatchObject({ status: 'ok' });
    expect(await send({ kind: 'queue', expected_version: 0, task_ids: [] })).toMatchObject({
      status: 'conflict',
      server_entity: { queue: [second, first], queue_version: 1 },
    });
    await sql`UPDATE tasks SET status='doing' WHERE id=${second}`.execute(db.db);
    expect(
      await send({ kind: 'queue', expected_version: 1, task_ids: [first, second] }),
    ).toMatchObject({
      status: 'ok',
      entity: { queue: [first, second], queue_version: 2 },
    });
    await sql`UPDATE tasks SET deleted_at=${now} WHERE id=${first}`.execute(db.db);
    expect((await snapshot()).queue).toEqual([second]);
  });

  it('mou la tasca una sola vegada amb el servei del tauler i l’instant del gest fora de línia', async () => {
    expect((await send(enable)).status).toBe('ok');
    const id = await addTask();
    const at = Date.now() - 60_000;
    const opId = uuidv7();
    const command = start(id, at);
    const result = await send(command, { headers: phone, opId });
    expect(result).toMatchObject({
      status: 'ok',
      entity: {
        timer: { version: 1, status: 'running', task_id: id, end_at_ms: at + 25 * 60_000 },
        moved_task: { id, status: 'doing' },
      },
    });
    expect(await send(command, { opId })).toMatchObject({
      status: 'ok',
      entity: { timer: { task_id: id } },
    });
    const work = await sql<{
      started_at: string;
    }>`SELECT started_at FROM task_sessions WHERE task_id=${id}`.execute(db.db);
    expect(work.rows).toHaveLength(1);
    expect(Date.parse(work.rows[0]!.started_at)).toBe(at);
    const audit = await sql`
      SELECT entity_type, scope_id, source, verb FROM activity_log
      WHERE actor_user_id=${owner} AND (entity_type='pomodoro' OR entity_id=${id}) AND source='android'
    `.execute(db.db);
    expect(audit.rows).toEqual(
      expect.arrayContaining([
        { entity_type: 'pomodoro', scope_id: null, source: 'android', verb: 'updated' },
        { entity_type: 'task', scope_id: personal, source: 'android', verb: 'moved' },
      ]),
    );
    expect(
      audit.rows.filter((entry) => (entry as { entity_type: string }).entity_type === 'task'),
    ).toHaveLength(1);

    const delta = await app.inject({ method: 'GET', url: '/api/v1/sync', headers: web });
    expect(delta.statusCode).toBe(200);
    expect(delta.json().changes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ entity: 'pomodoro' })]),
    );
  });

  it('resol inicis simultanis i no aplica cap gest d’una fase o versió superada', async () => {
    expect((await send(enable)).status).toBe('ok');
    const tasks = [await addTask(), await addTask()];
    const results = await Promise.all([
      send(start(tasks[0]!)),
      send(start(tasks[1]!), { headers: phone }),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual(['conflict', 'ok']);
    const winner = results.find((item) => item.status === 'ok')!.entity!.timer!;
    const losingTask = tasks.find((task) => task !== winner.task_id)!;
    expect(
      (await sql`SELECT status FROM tasks WHERE id=${losingTask}`.execute(db.db)).rows,
    ).toEqual([{ status: 'todo' }]);
    const pause = {
      kind: 'control',
      action: 'pause',
      timer_id: winner.id,
      expected_version: winner.version,
      phase_number: winner.phase_number,
      at_ms: Date.now(),
      device_id: 'device-2',
    } as const;
    expect(await send({ ...pause, phase_number: pause.phase_number + 1 })).toMatchObject({
      status: 'conflict',
      server_entity: { timer: { id: winner.id } },
    });
    expect(await send(pause, { headers: phone })).toMatchObject({
      status: 'ok',
      entity: { timer: { status: 'paused', version: 2 } },
    });
    expect(await send(pause)).toMatchObject({
      status: 'conflict',
      server_entity: { timer: { version: 2 } },
    });
    expect(await send({ kind: 'settings', patch: { enabled: false } })).toMatchObject({
      status: 'ok',
      entity: { timer: null },
    });
    expect(await send(start(null, Date.now() + 600_000))).toMatchObject({
      status: 'rejected',
      error: { status: 422 },
    });
  });

  it('pot vincular i moure una tasca nova quan comença la fase següent de concentració', async () => {
    expect((await send(enable)).status).toBe('ok');
    const task = await addTask();
    const running = (await send(start(null))).entity!.timer!;
    const control = (
      timer: PomodoroTimer,
      action: 'skip' | 'resume',
    ): Extract<PomodoroCommand, { kind: 'control' }> => ({
      kind: 'control',
      action,
      timer_id: timer.id,
      expected_version: timer.version,
      phase_number: timer.phase_number,
      at_ms: Date.now(),
      device_id: 'device-2',
    });

    const breakReady = (await send(control(running, 'skip'))).entity!.timer!;
    expect(breakReady).toMatchObject({ status: 'ready', phase: 'short_break' });
    const startBreak = await send({ ...control(breakReady, 'resume'), task_id: task });
    expect(startBreak).toMatchObject({
      status: 'conflict',
      server_entity: { timer: { task_id: null } },
    });
    const focusReady = (await send(control(breakReady, 'skip'))).entity!.timer!;
    expect(focusReady).toMatchObject({ status: 'ready', phase: 'focus' });
    expect(
      await send({ ...control(focusReady, 'resume'), task_id: task, position: 'a2' }),
    ).toMatchObject({
      status: 'ok',
      entity: {
        timer: { status: 'running', task_id: task },
        moved_task: { id: task, status: 'doing', position: 'a2' },
      },
    });
  });

  it('aplica els permisos en moure i elimina les referències revocades també dels rebuts', async () => {
    const task = await addTask('todo', shared);
    await sql`INSERT INTO scope_members (id,scope_id,user_id,role,created_at)
      VALUES (${uuidv7()}, ${shared}, ${member}, 'viewer', ${now})`.execute(db.db);
    const options = { headers: other, id: member };
    expect((await send(enable, options)).status).toBe('ok');
    expect(
      (await send({ kind: 'queue', expected_version: 0, task_ids: [task] }, options)).status,
    ).toBe('ok');
    expect(await send(start(task), options)).toMatchObject({
      status: 'rejected',
      error: { status: 403 },
    });
    expect((await snapshot(other)).timer).toBeNull();
    expect((await sql`SELECT status FROM tasks WHERE id=${task}`.execute(db.db)).rows).toEqual([
      { status: 'todo' },
    ]);

    await sql`UPDATE scope_members SET role='collaborator' WHERE user_id=${member} AND scope_id=${shared}`.execute(
      db.db,
    );
    const command = start(task);
    const opId = uuidv7();
    expect(await send(command, { ...options, opId })).toMatchObject({
      status: 'ok',
      entity: { moved_task: { id: task } },
    });
    await sql`DELETE FROM scope_members WHERE user_id=${member} AND scope_id=${shared}`.execute(
      db.db,
    );
    expect(await snapshot(other)).toMatchObject({ queue: [], timer: { task_id: null } });
    const replay = await send(command, { ...options, opId });
    expect(replay).toMatchObject({ status: 'ok', entity: { queue: [], timer: { task_id: null } } });
    expect(JSON.stringify(replay)).not.toContain(task);
    expect(JSON.stringify(replay)).not.toContain('Tasca de prova privada');
  });
});
