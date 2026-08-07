/**
 * El token opac que algú enganxa: generar-lo i buscar-lo.
 *
 * Estava dins de `services/shares.ts` i el feien servir també les invitacions d'usuari
 * (`services/admin.ts`) important-lo d'allà. Amb les concessions d'àmbit en serien tres,
 * i un servei que importa la criptografia d'un altre servei perquè hi va néixer és una
 * dependència que no explica res.
 *
 * **No serveix per a `api_tokens`**, i és deliberat: aquells es presenten a *cada*
 * petició i per això es guarden amb SHA-256, que és ràpid a posta (`auth/tokens.ts`).
 * Els d'aquí es bescanvien un cop, i el pebre val el que costa.
 */

import { createHmac, randomBytes } from 'node:crypto';

/**
 * Sense caràcters ambigus: aquests tokens s'enganxen a mà i sovint es llegeixen d'una
 * pantalla. Confondre una `l` amb una `1` fa que sembli que el convit no serveix.
 */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 32 caràcters d'aquest alfabet són ~186 bits. No s'endevina. */
const TOKEN_LENGTH = 32;

export function generateOpaqueToken(): string {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = '';
  for (const byte of bytes) token += ALPHABET[byte % ALPHABET.length];
  return token;
}

/**
 * L'HMAC del token amb el pebre del servidor.
 *
 * HMAC i no un hash pelat: sense el pebre, qui es quedés la base podria provar tokens
 * candidats fora de línia. Amb el pebre, per fer-ho també li cal el secret de la
 * instància. `version` deixa rotar el pebre sense invalidar-ho tot de cop (`docs/10` §3).
 */
export function tokenHmac(token: string, pepper: string, version = 1): string {
  return createHmac('sha256', `${pepper}:v${String(version)}`)
    .update(token)
    .digest('hex');
}
