/**
 * Rutes de notificacions push (docs/11).
 *
 * **Una sola ruta per als dos clients**: Web Push i UnifiedPush comparteixen RFC i
 * xifratge, i el que els distingeix és només el camp `platform`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { ensureVapidKeys, subscribe, unsubscribe } from '../services/notifications.js';
import {
  acknowledgePushActivity,
  bindPushActivitySubscription,
  getPushDeviceSettings,
  lockPushActivityDevice,
  notificationSession,
  pendingPushActivity,
  setPushDeviceSettings,
  setPushScopeSettings,
} from '../services/task-activity-notifications.js';
import { principalOf } from './auth.js';

async function handle<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (principal: Principal) => Promise<T>,
): Promise<T | undefined> {
  void reply.header('Cache-Control', 'no-store');
  try {
    if (app.connection === undefined) throw unauthenticated('The instance has no database.');
    return await work(await principalOf(app, request));
  } catch (error) {
    if (error instanceof PolicyError) {
      void reply
        .code(error.status)
        .type('application/problem+json')
        .send(error.toProblem(request.url.split('?')[0]));
      return undefined;
    }
    throw error;
  }
}

const deviceParams = z.object({ device_id: z.uuid() });
const scopeParams = deviceParams.extend({ scope_id: z.uuid() });
const deviceInput = z.strictObject({ platform: z.enum(['web', 'android']), enabled: z.boolean() });
const scopeInput = z
  .strictObject({
    task_created: z.boolean().optional(),
    status_changed: z.boolean().optional(),
    task_activity: z.boolean().optional(),
    inbox_entry: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
const activityAck = z.strictObject({ ids: z.array(z.uuid()).min(1).max(50) });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new PolicyError(
    'invalid-push-settings',
    'Invalid push settings',
    422,
    'Check the device, scope and notification settings.',
  );
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
      const deviceId = body.device_id === undefined ? undefined : parse(z.uuid(), body.device_id);

      if (
        typeof body.endpoint !== 'string' ||
        typeof body.p256dh !== 'string' ||
        typeof body.auth !== 'string'
      ) {
        throw new PolicyError(
          'invalid-subscription',
          'Invalid subscription',
          422,
          'A subscription needs `endpoint`, `p256dh` and `auth`.',
        );
      }

      const result = await auditedTransaction(
        app.connection!.db,
        principal,
        async (ctx) => {
          const platform = body.platform === 'android' ? 'android' : 'web';
          const device =
            deviceId === undefined
              ? undefined
              : await lockPushActivityDevice(ctx.tx, principal, deviceId);
          if (device && platform !== device.platform) {
            throw new PolicyError(
              'invalid-push-settings',
              'Invalid push settings',
              422,
              'The platform must match the device.',
            );
          }
          const subscription = await subscribe(ctx, principal.userId, {
            endpoint: body.endpoint as string,
            p256dh: body.p256dh as string,
            auth: body.auth as string,
            platform,
            activityOnly: device !== undefined,
            user_agent:
              typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']
                : undefined,
          });
          if (deviceId && device) {
            await bindPushActivitySubscription(ctx, deviceId, device, subscription.id);
          }
          return subscription;
        },
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
          'The `endpoint` being unsubscribed has to be given.',
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

  app.get('/api/v1/push/devices/:device_id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { device_id } = parse(deviceParams, request.params);
      return getPushDeviceSettings(app.connection!.db, principal, device_id);
    }),
  );

  app.put('/api/v1/push/devices/:device_id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { device_id } = parse(deviceParams, request.params);
      const input = parse(deviceInput, request.body);
      return auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) => setPushDeviceSettings(ctx, principal, device_id, input),
        { engine: app.connection!.engine },
      );
    }),
  );

  app.patch('/api/v1/push/devices/:device_id/scopes/:scope_id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      notificationSession(principal);
      const { device_id, scope_id } = parse(scopeParams, request.params);
      const input = parse(scopeInput, request.body);
      return auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) => setPushScopeSettings(ctx, principal, device_id, scope_id, input),
        { engine: app.connection!.engine },
      );
    }),
  );

  app.get('/api/v1/push/devices/:device_id/activity', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { device_id } = parse(deviceParams, request.params);
      return {
        items: await pendingPushActivity(
          app.connection!.db,
          principal,
          device_id,
          new Date().toISOString(),
        ),
      };
    }),
  );

  app.post('/api/v1/push/devices/:device_id/activity/ack', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { device_id } = parse(deviceParams, request.params);
      const input = parse(activityAck, request.body);
      await acknowledgePushActivity(app.connection!.db, principal, device_id, input.ids);
      void reply.code(204);
      return undefined;
    }),
  );
}
