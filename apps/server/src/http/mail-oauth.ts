import type { FastifyInstance } from 'fastify';
import {
  createGoogleMailProvider,
  googleMailConfigured,
  GoogleOAuthError,
  type GoogleMailProvider,
} from '../net/google-oauth.js';
import { MailOAuthService, disconnectGoogleMail } from '../services/mail-oauth.js';
import { PolicyError } from '../policy/errors.js';
import { body, handle, query, str } from './handle.js';

export function registerMailOAuthRoutes(
  app: FastifyInstance,
  secret: () => string,
  provider?: GoogleMailProvider,
): void {
  const service = (): MailOAuthService => {
    return new MailOAuthService(
      app.connection!.db,
      secret(),
      provider ??
        (googleMailConfigured(app.config) ? createGoogleMailProvider(app.config) : undefined),
    );
  };
  app.get('/api/v1/mail/oauth/google', async (req, reply) =>
    handle(app, req, reply, async () => ({
      enabled: !!provider || googleMailConfigured(app.config),
    })),
  );
  app.post('/api/v1/mail/oauth/google', async (req, reply) =>
    handle(app, req, reply, async (p) => {
      const input = body(req);
      return service().start(p, str(input.account_id) ?? '', input.reconnect === true);
    }),
  );
  app.get('/api/v1/mail/oauth/google/callback', { logLevel: 'silent' }, async (req, reply) => {
    // Ni el registre, ni el retorn, ni els errors han de reflectir code/state.
    const input = query(req);
    try {
      await service().callback(str(input.state) ?? '', str(input.code), str(input.error));
    } catch {
      /* El client autenticat mostra l'estat; cap resposta crua de Google. */
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(303).redirect('/settings?tab=mail');
  });
  app.get<{ Params: { id: string } }>('/api/v1/mail/oauth/attempts/:id', async (req, reply) =>
    handle(app, req, reply, (p) => service().status(p, req.params.id)),
  );
  app.delete<{ Params: { id: string } }>('/api/v1/mail/oauth/attempts/:id', async (req, reply) =>
    handle(app, req, reply, async (p) => {
      await service().cancel(p, req.params.id);
      reply.code(204).send();
    }),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/mail/oauth/attempts/:id/confirm',
    async (req, reply) => handle(app, req, reply, (p) => service().confirm(p, req.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/mail/accounts/:id/oauth/disconnect',
    async (req, reply) =>
      handle(app, req, reply, async (p) => {
        await disconnectGoogleMail(app.connection!.db, p, req.params.id);
        reply.code(204).send();
      }),
  );
}

export function mailOAuthProblem(error: unknown): never {
  if (error instanceof GoogleOAuthError)
    throw new PolicyError(`mail-oauth-${error.code}`, 'Mail OAuth', 422, error.code);
  throw error;
}
