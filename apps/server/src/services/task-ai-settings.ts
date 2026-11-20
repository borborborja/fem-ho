import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import { open, seal } from '../crypto/secret-box.js';
import type { MigrationDb } from '../db/migration-db.js';
import { missingCapability, notFound, PolicyError } from '../policy/errors.js';
import { canSeeScope, hasCapability, type Principal } from '../policy/principal.js';
import { resolveTokenId } from '../policy/resolve.js';
import { roleCan } from '../policy/scope-roles.js';
import { roleOf } from '../policy/scope-visibility.js';
import { requireHumanSession } from './external-access.js';
import { assertScopeAccess, assertScopeRole, listScopes } from './scopes.js';

type Schemas = components['schemas'];
export type TaskAiSettingsInput = Schemas['TaskAiSettingsInput'];
export type TaskAiSettings = Schemas['TaskAiSettings'];

interface SettingsRow {
  user_id: string;
  scope_id: string;
  enabled: number;
  method: Schemas['TaskAiMethod'];
  subscription_id: string | null;
  connection_id: string | null;
  routine_id: string | null;
  routine_token_enc: string | null;
  revision: string;
}
interface SubscriptionRow {
  id: string;
  user_id: string;
  scope_id: string;
  connection_id: string;
  oauth_session_id: string;
  callback_enc: string;
  secret_enc: string;
  previous_secret_enc: string | null;
  rotated_at: string | null;
  expires_at: string;
  created_at: string;
}
interface ConnectionRow {
  id: string;
  label: string;
  oauth_session_id: string;
}

const purpose = (id: string, value: string) => 'task-ai:' + id + ':' + value;
const routinePurpose = (userId: string, scopeId: string) =>
  purpose(userId + ':' + scopeId, 'routine');

export function aiUnavailable() {
  return new PolicyError(
    'task-ai-unavailable',
    'AI destination unavailable',
    409,
    'Check the AI task settings for this scope.',
  );
}

export async function assertAiSubscriptionAccess(
  db: MigrationDb,
  principal: Principal,
  scopeId: string,
) {
  if (
    principal.credentialType !== 'oauth' ||
    !principal.oauthSessionId ||
    !principal.credentialId ||
    !hasCapability(principal, 'ai_executions:read')
  )
    throw missingCapability('ai_executions:read');
  await assertScopeRole(db, principal, scopeId, 'content');
}

export async function saveSubscription(
  ctx: AuditContext,
  principal: Principal,
  input: { id: string; scopeId: string; callbackUrl: string; secret: string; expiresAt: string },
  masterSecret: string,
): Promise<void> {
  await assertAiSubscriptionAccess(ctx.tx, principal, input.scopeId);
  const { id, scopeId, callbackUrl, secret, expiresAt } = input;
  const existing = await subscriptionOf(ctx.tx, principal.userId, scopeId, id);
  const rotated =
    existing !== undefined &&
    open(masterSecret, purpose(id, 'secret'), existing.secret_enc) !== secret;
  const callbackEnc = seal(masterSecret, purpose(id, 'callback'), callbackUrl);
  const secretEnc = seal(masterSecret, purpose(id, 'secret'), secret);
  const previous = rotated ? existing.secret_enc : (existing?.previous_secret_enc ?? null);
  const rotatedAt = rotated ? ctx.now : (existing?.rotated_at ?? null);
  await sql`
    INSERT INTO task_ai_subscriptions
      (id, user_id, scope_id, connection_id, oauth_session_id, callback_enc, secret_enc,
        previous_secret_enc, rotated_at, expires_at, created_at)
    VALUES (${id}, ${principal.userId}, ${scopeId}, ${principal.credentialId!},
      ${principal.oauthSessionId!}, ${callbackEnc}, ${secretEnc}, ${previous}, ${rotatedAt},
      ${expiresAt}, ${ctx.now})
    ON CONFLICT (id) DO UPDATE SET callback_enc = excluded.callback_enc,
      secret_enc = excluded.secret_enc, previous_secret_enc = excluded.previous_secret_enc,
      rotated_at = excluded.rotated_at, expires_at = excluded.expires_at
    WHERE task_ai_subscriptions.oauth_session_id = excluded.oauth_session_id
      AND task_ai_subscriptions.user_id = excluded.user_id
      AND task_ai_subscriptions.scope_id = excluded.scope_id
  `.execute(ctx.tx);
  ctx.record({
    entityType: 'task_ai_subscription',
    entityId: id,
    verb: existing ? 'updated' : 'created',
  });
}

export async function removeSubscription(ctx: AuditContext, principal: Principal, id: string) {
  if (principal.credentialType !== 'oauth' || !principal.oauthSessionId || !principal.credentialId)
    throw missingCapability('ai_executions:read');
  const { rows } = await sql<{ id: string }>`
    DELETE FROM task_ai_subscriptions WHERE id = ${id} AND user_id = ${principal.userId}
      AND connection_id = ${principal.credentialId} AND oauth_session_id = ${principal.oauthSessionId}
    RETURNING id
  `.execute(ctx.tx);
  if (rows.length === 0) ctx.noChange();
  else ctx.record({ entityType: 'task_ai_subscription', entityId: id, verb: 'revoked' });
}

async function subscriptionOf(db: MigrationDb, userId: string, scopeId: string, id: string) {
  const { rows } = await sql<SubscriptionRow>`
    SELECT * FROM task_ai_subscriptions WHERE id = ${id} AND user_id = ${userId} AND scope_id = ${scopeId}
  `.execute(db);
  return rows[0];
}

async function eligibleConnections(
  db: MigrationDb,
  userId: string,
  scopeId: string,
  now: string,
  connectionId: string | null = null,
  sessionId: string | null = null,
): Promise<ConnectionRow[]> {
  const { rows } = await sql<ConnectionRow>`
    SELECT t.id, t.name AS label, s.id AS oauth_session_id
    FROM mcp_oauth_sessions s JOIN api_tokens t ON t.id = s.token_id
    WHERE t.user_id = ${userId} AND t.credential_type = 'oauth' AND t.ai_agent_id IS NULL
      AND s.revoked_at IS NULL AND s.refresh_expires_at > ${now}
      AND ${connectionId === null ? sql`TRUE` : sql`t.id = ${connectionId}`}
      AND ${sessionId === null ? sql`TRUE` : sql`s.id = ${sessionId}`}
    ORDER BY t.name, t.id, s.id
  `.execute(db);
  const eligible: ConnectionRow[] = [];
  for (const row of rows) {
    try {
      const connector = await resolveTokenId(db, row.id, 'mcp', now, false);
      if (
        connector.userId === userId &&
        canSeeScope(connector, scopeId) &&
        hasCapability(connector, 'ai_executions:read')
      )
        eligible.push(row);
    } catch (error) {
      if (!(error instanceof PolicyError)) throw error;
    }
  }
  return eligible;
}

export async function listAiConnections(
  db: MigrationDb,
  principal: Principal,
  scopeId: string,
  now: string,
) {
  requireHumanSession(principal);
  await assertScopeAccess(db, principal, scopeId);
  const eligible = await eligibleConnections(db, principal.userId, scopeId, now);
  const { rows } = await sql<SubscriptionRow>`
    SELECT * FROM task_ai_subscriptions
    WHERE user_id = ${principal.userId} AND scope_id = ${scopeId} AND expires_at > ${now}
    ORDER BY created_at DESC, id
  `.execute(db);
  const active = new Map(eligible.map((connection) => [connection.oauth_session_id, connection]));
  const connections = new Map(eligible.map(({ id, label }) => [id, { id, label }]));
  return {
    subscriptions: rows.flatMap((row) => {
      const connection = active.get(row.oauth_session_id);
      return connection === undefined
        ? []
        : [
            {
              id: row.id,
              label: connection.label + ' · ' + row.id.slice(-8),
              expires_at: row.expires_at,
            },
          ];
    }),
    connections: [...connections.values()],
  };
}

export async function settingsOfAi(
  db: MigrationDb,
  userId: string,
  scopeId: string,
): Promise<SettingsRow> {
  const { rows } = await sql<SettingsRow>`
    SELECT * FROM task_ai_settings WHERE user_id = ${userId} AND scope_id = ${scopeId}
  `.execute(db);
  return (
    rows[0] ?? {
      user_id: userId,
      scope_id: scopeId,
      enabled: 0,
      method: 'copy',
      subscription_id: null,
      connection_id: null,
      routine_id: null,
      routine_token_enc: null,
      revision: '',
    }
  );
}

export async function destinationOf(db: MigrationDb, settings: SettingsRow, now: string) {
  if (!settings.enabled || settings.method === 'copy') return undefined;
  if (settings.method === 'mcp_events') {
    if (settings.subscription_id === null) return undefined;
    const sub = await subscriptionOf(
      db,
      settings.user_id,
      settings.scope_id,
      settings.subscription_id,
    );
    if (sub === undefined || sub.expires_at <= now) return undefined;
    const [conn] = await eligibleConnections(
      db,
      settings.user_id,
      settings.scope_id,
      now,
      sub.connection_id,
      sub.oauth_session_id,
    );
    return conn === undefined ? undefined : { conn, sub };
  }
  if (
    settings.connection_id === null ||
    settings.routine_id === null ||
    settings.routine_token_enc === null
  )
    return undefined;
  const [conn] = await eligibleConnections(
    db,
    settings.user_id,
    settings.scope_id,
    now,
    settings.connection_id,
  );
  return conn === undefined ? undefined : { conn, sub: undefined };
}

export function subscriptionCredentials(sub: SubscriptionRow, masterSecret: string, now: string) {
  return {
    callbackUrl: open(masterSecret, purpose(sub.id, 'callback'), sub.callback_enc),
    secret: open(masterSecret, purpose(sub.id, 'secret'), sub.secret_enc),
    previousSecret:
      sub.previous_secret_enc !== null &&
      sub.rotated_at !== null &&
      Date.parse(now) - Date.parse(sub.rotated_at) < 300_000
        ? open(masterSecret, purpose(sub.id, 'secret'), sub.previous_secret_enc)
        : null,
    subscriptionId: sub.id,
  };
}

export function routineToken(settings: SettingsRow, masterSecret: string) {
  return open(
    masterSecret,
    routinePurpose(settings.user_id, settings.scope_id),
    settings.routine_token_enc!,
  );
}

async function settingsView(
  db: MigrationDb,
  settings: SettingsRow,
  now: string,
): Promise<TaskAiSettings> {
  const role = await roleOf(db, settings.user_id, settings.scope_id);
  return {
    scope_id: settings.scope_id,
    enabled: settings.enabled === 1,
    method: settings.method,
    ready:
      settings.enabled === 1 &&
      (settings.method === 'copy' || (await destinationOf(db, settings, now)) !== undefined),
    can_dispatch: role !== null && roleCan(role, 'content'),
    subscription_id: settings.subscription_id,
    routine_id: settings.routine_id,
    connection_id: settings.connection_id,
    has_routine_token: settings.routine_token_enc !== null,
  };
}

export async function listAiSettings(db: MigrationDb, principal: Principal, now: string) {
  requireHumanSession(principal);
  const scopes = await listScopes(db, principal);
  return Promise.all(
    scopes.map(async (scope) =>
      settingsView(db, await settingsOfAi(db, principal.userId, scope.id), now),
    ),
  );
}

export async function putAiSettings(
  ctx: AuditContext,
  principal: Principal,
  scopeId: string,
  input: TaskAiSettingsInput,
  masterSecret: string,
): Promise<TaskAiSettings> {
  requireHumanSession(principal);
  await assertScopeAccess(ctx.tx, principal, scopeId);
  if (input.enabled && input.method !== 'copy')
    await assertScopeRole(ctx.tx, principal, scopeId, 'content');
  const current = await settingsOfAi(ctx.tx, principal.userId, scopeId);
  if (
    typeof input.subscription_id === 'string' &&
    !(await subscriptionOf(ctx.tx, principal.userId, scopeId, input.subscription_id))
  )
    throw notFound('subscription', input.subscription_id);
  if (
    typeof input.connection_id === 'string' &&
    (await eligibleConnections(ctx.tx, principal.userId, scopeId, ctx.now, input.connection_id))
      .length === 0
  )
    throw notFound('connection', input.connection_id);

  const next: SettingsRow = {
    ...current,
    enabled: input.enabled ? 1 : 0,
    method: input.method,
    subscription_id:
      input.subscription_id === undefined ? current.subscription_id : input.subscription_id,
    connection_id: input.connection_id === undefined ? current.connection_id : input.connection_id,
    routine_id: input.routine_id === undefined ? current.routine_id : input.routine_id,
  };
  if (next.routine_id === null || input.routine_token === null) next.routine_token_enc = null;
  else if (input.routine_token !== undefined)
    next.routine_token_enc = seal(
      masterSecret,
      routinePurpose(principal.userId, scopeId),
      input.routine_token,
    );
  else if (next.routine_id !== current.routine_id) next.routine_token_enc = null;
  if (current.revision !== '' && JSON.stringify(current) === JSON.stringify(next)) {
    ctx.noChange();
    return settingsView(ctx.tx, current, ctx.now);
  }

  next.revision = uuidv7();
  const saved = await sql<{ revision: string }>`
    INSERT INTO task_ai_settings (user_id, scope_id, enabled, method, subscription_id, connection_id,
      routine_id, routine_token_enc, revision)
    VALUES (${next.user_id}, ${scopeId}, ${next.enabled}, ${next.method}, ${next.subscription_id},
      ${next.connection_id}, ${next.routine_id}, ${next.routine_token_enc}, ${next.revision})
    ON CONFLICT (user_id, scope_id) DO UPDATE SET
      enabled = excluded.enabled, method = excluded.method, subscription_id = excluded.subscription_id,
      connection_id = excluded.connection_id, routine_id = excluded.routine_id,
      routine_token_enc = excluded.routine_token_enc, revision = excluded.revision
    WHERE task_ai_settings.revision = ${current.revision}
    RETURNING revision
  `.execute(ctx.tx);
  if (saved.rows.length === 0)
    throw new PolicyError(
      'task-ai-settings-conflict',
      'AI settings changed',
      409,
      'Reload settings before saving.',
    );
  ctx.record({ entityType: 'task_ai_settings', entityId: principal.userId, verb: 'updated' });
  return settingsView(ctx.tx, next, ctx.now);
}
