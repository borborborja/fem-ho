/**
 * El servidor MCP.
 *
 * **Regla 8**: cap tool duplica lògica. Totes travessen la mateixa capa de servei que
 * l'API REST, amb el mateix principal i les mateixes capacitats. Un token d'IA i un
 * d'usuari passen exactament pel mateix codi.
 *
 * Els errors van a tres nivells, i confondre'ls fa que els agents entrin en bucle
 * (docs/08 §3):
 *
 * - Fallada de negoci o validació → **resultat de la tool marcat com a error**, amb text
 *   llegible. El model se'n recupera sol.
 * - Tool desconeguda o petició mal formada → error de protocol. Ho fa l'SDK.
 * - Autenticació o permisos → **`401` o `403` d'HTTP**, mai cap dels dos anteriors. Ho
 *   fa `http/mcp.ts` abans d'arribar aquí.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { auditedTransaction } from '../audit/audited-transaction.js';
import type { Connection } from '../db/connection.js';
import { PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { claim, leaseOf, nextTask, release } from '../services/leases.js';
import { recentTakeOvers } from '../services/activity.js';
import { addComment, askUser, resumeTask } from '../services/comments.js';
import { listEventOccurrences } from '../services/events.js';
import { updateChecklistItem } from '../services/checklists.js';
import { listProjects, listScopes } from '../services/scopes.js';
import { deliverTaskAttachment } from '../services/attachments.js';
import { getTaskContext, hasTaskContext } from '../services/task-context.js';
import {
  createDeliveredTask,
  moveDeliveredTask,
  taskMutationReceipt,
  updateDeliveredTask,
} from '../services/task-delivery.js';
import { completeTask, getTask, listTasks } from '../services/tasks.js';
import { assertCatalogue, TOOLS, type ToolSpec } from './tools.js';
import type { Capability } from '../policy/capabilities.js';

export interface McpDeps {
  connection: Connection;
  principal: Principal;
  version: string;
  dataDir: string;
  maxUploadBytes: number;
  reauthorize: () => Promise<Principal>;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Un error que el model ha de poder llegir i corregir.
 *
 * El text ha de ser **accionable**: "Aquest token només té accés a l'àmbit Feina" i no
 * "no autoritzat". Un missatge mut fa que l'agent reintenti fins a esgotar el límit.
 */
function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Construeix el servidor amb les eines que permet la credencial.
 *
 * El principal es fixa aquí i no per crida: cada petició HTTP construeix el seu servidor
 * amb el seu token resolt, que és el que fa que el mode sense estat funcioni sense cap
 * sessió al servidor (docs/08 §1).
 */
export function buildMcpServer(deps: McpDeps): McpServer {
  assertCatalogue();

  const server = new McpServer({ name: 'fem-ho', version: deps.version });
  const handlers = buildHandlers(deps);
  const required: Record<string, Capability[]> = {
    whoami: [],
    list_scopes: ['scopes:read'],
    list_projects: ['projects:read'],
    list_events: ['events:read'],
    list_tasks: ['tasks:read'],
    get_task: ['tasks:read'],
    search_tasks: ['tasks:read'],
    get_briefing: ['scopes:read', 'projects:read', 'tasks:read'],
    create_task: ['tasks:create'],
    update_task: ['tasks:update'],
    move_task: ['tasks:move'],
    complete_task: ['tasks:move'],
    add_comment: ['comments:write'],
    ask_user: ['comments:write', 'tasks:write'],
    resume_task: ['comments:write', 'tasks:write'],
    update_checklist_item: ['checklists:write'],
    next_task: ['tasks:read', 'tasks:write'],
    release_task: ['tasks:write'],
  };

  for (const spec of TOOLS) {
    const requiredCapabilities = required[spec.name];
    const allowed =
      spec.name === 'add_task_attachment'
        ? hasCapability(deps.principal, 'tasks:attach') ||
          hasCapability(deps.principal, 'attachments:write')
        : spec.name === 'get_task_context'
          ? hasTaskContext(deps.principal)
          : requiredCapabilities?.every((c) => hasCapability(deps.principal, c)) === true;
    if (!allowed) continue;
    if (
      ['next_task', 'release_task', 'ask_user', 'resume_task'].includes(spec.name) &&
      deps.principal.kind !== 'agent'
    )
      continue;
    const handler = handlers[spec.name];
    if (handler === undefined) {
      throw new Error(`La tool "${spec.name}" és al catàleg però no té implementació.`);
    }
    registerOne(server, spec, handler);
  }

  return server;
}

function registerOne(
  server: McpServer,
  spec: ToolSpec,
  handler: (args: Record<string, unknown>) => Promise<ToolResult>,
): void {
  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      annotations: spec.annotations,
    },
    (async (args: Record<string, unknown>) => {
      try {
        return await handler(args);
      } catch (error) {
        /**
         * Una fallada de permisos **no** arriba fins aquí com a resultat d'error: es
         * converteix en el text llegible, però el `403` que el client necessita el dona
         * la capa HTTP. Aquí es fa el millor que es pot fer un cop la crida ja ha
         * començat: dir-li a l'agent exactament què li falta.
         */
        if (error instanceof PolicyError) return fail(error.detail ?? error.title);
        return fail(`No s'ha pogut fer: ${String(error)}`);
      }
    }) as never,
  );
}

function buildHandlers(
  deps: McpDeps,
): Record<string, (args: Record<string, unknown>) => Promise<ToolResult>> {
  const { db } = deps.connection;
  const { principal } = deps;
  const engine = deps.connection.engine;
  const write = <T>(work: Parameters<typeof auditedTransaction<T>>[2]): Promise<T> =>
    auditedTransaction(db, principal, work, { engine });

  return {
    whoami: async () =>
      ok({
        kind: principal.kind,
        user_id: principal.userId,
        agent_id: principal.agentId ?? null,
        capabilities: [...principal.capabilities].sort(),
        // **Quins àmbits veu.** Sense això l'agent prova a cegues i acumula 403.
        scope_ids:
          principal.scopeIds === null ? 'tots els del propietari' : [...principal.scopeIds],
        source: principal.source,
      }),

    get_briefing: async (args) => {
      const scopes = await listScopes(db, principal);
      const filtered =
        typeof args.scope_id === 'string' ? scopes.filter((s) => s.id === args.scope_id) : scopes;

      // Una sola crida en comptes de sis: àmbits amb instruccions, projectes, i què hi
      // ha pendent i delegat a cadascun.
      const briefing = [];
      for (const scope of filtered) {
        const projects = await listProjects(db, principal, scope.id);
        const pending = await listTasks(db, principal, { scopeId: scope.id, statuses: ['todo'] });
        const totes = await listTasks(db, principal, { scopeId: scope.id });
        briefing.push({
          scope: { id: scope.id, name: scope.name, ai_instructions: scope.ai_instructions },
          projects: projects.map((project) => ({ id: project.id, name: project.name })),
          pending: pending.data.length,
          delegated: totes.data.filter((task) => task.ai_mode === 'delegated').length,
        });
      }

      /**
       * **El que t'han reclamat.** Un protocol de consulta no té timbre: sense això,
       * assabentar-se que una tasca ja no és teva vol dir descobrir-ho quan la teva
       * escriptura falla, després d'haver-hi treballat una estona.
       */
      const ahir = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      const takenOver = await recentTakeOvers(db, principal, ahir);

      return ok({ scopes: briefing, taken_over: takenOver });
    },

    list_scopes: async () => ok(await listScopes(db, principal)),
    list_projects: async (args) =>
      ok(
        await listProjects(
          db,
          principal,
          typeof args.scope_id === 'string' ? args.scope_id : undefined,
        ),
      ),

    list_tasks: async (args) =>
      ok(
        await listTasks(db, principal, {
          ...(typeof args.scope_id === 'string' ? { scopeId: args.scope_id } : {}),
          ...(typeof args.project_id === 'string' ? { projectId: args.project_id } : {}),
          ...(typeof args.status === 'string' ? { statuses: [args.status as never] } : {}),
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
          ...(typeof args.cursor === 'string' ? { cursor: args.cursor } : {}),
        }),
      ),
    get_task: async (args) => ok(await getTask(db, principal, String(args.task_id))),

    get_task_context: async (args) =>
      ok(
        await getTaskContext(
          db,
          principal,
          typeof args.scope_id === 'string' ? args.scope_id : undefined,
        ),
      ),

    search_tasks: async (args) => {
      const query = String(args.query ?? '').trim();
      if (query === '') return fail('La cerca necessita un text.');
      return ok(
        await listTasks(db, principal, {
          ...(typeof args.scope_id === 'string' ? { scopeId: args.scope_id } : {}),
          search: query,
        }),
      );
    },

    list_events: async (args) => {
      // `from` i `to` són obligatoris: sense finestra, un calendari amb repeticions no
      // té un nombre finit d'esdeveniments (docs/08 §3).
      if (typeof args.from !== 'string' || typeof args.to !== 'string') {
        return fail(
          '`list_events` necessita `from` i `to`: sense finestra, un calendari amb repeticions no acaba mai.',
        );
      }
      return ok(
        await listEventOccurrences(db, principal, {
          from: args.from,
          to: args.to,
          ...(typeof args.scope_id === 'string' ? { scopeId: args.scope_id } : {}),
        } as never),
      );
    },

    create_task: async (args) => {
      const { task, created } = await write((ctx) =>
        createDeliveredTask(ctx, principal, args, engine),
      );
      return ok({ task: taskMutationReceipt(principal, task), created });
    },

    update_task: async ({ task_id, ...input }) => {
      const task = await write((ctx) =>
        updateDeliveredTask(ctx, principal, String(task_id), input),
      );
      return ok(taskMutationReceipt(principal, task));
    },

    move_task: async ({ task_id, ...input }) => {
      const task = await write((ctx) => moveDeliveredTask(ctx, principal, String(task_id), input));
      return ok(taskMutationReceipt(principal, task));
    },

    complete_task: async (args) => {
      const task = await write((ctx) => completeTask(ctx, principal, String(args.task_id)));
      return ok(taskMutationReceipt(principal, task));
    },

    add_comment: async (args) =>
      ok(
        await write(async (ctx) =>
          addComment(ctx, principal, String(args.task_id), String(args.body)),
        ),
      ),

    add_task_attachment: async (args) => {
      const { url, content_base64: contentBase64 } = args;
      if ((typeof url === 'string') === (typeof contentBase64 === 'string')) {
        return fail('Provide exactly one of url or content_base64.');
      }
      return ok(
        await deliverTaskAttachment(
          deps.connection,
          principal,
          {
            taskId: String(args.task_id),
            id: String(args.id),
            filename: String(args.filename),
            isAiContext: args.ai_context === true,
            ...(typeof url === 'string' ? { url } : { contentBase64: String(contentBase64) }),
          },
          {
            dataDir: deps.dataDir,
            maxUploadBytes: deps.maxUploadBytes,
            reauthorize: deps.reauthorize,
          },
        ),
      );
    },

    ask_user: async (args) =>
      ok(
        await write(async (ctx) =>
          askUser(ctx, principal, String(args.task_id), String(args.question)),
        ),
      ),

    resume_task: async (args) =>
      ok(
        await write(async (ctx) =>
          resumeTask(ctx, principal, String(args.task_id), String(args.learned)),
        ),
      ),

    update_checklist_item: async (args) =>
      ok(
        await write(async (ctx) =>
          updateChecklistItem(ctx, principal, String(args.item_id), { done: args.done === true }),
        ),
      ),

    next_task: async (args) =>
      ok(
        await write(async (ctx) => {
          const found = await nextTask(ctx, principal, {
            ...(typeof args.scope_id === 'string' ? { scopeId: args.scope_id } : {}),
          });
          if (found === undefined) {
            return { task: null, reason: 'Ara mateix no hi ha cap tasca delegada disponible.' };
          }
          const task = await getTask(ctx.tx, principal, found.taskId);
          return { task, lease_expires_at: found.lease.expiresAt };
        }),
      ),

    release_task: async (args) => {
      await write(async (ctx) => {
        await release(ctx, principal, String(args.task_id), String(args.reason ?? ''));
      });
      return ok({ released: args.task_id });
    },
  };
}

/** Es reexporta perquè les rutes HTTP i les proves no hagin d'anar a buscar-ho. */
export { assertCatalogue, TOOLS, claim, leaseOf };
