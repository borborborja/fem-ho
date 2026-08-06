/**
 * El secret de la instància.
 *
 * D'aquí surten el pebre dels enllaços compartits (`token_hmac`, docs/10 §3) i la clau
 * de xifratge de les credencials d'orígens externs (`secret-box`).
 *
 * **No va a la base de dades, i això és el punt.** L'argument de `docs/10` §3 és que qui
 * es quedi una còpia de la base no en pugui treure cap enllaç funcional; si el pebre
 * fos a la mateixa base, la còpia el portaria a dins i l'HMAC no protegiria de res.
 *
 * Va a un fitxer del volum de dades, amb permisos de només el propietari. Un desplegament
 * que prefereixi gestionar-lo ell mateix pot posar `FEMHO_SECRET` o `FEMHO_SECRET_FILE`,
 * que manen per damunt.
 *
 * **Ha de sortir a la guia de còpia de seguretat**, al costat de la base i de les claus
 * VAPID: perdre'l vol dir perdre tots els enllaços compartits i totes les credencials
 * d'orígens externs alhora.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const SECRET_FILENAME = 'secret.key';

/** 32 bytes en base64url són 43 caràcters: passa el mínim de `secret-box` de sobres. */
const SECRET_BYTES = 32;

export function generateInstanceSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/**
 * El secret, generat un sol cop.
 *
 * Si el fitxer ja hi és, es torna tal com està — **mai se'n genera un de nou a sobre**.
 * Generar-ne un altre invalidaria tots els enllaços compartits en silenci, exactament
 * com passa amb les claus VAPID (docs/11 §2).
 */
export function ensureInstanceSecret(dataDir: string, fromEnv?: string): string {
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;

  const path = join(dataDir, SECRET_FILENAME);
  if (existsSync(path)) {
    const stored = readFileSync(path, 'utf8').trim();
    if (stored !== '') return stored;
    throw new Error(
      `${path} existeix però és buit. No se'n genera un de nou a sobre: això invalidaria ` +
        'tots els enllaços compartits i les credencials dels orígens externs. Recupera la ' +
        'còpia de seguretat, o esborra el fitxer sabent què perds.',
    );
  }

  mkdirSync(dirname(path), { recursive: true });
  const secret = generateInstanceSecret();
  writeFileSync(path, `${secret}\n`, { mode: 0o600 });
  // `writeFileSync` amb `mode` només l'aplica si el crea ell; això ho fa segur igualment.
  chmodSync(path, 0o600);
  return secret;
}
