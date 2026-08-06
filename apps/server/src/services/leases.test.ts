/**
 * docs/13 M11 · `test: ai-leasing`.
 *
 * "Sense reserva, dos agents amb el mateix token fan la mateixa feina dues vegades"
 * (docs/09 §5). La prova que decideix aquesta peça és l'atomicitat: **dos `next_task`
 * simultanis han de rebre tasques diferents.**
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import { LEASE_MINUTES, claim, leaseOf, nextTask, release } from './leases.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-lease-'));
const NOW = '2026-08-06T09:00:00.000Z';

let conn: Connection;
let userId: string;
let scopeId: string;
let principal: Principal;

function agentPrincipal(agentId: string): Principal {
  return { ...principal, kind: 'agent', agentId };
}

async function write<T>(
  who: Principal,
  work: Parameters<typeof auditedTransaction<T>>[2],
  now = NOW,
): Promise<T> {
  return auditedTransaction(conn.db, who, work, { engine: 'sqlite', now });
}

async function delegada(title: string, position: string): Promise<string> {
  const id = uuidv7();
  await sql`
    INSERT INTO tasks (id, scope_id, title, status, position, ai_mode, created_by,
                       created_at, updated_at)
    VALUES (${id}, ${scopeId}, ${title}, 'todo', ${position}, 'delegated', ${userId},
            ${NOW}, ${NOW})
  `.execute(conn.db);
  return id;
}

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Feina', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  // Els agents han d'existir de debò: `task_leases.agent_id` té clau forana cap a
  // `ai_agents`, i inventar-se un identificador aquí amagaria el que la reserva prova.
  for (const agentId of ['agent-a', 'agent-b']) {
    await sql`
      INSERT INTO ai_agents (id, name, on_behalf_of_user_id, actor_user_id,
                             can_create_tasks, created_at, updated_at)
      VALUES (${agentId}, ${agentId}, ${userId}, ${userId}, 1, ${NOW}, ${NOW})
    `.execute(conn.db);
  }

  principal = {
    kind: 'user',
    userId,
    capabilities: new Set(capabilitiesForRole('admin')),
    scopeIds: null,
    source: 'mcp',
  };
});

afterAll(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`DELETE FROM task_leases`.execute(conn.db);
  await sql`DELETE FROM tasks`.execute(conn.db);
});

describe('AQUESTA és la que decideix: atomicitat', () => {
  it('dos next_task simultanis reben tasques DIFERENTS', async () => {
    await delegada('Primera', 'a1');
    await delegada('Segona', 'a2');

    // Es llancen alhora, sense esperar-se: és el cas real de dos agents amb el mateix
    // token engegats a la vegada.
    const [a, b] = await Promise.all([
      write(agentPrincipal('agent-a'), async (ctx) => nextTask(ctx, agentPrincipal('agent-a'))),
      write(agentPrincipal('agent-b'), async (ctx) => nextTask(ctx, agentPrincipal('agent-b'))),
    ]);

    expect(a?.taskId).toBeDefined();
    expect(b?.taskId).toBeDefined();
    // Si totes dues tornessin la mateixa, la feina es faria dues vegades.
    expect(a?.taskId).not.toBe(b?.taskId);
  });

  it('amb UNA sola tasca, el segon no en rep cap', async () => {
    await delegada("L'única", 'a1');

    const [a, b] = await Promise.all([
      write(agentPrincipal('agent-a'), async (ctx) => nextTask(ctx, agentPrincipal('agent-a'))),
      write(agentPrincipal('agent-b'), async (ctx) => nextTask(ctx, agentPrincipal('agent-b'))),
    ]);

    const rebudes = [a, b].filter((r) => r !== undefined);
    expect(rebudes).toHaveLength(1);
  });

  it('reservar una que ja té reserva torna undefined, no llança', async () => {
    const id = await delegada('Compartida', 'a1');
    await write(principal, async (ctx) => claim(ctx, principal, id));

    // Una excepció aquí faria que el camí feliç de `nextTask` passés per un `try`.
    const segona = await write(principal, async (ctx) => {
      const lease = await claim(ctx, principal, id);
      ctx.noChange();
      return lease;
    });
    expect(segona).toBeUndefined();
  });
});

describe('què retorna next_task', () => {
  it('NOMÉS tasques delegades', async () => {
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, ai_mode, created_by,
                         created_at, updated_at)
      VALUES (${uuidv7()}, ${scopeId}, 'Manual', 'todo', 'a1', 'manual', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, ai_mode, created_by,
                         created_at, updated_at)
      VALUES (${uuidv7()}, ${scopeId}, 'Amb ajuda', 'todo', 'a2', 'assisted', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    const found = await write(principal, async (ctx) => nextTask(ctx, principal));
    // Ni `manual` ni `assisted`: només les que l'usuari ha delegat de debò.
    expect(found).toBeUndefined();
  });

  it('cap de feta', async () => {
    const id = await delegada('Ja feta', 'a1');
    await sql`UPDATE tasks SET status = 'done' WHERE id = ${id}`.execute(conn.db);

    expect(await write(principal, async (ctx) => nextTask(ctx, principal))).toBeUndefined();
  });

  it('cap esborrada', async () => {
    const id = await delegada('Esborrada', 'a1');
    await sql`UPDATE tasks SET deleted_at = ${NOW} WHERE id = ${id}`.execute(conn.db);

    expect(await write(principal, async (ctx) => nextTask(ctx, principal))).toBeUndefined();
  });

  it("cap d'un àmbit que el token no veu", async () => {
    await delegada('A Feina', 'a1');
    const limitat: Principal = { ...principal, scopeIds: new Set(['un-altre-ambit']) };

    expect(await write(limitat, async (ctx) => nextTask(ctx, limitat))).toBeUndefined();
  });

  it('respecta el filtre per àmbit', async () => {
    await delegada('A Feina', 'a1');
    const found = await write(principal, async (ctx) =>
      nextTask(ctx, principal, { scopeId: 'un-altre' }),
    );
    expect(found).toBeUndefined();
  });
});

describe('la reserva', () => {
  it('dura 30 minuts', async () => {
    const id = await delegada('Reservada', 'a1');
    const lease = await write(principal, async (ctx) => claim(ctx, principal, id));

    const minuts = (Date.parse(lease!.expiresAt) - Date.parse(NOW)) / 60_000;
    expect(minuts).toBe(LEASE_MINUTES);
  });

  it('caducada, la tasca torna a estar disponible', async () => {
    const id = await delegada('Abandonada', 'a1');
    await write(principal, async (ctx) => claim(ctx, principal, id));

    // Passa una hora.
    const desprès = new Date(Date.parse(NOW) + 60 * 60_000).toISOString();
    expect(await leaseOf(conn.db, id, desprès)).toBeUndefined();

    const found = await write(principal, async (ctx) => nextTask(ctx, principal), desprès);
    expect(found?.taskId).toBe(id);
  });

  it("una reserva caducada queda anotada a l'historial", async () => {
    const id = await delegada('Abandonada', 'a1');
    await write(principal, async (ctx) => claim(ctx, principal, id));

    const desprès = new Date(Date.parse(NOW) + 60 * 60_000).toISOString();
    await write(principal, async (ctx) => claim(ctx, principal, id), desprès);

    const historial = await sql<{ verb: string; changes: string }>`
      SELECT verb, changes FROM activity_log WHERE entity_id = ${id} ORDER BY id
    `.execute(conn.db);
    // Sense això, una tasca que canvia de mans sense explicació és un misteri.
    expect(
      historial.rows.some((row) => row.verb === 'released' && row.changes.includes('caducat')),
    ).toBe(true);
  });
});

describe('alliberar', () => {
  it('exigeix un motiu', async () => {
    const id = await delegada('Per alliberar', 'a1');
    await write(principal, async (ctx) => claim(ctx, principal, id));

    // "Una tasca que torna a la pila sense explicació fa que el següent agent
    // repeteixi el mateix intent fallit."
    await expect(
      write(principal, async (ctx) => {
        await release(ctx, principal, id, '   ');
      }),
    ).rejects.toThrow(/motiu/u);
  });

  it('amb motiu, la torna a deixar disponible', async () => {
    const id = await delegada('Per alliberar', 'a1');
    await write(principal, async (ctx) => claim(ctx, principal, id));

    await write(principal, async (ctx) => {
      await release(ctx, principal, id, 'Em falta accés al repositori.');
    });

    expect(await leaseOf(conn.db, id, NOW)).toBeUndefined();
    const found = await write(principal, async (ctx) => nextTask(ctx, principal));
    expect(found?.taskId).toBe(id);
  });

  it("el motiu queda a l'historial", async () => {
    const id = await delegada('Per alliberar', 'a1');
    await write(principal, async (ctx) => claim(ctx, principal, id));
    await write(principal, async (ctx) => {
      await release(ctx, principal, id, 'Em falta accés al repositori.');
    });

    const historial = await sql<{ changes: string }>`
      SELECT changes FROM activity_log WHERE entity_id = ${id} AND verb = 'released'
      ORDER BY id DESC LIMIT 1
    `.execute(conn.db);
    expect(historial.rows[0]?.changes).toContain('accés al repositori');
  });

  it('alliberar una que no està reservada és 404', async () => {
    const id = await delegada('Lliure', 'a1');
    await expect(
      write(principal, async (ctx) => {
        await release(ctx, principal, id, 'Un motiu');
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
