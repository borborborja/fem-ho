/**
 * docs/10 §8: argon2id, mínim 10 caràcters, sense regles d'estil absurdes.
 * docs/02 §2: mai es diu si el correu existeix o no.
 */

import { verify } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import {
  DUMMY_HASH,
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
  hashPassword,
  verifyPassword,
} from './password.js';

describe('hashPassword', () => {
  it('produeix un hash argon2id amb els paràmetres fixats', async () => {
    const h = await hashPassword('una-contrasenya-prou-llarga');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('dos hash de la mateixa contrasenya són diferents', async () => {
    // La sal és aleatòria. Si sortissin iguals, no n'hi hauria.
    const a = await hashPassword('la-mateixa-contrasenya');
    const b = await hashPassword('la-mateixa-contrasenya');
    expect(a).not.toBe(b);
  });

  it(`rebutja per sota de ${MIN_PASSWORD_LENGTH} caràcters`, async () => {
    await expect(hashPassword('curta')).rejects.toThrow(WeakPasswordError);
  });

  it("accepta una contrasenya llarga sense regles d'estil", async () => {
    // Sense exigir majúscules, dígits ni símbols: docs/10 §8 ho diu explícitament.
    await expect(hashPassword('quatre paraules ben llargues aqui')).resolves.toBeTruthy();
  });
});

describe('verifyPassword', () => {
  it('accepta la correcta i rebutja la incorrecta', async () => {
    const h = await hashPassword('la-bona-de-veritat');
    expect(await verifyPassword('la-bona-de-veritat', h)).toBe(true);
    expect(await verifyPassword('una-altra-cosa-diferent', h)).toBe(false);
  });

  it('rebutja sense llançar quan no hi ha hash', async () => {
    // Un usuari de tipus 'ai' o 'caldav_only' no té contrasenya. No poder entrar no és
    // una excepció: és una credencial incorrecta.
    expect(await verifyPassword('el-que-sigui', null)).toBe(false);
    expect(await verifyPassword('el-que-sigui', '')).toBe(false);
  });

  it('rebutja sense llançar si el hash guardat està malmès', async () => {
    expect(await verifyPassword('el-que-sigui', 'aixo-no-es-un-hash')).toBe(false);
  });
});

describe('no es filtra si el correu existeix', () => {
  it('DUMMY_HASH és un hash argon2id vàlid de veritat', async () => {
    // AQUESTA és la prova que compta. Si DUMMY_HASH estigués mal format, verify()
    // llançaria a l'instant, no es faria cap feina d'argon2, i el temps de resposta
    // d'un correu inexistent seria molt més curt que el d'un de real amb contrasenya
    // errònia. L'atacant enumeraria comptes amb un cronòmetre.
    await expect(
      // `algorithm` no cal aquí: verify el llegeix del propi hash. Que el llegeixi és
      // justament el que fa que la prova valgui.
      verify(DUMMY_HASH, 'qualsevol', { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    ).resolves.toBe(false);
  });

  it('el camí sense hash costa el mateix ordre de magnitud que el camí amb hash', async () => {
    const real = await hashPassword('una-contrasenya-qualsevol');

    // Escalfament: la primera crida a la biblioteca nativa inclou la càrrega.
    await verifyPassword('escalfament-de-la-prova', real);

    const mesura = async (stored: string | null): Promise<number> => {
      const inici = performance.now();
      for (let i = 0; i < 3; i += 1) await verifyPassword('provaprovaprova', stored);
      return performance.now() - inici;
    };

    const senseHash = await mesura(null);
    const ambHash = await mesura(real);

    // No es demana que siguin iguals —seria una prova inestable— sinó que el camí sense
    // hash no sigui ordres de magnitud més ràpid, que és el que delataria el compte.
    expect(senseHash).toBeGreaterThan(ambHash / 5);
  });
});
