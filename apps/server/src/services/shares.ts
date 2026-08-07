/**
 * Enllaços públics (docs/10 §1–§5).
 *
 * Tres coses que **no són opcionals**:
 *
 * 1. **El token no es guarda mai en clar.** A la base hi ha `token_hmac`, calculat amb
 *    un pebre del servidor: si algú es queda una còpia de la base, no en pot treure cap
 *    enllaç funcional. `secret_version` permet rotar el pebre sense invalidar-ho tot.
 * 2. **No hi ha cap columna d'IP enlloc.** És una decisió de privadesa deliberada. Els
 *    accessos es registren amb un identificador pseudònim.
 * 3. **La contrasenya es xifra amb argon2id**, igual que les dels usuaris.
 *
 * I una quarta que és de disseny, no d'emmagatzematge: **no es filtra si un enllaç
 * existeix**. Un token inventat i un de revocat donen exactament la mateixa resposta i
 * triguen el mateix.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { dbBool } from '../db/bool.js';
import type { AuditContext } from '../audit/audited-transaction.js';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password.js';
import type { MigrationDb } from '../db/migration-db.js';
import type { Capability } from '../policy/capabilities.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { assertScopeAccess } from './scopes.js';

/** L'alfabet del token: segur per a URL i sense caràcters que es confonguin. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** 32 caràcters d'aquest alfabet són ~183 bits: no s'endevina. */
const TOKEN_LENGTH = 32;

export const SHARE_PERMISSIONS = ['view', 'check', 'comment'] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

/** 5 intents per 15 minuts, **per enllaç i no per IP** (docs/10 §4). */
export const MAX_PASSWORD_ATTEMPTS = 5;

/**
 * El mínim d'una contrasenya de compartit.
 *
 * **No és el mateix que el d'un compte**, que són 10. `docs/10` no en fixa cap, i
 * heretar el dels usuaris faria la funció inservible: ningú escriu deu caràcters per
 * veure la llista de la maleta, i el resultat seria que la gent no en posaria cap.
 *
 * El que protegeix aquí no és la llargada sinó **el bloqueig a cinc intents amb espera
 * creixent**: amb això, provar-les totes no és una opció encara que siguin sis
 * caràcters. Una contrasenya d'usuari no té aquesta xarxa i per això n'hi cal més.
 */
export const MIN_SHARE_PASSWORD_LENGTH = 6;
const LOCK_BASE_MS = 60_000;
const LOCK_MAX_MS = 60 * 60_000;

export function generateShareToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = '';
  for (const byte of bytes) token += ALPHABET[byte % ALPHABET.length];
  return token;
}

/**
 * L'HMAC del token amb el pebre del servidor.
 *
 * HMAC i no un hash pelat: sense el pebre, qui es quedés la base podria provar tokens
 * candidats offline. Amb el pebre, per fer-ho també li cal el secret de la instància.
 */
export function tokenHmac(token: string, pepper: string, version = 1): string {
  return createHmac('sha256', `${pepper}:v${String(version)}`)
    .update(token)
    .digest('hex');
}

export interface Share {
  id: string;
  /** Qui el va crear. És en nom de qui llegeix el convidat. */
  created_by: string;
  task_id: string | null;
  checklist_id: string | null;
  permission: SharePermission;
  require_name: boolean;
  has_password: boolean;
  expires_at: string | null;
  max_views: number | null;
  view_count: number;
  created_at: string;
  revoked_at: string | null;
}

interface ShareRow {
  id: string;
  created_by: string;
  task_id: string | null;
  checklist_id: string | null;
  permission: SharePermission;
  require_name: number | boolean;
  password_hash: string | null;
  expires_at: string | null;
  max_views: number | null;
  view_count: number;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  revoked_at: string | null;
  secret_version: number;
}

function toShare(row: ShareRow): Share {
  return {
    id: row.id,
    created_by: row.created_by,
    task_id: row.task_id,
    checklist_id: row.checklist_id,
    permission: row.permission,
    require_name: row.require_name === true || row.require_name === 1,
    has_password: row.password_hash !== null,
    expires_at: row.expires_at,
    max_views: row.max_views,
    view_count: row.view_count,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

export interface CreateShareInput {
  task_id?: string | undefined;
  checklist_id?: string | undefined;
  permission?: SharePermission | undefined;
  password?: string | undefined;
  require_name?: boolean | undefined;
  expires_at?: string | null | undefined;
  max_views?: number | null | undefined;
}

export async function createShare(
  ctx: AuditContext,
  principal: Principal,
  input: CreateShareInput,
  pepper: string,
): Promise<{ token: string; share: Share }> {
  if (!hasCapability(principal, 'shares:write')) throw missingCapability('shares:write');

  if ((input.task_id === undefined) === (input.checklist_id === undefined)) {
    throw new PolicyError(
      'target-required',
      'Target required',
      422,
      'A link is for a task **or** for a checklist, not for both and not for neither. Whole projects and scopes are not shared.',
    );
  }

  const scopeId = await targetScope(ctx.tx, input);
  await assertScopeAccess(ctx.tx, principal, scopeId);

  const permission = input.permission ?? 'view';
  if (!SHARE_PERMISSIONS.includes(permission)) {
    // **No hi ha permís d'edició** (D10): un convidat anònim marca ítems i comenta, no
    // reescriu tasques.
    throw new PolicyError(
      'invalid-permission',
      'Invalid permission',
      422,
      'The permission has to be `view`, `check` or `comment`. There is no edit permission.',
    );
  }

  const hasPassword = input.password !== undefined && input.password !== '';
  if (hasPassword && input.password!.length < MIN_SHARE_PASSWORD_LENGTH) {
    throw new PolicyError(
      'weak-share-password',
      'Weak password',
      422,
      `The link password needs at least ${String(MIN_SHARE_PASSWORD_LENGTH)} characters.`,
      { min: MIN_SHARE_PASSWORD_LENGTH },
    );
  }

  const token = generateShareToken();
  const id = uuidv7();

  await sql`
    INSERT INTO shares (id, task_id, checklist_id, created_by, token_hmac, secret_version,
                        password_hash, require_name, permission, expires_at, max_views,
                        created_at)
    VALUES (${id}, ${input.task_id ?? null}, ${input.checklist_id ?? null}, ${principal.userId},
            ${tokenHmac(token, pepper)}, 1,
            ${hasPassword ? await hashSharePassword(input.password!) : null},
            ${dbBool(input.require_name === true)}, ${permission},
            ${input.expires_at ?? null}, ${input.max_views ?? null}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'share',
    entityId: id,
    scopeId,
    verb: 'shared',
    // El token **no** entra a l'historial: si hi fos, qui llegís l'historial tindria
    // l'enllaç funcional que la base de dades no guarda a posta.
    changes: { permission: { from: null, to: permission } },
  });

  return {
    token,
    share: {
      id,
      created_by: principal.userId,
      task_id: input.task_id ?? null,
      checklist_id: input.checklist_id ?? null,
      permission,
      require_name: input.require_name === true,
      has_password: hasPassword,
      expires_at: input.expires_at ?? null,
      max_views: input.max_views ?? null,
      view_count: 0,
      created_at: ctx.now,
      revoked_at: null,
    },
  };
}

/**
 * argon2id, igual que les dels usuaris (docs/10 §3) però sense el mínim d'aquelles: el
 * comprova `createShare` amb el seu propi llindar.
 */
async function hashSharePassword(plain: string): Promise<string> {
  return hashPassword(plain.padEnd(MIN_USER_PASSWORD_PADDING, SHARE_PAD));
}

/**
 * El farciment.
 *
 * `hashPassword` imposa el mínim dels comptes. En comptes de duplicar la configuració
 * d'argon2id per saltar-se'l —que voldria dir mantenir dos jocs de paràmetres i que un
 * es quedés enrere—, la contrasenya s'allarga amb un farciment fix abans de xifrar-la.
 * El farciment és constant i conegut: no aporta entropia i no pretén fer-ho, només fa
 * que la mateixa funció serveixi per als dos casos.
 */
const SHARE_PAD = '\u0000';
const MIN_USER_PASSWORD_PADDING = 10;

async function targetScope(db: MigrationDb, input: CreateShareInput): Promise<string> {
  if (input.task_id !== undefined) {
    const found = await sql<{ scope_id: string }>`
      SELECT scope_id FROM tasks WHERE id = ${input.task_id} AND deleted_at IS NULL
    `.execute(db);
    const scopeId = found.rows[0]?.scope_id;
    if (scopeId === undefined) throw notFound('task', input.task_id);
    return scopeId;
  }

  const found = await sql<{ scope_id: string }>`
    SELECT t.scope_id FROM checklists c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.id = ${input.checklist_id!} AND c.deleted_at IS NULL
  `.execute(db);
  const scopeId = found.rows[0]?.scope_id;
  if (scopeId === undefined) throw notFound('checklist', input.checklist_id!);
  return scopeId;
}

export async function listShares(db: MigrationDb, principal: Principal): Promise<Share[]> {
  if (!hasCapability(principal, 'shares:read')) throw missingCapability('shares:read');

  const found = await sql<ShareRow>`
    SELECT id, created_by, task_id, checklist_id, permission, require_name, password_hash,
           expires_at, max_views, view_count, failed_attempts, locked_until, created_at,
           revoked_at, secret_version
    FROM shares WHERE created_by = ${principal.userId}
    ORDER BY created_at DESC
  `.execute(db);

  return found.rows.map(toShare);
}

export async function revokeShare(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'shares:write')) throw missingCapability('shares:write');

  const found = await sql<{ revoked_at: string | null }>`
    SELECT revoked_at FROM shares WHERE id = ${id} AND created_by = ${principal.userId}
  `.execute(ctx.tx);
  if (found.rows.length === 0) throw notFound('share', id);

  if (found.rows[0]?.revoked_at !== null) {
    ctx.noChange();
    return;
  }

  await sql`UPDATE shares SET revoked_at = ${ctx.now} WHERE id = ${id}`.execute(ctx.tx);
  ctx.record({ entityType: 'share', entityId: id, scopeId: null, verb: 'deleted', changes: {} });
}

/**
 * El resultat d'obrir un enllaç.
 *
 * `needs_password` i `needs_name` no diuen si l'enllaç existeix: un token inventat torna
 * exactament el mateix que un de bo amb contrasenya.
 */
export type OpenResult =
  | { ok: true; share: Share; guestRef: string; guestName: string | null }
  | {
      ok: false;
      reason: 'needs_password' | 'needs_name' | 'unavailable' | 'locked';
      retryAfterMs?: number;
    };

export interface OpenShareInput {
  token: string;
  password?: string | undefined;
  name?: string | undefined;
}

/**
 * Obre un enllaç.
 *
 * **No es filtra si existeix** (docs/10 §4): un token inventat i un de revocat donen la
 * mateixa resposta i triguen el mateix. Si un donés 404 i l'altre demanés contrasenya,
 * es podrien enumerar enllaços provant tokens.
 *
 * Per fer que triguin igual, quan no hi ha fila es verifica igualment contra un hash de
 * mentida: la comparació d'argon2id és el que domina el temps de la petició.
 */
export async function openShare(
  ctx: AuditContext,
  input: OpenShareInput,
  pepper: string,
): Promise<OpenResult> {
  const found = await sql<ShareRow>`
    SELECT id, created_by, task_id, checklist_id, permission, require_name, password_hash,
           expires_at, max_views, view_count, failed_attempts, locked_until, created_at,
           revoked_at, secret_version
    FROM shares WHERE token_hmac = ${tokenHmac(input.token, pepper)}
  `.execute(ctx.tx);

  const row = found.rows[0];

  // Sense fila: es gasta el mateix temps que amb una, i es respon el mateix que un
  // enllaç amb contrasenya. Qui prova tokens no aprèn res.
  if (row === undefined) {
    await verifyPassword(input.password ?? 'res', DUMMY_HASH);
    ctx.noChange();
    return { ok: false, reason: 'needs_password' };
  }

  if (row.locked_until !== null && row.locked_until > ctx.now) {
    ctx.noChange();
    return {
      ok: false,
      reason: 'locked',
      retryAfterMs: Date.parse(row.locked_until) - Date.parse(ctx.now),
    };
  }

  /**
   * Revocat, caducat o esgotat: **tots tres es responen igual que un token inventat**.
   * Un "aquest enllaç ja no val" confirmaria que existia, i això ja és informació.
   */
  const unavailable =
    row.revoked_at !== null ||
    (row.expires_at !== null && row.expires_at <= ctx.now) ||
    (row.max_views !== null && row.view_count >= row.max_views);

  if (unavailable) {
    await verifyPassword(input.password ?? 'res', DUMMY_HASH);
    ctx.noChange();
    return { ok: false, reason: 'needs_password' };
  }

  if (row.password_hash !== null) {
    if (input.password === undefined) {
      ctx.noChange();
      return { ok: false, reason: 'needs_password' };
    }

    const ok = await verifyPassword(
      input.password.padEnd(MIN_USER_PASSWORD_PADDING, SHARE_PAD),
      row.password_hash,
    );
    if (!ok) {
      const attempts = row.failed_attempts + 1;
      const lockedUntil =
        attempts >= MAX_PASSWORD_ATTEMPTS
          ? new Date(
              Date.parse(ctx.now) +
                Math.min(LOCK_BASE_MS * 2 ** (attempts - MAX_PASSWORD_ATTEMPTS), LOCK_MAX_MS),
            ).toISOString()
          : null;

      await sql`
        UPDATE shares SET failed_attempts = ${attempts},
                          locked_until = ${lockedUntil}
        WHERE id = ${row.id}
      `.execute(ctx.tx);

      /**
       * Un intent fallit escriu el comptador però **no deixa entrada d'historial**: qui
       * hi ha darrere encara no és ningú —no hi ha `guest_ref`— i registrar-ho ompliria
       * l'historial de la tasca amb el soroll de qui prova contrasenyes.
       */
      ctx.noChange();
      return { ok: false, reason: 'needs_password' };
    }
  }

  const requireName = row.require_name === true || row.require_name === 1;
  if (requireName && (input.name === undefined || input.name.trim() === '')) {
    ctx.noChange();
    return { ok: false, reason: 'needs_name' };
  }

  /**
   * `guest_ref` es genera **aleatòriament per sessió** i no es deriva de res que
   * identifiqui la persona: ni de l'agent d'usuari, ni de la xarxa, ni del nom
   * (docs/10 §5).
   */
  const guestRef = randomBytes(2).toString('hex');
  const guestName = input.name?.trim() === '' ? null : (input.name?.trim() ?? null);

  await sql`
    INSERT INTO share_accesses (id, share_id, guest_name, guest_ref, first_seen, last_seen)
    VALUES (${uuidv7()}, ${row.id}, ${guestName}, ${guestRef}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  await sql`
    UPDATE shares SET view_count = view_count + 1, failed_attempts = 0, locked_until = NULL
    WHERE id = ${row.id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'share',
    entityId: row.id,
    scopeId: null,
    verb: 'shared',
    changes: { view_count: { from: row.view_count, to: row.view_count + 1 } },
  });

  return { ok: true, share: toShare(row), guestRef, guestName };
}

/** "Extern · Marta" amb nom, "Extern · a4f2" sense (docs/10 §5). */
export function guestLabel(guestName: string | null, guestRef: string): string {
  return guestName === null ? `Extern · ${guestRef}` : `Extern · ${guestName}`;
}

/**
 * El principal d'un convidat.
 *
 * **Limitat a aquest enllaç i a res més** (docs/10 §4): no és una sessió d'usuari, no
 * serveix per a cap altre enllaç ni per a cap ruta de l'API. Les capacitats surten
 * només del permís.
 */
export function guestPrincipal(
  share: Share,
  guestRef: string,
  guestName: string | null,
): Principal {
  const capabilities = new Set<Capability>(['tasks:read', 'checklists:read', 'comments:read']);
  if (share.permission === 'check') capabilities.add('checklists:write');
  if (share.permission === 'comment') {
    capabilities.add('checklists:write');
    capabilities.add('comments:write');
  }

  return {
    kind: 'guest',
    /**
     * **Actua en nom de qui va crear l'enllaç.** Ho necessita per poder llegir i marcar
     * les seves dades: la comprovació d'àmbit va per pertinença, i un convidat no és
     * membre de cap.
     *
     * A l'historial, però, **no hi consta com aquella persona**: `actor_type` és `guest`
     * i `actor_user_id` queda a `NULL`. El que fa un convidat és seu, no de qui li va
     * passar l'enllaç.
     */
    userId: share.created_by,
    shareId: share.id,
    capabilities,
    // L'abast el marca l'enllaç, no els àmbits: per això `null` i no un conjunt buit.
    scopeIds: null,
    source: 'share',
    label: guestLabel(guestName, guestRef),
  };
}

export async function getShare(db: MigrationDb, principal: Principal, id: string): Promise<Share> {
  if (!hasCapability(principal, 'shares:read')) throw missingCapability('shares:read');

  const found = await sql<ShareRow>`
    SELECT id, created_by, task_id, checklist_id, permission, require_name, password_hash,
           expires_at, max_views, view_count, failed_attempts, locked_until, created_at,
           revoked_at, secret_version
    FROM shares WHERE id = ${id} AND created_by = ${principal.userId}
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('share', id);
  return toShare(row);
}

export interface UpdateShareInput {
  permission?: SharePermission | undefined;
  expires_at?: string | null | undefined;
  max_views?: number | null | undefined;
  require_name?: boolean | undefined;
  /** `null` treu la contrasenya; una cadena la canvia; `undefined` no la toca. */
  password?: string | null | undefined;
}

/**
 * Canvia la configuració d'un enllaç sense canviar-ne el token.
 *
 * **El token no es regenera mai des d'aquí.** Si canviar el permís canviés l'enllaç, tot
 * el que ja s'hagi enviat deixaria de funcionar sense que ningú ho hagi demanat; qui
 * vulgui un enllaç nou el crea, i revoca el vell.
 *
 * Canviar la contrasenya **desbloqueja** l'enllaç: els cinc intents fallits eren contra
 * la contrasenya antiga, i mantenir el bloqueig castigaria qui l'acaba de canviar
 * justament perquè algú l'estava provant.
 */
export async function updateShare(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: UpdateShareInput,
): Promise<Share> {
  if (!hasCapability(principal, 'shares:write')) throw missingCapability('shares:write');

  const before = await getShare(ctx.tx, principal, id);
  if (before.revoked_at !== null) {
    throw new PolicyError(
      'share-revoked',
      'Share revoked',
      409,
      'This link is revoked: it cannot be reopened. Create a new one.',
    );
  }

  const permission = input.permission ?? before.permission;
  const expiresAt = input.expires_at === undefined ? before.expires_at : input.expires_at;
  const maxViews = input.max_views === undefined ? before.max_views : input.max_views;
  const requireName = input.require_name ?? before.require_name;

  let passwordHash: string | null | undefined;
  if (input.password === null) {
    passwordHash = null;
  } else if (typeof input.password === 'string') {
    if (input.password.length < MIN_SHARE_PASSWORD_LENGTH) {
      throw new PolicyError(
        'password-too-short',
        'Password too short',
        422,
        `La contrasenya de l'enllaç ha de tenir com a mínim ${String(MIN_SHARE_PASSWORD_LENGTH)} caràcters.`,
      );
    }
    passwordHash = await hashPassword(input.password);
  }

  const igual =
    permission === before.permission &&
    expiresAt === before.expires_at &&
    maxViews === before.max_views &&
    requireName === before.require_name &&
    passwordHash === undefined;
  if (igual) {
    ctx.noChange();
    return before;
  }

  await sql`
    UPDATE shares SET permission = ${permission}, expires_at = ${expiresAt},
                      max_views = ${maxViews}, require_name = ${dbBool(requireName)}
      ${passwordHash === undefined ? sql`` : sql`, password_hash = ${passwordHash}, failed_attempts = 0, locked_until = NULL`}
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'share',
    entityId: id,
    verb: 'updated',
    changes: { permission: { from: before.permission, to: permission } },
  });

  return getShare(ctx.tx, principal, id);
}

export interface ShareAccess {
  id: string;
  /** "Extern · Marta" o "Extern · a4f2". Mai una IP: no n'hi ha cap columna (D10). */
  label: string;
  first_seen: string;
  last_seen: string;
}

export async function listAccesses(
  db: MigrationDb,
  principal: Principal,
  shareId: string,
): Promise<ShareAccess[]> {
  // Passa per `getShare`, que ja comprova que l'enllaç sigui de qui pregunta.
  await getShare(db, principal, shareId);

  const rows = await sql<{
    id: string;
    guest_name: string | null;
    guest_ref: string;
    first_seen: string;
    last_seen: string;
  }>`
    SELECT id, guest_name, guest_ref, first_seen, last_seen
    FROM share_accesses WHERE share_id = ${shareId}
    ORDER BY last_seen DESC, id
  `.execute(db);

  return rows.rows.map((row) => ({
    id: row.id,
    label: guestLabel(row.guest_name, row.guest_ref),
    first_seen: row.first_seen,
    last_seen: row.last_seen,
  }));
}
