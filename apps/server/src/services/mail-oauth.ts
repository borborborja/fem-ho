import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7, validate as isUuid } from 'uuid';
import type { components, Source } from '@fem-ho/contracts';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { open, seal } from '../crypto/secret-box.js';
import { dbBool } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import {
  GoogleOAuthError,
  type GoogleMailProvider,
  type GoogleTokens,
} from '../net/google-oauth.js';
import { missingCapability, PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { createMailAccount, listMailAccounts } from './mail.js';

type AttemptResult = components['schemas']['MailOAuthAttempt'];
interface Attempt {
  id: string;
  user_id: string;
  account_id: string;
  reconnect: number;
  source: Source;
  state_hash: string;
  verifier_enc: string | null;
  nonce: string;
  status: AttemptResult['status'];
  result_enc: string | null;
  email: string | null;
  error_code: string | null;
  expires_at: string;
}
export interface OAuthAccount {
  id: string;
  user_id: string;
  username: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  auth_method: string;
  google_subject: string | null;
  secret_enc: string | null;
  oauth_status: string | null;
}
const random = (): string => randomBytes(32).toString('base64url');
const digest = (s: string): string => createHash('sha256').update(s).digest('base64url');
const purpose = (id: string): string => `mail_oauth:${id}`;
function failure(code: string, status = 409): PolicyError {
  return new PolicyError(`mail-oauth-${code}`, 'Mail OAuth', status, code);
}
function requireOwner(principal: Principal): void {
  if (principal.kind !== 'user' || !hasCapability(principal, 'mail:write'))
    throw missingCapability('mail:write');
}
function view(attempt: Attempt): AttemptResult {
  const expired = Date.parse(attempt.expires_at) <= Date.now() && attempt.status !== 'completed';
  return {
    id: attempt.id,
    account_id: attempt.account_id,
    status: expired ? 'expired' : attempt.status,
    expires_at: attempt.expires_at,
    email: attempt.email,
    error_code: expired ? 'expired' : attempt.error_code,
  };
}

export async function ownOAuthAccount(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<OAuthAccount> {
  requireOwner(principal);
  const row = (
    await sql<OAuthAccount>`SELECT id, user_id, username, host, port, security,
    auth_method, google_subject, secret_enc, oauth_status FROM mail_accounts
    WHERE id = ${id} AND user_id = ${principal.userId} AND deleted_at IS NULL`.execute(db)
  ).rows[0];
  if (!row) throw failure('not_found', 404);
  return row;
}

export class MailOAuthService {
  constructor(
    private db: MigrationDb,
    private secret: string,
    private provider?: GoogleMailProvider,
  ) {}

  async start(principal: Principal, accountId: string, reconnect: boolean) {
    requireOwner(principal);
    if (!this.provider) throw failure('not_configured', 503);
    if (!isUuid(accountId)) throw failure('invalid_account', 422);
    if (reconnect) {
      const account = await ownOAuthAccount(this.db, principal, accountId);
      if (!['imap.gmail.com', 'imap.googlemail.com'].includes(account.host))
        throw failure('not_google', 422);
    } else if (
      (await sql`SELECT id FROM mail_accounts WHERE id = ${accountId}`.execute(this.db)).rows
        .length > 0
    ) {
      throw failure('account_exists');
    }
    const state = random(),
      verifier = random(),
      nonce = random(),
      id = uuidv7();
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    await auditedTransaction(this.db, principal, async (ctx) => {
      // Neteja limitada al propietari: no s'exporten intents ni credencials temporals.
      await sql`DELETE FROM mail_oauth_attempts WHERE user_id = ${principal.userId} AND expires_at < ${ctx.now}`.execute(
        ctx.tx,
      );
      const count = (
        await sql<{ n: number }>`SELECT COUNT(*) AS n FROM mail_oauth_attempts
        WHERE user_id = ${principal.userId} AND status IN ('pending','exchanging','ready')`.execute(
          ctx.tx,
        )
      ).rows[0];
      if (Number(count?.n) >= 5) throw failure('too_many_attempts', 429);
      await sql`INSERT INTO mail_oauth_attempts
        (id,user_id,account_id,reconnect,source,state_hash,verifier_enc,nonce,status,expires_at)
        VALUES (${id},${principal.userId},${accountId},${reconnect ? 1 : 0},${principal.source},
          ${digest(state)},${seal(this.secret, purpose(id), verifier)},${nonce},'pending',${expires})`.execute(
        ctx.tx,
      );
      ctx.record({ entityType: 'mail_oauth_attempt', entityId: id, verb: 'created' });
    });
    return {
      id,
      account_id: accountId,
      status: 'pending' as const,
      expires_at: expires,
      email: null,
      error_code: null,
      authorization_url: this.provider.authorizationUrl(state, digest(verifier), nonce),
    };
  }

  private async attempt(principal: Principal, id: string): Promise<Attempt> {
    requireOwner(principal);
    const row = (
      await sql<Attempt>`SELECT * FROM mail_oauth_attempts
      WHERE id = ${id} AND user_id = ${principal.userId}`.execute(this.db)
    ).rows[0];
    if (!row) throw failure('not_found', 404);
    return row;
  }
  async status(principal: Principal, id: string): Promise<AttemptResult> {
    return view(await this.attempt(principal, id));
  }

  async callback(state: string, code?: string, denied?: string): Promise<void> {
    if (!state || state.length > 256) return;
    const attempt = (
      await sql<Attempt>`SELECT * FROM mail_oauth_attempts
      WHERE state_hash = ${digest(state)} AND status = 'pending' AND expires_at > ${new Date().toISOString()}`.execute(
        this.db,
      )
    ).rows[0];
    if (!attempt) return;
    const principal: Principal = {
      kind: 'user',
      userId: attempt.user_id,
      capabilities: new Set(['mail:write']),
      scopeIds: null,
      source: attempt.source,
    };
    const claimed = await auditedTransaction(this.db, principal, async (ctx) => {
      const row =
        await sql`UPDATE mail_oauth_attempts SET status = 'exchanging', verifier_enc = NULL
        WHERE id = ${attempt.id} AND status = 'pending' RETURNING id`.execute(ctx.tx);
      if (row.rows.length === 0) {
        ctx.noChange();
        return false;
      }
      ctx.record({ entityType: 'mail_oauth_attempt', entityId: attempt.id, verb: 'updated' });
      return true;
    });
    if (!claimed) return;
    let result: GoogleTokens | undefined;
    let error: string | null = null;
    try {
      if (!this.provider) throw new GoogleOAuthError('not_configured');
      if (denied || !code || !attempt.verifier_enc) throw new GoogleOAuthError('cancelled');
      result = await this.provider.exchange(
        code,
        open(this.secret, purpose(attempt.id), attempt.verifier_enc),
        attempt.nonce,
      );
      if (!result.email || !result.subject) throw new GoogleOAuthError('invalid_identity');
      if (attempt.reconnect) {
        const account = await ownOAuthAccount(this.db, principal, attempt.account_id);
        if (
          account.username.toLowerCase() !== result.email ||
          (account.google_subject && account.google_subject !== result.subject)
        ) {
          throw new GoogleOAuthError('identity_mismatch');
        }
      }
      if (!result.refresh_token) {
        const account = attempt.reconnect
          ? await ownOAuthAccount(this.db, principal, attempt.account_id)
          : null;
        if (
          account?.auth_method === 'google' &&
          account.google_subject === result.subject &&
          account.secret_enc
        ) {
          result.refresh_token = (
            JSON.parse(open(this.secret, purpose(account.id), account.secret_enc)) as GoogleTokens
          ).refresh_token;
        }
        if (!result.refresh_token) throw new GoogleOAuthError('missing_refresh_token');
      }
    } catch (cause) {
      error = cause instanceof GoogleOAuthError ? cause.code : 'provider_unavailable';
    }
    await auditedTransaction(this.db, principal, async (ctx) => {
      const done = await sql`UPDATE mail_oauth_attempts SET status = ${error ? 'failed' : 'ready'},
        result_enc = ${!error && result ? seal(this.secret, purpose(attempt.id), JSON.stringify(result)) : null},
        email = ${!error ? (result?.email ?? null) : null}, error_code = ${error}
        WHERE id = ${attempt.id} AND status = 'exchanging' AND expires_at > ${ctx.now} RETURNING id`.execute(
        ctx.tx,
      );
      if (!done.rows.length) {
        ctx.noChange();
        return;
      }
      ctx.record({ entityType: 'mail_oauth_attempt', entityId: attempt.id, verb: 'updated' });
    });
  }

  async confirm(principal: Principal, id: string) {
    const attempt = await this.attempt(principal, id);
    if (attempt.status === 'completed') {
      const account = (await listMailAccounts(this.db, principal)).find(
        (a) => a.id === attempt.account_id,
      );
      if (!account) throw failure('not_found', 404);
      return account;
    }
    if (view(attempt).status !== 'ready' || !attempt.result_enc) throw failure('not_ready');
    const tokens = JSON.parse(open(this.secret, purpose(id), attempt.result_enc)) as GoogleTokens;
    await auditedTransaction(this.db, principal, async (ctx) => {
      const consumed =
        await sql`UPDATE mail_oauth_attempts SET status = 'completed', result_enc = NULL
        WHERE id = ${id} AND user_id = ${principal.userId} AND status = 'ready' AND expires_at > ${ctx.now} RETURNING id`.execute(
          ctx.tx,
        );
      if (!consumed.rows.length) throw failure('not_ready');
      let previousMethod: string | null = null;
      if (attempt.reconnect) {
        const account = await ownOAuthAccount(ctx.tx, principal, attempt.account_id);
        previousMethod = account.auth_method;
        if (
          account.username.toLowerCase() !== tokens.email ||
          (account.google_subject && account.google_subject !== tokens.subject)
        )
          throw failure('identity_mismatch');
      } else {
        const duplicate = await sql`SELECT id FROM mail_accounts WHERE user_id = ${principal.userId}
          AND deleted_at IS NULL AND host IN ('imap.gmail.com','imap.googlemail.com') AND LOWER(username) = ${tokens.email}`.execute(
          ctx.tx,
        );
        if (duplicate.rows.length) throw failure('account_exists');
        await createMailAccount(ctx, principal, {
          id: attempt.account_id,
          name: tokens.email,
          host: 'imap.gmail.com',
          username: tokens.email,
        });
      }
      await sql`UPDATE mail_accounts SET auth_method = 'google', google_subject = ${tokens.subject},
        secret_enc = ${seal(this.secret, purpose(attempt.account_id), JSON.stringify(tokens))},
        host = 'imap.gmail.com', port = 993, security = 'tls', oauth_status = 'connected',
        oauth_lock = NULL, oauth_lock_until = NULL, enabled = ${dbBool(true)},
        consecutive_errors = 0, last_error = NULL, last_error_at = NULL, last_polled_at = NULL, updated_at = ${ctx.now}
        WHERE id = ${attempt.account_id} AND user_id = ${principal.userId}`.execute(ctx.tx);
      ctx.record({
        entityType: 'mail_account',
        entityId: attempt.account_id,
        verb: 'updated',
        changes: { auth_method: { from: previousMethod, to: 'google' } },
      });
    });
    return (await listMailAccounts(this.db, principal)).find((a) => a.id === attempt.account_id)!;
  }

  async cancel(principal: Principal, id: string): Promise<void> {
    await this.attempt(principal, id);
    await auditedTransaction(this.db, principal, async (ctx) => {
      await sql`UPDATE mail_oauth_attempts SET status = 'cancelled', result_enc = NULL, verifier_enc = NULL
        WHERE id = ${id} AND status <> 'completed'`.execute(ctx.tx);
      ctx.record({ entityType: 'mail_oauth_attempt', entityId: id, verb: 'revoked' });
    });
  }
}

/** Esborra també els secrets temporals d'usuaris que no tornin a iniciar cap intent. */
export async function pruneMailOAuth(db: MigrationDb, now: string): Promise<void> {
  const principal: Principal = {
    kind: 'user',
    userId: '',
    capabilities: new Set(),
    scopeIds: null,
    source: 'system',
  };
  await auditedTransaction(db, principal, async (ctx) => {
    const removed = await sql<{ id: string }>`DELETE FROM mail_oauth_attempts
      WHERE expires_at <= ${now} RETURNING id`.execute(ctx.tx);
    if (!removed.rows.length) {
      ctx.noChange();
      return;
    }
    for (const row of removed.rows)
      ctx.record({ entityType: 'mail_oauth_attempt', entityId: row.id, verb: 'deleted' });
  });
}

export async function disconnectGoogleMail(
  db: MigrationDb,
  principal: Principal,
  id: string,
): Promise<void> {
  const account = await ownOAuthAccount(db, principal, id);
  if (account.auth_method !== 'google') throw failure('not_google', 422);
  await auditedTransaction(db, principal, async (ctx) => {
    await sql`UPDATE mail_accounts SET secret_enc = NULL, oauth_status = 'disconnected',
      oauth_lock = NULL, oauth_lock_until = NULL, enabled = ${dbBool(false)}, updated_at = ${ctx.now}
      WHERE id = ${id} AND user_id = ${principal.userId}`.execute(ctx.tx);
    await sql`UPDATE mail_oauth_attempts SET status = 'cancelled', result_enc = NULL, verifier_enc = NULL
      WHERE account_id = ${id} AND user_id = ${principal.userId} AND status <> 'completed'`.execute(
      ctx.tx,
    );
    ctx.record({ entityType: 'mail_account', entityId: id, verb: 'revoked' });
  });
}
