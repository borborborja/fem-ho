/**
 * Les dues maneres de dir qui pot fer-se un compte.
 *
 * `FEMHO_ALLOW_REGISTRATION` és el booleà i `FEMHO_REGISTRATION` la forma llarga de tres
 * estats. **Una sola veritat i dues maneres d'escriure-la**, o sigui que el cas que
 * importa és el que passa quan es contradiuen: si el servidor en triés una, una instància
 * podria quedar oberta quan algú la creia tancada. Es prova que no arrenca.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

function net(): void {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];
}

beforeEach(net);
afterEach(net);

describe('el registre', () => {
  it('per defecte està tancat', () => {
    expect(loadConfig('0.0.0-test').registration).toBe('disabled');
  });

  it('`FEMHO_ALLOW_REGISTRATION=true` vol dir obert', () => {
    process.env.FEMHO_ALLOW_REGISTRATION = 'true';
    expect(loadConfig('0.0.0-test').registration).toBe('open');
  });

  it('i `false` vol dir tancat', () => {
    process.env.FEMHO_ALLOW_REGISTRATION = 'false';
    expect(loadConfig('0.0.0-test').registration).toBe('disabled');
  });

  it('la forma llarga segueix valent, també per al mode de convits', () => {
    process.env.FEMHO_REGISTRATION = 'invite';
    expect(loadConfig('0.0.0-test').registration).toBe('invite');
  });

  it('i les dues dient el mateix conviuen sense queixar-se', () => {
    process.env.FEMHO_ALLOW_REGISTRATION = 'true';
    process.env.FEMHO_REGISTRATION = 'open';
    expect(loadConfig('0.0.0-test').registration).toBe('open');
  });

  /**
   * **Contradir-se no es resol, es rebutja.** Qualsevol tria per defecte —el booleà mana,
   * o mana la llarga— deixa la meitat dels casos amb una instància oberta que algú creia
   * tancada, o al revés. Fallar aviat i dir per què és l'única resposta honesta.
   */
  it('però si es contradiuen, el servidor no arrenca i diu quina és quina', () => {
    process.env.FEMHO_ALLOW_REGISTRATION = 'true';
    process.env.FEMHO_REGISTRATION = 'disabled';
    expect(() => loadConfig('0.0.0-test')).toThrow(
      /FEMHO_ALLOW_REGISTRATION.*FEMHO_REGISTRATION/su,
    );
  });

  /**
   * Ni `true` ni `false`: **no s'endevina**. Amb la regla habitual de "qualsevol cosa que
   * no sigui buit és cert", un `FEMHO_ALLOW_REGISTRATION=nope` deixaria el registre obert.
   */
  it("i un valor que no és ni sí ni no tampoc s'accepta", () => {
    process.env.FEMHO_ALLOW_REGISTRATION = 'potser';
    expect(() => loadConfig('0.0.0-test')).toThrow(/true o false/u);
  });

  it('un mode inventat tampoc', () => {
    process.env.FEMHO_REGISTRATION = 'obert';
    expect(() => loadConfig('0.0.0-test')).toThrow(/FEMHO_REGISTRATION/u);
  });
});
