/**
 * L'horari i les hores extres, amb els casos que es trenquen sols.
 *
 * Els tres paranys de creuar un interval amb una franja de paret —la mitjanit, el canvi
 * d'hora i el dia no laborable— tenen aquí el seu cas, perquè el dia que algú simplifiqui
 * això a una resta d'hores el resultat només serà incorrecte dos dies l'any i ningú ho
 * relacionarà amb aquest fitxer.
 */

import { describe, expect, it } from 'vitest';
import { needsReview, splitWorkTime, type WorkHours } from './work-hours.js';

const NOU_A_SIS: WorkHours = { start: '09:00', end: '18:00', days: '1111100' };
const TZ = 'Europe/Madrid';

const bloc = (startedAt: string, endedAt: string) => ({ startedAt, endedAt });

describe('dins i fora de la jornada', () => {
  it('un matí sencer és tot horari', () => {
    // Dimecres 12/08/2026, 9:25–10:15 hora de Madrid (UTC+2 a l'agost).
    const split = splitWorkTime(
      bloc('2026-08-12T07:25:00.000Z', '2026-08-12T08:15:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split).toEqual({ total: 50, overtime: 0 });
  });

  it('començar abans d’obrir compta com a extra només el tros de fora', () => {
    // 8:30–9:30 local: mitja hora abans d'hora, mitja hora dins.
    const split = splitWorkTime(
      bloc('2026-08-12T06:30:00.000Z', '2026-08-12T07:30:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split).toEqual({ total: 60, overtime: 30 });
  });

  it('i quedar-se després de tancar, igual', () => {
    // 17:30–19:00 local.
    const split = splitWorkTime(
      bloc('2026-08-12T15:30:00.000Z', '2026-08-12T17:00:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split).toEqual({ total: 90, overtime: 60 });
  });

  it('un dissabte és tot extra, encara que sigui a mig matí', () => {
    // Dissabte 15/08/2026, 10:00–12:00 local.
    const split = splitWorkTime(
      bloc('2026-08-15T08:00:00.000Z', '2026-08-15T10:00:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split).toEqual({ total: 120, overtime: 120 });
  });
});

describe('els casos que es trenquen sols', () => {
  it('un bloc que travessa la mitjanit es parteix pels dos dies', () => {
    /**
     * **No és «un dia».** Divendres 23:30 → dissabte 00:30: la primera mitja hora és de
     * divendres fora d'horari, la segona és de dissabte, que no és laborable. Les dues són
     * extres, però pel camí es demostra que el bloc s'ha partit: amb un sol dia, el dissabte
     * no s'hauria mirat mai.
     */
    const split = splitWorkTime(
      bloc('2026-08-14T21:30:00.000Z', '2026-08-14T22:30:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split).toEqual({ total: 60, overtime: 60 });
  });

  it('i un que va de dijous a divendres compta l’horari de tots dos', () => {
    // Dijous 17:00 → divendres 10:00 local: 1 h dins dijous + 1 h dins divendres,
    // i les 15 h del mig, fora.
    const split = splitWorkTime(
      bloc('2026-08-13T15:00:00.000Z', '2026-08-14T08:00:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split.total).toBe(17 * 60);
    expect(split.overtime).toBe(15 * 60);
  });

  it('el diumenge que el dia dura 25 hores, els minuts són els reals', () => {
    /**
     * 25/10/2026, tornada a l'horari d'hivern: a les 3:00 locals es tornen les 2:00. Un bloc
     * d'1:30 a 3:30 de paret dura **tres** hores de rellotge, no dues. Si això es comptés amb
     * aritmètica de paret sortirien 120 minuts, i el número seria fals sense donar cap error.
     */
    const split = splitWorkTime(
      bloc('2026-10-24T23:30:00.000Z', '2026-10-25T02:30:00.000Z'),
      NOU_A_SIS,
      TZ,
    );
    expect(split.total).toBe(180);
    // Diumenge: tot extra.
    expect(split.overtime).toBe(180);
  });

  it('un bloc obert o del revés no compta res', () => {
    expect(splitWorkTime(bloc('2026-08-12T10:00:00.000Z', ''), NOU_A_SIS, TZ)).toEqual({
      total: 0,
      overtime: 0,
    });
    expect(
      splitWorkTime(bloc('2026-08-12T10:00:00.000Z', '2026-08-12T09:00:00.000Z'), NOU_A_SIS, TZ),
    ).toEqual({ total: 0, overtime: 0 });
  });

  it('amb tots els dies laborables, un diumenge de matí és horari', () => {
    const setDies: WorkHours = { ...NOU_A_SIS, days: '1111111' };
    const split = splitWorkTime(
      bloc('2026-08-16T08:00:00.000Z', '2026-08-16T10:00:00.000Z'),
      setDies,
      TZ,
    );
    expect(split).toEqual({ total: 120, overtime: 0 });
  });
});

describe('els blocs que demanen una mirada', () => {
  it('per sobre del llindar de l’àmbit, i no per sota', () => {
    expect(needsReview(7 * 60, 8)).toBe(false);
    expect(needsReview(8 * 60, 8)).toBe(false);
    expect(needsReview(8 * 60 + 1, 8)).toBe(true);
  });
});
