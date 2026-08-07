/**
 * Rutes d'agents d'IA i de reserves. docs/09, docs/05 §4.
 *
 * **Delegar no és assignar** (D5): `/ai/agents` gestiona la identitat de delegació, i
 * `/ai/tasks/{id}/claim` la reserva de treball. Són dues coses i tenen dues rutes.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { createAgent, deleteAgent, getAgent, listAgents, updateAgent } from '../services/agents.js';
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
