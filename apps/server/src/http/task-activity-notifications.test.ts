import type { components } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { generateApiToken } from '../auth/tokens.js';
import { loadConfig } from '../config.js';
import { connect } from '../db/connection.js';
import { migrateDown, migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';
import { deliverTaskActivity } from '../jobs/task-activity-notifications.js';
import type { PushSender } from '../services/notifications.js';

type Kind = components['schemas']['TaskActivityKind'];
type Notice = components['schemas']['TaskActivityNotification'];
type Settings = components['schemas']['PushDeviceSettings'];

const now = () => new Date().toISOString();
const owner = uuidv7();
const member = uuidv7();
const work = uuidv7();
const personal = uuidv7();
const subscription = uuidv7();
const pass = 'contrasenya-de-prova';
const credential = generateApiToken();
const external = { authorization: 'Bearer ' + credential.token };
const base = '/api/v1/push/devices/';
let db: ReturnType<typeof connect>;
let app: ReturnType<typeof buildApp>;
let teardown: () => Promise<void>;
let session: { authorization: string };
let otherSession: { authorization: string };

async function login(email: string) {
  const reply = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: pass },
  });
  expect(reply.statusCode).toBe(200);
  return { authorization: 'Bearer ' + reply.json<{ access_token: string }>().access_token };
}

beforeAll(async () => {
  const pg = postgresUrl();
  if (pg === undefined) {
    db = connect('sqlite::memory:');
    teardown = db.close;
  } else {
    const schema = await connectTestSchema(pg, 'task_activity_notifications');
    db = schema;
    teardown = schema.drop;
  }
  await migrateToLatest(db.db, { engine: db.engine });
  expect(await migrateDown(db.db, db.engine)).toBe('028-task-activity-notifications');
  const password = await hashPassword(pass);
  await sql`INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${owner}, 'owner@example.com', 'Main', ${password}, 'human', 'admin', ${now()}, ${now()}),
           (${member}, 'viewer@example.com', 'Viewer', ${password}, 'human', 'member', ${now()}, ${now()})`.execute(
    db.db,
  );
  await sql`INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${work}, 'Feina', 'collective', '--plou-blue', ${owner}, 'a0', ${now()}, ${now()}),
           (${personal}, 'Personal', 'individual', '--plou-blue', ${owner}, 'a1', ${now()}, ${now()})`.execute(
    db.db,
  );
  await sql`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, platform, created_at)
    VALUES (${subscription}, ${owner}, 'https://push.example/legacy', 'old-key', 'old-auth', 'web', ${now()})`.execute(
    db.db,
  );
  await sql`INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, scope_ids, created_at)
    VALUES (${uuidv7()}, ${owner}, 'Connector real', ${credential.prefix}, ${credential.hash},
            '["tasks:read","tasks:write","scopes:read","checklists:write","comments:write"]',
            ${JSON.stringify([work, personal])}, ${now()})`.execute(db.db);
  await sql`INSERT INTO external_access (user_id, api_enabled, mcp_enabled) VALUES (${owner}, 1, 1)`.execute(
    db.db,
  );
  await migrateToLatest(db.db, { engine: db.engine });

  app = buildApp(
    { ...loadConfig('test'), logLevel: 'silent' },
    { connection: db, secret: 'secret-instance-for-notifications-http-test' },
  );
  session = await login('owner@example.com');
  otherSession = await login('viewer@example.com');
});

beforeEach(async () => {
  await sql`DELETE FROM notification_devices`.execute(db.db);
  await sql`DELETE FROM push_subscriptions WHERE id != ${subscription}`.execute(db.db);
  await sql`
    INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
    VALUES (${uuidv7()}, ${work}, ${member}, 'viewer', ${now()}) ON CONFLICT DO NOTHING
  `.execute(db.db);
});

afterAll(async () => {
  await app?.close();
  await teardown?.();
});

async function settings(id: string, headers = session) {
  const reply = await app.inject({ method: 'GET', url: base + id, headers });
  expect(reply.statusCode).toBe(200);
  expect(reply.headers['cache-control']).toBe('no-store');
  return reply.json<Settings>();
}

async function enable(id: string, headers = session, platform: 'android' | 'web' = 'android') {
  const reply = await app.inject({
    method: 'PUT',
    url: base + id,
    headers,
    payload: { platform, enabled: true },
  });
  expect(reply.statusCode, reply.body).toBe(200);
}

async function choose(
  id: string,
  flags: Partial<Record<Kind, boolean>>,
  headers = session,
  scope = work,
) {
  const reply = await app.inject({
    method: 'PATCH',
    url: base + id + '/scopes/' + scope,
    headers,
    payload: flags,
  });
  expect(reply.statusCode, reply.body).toBe(200);
}

async function pending(id: string, headers = session) {
  const reply = await app.inject({ method: 'GET', url: base + id + '/activity', headers });
  expect(reply.statusCode, reply.body).toBe(200);
  return reply.json<{ items: Notice[] }>().items;
}

async function ack(id: string, ids: string[], headers = session) {
  const reply = await app.inject({
    method: 'POST',
    url: base + id + '/activity/ack',
    headers,
    payload: { ids },
  });
  expect(reply.statusCode, reply.body).toBe(204);
}

async function create(headers = external, status = 'todo', scope = work) {
  const id = uuidv7();
  const reply = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks',
    headers,
    payload: { id, title: 'Tasca de notificacions', scope_id: scope, status },
  });
  expect(reply.statusCode, reply.body).toBe(201);
  return id;
}

async function rpc(name: string, args: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { ...external, accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  expect(response.statusCode, response.body).toBe(200);
  const line =
    response.body
      .split('\n')
      .find((value) => value.startsWith('data: '))
      ?.slice(6) ?? response.body;
  const result = (
    JSON.parse(line) as { result: { isError?: boolean; content: { text: string }[] } }
  ).result;
  expect(result.isError, result.content[0]?.text).not.toBe(true);
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

async function move(id: string, status: string) {
  const reply = await app.inject({
    method: 'POST',
    url: '/api/v1/tasks/' + id + '/move',
    headers: external,
    payload: { status },
  });
  expect(reply.statusCode, reply.body).toBe(200);
}

async function subscribeDevice(
  id: string,
  endpoint: string,
  platform: 'android' | 'web' = 'android',
) {
  const reply = await app.inject({
    method: 'POST',
    url: '/api/v1/push/subscriptions',
    headers: session,
    payload: { endpoint, p256dh: 'test-key', auth: 'test-auth', platform, device_id: id },
  });
  expect(reply.statusCode, reply.body).toBe(201);
}

describe('avisos d’activitat', () => {
  it('manté la subscripció anterior i la configuració privada i auditada', async () => {
    const device = uuidv7();
    expect(await settings(device)).toMatchObject({
      enabled: false,
      subscribed: false,
      scopes: expect.arrayContaining([
        expect.objectContaining({ scope_id: work, inbox_entry: false, task_created: false }),
      ]),
    });
    await enable(device);
    await choose(device, { inbox_entry: true });
    expect((await settings(device)).scopes.find((scope) => scope.scope_id === work)).toMatchObject({
      inbox_entry: true,
      task_created: false,
    });
    expect(await settings(device, otherSession)).toMatchObject({
      enabled: false,
      scopes: [expect.objectContaining({ inbox_entry: false, scope_id: work })],
    });
    const pat = await app.inject({ method: 'GET', url: base + device, headers: external });
    expect(pat.statusCode).toBe(403);
    const history = await sql<{ verb: string; scope_id: string | null }>`
      SELECT verb, scope_id FROM activity_log WHERE entity_type = 'notification_device' AND entity_id = ${device}
    `.execute(db.db);
    expect(history.rows).toEqual(
      expect.arrayContaining([
        { verb: 'created', scope_id: null },
        { verb: 'updated', scope_id: null },
      ]),
    );
    const legacy = await sql<{ activity_only: number }>`
      SELECT activity_only FROM push_subscriptions WHERE id = ${subscription}
    `.execute(db.db);
    expect(legacy.rows[0]?.activity_only).toBe(0);
  });

  it('aplica els quatre tipus per dispositiu amb escriptures REST i MCP', async () => {
    const phone = uuidv7();
    const tablet = uuidv7();
    await enable(phone);
    await enable(tablet);
    await choose(phone, { task_created: true, task_activity: true, status_changed: true });
    await choose(tablet, { inbox_entry: true, task_activity: true });

    const native = await create(session);
    const remote = await create();
    const inbox = uuidv7();
    await rpc('create_task', { id: inbox, scope_id: work, title: 'Captura externa' });
    await rpc('update_task', { task_id: inbox, title: 'Canvi dins Inbox' });
    await move(inbox, 'todo');
    await move(inbox, 'todo');
    const subtask = uuidv7();
    await rpc('create_subtask', { task_id: remote, id: subtask, title: 'Primera passa' });
    await rpc('update_subtask', { subtask_id: subtask, title: 'Passa completada', done: true });
    await move(remote, 'inbox');

    const typeAndTask = ({ kind, task_id }: Notice) => [kind, task_id];
    expect((await pending(phone)).map(typeAndTask)).toEqual([
      ['task_created', remote],
      ['status_changed', inbox],
      ['task_activity', remote],
      ['status_changed', remote],
    ]);
    const notices = await pending(tablet);
    expect(notices.map(typeAndTask)).toEqual([
      ['inbox_entry', inbox],
      ['task_activity', remote],
      ['task_activity', remote],
      ['inbox_entry', remote],
    ]);
    expect(notices.some((item) => item.task_id === native)).toBe(false);
    await ack(phone, [notices[0]!.id]);
    expect(await pending(tablet)).toEqual(notices);
    const ids = notices.map((item) => item.id);
    await ack(tablet, ids);
    await ack(tablet, ids);
    expect(await pending(tablet)).toEqual([]);
  });

  it('retira els avisos si canvia l’àmbit, es perd l’accés, es tanca la sessió o es desactiva el tipus', async () => {
    const phone = uuidv7();
    const guest = uuidv7();
    await enable(phone);
    await enable(guest, otherSession);
    await choose(phone, { task_created: true });
    await choose(guest, { task_created: true }, otherSession);
    const first = await create();
    expect(await pending(guest, otherSession)).toHaveLength(1);
    await sql`DELETE FROM scope_members WHERE scope_id = ${work} AND user_id = ${member}`.execute(
      db.db,
    );
    expect(await pending(guest, otherSession)).toEqual([]);
    // L'API no mou una tasca entre àmbits. Simulem el canvi a la base per provar el filtre de lliurament.
    await sql`UPDATE tasks SET scope_id = ${personal} WHERE id = ${first}`.execute(db.db);
    expect(await pending(phone)).toEqual([]);

    await create();
    await choose(phone, { task_created: false });
    await choose(phone, { task_created: true });
    expect(await pending(phone)).toEqual([]);

    const separate = await login('owner@example.com');
    const oldDevice = uuidv7();
    await enable(oldDevice, separate);
    await choose(oldDevice, { task_created: true }, separate);
    await create();
    expect(await pending(oldDevice, separate)).toHaveLength(1);
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: separate,
    });
    expect(logout.statusCode).toBe(204);
    expect(await pending(oldDevice)).toEqual([]);
    expect((await settings(oldDevice)).enabled).toBe(false);
  });

  it('reprèn un lliurament abandonat i reintenta amb el mateix identificador', async () => {
    const id = uuidv7();
    await enable(id);
    await subscribeDevice(id, 'https://push.example/android');
    await choose(id, { task_created: true });
    const task = await create();
    const item = (await pending(id))[0]!;
    const then = Date.now();
    const clock = (delta: number) => () => new Date(then + delta).toISOString();
    await sql`UPDATE task_activity_notifications SET claim_token = 'interrupted', claim_until = ${clock(60_000)()}
      WHERE id = ${item.id}`.execute(db.db);

    const sender = vi
      .fn<PushSender>()
      .mockResolvedValueOnce({ statusCode: 503 })
      .mockResolvedValueOnce({ statusCode: 201 });
    const subject = 'mailto:admin@example.com';
    await deliverTaskActivity(db, clock(1), subject, sender);
    expect(sender).not.toHaveBeenCalled();
    await Promise.all([
      deliverTaskActivity(db, clock(70_000), subject, sender),
      deliverTaskActivity(db, clock(70_000), subject, sender),
    ]);
    expect(sender).toHaveBeenCalledTimes(1);
    await deliverTaskActivity(db, clock(140_000), subject, sender);
    expect(sender).toHaveBeenCalledTimes(2);
    for (const call of sender.mock.calls) {
      expect(call[0].endpoint).toBe('https://push.example/android');
      expect(JSON.parse(call[1])).toMatchObject({ id: item.id, task_id: task });
      expect(call[2].topic).toBe(item.id.replaceAll('-', ''));
    }
    expect(await pending(id)).toHaveLength(1);
    await ack(id, [item.id]);
    expect(await pending(id)).toEqual([]);
  });

  it('dona de baixa un endpoint caducat i manté la consulta Android', async () => {
    const device = uuidv7();
    await enable(device);
    await subscribeDevice(device, 'https://push.example/expired');
    await choose(device, { task_created: true });
    await create();
    const sender = vi.fn<PushSender>().mockResolvedValue({ statusCode: 410 });
    await deliverTaskActivity(db, now, 'mailto:admin@example.com', sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(await settings(device)).toMatchObject({ enabled: true, subscribed: false });
    expect(await pending(device)).toHaveLength(1);
  });

  it('una resposta pendent no recupera els avisos d’un dispositiu desactivat', async () => {
    const device = uuidv7();
    await enable(device);
    await subscribeDevice(device, 'https://push.example/delayed');
    await choose(device, { task_created: true });
    await create();

    let finish!: (response: { statusCode: number }) => void;
    const response = new Promise<{ statusCode: number }>((resolve) => {
      finish = resolve;
    });
    const sender = vi.fn<PushSender>().mockReturnValue(response);
    const delivery = deliverTaskActivity(db, now, 'mailto:admin@example.com', sender);
    try {
      await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
      const disabled = await app.inject({
        method: 'PUT',
        url: base + device,
        headers: session,
        payload: { platform: 'android', enabled: false },
      });
      expect(disabled.statusCode, disabled.body).toBe(200);
    } finally {
      finish({ statusCode: 410 });
      await delivery;
    }
    await enable(device);
    expect(await settings(device)).toMatchObject({ enabled: true, subscribed: false });
    expect(await pending(device)).toEqual([]);
  });
});
