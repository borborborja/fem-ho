import type { FastifyInstance } from 'fastify';
import {
  createGoogleMailProvider,
  GoogleOAuthError,
  type GoogleMailProvider,
} from '../net/google-oauth.js';
import { MailOAuthService, disconnectGoogleMail } from '../services/mail-oauth.js';
import { PolicyError } from '../policy/errors.js';
import { resolveGoogleConfig } from '../services/google-config.js';
import { GmailError } from '../net/gmail-client.js';
import { body, handle, query, str } from './handle.js';

export function registerMailOAuthRoutes(
  app: FastifyInstance,
  secret: () => string,
  provider?: GoogleMailProvider,
): void {
  const effective = async () => resolveGoogleConfig(app.connection!.db, secret(), app.config);
  const service = async (): Promise<MailOAuthService> => {
    const config = provider ? undefined : await effective();
    return new MailOAuthService(
      app.connection!.db,
      secret(),
      provider ?? (config?.enabled ? createGoogleMailProvider(config) : undefined),
      config?.googleClientId,
    );
  };
  app.get('/api/v1/mail/oauth/google', async (req, reply) =>
    handle(app, req, reply, async () => ({
      enabled: !!provider || (await effective()).enabled,
    })),
  );
  app.post('/api/v1/mail/oauth/google', async (req, reply) =>
    handle(app, req, reply, async (p) => {
      const input = body(req);
      const transport = input.transport;
      if (transport !== undefined && transport !== 'imap' && transport !== 'gmail_api')
        throw new PolicyError(
          'mail-oauth-invalid_transport',
          'Mail OAuth',
          422,
          'invalid_transport',
        );
      return (await service()).start(
        p,
        str(input.account_id) ?? '',
        input.reconnect === true,
        transport,
      );
    }),
  );
  app.get('/api/v1/mail/oauth/google/callback', { logLevel: 'silent' }, async (req, reply) => {
    // Ni el registre, ni el retorn, ni els errors han de reflectir code/state.
    const input = query(req);
    try {
      await (await service()).callback(str(input.state) ?? '', str(input.code), str(input.error));
    } catch {
      /* El client autenticat mostra l'estat; cap resposta crua de Google. */
    }
    reply.header('Cache-Control', 'no-store');
    return reply.code(303).redirect('/settings?tab=mail');
  });
  app.get<{ Params: { id: string } }>('/api/v1/mail/oauth/attempts/:id', async (req, reply) =>
    handle(app, req, reply, async (p) => (await service()).status(p, req.params.id)),
  );
  app.delete<{ Params: { id: string } }>('/api/v1/mail/oauth/attempts/:id', async (req, reply) =>
    handle(app, req, reply, async (p) => {
      await (await service()).cancel(p, req.params.id);
      reply.code(204).send();
    }),
  );
  app.post<{ Params: { id: string } }>(
    '/api/v1/mail/oauth/attempts/:id/confirm',
    async (req, reply) =>
      handle(app, req, reply, async (p) => {
        try {
          return await (await service()).confirm(p, req.params.id);
        } catch (error) {
          mailOAuthProblem(error);
        }
      }),
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
  if (error instanceof GoogleOAuthError || error instanceof GmailError)
    throw new PolicyError(`mail-oauth-${error.code}`, 'Mail OAuth', 422, error.code);
  throw error;
}
