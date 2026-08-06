/**
 * Xifratge en repòs dels secrets que Fem-ho **ha de poder tornar a llegir**.
 *
 * És el cas de les credencials d'un origen CalDAV extern (`calendars.source_secret_enc`,
 * docs/07 §9): el servidor s'hi ha d'autenticar cada vegada que refresca, o sigui que no
 * pot guardar-ne un hash. Una contrasenya d'usuari **no** passa per aquí: aquella es
 * comprova, no es recupera, i va amb argon2id.
 *
 * AES-256-GCM, que autentica a més de xifrar: sense això, algú amb accés d'escriptura a
 * la base podria canviar un byte del text xifrat i el servidor faria la petició a un
 * lloc diferent sense adonar-se'n.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

/**
 * Deriva la clau del secret de la instància.
 *
 * Es deriva i no es fa servir directament perquè el mateix secret ha de poder xifrar
 * coses diferents sense que compartir clau les enllaci: el `purpose` les separa.
 */
function keyFor(masterSecret: string, purpose: string): Buffer {
  if (masterSecret.length < 32) {
    throw new SecretBoxError('El secret de la instància necessita 32 caràcters com a mínim.');
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(masterSecret, 'utf8'),
      Buffer.alloc(0),
      Buffer.from(purpose, 'utf8'),
      32,
    ),
  );
}

/**
 * Xifra.
 *
 * El resultat porta la versió al davant: canviar d'algorisme més endavant vol dir
 * afegir-hi una branca, no reescriure totes les files a la cega.
 */
export function seal(masterSecret: string, purpose: string, plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFor(masterSecret, purpose), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    String(VERSION),
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

/** Desxifra. Un text manipulat falla aquí, no més endavant amb dades estranyes. */
export function open(masterSecret: string, purpose: string, sealed: string): string {
  const [version, iv, encrypted, tag] = sealed.split('.');
  if (
    version !== String(VERSION) ||
    iv === undefined ||
    encrypted === undefined ||
    tag === undefined
  ) {
    throw new SecretBoxError('El secret guardat no té el format esperat.');
  }

  const tagBytes = Buffer.from(tag, 'base64url');
  if (tagBytes.length !== TAG_BYTES) throw new SecretBoxError('El secret guardat està malmès.');

  const decipher = createDecipheriv(
    ALGORITHM,
    keyFor(masterSecret, purpose),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(tagBytes);

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM falla aquí si algú ha tocat el text xifrat. No es diu què s'ha manipulat.
    throw new SecretBoxError('El secret guardat no es pot desxifrar.');
  }
}
