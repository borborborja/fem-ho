/**
 * El calendari, per idioma.
 *
 * El primer dia de la setmana és **una línia que si es perd desplaça el calendari un
 * dia i no dona cap error**. Per això té taula pròpia en comptes de sortir d'`Intl`:
 * `Intl.Locale#weekInfo` no hi és a Firefox, i el valor ha de ser idèntic a la web i a
 * Android. Aquestes proves fixen la taula; el port de Kotlin fixa la mateixa.
 */

import { describe, expect, it } from 'vitest';
import {
  longDay,
  monthName,
  resolveWeekStart,
  shortTime,
  startOfWeek,
  weekIndex,
  weekStart,
  weekdayNames,
} from './dates.js';

describe('el primer dia de la setmana', () => {
  it('dilluns en català i castellà, diumenge en anglès', () => {
    expect(weekStart('ca')).toBe(1);
    expect(weekStart('es')).toBe(1);
    expect(weekStart('en')).toBe(0);
  });

  it('la tria de la persona mana per damunt de l\'idioma', () => {
    expect(resolveWeekStart('sunday', 'ca')).toBe(0);
    expect(resolveWeekStart('monday', 'en')).toBe(1);
    // El primer dia no és només una convenció lingüística: qui treballa el cap de
    // setmana el vol d'una manera i qui no, d'una altra, amb la mateixa llengua.
    expect(resolveWeekStart('auto', 'en')).toBe(0);
    expect(resolveWeekStart(undefined, 'ca')).toBe(1);
  });

  it("l'1 d'agost de 2026 és dissabte, i cau on toca a cada graella", () => {
    const dissabte = new Date(2026, 7, 1);
    // Amb dilluns primer és la sisena columna; amb diumenge, la setena.
    expect(weekIndex(dissabte, 1)).toBe(5);
    expect(weekIndex(dissabte, 0)).toBe(6);
  });

  it('el primer dia de la setmana que conté una data', () => {
    const dimecres = new Date(2026, 7, 5);
    expect(startOfWeek(dimecres, 1).getDate()).toBe(3);
    expect(startOfWeek(dimecres, 0).getDate()).toBe(2);
  });
});

describe('els noms', () => {
  it('els dies surten en minúscula i sense punt, comencin on comencin', () => {
    expect(weekdayNames('ca', 1)[0]).toBe('dl');
    expect(weekdayNames('en', 0)[0]).toBe('sun');
    // El CLDR català porta punt final; una capçalera de dues lletres no en vol.
    expect(weekdayNames('ca', 1).every((day) => !day.endsWith('.'))).toBe(true);
    expect(weekdayNames('es', 1)).toHaveLength(7);
  });

  it('els mesos surten de CLDR i no del catàleg', () => {
    expect(monthName('ca', 7)).toBe('agost');
    expect(monthName('es', 7)).toBe('agosto');
    expect(monthName('en', 7)).toBe('August');
  });

  it("el dia sencer resol l'elisió catalana, que cap plantilla podria", () => {
    // "1 d’agost" i no "1 de agost": és per això que això no és una clau del catàleg.
    // I amb l'apòstrof tipogràfic, que és el bo — una plantilla escrita a mà hauria
    // portat el recte.
    expect(longDay('ca', new Date(2026, 7, 1))).toBe('1 d\u2019agost');
    expect(longDay('es', new Date(2026, 7, 1))).toContain('de agosto');
    // I l'ordre anglès, que una plantilla "{day} de {month}" tampoc podria expressar.
    expect(longDay('en', new Date(2026, 7, 1))).toBe('August 1');
  });
});

describe('les hores', () => {
  it('24 h en català i castellà, 12 h en anglès', () => {
    const tarda = new Date(2026, 7, 1, 15, 30);
    expect(shortTime('ca', tarda)).toBe('15:30');
    expect(shortTime('es', tarda)).toBe('15:30');
    expect(shortTime('en', tarda)).toMatch(/3:30\s?PM/u);
  });
});
