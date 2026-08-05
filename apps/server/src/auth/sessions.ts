/**
 * Sessions i refresc rotatiu. docs/05 §1, docs/10 §8.
 *
 * "Els tokens de refresc **roten**: cada refresc n'emet un de nou i invalida l'anterior.
 * Si arriba un token de refresc ja gastat, es revoca tota la família de sessions — és
 * senyal de robatori."
 *
 * La família és la fila de sessió. El token porta l'identificador de sessió al davant
 * (veure tokens.ts), o sigui que un token gastat és identificable i es pot lligar a la
 * sessió que cal revocar. Amb tokens opacs sense identificador, un de gastat i un
 * d'inventat serien la mateixa cosa i no hi hauria res a revocar.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { MigrationDb } from '../db/migration-db.js';
import { generateRefreshToken, hashToken, parseRefreshToken, tokenHashEquals } from './tokens.js';

/** Vida d'un token de refresc. 30 dies és el que fa que no calgui entrar cada setmana. */
export const REFRESH_TTL_DAYS = 30;

export interface SessionRow {
  id: string;
  user_id: string;
  refresh_hash: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: string;
}

export function expiryFrom(now: string, days = REFRESH_TTL_DAYS): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function createSession(
  tx: MigrationDb,
  userId: string,
  now: string,
  userAgent?: string,
): Promise<IssuedSession> {
  const sessionId = uuidv7();
  const { token, hash } = generateRefreshToken(sessionId);
  const expiresAt = expiryFrom(now);

  await sql`
    INSERT INTO sessions (id, user_id, refresh_hash, user_agent, created_at, last_used_at, expires_at)
    VALUES (${sessionId}, ${userId}, ${hash}, ${userAgent ?? null}, ${now}, ${now}, ${expiresAt})
  `.execute(tx);

  return { sessionId, refreshToken: token, expiresAt };
}

export type RefreshOutcome =
  | { ok: true; session: IssuedSession; userId: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused'; revokedSessionId?: string };

/**
 * Rota un token de refresc.
 *
 * Els quatre desenllaços possibles, i el quart és el que importa:
 *   - la sessió no existeix          → `unknown`
 *   - la sessió està revocada        → `revoked`
 *   - la sessió ha caducat           → `expired`
 *   - el secret no és el vigent      → `reused`, **i es revoca la sessió sencera**
 */
export async function rotateRefreshToken(
  tx: MigrationDb,
  refreshToken: string,
  now: string,
): Promise<RefreshOutcome> {
  const parsed = parseRefreshToken(refreshToken);
  if (parsed === null) return { ok: false, reason: 'unknown' };

  const result = await sql<SessionRow>`
    SELECT id, user_id, refresh_hash, expires_at, revoked_at
    FROM sessions WHERE id = ${parsed.sessionId}
  `.execute(tx);
  const session = result.rows[0];

  if (session === undefined) return { ok: false, reason: 'unknown' };
  if (session.revoked_at !== null) return { ok: false, reason: 'revoked' };

  if (!tokenHashEquals(hashToken(parsed.secret), session.refresh_hash)) {
    // Aquest és el cas de robatori. Algú fa servir una còpia d'un token que ja s'havia
    // rotat: o bé l'atacant ha refrescat abans que la víctima, o al revés. No sabem
    // quin dels dos és qui, i per això es tanca la sessió sencera i tots dos han de
    // tornar a entrar amb la contrasenya.
    await sql`UPDATE sessions SET revoked_at = ${now} WHERE id = ${session.id}`.execute(tx);
    return { ok: false, reason: 'reused', revokedSessionId: session.id };
  }

  if (Date.parse(session.expires_at) <= Date.parse(now)) {
    return { ok: false, reason: 'expired' };
  }

  // Rotació: la fila es queda —és la família— i només se n'actualitza el secret.
  const { token, hash } = generateRefreshToken(session.id);
  const expiresAt = expiryFrom(now);
  await sql`
    UPDATE sessions
    SET refresh_hash = ${hash}, last_used_at = ${now}, expires_at = ${expiresAt}
    WHERE id = ${session.id}
  `.execute(tx);

  return {
    ok: true,
    userId: session.user_id,
    session: { sessionId: session.id, refreshToken: token, expiresAt },
  };
}

export async function revokeSession(
  tx: MigrationDb,
  sessionId: string,
  now: string,
): Promise<void> {
  await sql`UPDATE sessions SET revoked_at = ${now} WHERE id = ${sessionId}`.execute(tx);
}

export async function revokeAllSessionsOf(
  tx: MigrationDb,
  userId: string,
  now: string,
): Promise<void> {
  await sql`
    UPDATE sessions SET revoked_at = ${now}
    WHERE user_id = ${userId} AND revoked_at IS NULL
  `.execute(tx);
}
