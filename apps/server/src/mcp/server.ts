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
import type { Principal } from '../policy/principal.js';
import { claim, leaseOf, nextTask, release } from '../services/leases.js';
import { addComment, askUser } from '../services/comments.js';
import { listEventOccurrences } from '../services/events.js';
import { updateChecklistItem } from '../services/checklists.js';
import { listProjects, listScopes } from '../services/scopes.js';
import {
  completeTask,
  createTask,
  getTask,
  listTasks,
  moveTask,
  updateTask,
} from '../services/tasks.js';
import { assertCatalogue, TOOLS, type ToolSpec } from './tools.js';

export interface McpDeps {
  connection: Connection;
  principal: Principal;
  version: string;
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
 * Construeix el servidor amb les 17 tools registrades.
 *
 * El principal es fixa aquí i no per crida: cada petició HTTP construeix el seu servidor
 * amb el seu token resolt, que és el que fa que el mode sense estat funcioni sense cap
 * sessió al servidor (docs/08 §1).
 */
export function buildMcpServer(deps: McpDeps): McpServer {
  assertCatalogue();

  const server = new McpServer({ name: 'fem-ho', version: deps.version });
  const handlers = buildHandlers(deps);

  for (const spec of TOOLS) {
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
      return ok(briefing);
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

    create_task: async (args) =>
      ok(await write(async (ctx) => createTask(ctx, principal, args as never, engine))),

    update_task: async (args) =>
      ok(
        await write(async (ctx) =>
          updateTask(ctx, principal, String(args.task_id), {
            ...(typeof args.title === 'string' ? { title: args.title } : {}),
            ...(args.description === undefined
              ? {}
              : { description: args.description as string | null }),
            ...(args.due_date === undefined ? {} : { due_date: args.due_date as string | null }),
          }),
        ),
      ),

    move_task: async (args) =>
      ok(
        await write(async (ctx) =>
          moveTask(ctx, principal, String(args.task_id), {
            status: args.status as never,
            ...(typeof args.position === 'string' ? { position: args.position } : {}),
          }),
        ),
      ),

    complete_task: async (args) =>
      ok(await write(async (ctx) => completeTask(ctx, principal, String(args.task_id)))),

    add_comment: async (args) =>
      ok(
        await write(async (ctx) =>
          addComment(ctx, principal, String(args.task_id), String(args.body)),
        ),
      ),

    ask_user: async (args) =>
      ok(
        await write(async (ctx) =>
          askUser(ctx, principal, String(args.task_id), String(args.question)),
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
