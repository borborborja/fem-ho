import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { setupPrincipal } from '../services/setup.js';
import { PolicyError } from '../policy/errors.js';
import {
  authorizationRequest,
  clientOf,
  consent,
  exchange,
  oauthError,
  registerClient,
  revokeOAuth,
  startAuthorization,
} from '../services/mcp-oauth.js';
import { handle, body } from './handle.js';
import { requireHumanSession } from '../services/external-access.js';

export function registerMcpOAuthRoutes(app: FastifyInstance) {
  const issuer = (app.config.baseUrl ?? `http://localhost:${app.config.port}`).replace(/\/$/, '');
  const resource = `${issuer}/mcp`;
  const db = () => app.connection!.db;
  // Un sostre per procés evita registres anònims il·limitats sense guardar adreces IP.
  const windows = new Map<string, { since: number; count: number }>();
  const limit = (key: string, max: number) => {
    const now = Date.now();
    let window = windows.get(key);
    if (!window || now - window.since > 60_000) {
      window = { since: now, count: 0 };
      windows.set(key, window);
    }
    if (++window.count > max)
      throw new PolicyError(
        'temporarily_unavailable',
        'Too many requests',
        429,
        'Try again later.',
      );
  };
  const run = async (reply: FastifyReply, work: () => Promise<unknown>) => {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof PolicyError)) throw error;
      return reply
        .code(error.status)
        .send({ error: error.type.split('/').pop(), error_description: error.detail });
    }
  };
  const authenticateClient = (request: FastifyRequest) => {
    const input = body(request);
    let id = String(input.client_id ?? '');
    let password = typeof input.client_secret === 'string' ? input.client_secret : undefined;
    let method = password === undefined ? 'none' : 'client_secret_post';
    if (request.headers.authorization?.startsWith('Basic ')) {
      if (password !== undefined) throw oauthError('Use one client authentication method.');
      const decoded = Buffer.from(request.headers.authorization.slice(6), 'base64').toString();
      const split = decoded.indexOf(':');
      if (split < 1) throw oauthError();
      try {
        id = decodeURIComponent(decoded.slice(0, split));
        password = decodeURIComponent(decoded.slice(split + 1));
      } catch {
        throw oauthError();
      }
      if (input.client_id !== undefined && input.client_id !== id) throw oauthError();
      method = 'client_secret_basic';
    }
    return clientOf(db(), id, password, method);
  };
  app.get('/.well-known/oauth-protected-resource', async () => ({
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['femho:read', 'femho:write'],
  }));
  app.get('/.well-known/oauth-authorization-server', async () => ({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['femho:read', 'femho:write'],
    authorization_response_iss_parameter_supported: true,
  }));
  app.get('/oauth/authorize', async (request, reply) =>
    run(reply, async () => {
      limit('authorize', 60);
      const id = await auditedTransaction(db(), setupPrincipal(), (ctx) =>
        startAuthorization(ctx, request.query as Record<string, unknown>, resource),
      );
      return reply.redirect(`${issuer}/connect/mcp?request=${encodeURIComponent(id)}`);
    }),
  );
  app.get<{ Params: { id: string } }>('/api/v1/mcp/authorization/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      requireHumanSession(principal);
      const auth = await authorizationRequest(db(), request.params.id);
      const client = await clientOf(db(), auth.client_id);
      return {
        client_name: client.name,
        client_id: client.id,
        redirect_uri: auth.redirect_uri,
        write_requested: auth.scope.split(/\s+/).includes('femho:write'),
      };
    }),
  );
  app.post<{ Params: { id: string } }>('/api/v1/mcp/authorization/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      if (request.headers.origin && request.headers.origin !== new URL(issuer).origin)
        throw oauthError('Invalid origin.');
      return auditedTransaction(db(), principal, (ctx) =>
        consent(ctx, principal, request.params.id, body(request), issuer),
      );
    }),
  );
  void app.register(async function oauthForms(app) {
    app.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string' },
      (_request, text, done) => {
        const form = new URLSearchParams(String(text));
        if ([...form.keys()].some((key) => form.getAll(key).length > 1)) {
          done(oauthError(), undefined);
          return;
        }
        done(null, Object.fromEntries(form));
      },
    );
    app.post('/oauth/register', { bodyLimit: 16_384 }, async (request, reply) =>
      run(reply, async () => {
        limit('register', 10);
        const result = await auditedTransaction(db(), setupPrincipal(), (ctx) =>
          registerClient(ctx, body(request)),
        );
        return reply.code(201).send(result);
      }),
    );
    app.post('/oauth/token', { bodyLimit: 16_384 }, async (request, reply) =>
      run(reply, async () => {
        limit('token', 120);
        const client = await authenticateClient(request);
        const result = await auditedTransaction(db(), setupPrincipal(), (ctx) =>
          exchange(ctx, client, body(request), resource),
        );
        return reply.code('error' in result ? 400 : 200).send(result);
      }),
    );
    app.post('/oauth/revoke', { bodyLimit: 16_384 }, async (request, reply) =>
      run(reply, async () => {
        limit('revoke', 120);
        const client = await authenticateClient(request);
        await auditedTransaction(db(), setupPrincipal(), (ctx) =>
          revokeOAuth(ctx, client.id, String(body(request).token ?? '')),
        );
        return reply.code(200).send({});
      }),
    );
  });
}
