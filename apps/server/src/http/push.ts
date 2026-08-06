/**
 * Rutes de notificacions push (docs/11).
 *
 * **Una sola ruta per als dos clients**: Web Push i UnifiedPush comparteixen RFC i
 * xifratge, i el que els distingeix és només el camp `platform`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { ensureVapidKeys, subscribe, unsubscribe } from '../services/notifications.js';
import { principalOf } from './auth.js';

async function handle<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (principal: Principal) => Promise<T>,
): Promise<T | undefined> {
  try {
    if (app.connection === undefined) throw unauthenticated('La instància no té base de dades.');
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

export function registerPushRoutes(app: FastifyInstance): void {
  /**
   * La clau pública.
   *
   * **És estable per sempre.** El client se la guarda i la fa servir per subscriure's;
   * si algun dia canviés, totes les subscripcions existents deixarien de funcionar
   * (docs/11 §2). Es genera un sol cop i no hi ha rotació.
   */
  app.get('/api/v1/push/public-key', async (request, reply) =>
    handle(app, request, reply, async () => {
      const keys = await ensureVapidKeys(app.connection!.db, new Date().toISOString());
      return { public_key: keys.publicKey };
    }),
  );

  app.post('/api/v1/push/subscriptions', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;

      if (
        typeof body.endpoint !== 'string' ||
        typeof body.p256dh !== 'string' ||
        typeof body.auth !== 'string'
      ) {
        throw new PolicyError(
          'invalid-subscription',
          'Invalid subscription',
          422,
          'Una subscripció necessita `endpoint`, `p256dh` i `auth`.',
        );
      }

      const result = await auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) =>
          subscribe(ctx, principal.userId, {
            endpoint: body.endpoint as string,
            p256dh: body.p256dh as string,
            auth: body.auth as string,
            platform: body.platform === 'android' ? 'android' : 'web',
            user_agent:
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : undefined,
          }),
        { engine: app.connection!.engine },
      );

      // 201 tant si s'ha creat com si s'ha actualitzat: pel client és el mateix, i ell
      // no ha de saber si el seu `endpoint` ja hi era.
      void reply.code(201);
      return { id: result.id };
    }),
  );

  app.delete('/api/v1/push/subscriptions', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const query = request.query as { endpoint?: string };
      if (typeof query.endpoint !== 'string') {
        throw new PolicyError(
          'endpoint-required',
          'Endpoint required',
          422,
          'Cal dir quin `endpoint` es dona de baixa.',
        );
      }

      await auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) => unsubscribe(ctx, principal.userId, query.endpoint!),
        { engine: app.connection!.engine },
      );
      void reply.code(204);
      return undefined;
    }),
  );
}
