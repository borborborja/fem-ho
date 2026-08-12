/**
 * Rutes d'agents d'IA i de reserves. docs/09, docs/05 §4.
 *
 * **Delegar no és assignar** (D5): `/ai/agents` gestiona la identitat de delegació, i
 * `/ai/tasks/{id}/claim` la reserva de treball. Són dues coses i tenen dues rutes.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { createToken, listTokens } from '../services/tokens.js';
import {
  agentCoverage,
  agentScopeAvailability,
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  setAgentScopes,
  updateAgent,
} from '../services/agents.js';
import { askUser } from '../services/comments.js';
import { listTasks } from '../services/tasks.js';
import { claim, leaseOf, nextTask, release } from '../services/leases.js';
import { body, handle, query, str } from './handle.js';

export function registerAgentRoutes(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get('/api/v1/ai/agents', async (request, reply) =>
    handle(app, request, reply, async (principal) => listAgents(db().db, principal)),
  );

  app.post('/api/v1/ai/agents', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createAgent(ctx, principal, {
          id: str(input.id),
          name: str(input.name),
          can_create_tasks:
            typeof input.can_create_tasks === 'boolean' ? input.can_create_tasks : undefined,
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.agent;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/ai/agents/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      getAgent(db().db, principal, request.params.id),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/ai/agents/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateAgent(ctx, principal, request.params.id, {
          name: str(input.name),
          can_create_tasks:
            typeof input.can_create_tasks === 'boolean' ? input.can_create_tasks : undefined,
          enabled: typeof input.enabled === 'boolean' ? input.enabled : undefined,
        }),
      );
    }),
  );

  /**
   * Els àmbits d'un agent.
   *
   * Va a part del `PATCH` de l'agent perquè és **una decisió d'una altra mena**: canviar el
   * nom no pot fallar per culpa d'un altre agent, i això sí. Barrejats, desar el nom
   * tornaria un 422 que parla d'àmbits.
   */
  app.put<{ Params: { id: string } }>('/api/v1/ai/agents/:id/scopes', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        setAgentScopes(ctx, principal, request.params.id, {
          scope_ids: Array.isArray(input.scope_ids)
            ? input.scope_ids.filter((id): id is string => typeof id === 'string')
            : [],
          all_scopes: input.all_scopes === true,
        }),
      );
    }),
  );

  /**
   * Les credencials d'un agent.
   *
   * **Va sota l'agent i no a `/tokens`** perquè aquí ja se sap de qui és: la ruta comprova
   * que l'agent sigui d'aquesta persona, i el servei de tokens rep l'identificador ja
   * validat. Per la porta general caldria acceptar-hi un agent qualsevol i tornar-lo a
   * comprovar allà, que és la mena de comprovació que un dia falta.
   *
   * Les capacitats són **les que un agent necessita i cap més**, i cadascuna té la seva
   * feina: les tasques i les llistes perquè pugui treballar, els àmbits i els projectes en
   * lectura perquè **les seves instruccions manen sobre el criteri de l'agent** i sense
   * poder-los llegir `get_briefing` responia «no tens la capacitat», els comentaris perquè
   * són la via principal per reportar i per preguntar (docs/09 §6), els adjunts en lectura
   * perquè el traspàs els porta com a enllaç, i el calendari en lectura perquè hi ha feina
   * que depèn del dia. Res de gestionar usuaris, ni tokens, ni la instància, ni el correu.
   *
   * **Els noms surten de `CAPABILITIES`.** Aquí hi havia un `calendar:read` que no existeix
   * enlloc: no donava cap error i el que feia era no donar cap permís de calendari.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/ai/agents/:id/credentials',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        const agent = await getAgent(db().db, principal, request.params.id);
        const input = body(request);

        const result = await auditedTransaction(db().db, principal, (ctx) =>
          createToken(ctx, principal, {
            name: str(input.name) ?? `${agent.name}`,
            capabilities: [
              'tasks:read',
              'tasks:write',
              // Les instruccions de l'àmbit i del projecte manen sobre el seu criteri, i
              // per llegir-les cal poder llegir els àmbits: sense això `get_briefing` —la
              // segona crida que fa un agent— responia «no tens la capacitat».
              'scopes:read',
              'projects:read',
              'checklists:read',
              'checklists:write',
              'comments:read',
              'comments:write',
              'attachments:read',
              'events:read',
            ],
            ai_agent_id: agent.id,
            expires_at: typeof input.expires_at === 'string' ? input.expires_at : null,
          }),
        );

        void reply.code(201);
        return result;
      }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/ai/agents/:id/credentials', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const agent = await getAgent(db().db, principal, request.params.id);
      const totes = await listTokens(db().db, principal);
      return { data: totes.filter((token) => token.ai_agent_id === agent.id) };
    }),
  );

  /** Quins àmbits pot marcar, i quins ja té un altre agent. Per a la pantalla. */
  app.get<{ Params: { id: string } }>(
    '/api/v1/ai/agents/:id/scope-availability',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => ({
        data: await agentScopeAvailability(db().db, principal, request.params.id),
      })),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/ai/agents/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      auditedTransaction(db().db, principal, (ctx) =>
        deleteAgent(ctx, principal, request.params.id),
      ),
    ),
  );

  // -------------------------------------------------------------- reserves

  /**
   * La següent tasca disponible, **ja reservada**.
   *
   * `nextTask` agafa la reserva de manera atòmica: tornar-la sense reservar convidaria
   * dos agents a agafar la mateixa, que és exactament el que les reserves eviten.
   */
  app.get('/api/v1/ai/next-task', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const found = await auditedTransaction(db().db, principal, (ctx) =>
        nextTask(ctx, principal, { scopeId: str(query(request).scope_id) }),
      );
      // `null` i no un 404: "ara no hi ha res a fer" és una resposta correcta, i un 404
      // faria que un agent que consulta cada minut ho llegís com un error de configuració.
      return { task: found ?? null };
    }),
  );

  /**
   * **Quins àmbits tenen agent.** Ho fa servir el tauler d'IA per dir, en el moment de
   * deixar-hi una tasca, que allà no la farà ningú.
   */
  app.get('/api/v1/ai/coverage', async (request, reply) =>
    handle(app, request, reply, async (principal) => ({
      data: await agentCoverage(db().db, principal),
    })),
  );

  /**
   * **Quantes tasques esperen resposta**, per al punt del commutador d'IA.
   *
   * Un recompte i els identificadors, i prou: la barra no ha de baixar-se les tasques
   * senceres per pintar un punt, i els identificadors hi són perquè qui vulgui saltar-hi
   * no hagi de buscar-les una per una.
   */
  app.get('/api/v1/ai/attention', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const found = await listTasks(db().db, principal, {
        needsAttention: true,
        statuses: ['inbox', 'todo', 'doing'],
        limit: 200,
      });
      return { count: found.data.length, task_ids: found.data.map((task) => task.id) };
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/ai/tasks/:id/claim', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      auditedTransaction(db().db, principal, (ctx) => claim(ctx, principal, request.params.id)),
    ),
  );

  app.post<{ Params: { id: string } }>('/api/v1/ai/tasks/:id/release', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      // El motiu és obligatori: una reserva alliberada sense dir per què deixa
      // l'historial amb un forat que ningú sabrà interpretar (docs/09 §5).
      await auditedTransaction(db().db, principal, (ctx) =>
        release(ctx, principal, request.params.id, String(body(request).reason ?? '')),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  /**
   * **La pregunta que atura l'agent.** Un comentari amb conseqüència: surt a la conversa i
   * a l'historial com tota la resta, i la tasca passa a demanar atenció. La tool `ask_user`
   * d'MCP és el mateix camí; això és perquè un agent que no parla MCP també hi arribi.
   */
  app.post<{ Params: { id: string } }>('/api/v1/ai/tasks/:id/ask-user', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const created = await auditedTransaction(db().db, principal, (ctx) =>
        askUser(ctx, principal, request.params.id, String(body(request).question ?? '')),
      );
      void reply.code(201);
      return created;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/ai/tasks/:id/lease', async (request, reply) =>
    handle(app, request, reply, async () => ({
      lease: (await leaseOf(db().db, request.params.id, new Date().toISOString())) ?? null,
    })),
  );
}
