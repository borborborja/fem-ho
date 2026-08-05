/**
 * Contrasenyes amb argon2id (docs/05 §1, docs/10 §8).
 *
 * "Els paràmetres es fixen en fer l'scaffold contra la guia vigent, no des de
 * research/." Els d'aquí surten de la recomanació de segona opció d'OWASP per a
 * argon2id —19 MiB de memòria, 2 iteracions, paral·lelisme 1—, que és la que encaixa
 * amb un servidor domèstic: prou cara per a un atacant i prou barata perquè un ARM
 * petit no s'ofegui a cada login.
 */

import { hash, verify } from '@node-rs/argon2';

/**
 * L'identificador d'argon2id.
 *
 * S'escriu el número i no s'importa `Algorithm` de la biblioteca perquè és un `const
 * enum` ambient, i amb `verbatimModuleSyntax` —que el projecte té activat— TypeScript
 * no en pot llegir el valor: no hi ha cap objecte en temps d'execució d'on treure'l.
 *
 * El valor està fixat pel format del hash, no per la biblioteca: qualsevol hash que
 * comenci per `$argon2id$` el fa servir. La prova de password.test.ts comprova que el
 * hash produït porti aquest prefix, o sigui que si algun dia canviés, saltaria.
 */
const ARGON2ID = 2;

/**
 * Paràmetres. Es guarden amb el hash, o sigui que canviar-los aquí no invalida les
 * contrasenyes existents: les antigues es verifiquen amb els seus i es poden reforçar
 * en el següent login correcte.
 */
const PARAMS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** Mínim 10 caràcters, sense regles d'estil absurdes (docs/10 §8). */
export const MIN_PASSWORD_LENGTH = 10;

export class WeakPasswordError extends Error {
  constructor() {
    super(`La contrasenya ha de tenir com a mínim ${MIN_PASSWORD_LENGTH} caràcters.`);
    this.name = 'WeakPasswordError';
  }
}

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) throw new WeakPasswordError();
  return hash(plain, PARAMS);
}

/**
 * Verifica una contrasenya.
 *
 * Torna `false` en comptes de llançar si el hash és invàlid o absent: un usuari sense
 * contrasenya (kind 'ai' o 'caldav_only') no pot entrar, i això no és una excepció
 * sinó una credencial incorrecta.
 */
export async function verifyPassword(plain: string, stored: string | null): Promise<boolean> {
  if (stored === null || stored === '') {
    // Es fa una verificació igualment contra un hash fals per no filtrar per temps si
    // l'usuari existeix. docs/02 §2: mai es diu si el correu existeix o no.
    await verify(DUMMY_HASH, plain, PARAMS).catch(() => false);
    return false;
  }
  try {
    return await verify(stored, plain, PARAMS);
  } catch {
    return false;
  }
}

/**
 * Hash d'una contrasenya que no és de ningú, per igualar el temps de resposta d'un
 * correu inexistent amb el d'un correu real amb contrasenya errònia.
 *
 * Sense això, l'atacant distingeix els dos casos mesurant: la resposta d'un correu
 * inexistent tornaria de seguida i la d'un de real trigaria el que triga argon2id.
 */
export const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$JHy1L7L3xN8vB6qU0kQ0vXQ8kK1Q6Y7L8mN9pP0qR1s';
