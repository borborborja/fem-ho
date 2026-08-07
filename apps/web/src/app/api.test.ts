/**
 * El text d'un error, en l'idioma de qui mira.
 *
 * El servidor envia `type` i `params` i un `detail` en anglès per a les màquines. Qui
 * compon la frase és aquesta funció, i és **l'únic lloc** on passa: si es trenca, tots
 * els errors de l'app es trenquen alhora, i per això té proves pròpies.
 */

import { setLocale, t } from '@fem-ho/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { problemText, type Problem } from './api.js';

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
