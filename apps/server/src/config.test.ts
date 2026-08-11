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

/**
 * El terreny d'IA (P10).
 *
 * `docs/09` diu que Fem-ho **no té motor d'IA propi** i que la intel·ligència és sempre
 * externa. El que aquestes proves fixen és que el terreny no es pugui confondre amb la
 * funció: sense variables no hi ha res, i **amb la configuració a mitges no s'arrenca**.
 */
describe("el terreny d'IA", () => {
  it('sense variables, no hi ha proveïdor', () => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FEMHO_AI_')) delete process.env[key];
    }
    expect(loadConfig('0.0.0-test').ai.provider).toBe('none');
  });

  it('amb proveïdor i sense model, el servidor NO arrenca', () => {
    /**
     * **La forma pitjor de fallar seria arrencar.** Una instància que sembla configurada i
     * no ho està no dona cap símptoma fins al dia que algú espera que funcioni, i el que
     * veu llavors és silenci. És el mateix criteri que la contradicció
     * `REGISTRATION`/`ALLOW_REGISTRATION`.
     */
    process.env.FEMHO_AI_PROVIDER = 'openrouter';
    process.env.FEMHO_AI_API_KEY = 'sk-el-que-sigui';
    delete process.env.FEMHO_AI_MODEL;

    expect(() => loadConfig('0.0.0-test')).toThrow(/FEMHO_AI_MODEL/u);
  });

  it('i sense clau ni URL, tampoc', () => {
    process.env.FEMHO_AI_PROVIDER = 'openrouter';
    process.env.FEMHO_AI_MODEL = 'un/model';
    delete process.env.FEMHO_AI_API_KEY;
    delete process.env.FEMHO_AI_BASE_URL;

    expect(() => loadConfig('0.0.0-test')).toThrow(/API_KEY/u);
  });

  it('un model local amb URL i sense clau sí que val', () => {
    // Ollama a la mateixa xarxa no demana cap clau, i exigir-ne una seria inventar-se un
    // requisit que el cas d'ús principal d'una casa autoallotjada no té.
    process.env.FEMHO_AI_PROVIDER = 'ollama';
    process.env.FEMHO_AI_MODEL = 'llama3.2';
    process.env.FEMHO_AI_BASE_URL = 'http://ollama.local:11434';
    delete process.env.FEMHO_AI_API_KEY;

    expect(loadConfig('0.0.0-test').ai.provider).toBe('ollama');
  });

  it('i FEMHO_AI_MODEL no té defecte', () => {
    /**
     * Un model per defecte és **una versió que canvia sota teu i una factura que no has
     * triat**. Que no n'hi hagi és el que fa que la línia de dalt hagi de petar.
     */
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('FEMHO_AI_')) delete process.env[key];
    }
    expect(loadConfig('0.0.0-test').ai.model).toBeUndefined();
  });
});
