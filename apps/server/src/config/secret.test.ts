/**
 * El secret de la instància.
 *
 * És el mateix perill que les claus VAPID: si es regenera, tots els enllaços compartits
 * i totes les credencials d'orígens externs deixen de servir alhora i **en silenci**.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRET_FILENAME, ensureInstanceSecret, generateInstanceSecret } from './secret.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'femho-secret-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('generació', () => {
  it('és prou llarg per a la caixa de secrets', () => {
    // `secret-box` en demana 32 caràcters com a mínim.
    expect(generateInstanceSecret().length).toBeGreaterThanOrEqual(32);
  });

  it("dos secrets seguits no s'assemblen", () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateInstanceSecret()));
    expect(secrets.size).toBe(100);
  });

  it("és segur per a una URL i per a una variable d'entorn", () => {
    expect(generateInstanceSecret()).toMatch(/^[A-Za-z0-9_-]+$/u);
  });
});

describe('persistència', () => {
  it('es genera un sol cop i el segon arrencament el troba', () => {
    const primer = ensureInstanceSecret(dir);
    const segon = ensureInstanceSecret(dir);

    // Si aquí en sortís un de nou, tots els enllaços compartits haurien mort en silenci.
    expect(segon).toBe(primer);
  });

  it('el fitxer és només del propietari', () => {
    ensureInstanceSecret(dir);
    const mode = statSync(join(dir, SECRET_FILENAME)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('NO va a la base de dades, i aquest és el punt', () => {
    // "Si algú es queda una còpia de la base, no en pot treure cap enllaç funcional"
    // (docs/10 §3). Amb el pebre a dins, la còpia el portaria i l'HMAC no protegiria res.
    ensureInstanceSecret(dir);
    expect(readFileSync(join(dir, SECRET_FILENAME), 'utf8').trim()).not.toBe('');
  });

  it('un fitxer buit es queixa en comptes de generar-ne un de nou', () => {
    writeFileSync(join(dir, SECRET_FILENAME), '   \n', { mode: 0o600 });
    chmodSync(join(dir, SECRET_FILENAME), 0o600);

    expect(() => ensureInstanceSecret(dir)).toThrow(/còpia de seguretat/u);
  });

  it("la variable d'entorn mana per damunt del fitxer", () => {
    const alFitxer = ensureInstanceSecret(dir);
    expect(ensureInstanceSecret(dir, 'el-que-diu-la-configuracio')).toBe(
      'el-que-diu-la-configuracio',
    );

    // I no el toca: si algú treu la variable, el del fitxer encara hi és.
    expect(ensureInstanceSecret(dir)).toBe(alFitxer);
  });
});
