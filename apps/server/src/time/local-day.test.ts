/**
 * docs/13 M2: "localDayBounds és correcta a Europe/Madrid als dos diumenges de canvi
 * d'hora i en un fus amb desplaçament no sencer."
 *
 * Aquestes proves són les que decideixen si "què he de fer avui" és correcte. Una
 * implementació amb `inici + 24 h` passa totes les proves d'un dia normal i falla
 * exactament dos dies l'any, sense error visible.
 */

import { describe, expect, it } from 'vitest';
import { localDateOf, localDayBounds, localDayLengthHours } from './local-day.js';

describe('localDayBounds · dia normal', () => {
  it("a Europe/Madrid a l'estiu, el dia va de 22:00Z a 22:00Z", () => {
    // A l'estiu Madrid és UTC+2, o sigui que el dia local comença a les 22:00Z del
    // dia anterior.
    expect(localDayBounds('Europe/Madrid', '2026-08-05')).toEqual({
      startUTC: '2026-08-04T22:00:00.000Z',
      endUTC: '2026-08-05T22:00:00.000Z',
    });
  });

  it("a Europe/Madrid a l'hivern, de 23:00Z a 23:00Z", () => {
    expect(localDayBounds('Europe/Madrid', '2026-01-15')).toEqual({
      startUTC: '2026-01-14T23:00:00.000Z',
      endUTC: '2026-01-15T23:00:00.000Z',
    });
  });

  it('a UTC, de mitjanit a mitjanit', () => {
    expect(localDayBounds('UTC', '2026-08-05')).toEqual({
      startUTC: '2026-08-05T00:00:00.000Z',
      endUTC: '2026-08-06T00:00:00.000Z',
    });
  });

  it('un dia normal dura 24 hores', () => {
    expect(localDayLengthHours('Europe/Madrid', '2026-08-05')).toBe(24);
  });
});

describe("localDayBounds · els dos diumenges de canvi d'hora a Europe/Madrid", () => {
  // A la UE el canvi és l'últim diumenge de març i l'últim d'octubre, a les 01:00 UTC.
  // El 2026: 29 de març i 25 d'octubre.

  it('el diumenge de primavera dura 23 hores', () => {
    expect(localDayLengthHours('Europe/Madrid', '2026-03-29')).toBe(23);
  });

  it('el diumenge de tardor dura 25 hores', () => {
    expect(localDayLengthHours('Europe/Madrid', '2026-10-25')).toBe(25);
  });

  it("el dia de primavera comença en horari d'hivern i acaba en horari d'estiu", () => {
    const { startUTC, endUTC } = localDayBounds('Europe/Madrid', '2026-03-29');
    // Comença a les 23:00Z (UTC+1) i acaba a les 22:00Z (UTC+2). 23 hores.
    expect(startUTC).toBe('2026-03-28T23:00:00.000Z');
    expect(endUTC).toBe('2026-03-29T22:00:00.000Z');
  });

  it("el dia de tardor comença en horari d'estiu i acaba en horari d'hivern", () => {
    const { startUTC, endUTC } = localDayBounds('Europe/Madrid', '2026-10-25');
    expect(startUTC).toBe('2026-10-24T22:00:00.000Z');
    expect(endUTC).toBe('2026-10-25T23:00:00.000Z');
  });

  it('AQUESTA és la prova que enxampa `inici + 24 h`', () => {
    // Una implementació que sumi 24 hores dona aquests valors erronis, i cap error.
    for (const [date, esperat] of [
      ['2026-03-29', 23],
      ['2026-10-25', 25],
    ] as const) {
      const { startUTC, endUTC } = localDayBounds('Europe/Madrid', date);
      const ingenu = new Date(Date.parse(startUTC) + 24 * 3_600_000).toISOString();
      expect(endUTC, `el dia ${date} no dura 24 h`).not.toBe(ingenu);
      expect(localDayLengthHours('Europe/Madrid', date)).toBe(esperat);
    }
  });
});

describe('localDayBounds · fus amb desplaçament no sencer', () => {
  // Pacific/Chatham és +12:45 a l'hivern austral i +13:45 a l'estiu. docs/13 el
  // demana explícitament perquè els quarts d'hora trenquen les implementacions que
  // assumeixen desplaçaments en hores senceres.

  it('el desplaçament porta 45 minuts', () => {
    const { startUTC } = localDayBounds('Pacific/Chatham', '2026-08-05');
    // Hivern austral: +12:45, o sigui que el dia comença a les 11:15Z del dia abans.
    expect(startUTC).toBe('2026-08-04T11:15:00.000Z');
  });

  it('el dia dura 24 hores fora dels canvis', () => {
    expect(localDayLengthHours('Pacific/Chatham', '2026-08-05')).toBe(24);
  });

  it('també fa 23 i 25 hores als seus canvis', () => {
    // A Chatham el canvi és al setembre i a l'abril (hemisferi sud).
    const setembre = localDayLengthHours('Pacific/Chatham', '2026-09-27');
    const abril = localDayLengthHours('Pacific/Chatham', '2026-04-05');
    expect([setembre, abril].sort()).toEqual([23, 25]);
  });
});

describe('localDayBounds · dos usuaris a fusos diferents', () => {
  it('veuen finestres d\'"avui" diferents per al mateix dia', () => {
    // docs/14 P2: la columna Fet ha de ser correcta quan dues persones de la casa són
    // a fusos diferents.
    const madrid = localDayBounds('Europe/Madrid', '2026-08-05');
    const mexic = localDayBounds('America/Mexico_City', '2026-08-05');
    expect(madrid.startUTC).not.toBe(mexic.startUTC);
    expect(Date.parse(mexic.startUTC)).toBeGreaterThan(Date.parse(madrid.startUTC));
  });
});

describe('localDateOf', () => {
  it("una tasca completada a les 23:30 de Madrid és d'aquell dia, no del següent", () => {
    // 21:30Z a l'estiu és 23:30 a Madrid.
    expect(localDateOf('Europe/Madrid', new Date('2026-08-05T21:30:00Z'))).toBe('2026-08-05');
  });

  it('i a les 00:30 de Madrid ja és del dia següent, tot i ser 22:30Z', () => {
    expect(localDateOf('Europe/Madrid', new Date('2026-08-05T22:30:00Z'))).toBe('2026-08-06');
  });

  it('el mateix instant cau en dies diferents segons qui mira', () => {
    const instant = new Date('2026-08-05T03:00:00Z');
    expect(localDateOf('Europe/Madrid', instant)).toBe('2026-08-05');
    expect(localDateOf('America/Mexico_City', instant)).toBe('2026-08-04');
  });
});

describe('localDayBounds · entrada invàlida', () => {
  it('rebutja una data que no és YYYY-MM-DD', () => {
    expect(() => localDayBounds('UTC', '5/8/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => localDayBounds('UTC', '2026-08-05T00:00:00Z')).toThrow(/YYYY-MM-DD/);
  });
});
