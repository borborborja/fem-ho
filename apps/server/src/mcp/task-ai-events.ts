import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { auditedTransaction } from '../audit/audited-transaction.js';
import type { Connection } from '../db/connection.js';
import { PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import {
  assertAiSubscriptionAccess,
  removeSubscription,
  saveSubscription,
} from '../services/task-ai.js';
import {
  isWebhookSecret,
  TASK_EXECUTION_EVENT,
  verifyMcpCallback,
  webhookCallbackUrl,
} from '../services/task-ai-events.js';

export function isExecutionConnection(principal: Principal): principal is Principal & {
  credentialId: string;
  oauthSessionId: string;
} {
  return (
    principal.kind === 'user' &&
    principal.credentialType === 'oauth' &&
    principal.credentialId !== undefined &&
    principal.oauthSessionId !== undefined
  );
}

const uuidProperty = { type: 'string', format: 'uuid' };
const eventDefinition = {
  name: TASK_EXECUTION_EVENT,
  description:
    'A user clicked the AI action to send one task in the selected scope. Retrieve its context using get_task_execution_context and the execution_id.',
  delivery: ['webhook'],
  inputSchema: {
    type: 'object',
    required: ['scope_id'],
    properties: { scope_id: uuidProperty },
    additionalProperties: false,
  },
  payloadSchema: {
    type: 'object',
    required: ['scope_id', 'task_id', 'execution_id'],
    properties: { scope_id: uuidProperty, task_id: uuidProperty, execution_id: uuidProperty },
    additionalProperties: false,
  },
};

const eventList = z.object({
  method: z.literal('events/list'),
  params: z.object({ cursor: z.string().optional() }).optional(),
});

const eventIdentity = z.object({
  name: z.string(),
  arguments: z.strictObject({ scope_id: z.uuid() }),
  delivery: z.object({ mode: z.string(), url: z.string().max(4_096) }),
});

const subscribeRequest = z.object({
  method: z.literal('events/subscribe'),
  params: eventIdentity.extend({
    delivery: eventIdentity.shape.delivery.extend({ secret: z.string().max(96) }),
    ttlMs: z.number().int().positive().nullish(),
    cursor: z.string().nullish(),
  }),
});

const unsubscribeRequest = z.object({
  method: z.literal('events/unsubscribe'),
  params: eventIdentity,
});
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MIN_TTL_MS = 60_000;

function subscriptionIdentity(
  principal: Principal & { credentialId: string; oauthSessionId: string },
  params: z.infer<typeof eventIdentity>,
) {
  if (params.name !== TASK_EXECUTION_EVENT)
    throw new McpError(-32023, 'Unknown event.', { kind: 'event' });
  if (params.delivery.mode !== 'webhook')
    throw new McpError(-32026, 'Only webhook delivery is available.', { feature: 'deliveryMode' });
  const callbackUrl = webhookCallbackUrl(params.delivery.url);
  if (callbackUrl === undefined)
    throw new McpError(ErrorCode.InvalidParams, 'Invalid callback URL.');

  const scopeId = params.arguments.scope_id;
  // La mateixa adreça en un altre compte o connexió és una subscripció diferent.
  const key = JSON.stringify([
    principal.userId,
    principal.credentialId,
    principal.oauthSessionId,
    params.name,
    scopeId,
    callbackUrl,
  ]);
  const id = `sub_${createHash('sha256').update(key).digest('base64url')}`;
  return { id, scopeId, callbackUrl };
}

async function eventResult<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof PolicyError) {
      if (error.status === 429)
        throw new McpError(-32025, 'Subscription limit reached.', { limit: 'subscriptions' });
      throw new McpError(-32024, 'The connection cannot manage this subscription.');
    }
    throw new McpError(ErrorCode.InternalError, 'The event subscription could not be updated.');
  }
}

export function registerTaskAiEvents(
  server: McpServer,
  deps: {
    connection: Connection;
    instanceSecret: () => string;
    principal: Principal;
    reauthorize: () => Promise<Principal>;
  },
): void {
  const { connection, instanceSecret, principal, reauthorize } = deps;
  if (!isExecutionConnection(principal) || !hasCapability(principal, 'ai_executions:read')) return;
  const { db, engine } = connection;

  // L'SDK permet capacitats d'extensió i mètodes arbitraris en el servidor de baix nivell.
  // OpenAI descobreix `events` a primer nivell de l'initialize del transport que ja fem servir.
  const capabilities = { events: {} };
  server.server.registerCapabilities(
    capabilities as Parameters<typeof server.server.registerCapabilities>[0],
  );
  server.server.setRequestHandler(eventList, () => Promise.resolve({ events: [eventDefinition] }));
  server.server.setRequestHandler(subscribeRequest, ({ params }) =>
    eventResult(async () => {
      const identity = subscriptionIdentity(principal, params);
      const secret = params.delivery.secret;
      if (!isWebhookSecret(secret))
        throw new McpError(ErrorCode.InvalidParams, 'Provide a Standard Webhooks signing secret.');

      // Evita fins i tot el contacte de verificació quan el client no té permís de
      // l'àmbit. El servei torna a comprovar l'accés quan es desa.
      await assertAiSubscriptionAccess(db, principal, identity.scopeId);
      const reason = await verifyMcpCallback({ ...identity, subscriptionId: identity.id, secret });
      if (reason !== undefined)
        throw new McpError(-32015, 'Callback verification failed.', { reason });

      const ttl = Math.min(DEFAULT_TTL_MS, Math.max(MIN_TTL_MS, params.ttlMs ?? DEFAULT_TTL_MS));
      const expiresAt = new Date(Date.now() + ttl).toISOString();
      const current = await reauthorize();
      await auditedTransaction(
        db,
        current,
        (ctx) =>
          saveSubscription(ctx, current, { ...identity, secret, expiresAt }, instanceSecret()),
        { engine },
      );
      return { id: identity.id, refreshBefore: expiresAt, cursor: null, truncated: false };
    }),
  );
  server.server.setRequestHandler(unsubscribeRequest, ({ params }) =>
    eventResult(async () => {
      const { id } = subscriptionIdentity(principal, params);
      await auditedTransaction(db, principal, (ctx) => removeSubscription(ctx, principal, id), {
        engine,
      });
      return {};
    }),
  );
}
