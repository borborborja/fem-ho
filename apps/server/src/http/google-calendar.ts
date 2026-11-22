import type { FastifyInstance } from 'fastify';
import {
  GoogleCalendarError,
  type GoogleCalendarConfig,
  type GoogleCalendarProvider,
} from '../net/google-calendar.js';
import { requireHumanSession } from '../services/external-access.js';
import { GoogleCalendarService, googleCalendarProblem } from '../services/google-calendar.js';
import { body, handle, query, str } from './handle.js';

function providerProblem(error: unknown): never {
  if (error instanceof GoogleCalendarError)
    throw googleCalendarProblem(error.code, error.status === 401 ? 409 : error.status);
  throw error;
}

export function registerGoogleCalendarRoutes(
  app: FastifyInstance,
  secret: () => string,
  config: () => Promise<GoogleCalendarConfig>,
  provider?: GoogleCalendarProvider,
): void {
  const service = async (): Promise<GoogleCalendarService> =>
    new GoogleCalendarService(app.connection!, secret(), await config(), provider);

  app.get('/api/v1/calendars/google/oauth', async (req, reply) =>
    handle(app, req, reply, async (principal) => {
      requireHumanSession(principal);
      return { enabled: (await service()).enabled };
    }),
  );
  app.post('/api/v1/calendars/google/oauth', async (req, reply) =>
    handle(app, req, reply, async (principal) =>
      (await service()).start(principal, str(body(req).account_id)),
    ),
  );
  app.get('/api/v1/calendars/google/oauth/callback', { logLevel: 'silent' }, async (req, reply) => {
    const input = query(req);
    try {
      await (await service()).callback(str(input.state) ?? '', str(input.code), str(input.error));
    } catch {
      // El codi i l'estat del retorn els resol només la sessió que va iniciar l'intent.
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(303).redirect('/settings?tab=calendars');
  });
  app.get<{ Params: { id: string } }>(
    '/api/v1/calendars/google/oauth/attempts/:id',
    async (req, reply) =>
      handle(app, req, reply, async (principal) =>
        (await service()).status(principal, req.params.id),
      ),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/v1/calendars/google/oauth/attempts/:id',
    async (req, reply) =>
      handle(app, req, reply, async (principal) => {
        await (await service()).cancel(principal, req.params.id);
        reply.code(204).send();
      }),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/calendars/google/oauth/attempts/:id/confirm',
    async (req, reply) =>
      handle(app, req, reply, async (principal) =>
        (await service()).confirm(principal, req.params.id),
      ),
  );
  app.get('/api/v1/calendars/google/accounts', async (req, reply) =>
    handle(app, req, reply, async (principal) => (await service()).accounts(principal)),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/calendars/google/accounts/:id/disconnect',
    async (req, reply) =>
      handle(app, req, reply, async (principal) => {
        await (await service()).disconnect(principal, req.params.id);
        reply.code(204).send();
      }),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/calendars/google/accounts/:id/calendars',
    async (req, reply) =>
      handle(app, req, reply, async (principal) => {
        try {
          return await (await service()).calendars(principal, req.params.id);
        } catch (error) {
          providerProblem(error);
        }
      }),
  );
  app.post('/api/v1/calendars/google/links', async (req, reply) =>
    handle(app, req, reply, async (principal) => {
      const input = body(req);
      try {
        const linked = await (
          await service()
        ).link(principal, {
          id: str(input.id) ?? '',
          accountId: str(input.account_id) ?? '',
          remoteId: str(input.remote_calendar_id) ?? '',
          scopeId: str(input.scope_id) ?? '',
          writable: typeof input.writable === 'boolean' ? input.writable : undefined,
        });
        void reply.code(linked.created ? 201 : 200);
        return linked.calendar;
      } catch (error) {
        providerProblem(error);
      }
    }),
  );
}
