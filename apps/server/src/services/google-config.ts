import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { Config } from '../config.js';
import { open, seal } from '../crypto/secret-box.js';
import type { MigrationDb } from '../db/migration-db.js';
import { missingCapability, PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';

const SETTING = 'google_oauth';
const PURPOSE = 'instance:google_oauth';

export type GoogleConfigInput = Pick<Config, 'googleClientId' | 'googleClientSecret' | 'baseUrl'>;
type ConfigSource = 'environment' | 'settings' | 'none';
type ConfigProblem = 'missing_credentials' | 'invalid_base_url' | 'unreadable_credentials';

export interface EffectiveGoogleConfig extends GoogleConfigInput {
  source: ConfigSource;
  configured: boolean;
  enabled: boolean;
  hasSecret: boolean;
  reason: ConfigProblem | null;
}

export interface AdminGoogleConfig {
  source: ConfigSource;
  enabled: boolean;
  client_id: string | null;
  has_secret: boolean;
  reason: ConfigProblem | null;
  gmail_callback_url: string | null;
  calendar_callback_url: string | null;
}

interface StoredGoogleConfig {
  clientId: string;
  encryptedSecret: string;
}

function callbackBase(baseUrl: string | undefined): URL | null {
  const url = baseUrl === undefined ? null : URL.parse(baseUrl);
  if (
    url === null ||
    url.username !== '' ||
    url.password !== '' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))
  )
    return null;
  return url;
}

async function loadStored(db: MigrationDb): Promise<string | undefined> {
  const result = await sql<{ value: string }>`
    SELECT value FROM instance_settings WHERE key = ${SETTING}
  `.execute(db);
  return result.rows[0]?.value;
}

function parseStored(stored: string): StoredGoogleConfig {
  const value: unknown = JSON.parse(stored);
  if (
    value === null ||
    typeof value !== 'object' ||
    !('clientId' in value) ||
    typeof value.clientId !== 'string' ||
    !('encryptedSecret' in value) ||
    typeof value.encryptedSecret !== 'string'
  )
    throw new Error('Invalid stored Google OAuth configuration');
  return { clientId: value.clientId, encryptedSecret: value.encryptedSecret };
}

function fromEnvironment(config: GoogleConfigInput): boolean {
  return config.googleClientId !== undefined || config.googleClientSecret !== undefined;
}

export async function resolveGoogleConfig(
  db: MigrationDb,
  secret: string,
  config: GoogleConfigInput,
): Promise<EffectiveGoogleConfig> {
  let source: ConfigSource = 'none';
  let googleClientId: string | undefined;
  let googleClientSecret: string | undefined;
  let hasSecret = false;
  let reason: ConfigProblem | null = null;

  // Una parella a mitges no pot recuperar l'altra meitat de la base: podria pertànyer a un altre client.
  if (fromEnvironment(config)) {
    source = 'environment';
    googleClientId = config.googleClientId?.trim() || undefined;
    googleClientSecret = config.googleClientSecret?.trim() || undefined;
    hasSecret = googleClientSecret !== undefined;
  } else {
    const stored = await loadStored(db);
    if (stored !== undefined) {
      source = 'settings';
      try {
        const pair = parseStored(stored);
        googleClientId = pair.clientId;
        hasSecret = true;
        googleClientSecret = open(secret, PURPOSE, pair.encryptedSecret);
      } catch {
        reason = 'unreadable_credentials';
      }
    }
  }

  const configured = !!googleClientId && !!googleClientSecret;
  if (source !== 'none' && reason === null && !configured) reason = 'missing_credentials';
  if (configured && callbackBase(config.baseUrl) === null) reason = 'invalid_base_url';
  return {
    baseUrl: config.baseUrl,
    googleClientId,
    googleClientSecret,
    source,
    configured,
    enabled: configured && reason === null,
    hasSecret,
    reason,
  };
}

function requireAdmin(principal: Principal): void {
  if (
    principal.kind !== 'user' ||
    principal.credentialType !== 'session' ||
    !hasCapability(principal, 'instance:manage')
  )
    throw missingCapability('instance:manage');
}

function requireEditable(principal: Principal, config: GoogleConfigInput): void {
  requireAdmin(principal);
  if (fromEnvironment(config))
    throw new PolicyError(
      'google-config-fixed',
      'Google configuration is fixed',
      409,
      'The environment controls the Google OAuth client.',
    );
}

export async function getAdminGoogleConfig(
  db: MigrationDb,
  principal: Principal,
  secret: string,
  config: GoogleConfigInput,
): Promise<AdminGoogleConfig> {
  requireAdmin(principal);
  const resolved = await resolveGoogleConfig(db, secret, config);
  const base = callbackBase(resolved.baseUrl);
  return {
    source: resolved.source,
    enabled: resolved.enabled,
    client_id: resolved.googleClientId ?? null,
    has_secret: resolved.hasSecret,
    reason: resolved.reason,
    gmail_callback_url:
      base === null ? null : new URL('/api/v1/mail/oauth/google/callback', base).href,
    calendar_callback_url:
      base === null ? null : new URL('/api/v1/calendars/google/oauth/callback', base).href,
  };
}

function invalidInput(): PolicyError {
  return new PolicyError(
    'google-config-invalid',
    'Invalid Google configuration',
    422,
    'Enter the OAuth client ID and its secret.',
  );
}

export async function putAdminGoogleConfig(
  ctx: AuditContext,
  principal: Principal,
  secret: string,
  config: GoogleConfigInput,
  input: { client_id?: unknown; client_secret?: unknown },
): Promise<AdminGoogleConfig> {
  requireEditable(principal, config);
  const id = typeof input.client_id === 'string' ? input.client_id.trim() : '';
  if (id === '' || id.length > 512) throw invalidInput();

  if (input.client_secret === undefined) {
    const previous = await resolveGoogleConfig(ctx.tx, secret, config);
    if (!previous.configured || previous.googleClientId !== id) throw invalidInput();
    ctx.noChange();
    return getAdminGoogleConfig(ctx.tx, principal, secret, config);
  }

  const clientSecret = typeof input.client_secret === 'string' ? input.client_secret.trim() : '';
  if (clientSecret === '' || clientSecret.length > 4096) throw invalidInput();

  const previous = await loadStored(ctx.tx);
  const value = JSON.stringify({
    clientId: id,
    encryptedSecret: seal(secret, PURPOSE, clientSecret),
  });
  const saved = await sql<{ key: string }>`
    INSERT INTO instance_settings (key, value, created_at, updated_at)
    VALUES (${SETTING}, ${value}, ${ctx.now}, ${ctx.now})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    WHERE instance_settings.value = ${previous ?? null}
    RETURNING key
  `.execute(ctx.tx);
  if (saved.rows.length === 0)
    throw new PolicyError(
      'google-config-changed',
      'Google configuration changed',
      409,
      'Reload the Google configuration before saving it again.',
    );

  ctx.record({
    entityType: 'instance',
    entityId: SETTING,
    verb: previous === undefined ? 'created' : 'updated',
  });
  return getAdminGoogleConfig(ctx.tx, principal, secret, config);
}

export async function deleteAdminGoogleConfig(
  ctx: AuditContext,
  principal: Principal,
  secret: string,
  config: GoogleConfigInput,
): Promise<AdminGoogleConfig> {
  requireEditable(principal, config);
  const removed = await sql<{ key: string }>`
    DELETE FROM instance_settings WHERE key = ${SETTING} RETURNING key
  `.execute(ctx.tx);
  if (removed.rows.length === 0) ctx.noChange();
  else ctx.record({ entityType: 'instance', entityId: SETTING, verb: 'deleted' });
  return getAdminGoogleConfig(ctx.tx, principal, secret, config);
}
