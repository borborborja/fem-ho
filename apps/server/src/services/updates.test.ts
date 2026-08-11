/**
 * La comprovació de versió.
 *
 * Tres coses que aquestes proves fixen, i cap és "que funcioni":
 *
 *   - **`unreachable` no és `ok`.** Una instància sense sortida a internet diria "estàs al
 *     dia" sempre i callaria justament el dia que hi ha una actualització de seguretat.
 *   - **La comparació és semàntica i no de text.** `"0.10.0" > "0.9.0"` és fals com a
 *     cadena, i és el cas que arribarà: el salt de 0.9 a 0.10 és qüestió de mesos.
 *   - **No es pregunta res si la font no és GitHub.** Qui publiqui una versió modificada
 *     no ha de rebre avisos de les versions d'un altre projecte.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { checkForUpdate, forgetUpdateCache, githubRepo, isNewer } from './updates.js';

const REPO = 'https://github.com/borborborja/fem-ho';

const resposta = (tag: string) => ({
  status: 200,
  text: JSON.stringify({ tag_name: tag, html_url: `${REPO}/releases/tag/${tag}` }),
});

beforeEach(() => {
  forgetUpdateCache();
});

describe('quin repositori és', () => {
  it.each([
    ['https://github.com/borborborja/fem-ho', 'borborborja/fem-ho'],
    ['https://github.com/borborborja/fem-ho.git', 'borborborja/fem-ho'],
    ['https://github.com/borborborja/fem-ho/', 'borborborja/fem-ho'],
    ['https://www.github.com/a/b', 'a/b'],
  ])('%s → %s', (url, esperat) => {
    expect(githubRepo(url)).toBe(esperat);
  });

  it.each([
    ['https://git.example.com/borja/fem-ho'],
    ['https://github.com/nomes-un-tros'],
    ['no és una url'],
  ])('%s no és un repositori de GitHub', (url) => {
    expect(githubRepo(url)).toBeNull();
  });
});

describe('comparar versions', () => {
  it('0.10.0 és més nova que 0.9.0, que com a text seria al revés', () => {
    // El cas que hauria arribat sol i que ningú hauria notat fins massa tard.
    expect('0.10.0' > '0.9.0').toBe(false);
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
  });

  it.each([
    ['v0.5.0', '0.4.0', true],
    ['0.4.1', '0.4.0', true],
    ['1.0.0', '0.9.9', true],
    ['0.4.0', '0.4.0', false],
    ['0.3.0', '0.4.0', false],
    ['0.4.0', '0.4.0-rc.1', false],
  ])('%s contra %s → %s', (latest, current, esperat) => {
    expect(isNewer(latest, current)).toBe(esperat);
  });

  it('una versió que no s’entén no dispara cap avís', () => {
    // Val més callar que dir a algú que actualitzi a una cosa que no sabem què és.
    expect(isNewer('la-que-sigui', '0.4.0')).toBe(false);
  });
});

describe("el que es diu quan no se'n sap res", () => {
  it('apagada: ho diu, i no consulta', async () => {
    let trucades = 0;
    const estat = await checkForUpdate({
      enabled: false,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher: async () => {
        trucades += 1;
        return resposta('v9.9.9');
      },
    });
    expect(estat.reason).toBe('disabled');
    expect(estat.available).toBe(false);
    expect(trucades).toBe(0);
  });

  it('una font que no és GitHub tampoc consulta res', async () => {
    let trucades = 0;
    const estat = await checkForUpdate({
      enabled: true,
      sourceUrl: 'https://git.example.com/algu/la-seva-versio',
      currentVersion: '0.4.0',
      fetcher: async () => {
        trucades += 1;
        return resposta('v9.9.9');
      },
    });
    expect(estat.reason).toBe('not-github');
    expect(trucades).toBe(0);
  });

  it('i si GitHub no contesta, es distingeix de "vas al dia"', async () => {
    const estat = await checkForUpdate({
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher: async () => {
        throw new Error('sense xarxa');
      },
    });
    expect(estat.reason).toBe('unreachable');
    expect(estat.available).toBe(false);
    // Amb un enllaç igualment: qui vulgui mirar-ho a mà, que pugui.
    expect(estat.url).toContain('/releases');
  });
});

describe('la memòria cau', () => {
  it('una segona consulta dins de la finestra no torna a preguntar', async () => {
    let trucades = 0;
    const opcions = {
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher: async () => {
        trucades += 1;
        return resposta('v0.5.0');
      },
      now: () => 1_000_000,
    };

    expect((await checkForUpdate(opcions)).latest).toBe('0.5.0');
    expect((await checkForUpdate(opcions)).latest).toBe('0.5.0');
    expect(trucades).toBe(1);
  });

  it('i passades sis hores, sí', async () => {
    let trucades = 0;
    const fetcher = async () => {
      trucades += 1;
      return resposta('v0.5.0');
    };

    await checkForUpdate({
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher,
      now: () => 0,
    });
    await checkForUpdate({
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher,
      now: () => 7 * 60 * 60 * 1000,
    });
    expect(trucades).toBe(2);
  });

  it('recorda el que diu GitHub, NO la conclusió', async () => {
    /**
     * **El defecte que hi havia, i que només es va veure executant-ho de debò.**
     *
     * La memòria cau guardava l'`UpdateStatus` sencer, que porta `current` i `available`.
     * La segona consulta tornava la versió de la primera: preguntes amb `0.4.0` i et diu
     * que corres `0.3.0` i que has d'actualitzar. En producció no s'hauria manifestat mai
     * —la versió no canvia dins d'un procés— i hauria esperat el dia que algú la fes
     * dependre de la petició.
     */
    let trucades = 0;
    const comuns = {
      enabled: true,
      sourceUrl: REPO,
      fetcher: async () => {
        trucades += 1;
        return resposta('v0.4.0');
      },
      now: () => 1_000_000,
    };

    const vella = await checkForUpdate({ ...comuns, currentVersion: '0.3.0' });
    expect(vella).toMatchObject({ current: '0.3.0', available: true });

    const alDia = await checkForUpdate({ ...comuns, currentVersion: '0.4.0' });
    expect(alDia).toMatchObject({ current: '0.4.0', available: false });

    // I la dada de fora s'ha demanat una sola vegada, que és el que la cau ha de fer.
    expect(trucades).toBe(1);
  });

  it('un fracàs NO es recorda', async () => {
    /**
     * Si es guardés, una caiguda de cinc minuts deixaria "no se sap" clavat sis hores. El
     * cost de tornar-ho a provar és una petició; el de recordar-ho és no assabentar-se.
     */
    let trucades = 0;
    const opcions = {
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      now: () => 1_000_000,
    };

    await checkForUpdate({
      ...opcions,
      fetcher: async () => {
        trucades += 1;
        throw new Error('sense xarxa');
      },
    });
    const bona = await checkForUpdate({
      ...opcions,
      fetcher: async () => {
        trucades += 1;
        return resposta('v0.5.0');
      },
    });

    expect(trucades).toBe(2);
    expect(bona.reason).toBe('ok');
  });
});

describe('el cas normal', () => {
  it('diu quina hi ha, si és més nova, i on mirar-la', async () => {
    const estat = await checkForUpdate({
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher: async () => resposta('v0.5.0'),
    });
    expect(estat).toEqual({
      current: '0.4.0',
      latest: '0.5.0',
      available: true,
      url: `${REPO}/releases/tag/v0.5.0`,
      reason: 'ok',
    });
  });

  it('i amb la mateixa versió, no avisa de res', async () => {
    const estat = await checkForUpdate({
      enabled: true,
      sourceUrl: REPO,
      currentVersion: '0.4.0',
      fetcher: async () => resposta('v0.4.0'),
    });
    expect(estat.available).toBe(false);
    expect(estat.reason).toBe('ok');
  });
});
