/**
 * Generació i verificació de credencials opaques.
 *
 * Dues famílies, i la diferència importa:
 *
 *   - **Tokens d'API** (`femho_pat_…`). Els llegeix una persona i els enganxa en una
 *     configuració. Porten prefix llegible i se'n guarda el hash (docs/05 §1).
 *   - **Tokens de refresc**. No els llegeix ningú; van dins d'una galeta o d'un
 *     magatzem xifrat. Porten l'identificador de sessió al davant, i això és el que fa
 *     possible detectar la reutilització d'un token gastat sense afegir cap columna a
 *     l'esquema de docs/01 (veure sessions.ts).
 *
 * El hash és SHA-256 i no argon2id, i és deliberat: aquests valors són aleatoris de 256
 * bits, no contrasenyes escollides per persones. No hi ha diccionari a provar, o sigui
 * que un hash lent no compra res i encareix cada petició autenticada.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Prefix llegible d'un token d'API. docs/05 §1. */
export const PAT_PREFIX = 'femho_pat_';

/** Quants caràcters del token es guarden en clar per poder llistar-lo a la UI. */
const VISIBLE_PREFIX_LENGTH = PAT_PREFIX.length + 8;

/**
 * Alfabet segur per a URL i sense caràcters ambigus. Es treuen 0/O i 1/l/I perquè algú
 * pugui llegir un prefix en veu alta o teclejar-lo des d'un codi QR sense equivocar-se.
 */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomString(length: number): string {
  // Es demanen més bytes dels necessaris i es descarten els que caurien fora d'un
  // múltiple exacte de l'alfabet: amb un mòdul directe, els primers caràcters de
  // l'alfabet sortirien lleugerament més sovint.
  const out: string[] = [];
  const max = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue;
      out.push(ALPHABET[byte % ALPHABET.length]!);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Comparació en temps constant de dos hash hexadecimals. */
export function tokenHashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export interface GeneratedApiToken {
  /** El token en clar. Es mostra **un sol cop** i no es guarda mai (docs/05 §1). */
  token: string;
  /** El que es guarda a api_tokens.token_hash. */
  hash: string;
  /** El que es guarda a api_tokens.token_prefix, per llistar-lo sense revelar-lo. */
  prefix: string;
}

export function generateApiToken(): GeneratedApiToken {
  // 43 caràcters d'aquest alfabet són ~250 bits d'entropia. De sobres.
  const token = `${PAT_PREFIX}${randomString(43)}`;
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, VISIBLE_PREFIX_LENGTH),
  };
}

export function isApiToken(value: string): boolean {
  return value.startsWith(PAT_PREFIX);
}

export interface GeneratedRefreshToken {
  /** El que viatja al client: `<sessionId>.<secret>`. */
  token: string;
  /** El que es guarda a sessions.refresh_hash. Només el secret, no la part pública. */
  hash: string;
}

/**
 * Un token de refresc porta l'identificador de sessió al davant.
 *
 * **Això és el que fa possible el requisit de docs/13 M3** —"reutilitzar un token de
 * refresc gastat revoca la família"— sense afegir cap columna a l'esquema de docs/01.
 *
 * En rotar, la fila de sessió es queda i només se n'actualitza el `refresh_hash`. Si
 * arriba un token amb un identificador de sessió que existeix però amb un secret que ja
 * no és el vigent, vol dir que algú fa servir una còpia gastada: es revoca la sessió
 * sencera. Sense l'identificador al davant, un token gastat seria indistingible d'un
 * d'inventat, i no hi hauria res a revocar.
 */
export function generateRefreshToken(sessionId: string): GeneratedRefreshToken {
  const secret = randomString(43);
  return { token: `${sessionId}.${secret}`, hash: hashToken(secret) };
}

export interface ParsedRefreshToken {
  sessionId: string;
  secret: string;
}

export function parseRefreshToken(token: string): ParsedRefreshToken | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  return { sessionId: token.slice(0, dot), secret: token.slice(dot + 1) };
}

/** Token d'accés de vida curta. No es guarda: es valida per signatura o per sessió. */
export function generateAccessToken(): string {
  return randomString(43);
}
