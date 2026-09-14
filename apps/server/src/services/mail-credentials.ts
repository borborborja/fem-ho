import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'kysely';
import type { Config } from '../config.js';
import type { MigrationDb } from '../db/migration-db.js';
import { open, seal } from '../crypto/secret-box.js';
import { auditedTransaction } from '../audit/audited-transaction.js';
import type { Principal } from '../policy/principal.js';
import { PolicyError } from '../policy/errors.js';
import {
  createGoogleMailProvider,
  GoogleOAuthError,
  type GoogleMailProvider,
  type GoogleTokens,
} from '../net/google-oauth.js';
import type { OAuthAccount } from './mail-oauth.js';

type CredentialConfig = Pick<Config, 'googleClientId' | 'googleClientSecret' | 'baseUrl'>;

/** Un sol camí de credencials per als tests, carpetes i planificador. */
export async function mailCredentials(
  db: MigrationDb,
  secret: string,
  config: CredentialConfig,
  accountId: string,
  userId: string,
  providerOverride?: GoogleMailProvider,
): Promise<{ password?: string; accessToken?: string }> {
  const deadline = Date.now() + 15_000;
  while (true) {
    const account = (
      await sql<OAuthAccount>`SELECT id,user_id,auth_method,secret_enc,oauth_status
      FROM mail_accounts WHERE id = ${accountId} AND user_id = ${userId} AND deleted_at IS NULL`.execute(
        db,
      )
    ).rows[0];
    if (!account?.secret_enc)
      throw new PolicyError(
        'mail-secret-required',
        'Credentials required',
        422,
        'Reconnect the mail account.',
      );
    if (account.auth_method !== 'google') {
      try {
        return { password: open(secret, `mail_account:${account.id}`, account.secret_enc) };
      } catch {
        throw new PolicyError(
          'mail-secret-unreadable',
          'Credentials unreadable',
          422,
          'Reconnect the mail account.',
        );
      }
    }
    if (account.oauth_status !== 'connected') throw new GoogleOAuthError('reconnect_required');
    let tokens: GoogleTokens;
    try {
      tokens = JSON.parse(
        open(secret, `mail_oauth:${account.id}`, account.secret_enc),
      ) as GoogleTokens;
    } catch {
      throw new GoogleOAuthError('reconnect_required');
    }
    if (tokens.expires_at > Date.now() + 60_000) return { accessToken: tokens.access_token };
    if (!tokens.refresh_token) throw new GoogleOAuthError('reconnect_required');
    const provider = providerOverride ?? createGoogleMailProvider(config);
    const lock = randomUUID();
    // Lease SQL: dos processos no poden renovar simultàniament el mateix refresh token.
    const claimed = await sql`UPDATE mail_accounts SET oauth_lock = ${lock},
      oauth_lock_until = ${new Date(Date.now() + 20_000).toISOString()}
      WHERE id = ${accountId} AND secret_enc = ${account.secret_enc} AND oauth_status = 'connected'
      AND (oauth_lock IS NULL OR oauth_lock_until < ${new Date().toISOString()}) RETURNING id`.execute(
      db,
    );
    if (!claimed.rows.length) {
      if (Date.now() >= deadline) throw new GoogleOAuthError('provider_unavailable');
      await delay(100);
      continue;
    }
    const principal: Principal = {
      kind: 'user',
      userId,
      capabilities: new Set(),
      scopeIds: null,
      source: 'system',
    };
    try {
      const updated = await provider.refresh(tokens.refresh_token);
      const next = {
        ...tokens,
        ...updated,
        refresh_token: updated.refresh_token ?? tokens.refresh_token,
      };
      const saved = await auditedTransaction(db, principal, async (ctx) => {
        const result = await sql`UPDATE mail_accounts SET
          secret_enc = ${seal(secret, `mail_oauth:${accountId}`, JSON.stringify(next))},
          oauth_lock = NULL, oauth_lock_until = NULL
          WHERE id = ${accountId} AND oauth_lock = ${lock} AND secret_enc = ${account.secret_enc}
          AND deleted_at IS NULL AND oauth_status = 'connected' RETURNING id`.execute(ctx.tx);
        if (!result.rows.length) {
          ctx.noChange();
          return false;
        }
        ctx.record({ entityType: 'mail_account', entityId: accountId, verb: 'refreshed' });
        return true;
      });
      if (!saved) throw new GoogleOAuthError('reconnect_required');
      return { accessToken: next.access_token };
    } catch (error) {
      if (
        error instanceof GoogleOAuthError &&
        ['reconnect_required', 'missing_scope'].includes(error.code)
      ) {
        await auditedTransaction(db, principal, async (ctx) => {
          const changed = await sql`UPDATE mail_accounts SET oauth_status = 'reconnect_required',
            last_error = 'mail-oauth-reconnect_required', last_error_at = ${ctx.now}
            WHERE id = ${accountId} AND oauth_lock = ${lock} AND secret_enc = ${account.secret_enc} RETURNING id`.execute(
            ctx.tx,
          );
          if (!changed.rows.length) {
            ctx.noChange();
            return;
          }
          ctx.record({
            entityType: 'mail_account',
            entityId: accountId,
            verb: 'updated',
            changes: { oauth_status: { from: 'connected', to: 'reconnect_required' } },
          });
        });
      }
      throw new GoogleOAuthError(
        error instanceof GoogleOAuthError ? error.code : 'provider_unavailable',
      );
    } finally {
      await sql`UPDATE mail_accounts SET oauth_lock = NULL, oauth_lock_until = NULL
        WHERE id = ${accountId} AND oauth_lock = ${lock}`.execute(db);
    }
  }
}
