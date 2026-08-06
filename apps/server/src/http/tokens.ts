/**
 * Rutes de tokens d'API, mode d'IA i historial (docs/05 §2, docs/09 §2 i §7).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { listActivity, undo, type ActorFilter } from '../services/activity.js';
import { updateTask } from '../services/tasks.js';
import { createToken, listTokens, revokeToken } from '../services/tokens.js';
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

export function registerTokenRoutes(app: FastifyInstance): void {
  app.get('/api/v1/tokens', async (request, reply) =>
    handle(app, request, reply, async (principal) => ({
      data: await listTokens(app.connection!.db, principal),
    })),
  );

  app.post('/api/v1/tokens', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) =>
          createToken(ctx, principal, {
            name: String(body.name ?? ''),
            capabilities: Array.isArray(body.capabilities) ? (body.capabilities as string[]) : [],
            scope_ids: Array.isArray(body.scope_ids) ? (body.scope_ids as string[]) : undefined,
            expires_at: typeof body.expires_at === 'string' ? body.expires_at : null,
          }),
        { engine: app.connection!.engine },
      );

      /**
       * **El token sencer va aquí i enlloc més.** No es pot recuperar del hash, i qui el
       * rep ho ha de saber en aquest moment: la interfície ho diu al costat.
       */
      void reply.code(201);
      return result;
    }),
  );

  app.delete('/api/v1/tokens/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { id } = request.params as { id: string };
      await auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) => revokeToken(ctx, principal, id),
        { engine: app.connection!.engine },
      );
      void reply.code(204);
      return undefined;
    }),
  );

  app.post('/api/v1/tasks/:id/ai-mode', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as { ai_mode?: string };
      const mode = body.ai_mode;

      if (mode !== 'manual' && mode !== 'assisted' && mode !== 'delegated') {
        throw new PolicyError(
          'invalid-ai-mode',
          'Invalid AI mode',
          422,
          'The mode has to be `manual`, `assisted` or `delegated` (docs/09 §2).',
        );
      }

      return auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) => updateTask(ctx, principal, id, { ai_mode: mode }),
        { engine: app.connection!.engine },
      );
    }),
  );

  app.get('/api/v1/tasks/:id/activity', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { id } = request.params as { id: string };
      const query = request.query as { actor?: string };
      const actor: ActorFilter =
        query.actor === 'ai' || query.actor === 'human' ? query.actor : 'all';

      return { data: await listActivity(app.connection!.db, principal, id, { actor }) };
    }),
  );

  /**
   * Desfer un canvi autònom.
   *
   * No és `DELETE`: **no s'esborra res de l'historial** (docs/09 §7). Es crea un canvi
   * invers, que també hi queda.
   */
  app.post('/api/v1/activity/:id/undo', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { id } = request.params as { id: string };
      await auditedTransaction(app.connection!.db, principal, (ctx) => undo(ctx, principal, id), {
        engine: app.connection!.engine,
      });
      void reply.code(204);
      return undefined;
    }),
  );
}
