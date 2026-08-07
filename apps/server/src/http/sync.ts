/**
 * Rutes de sincronització i temps real.
 *
 * `/stream` i **no** `/events/stream`: `/events` és el CRUD d'esdeveniments, i posar-hi
 * l'SSE a sota fa que qui llegeixi l'API el confongui amb un subrecurs (docs/05 §5).
 * Aquest xoc de noms és real i ve marcat al research.
 */

import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { PolicyError, notFound, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { assertScopeAccess } from '../services/scopes.js';
import { createChecklist, createChecklistItem } from '../services/checklists.js';
import { createSubtask } from '../services/subtasks.js';
import { createTask } from '../services/tasks.js';
import { addComment } from '../services/comments.js';
import { createProject } from '../services/scopes.js';
import { createEvent } from '../services/events.js';
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
    if (app.connection === undefined) throw unauthenticated('The instance has no database.');
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

/**
 * Les taules on el sync pot escriure, per entitat.
 *
 * **Han de ser les mateixes que baixen.** Amb quatre aquí i vuit al `pull`, un comentari
 * o un esdeveniment creat en mode avió baixava però no pujava mai: es perdia sense dir
 * res. L'asimetria entre el que arriba i el que se'n pot enviar és, per definició, una
 * manera de perdre dades.
 */
const TABLES: Record<string, string> = {
  task: 'tasks',
  subtask: 'subtasks',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
  comment: 'comments',
  project: 'projects',
  event: 'events',
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

/**
 * Despatxa una creació del lot al servei que li toca.
 *
 * L'entitat pare arriba dins de `data` —`task_id`, `checklist_id`— perquè el lot ja ve
 * en ordre topològic (docs/06 §4): la llista abans que els seus ítems.
 */
async function createFromBatch(
  ctx: AuditContext,
  principal: Principal,
  entity: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const text = (key: string): string | undefined =>
    typeof data[key] === 'string' ? (data[key] as string) : undefined;

  switch (entity) {
    case 'task': {
      const { task } = await createTask(ctx, principal, data as never);
      return task as unknown as Record<string, unknown>;
    }
    case 'subtask': {
      const taskId = text('task_id');
      if (taskId === undefined) throw missingParent('subtask', 'task_id');
      return (await createSubtask(ctx, principal, taskId, data as never)) as unknown as Record<
        string,
        unknown
      >;
    }
    case 'checklist': {
      const taskId = text('task_id');
      if (taskId === undefined) throw missingParent('checklist', 'task_id');
      return (await createChecklist(ctx, principal, taskId, data as never)) as unknown as Record<
        string,
        unknown
      >;
    }
    case 'checklist_item': {
      const checklistId = text('checklist_id');
      if (checklistId === undefined) throw missingParent('checklist_item', 'checklist_id');
      return (await createChecklistItem(
        ctx,
        principal,
        checklistId,
        data as never,
      )) as unknown as Record<string, unknown>;
    }
    /**
     * Les tres que **baixaven i no pujaven**.
     *
     * El lot en cobria quatre, i el sync en baixa vuit: un comentari, un projecte o un
     * esdeveniment creat en mode avió —o replicat des d'una altra instància— no tenia
     * camí de tornada i es perdia sense dir res. Que hi hagi asimetria entre el que
     * arriba i el que se'n pot enviar és, per definició, una manera de perdre dades.
     */
    case 'comment': {
      const taskId = text('task_id');
      if (taskId === undefined) throw missingParent('comment', 'task_id');
      return (await addComment(ctx, principal, taskId, text('body') ?? '')) as unknown as Record<
        string,
        unknown
      >;
    }
    case 'project': {
      const { entity: project } = await createProject(ctx, principal, data as never);
      return project as unknown as Record<string, unknown>;
    }
    case 'event': {
      const { event } = await createEvent(ctx, principal, data as never);
      return event as unknown as Record<string, unknown>;
    }
    default:
      throw new PolicyError(
        'not-creatable',
        'Not creatable',
        422,
        `"${entity}" cannot be created from a batch.`,
        { entity },
      );
  }
}

function missingParent(entity: string, field: string): PolicyError {
  return new PolicyError(
    'parent-required',
    'Parent required',
    422,
    `Creating a "${entity}" needs "${field}" in "data".`,
    { entity, field },
  );
}

async function applyOne(
  app: FastifyInstance,
  principal: Principal,
  operation: BatchOperation,
): Promise<BatchResult> {
  // Idempotència: el mateix `op_id` reenviat torna el resultat d'abans.
  const db = app.connection!.db;
  const now = new Date().toISOString();

  /**
   * **Un `op_id` que no és una cadena es rebutja aquí i no més avall.**
   *
   * Amb la memòria en un `Map` passava desapercebut: una clau `undefined` s'hi guardava
   * sense queixar-se. Ara la clau va a taula i és `NOT NULL`, i un lot amb l'`op_id`
   * absent tornava un 500 en comptes de dir què li passava. La idempotència del lot es
   * recolza sencera en aquest camp: sense ell no hi ha res a recordar.
   */
  if (typeof operation.op_id !== 'string' || operation.op_id === '') {
    return {
      op_id: 'desconegut',
      status: 'rejected',
      error: { detail: 'Cada operació del lot necessita un `op_id` que sigui una cadena.' },
    };
  }

  const already = await recallOp(db, principal, operation.op_id);
  if (already !== undefined) return already;

  const table = TABLES[operation.entity];
  if (table === undefined) {
    const rejected: BatchResult = {
      op_id: operation.op_id,
      status: 'rejected',
      error: { detail: `"${operation.entity}" no és una entitat que se sincronitzi.` },
    };
    await rememberOp(db, principal, operation.op_id, rejected, now);
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

        /**
         * **L'àmbit es comprova AQUÍ, abans de qualsevol branca.**
         *
         * Estava trenta línies més avall, després del `return` de `delete` i del de
         * `create` sobre una fila existent. El resultat era que **qualsevol autenticat
         * podia esborrar per identificador una tasca d'un àmbit que no era seu**, i
         * llegir-la amb `op: 'create'`. Comprovat contra el servidor amb dos comptes: la
         * víctima passava a rebre 404 de la seva pròpia tasca.
         *
         * El `create` sobre una fila absent no hi passa a posta: allà encara no hi ha
         * `scope_id` del servidor i qui comprova és el servei que la crea, amb el `scope_id`
         * que porta la petició.
         *
         * Que no s'hagi vist abans té una explicació incòmoda: la guarda de la regla 4
         * tapava la fuita de lectura —el `create` sobre una fila existent no registra res
         * a l'historial i `auditedTransaction` llançava—, però l'esborrat sí que registra,
         * i per tant passava net.
         */
        if (server !== undefined) {
          const owner = server.scope_id as string | undefined;
          if (owner !== undefined) await assertScopeAccess(ctx.tx, principal, owner);
        }

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

        /**
         * **Crear des de la cua de sortida.**
         *
         * `docs/06` §3 posa `create` entre les operacions de l'outbox: una tasca escrita
         * al metro no existeix enlloc fins que el lot arriba. Es delega als serveis de
         * sempre i no a un `INSERT` propi, perquè són ells els que fan complir les
         * invariants —una tasca sense àmbit es rebutja, un àmbit individual s'autoassigna—
         * i els que deixen la fila a `activity_log` dins de la mateixa transacció.
         *
         * Si la fila **ja hi és**, no es torna a crear: el mateix `op_id` reenviat ja el
         * para la memòria d'idempotència, però dos `op_id` diferents amb el mateix `id`
         * —un reintent d'una cua que va perdre la resposta— han de convergir igual.
         */
        if (operation.op === 'create' && server === undefined) {
          const data = { ...(operation.data ?? {}), id: operation.id } as Record<string, unknown>;
          const entity = await createFromBatch(ctx, principal, operation.entity, data);
          return { op_id: operation.op_id, status: 'ok', entity };
        }

        if (server === undefined) {
          throw notFound(operation.entity, operation.id);
        }

        // Una creació d'una fila que ja hi és: ja està feta. Es respon amb la de dins,
        // que és el que el client vol saber.
        if (operation.op === 'create') {
          return { op_id: operation.op_id, status: 'ok', entity: server };
        }

        const scopeId = server.scope_id as string | undefined;

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

    await rememberOp(db, principal, operation.op_id, result, now);
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
    await rememberOp(db, principal, operation.op_id, rejected, now);
    return rejected;
  }
}
