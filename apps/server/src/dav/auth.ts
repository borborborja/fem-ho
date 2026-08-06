/**
 * Autenticació del camí DAV.
 *
 * **Basic i prou.** Cap client CalDAV real fa Bearer ni OAuth contra un servidor
 * autoallotjat: DAVx⁵, Apple, Thunderbird i Evolution demanen usuari i contrasenya. La
 * credencial és la contrasenya d'aplicació de l'usuari, que per als de tipus
 * `caldav_only` (docs/07 §10) és **l'única** que tenen.
 *
 * Va sobre HTTPS o no va: Basic envia la credencial a cada petició. Això ho imposa el
 * desplegament (docs/12), no aquest fitxer.
 */

import type { IncomingMessage } from 'node:http';
import { sql } from 'kysely';
import type { Connection } from '../db/connection.js';
import { DUMMY_HASH, verifyPassword } from '../auth/password.js';
import { lockout } from '../http/auth.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';

export interface DavPrincipal extends Principal {
  /** El nom que surt a la URL: `/dav/calendars/{user}/`. */
  davUser: string;
  email: string;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  kind: string;
  role: string;
}

/**
 * Torna el principal, o `undefined` si la credencial no val.
 *
 * **Un usuari inexistent i una contrasenya dolenta triguen igual**: si no hi ha fila es
 * verifica igualment contra un hash de mentida. Sense això, el temps de resposta diu
 * quins correus existeixen.
 */
export async function authenticate(
  connection: Connection,
  request: IncomingMessage,
): Promise<DavPrincipal | undefined> {
  const credential = parseBasic(request.headers.authorization);
  if (credential === undefined) return undefined;

  const email = credential.user.toLowerCase();
  const now = Date.now();

  /**
   * **El mateix limitador que el login de la web**, i amb la mateixa clau.
   *
   * Si el camí DAV en tingués un de propi, bloquejar un compte per la web deixaria la
   * porta del CalDAV oberta amb el mateix nombre d'intents disponibles: un pany a una
   * banda i cap a l'altra.
   */
  if (lockout.isLocked(email, now)) return undefined;

  const found = await sql<UserRow>`
    SELECT id, email, password_hash, kind, role
    FROM users
    WHERE email = ${email} AND deleted_at IS NULL
  `.execute(connection.db);

  const user = found.rows[0];
  const ok = await verifyPassword(credential.password, user?.password_hash ?? DUMMY_HASH);
  if (!ok || user === undefined) {
    lockout.recordFailure(email, now);
    return undefined;
  }
  lockout.recordSuccess(email);

  return {
    kind: 'user',
    userId: user.id,
    email: user.email,
    davUser: davUserOf(user.email),
    /**
     * Qui entra amb la seva contrasenya pot fer el que el seu rol li permet, igual que
     * per la web: la política és una de sola i no es duplica per canal (regla 8). El que
     * el camí DAV limita no són els permisos, sinó la forma dels recursos.
     */
    capabilities: new Set(capabilitiesForRole(user.role === 'admin' ? 'admin' : 'member')),
    scopeIds: null,
    // Tot el que entri per aquí queda etiquetat `caldav` a `activity_log`, i és el que
    // evita que una escriptura entrant reboti cap a l'origen (docs/07 §9).
    source: 'caldav',
  };
}

/** El segment d'usuari de la URL: la part local del correu, en minúscules. */
export function davUserOf(email: string): string {
  return (email.split('@')[0] ?? email).toLowerCase();
}

interface BasicCredential {
  user: string;
  password: string;
}

function parseBasic(header: string | undefined): BasicCredential | undefined {
  if (header === undefined) return undefined;

  const [scheme, encoded] = header.split(' ');
  // El nom de l'esquema no distingeix majúscules (RFC 7235 §2.1) i hi ha clients que
  // envien `basic`.
  if (scheme?.toLowerCase() !== 'basic' || encoded === undefined) return undefined;

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return undefined;

  return { user: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}
