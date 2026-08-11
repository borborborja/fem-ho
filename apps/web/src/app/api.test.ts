/**
 * El text d'un error, en l'idioma de qui mira.
 *
 * El servidor envia `type` i `params` i un `detail` en anglès per a les màquines. Qui
 * compon la frase és aquesta funció, i és **l'únic lloc** on passa: si es trenca, tots
 * els errors de l'app es trenquen alhora, i per això té proves pròpies.
 */

import { setLocale, t } from '@fem-ho/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError, failureText, problemText, type Problem } from './api.js';

const notFound: Problem = {
  type: 'https://femho.app/errors/not-found',
  title: 'Not found',
  status: 404,
  detail: 'There is no task with identifier abc.',
  params: { entityType: 'task', id: 'abc' },
};

afterEach(() => setLocale('ca'));

describe('problemText', () => {
  it('tradueix pel tram final del type, no pel detail', () => {
    setLocale('ca');
    expect(problemText(notFound, 'x')).toBe(t('error.not-found'));
    setLocale('es');
    expect(problemText(notFound, 'x')).toBe('Esto ya no está.');
    setLocale('en');
    expect(problemText(notFound, 'x')).toBe('This is no longer here.');
  });

  it('hi posa els paràmetres', () => {
    setLocale('ca');
    const problem: Problem = {
      type: 'https://femho.app/errors/calendar-read-only',
      title: 'Calendar is read-only',
      status: 403,
      detail: 'The "Festius" calendar is a read-only source and cannot be written to.',
      params: { name: 'Festius' },
    };
    expect(problemText(problem, 'x')).toContain('Festius');
    // I no queda cap marcador sense omplir, que seria el símptoma d'un `params` que no
    // quadra amb el catàleg.
    expect(problemText(problem, 'x')).not.toContain('{');
  });

  /**
   * **Un error nou del servidor no pot deixar una pantalla muda.**
   *
   * És el que permet desplegar el servidor abans que les apps sense que ningú es quedi
   * mirant un forat: es veu el text anglès, que és lleig però es llegeix.
   */
  it('un tipus que el catàleg no coneix cau al detail anglès', () => {
    const inventat: Problem = {
      type: 'https://femho.app/errors/quelcom-nou',
      title: 'Something new',
      status: 400,
      detail: 'Something new happened.',
    };
    expect(problemText(inventat, 'x')).toBe('Something new happened.');
  });

  it('i sense cap problema, el text de reserva', () => {
    expect(problemText(undefined, 'no hi ha manera de connectar')).toBe(
      'no hi ha manera de connectar',
    );
  });
});

describe('què ha fallat', () => {
  /**
   * **«Alguna cosa ha fallat» era el que sortia sempre a l'arrencada.** Amb una instància
   * nova darrere d'un proxy, això vol dir mirar el formulari quan el que passa és que el
   * contenidor no està engegat — i la persona no té manera de saber-ho.
   */
  it('un proxy que no arriba al servidor ho diu, i no culpa el formulari', () => {
    for (const status of [502, 503, 504]) {
      const text = failureText(new ApiError(status, undefined, `HTTP ${String(status)}`));
      expect(text).toBe(t('error.unreachable'));
    }
  });

  it('i una xarxa caiguda, també', () => {
    // `fetch` rebutja amb `TypeError` quan no hi ha hagut resposta: DNS, TLS, sense xarxa.
    expect(failureText(new TypeError('Failed to fetch'))).toBe(t('error.unreachable'));
  });

  it("un error de l'API es diu amb el text del catàleg quan el tenim", () => {
    const problem = {
      type: 'https://femho.app/errors/email-taken',
      title: 'Email taken',
      status: 409,
      detail: 'Aquest correu ja té compte.',
      params: { email: 'borja@example.com' },
    };
    // El catàleg mana i els paràmetres s'hi interpolen: és el que fa que l'error surti en
    // l'idioma de qui mira i no en el del servidor.
    expect(failureText(new ApiError(409, problem, 'HTTP 409'))).toContain('borja@example.com');
  });

  it('i amb el `detail` del servidor quan no en tenim traducció', () => {
    /**
     * **Aquest és el cas que importava.** La pantalla d'arrencada tirava l'error i deia
     * «alguna cosa ha fallat»; ara diu el que el servidor explica, encara que sigui un
     * problema que la interfície no coneix.
     */
    const problem = {
      type: 'https://femho.app/errors/una-cosa-que-no-coneixem',
      title: 'Nou',
      status: 422,
      detail: 'El nom de la instància no pot ser buit.',
    };
    expect(failureText(new ApiError(422, problem, 'HTTP 422'))).toBe(
      'El nom de la instància no pot ser buit.',
    );
  });

  it('i el que no és cap de les tres coses cau a la frase de sempre', () => {
    expect(failureText(new Error('vés a saber'))).toBe(t('error.generic'));
    expect(failureText('una cadena')).toBe(t('error.generic'));
  });
});
