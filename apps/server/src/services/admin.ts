/**
 * Administració de la llar. docs/02 §9 (Admin), docs/05 §4, docs/12 §8.
 *
 * Tot el que hi ha aquí demana `users:manage` o `instance:manage`, que un token normal
 * no porta mai (`capabilitiesForRole`): les integracions i els agents no administren
 * usuaris ni esborren la instància, per molt que el seu propietari sigui administrador.
 */

import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import { hashPassword } from '../auth/password.js';
import { isTrue } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { tokenHmac } from './shares.js';

export interface AdminUser {
  id: string;
  email: string | null;
  name: string;
  role: 'admin' | 'member';
  kind: 'human' | 'ai' | 'caldav_only';
  created_at: string;
  /** Si encara no ha fet servir la invitació, el compte no s'ha estrenat. */
  pending_invite: boolean;
}

export async function listUsers(db: MigrationDb, principal: Principal): Promise<AdminUser[]> {
  if (!hasCapability(principal, 'users:manage')) throw missingCapability('users:manage');

  const rows = await sql<AdminUser & { pending_invite: unknown }>`
    SELECT u.id, u.email, u.name, u.role, u.kind, u.created_at,
           EXISTS (SELECT 1 FROM user_invites i
                   WHERE i.user_id = u.id AND i.used_at IS NULL) AS pending_invite
    FROM users u
    WHERE u.deleted_at IS NULL AND u.kind != 'ai'
    ORDER BY u.created_at, u.id
  `.execute(db);

  // `EXISTS` torna un booleà a Postgres i un 0/1 a SQLite: `isTrue` és qui sap què vol
  // dir cadascun sense que aquesta consulta hagi de saber quin motor hi ha a sota.
  return rows.rows.map((row) => ({ ...row, pending_invite: isTrue(row.pending_invite) }));
}

export interface InviteResult {
  user: AdminUser;
  /** L'enllaç complet. **Es mostra un sol cop**: després només en queda l'HMAC. */
  invite_url: string;
  expires_at: string;
}

const INVITE_DAYS = 7;

/**
 * Crea un usuari i genera la seva invitació.
 *
 * **L'usuari es crea sense contrasenya.** La posa la persona quan obre l'enllaç, i
 * l'administrador no arriba a saber-la mai. Un compte sense contrasenya no pot iniciar
 * sessió: `verifyPassword` amb `null` sempre és fals.
 */
export async function inviteUser(
  ctx: AuditContext,
  principal: Principal,
  input: { email?: string | undefined; name?: string | undefined; role?: string | undefined },
  pepper: string,
  baseUrl: string,
): Promise<InviteResult> {
  if (!hasCapability(principal, 'users:manage')) throw missingCapability('users:manage');

  const email = input.email?.trim().toLowerCase() ?? '';
  const name = input.name?.trim() ?? '';
  if (email === '' || !email.includes('@')) {
    throw new PolicyError('invalid-email', 'Invalid email', 422, 'Cal un correu vàlid.');
  }
  if (name === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'Cal el nom de la persona.');
  }
  const role = input.role === 'admin' ? 'admin' : 'member';

  const existing = await sql<{ id: string }>`
    SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    throw new PolicyError(
      'email-taken',
      'Email already used',
      409,
      `Ja hi ha un compte amb ${email}.`,
    );
  }

  const userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at, version)
    VALUES (${userId}, ${email}, ${name}, NULL, 'human', ${role}, ${ctx.now}, ${ctx.now}, 1)
  `.execute(ctx.tx);

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    new Date(ctx.now).getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await sql`
    INSERT INTO user_invites (id, user_id, token_hmac, created_by, expires_at, created_at)
    VALUES (${uuidv7()}, ${userId}, ${tokenHmac(token, pepper)}, ${principal.userId},
            ${expiresAt}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({ entityType: 'user', entityId: userId, verb: 'created' });

  return {
    user: {
      id: userId,
      email,
      name,
      role,
      kind: 'human',
      created_at: ctx.now,
      pending_invite: true,
    },
    invite_url: `${baseUrl.replace(/\/$/u, '')}/invite/${token}`,
    expires_at: expiresAt,
  };
}

/**
 * Consumeix una invitació i hi posa la contrasenya.
 *
 * **No demana autenticació**: qui l'obre encara no en té. La prova d'identitat és el
 * token, que és d'un sol ús i caduca. Un token gastat i un d'inexistent responen igual,
 * pel mateix motiu que als enllaços compartits (docs/10 §4): distingir-los diria si algú
 * hi va arribar abans.
 */
export async function acceptInvite(
  ctx: AuditContext,
  token: string,
  password: string,
  pepper: string,
): Promise<{ user_id: string }> {
  const invalid = new PolicyError(
    'invite-invalid',
    'Invalid invitation',
    404,
    'Aquesta invitació no és vàlida, ja s\'ha fet servir o ha caducat.',
  );

  if (password.length < 10) {
    throw new PolicyError(
      'password-too-short',
      'Password too short',
      422,
      'La contrasenya ha de tenir com a mínim 10 caràcters.',
    );
  }

  const found = await sql<{ id: string; user_id: string; expires_at: string }>`
    SELECT id, user_id, expires_at FROM user_invites
    WHERE token_hmac = ${tokenHmac(token, pepper)} AND used_at IS NULL
  `.execute(ctx.tx);
  const invite = found.rows[0];
  if (invite === undefined || invite.expires_at < ctx.now) throw invalid;

  await sql`
    UPDATE users SET password_hash = ${await hashPassword(password)}, updated_at = ${ctx.now},
                     version = version + 1
    WHERE id = ${invite.user_id}
  `.execute(ctx.tx);

  await sql`UPDATE user_invites SET used_at = ${ctx.now} WHERE id = ${invite.id}`.execute(ctx.tx);

  ctx.record({ entityType: 'user', entityId: invite.user_id, verb: 'updated' });
  return { user_id: invite.user_id };
}

export async function updateUser(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  input: { name?: string | undefined; role?: string | undefined },
): Promise<AdminUser> {
  if (!hasCapability(principal, 'users:manage')) throw missingCapability('users:manage');

  const found = await sql<{ name: string; role: 'admin' | 'member' }>`
    SELECT name, role FROM users WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const before = found.rows[0];
  if (before === undefined) throw notFound('usuari', id);

  const name = input.name?.trim() ?? before.name;
  if (name === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'El nom no pot quedar buit.');
  }
  const role = input.role === 'admin' ? 'admin' : input.role === 'member' ? 'member' : before.role;

  // Treure's un mateix l'administració deixaria la instància sense ningú que la pugui
  // tornar a donar, si a més és l'últim.
  if (id === principal.userId && role !== 'admin' && before.role === 'admin') {
    await assertNotLastAdmin(ctx.tx, id);
  }

  if (name === before.name && role === before.role) {
    ctx.noChange();
    return (await listUsers(ctx.tx, principal)).find((u) => u.id === id)!;
  }

  await sql`
    UPDATE users SET name = ${name}, role = ${role}, updated_at = ${ctx.now},
                     version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'user',
    entityId: id,
    verb: 'updated',
    changes: { name: { from: before.name, to: name }, role: { from: before.role, to: role } },
  });

  return (await listUsers(ctx.tx, principal)).find((u) => u.id === id)!;
}

/**
 * Esborrat suau d'un usuari.
 *
 * **Un administrador no es pot esborrar a si mateix.** docs/14 ho marca com un dels tres
 * punts on el prototip es queda curt, i la raó és pràctica: si la instància es queda
 * sense administradors, no hi ha cap camí per tornar-ne a tenir sense tocar la base a mà.
 */
export async function deleteUser(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'users:manage')) throw missingCapability('users:manage');

  if (id === principal.userId) {
    throw new PolicyError(
      'cannot-delete-self',
      'Cannot delete yourself',
      409,
      "No et pots esborrar el teu propi compte des d'Admin. Demana-ho a un altre administrador.",
    );
  }

  const found = await sql<{ name: string; role: string }>`
    SELECT name, role FROM users WHERE id = ${id} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const user = found.rows[0];
  if (user === undefined) throw notFound('usuari', id);
  if (user.role === 'admin') await assertNotLastAdmin(ctx.tx, id);

  // Els àmbits que en són propietat no es toquen: esborrar-los s'enduria la feina de tota
  // la casa. Queden orfes a posta, i Admin els pot reassignar.
  await sql`DELETE FROM scope_members WHERE user_id = ${id}`.execute(ctx.tx);
  await sql`DELETE FROM task_assignees WHERE user_id = ${id}`.execute(ctx.tx);
  await sql`UPDATE sessions SET revoked_at = ${ctx.now} WHERE user_id = ${id} AND revoked_at IS NULL`.execute(
    ctx.tx,
  );
  await sql`
    UPDATE users SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${id}
  `.execute(ctx.tx);

  ctx.record({ entityType: 'user', entityId: id, verb: 'deleted' });
}

async function assertNotLastAdmin(tx: MigrationDb, id: string): Promise<void> {
  const admins = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM users
    WHERE role = 'admin' AND deleted_at IS NULL AND kind = 'human' AND id != ${id}
  `.execute(tx);
  if (Number(admins.rows[0]?.n ?? 0) === 0) {
    throw new PolicyError(
      'last-admin',
      'Last administrator',
      409,
      'És l\'últim administrador. La instància es quedaria sense ningú que la pogués administrar.',
    );
  }
}

/**
 * Neteja la instància. docs/02 §9.
 *
 * La confirmació escrivint el nom de la instància és cosa de la interfície, però **també
 * es comprova aquí**: una crida directa a l'API no ha de poder-ho fer sense el mateix
 * gest deliberat.
 */
export async function wipeInstance(
  ctx: AuditContext,
  principal: Principal,
  confirmation: string,
  instanceName: string,
): Promise<{ deleted: Record<string, number> }> {
  if (!hasCapability(principal, 'instance:manage')) throw missingCapability('instance:manage');

  if (confirmation !== instanceName) {
    throw new PolicyError(
      'confirmation-mismatch',
      'Confirmation does not match',
      422,
      `Per netejar la instància, escriu-ne el nom exacte: "${instanceName}".`,
    );
  }

  const deleted: Record<string, number> = {};
  // L'ordre és el de les dependències, a l'inrevés: els fills abans que els pares, o les
  // claus foranes de Postgres ho aturen a mig camí.
  const taules = [
    'checklist_items',
    'checklists',
    'subtasks',
    'task_labels',
    'task_assignees',
    'task_leases',
    'comments',
    'attachments',
    'reminders',
    'event_attendees',
    'event_occurrences',
    'events',
    'share_accesses',
    'shares',
    'tasks',
    'labels',
    'calendars',
    'projects',
    'scope_members',
    'scopes',
    'activity_log',
    'change_log',
  ];

  for (const taula of taules) {
    const result = await sql.raw(`DELETE FROM ${taula}`).execute(ctx.tx);
    deleted[taula] = Number(result.numAffectedRows ?? 0n);
  }

  // El registre d'aquesta operació s'escriu DESPRÉS de buidar `activity_log`, o s'hauria
  // esborrat ell mateix: netejar la instància ha de deixar constància que algú ho va fer.
  ctx.record({ entityType: 'instance', entityId: 'wipe', verb: 'deleted' });
  return { deleted };
}
