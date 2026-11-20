import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connect } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import { enqueueTaskActivityNotifications } from '../services/task-activity-notifications.js';
import { createTask, updateTask } from '../services/tasks.js';
import { auditedTransaction, type AuditEntry } from './audited-transaction.js';

vi.mock('../services/task-activity-notifications.js', () => ({
  enqueueTaskActivityNotifications: vi.fn(),
}));

const NOW = '2026-11-20T16:00:00.000Z';
const OWNER = 'owner';
const SCOPE = 'personal';
const OLD_SCOPE = 'old-scope';
const API: Principal = {
  kind: 'user',
  userId: OWNER,
  capabilities: new Set(capabilitiesForRole('admin')),
  scopeIds: null,
  source: 'api',
  credentialType: 'pat',
};
const MCP: Principal = { ...API, source: 'mcp', credentialType: 'oauth' };

describe('avisos de les transaccions auditades', () => {
  const connection = connect('sqlite::memory:');
  const enqueue = vi.mocked(enqueueTaskActivityNotifications);
  let inbox: string;
  let task: string;
  let occurrence: string;

  beforeAll(async () => {
    await migrateToLatest(connection.db, { engine: 'sqlite' });
    await sql`INSERT INTO users (id, email, name, kind, role, created_at, updated_at)
      VALUES (${OWNER}, 'owner@example.net', 'Owner', 'human', 'admin', ${NOW}, ${NOW})`.execute(
      connection.db,
    );
    for (const id of [SCOPE, OLD_SCOPE]) {
      await sql`INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
        VALUES (${id}, ${id}, 'individual', '--plou-blue', ${OWNER}, 'a1', ${NOW}, ${NOW})`.execute(
        connection.db,
      );
    }

    const principal = { ...API, source: 'web', credentialType: 'session' } as const;
    await auditedTransaction(connection.db, principal, async (ctx) => {
      inbox = (await createTask(ctx, principal, { title: 'Inbox', scope_id: SCOPE }, 'sqlite')).task
        .id;
      task = (
        await createTask(
          ctx,
          principal,
          { title: 'Tasca', scope_id: SCOPE, status: 'doing' },
          'sqlite',
        )
      ).task.id;
      occurrence = (
        await createTask(
          ctx,
          principal,
          { title: 'Recurrència', scope_id: SCOPE, status: 'todo' },
          'sqlite',
        )
      ).task.id;
    });
  });

  beforeEach(() => enqueue.mockReset());
  afterAll(() => connection.close());

  function record(principal: Principal, ...entries: AuditEntry[]) {
    return auditedTransaction(
      connection.db,
      principal,
      async (ctx) => entries.forEach(ctx.record),
      { now: NOW },
    );
  }

  it('prioritza la creació i l’entrada a Inbox i exclou la següent recurrència', async () => {
    await record(
      API,
      { entityType: 'task', entityId: inbox, scopeId: SCOPE, verb: 'created' },
      {
        entityType: 'subtask',
        entityId: 'subtask',
        taskId: inbox,
        scopeId: SCOPE,
        verb: 'created',
      },
      { entityType: 'task', entityId: task, scopeId: SCOPE, verb: 'created' },
      {
        entityType: 'attachment',
        entityId: 'attachment',
        taskId: task,
        scopeId: SCOPE,
        verb: 'created',
      },
      {
        entityType: 'task',
        entityId: occurrence,
        scopeId: SCOPE,
        verb: 'created',
        changes: { recurrence_parent_id: { from: null, to: task } },
      },
    );

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), {
      taskId: inbox,
      scopeId: SCOPE,
      kinds: ['inbox_entry'],
      now: NOW,
    });
    expect(enqueue).toHaveBeenCalledWith(expect.anything(), {
      taskId: task,
      scopeId: SCOPE,
      kinds: ['task_created'],
      now: NOW,
    });
  });

  it('usa l’àmbit de destí i agrupa l’estat i l’activitat de la mateixa operació', async () => {
    await record(
      MCP,
      {
        entityType: 'task',
        entityId: task,
        scopeId: OLD_SCOPE,
        verb: 'moved',
        changes: { status: { from: 'inbox', to: 'doing' } },
      },
      {
        entityType: 'subtask',
        entityId: 'subtask',
        taskId: task,
        scopeId: SCOPE,
        verb: 'completed',
        changes: { done: { from: false, to: true }, title: { from: 'Abans', to: 'Ara' } },
      },
      { entityType: 'task', entityId: task, scopeId: SCOPE, verb: 'commented' },
      { entityType: 'task', entityId: task, scopeId: SCOPE, verb: 'asked' },
    );

    expect(enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      taskId: task,
      scopeId: SCOPE,
      kinds: ['status_changed', 'task_activity'],
      now: NOW,
    });
  });

  it('només avisa de l’entrada a Inbox i ignora els canvis dins la columna', async () => {
    await record(MCP, {
      entityType: 'task',
      entityId: inbox,
      scopeId: SCOPE,
      verb: 'moved',
      changes: { status: { from: 'todo', to: 'inbox' } },
    });
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      taskId: inbox,
      scopeId: SCOPE,
      kinds: ['inbox_entry'],
      now: NOW,
    });

    enqueue.mockClear();
    await record(
      MCP,
      { entityType: 'task', entityId: inbox, scopeId: SCOPE, verb: 'commented' },
      {
        entityType: 'subtask',
        entityId: 'subtask',
        taskId: inbox,
        scopeId: SCOPE,
        verb: 'reopened',
        changes: { done: { from: true, to: false } },
      },
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ignora canvis idèntics, reordenacions, adjunts del calendari i estats interns d’IA', async () => {
    await record(
      MCP,
      {
        entityType: 'task',
        entityId: task,
        scopeId: SCOPE,
        verb: 'moved',
        changes: {
          status: { from: 'doing', to: 'doing' },
          position: { from: 'a1', to: 'a2' },
          occurred_at: { from: null, to: NOW },
        },
      },
      {
        entityType: 'task',
        entityId: task,
        scopeId: SCOPE,
        verb: 'updated',
        changes: { title: { from: 'Tasca', to: 'Tasca' } },
      },
      {
        entityType: 'task',
        entityId: task,
        scopeId: SCOPE,
        verb: 'ai_execution_updated',
        changes: { status: { from: 'queued', to: 'delivered' } },
      },
      {
        entityType: 'attachment',
        entityId: 'calendar-attachment',
        scopeId: SCOPE,
        verb: 'created',
      },
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('compta els resultats d’IA i els canvis reals de llistes i adjunts com a activitat', async () => {
    await record(
      MCP,
      { entityType: 'task', entityId: task, scopeId: SCOPE, verb: 'ai_execution_result' },
      {
        entityType: 'attachment',
        entityId: 'attachment',
        taskId: task,
        scopeId: SCOPE,
        verb: 'deleted',
      },
      {
        entityType: 'checklist_item',
        entityId: 'item',
        taskId: task,
        scopeId: SCOPE,
        verb: 'completed',
        changes: { done: { from: false, to: true } },
      },
    );
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
      taskId: task,
      scopeId: SCOPE,
      kinds: ['task_activity'],
      now: NOW,
    });
  });

  it('conserva la mateixa transacció per al canvi, el registre i l’avís', async () => {
    const history = () =>
      sql<{ n: number }>`
      SELECT COUNT(*) n FROM activity_log WHERE entity_id = ${task}
    `.execute(connection.db);
    const before = await history();
    enqueue.mockRejectedValueOnce(new Error('La cua no es pot desar'));

    await expect(
      auditedTransaction(connection.db, API, (ctx) => updateTask(ctx, API, task, { title: 'Nou' })),
    ).rejects.toThrow('La cua no es pot desar');

    const { rows } = await sql<{
      title: string;
    }>`SELECT title FROM tasks WHERE id = ${task}`.execute(connection.db);
    expect(rows[0]?.title).toBe('Tasca');
    expect((await history()).rows).toEqual(before.rows);
  });

  it.each([
    { ...API, credentialType: 'session', source: 'web' },
    { ...API, credentialType: 'session', source: 'android' },
    { ...API, credentialType: 'federation' },
    { ...API, credentialType: 'pat', source: 'caldav' },
  ] satisfies Principal[])(
    'filtra l’origen autenticat $source/$credentialType',
    async (principal) => {
      await record(principal, {
        entityType: 'task',
        entityId: task,
        scopeId: SCOPE,
        verb: 'commented',
      });
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
});
