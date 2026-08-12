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
  agentScopeAvailability,
  createAgent,
  deleteAgent,
  getAgent,
  listAgents,
  setAgentScopes,
  updateAgent,
} from '../services/agents.js';
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
   * Les capacitats són **les que un agent necessita i cap més**: llegir i escriure tasques
   * i llegir el calendari. Res de gestionar usuaris, ni tokens, ni la instància.
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
            capabilities: ['tasks:read', 'tasks:write', 'calendar:read'],
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

  app.get<{ Params: { id: string } }>('/api/v1/ai/tasks/:id/lease', async (request, reply) =>
    handle(app, request, reply, async () => ({
      lease: (await leaseOf(db().db, request.params.id, new Date().toISOString())) ?? null,
    })),
  );
}
