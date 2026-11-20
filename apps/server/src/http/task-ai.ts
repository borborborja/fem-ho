import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError } from '../policy/errors.js';
import { copyExecutionContext, listExecutions, requestExecution } from '../services/task-ai.js';
import { listAiConnections, listAiSettings, putAiSettings } from '../services/task-ai-settings.js';
import { handle } from './handle.js';

const settingsInput = z.object({
  enabled: z.boolean(),
  method: z.enum(['copy', 'mcp_events', 'claude_routine']),
  subscription_id: z.string().min(1).max(160).nullable().optional(),
  connection_id: z.uuid().nullable().optional(),
  routine_id: z
    .string()
    .regex(/^trig_[a-zA-Z0-9]+$/u)
    .max(120)
    .nullable()
    .optional(),
  routine_token: z
    .string()
    .regex(/^sk-ant-oat01-[a-zA-Z0-9_-]+$/u)
    .max(1024)
    .nullable()
    .optional(),
});
const executionInput = z.object({ id: z.uuidv7() });

function param(request: FastifyRequest, key: string) {
  return (request.params as Record<string, string>)[key]!;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new PolicyError(
      'invalid-task-ai-input',
      'Invalid AI input',
      422,
      'Check the submitted fields.',
    );
  return result.data;
}

export function registerTaskAiRoutes(app: FastifyInstance, instanceSecret: () => string): void {
  app.get('/api/v1/ai/task-settings', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      reply.header('Cache-Control', 'private, no-store');
      return {
        data: await listAiSettings(app.connection!.db, principal, new Date().toISOString()),
      };
    }),
  );

  app.get('/api/v1/ai/task-settings/:scope_id/connections', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      reply.header('Cache-Control', 'private, no-store');
      return listAiConnections(
        app.connection!.db,
        principal,
        param(request, 'scope_id'),
        new Date().toISOString(),
      );
    }),
  );

  app.put('/api/v1/ai/task-settings/:scope_id', async (request, reply) =>
    handle(app, request, reply, (principal) => {
      const { db, engine } = app.connection!;
      reply.header('Cache-Control', 'private, no-store');
      const input = parse(settingsInput, request.body);
      return auditedTransaction(
        db,
        principal,
        (ctx) =>
          putAiSettings(
            ctx,
            principal,
            param(request, 'scope_id'),
            {
              enabled: input.enabled,
              method: input.method,
              ...(input.connection_id === undefined ? {} : { connection_id: input.connection_id }),
              ...(input.subscription_id === undefined
                ? {}
                : { subscription_id: input.subscription_id }),
              ...(input.routine_id === undefined ? {} : { routine_id: input.routine_id }),
              ...(input.routine_token === undefined ? {} : { routine_token: input.routine_token }),
            },
            instanceSecret(),
          ),
        { engine },
      );
    }),
  );

  app.get('/api/v1/tasks/:id/ai-context', async (request, reply) =>
    handle(app, request, reply, (principal) => {
      reply.header('Cache-Control', 'private, no-store');
      return copyExecutionContext(app.connection!.db, principal, param(request, 'id'));
    }),
  );

  app.get('/api/v1/tasks/:id/ai-executions', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      reply.header('Cache-Control', 'private, no-store');
      return { data: await listExecutions(app.connection!.db, principal, param(request, 'id')) };
    }),
  );

  app.post('/api/v1/tasks/:id/ai-executions', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { db, engine } = app.connection!;
      const input = parse(executionInput, request.body);
      const result = await auditedTransaction(
        db,
        principal,
        (ctx) => requestExecution(ctx, principal, param(request, 'id'), input.id),
        { engine },
      );
      reply.code(202).header('Cache-Control', 'private, no-store');
      return result;
    }),
  );
}
