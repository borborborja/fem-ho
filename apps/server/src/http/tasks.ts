/**
 * Rutes d'àmbits, projectes i tasques.
 *
 * Els handlers són prims a posta: **la decisió viu a la capa de servei** (regla 8).
 * Aquí només es tradueix HTTP a principal, es crida el servei, i es tradueix el
 * resultat o l'error de tornada.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TaskStatus } from '@fem-ho/contracts';
import { TASK_STATUSES } from '@fem-ho/contracts';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { createProject, createScope, listProjects, listScopes } from '../services/scopes.js';
import { completeTask, createTask, getBoard, listTasks, moveTask } from '../services/tasks.js';
import { principalOf } from './auth.js';

/**
 * Embolcall comú: resol el principal, executa, i tradueix els errors de política a
 * `application/problem+json`. Sense això, cada handler repetiria el mateix `try`.
 */
async function handle<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (principal: Principal) => Promise<T>,
): Promise<T | undefined> {
  try {
    if (app.connection === undefined) throw unauthenticated('La instància no té base de dades.');
    const principal = await principalOf(app, request);
    return await work(principal);
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

function parseStatuses(raw: unknown): TaskStatus[] | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  // Els valors múltiples se separen per comes (docs/05 §3).
  const parts = raw.split(',').map((s) => s.trim());
  const valid = parts.filter((s): s is TaskStatus =>
    (TASK_STATUSES as readonly string[]).includes(s),
  );
  return valid.length > 0 ? valid : undefined;
}

function parseIds(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return parts.length > 0 ? parts : undefined;
}

export function registerTaskRoutes(app: FastifyInstance): void {
  app.get('/api/v1/scopes', async (request, reply) =>
    handle(app, request, reply, async (principal) => listScopes(app.connection!.db, principal)),
  );

  app.post('/api/v1/scopes', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await auditedTransaction(app.connection!.db, principal, (ctx) =>
        createScope(ctx, principal, {
          id: typeof body.id === 'string' ? body.id : undefined,
          name: String(body.name ?? ''),
          kind: body.kind === 'collective' ? 'collective' : 'individual',
          color: String(body.color ?? ''),
          icon: typeof body.icon === 'string' ? body.icon : undefined,
          ai_instructions:
            typeof body.ai_instructions === 'string' ? body.ai_instructions : undefined,
          ai_description: typeof body.ai_description === 'string' ? body.ai_description : undefined,
          position: typeof body.position === 'string' ? body.position : undefined,
        }),
      );
      // 201 si s'ha creat, 200 si ja existia: idempotència amb identificadors de client.
      void reply.code(result.created ? 201 : 200);
      return result.entity;
    }),
  );

  app.get('/api/v1/projects', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as Record<string, unknown>;
      return listProjects(
        app.connection!.db,
        principal,
        typeof query.scope_id === 'string' ? query.scope_id : undefined,
      );
    }),
  );

  app.post('/api/v1/projects', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await auditedTransaction(app.connection!.db, principal, (ctx) =>
        createProject(ctx, principal, {
          id: typeof body.id === 'string' ? body.id : undefined,
          scope_id: String(body.scope_id ?? ''),
          name: String(body.name ?? ''),
          ai_instructions:
            typeof body.ai_instructions === 'string' ? body.ai_instructions : undefined,
          ai_description: typeof body.ai_description === 'string' ? body.ai_description : undefined,
          position: typeof body.position === 'string' ? body.position : undefined,
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.entity;
    }),
  );

  app.get('/api/v1/tasks', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as Record<string, unknown>;
      return listTasks(app.connection!.db, principal, {
        scopeId: typeof query.scope_id === 'string' ? query.scope_id : undefined,
        projectId: typeof query.project_id === 'string' ? query.project_id : undefined,
        statuses: parseStatuses(query.status),
        limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
        cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
      });
    }),
  );

  app.post('/api/v1/tasks', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await auditedTransaction(app.connection!.db, principal, (ctx) =>
        createTask(ctx, principal, {
          id: typeof body.id === 'string' ? body.id : undefined,
          scope_id: typeof body.scope_id === 'string' ? body.scope_id : undefined,
          project_id: typeof body.project_id === 'string' ? body.project_id : undefined,
          title: typeof body.title === 'string' ? body.title : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
          status: parseStatuses(body.status)?.[0],
          position: typeof body.position === 'string' ? body.position : undefined,
          due_date: typeof body.due_date === 'string' ? body.due_date : undefined,
          due_time: typeof body.due_time === 'string' ? body.due_time : undefined,
          assignee_ids: Array.isArray(body.assignee_ids)
            ? body.assignee_ids.filter((v): v is string => typeof v === 'string')
            : undefined,
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.task;
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/move', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      return auditedTransaction(app.connection!.db, principal, (ctx) =>
        moveTask(ctx, principal, request.params.id, {
          status: parseStatuses(body.status)?.[0],
          position: typeof body.position === 'string' ? body.position : undefined,
          before_id: typeof body.before_id === 'string' ? body.before_id : null,
          after_id: typeof body.after_id === 'string' ? body.after_id : null,
        }),
      );
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/complete', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      auditedTransaction(app.connection!.db, principal, (ctx) =>
        completeTask(ctx, principal, request.params.id),
      ),
    ),
  );

  app.get('/api/v1/board', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as Record<string, unknown>;
      return getBoard(app.connection!.db, principal, {
        scopeIds: parseIds(query.scope_ids),
        projectId: typeof query.project_id === 'string' ? query.project_id : undefined,
      });
    }),
  );
}
