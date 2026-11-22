import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'kysely';
import { v7 as uuidv7, validate as isUuid } from 'uuid';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { open, seal } from '../crypto/secret-box.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { Connection } from '../db/connection.js';
import type { MigrationDb } from '../db/migration-db.js';
import {
  createGoogleCalendarProvider,
  googleCalendarConfigured,
  GoogleCalendarError,
  type GoogleCalendarConfig,
  type GoogleCalendarProvider,
} from '../net/google-calendar.js';
import { GoogleOAuthError, type GoogleTokens } from '../net/google-oauth.js';
import { missingCapability, PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { loadCalendar } from './events.js';
import { requireHumanSession } from './external-access.js';
import { assertScopeRole } from './scopes.js';

export type GoogleCalendarAccountStatus = 'connected' | 'reconnect_required' | 'disconnected';

interface Account {
  id: string;
  user_id: string;
  google_subject: string;
  email: string;
  client_id: string;
  secret_enc: string | null;
  oauth_status: GoogleCalendarAccountStatus;
  updated_at: string;
}

type AttemptStatus = 'pending' | 'exchanging' | 'ready' | 'failed' | 'cancelled' | 'completed';

interface Attempt {
  id: string;
  user_id: string;
  account_id: string;
  reconnect: boolean | number;
  client_id: string;
  source: Principal['source'];
  state_hash: string;
  verifier_enc: string | null;
  nonce: string;
  status: AttemptStatus;
  result_enc: string | null;
  email: string | null;
  error_code: string | null;
  expires_at: string;
}

export const googleCalendarSystem: Principal = {
  kind: 'user',
  userId: '',
  capabilities: new Set(),
  scopeIds: null,
  source: 'system',
};

const secretPurpose = (id: string): string => `google_calendar_oauth:${id}`;
const random = (): string => randomBytes(32).toString('base64url');
const digest = (value: string): string => createHash('sha256').update(value).digest('base64url');

export function googleCalendarProblem(code: string, status: number): PolicyError {
  return new PolicyError(`google-calendar-${code}`, 'Google Calendar', status, code);
}

function accountView(account: Pick<Account, 'id' | 'email' | 'oauth_status'>) {
  return { id: account.id, email: account.email, oauth_status: account.oauth_status };
}

function attemptView(
  attempt: Pick<Attempt, 'id' | 'account_id' | 'status' | 'email' | 'error_code' | 'expires_at'>,
) {
  const expired = attempt.status !== 'completed' && Date.parse(attempt.expires_at) <= Date.now();
  return {
    id: attempt.id,
    account_id: attempt.account_id,
    status: expired ? ('expired' as const) : attempt.status,
    email: attempt.email,
    error_code: expired ? 'expired' : attempt.error_code,
    expires_at: attempt.expires_at,
  };
}

async function accountById(db: MigrationDb, id: string): Promise<Account | undefined> {
  const { rows } =
    await sql<Account>`SELECT a.id, a.user_id, a.google_subject, a.email, a.client_id,
      a.secret_enc, a.oauth_status, a.updated_at
    FROM google_calendar_accounts a JOIN users u ON u.id = a.user_id
    WHERE a.id = ${id} AND u.deleted_at IS NULL`.execute(db);
  return rows[0];
}

async function ownAccount(db: MigrationDb, principal: Principal, id: string): Promise<Account> {
  requireHumanSession(principal);
  const account = await accountById(db, id);
  if (account?.user_id !== principal.userId) throw googleCalendarProblem('not_found', 404);
  return account;
}

function configuredProvider(config: GoogleCalendarConfig, provider?: GoogleCalendarProvider) {
  if (config.enabled === false) return undefined;
  return (
    provider ??
    (googleCalendarConfigured(config) ? createGoogleCalendarProvider(config) : undefined)
  );
}

export class GoogleCalendarService {
  private readonly provider: GoogleCalendarProvider | undefined;
  private readonly clientId: string;

  constructor(
    private readonly connection: Connection,
    private readonly secret: string,
    private readonly config: GoogleCalendarConfig,
    provider?: GoogleCalendarProvider,
  ) {
    this.provider = configuredProvider(config, provider);
    this.clientId = config.googleClientId ?? '';
  }

  get enabled(): boolean {
    return this.provider !== undefined;
  }

  async accounts(principal: Principal) {
    requireHumanSession(principal);
    const { rows } = await sql<Pick<Account, 'id' | 'email' | 'client_id' | 'oauth_status'>>`
      SELECT id, email, client_id, oauth_status FROM google_calendar_accounts
      WHERE user_id = ${principal.userId} ORDER BY email, id
    `.execute(this.connection.db);
    return rows.map((row) =>
      accountView({
        ...row,
        oauth_status:
          this.enabled && row.oauth_status === 'connected' && row.client_id !== this.clientId
            ? 'reconnect_required'
            : row.oauth_status,
      }),
    );
  }

  async start(principal: Principal, accountId?: string) {
    requireHumanSession(principal);
    if (!this.provider) throw googleCalendarProblem('not_configured', 503);
    if (accountId !== undefined) await ownAccount(this.connection.db, principal, accountId);
    const id = uuidv7();
    const target = accountId ?? uuidv7();
    const state = random();
    const verifier = random();
    const nonce = random();
    const expires = new Date(Date.now() + 10 * 60_000).toISOString();
    await auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        const found = await sql<{ n: number }>`SELECT COUNT(*) AS n
        FROM google_calendar_oauth_attempts WHERE user_id = ${principal.userId}
        AND status IN ('pending','exchanging','ready') AND expires_at > ${ctx.now}`.execute(ctx.tx);
        if (Number(found.rows[0]?.n) >= 5) throw googleCalendarProblem('too_many_attempts', 429);
        await sql`INSERT INTO google_calendar_oauth_attempts
        (id, user_id, account_id, reconnect, client_id, source, state_hash, verifier_enc, nonce, status, expires_at)
        VALUES (${id}, ${principal.userId}, ${target}, ${dbBool(accountId !== undefined)}, ${this.clientId},
          ${principal.source}, ${digest(state)}, ${seal(this.secret, secretPurpose(id), verifier)}, ${nonce},
          'pending', ${expires})`.execute(ctx.tx);
        ctx.record({ entityType: 'google_calendar_oauth_attempt', entityId: id, verb: 'created' });
      },
      { engine: this.connection.engine },
    );
    return {
      id,
      account_id: target,
      status: 'pending' as const,
      email: null,
      error_code: null,
      expires_at: expires,
      authorization_url: this.provider.authorizationUrl(state, digest(verifier), nonce),
    };
  }

  private async ownAttempt(principal: Principal, id: string): Promise<Attempt> {
    requireHumanSession(principal);
    const { rows } = await sql<Attempt>`SELECT * FROM google_calendar_oauth_attempts
      WHERE id = ${id} AND user_id = ${principal.userId}`.execute(this.connection.db);
    const attempt = rows[0];
    if (!attempt) throw googleCalendarProblem('not_found', 404);
    return attempt;
  }

  async status(principal: Principal, id: string) {
    return attemptView(await this.ownAttempt(principal, id));
  }

  async callback(state: string, code?: string, denied?: string): Promise<void> {
    if (state === '' || state.length > 256) return;
    const { rows } = await sql<Attempt>`SELECT a.* FROM google_calendar_oauth_attempts a
      JOIN users u ON u.id = a.user_id WHERE a.state_hash = ${digest(state)} AND a.status = 'pending'
        AND a.expires_at > ${new Date().toISOString()} AND u.deleted_at IS NULL`.execute(
      this.connection.db,
    );
    const attempt = rows[0];
    if (!attempt) return;
    const principal: Principal = {
      ...googleCalendarSystem,
      userId: attempt.user_id,
      source: attempt.source,
    };
    const claimed = await auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        const result = await sql`UPDATE google_calendar_oauth_attempts SET status = 'exchanging',
        verifier_enc = NULL WHERE id = ${attempt.id} AND status = 'pending' AND expires_at > ${ctx.now}
        RETURNING id`.execute(ctx.tx);
        if (result.rows.length === 0) {
          ctx.noChange();
          return false;
        }
        ctx.record({
          entityType: 'google_calendar_oauth_attempt',
          entityId: attempt.id,
          verb: 'updated',
        });
        return true;
      },
      { engine: this.connection.engine },
    );
    if (!claimed) return;

    let tokens: GoogleTokens | undefined;
    let failure: string | null = null;
    try {
      if (!this.provider || attempt.client_id !== this.clientId)
        throw new GoogleOAuthError('not_configured');
      if (denied || !code || !attempt.verifier_enc) throw new GoogleOAuthError('cancelled');
      tokens = await this.provider.exchange(
        code,
        open(this.secret, secretPurpose(attempt.id), attempt.verifier_enc),
        attempt.nonce,
      );
      if (!tokens.subject || !tokens.email) throw new GoogleOAuthError('invalid_identity');
      if (!tokens.refresh_token) throw new GoogleOAuthError('missing_refresh_token');
      if (isTrue(attempt.reconnect)) {
        const account = await ownAccount(this.connection.db, principal, attempt.account_id);
        if (account.google_subject !== tokens.subject)
          throw new GoogleOAuthError('identity_mismatch');
      }
    } catch (error) {
      failure = error instanceof GoogleOAuthError ? error.code : 'provider_unavailable';
    }
    await auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        const result = !failure && tokens ? tokens : undefined;
        const changed = await sql`UPDATE google_calendar_oauth_attempts
        SET status = ${result ? 'ready' : 'failed'},
          result_enc = ${result ? seal(this.secret, secretPurpose(attempt.id), JSON.stringify(result)) : null},
          email = ${result?.email ?? null}, error_code = ${failure}
        WHERE id = ${attempt.id} AND status = 'exchanging' AND expires_at > ${ctx.now} RETURNING id`.execute(
          ctx.tx,
        );
        if (changed.rows.length === 0) {
          ctx.noChange();
          return;
        }
        ctx.record({
          entityType: 'google_calendar_oauth_attempt',
          entityId: attempt.id,
          verb: 'updated',
        });
      },
      { engine: this.connection.engine },
    );
  }

  async confirm(principal: Principal, id: string) {
    const attempt = await this.ownAttempt(principal, id);
    if (attempt.status === 'completed')
      return accountView(await ownAccount(this.connection.db, principal, attempt.account_id));
    if (!this.enabled || attempt.client_id !== this.clientId)
      throw googleCalendarProblem('not_configured', 503);
    if (attemptView(attempt).status !== 'ready' || !attempt.result_enc)
      throw googleCalendarProblem('not_ready', 409);
    const tokens = JSON.parse(
      open(this.secret, secretPurpose(id), attempt.result_enc),
    ) as GoogleTokens;
    const result = await auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        const consumed = await sql`UPDATE google_calendar_oauth_attempts SET status = 'completed',
        result_enc = NULL WHERE id = ${id} AND user_id = ${principal.userId}
        AND status = 'ready' AND expires_at > ${ctx.now} RETURNING id`.execute(ctx.tx);
        if (consumed.rows.length === 0) {
          const next = await sql<
            Pick<Attempt, 'status'>
          >`SELECT status FROM google_calendar_oauth_attempts
          WHERE id = ${id} AND user_id = ${principal.userId}`.execute(ctx.tx);
          if (next.rows[0]?.status !== 'completed') throw googleCalendarProblem('not_ready', 409);
          ctx.noChange();
          return ownAccount(ctx.tx, principal, attempt.account_id);
        }
        const encrypted = seal(
          this.secret,
          secretPurpose(attempt.account_id),
          JSON.stringify(tokens),
        );
        const reconnect = isTrue(attempt.reconnect);
        if (reconnect) {
          const account = await ownAccount(ctx.tx, principal, attempt.account_id);
          if (account.google_subject !== tokens.subject)
            throw googleCalendarProblem('identity_mismatch', 409);
          await sql`UPDATE google_calendar_accounts SET email = ${tokens.email}, client_id = ${this.clientId},
          secret_enc = ${encrypted}, oauth_status = 'connected', oauth_lock = NULL, oauth_lock_until = NULL,
          updated_at = ${ctx.now} WHERE id = ${account.id}`.execute(ctx.tx);
          await sql`UPDATE google_calendar_links SET pull_lock = NULL, pull_lock_until = NULL,
          sync_token = NULL, sync_window_day = NULL WHERE account_id = ${account.id} AND deleted_at IS NULL`.execute(
            ctx.tx,
          );
          await sql`UPDATE calendars SET last_refreshed_at = NULL, last_error = NULL, last_error_at = NULL
          WHERE id IN (SELECT calendar_id FROM google_calendar_links
            WHERE account_id = ${account.id} AND deleted_at IS NULL)`.execute(ctx.tx);
        } else {
          const added = await sql`INSERT INTO google_calendar_accounts
          (id, user_id, google_subject, email, client_id, secret_enc, oauth_status, created_at, updated_at)
          VALUES (${attempt.account_id}, ${principal.userId}, ${tokens.subject}, ${tokens.email},
            ${this.clientId}, ${encrypted}, 'connected', ${ctx.now}, ${ctx.now})
          ON CONFLICT (user_id, google_subject) DO NOTHING RETURNING id`.execute(ctx.tx);
          if (added.rows.length === 0) throw googleCalendarProblem('account_exists', 409);
        }
        ctx.record({ entityType: 'google_calendar_oauth_attempt', entityId: id, verb: 'updated' });
        ctx.record({
          entityType: 'google_calendar_account',
          entityId: attempt.account_id,
          verb: reconnect ? 'updated' : 'created',
        });
        return ownAccount(ctx.tx, principal, attempt.account_id);
      },
      { engine: this.connection.engine },
    );
    return accountView(result);
  }

  async cancel(principal: Principal, id: string): Promise<void> {
    await this.ownAttempt(principal, id);
    await auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        const changed = await sql`UPDATE google_calendar_oauth_attempts SET status = 'cancelled',
        result_enc = NULL, verifier_enc = NULL
        WHERE id = ${id} AND status NOT IN ('completed','cancelled') RETURNING id`.execute(ctx.tx);
        if (changed.rows.length === 0) {
          ctx.noChange();
          return;
        }
        ctx.record({ entityType: 'google_calendar_oauth_attempt', entityId: id, verb: 'revoked' });
      },
      { engine: this.connection.engine },
    );
  }

  async disconnect(principal: Principal, id: string): Promise<void> {
    await ownAccount(this.connection.db, principal, id);
    await auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        const account = await sql`UPDATE google_calendar_accounts SET oauth_status = 'disconnected',
        secret_enc = NULL, oauth_lock = NULL, oauth_lock_until = NULL, updated_at = ${ctx.now}
        WHERE id = ${id} AND oauth_status <> 'disconnected' RETURNING id`.execute(ctx.tx);
        const attempts = await sql<{
          id: string;
        }>`UPDATE google_calendar_oauth_attempts SET status = 'cancelled',
        result_enc = NULL, verifier_enc = NULL
        WHERE account_id = ${id} AND status NOT IN ('completed','cancelled') RETURNING id`.execute(
          ctx.tx,
        );
        if (account.rows.length === 0 && attempts.rows.length === 0) {
          ctx.noChange();
          return;
        }
        await sql`UPDATE google_calendar_links SET pull_lock = NULL, pull_lock_until = NULL
        WHERE account_id = ${id} AND deleted_at IS NULL`.execute(ctx.tx);
        await sql`UPDATE calendars SET writable = ${dbBool(false)}, last_error = 'google-calendar-reconnect_required',
        last_error_at = ${ctx.now} WHERE id IN (
          SELECT calendar_id FROM google_calendar_links WHERE account_id = ${id} AND deleted_at IS NULL
        )`.execute(ctx.tx);
        if (account.rows.length > 0)
          ctx.record({ entityType: 'google_calendar_account', entityId: id, verb: 'revoked' });
        for (const attempt of attempts.rows)
          ctx.record({
            entityType: 'google_calendar_oauth_attempt',
            entityId: attempt.id,
            verb: 'revoked',
          });
      },
      { engine: this.connection.engine },
    );
  }

  async calendars(principal: Principal, id: string) {
    await ownAccount(this.connection.db, principal, id);
    if (!this.provider) throw googleCalendarProblem('not_configured', 503);
    const token = await googleCalendarAccessToken(
      this.connection.db,
      this.secret,
      this.config,
      id,
      this.provider,
    );
    return this.provider.listCalendars(token);
  }

  async link(
    principal: Principal,
    input: {
      id: string;
      accountId: string;
      remoteId: string;
      scopeId: string;
      writable: boolean | undefined;
    },
  ) {
    requireHumanSession(principal);
    if (!hasCapability(principal, 'events:write')) throw missingCapability('events:write');
    if (
      !isUuid(input.id) ||
      !isUuid(input.accountId) ||
      !isUuid(input.scopeId) ||
      input.remoteId === '' ||
      input.remoteId.length > 1024
    )
      throw googleCalendarProblem('invalid_link', 422);
    const checkScope = async (db: MigrationDb): Promise<void> => {
      const scope = await assertScopeRole(db, principal, input.scopeId, 'settings');
      // El calendari personal dins d'un àmbit només és visible al propietari de l'àmbit.
      if (scope.owner_id !== principal.userId)
        throw googleCalendarProblem('scope_owner_required', 403);
    };
    await checkScope(this.connection.db);
    await ownAccount(this.connection.db, principal, input.accountId);
    const sameLink = await matchingLink(this.connection.db, input);
    if (sameLink !== undefined)
      return { calendar: await loadCalendar(this.connection.db, sameLink), created: false };
    const calendar = (await this.calendars(principal, input.accountId)).find(
      (choice) => choice.id === input.remoteId,
    );
    if (!calendar) throw googleCalendarProblem('calendar_not_found', 404);
    if (input.writable === true && !calendar.writable)
      throw googleCalendarProblem('calendar_read_only', 403);
    return auditedTransaction(
      this.connection.db,
      principal,
      async (ctx) => {
        await checkScope(ctx.tx);
        const account = await ownAccount(ctx.tx, principal, input.accountId);
        if (account.oauth_status !== 'connected' || account.client_id !== this.clientId)
          throw googleCalendarProblem('reconnect_required', 409);
        const old = await matchingLink(ctx.tx, input);
        if (old !== undefined) {
          ctx.noChange();
          return { calendar: await loadCalendar(ctx.tx, old), created: false };
        }
        const canWrite = input.writable !== false && calendar.writable;
        const added = await sql`INSERT INTO calendars
        (id, scope_id, name, kind, origin, source_provider, writable, created_at, updated_at)
        VALUES (${input.id}, ${input.scopeId}, ${calendar.name}, 'events', 'subscription', 'google',
          ${dbBool(canWrite)}, ${ctx.now}, ${ctx.now})
        ON CONFLICT (id) DO NOTHING RETURNING id`.execute(ctx.tx);
        if (added.rows.length === 0) {
          const old = await matchingLink(ctx.tx, input);
          if (old === undefined) throw googleCalendarProblem('duplicate_link', 409);
          ctx.noChange();
          return { calendar: await loadCalendar(ctx.tx, old), created: false };
        }
        const linked = await sql`INSERT INTO google_calendar_links
        (calendar_id, scope_id, account_id, remote_calendar_id, access_role, write_enabled)
        VALUES (${input.id}, ${input.scopeId}, ${input.accountId}, ${input.remoteId}, ${calendar.access_role}, ${dbBool(canWrite)})
        ON CONFLICT DO NOTHING RETURNING calendar_id`.execute(ctx.tx);
        if (linked.rows.length === 0) {
          const current = await matchingLink(ctx.tx, input);
          if (current === undefined) throw googleCalendarProblem('duplicate_link', 409);
          // L'altra transacció ha concretat la mateixa vinculació abans nostre.
          await sql`DELETE FROM calendars WHERE id = ${input.id}`.execute(ctx.tx);
          ctx.noChange();
          return { calendar: await loadCalendar(ctx.tx, current), created: false };
        }
        ctx.record({
          entityType: 'calendar',
          entityId: input.id,
          scopeId: input.scopeId,
          verb: 'created',
        });
        return { calendar: await loadCalendar(ctx.tx, input.id), created: true };
      },
      { engine: this.connection.engine },
    );
  }
}

async function matchingLink(
  db: MigrationDb,
  input: { id: string; accountId: string; remoteId: string; scopeId: string },
): Promise<string | undefined> {
  const { rows } = await sql<{ calendar_id: string; account_id: string }>`
    SELECT l.calendar_id, l.account_id FROM google_calendar_links l
    JOIN calendars c ON c.id = l.calendar_id
    WHERE l.scope_id = ${input.scopeId} AND l.remote_calendar_id = ${input.remoteId}
      AND l.deleted_at IS NULL AND c.deleted_at IS NULL`.execute(db);
  const existing = rows[0];
  if (existing === undefined) return undefined;
  if (existing.account_id !== input.accountId) throw googleCalendarProblem('duplicate_link', 409);
  return existing.calendar_id;
}

export async function pruneGoogleCalendarOAuth(connection: Connection, now: string): Promise<void> {
  await auditedTransaction(
    connection.db,
    googleCalendarSystem,
    async (ctx) => {
      const removed = await sql<{ id: string }>`DELETE FROM google_calendar_oauth_attempts
      WHERE expires_at <= ${now} RETURNING id`.execute(ctx.tx);
      if (removed.rows.length === 0) ctx.noChange();
      for (const row of removed.rows)
        ctx.record({
          entityType: 'google_calendar_oauth_attempt',
          entityId: row.id,
          verb: 'deleted',
        });
    },
    { engine: connection.engine, now },
  );
}

/** La mateixa credencial serveix el selector i el planificador, amb una sola renovació. */
export async function googleCalendarAccessToken(
  db: MigrationDb,
  secret: string,
  config: GoogleCalendarConfig,
  accountId: string,
  providerOverride?: GoogleCalendarProvider,
): Promise<string> {
  const provider = configuredProvider(config, providerOverride);
  if (!provider) throw new GoogleCalendarError('not_configured');
  const deadline = Date.now() + 15_000;
  for (;;) {
    const account = await accountById(db, accountId);
    if (
      account?.oauth_status !== 'connected' ||
      !account.secret_enc ||
      account.client_id !== (config.googleClientId ?? '')
    )
      throw new GoogleCalendarError('reconnect_required', 409);
    let tokens: GoogleTokens;
    try {
      tokens = JSON.parse(
        open(secret, secretPurpose(accountId), account.secret_enc),
      ) as GoogleTokens;
    } catch {
      throw new GoogleCalendarError('reconnect_required', 409);
    }
    if (tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
    if (!tokens.refresh_token) throw new GoogleCalendarError('reconnect_required', 409);
    const lock = randomUUID();
    const now = new Date().toISOString();
    const claimed = await sql`UPDATE google_calendar_accounts SET oauth_lock = ${lock},
      oauth_lock_until = ${new Date(Date.now() + 20_000).toISOString()}
      WHERE id = ${accountId} AND secret_enc = ${account.secret_enc} AND oauth_status = 'connected'
        AND (oauth_lock IS NULL OR oauth_lock_until < ${now}) RETURNING id`.execute(db);
    if (claimed.rows.length === 0) {
      if (Date.now() >= deadline) throw new GoogleCalendarError('provider_unavailable');
      await delay(100);
      continue;
    }
    try {
      const fresh = await provider.refresh(tokens.refresh_token);
      const updated = {
        ...tokens,
        ...fresh,
        refresh_token: fresh.refresh_token ?? tokens.refresh_token,
      };
      const saved = await auditedTransaction(db, googleCalendarSystem, async (ctx) => {
        const result = await sql`UPDATE google_calendar_accounts
          SET secret_enc = ${seal(secret, secretPurpose(accountId), JSON.stringify(updated))},
            oauth_lock = NULL, oauth_lock_until = NULL
          WHERE id = ${accountId} AND oauth_lock = ${lock} AND secret_enc = ${account.secret_enc}
            AND oauth_status = 'connected' RETURNING id`.execute(ctx.tx);
        if (result.rows.length === 0) {
          ctx.noChange();
          return false;
        }
        ctx.record({
          entityType: 'google_calendar_account',
          entityId: accountId,
          verb: 'refreshed',
        });
        return true;
      });
      if (!saved) throw new GoogleCalendarError('reconnect_required', 409);
      return updated.access_token;
    } catch (error) {
      if (error instanceof GoogleCalendarError) throw error;
      if (
        error instanceof GoogleOAuthError &&
        ['reconnect_required', 'missing_scope'].includes(error.code)
      ) {
        await auditedTransaction(db, googleCalendarSystem, async (ctx) => {
          const changed =
            await sql`UPDATE google_calendar_accounts SET oauth_status = 'reconnect_required',
              secret_enc = NULL, updated_at = ${ctx.now}
            WHERE id = ${accountId} AND oauth_lock = ${lock} AND secret_enc = ${account.secret_enc}
            RETURNING id`.execute(ctx.tx);
          if (changed.rows.length === 0) {
            ctx.noChange();
            return;
          }
          ctx.record({
            entityType: 'google_calendar_account',
            entityId: accountId,
            verb: 'updated',
          });
        });
        throw new GoogleCalendarError('reconnect_required', 409);
      }
      throw new GoogleCalendarError('provider_unavailable');
    } finally {
      await sql`UPDATE google_calendar_accounts SET oauth_lock = NULL, oauth_lock_until = NULL
        WHERE id = ${accountId} AND oauth_lock = ${lock}`.execute(db);
    }
  }
}
