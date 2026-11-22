import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import {
  listGoogleCalendarChanges,
  resolveGoogleCalendarChange,
} from '../services/google-calendar-changes.js';
import { body, handle } from './handle.js';

export function registerGoogleCalendarChangeRoutes(app: FastifyInstance): void {
  app.get('/api/v1/calendars/google/changes', async (request, reply) =>
    handle(app, request, reply, (principal) =>
      listGoogleCalendarChanges(app.connection!.db, principal),
    ),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/calendars/google/changes/:id/retry',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        const { db, engine } = app.connection!;
        await auditedTransaction(
          db,
          principal,
          (ctx) =>
            resolveGoogleCalendarChange(
              ctx,
              principal,
              request.params.id,
              true,
              body(request).notify_guests === true,
            ),
          { engine },
        );
        void reply.code(204).send();
      }),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/calendars/google/changes/:id',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        const { db, engine } = app.connection!;
        await auditedTransaction(
          db,
          principal,
          (ctx) => resolveGoogleCalendarChange(ctx, principal, request.params.id, false),
          { engine },
        );
        void reply.code(204).send();
      }),
  );
}
