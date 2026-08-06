/**
 * Rutes de sincronització i temps real.
 *
 * `/stream` i **no** `/events/stream`: `/events` és el CRUD d'esdeveniments, i posar-hi
 * l'SSE a sota fa que qui llegeixi l'API el confongui amb un subrecurs (docs/05 §5).
 * Aquest xoc de noms és real i ve marcat al research.
 */

import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError, notFound, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { assertScopeAccess } from '../services/scopes.js';
import {
  decodeCursor,
  encodeCursor,
  pull,
  recallOp,
  rememberOp,
  resolveConflict,
  softDelete,
  type BatchOperation,
  type BatchResult,
} from '../services/sync.js';
import { principalOf } from './auth.js';

async function handle<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (principal: Principal) => Promise<T>,
): Promise<T | undefined> {
  try {
    if (app.connection === undefined) throw unauthenticated('La instància no té base de dades.');
    return await work(await principalOf(app, request));
  } catch (error) {
    if (error instanceof PolicyError) {
      void reply
        .code(error.status)
        .type('application/problem+json')
        .send(error.toProblem(request.url));
      return undefined;
    }
    throw error;
  }
}

/** Les taules on el sync pot escriure, per entitat. */
const TABLES: Record<string, string> = {
  task: 'tasks',
  subtask: 'subtasks',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
};

export function registerSyncRoutes(app: FastifyInstance): void {
  app.get('/api/v1/sync', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as Record<string, unknown>;
      return pull(app.connection!.db, principal, {
        cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
        limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
      });
    }),
  );

  app.post('/api/v1/sync/batch', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as { operations?: BatchOperation[] };
      const operations = Array.isArray(body.operations) ? body.operations : [];

      const results: BatchResult[] = [];
      for (const [index, operation] of operations.entries()) {
        /**
         * **Una operació que no és un objecte tomba el lot sencer si no es mira.**
         * `null`, un número o una cadena a la llista feien petar `operation.op_id` amb
         * un TypeError que pujava fins a dalt i tornava un 500. El client no en treia
         * res: ni quina operació era dolenta, ni què havia passat amb les bones.
         *
         * Ara es rebutja aquella i prou, que és el que docs/06 §4 demana: "cada
         * operació es resol per separat".
         */
        if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
          results.push({
            op_id: `desconegut-${String(index)}`,
            status: 'rejected',
            error: { detail: `L'operació ${String(index)} del lot no és un objecte.` },
          });
          continue;
        }

        // CADA operació es resol per separat: una que falli no ha de tombar el lot
        // (docs/06 §4).
        results.push(await applyOne(app, principal, operation));
      }
      return { results };
    }),
  );

  /**
   * SSE, no WebSocket (docs/05 §5): el trànsit és gairebé tot de servidor a client,
   * l'SSE reconnecta sol, travessa proxies sense negociació d'actualització, i és molt
   * més simple d'operar.
   */
  app.get('/api/v1/stream', async (request, reply) => {
    let principal: Principal;
    try {
      principal = await principalOf(app, request);
    } catch (error) {
      if (error instanceof PolicyError) {
        void reply.code(error.status).type('application/problem+json').send(error.toProblem());
        return;
      }
      throw error;
    }

    void reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // El proxy invers no ha de fer memòria intermèdia d'aquesta ruta (docs/12 §4).
      'X-Accel-Buffering': 'no',
    });

    /**
     * El client hi posa `Last-Event-ID` en reconnectar i el servidor reprèn des
     * d'aquell `seq`. **És el mateix cursor que el sync**, cosa que fa que reconnectar
     * i sincronitzar siguin la mateixa operació (docs/05 §5).
     */
    const lastEventId = request.headers['last-event-id'];
    let cursor =
      typeof lastEventId === 'string' ? (decodeCursor(lastEventId) ?? Number(lastEventId)) || 0 : 0;

    const conn = app.connection;
    let alive = true;
    request.raw.on('close', () => {
      alive = false;
    });

    const tick = async (): Promise<void> => {
      if (!alive || conn === undefined) return;
      try {
        const delta = await pull(conn.db, principal, { cursor: encodeCursor(cursor) });
        for (const change of delta.changes) {
          cursor = change.seq;
          reply.raw.write(
            `id: ${change.seq}\nevent: change\ndata: ${JSON.stringify({
              entity: change.entity,
              id: change.id,
              operation: change.op,
              seq: change.seq,
            })}\n\n`,
          );
        }
      } catch {
        // Un cursor caducat al flux vol dir que el client ha de resincronitzar sencer.
        reply.raw.write('event: resync\ndata: {}\n\n');
        alive = false;
      }
    };

    await tick();
    const timer = setInterval(() => void tick(), 2000);
    request.raw.on('close', () => clearInterval(timer));
  });
}

async function applyOne(
  app: FastifyInstance,
  principal: Principal,
  operation: BatchOperation,
): Promise<BatchResult> {
  // Idempotència: el mateix `op_id` reenviat torna el resultat d'abans.
  const already = recallOp(operation.op_id);
  if (already !== undefined) return already;

  const table = TABLES[operation.entity];
  if (table === undefined) {
    const rejected: BatchResult = {
      op_id: operation.op_id,
      status: 'rejected',
      error: { detail: `"${operation.entity}" no és una entitat que se sincronitzi.` },
    };
    rememberOp(operation.op_id, rejected);
    return rejected;
  }

  try {
    const result = await auditedTransaction(
      app.connection!.db,
      principal,
      async (ctx): Promise<BatchResult> => {
        const found = await sql`
          SELECT * FROM ${sql.raw(table)} WHERE id = ${operation.id}
        `.execute(ctx.tx);
        const server = found.rows[0] as Record<string, unknown> | undefined;

        if (operation.op === 'delete') {
          if (server === undefined) throw notFound(operation.entity, operation.id);
          await softDelete(
            ctx,
            operation.entity,
            operation.id,
            (server.scope_id as string | undefined) ?? null,
          );
          return { op_id: operation.op_id, status: 'ok' };
        }

        if (server === undefined) {
          throw notFound(operation.entity, operation.id);
        }

        const scopeId = server.scope_id as string | undefined;
        if (scopeId !== undefined) await assertScopeAccess(ctx.tx, principal, scopeId);

        /**
         * Esborrat contra edició: **guanya l'esborrat** (docs/06 §5). L'edició es
         * conserva a l'historial, o sigui que no es perd res del que va voler fer qui
         * editava — simplement no reviu la fila.
         */
        if (server.deleted_at != null) {
          ctx.record({
            entityType: operation.entity,
            entityId: operation.id,
            scopeId: scopeId ?? null,
            verb: 'updated',
            changes: Object.fromEntries(
              Object.entries(operation.data ?? {}).map(([k, v]) => [k, { from: null, to: v }]),
            ),
          });
          return {
            op_id: operation.op_id,
            status: 'conflict',
            server_entity: server,
          };
        }

        const { apply, needsUser } = resolveConflict({
          incoming: operation.data ?? {},
          server,
          baseVersion: operation.base_version,
        });

        if (needsUser) {
          ctx.noChange();
          return { op_id: operation.op_id, status: 'conflict', server_entity: server };
        }

        const fields = Object.keys(apply).filter((f) => f !== 'id' && f !== 'version');
        if (fields.length === 0) {
          ctx.noChange();
          return { op_id: operation.op_id, status: 'ok', entity: server };
        }

        const assignments = fields.map((field) => sql`${sql.raw(field)} = ${apply[field]}`);
        await sql`
          UPDATE ${sql.raw(table)}
          SET ${sql.join(assignments)}, updated_at = ${ctx.now}, version = version + 1
          WHERE id = ${operation.id}
        `.execute(ctx.tx);

        ctx.record({
          entityType: operation.entity,
          entityId: operation.id,
          scopeId: scopeId ?? null,
          verb: operation.op === 'move' ? 'moved' : 'updated',
          changes: Object.fromEntries(
            fields.map((field) => [field, { from: server[field], to: apply[field] }]),
          ),
        });

        const updated = await sql`
          SELECT * FROM ${sql.raw(table)} WHERE id = ${operation.id}
        `.execute(ctx.tx);

        return {
          op_id: operation.op_id,
          status: 'ok',
          entity: updated.rows[0] as Record<string, unknown>,
        };
      },
      { engine: app.connection!.engine },
    );

    rememberOp(operation.op_id, result);
    return result;
  } catch (error) {
    const rejected: BatchResult = {
      op_id: operation.op_id,
      status: 'rejected',
      error:
        error instanceof PolicyError
          ? error.toProblem()
          : { detail: "No s'ha pogut aplicar aquesta operació." },
    };
    rememberOp(operation.op_id, rejected);
    return rejected;
  }
}
