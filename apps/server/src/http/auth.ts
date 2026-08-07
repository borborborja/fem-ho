/**
 * Rutes d'autenticació. Contracte: openapi.yaml, operacions login · refresh · logout ·
 * getMe.
 *
 * Els handlers són prims a posta: la decisió viu a la capa de servei i de política
 * (regla 8), i aquí només es tradueix HTTP a principal i de tornada.
 */

import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { components } from '@fem-ho/contracts';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { LoginLockout } from '../auth/lockout.js';
import { verifyPassword } from '../auth/password.js';
import { createSession, revokeSession, rotateRefreshToken } from '../auth/sessions.js';
import { generateAccessToken, isApiToken } from '../auth/tokens.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import { bearerFrom, resolveApiToken, resolveSession, scopeIdsOwnedBy } from '../policy/resolve.js';
import type { Source } from '@fem-ho/contracts';
import type { Principal } from '../policy/principal.js';

type LoginRequest = components['schemas']['LoginRequest'];
type RefreshRequest = components['schemas']['RefreshRequest'];
type AuthTokens = components['schemas']['AuthTokens'];
type Me = components['schemas']['Me'];

/**
 * Els tokens d'accés viuen en memòria mentre duri el procés.
 *
 * A M3 encara no hi ha ni galetes ni signatura: el que cal per a la fita és que el
 * cicle login → petició autenticada → refresc → logout funcioni i deixi rastre. El
 * format definitiu del token d'accés (galeta HttpOnly a la web, Bearer a Android) es
 * tanca a M9, quan hi ha la PWA que l'ha de consumir.
 */
const accessTokens = new Map<string, { sessionId: string; expiresAt: number }>();
const ACCESS_TTL_MS = 15 * 60 * 1000;

function issueAccessToken(sessionId: string, now: number): string {
  const token = generateAccessToken();
  accessTokens.set(token, { sessionId, expiresAt: now + ACCESS_TTL_MS });
  return token;
}

function sessionIdOfAccessToken(token: string, now: number): string | null {
  const entry = accessTokens.get(token);
  if (entry === undefined) return null;
  if (entry.expiresAt <= now) {
    accessTokens.delete(token);
    return null;
  }
  return entry.sessionId;
}

export const lockout = new LoginLockout();

/**
 * Resol el principal d'una petició. **És l'únic lloc on es mira una credencial.**
 *
 * Tres camins d'entrada i un sol resultat: a partir d'aquí ningú sap si ha entrat una
 * persona, una app o una IA (regla 8).
 */
export async function principalOf(
  app: FastifyInstance,
  request: FastifyRequest,
  /**
   * El canal, quan la ruta el sap millor que la petició.
   *
   * El camí MCP el passa explícitament. Abans es deduïa d'una capçalera
   * `X-Femho-Source`, i això era doblement dolent: un client MCP real no l'envia —o
   * sigui que les seves escriptures quedaven registrades com a `api`— i qualsevol client
   * podia mentir sobre quin canal era per falsejar l'historial.
   */
  channel?: Source,
): Promise<Principal> {
  const conn = app.connection;
  if (conn === undefined) throw unauthenticated('The instance has no database.');

  const now = new Date().toISOString();
  const bearer = bearerFrom(request.headers.authorization);
  if (bearer === null) throw unauthenticated();

  // Un token d'API es reconeix pel prefix llegible, que és per a què hi és.
  if (isApiToken(bearer)) {
    return resolveApiToken(conn.db, bearer, channel ?? 'api', now);
  }

  const sessionId = sessionIdOfAccessToken(bearer, Date.now());
  if (sessionId === null) throw unauthenticated('Invalid or expired access token.');
  return resolveSession(conn.db, sessionId, channel ?? sourceOf(request), now);
}

/** El canal, que es propaga fins a activity_log sense que cap servei l'hagi de passar. */
function sourceOf(request: FastifyRequest): 'web' | 'android' {
  const ua = String(request.headers['user-agent'] ?? '');
  return /okhttp|android/i.test(ua) ? 'android' : 'web';
}

function sendProblem(reply: FastifyReply, error: unknown, instance: string): void {
  if (error instanceof PolicyError) {
    void reply.code(error.status).type('application/problem+json').send(error.toProblem(instance));
    return;
  }
  throw error;
}

export function registerAuthRoutes(app: FastifyInstance): void {
  app.post('/api/v1/auth/login', async (request, reply): Promise<AuthTokens | undefined> => {
    const conn = app.connection;
    if (conn === undefined) {
      sendProblem(reply, unauthenticated('The instance has no database.'), '/api/v1/auth/login');
      return undefined;
    }

    const body = request.body as LoginRequest | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    // El bloqueig es comprova ABANS de tocar la base: si no, un atacant bloquejat
    // continuaria fent treballar argon2id a cada intent.
    const espera = lockout.retryAfterMs(email, nowMs);
    if (espera > 0) {
      void reply
        .code(429)
        .header('Retry-After', String(Math.ceil(espera / 1000)))
        .type('application/problem+json')
        .send({
          type: 'https://femho.app/errors/too-many-attempts',
          title: 'Too many attempts',
          status: 429,
          detail: `Too many attempts. Try again in ${Math.ceil(espera / 1000)} seconds.`,
          params: { seconds: Math.ceil(espera / 1000) },
        });
      return undefined;
    }

    const found = await sql<{
      id: string;
      password_hash: string | null;
      kind: string;
      deleted_at: string | null;
    }>`
      SELECT id, password_hash, kind, deleted_at FROM users WHERE email = ${email}
    `.execute(conn.db);

    const user = found.rows[0];
    const usable = user !== undefined && user.deleted_at === null && user.kind === 'human';
    // Es verifica SEMPRE, encara que l'usuari no existeixi: verifyPassword fa la feina
    // d'argon2id contra un hash fals per no delatar per temps si el correu hi és.
    const correcta = await verifyPassword(password, usable ? user.password_hash : null);

    if (!usable || !correcta) {
      lockout.recordFailure(email, nowMs);
      // Sempre el mateix missatge. docs/02 §2: mai es diu si el correu existeix.
      sendProblem(
        reply,
        new PolicyError(
          'invalid-credentials',
          'Invalid credentials',
          401,
          'Wrong email or password.',
        ),
        '/api/v1/auth/login',
      );
      return undefined;
    }

    lockout.recordSuccess(email);

    const principal: Principal = {
      kind: 'user',
      userId: user.id,
      capabilities: new Set(),
      scopeIds: null,
      source: sourceOf(request),
    };

    const sessio = await auditedTransaction(
      conn.db,
      principal,
      async (ctx) => {
        const issued = await createSession(
          ctx.tx,
          user.id,
          ctx.now,
          String(request.headers['user-agent'] ?? ''),
        );
        ctx.record({ entityType: 'session', entityId: issued.sessionId, verb: 'logged_in' });
        return issued;
      },
      { now: nowIso },
    );

    return {
      access_token: issueAccessToken(sessio.sessionId, nowMs),
      refresh_token: sessio.refreshToken,
      expires_at: sessio.expiresAt,
    };
  });

  app.post('/api/v1/auth/refresh', async (request, reply): Promise<AuthTokens | undefined> => {
    const conn = app.connection;
    if (conn === undefined) {
      sendProblem(reply, unauthenticated(), '/api/v1/auth/refresh');
      return undefined;
    }

    const body = request.body as RefreshRequest | undefined;
    const token = typeof body?.refresh_token === 'string' ? body.refresh_token : '';
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const resultat = await rotateRefreshToken(conn.db, token, nowIso);

    if (!resultat.ok) {
      // Els quatre motius donen la mateixa resposta cap enfora. Que un token gastat
      // digui "gastat" i un d'inventat digui "inventat" seria dir-li a l'atacant que
      // el seu token ÉS d'una sessió real.
      sendProblem(reply, unauthenticated('Invalid refresh token.'), '/api/v1/auth/refresh');
      if (resultat.reason === 'reused') {
        app.log.warn(
          { sessionId: resultat.revokedSessionId },
          "S'ha reutilitzat un token de refresc gastat. Sessió revocada.",
        );
      }
      return undefined;
    }

    return {
      access_token: issueAccessToken(resultat.session.sessionId, nowMs),
      refresh_token: resultat.session.refreshToken,
      expires_at: resultat.session.expiresAt,
    };
  });

  app.post('/api/v1/auth/logout', async (request, reply): Promise<undefined> => {
    const conn = app.connection;
    if (conn === undefined) {
      sendProblem(reply, unauthenticated(), '/api/v1/auth/logout');
      return undefined;
    }

    const bearer = bearerFrom(request.headers.authorization);
    const sessionId = bearer === null ? null : sessionIdOfAccessToken(bearer, Date.now());
    if (sessionId === null) {
      sendProblem(reply, unauthenticated(), '/api/v1/auth/logout');
      return undefined;
    }

    let principal: Principal;
    try {
      principal = await principalOf(app, request);
    } catch (error) {
      sendProblem(reply, error, '/api/v1/auth/logout');
      return undefined;
    }

    await auditedTransaction(conn.db, principal, async (ctx) => {
      await revokeSession(ctx.tx, sessionId, ctx.now);
      ctx.record({ entityType: 'session', entityId: sessionId, verb: 'logged_out' });
    });
    if (bearer !== null) accessTokens.delete(bearer);

    void reply.code(204).send();
    return undefined;
  });

  app.get('/api/v1/auth/me', async (request, reply): Promise<Me | undefined> => {
    const conn = app.connection;
    let principal: Principal;
    try {
      principal = await principalOf(app, request);
    } catch (error) {
      sendProblem(reply, error, '/api/v1/auth/me');
      return undefined;
    }
    if (conn === undefined) return undefined;

    const found = await sql<{
      name: string;
      email: string | null;
      role: 'admin' | 'member';
      timezone: string;
    }>`SELECT name, email, role, timezone FROM users WHERE id = ${principal.userId}`.execute(
      conn.db,
    );
    const user = found.rows[0];
    if (user === undefined) {
      sendProblem(reply, unauthenticated(), '/api/v1/auth/me');
      return undefined;
    }

    // Els àmbits que veu de veritat: si el token no en limita cap, s'enumeren els del
    // propietari perquè qui pregunta sàpiga on arriba sense haver-ho d'endevinar.
    const scopeIds =
      principal.scopeIds === null
        ? [...(await scopeIdsOwnedBy(conn.db, principal.userId))]
        : [...principal.scopeIds];

    return {
      id: principal.userId,
      name: user.name,
      email: user.email,
      kind: principal.kind,
      role: user.role,
      timezone: user.timezone,
      capabilities: [...principal.capabilities].sort(),
      scope_ids: scopeIds.sort(),
      agent_id: principal.agentId ?? null,
    };
  });
}
