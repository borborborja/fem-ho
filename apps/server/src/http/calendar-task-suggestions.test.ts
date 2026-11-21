import type { components } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { dbBool } from '../db/bool.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, postgresUrl } from '../db/test-postgres.js';

type Snapshot = components['schemas']['CalendarSuggestionSnapshot'];
type Command = components['schemas']['CalendarSuggestionCommand'];

const owner = uuidv7();
const member = uuidv7();
const personal = uuidv7();
const shared = uuidv7();
const calendar = uuidv7();
const privateCalendar = uuidv7();
const sharedCalendar = uuidv7();
const start = '2026-06-15T08:00:00.000Z';
const during = '2026-06-15T08:10:00.000Z';
const end = '2026-06-15T08:30:00.000Z';
const seedAt = '2026-01-01T12:00:00.000Z';
const password = 'contrasenya-de-prova';
const route = '/api/v1/calendar-task-suggestions';

let db: Connection;
let cleanup: () => Promise<void>;
let app: ReturnType<typeof buildApp>;
let web: { authorization: string };
let android: { authorization: string; 'user-agent': string };
let other: { authorization: string };

async function login(email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode, res.body).toBe(200);
  return { authorization: `Bearer ${res.json<{ access_token: string }>().access_token}` };
}

beforeAll(async () => {
  const pg = postgresUrl();
  if (pg === undefined) {
    db = connect('sqlite::memory:');
    cleanup = db.close;
  } else {
    const test = await connectTestSchema(pg, 'calendar_task_suggestions');
    db = test;
    cleanup = test.drop;
  }
  await migrateToLatest(db.db, { engine: db.engine });
  const hash = await hashPassword(password);
  await sql`INSERT INTO users (id,email,name,password_hash,timezone,created_at,updated_at)
    VALUES (${owner},'calendar-owner@example.com','Owner',${hash},'Europe/Madrid',${seedAt},${seedAt}),
      (${member},'calendar-member@example.com','Member',${hash},'Europe/Madrid',${seedAt},${seedAt})`.execute(
    db.db,
  );
  await sql`INSERT INTO scopes (id,name,kind,color,owner_id,position,created_at,updated_at)
    VALUES (${personal},'Personal','individual','--plou-blue',${owner},'a0',${seedAt},${seedAt}),
      (${shared},'Compartit','collective','--plou-blue',${owner},'a1',${seedAt},${seedAt})`.execute(
    db.db,
  );
  await sql`INSERT INTO scope_members (id,scope_id,user_id,role,created_at)
    VALUES (${uuidv7()},${shared},${member},'collaborator',${seedAt})`.execute(db.db);
  await sql`INSERT INTO scope_settings (scope_id,time_tracking,created_at,updated_at)
    VALUES (${personal},${dbBool(true)},${seedAt},${seedAt})`.execute(db.db);
  await sql`INSERT INTO calendars (id,scope_id,name,kind,origin,shared_with_scope,created_at,updated_at)
    VALUES (${calendar},${personal},'Calendari','events','local',${dbBool(false)},${seedAt},${seedAt}),
      (${privateCalendar},${shared},'Privat','events','local',${dbBool(false)},${seedAt},${seedAt}),
      (${sharedCalendar},${shared},'Compartit','events','local',${dbBool(true)},${seedAt},${seedAt})`.execute(
    db.db,
  );
  app = buildApp(
    { ...loadConfig('test'), logLevel: 'silent' },
    {
      connection: db,
      secret: 'secret-instance-for-calendar-suggestion-tests',
    },
  );
  // Les sessions han d'existir abans del dia fictici de la cita.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(start));
  web = await login('calendar-owner@example.com');
  android = { ...(await login('calendar-owner@example.com')), 'user-agent': 'okhttp' };
  other = await login('calendar-member@example.com');
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(during));
  await sql`DELETE FROM calendar_suggestion_declines`.execute(db.db);
  await sql`DELETE FROM user_settings`.execute(db.db);
  await sql`DELETE FROM task_sessions`.execute(db.db);
  await sql`DELETE FROM task_assignees`.execute(db.db);
  await sql`DELETE FROM tasks`.execute(db.db);
  await sql`DELETE FROM events`.execute(db.db);
});

afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await app?.close();
  await cleanup?.();
});

async function snapshot(headers = web): Promise<Snapshot> {
  const res = await app.inject({ method: 'GET', url: route, headers });
  expect(res.statusCode, res.body).toBe(200);
  expect(res.headers['cache-control']).toBe('no-store');
  return res.json<Snapshot>();
}

async function send(
  data: Command,
  opts: { headers?: typeof web; opId?: string; userId?: string } = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/batch',
    headers: opts.headers ?? web,
    payload: {
      operations: [
        {
          entity: 'calendar_suggestions',
          id: opts.userId ?? owner,
          op_id: opts.opId ?? uuidv7(),
          op: 'update',
          data,
        },
      ],
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<{
    results: {
      status: string;
      entity?: components['schemas']['CalendarSuggestionResult'];
      error?: unknown;
    }[];
  }>().results[0]!;
}

async function seed(
  uid: string,
  calendarId = calendar,
  options: {
    starts?: string;
    ends?: string;
    allDay?: boolean;
    status?: string;
    rrule?: string;
  } = {},
) {
  await sql`INSERT INTO events (id,calendar_id,uid,summary,starts_at,ends_at,all_day,status,rrule,etag,created_at,updated_at)
    VALUES (${uuidv7()},${calendarId},${uid},${uid},${options.starts ?? start},${options.ends ?? end},
      ${dbBool(options.allDay ?? false)},${options.status ?? 'CONFIRMED'},${options.rrule ?? null},'etag',${seedAt},${seedAt})`.execute(
    db.db,
  );
}

const config = { type: 'configure', enabled: true } as const;

function begin(
  uid: string,
  mode: 'now' | 'planned',
  extras: Partial<Extract<Command, { type: 'start' }>> = {},
): Command {
  return {
    type: 'start',
    start: mode,
    occurrence: { calendar_id: calendar, uid, recurrence_id: null },
    starts_at: start,
    action_at: during,
    task_id: uuidv7(),
    position: 'a0',
    ...extras,
  };
}

describe('propostes personals del calendari', () => {
  it('comença desactivat i mostra el dia del perfil amb les cites de tot el dia i sense les cancel·lades', async () => {
    await seed('Reunió');
    await seed('Cancel·lada', calendar, { status: 'CANCELLED' });
    await seed('Tot el dia', calendar, {
      starts: '2026-06-15T00:00:00Z',
      ends: '2026-06-16T00:00:00Z',
      allDay: true,
    });
    expect(await snapshot()).toMatchObject({ enabled: false, items: [] });
    expect(await send(config)).toMatchObject({ status: 'ok' });
    const view = await snapshot(android);
    expect(view).toMatchObject({
      enabled: true,
      date: '2026-06-15',
      day_ends_at: '2026-06-15T22:00:00.000Z',
    });
    expect(view.items.map((item) => [item.title, item.all_day])).toEqual([
      ['Tot el dia', true],
      ['Reunió', false],
    ]);
    expect(await snapshot(other)).toMatchObject({ enabled: false, items: [] });
    expect(await send(config, { headers: other })).toMatchObject({ status: 'rejected' });
    const board = await app.inject({ method: 'GET', url: '/api/v1/board', headers: web });
    expect(
      board.json<{ columns: { groups: unknown[] }[] }>().columns.flatMap((col) => col.groups),
    ).toEqual([]);
  });

  it('compta des de l’hora escollida, conserva l’hora offline i retorna el mateix rebut en reintentar', async () => {
    await seed('Ara');
    await seed('Prevista');
    await send(config);
    vi.setSystemTime(new Date('2026-06-16T14:00:00Z'));
    const online = await login('calendar-owner@example.com');
    for (const [uid, mode, expected] of [
      ['Ara', 'now', during],
      ['Prevista', 'planned', start],
    ] as const) {
      const command = begin(uid, mode);
      const opId = uuidv7();
      const result = await send(command, {
        opId,
        headers: { ...online, 'user-agent': 'okhttp' } as typeof android,
      });
      expect(result).toMatchObject({
        status: 'ok',
        entity: { task: { status: 'doing', from_calendar: true } },
      });
      const task = result.entity!.task!;
      expect((await send(command, { opId, headers: online })).entity?.task?.id).toBe(task.id);
      const sessions = await sql<{
        started_at: string;
      }>`SELECT started_at FROM task_sessions WHERE task_id=${task.id}`.execute(db.db);
      expect(sessions.rows.map((row) => new Date(row.started_at).toISOString())).toEqual([
        expected,
      ]);
      const audit = await sql<{
        changes: string;
      }>`SELECT changes FROM activity_log WHERE entity_id=${task.id}`.execute(db.db);
      expect(JSON.parse(audit.rows[0]!.changes)).toMatchObject({ occurred_at: { to: expected } });
    }
  });

  it('reutilitza el contingut d’una tasca convertida i reconcilia dos inicis amb un sol tram', async () => {
    await seed('Convertida');
    await send(config);
    const id = uuidv7();
    const converted = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: web,
      payload: {
        id,
        scope_id: personal,
        title: 'Un altre títol',
        description: 'Notes',
        status: 'inbox',
        position: 'a0',
        source_event: { calendar_id: calendar, uid: 'Convertida' },
      },
    });
    expect(converted.statusCode, converted.body).toBe(201);
    expect((await snapshot()).items[0]).toMatchObject({ task_id: id });
    const results = await Promise.all([
      send(begin('Convertida', 'planned', { task_id: id })),
      send(begin('Convertida', 'now'), { headers: android }),
    ]);
    for (const result of results)
      expect(result).toMatchObject({
        status: 'ok',
        entity: { task: { id, status: 'doing', title: 'Un altre títol', description: 'Notes' } },
      });
    expect(
      (await sql`SELECT id FROM task_sessions WHERE task_id=${id}`.execute(db.db)).rows,
    ).toHaveLength(1);
    expect((await snapshot()).items).toEqual([]);
  });

  it('amaga la proposta quan s’inicia abans d’hora i crea una sola tasca amb dos identificadors de client', async () => {
    await seed('Abans');
    await send(config);
    const before = '2026-06-15T07:50:00.000Z';
    const actions = await Promise.all([
      send(begin('Abans', 'now', { action_at: before })),
      send(begin('Abans', 'now', { action_at: before }), { headers: android }),
    ]);
    expect(actions.map((result) => result.status)).toEqual(['ok', 'ok']);
    expect(actions[0]?.entity?.task?.id).toBe(actions[1]?.entity?.task?.id);
    expect((await snapshot()).items).toEqual([]);
    expect(
      (await sql`SELECT id FROM tasks WHERE event_uid='Abans'`.execute(db.db)).rows,
    ).toHaveLength(1);
  });

  it('desa el rebuig de manera privada i permet començar després', async () => {
    await seed('Compartida', sharedCalendar);
    await send(config);
    await send(config, { headers: other, userId: member });
    const occurrence = { calendar_id: sharedCalendar, uid: 'Compartida', recurrence_id: null };
    expect(
      await send({ type: 'decline', occurrence, starts_at: start, action_at: during }),
    ).toMatchObject({ status: 'ok' });
    expect((await snapshot(android)).items[0]?.declined).toBe(true);
    expect((await snapshot(other)).items[0]?.declined).toBe(false);
    expect(await send(begin('Compartida', 'planned', { occurrence }))).toMatchObject({
      status: 'rejected',
    });
    expect(await send(begin('Compartida', 'now', { occurrence }))).toMatchObject({ status: 'ok' });
  });

  it('demana confirmació per compartir el títol i oculta la referència privada al sync', async () => {
    await seed('Cita privada', privateCalendar);
    await send(config);
    await send(config, { headers: other, userId: member });
    expect((await snapshot()).items[0]?.requires_share_confirmation).toBe(true);
    expect((await snapshot(other)).items).toEqual([]);
    const occurrence = { calendar_id: privateCalendar, uid: 'Cita privada', recurrence_id: null };
    expect(await send(begin('Cita privada', 'now', { occurrence }))).toMatchObject({
      status: 'rejected',
    });
    const result = await send(begin('Cita privada', 'now', { occurrence, confirm_share: true }));
    expect(result).toMatchObject({
      status: 'ok',
      entity: { task: { title: 'Cita privada', from_calendar: true } },
    });
    const res = await app.inject({ method: 'GET', url: '/api/v1/sync', headers: other });
    expect(res.statusCode, res.body).toBe(200);
    const task = res
      .json<{ changes: { id: string; data: object }[] }>()
      .changes.find((change) => change.id === result.entity!.task!.id)!.data;
    expect(task).toMatchObject({ title: 'Cita privada', from_calendar: true });
    expect(task).not.toHaveProperty('event_calendar_id');
    expect(task).not.toHaveProperty('event_uid');
  });

  it('una ocurrència iniciada no consumeix tota la sèrie', async () => {
    await seed('Cada dia', calendar, { rrule: 'FREQ=DAILY;COUNT=2' });
    await send(config);
    const first = (await snapshot()).items[0]!;
    const occurrence = {
      calendar_id: calendar,
      uid: first.uid,
      recurrence_id: first.recurrence_id,
    };
    expect(await send(begin(first.uid, 'planned', { occurrence }))).toMatchObject({ status: 'ok' });
    expect((await snapshot()).items).toEqual([]);
    vi.setSystemTime(new Date('2026-06-16T08:10:00Z'));
    const next = (await snapshot(await login('calendar-owner@example.com'))).items[0]!;
    expect(next.recurrence_id).not.toBe(first.recurrence_id);
    expect(next.task_id).toBeNull();
  });

  it('vincula una conversió antiga a una sola ocurrència si el mateix dia n’hi ha més d’una', async () => {
    await seed('Dues cites', calendar, { rrule: 'FREQ=HOURLY;COUNT=2' });
    await send(config);
    const id = uuidv7();
    const converted = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: web,
      payload: {
        id,
        scope_id: personal,
        title: 'Conversió antiga',
        due_date: '2026-06-15',
        status: 'inbox',
        position: 'a0',
        source_event: { calendar_id: calendar, uid: 'Dues cites' },
      },
    });
    expect(converted.statusCode, converted.body).toBe(201);
    const [first, second] = (await snapshot()).items;
    expect(first?.task_id).toBe(id);
    expect(second?.task_id).toBeNull();
    const occurrence = {
      calendar_id: calendar,
      uid: first!.uid,
      recurrence_id: first!.recurrence_id,
    };
    expect(await send(begin(first!.uid, 'planned', { occurrence, task_id: id }))).toMatchObject({
      status: 'ok',
    });
    expect((await snapshot()).items).toEqual([second]);
  });

  it('manté una conversió assistida al tauler de la IA', async () => {
    await seed('Assistida');
    await send(config);
    const converted = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: web,
      payload: {
        scope_id: personal,
        title: 'Assistida',
        status: 'todo',
        position: 'a0',
        ai_mode: 'assisted',
        source_event: { calendar_id: calendar, uid: 'Assistida' },
      },
    });
    expect(converted.statusCode, converted.body).toBe(201);
    expect((await snapshot()).items).toEqual([]);
    expect(await send(begin('Assistida', 'now'))).toMatchObject({ status: 'rejected' });
  });
});
