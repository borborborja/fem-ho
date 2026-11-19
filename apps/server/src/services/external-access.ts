import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { Principal } from '../policy/principal.js';
import { PolicyError } from '../policy/errors.js';

export function requireHumanSession(principal: Principal): void {
  if (
    principal.kind !== 'user' ||
    (principal.credentialType !== undefined && principal.credentialType !== 'session')
  )
    throw new PolicyError(
      'session-required',
      'Session required',
      403,
      'Manage external access from the app with your own session.',
    );
}

export async function readExternalAccess(db: MigrationDb, userId: string) {
  const { rows } = await sql<{
    api_enabled: number;
    mcp_enabled: number;
  }>`SELECT api_enabled, mcp_enabled FROM external_access WHERE user_id = ${userId}`.execute(db);
  // Els comptes previs no tenien interruptors. L'alta nova els crea apagats explícitament.
  return {
    api_enabled: rows[0] === undefined || Number(rows[0].api_enabled) === 1,
    mcp_enabled: rows[0] === undefined || Number(rows[0].mcp_enabled) === 1,
  };
}

export async function updateExternalAccess(
  ctx: AuditContext,
  principal: Principal,
  input: Record<string, unknown>,
) {
  requireHumanSession(principal);
  const before = await readExternalAccess(ctx.tx, principal.userId);
  for (const key of Object.keys(input)) {
    if (!['api_enabled', 'mcp_enabled'].includes(key) || typeof input[key] !== 'boolean')
      throw new PolicyError(
        'invalid-access',
        'Invalid access settings',
        422,
        'Use boolean API and MCP switches.',
      );
  }
  const apiEnabled = typeof input.api_enabled === 'boolean' ? Number(input.api_enabled) : null;
  const mcpEnabled = typeof input.mcp_enabled === 'boolean' ? Number(input.mcp_enabled) : null;
  // El consentiment MCP pot coincidir amb un canvi d'API fet des d'Ajustos.
  // Conservem el valor actual dels camps absents quan la base aplica el canvi.
  const { rows } = await sql<{ api_enabled: number; mcp_enabled: number }>`
    INSERT INTO external_access (user_id, api_enabled, mcp_enabled)
    VALUES (${principal.userId}, ${apiEnabled ?? Number(before.api_enabled)}, ${mcpEnabled ?? Number(before.mcp_enabled)})
    ON CONFLICT (user_id) DO UPDATE SET
      api_enabled = COALESCE(${apiEnabled}, external_access.api_enabled),
      mcp_enabled = COALESCE(${mcpEnabled}, external_access.mcp_enabled)
    RETURNING api_enabled, mcp_enabled`.execute(ctx.tx);
  const next = {
    api_enabled: Number(rows[0]!.api_enabled) === 1,
    mcp_enabled: Number(rows[0]!.mcp_enabled) === 1,
  };
  ctx.record({
    entityType: 'external_access',
    entityId: principal.userId,
    verb: 'updated',
    changes: {
      access: {
        from: {
          api_enabled: apiEnabled === null ? next.api_enabled : before.api_enabled,
          mcp_enabled: mcpEnabled === null ? next.mcp_enabled : before.mcp_enabled,
        },
        to: next,
      },
    },
  });
  return next;
}

export async function assertExternalChannel(
  db: MigrationDb,
  userId: string,
  channel: string,
  channels: string[],
) {
  const settings = await readExternalAccess(db, userId);
  if (
    !channels.includes(channel) ||
    (channel === 'api' && !settings.api_enabled) ||
    (channel === 'mcp' && !settings.mcp_enabled)
  )
    throw new PolicyError(
      'external-access-disabled',
      'External access disabled',
      403,
      'This credential or account does not allow this channel.',
    );
}
