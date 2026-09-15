import { randomBytes, createHash } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { MigrationDb } from '../db/migration-db.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { Principal } from '../policy/principal.js';
import { hashToken, tokenHashEquals } from '../auth/tokens.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import { resolveTokenId } from '../policy/resolve.js';
import { createToken } from './tokens.js';
import { assertExternalChannel, requireHumanSession } from './external-access.js';

export const MCP_READ = [
  'tasks:read',
  'events:read',
  'projects:read',
  'scopes:read',
  'checklists:read',
  'comments:read',
  'attachments:read',
];
export const MCP_WRITE = [
  ...MCP_READ,
  'tasks:write',
  'events:write',
  'projects:write',
  'checklists:write',
  'comments:write',
  'attachments:write',
];
const secret = () => randomBytes(32).toString('base64url');
const expires = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
export const oauthError = (detail = 'Invalid OAuth request.') =>
  new PolicyError('invalid_request', 'Invalid OAuth request', 400, detail);

interface Client {
  id: string;
  name: string;
  redirect_uris: string;
  secret_hash: string | null;
  auth_method: string;
}
interface RequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
  consumed: number;
}

export async function registerClient(ctx: AuditContext, input: Record<string, unknown>) {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10)
    throw oauthError('Provide redirect URIs.');
  for (const uri of uris) {
    if (typeof uri !== 'string' || uri.length > 2048) throw oauthError();
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw oauthError();
    }
    if (
      parsed.hash ||
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== 'https:' &&
        !(
          parsed.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
        ))
    )
      throw oauthError('Use HTTPS redirects or a loopback callback.');
  }
  const method = input.token_endpoint_auth_method ?? 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(String(method)))
    throw oauthError();
  if (
    input.grant_types !== undefined &&
    (!Array.isArray(input.grant_types) ||
      input.grant_types.some((g) => !['authorization_code', 'refresh_token'].includes(String(g))))
  )
    throw oauthError();
  if (
    input.response_types !== undefined &&
    (!Array.isArray(input.response_types) || input.response_types.some((r) => r !== 'code'))
  )
    throw oauthError();
  const name =
    typeof input.client_name === 'string' ? input.client_name.trim().slice(0, 100) : 'MCP client';
  const id = uuidv7();
  const password = method === 'none' ? null : secret();
  await sql`INSERT INTO mcp_oauth_clients (id, name, redirect_uris, secret_hash, auth_method, created_at)
    VALUES (${id}, ${name}, ${JSON.stringify(uris)}, ${password === null ? null : hashToken(password)}, ${String(method)}, ${ctx.now})`.execute(
    ctx.tx,
  );
  ctx.record({
    entityType: 'oauth_client',
    entityId: id,
    verb: 'created',
    changes: { name: { from: null, to: name } },
  });
  return {
    client_id: id,
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: method,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    ...(password === null ? {} : { client_secret: password, client_secret_expires_at: 0 }),
  };
}

export async function clientOf(
  db: MigrationDb,
  id: string,
  password?: string,
  method?: string,
): Promise<Client> {
  const { rows } =
    await sql<Client>`SELECT id, name, redirect_uris, secret_hash, auth_method FROM mcp_oauth_clients WHERE id = ${id}`.execute(
      db,
    );
  const client = rows[0];
  if (!client) throw oauthError('Unknown client.');
  if (
    method !== undefined &&
    (client.auth_method !== method ||
      (client.secret_hash !== null &&
        !tokenHashEquals(client.secret_hash, hashToken(password ?? ''))))
  )
    throw new PolicyError('invalid_client', 'Invalid client', 401, 'Invalid client credentials.');
  return client;
}

export async function startAuthorization(
  ctx: AuditContext,
  input: Record<string, unknown>,
  resource: string,
) {
  const client = await clientOf(ctx.tx, String(input.client_id ?? ''));
  const scope =
    typeof input.scope === 'string' && input.scope.trim() ? input.scope.trim() : 'femho:read';
  if (
    input.response_type !== 'code' ||
    input.resource !== resource ||
    input.code_challenge_method !== 'S256' ||
    !/^[A-Za-z0-9_-]{43}$/.test(String(input.code_challenge)) ||
    typeof input.state !== 'string' ||
    input.state.length > 2048 ||
    !scope.split(/\s+/).every((s) => ['femho:read', 'femho:write'].includes(s)) ||
    !(JSON.parse(client.redirect_uris) as string[]).includes(String(input.redirect_uri))
  )
    throw oauthError();
  const id = secret();
  await sql`INSERT INTO mcp_oauth_requests (id, client_id, redirect_uri, state, challenge, scope, resource, expires_at)
    VALUES (${id}, ${client.id}, ${String(input.redirect_uri)}, ${input.state}, ${String(input.code_challenge)}, ${scope}, ${resource}, ${expires(600)})`.execute(
    ctx.tx,
  );
  ctx.record({ entityType: 'oauth_request', entityId: id, verb: 'created' });
  return id;
}

export async function authorizationRequest(db: MigrationDb, id: string) {
  const { rows } = await sql<RequestRow>`SELECT * FROM mcp_oauth_requests WHERE id = ${id}`.execute(
    db,
  );
  const request = rows[0];
  if (!request || Number(request.consumed) !== 0 || Date.parse(request.expires_at) <= Date.now())
    throw oauthError('Authorization request expired. Start again from your MCP client.');
  return request;
}

export async function consent(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: Record<string, unknown>,
  issuer: string,
) {
  requireHumanSession(principal);
  const request = await authorizationRequest(ctx.tx, id);
  const consumed =
    await sql`UPDATE mcp_oauth_requests SET consumed = 1 WHERE id = ${id} AND consumed = 0 RETURNING id`.execute(
      ctx.tx,
    );
  if (consumed.rows.length !== 1) throw oauthError();
  const redirect = new URL(request.redirect_uri);
  redirect.searchParams.set('state', request.state);
  redirect.searchParams.set('iss', issuer);
  if (input.approve === false) {
    redirect.searchParams.set('error', 'access_denied');
    ctx.record({ entityType: 'oauth_request', entityId: id, verb: 'revoked' });
    return { redirect_url: redirect.href };
  }
  if (input.approve !== true || !['read_only', 'read_write'].includes(String(input.permission)))
    throw oauthError();
  await assertExternalChannel(ctx.tx, principal.userId, 'mcp', ['mcp']);
  if (input.permission === 'read_write' && !request.scope.split(/\s+/).includes('femho:write'))
    throw oauthError('Client did not request write permission.');
  const client = await clientOf(ctx.tx, request.client_id);
  const created = await createToken(ctx, principal, {
    name: client.name,
    channels: ['mcp'],
    credential_type: 'oauth',
    capabilities: input.permission === 'read_write' ? MCP_WRITE : MCP_READ,
    scope_ids: Array.isArray(input.scope_ids) ? (input.scope_ids as string[]) : [],
  });
  const code = secret();
  await sql`INSERT INTO mcp_oauth_codes (hash, request_id, token_id, expires_at) VALUES
    (${hashToken(code)}, ${id}, ${created.summary.id}, ${expires(120)})`.execute(ctx.tx);
  redirect.searchParams.set('code', code);
  return { redirect_url: redirect.href };
}

async function issue(
  ctx: AuditContext,
  tokenId: string,
  clientId: string,
  resource: string,
  sessionId?: string,
  oldHash?: string,
) {
  const access = `femho_oauth_${secret()}`;
  const refresh = secret();
  const id = sessionId ?? uuidv7();
  if (sessionId === undefined) {
    await sql`INSERT INTO mcp_oauth_sessions (id, token_id, client_id, resource, access_hash, refresh_hash, access_expires_at, refresh_expires_at)
      VALUES (${id}, ${tokenId}, ${clientId}, ${resource}, ${hashToken(access)}, ${hashToken(refresh)}, ${expires(900)}, ${expires(30 * 86400)})`.execute(
      ctx.tx,
    );
  } else {
    const updated =
      await sql`UPDATE mcp_oauth_sessions SET access_hash = ${hashToken(access)}, refresh_hash = ${hashToken(refresh)},
      access_expires_at = ${expires(900)}, refresh_expires_at = ${expires(30 * 86400)} WHERE id = ${id} AND refresh_hash = ${oldHash!} AND revoked_at IS NULL RETURNING id`.execute(
        ctx.tx,
      );
    if (updated.rows.length !== 1) throw oauthError('Refresh token already consumed.');
    await sql`INSERT INTO mcp_oauth_used_refresh (hash, session_id) VALUES (${oldHash!}, ${id})`.execute(
      ctx.tx,
    );
  }
  const token = await sql<{
    capabilities: string;
  }>`SELECT capabilities FROM api_tokens WHERE id = ${tokenId}`.execute(ctx.tx);
  ctx.record({
    entityType: 'oauth_session',
    entityId: id,
    verb: sessionId === undefined ? 'created' : 'updated',
  });
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: refresh,
    scope: (JSON.parse(token.rows[0]!.capabilities) as string[]).some((c) => c.endsWith(':write'))
      ? 'femho:read femho:write'
      : 'femho:read',
  };
}

export async function exchange(
  ctx: AuditContext,
  client: Client,
  input: Record<string, unknown>,
  resource: string,
) {
  if (input.resource !== resource) throw oauthError('Wrong resource.');
  if (input.grant_type === 'authorization_code') {
    const hash = hashToken(String(input.code ?? ''));
    const { rows } = await sql<{
      request_id: string;
      token_id: string;
      used: number;
      expires_at: string;
    }>`SELECT * FROM mcp_oauth_codes WHERE hash = ${hash}`.execute(ctx.tx);
    const code = rows[0];
    if (!code || Number(code.used) !== 0 || Date.parse(code.expires_at) <= Date.now())
      throw oauthError('Invalid authorization code.');
    const requests =
      await sql<RequestRow>`SELECT * FROM mcp_oauth_requests WHERE id = ${code.request_id}`.execute(
        ctx.tx,
      );
    const request = requests.rows[0]!;
    const verifier = String(input.code_verifier ?? '');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
      request.client_id !== client.id ||
      request.redirect_uri !== input.redirect_uri ||
      request.resource !== resource ||
      !tokenHashEquals(hashToken(request.challenge), hashToken(challenge))
    )
      throw oauthError();
    await resolveTokenId(ctx.tx, code.token_id, 'mcp', ctx.now);
    const used =
      await sql`UPDATE mcp_oauth_codes SET used = 1 WHERE hash = ${hash} AND used = 0 RETURNING hash`.execute(
        ctx.tx,
      );
    if (used.rows.length !== 1) throw oauthError();
    return issue(ctx, code.token_id, client.id, resource);
  }
  if (input.grant_type !== 'refresh_token') throw oauthError('Unsupported grant type.');
  const hash = hashToken(String(input.refresh_token ?? ''));
  const { rows } = await sql<{
    id: string;
    token_id: string;
    client_id: string;
    resource: string;
    refresh_expires_at: string;
    revoked_at: string | null;
  }>`SELECT * FROM mcp_oauth_sessions WHERE refresh_hash = ${hash}`.execute(ctx.tx);
  const session = rows[0];
  if (!session) {
    const used = await sql<{
      session_id: string;
    }>`SELECT r.session_id FROM mcp_oauth_used_refresh r JOIN mcp_oauth_sessions s ON s.id = r.session_id WHERE r.hash = ${hash} AND s.client_id = ${client.id}`.execute(
      ctx.tx,
    );
    if (used.rows[0]) {
      await sql`UPDATE mcp_oauth_sessions SET revoked_at = ${ctx.now} WHERE id = ${used.rows[0].session_id}`.execute(
        ctx.tx,
      );
      ctx.record({
        entityType: 'oauth_session',
        entityId: used.rows[0].session_id,
        verb: 'revoked',
      });
      // Retornar l'error permet confirmar la revocació en lloc de desfer-la amb rollback.
      return { error: 'invalid_grant' };
    }
    throw oauthError('Invalid refresh token.');
  }
  if (
    session.resource !== resource ||
    session.client_id !== client.id ||
    session.revoked_at !== null ||
    Date.parse(session.refresh_expires_at) <= Date.now()
  )
    throw oauthError('Invalid refresh token.');
  await resolveTokenId(ctx.tx, session.token_id, 'mcp', ctx.now);
  return issue(ctx, session.token_id, client.id, resource, session.id, hash);
}

export async function resolveOAuth(
  db: MigrationDb,
  token: string,
  resource: string,
  audience: string,
) {
  if (resource !== 'mcp') throw unauthenticated('OAuth credential is only valid for MCP.');
  const { rows } = await sql<{
    token_id: string;
    resource: string;
    access_expires_at: string;
    revoked_at: string | null;
  }>`SELECT token_id, resource, access_expires_at, revoked_at FROM mcp_oauth_sessions WHERE access_hash = ${hashToken(token)}`.execute(
    db,
  );
  const session = rows[0];
  if (
    !session ||
    session.resource !== audience ||
    session.revoked_at !== null ||
    Date.parse(session.access_expires_at) <= Date.now()
  )
    throw unauthenticated('Invalid OAuth access token.');
  return resolveTokenId(db, session.token_id, 'mcp', new Date().toISOString());
}

export async function revokeOAuth(ctx: AuditContext, clientId: string, token: string) {
  const hash = hashToken(token);
  const result = await sql<{ id: string }>`UPDATE mcp_oauth_sessions SET revoked_at = ${ctx.now}
    WHERE client_id = ${clientId} AND (access_hash = ${hash} OR refresh_hash = ${hash}) AND revoked_at IS NULL RETURNING id`.execute(
    ctx.tx,
  );
  if (result.rows.length === 0) ctx.noChange();
  for (const row of result.rows)
    ctx.record({ entityType: 'oauth_session', entityId: row.id, verb: 'revoked' });
}
