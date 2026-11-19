import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import type { Capability } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import {
  assertSyncContentAccess,
  assertSyncEditableFields,
  assertSyncWriteCapability,
  canReadSyncEntity,
  type SyncWritable,
} from './sync-access.js';
import { recallOp, rememberOp } from './sync.js';

const now = '2026-11-19T10:00:00.000Z';
const conn = connect('sqlite://:memory:');
const context = { tx: conn.db, now };
const [owner, collaborator, viewer, scope, task, checklist, calendar, feed] = Array.from(
  { length: 8 },
  () => uuidv7(),
) as [string, string, string, string, string, string, string, string];

function principal(userId: string, capabilities: Capability[] = []): Principal {
  return {
    kind: 'user',
    userId,
    capabilities: new Set(capabilities),
    scopeIds: null,
    source: 'api',
  };
}

beforeAll(async () => {
  await migrateToLatest(conn.db, { engine: 'sqlite' });
  for (const [id, name] of [
    [owner, 'Propietària'],
    [collaborator, 'Col·laborador'],
    [viewer, 'Lectora'],
  ] as const) {
    await sql`INSERT INTO users (id, name, kind, role, created_at, updated_at)
      VALUES (${id}, ${name}, 'human', 'member', ${now}, ${now})`.execute(conn.db);
  }
  await sql`INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scope}, 'Casa', 'collective', '--plou-blue', ${owner}, 'a0', ${now}, ${now})`.execute(
    conn.db,
  );
  for (const [id, role] of [
    [collaborator, 'collaborator'],
    [viewer, 'viewer'],
  ] as const) {
    await sql`INSERT INTO scope_members (id, scope_id, user_id, role, created_at)
      VALUES (${uuidv7()}, ${scope}, ${id}, ${role}, ${now})`.execute(conn.db);
  }
  await sql`INSERT INTO tasks (id, title, scope_id, position, created_by, created_at, updated_at)
    VALUES (${task}, 'Compra', ${scope}, 'a0', ${owner}, ${now}, ${now})`.execute(conn.db);
  await sql`INSERT INTO checklists (id, task_id, name, position, created_at, updated_at)
    VALUES (${checklist}, ${task}, 'Mercat', 'a0', ${now}, ${now})`.execute(conn.db);
  await sql`INSERT INTO calendars (id, scope_id, name, kind, origin, source_kind, shared_with_scope,
                                    created_at, updated_at)
    VALUES (${calendar}, ${scope}, 'Privat', 'events', 'local', NULL, 0, ${now}, ${now}),
           (${feed}, ${scope}, 'Agenda pública', 'events', 'subscription', 'ical', 1, ${now}, ${now})`.execute(
    conn.db,
  );
});

afterAll(() => conn.close());

describe('capacitats de sincronització', () => {
  it.each([
    ['task', 'tasks:write', 'tasks:delete'],
    ['subtask', 'tasks:write', 'tasks:write'],
    ['checklist', 'checklists:write', 'checklists:write'],
    ['checklist_item', 'checklists:write', 'checklists:write'],
    ['comment', 'comments:write', 'comments:write'],
    ['project', 'projects:write', 'projects:write'],
    ['event', 'events:write', 'events:delete'],
  ] satisfies [SyncWritable, Capability, Capability][])(
    '%s exigeix la capacitat del recurs i de l’acció',
    (entity, write, remove) => {
      const reader = principal(owner, [
        'tasks:read',
        'checklists:read',
        'comments:read',
        'projects:read',
        'events:read',
      ]);
      for (const action of ['create', 'update', 'move'] as const) {
        expect(() => assertSyncWriteCapability(reader, entity, action)).toThrow();
        expect(() =>
          assertSyncWriteCapability(principal(owner, [write]), entity, action),
        ).not.toThrow();
      }
      expect(() => assertSyncWriteCapability(reader, entity, 'delete')).toThrow();
      expect(() =>
        assertSyncWriteCapability(principal(owner, [remove]), entity, 'delete'),
      ).not.toThrow();
      if (write !== remove)
        expect(() =>
          assertSyncWriteCapability(principal(owner, [write]), entity, 'delete'),
        ).toThrow();
    },
  );

  it('les lectures del delta mantenen els permisos de cada recurs', () => {
    const reader = principal(owner, ['tasks:read']);
    expect(canReadSyncEntity(reader, 'task')).toBe(true);
    expect(canReadSyncEntity(reader, 'subtask')).toBe(true);
    for (const entity of [
      'checklist',
      'checklist_item',
      'comment',
      'scope',
      'project',
      'event',
      'attachment',
    ]) {
      expect(canReadSyncEntity(reader, entity)).toBe(false);
    }
  });

  it('les metadades de parentiu i autoria queden fora dels camps editables', () => {
    expect(() => assertSyncEditableFields('event', ['summary', 'starts_at'])).not.toThrow();
    expect(() => assertSyncEditableFields('event', ['calendar_id'])).toThrow();
    expect(() => assertSyncEditableFields('comment', ['author_id'])).toThrow();
    expect(() => assertSyncEditableFields('checklist_item', ['checklist_id'])).toThrow();
  });
});

describe('abast de les entitats sincronitzades', () => {
  it.each([
    ['subtask', { task_id: task }],
    ['checklist', { task_id: task }],
    ['checklist_item', { checklist_id: checklist }],
    ['comment', { task_id: task }],
    ['project', { scope_id: scope }],
  ] satisfies [SyncWritable, Record<string, string>][])(
    '%s requereix un àmbit concedit i un rol que pugui escriure-hi',
    async (entity, row) => {
      const member = principal(collaborator);
      await expect(assertSyncContentAccess(context, member, entity, row, 'update')).resolves.toBe(
        scope,
      );
      await expect(
        assertSyncContentAccess(context, principal(viewer), entity, row, 'update'),
      ).rejects.toMatchObject({
        slug: 'not-allowed-in-scope',
      });
      await expect(
        assertSyncContentAccess(context, { ...member, scopeIds: new Set() }, entity, row, 'update'),
      ).rejects.toMatchObject({
        slug: 'scope-forbidden',
      });
    },
  );

  it('un esdeveniment hereta la visibilitat i la política d’escriptura del calendari', async () => {
    await expect(
      assertSyncContentAccess(
        context,
        principal(owner),
        'event',
        { calendar_id: calendar },
        'update',
      ),
    ).resolves.toBe(scope);
    await expect(
      assertSyncContentAccess(
        context,
        principal(collaborator),
        'event',
        { calendar_id: calendar },
        'update',
      ),
    ).rejects.toMatchObject({
      slug: 'not-found',
    });
    await expect(
      assertSyncContentAccess(
        context,
        principal(collaborator),
        'event',
        { calendar_id: feed },
        'update',
      ),
    ).rejects.toMatchObject({
      slug: 'calendar-read-only',
    });
  });

  it('les subtasques d’una tasca manual segueixen la política de reserva de la tasca', async () => {
    const agent = { ...principal(owner), kind: 'agent' as const, agentId: uuidv7() };
    await expect(
      assertSyncContentAccess(context, agent, 'subtask', { task_id: task }, 'update'),
    ).rejects.toMatchObject({ slug: 'human-took-over' });
    await expect(
      assertSyncContentAccess(context, agent, 'comment', { task_id: task }, 'create'),
    ).resolves.toBe(scope);
  });
});

describe('rebuts del lot', () => {
  it('un rebut queda vinculat a una operació i a la credencial que l’ha creada', async () => {
    const op = { op_id: uuidv7(), entity: 'task', id: task, op: 'update' as const };
    const account = principal(owner);
    const first: Principal = { ...account, credentialType: 'pat', credentialId: uuidv7() };
    const second: Principal = { ...first, credentialId: uuidv7() };
    const result = {
      op_id: op.op_id,
      status: 'ok' as const,
      entity: { id: task, title: 'Compra' },
    };
    await rememberOp(conn.db, first, op, result, now);
    await expect(recallOp(conn.db, first, op)).resolves.toEqual(result);
    await expect(recallOp(conn.db, second, op)).resolves.toBeUndefined();
    await expect(recallOp(conn.db, first, { ...op, id: uuidv7() })).rejects.toMatchObject({
      slug: 'sync-op-reused',
    });
  });
});
