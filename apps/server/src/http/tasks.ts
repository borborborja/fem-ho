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
import {
  createEvent,
  listCalendars,
  listEventOccurrences,
  updateEvent,
  type CreateEventInput,
  type SeriesMode,
} from '../services/events.js';
import {
  createChecklist,
  createChecklistItem,
  listChecklists,
  listPinnedChecklists,
  setPinned,
  updateChecklistItem,
} from '../services/checklists.js';
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
        createTask(
          ctx,
          principal,
          {
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
          },
          app.connection!.engine,
        ),
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

/**
 * Rutes d'esdeveniments i calendaris.
 *
 * Viuen al mateix fitxer que les de tasques perquè comparteixen l'embolcall `handle`,
 * però són coses diferents: **un esdeveniment no és una tasca** (D8) i no surt mai al
 * kanban.
 */
export function registerEventRoutes(app: FastifyInstance): void {
  app.get('/api/v1/calendars', async (request, reply) =>
    handle(app, request, reply, async (principal) => listCalendars(app.connection!.db, principal)),
  );

  app.get('/api/v1/events', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as Record<string, unknown>;
      return listEventOccurrences(app.connection!.db, principal, {
        from: typeof query.from === 'string' ? query.from : '',
        to: typeof query.to === 'string' ? query.to : '',
        scopeIds: parseIds(query.scope_ids),
      });
    }),
  );

  app.post('/api/v1/events', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await auditedTransaction(app.connection!.db, principal, (ctx) =>
        createEvent(ctx, principal, body as CreateEventInput),
      );
      void reply.code(result.created ? 201 : 200);
      return result.event;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/events/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as Record<string, unknown>;
      const mode =
        query.series_mode === 'future' || query.series_mode === 'all'
          ? (query.series_mode as SeriesMode)
          : 'single';
      return auditedTransaction(app.connection!.db, principal, (ctx) =>
        updateEvent(
          ctx,
          principal,
          request.params.id,
          mode,
          typeof query.occurrence === 'string' ? query.occurrence : undefined,
          (request.body ?? {}) as CreateEventInput,
        ),
      );
    }),
  );
}

/**
 * Rutes de llistes senzilles.
 *
 * `PATCH /checklist-items/{id}` és la que pot disparar la cascada amunt: marcar
 * l'últim ítem marca la subtasca ancorada i, si tot està fet, la tasca (P1).
 */
export function registerChecklistRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id/checklists', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listChecklists(app.connection!.db, principal, request.params.id),
    ),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/checklists', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const created = await auditedTransaction(app.connection!.db, principal, (ctx) =>
        createChecklist(ctx, principal, request.params.id, {
          id: typeof body.id === 'string' ? body.id : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
          subtask_id: typeof body.subtask_id === 'string' ? body.subtask_id : undefined,
          show_completed_inline:
            typeof body.show_completed_inline === 'boolean'
              ? body.show_completed_inline
              : undefined,
        }),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/checklists/:id/items', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const created = await auditedTransaction(app.connection!.db, principal, (ctx) =>
        createChecklistItem(ctx, principal, request.params.id, {
          id: typeof body.id === 'string' ? body.id : undefined,
          text: typeof body.text === 'string' ? body.text : undefined,
          position: typeof body.position === 'string' ? body.position : undefined,
        }),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/checklist-items/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      return auditedTransaction(app.connection!.db, principal, (ctx) =>
        updateChecklistItem(ctx, principal, request.params.id, {
          text: typeof body.text === 'string' ? body.text : undefined,
          done: typeof body.done === 'boolean' ? body.done : undefined,
          position: typeof body.position === 'string' ? body.position : undefined,
        }),
      );
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/checklists/:id/pin', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(app.connection!.db, principal, (ctx) =>
        setPinned(ctx, principal, request.params.id, true),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/checklists/:id/pin', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(app.connection!.db, principal, (ctx) =>
        setPinned(ctx, principal, request.params.id, false),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.get('/api/v1/pinned-checklists', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listPinnedChecklists(app.connection!.db, principal),
    ),
  );
}
