/**
 * docs/13 M5 · criteris d'acceptació de la columna Fet:
 *   - "la columna Fet ensenya avui més 'Ahir' i 'Aquesta setmana' plegats"
 *   - "netejar no esborra res i 'veure tot el fet d'avui' ho recupera"
 *
 * docs/14 P2 explica per què és una consulta i no un estat: cap job nocturn que pugui
 * fallar, correcte amb els canvis d'hora, i correcte quan dues persones de la casa són
 * a fusos diferents.
 */

import { describe, expect, it } from 'vitest';
import { groupDone, hiddenTodayCount, type DoneTask } from './DoneColumn.js';

const MADRID = 'Europe/Madrid';

function task(id: string, completedAt: string): DoneTask {
  return {
    id,
    title: `Tasca ${id}`,
    status: 'done',
    scope_id: 'personal',
    completed_at: completedAt,
  };
}

describe('groupDone', () => {
  // 5 d'agost de 2026, 12:00 a Madrid (estiu, UTC+2).
  const now = new Date('2026-08-05T10:00:00Z');

  it('separa avui, ahir, aquesta setmana i més antigues', () => {
    const grups = groupDone(
      [
        task('avui', '2026-08-05T08:00:00Z'),
        task('ahir', '2026-08-04T08:00:00Z'),
        task('fa-tres-dies', '2026-08-02T08:00:00Z'),
        task('fa-un-mes', '2026-07-01T08:00:00Z'),
      ],
      { timezone: MADRID, now },
    );

    expect(grups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'thisWeek', 'older']);
    expect(grups[0]?.tasks.map((t) => t.id)).toEqual(['avui']);
    expect(grups[1]?.tasks.map((t) => t.id)).toEqual(['ahir']);
  });

  it('avui surt desplegat i la resta plegada', () => {
    // "No s'amaga res, es plega" (docs/14 P2).
    const grups = groupDone(
      [task('a', '2026-08-05T08:00:00Z'), task('b', '2026-08-04T08:00:00Z')],
      { timezone: MADRID, now },
    );
    expect(grups[0]?.collapsedByDefault).toBe(false);
    expect(grups[1]?.collapsedByDefault).toBe(true);
  });

  it('no inventa grups buits', () => {
    const grups = groupDone([task('a', '2026-08-05T08:00:00Z')], { timezone: MADRID, now });
    expect(grups).toHaveLength(1);
  });

  it("una tasca acabada a les 23:30 de Madrid és d'avui, no de demà", () => {
    // 21:30Z a l'estiu són les 23:30 a Madrid. Amb una comparació en UTC cauria al dia
    // següent i desapareixeria de la columna a l'usuari que la va acabar.
    const grups = groupDone([task('nit', '2026-08-05T21:30:00Z')], {
      timezone: MADRID,
      now: new Date('2026-08-05T21:45:00Z'),
    });
    expect(grups[0]?.bucket).toBe('today');
  });

  it('el mateix instant cau en dies diferents segons qui mira', () => {
    // docs/14 P2: correcte quan dues persones de la casa són a fusos diferents.
    const instant = task('x', '2026-08-05T03:00:00Z');
    const ara = new Date('2026-08-05T10:00:00Z');

    expect(groupDone([instant], { timezone: MADRID, now: ara })[0]?.bucket).toBe('today');
    expect(groupDone([instant], { timezone: 'America/Mexico_City', now: ara })[0]?.bucket).toBe(
      'yesterday',
    );
  });
});

describe("AQUESTA és la de docs/13: netejar no esborra res i 'Tot avui' ho recupera", () => {
  const now = new Date('2026-08-05T16:00:00Z');
  const fetes = [
    task('mati', '2026-08-05T07:00:00Z'),
    task('migdia', '2026-08-05T11:00:00Z'),
    task('tarda', '2026-08-05T15:00:00Z'),
  ];
  // S'ha netejat al migdia: el que hi havia fins llavors deixa de sortir desplegat.
  const clearedAt = '2026-08-05T12:00:00Z';

  it('després de netejar només surt el fet DESPRÉS del llindar', () => {
    const grups = groupDone(fetes, { timezone: MADRID, now, doneClearedAt: clearedAt });
    expect(grups[0]?.tasks.map((t) => t.id)).toEqual(['tarda']);
  });

  it('"Tot avui" les recupera TOTES', () => {
    const grups = groupDone(fetes, {
      timezone: MADRID,
      now,
      doneClearedAt: clearedAt,
      showAllToday: true,
    });
    expect(grups[0]?.tasks.map((t) => t.id)).toEqual(['mati', 'migdia', 'tarda']);
  });

  it('netejar NO esborra: les tasques hi continuen sent', () => {
    // El llindar és una preferència de l'usuari, no un canvi a les dades. Una altra
    // persona de la casa continua veient el que hi havia.
    const altraPersona = groupDone(fetes, { timezone: MADRID, now });
    expect(altraPersona[0]?.tasks).toHaveLength(3);
  });

  it('el botó "Tot avui" només té sentit si amaga alguna cosa', () => {
    // docs/02 §4: apareix NOMÉS quan hi ha done_cleared_at d'avui.
    expect(hiddenTodayCount(fetes, { timezone: MADRID, now, doneClearedAt: clearedAt })).toBe(2);
    expect(hiddenTodayCount(fetes, { timezone: MADRID, now })).toBe(0);
  });

  it('netejar no toca ni ahir ni aquesta setmana', () => {
    const grups = groupDone([...fetes, task('ahir', '2026-08-04T08:00:00Z')], {
      timezone: MADRID,
      now,
      doneClearedAt: clearedAt,
    });
    expect(grups.find((g) => g.bucket === 'yesterday')?.tasks).toHaveLength(1);
  });
});
