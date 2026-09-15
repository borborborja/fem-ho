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
  const next = {
    api_enabled: (input.api_enabled as boolean | undefined) ?? before.api_enabled,
    mcp_enabled: (input.mcp_enabled as boolean | undefined) ?? before.mcp_enabled,
  };
  await sql`INSERT INTO external_access (user_id, api_enabled, mcp_enabled)
    VALUES (${principal.userId}, ${Number(next.api_enabled)}, ${Number(next.mcp_enabled)})
    ON CONFLICT (user_id) DO UPDATE SET api_enabled = ${Number(next.api_enabled)}, mcp_enabled = ${Number(next.mcp_enabled)}`.execute(
    ctx.tx,
  );
  ctx.record({
    entityType: 'external_access',
    entityId: principal.userId,
    verb: 'updated',
    changes: { access: { from: before, to: next } },
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
