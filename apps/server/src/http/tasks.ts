/**
 * Rutes de tasques, subtasques, calendaris i llistes senzilles.
 *
 * Els handlers són prims a posta: **la decisió viu a la capa de servei** (regla 8).
 * Aquí només es tradueix HTTP a principal, es crida el servei, i es tradueix el
 * resultat o l'error de tornada.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { FastifyInstance } from 'fastify';
import type { TaskStatus } from '@fem-ho/contracts';
import { TASK_STATUSES, parseQuickAdd } from '@fem-ho/contracts';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { seal } from '../crypto/secret-box.js';
import { addComment, listComments } from '../services/comments.js';
import {
  createChecklist,
  createChecklistItem,
  deleteChecklist,
  deleteChecklistItem,
  getChecklist,
  listChecklists,
  listPinnedChecklists,
  setPinned,
  updateChecklist,
  updateChecklistItem,
} from '../services/checklists.js';
import {
  createCalendar,
  createEvent,
  deleteCalendar,
  deleteEvent,
  getEvent,
  listCalendars,
  listEventOccurrences,
  setEventInboxVisibility,
  updateCalendar,
  updateEvent,
  type CreateEventInput,
  type SeriesMode,
} from '../services/events.js';
import { setTaskLabel } from '../services/labels.js';
import { listProjects, listScopes } from '../services/scopes.js';
import { createSubtask, deleteSubtask, listSubtasks, updateSubtask } from '../services/subtasks.js';
import {
  completeTask,
  createTask,
  deleteTask,
  getBoard,
  getDashboard,
  getInbox,
  getTask,
  listTasks,
  moveTask,
  setAssignee,
  updateTask,
} from '../services/tasks.js';
import { isMailbox, type Mailbox } from '../policy/mailbox.js';
import { getProfile, getSettings } from '../services/users.js';
import { body, bool, handle, ids, nullable, num, query, str, today } from './handle.js';

function parseStatuses(raw: unknown): TaskStatus[] | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  // Els valors múltiples se separen per comes (docs/05 §3).
  const parts = raw.split(',').map((s) => s.trim());
  const valid = parts.filter((s): s is TaskStatus =>
    (TASK_STATUSES as readonly string[]).includes(s),
  );
  return valid.length > 0 ? valid : undefined;
}

function parseSeriesMode(raw: unknown): SeriesMode {
  return raw === 'future' || raw === 'all' ? raw : 'single';
}

/** `caldav`, `ical` o `rss`; qualsevol altra cosa no és una font que sapiguem llegir. */
function sourceKind(value: unknown): 'caldav' | 'ical' | 'rss' | undefined {
  return value === 'caldav' || value === 'ical' || value === 'rss' ? value : undefined;
}

export function registerTaskRoutes(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get('/api/v1/tasks', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      return listTasks(db().db, principal, {
        scopeId: str(q.scope_id),
        projectId: str(q.project_id),
        statuses: parseStatuses(q.status),
        limit: num(q.limit),
        cursor: str(q.cursor),
        search: str(q.q),
      });
    }),
  );

  app.post('/api/v1/tasks', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createTask(
          ctx,
          principal,
          {
            id: str(input.id),
            scope_id: str(input.scope_id),
            project_id: str(input.project_id),
            title: str(input.title),
            description: str(input.description),
            status: parseStatuses(input.status)?.[0],
            position: str(input.position),
            due_date: str(input.due_date),
            due_time: str(input.due_time),
            assignee_ids: Array.isArray(input.assignee_ids)
              ? input.assignee_ids.filter((v): v is string => typeof v === 'string')
              : undefined,
          },
          db().engine,
        ),
      );
      void reply.code(result.created ? 201 : 200);
      return result.task;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      getTask(db().db, principal, request.params.id),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/tasks/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateTask(ctx, principal, request.params.id, {
          title: str(input.title),
          description: nullable(input, 'description'),
          due_date: nullable(input, 'due_date'),
          due_time: nullable(input, 'due_time'),
          deadline: nullable(input, 'deadline'),
          project_id: nullable(input, 'project_id'),
          rrule: nullable(input, 'rrule'),
          recurrence_mode:
            input.recurrence_mode === 'schedule' || input.recurrence_mode === 'completion'
              ? input.recurrence_mode
              : undefined,
          ai_mode:
            input.ai_mode === 'manual' ||
            input.ai_mode === 'assisted' ||
            input.ai_mode === 'delegated'
              ? input.ai_mode
              : undefined,
          ai_instructions: nullable(input, 'ai_instructions'),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/tasks/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteTask(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/move', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        moveTask(ctx, principal, request.params.id, {
          status: parseStatuses(input.status)?.[0],
          position: str(input.position),
          before_id: str(input.before_id) ?? null,
          after_id: str(input.after_id) ?? null,
        }),
      );
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/complete', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      auditedTransaction(db().db, principal, (ctx) =>
        completeTask(ctx, principal, request.params.id),
      ),
    ),
  );

  app.post<{ Params: { id: string; userId: string } }>(
    '/api/v1/tasks/:id/assignees/:userId',
    async (request, reply) =>
      handle(app, request, reply, async (principal) =>
        auditedTransaction(db().db, principal, (ctx) =>
          setAssignee(ctx, principal, request.params.id, request.params.userId, true),
        ),
      ),
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    '/api/v1/tasks/:id/assignees/:userId',
    async (request, reply) =>
      handle(app, request, reply, async (principal) =>
        auditedTransaction(db().db, principal, (ctx) =>
          setAssignee(ctx, principal, request.params.id, request.params.userId, false),
        ),
      ),
  );

  app.post<{ Params: { id: string; labelId: string } }>(
    '/api/v1/tasks/:id/labels/:labelId',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        await auditedTransaction(db().db, principal, (ctx) =>
          setTaskLabel(ctx, principal, request.params.id, request.params.labelId, true),
        );
        void reply.code(204).send();
        return undefined;
      }),
  );

  app.delete<{ Params: { id: string; labelId: string } }>(
    '/api/v1/tasks/:id/labels/:labelId',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        await auditedTransaction(db().db, principal, (ctx) =>
          setTaskLabel(ctx, principal, request.params.id, request.params.labelId, false),
        );
        void reply.code(204).send();
        return undefined;
      }),
  );

  // --------------------------------------------------------------- subtasques

  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id/subtasks', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listSubtasks(db().db, principal, request.params.id),
    ),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/subtasks', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const created = await auditedTransaction(db().db, principal, (ctx) =>
        createSubtask(ctx, principal, request.params.id, {
          id: str(input.id),
          title: str(input.title),
          position: str(input.position),
        }),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/subtasks/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateSubtask(ctx, principal, request.params.id, {
          title: str(input.title),
          done: typeof input.done === 'boolean' ? input.done : undefined,
          position: str(input.position),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/subtasks/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteSubtask(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  // -------------------------------------------------------------- comentaris

  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id/comments', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listComments(db().db, principal, request.params.id),
    ),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/comments', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const created = await auditedTransaction(db().db, principal, (ctx) =>
        addComment(ctx, principal, request.params.id, String(body(request).body ?? '')),
      );
      void reply.code(201);
      return created;
    }),
  );

  // ------------------------------------------------------------------ vistes

  app.get('/api/v1/board', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      return getBoard(db().db, principal, {
        scopeIds: ids(q.scope_ids),
        projectId: str(q.project_id),
      });
    }),
  );

  /** Un valor inventat cau a `undefined` i mana la preferència; mai canvia res en silenci. */
  const parseMailbox = (value: string | undefined): Mailbox | undefined =>
    isMailbox(value) ? value : undefined;

  app.get('/api/v1/inbox', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      // Sense `date`, el dia és avui **al fus de qui pregunta**, no al del servidor: un
      // servidor a UTC i una casa a Madrid no coincideixen dues hores cada nit.
      const profile = await getProfile(db().db, principal.userId);
      return getInbox(db().db, principal, {
        date: str(q.date) ?? today(profile.timezone),
        includeOverdue: bool(q.include_overdue) ?? true,
        scopeIds: ids(q.scope_ids),
        // I el mateix fus serveix per tallar el dia dels esdeveniments, que són instants
        // i no dates.
        timezone: profile.timezone,
        // Sense paràmetre, el calaix és la preferència de l'usuari. Un valor inventat
        // cau a `all`, que és el comportament de sempre.
        mailbox:
          parseMailbox(str(q.mailbox)) ??
          (await getSettings(db().db, principal.userId)).inbox_origin,
      });
    }),
  );

  app.get('/api/v1/dashboard', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const profile = await getProfile(db().db, principal.userId);
      return getDashboard(db().db, principal, {
        date: str(query(request).date) ?? today(profile.timezone),
      });
    }),
  );

  /**
   * `POST /parse` — el mateix parser que fan servir la web i Android.
   *
   * Existeix per a clients que no en poden portar un —una integració, un agent, un
   * script— i **no** perquè els clients hi deleguin: el camp d'afegida ràpida ha de
   * pintar els xips mentre s'escriu, i una petició per tecla no és una opció (D12).
   *
   * A la v1 només sigils. El parseig de dates en català arriba a la v1.1 sense canviar
   * la forma d'aquest endpoint, que és tota la raó de definir-lo ara.
   */
  app.post('/api/v1/parse', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const scopes = await listScopes(db().db, principal);
      const projects = await listProjects(db().db, principal);
      const people = await sql<{ id: string; name: string }>`
        SELECT id, name FROM users WHERE deleted_at IS NULL AND kind = 'human' ORDER BY name, id
      `.execute(db().db);

      const active = ids(input.active_scope_ids) ?? scopes.map((s) => s.id);
      return parseQuickAdd(String(input.text ?? ''), {
        scopes: scopes.map((scope) => ({
          id: scope.id,
          name: scope.name,
          projects: projects
            .filter((project) => project.scope_id === scope.id)
            .map((project) => ({ id: project.id, name: project.name })),
        })),
        people: people.rows,
        activeScopeIds: active,
      });
    }),
  );

  /**
   * `GET /search?q=`.
   *
   * És `listTasks` amb el filtre de text, i no una consulta pròpia, perquè la
   * normalització catalana de `search_text` (docs/01 §11) s'ha d'aplicar exactament amb
   * la mateixa funció que la va generar. Dues implementacions divergirien justament en
   * les paraules per a les quals existeix: "col·legi", "Barça", "l'aigua".
   */
  app.get('/api/v1/search', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      return listTasks(db().db, principal, {
        search: str(q.q) ?? '',
        scopeId: str(q.scope_id),
        statuses: parseStatuses(q.status),
        limit: num(q.limit),
        cursor: str(q.cursor),
      });
    }),
  );
}

/**
 * Rutes d'esdeveniments i calendaris.
 *
 * **Un esdeveniment no és una tasca** (D8) i no surt mai al kanban.
 */
export function registerEventRoutes(app: FastifyInstance, secret: () => string): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get('/api/v1/calendars', async (request, reply) =>
    handle(app, request, reply, async (principal) => listCalendars(db().db, principal)),
  );

  app.post('/api/v1/calendars', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      /**
       * L'identificador es fixa **abans** de xifrar.
       *
       * El secret de la contrasenya es lliga a `calendar:<id>` (és el que fa servir el
       * refresc per obrir-lo), o sigui que si el servei en generés un altre després,
       * la contrasenya no es podria desxifrar mai més i la font fallaria en silenci.
       */
      const calendarId = str(input.id) ?? uuidv7();
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createCalendar(ctx, principal, {
          id: calendarId,
          scope_id: str(input.scope_id),
          project_id: nullable(input, 'project_id'),
          name: str(input.name),
          color: str(input.color),
          kind: input.kind === 'todos' ? 'todos' : 'events',
          origin: input.origin === 'subscription' ? 'subscription' : 'local',
          source_kind: sourceKind(input.source_kind),
          source_url: str(input.source_url),
          source_username: str(input.source_username),
          /**
           * **La contrasenya es xifra aquí i no viatja mai més.**
           *
           * `docs/07` §9 la vol xifrada en repòs. Es segella a la ruta i no al servei
           * perquè el secret de la instància és de l'app: el servei no ha de conèixer
           * ni la configuració ni el disc.
           */
          source_secret_enc:
            typeof input.source_secret === 'string' && input.source_secret !== ''
              ? seal(secret(), `calendar:${calendarId}`, input.source_secret)
              : undefined,
          writable: input.writable === true,
          refresh_interval: num(input.refresh_interval),
          strip_alarms: typeof input.strip_alarms === 'boolean' ? input.strip_alarms : undefined,
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.calendar;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/calendars/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateCalendar(ctx, principal, request.params.id, {
          name: str(input.name),
          color: nullable(input, 'color'),
          source_url: str(input.source_url),
          source_username: str(input.source_username),
          // Una contrasenya buida vol dir "no la toquis", no "esborra-la": el formulari
          // no la torna a ensenyar mai i desar el nom no ha de perdre les credencials.
          source_secret_enc:
            typeof input.source_secret === 'string' && input.source_secret !== ''
              ? seal(secret(), `calendar:${request.params.id}`, input.source_secret)
              : undefined,
          writable: typeof input.writable === 'boolean' ? input.writable : undefined,
          refresh_interval:
            'refresh_interval' in input ? (num(input.refresh_interval) ?? null) : undefined,
          strip_alarms: typeof input.strip_alarms === 'boolean' ? input.strip_alarms : undefined,
          shared_with_scope:
            typeof input.shared_with_scope === 'boolean' ? input.shared_with_scope : undefined,
          /**
           * Tri-estat, i per això es mira si la clau **hi és** i no només el seu tipus:
           * `{ inbox_visible: null }` vol dir "treu l'excepció" i s'ha de distingir de no
           * enviar-la, que vol dir "no ho toquis". El mateix patró que `refresh_interval`.
           */
          inbox_visible:
            'inbox_visible' in input
              ? typeof input.inbox_visible === 'boolean'
                ? input.inbox_visible
                : null
              : undefined,
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/calendars/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteCalendar(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.get('/api/v1/events', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      return listEventOccurrences(db().db, principal, {
        from: str(q.from) ?? '',
        to: str(q.to) ?? '',
        scopeIds: ids(q.scope_ids),
      });
    }),
  );

  /**
   * Marcar un esdeveniment com a visible o amagat a la bústia de qui ho demana.
   *
   * **Amb cos i no amb l'uid al camí, i és deliberat.** L'uid d'un ítem d'RSS és
   * `"<calendarId>-<itemId>"` i l'itemId pot ser una URL sencera amb barres i signes
   * d'interrogació (`dav/rss.ts`). Posar-lo en un segment de ruta és doble descodificació
   * i 404 que ningú entén — la lliçó que aquest repositori ja va pagar amb els `href` de
   * DAV.
   */
  app.post('/api/v1/inbox/events', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = (request.body ?? {}) as Record<string, unknown>;
      return auditedTransaction(db().db, principal, (ctx) =>
        setEventInboxVisibility(ctx, principal, principal.userId, {
          calendarId: str(input.calendar_id) ?? '',
          uid: str(input.uid) ?? '',
          recurrenceId: str(input.recurrence_id) ?? null,
          // Absent o nul volen dir el mateix aquí: treu la marca.
          visible: typeof input.visible === 'boolean' ? input.visible : null,
        }),
      );
    }),
  );

  app.post('/api/v1/events', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createEvent(ctx, principal, body(request) as CreateEventInput),
      );
      void reply.code(result.created ? 201 : 200);
      return result.event;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/events/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      getEvent(db().db, principal, request.params.id),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/events/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateEvent(
          ctx,
          principal,
          request.params.id,
          parseSeriesMode(q.series_mode),
          str(q.occurrence),
          body(request) as CreateEventInput,
        ),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/events/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteEvent(
          ctx,
          principal,
          request.params.id,
          parseSeriesMode(q.series_mode),
          str(q.occurrence),
        ),
      );
      void reply.code(204).send();
      return undefined;
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
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get<{ Params: { id: string } }>('/api/v1/tasks/:id/checklists', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listChecklists(db().db, principal, request.params.id),
    ),
  );

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/checklists', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const created = await auditedTransaction(db().db, principal, (ctx) =>
        createChecklist(ctx, principal, request.params.id, {
          id: str(input.id),
          name: str(input.name),
          subtask_id: str(input.subtask_id),
          show_completed_inline:
            typeof input.show_completed_inline === 'boolean'
              ? input.show_completed_inline
              : undefined,
        }),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/checklists/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      getChecklist(db().db, principal, request.params.id),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/checklists/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateChecklist(ctx, principal, request.params.id, {
          name: str(input.name),
          show_completed_inline:
            typeof input.show_completed_inline === 'boolean'
              ? input.show_completed_inline
              : undefined,
          subtask_id: nullable(input, 'subtask_id'),
          position: str(input.position),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/checklists/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteChecklist(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/checklists/:id/items', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const view = await getChecklist(db().db, principal, request.params.id);
      return view.items;
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/checklists/:id/items', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const created = await auditedTransaction(db().db, principal, (ctx) =>
        createChecklistItem(ctx, principal, request.params.id, {
          id: str(input.id),
          text: str(input.text),
          position: str(input.position),
        }),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/checklist-items/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateChecklistItem(ctx, principal, request.params.id, {
          text: str(input.text),
          done: typeof input.done === 'boolean' ? input.done : undefined,
          position: str(input.position),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/checklist-items/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteChecklistItem(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/checklists/:id/pin', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        setPinned(ctx, principal, request.params.id, true),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/checklists/:id/pin', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        setPinned(ctx, principal, request.params.id, false),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.get('/api/v1/pinned-checklists', async (request, reply) =>
    handle(app, request, reply, async (principal) => listPinnedChecklists(db().db, principal)),
  );
}
