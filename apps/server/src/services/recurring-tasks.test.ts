/**
 * Tasques que es repeteixen. docs/13 M4, docs/01 §4.
 *
 * "`POST /tasks/{id}/complete` amb cascada i generació de la següent instància si es
 * repeteix, **distingint `recurrence_mode` `schedule` de `completion`**."
 *
 * La distinció no és un detall: és la que Todoist escriu com a `every` contra `every!`.
 * Treure les escombraries "cada dimarts" i regar les plantes "una setmana després
 * d'haver-les regat" són dues coses, i confondre-les fa que la segona s'acumuli o
 * desaparegui.
 */

import { describe, expect, it } from 'vitest';
import { nextDueDate } from './tasks.js';

describe('la data següent', () => {
  it('cada dia, cada setmana, cada mes i cada any', () => {
    expect(nextDueDate('FREQ=DAILY', '2026-08-06')).toBe('2026-08-07');
    expect(nextDueDate('FREQ=WEEKLY', '2026-08-06')).toBe('2026-08-13');
    expect(nextDueDate('FREQ=MONTHLY', '2026-08-06')).toBe('2026-09-06');
    expect(nextDueDate('FREQ=YEARLY', '2026-08-06')).toBe('2027-08-06');
  });

  it('amb interval', () => {
    expect(nextDueDate('FREQ=DAILY;INTERVAL=3', '2026-08-06')).toBe('2026-08-09');
    expect(nextDueDate('FREQ=WEEKLY;INTERVAL=2', '2026-08-06')).toBe('2026-08-20');
  });

  it('accepta el prefix `RRULE:`', () => {
    expect(nextDueDate('RRULE:FREQ=DAILY', '2026-08-06')).toBe('2026-08-07');
  });

  it('el canvi d\'hora NO mou el dia', () => {
    /**
     * L'últim diumenge d'octubre a Europa té 25 hores. Sumant mil·lisegons, "d'aquí a
     * una setmana" cau al dia anterior; comptant dies de calendari, no.
     */
    expect(nextDueDate('FREQ=WEEKLY', '2026-10-24')).toBe('2026-10-31');
    expect(nextDueDate('FREQ=DAILY', '2026-10-25')).toBe('2026-10-26');
    // I el diumenge de març, que en té 23.
    expect(nextDueDate('FREQ=DAILY', '2026-03-29')).toBe('2026-03-30');
  });

  it('salta els mesos curts com fa el calendari', () => {
    // 31 de gener + 1 mes: el calendari no té 31 de febrer i `Date` ho porta al març.
    // Es documenta el que fa, que és el que farà: no s'inventa un 28.
    expect(nextDueDate('FREQ=MONTHLY', '2026-01-31')).toBe('2026-03-03');
  });

  it('`UNTIL` acaba la sèrie', () => {
    expect(nextDueDate('FREQ=DAILY;UNTIL=20260810T000000Z', '2026-08-06')).toBe('2026-08-07');
    // Passat el límit, no se'n genera cap més.
    expect(nextDueDate('FREQ=DAILY;UNTIL=20260806T000000Z', '2026-08-06')).toBeNull();
  });

  it('una regla que no s\'entén NO genera res', () => {
    // Millor una tasca que no apareix —es nota— que una que apareix el dia equivocat
    // durant setmanes, que no.
    expect(nextDueDate('FREQ=SECONDLY', '2026-08-06')).toBeNull();
    expect(nextDueDate('BYDAY=MO,WE', '2026-08-06')).toBeNull();
    expect(nextDueDate('FREQ=DAILY;INTERVAL=0', '2026-08-06')).toBeNull();
  });
});
