/**
 * docs/13 M7 · comprovació de la fita: `test: recurrence`.
 *
 * Els criteris que toca aquesta prova:
 *   - Una sèrie recurrent es pot editar en mode instància, futures o tota.
 *   - Editar "aquest i els següents" **parteix la sèrie i NO emet `RANGE=THISANDFUTURE`**.
 */

import { describe, expect, it } from 'vitest';
import { expandOccurrences, hasThisAndFuture, splitSeries } from './recurrence.js';

const FROM = '2026-08-01T00:00:00Z';
const TO = '2026-09-01T00:00:00Z';

describe('expandOccurrences', () => {
  it('sense regla, només hi ha el propi esdeveniment', () => {
    const out = expandOccurrences({
      startsAt: '2026-08-05T09:00:00Z',
      endsAt: '2026-08-05T10:00:00Z',
      from: FROM,
      to: TO,
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.startsAt).toBe('2026-08-05T09:00:00.000Z');
  });

  it('una regla setmanal dona una ocurrència per setmana', () => {
    const out = expandOccurrences({
      startsAt: '2026-08-05T09:00:00Z',
      endsAt: '2026-08-05T10:00:00Z',
      rrule: 'FREQ=WEEKLY',
      from: FROM,
      to: TO,
    });
    // 5, 12, 19 i 26 d'agost.
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.startsAt.slice(0, 10))).toEqual([
      '2026-08-05',
      '2026-08-12',
      '2026-08-19',
      '2026-08-26',
    ]);
  });

  it("sap fer 'el primer dimarts de cada mes', que és el que Vikunja no pot", () => {
    // docs/01 §9: "rrule guarda una RRULE d'RFC 5545, no un nombre de segons. Vikunja
    // fa servir segons i és la seva limitació més citada: no pot expressar 'el primer
    // dimarts de cada mes', que és exactament el tipus de norma domèstica que Fem-ho
    // necessita."
    const out = expandOccurrences({
      startsAt: '2026-08-04T18:00:00Z',
      rrule: 'FREQ=MONTHLY;BYDAY=1TU',
      from: '2026-08-01T00:00:00Z',
      to: '2026-12-01T00:00:00Z',
    });

    expect(out.map((o) => o.startsAt.slice(0, 10))).toEqual([
      '2026-08-04',
      '2026-09-01',
      '2026-10-06',
      '2026-11-03',
    ]);
  });

  it('respecta COUNT', () => {
    const out = expandOccurrences({
      startsAt: '2026-08-05T09:00:00Z',
      rrule: 'FREQ=DAILY;COUNT=3',
      from: FROM,
      to: TO,
    });
    expect(out).toHaveLength(3);
  });

  it('respecta UNTIL', () => {
    const out = expandOccurrences({
      startsAt: '2026-08-05T09:00:00Z',
      rrule: 'FREQ=DAILY;UNTIL=20260807T090000Z',
      from: FROM,
      to: TO,
    });
    expect(out.map((o) => o.startsAt.slice(0, 10))).toEqual([
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ]);
  });

  it('EXDATE treu ocurrències concretes', () => {
    const out = expandOccurrences({
      startsAt: '2026-08-05T09:00:00Z',
      rrule: 'FREQ=DAILY;COUNT=4',
      exdate: ['2026-08-06T09:00:00Z'],
      from: FROM,
      to: TO,
    });
    expect(out.map((o) => o.startsAt.slice(0, 10))).toEqual([
      '2026-08-05',
      '2026-08-07',
      '2026-08-08',
    ]);
  });

  it('RDATE hi afegeix dates soltes', () => {
    const out = expandOccurrences({
      startsAt: '2026-08-05T09:00:00Z',
      rrule: 'FREQ=WEEKLY;COUNT=2',
      rdate: ['2026-08-20T09:00:00Z'],
      from: FROM,
      to: TO,
    });
    expect(out.map((o) => o.startsAt.slice(0, 10))).toEqual([
      '2026-08-05',
      '2026-08-12',
      '2026-08-20',
    ]);
  });

  it('una ocurrència que SOLAPA la finestra hi surt, encara que hi comenci abans', () => {
    // RFC 4791 §9.9 defineix el solapament, no la inclusió. Un esdeveniment que va
    // començar ahir a les 23:00 i acaba avui a la 1:00 és d'avui també.
    const out = expandOccurrences({
      startsAt: '2026-08-04T23:00:00Z',
      endsAt: '2026-08-05T01:00:00Z',
      from: '2026-08-05T00:00:00Z',
      to: '2026-08-06T00:00:00Z',
    });
    expect(out).toHaveLength(1);
  });

  it('una regla infinita no expandeix sense límit', () => {
    // Sense sostre, una FREQ=MINUTELY amb una finestra d'un any esgota la memòria.
    const out = expandOccurrences({
      startsAt: '2026-08-05T00:00:00Z',
      rrule: 'FREQ=MINUTELY',
      from: FROM,
      to: TO,
      limit: 50,
    });
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it('la finestra és obligatòria i ha de ser vàlida', () => {
    expect(() =>
      expandOccurrences({ startsAt: '2026-08-05T09:00:00Z', from: 'ahir', to: TO }),
    ).toThrow();
  });
});

describe("AQUESTA és la de docs/13: 'aquest i els següents' parteix la sèrie", () => {
  const master = 'FREQ=WEEKLY;BYDAY=WE';
  const masterStart = '2026-08-05T09:00:00Z';
  const splitAt = '2026-08-19T09:00:00Z';

  it('el mestre rep un UNTIL just abans del tall', () => {
    const { masterRrule } = splitSeries(master, splitAt, masterStart);
    expect(masterRrule).toContain('UNTIL=');

    // El mestre ja no arriba al tall.
    const abans = expandOccurrences({
      startsAt: masterStart,
      rrule: masterRrule,
      from: FROM,
      to: TO,
    });
    expect(abans.map((o) => o.startsAt.slice(0, 10))).toEqual(['2026-08-05', '2026-08-12']);
  });

  it("l'ocurrència del tall pertany a la sèrie NOVA, no a les dues", () => {
    const { newRrule, newStartsAt } = splitSeries(master, splitAt, masterStart);
    const despres = expandOccurrences({
      startsAt: newStartsAt,
      rrule: newRrule,
      from: FROM,
      to: TO,
    });
    expect(despres[0]?.startsAt.slice(0, 10)).toBe('2026-08-19');
  });

  it('les dues sèries juntes donen exactament les ocurrències originals', () => {
    const original = expandOccurrences({
      startsAt: masterStart,
      rrule: master,
      from: FROM,
      to: TO,
    });
    const { masterRrule, newRrule, newStartsAt } = splitSeries(master, splitAt, masterStart);

    const partida = [
      ...expandOccurrences({ startsAt: masterStart, rrule: masterRrule, from: FROM, to: TO }),
      ...expandOccurrences({ startsAt: newStartsAt, rrule: newRrule, from: FROM, to: TO }),
    ].map((o) => o.startsAt);

    // Ni se n'ha perdut cap ni se n'ha duplicat cap: és la prova que el tall és net.
    expect(partida.sort()).toEqual(original.map((o) => o.startsAt).sort());
  });

  it('NO emet RANGE=THISANDFUTURE enlloc', () => {
    // docs/01 §5: "es parseja però no s'emet mai".
    const { masterRrule, newRrule } = splitSeries(master, splitAt, masterStart);
    expect(hasThisAndFuture(masterRrule)).toBe(false);
    expect(hasThisAndFuture(newRrule)).toBe(false);
  });

  it('el mestre no es queda amb COUNT i UNTIL alhora', () => {
    // RFC 5545 els fa mútuament excloents. Amb tots dos, molts clients es planten.
    const { masterRrule } = splitSeries('FREQ=DAILY;COUNT=10', splitAt, masterStart);
    const teCount = /COUNT=/.test(masterRrule);
    const teUntil = /UNTIL=/.test(masterRrule);
    expect(teCount && teUntil).toBe(false);
    expect(teUntil).toBe(true);
  });

  it("un tall anterior a l'inici es rebutja", () => {
    expect(() => splitSeries(master, '2026-07-01T09:00:00Z', masterStart)).toThrow();
  });
});

describe('hasThisAndFuture', () => {
  it('el reconeix quan ve de fora, que és per a què serveix', () => {
    expect(hasThisAndFuture('RANGE=THISANDFUTURE')).toBe(true);
    expect(hasThisAndFuture('range=thisandfuture')).toBe(true);
    expect(hasThisAndFuture('FREQ=WEEKLY')).toBe(false);
  });
});
