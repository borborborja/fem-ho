/**
 * Reconstruir el passat, i els casos en què val més no reconstruir res.
 *
 * El que decideix aquí és la frontera entre **deduir** i **suposar**. Una durada que surt
 * d'una entrada i una sortida és una mesura; una que surt d'una entrada i una conjectura és
 * un número amb pinta de mesura, que és pitjor que no tenir-lo.
 */

import { describe, expect, it } from 'vitest';
import { rebuildSessions, type StatusChange } from './session-rebuild.js';

const canvi = (
  taskId: string,
  at: string,
  from: string | null,
  to: string | null,
  userId: string | null = 'borja',
): StatusChange => ({ taskId, at, from, to, userId });

describe('el que es pot deduir', () => {
  it('una entrada i una sortida són un bloc', () => {
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:25:00.000Z', 'todo', 'doing'),
      canvi('t1', '2026-08-12T10:15:00.000Z', 'doing', 'done'),
    ]);

    expect(trams).toEqual([
      {
        taskId: 't1',
        userId: 'borja',
        startedAt: '2026-08-12T09:25:00.000Z',
        endedAt: '2026-08-12T10:15:00.000Z',
      },
    ]);
  });

  it('tornar de Fet a Fent i acabar-la són DOS blocs', () => {
    /**
     * És el cas que va decidir el model: si la dedicació fos un acumulat a la tasca, això
     * seria un sol número i el cronograma no podria existir.
     */
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing'),
      canvi('t1', '2026-08-12T09:30:00.000Z', 'doing', 'done'),
      canvi('t1', '2026-08-12T16:00:00.000Z', 'done', 'doing'),
      canvi('t1', '2026-08-12T16:20:00.000Z', 'doing', 'done'),
    ]);

    expect(trams).toHaveLength(2);
    expect(trams.map((t) => t.startedAt)).toEqual([
      '2026-08-12T09:00:00.000Z',
      '2026-08-12T16:00:00.000Z',
    ]);
  });

  it('dues tasques alhora no es barregen', () => {
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing'),
      canvi('t2', '2026-08-12T09:10:00.000Z', 'todo', 'doing'),
      canvi('t1', '2026-08-12T09:20:00.000Z', 'doing', 'todo'),
      canvi('t2', '2026-08-12T09:40:00.000Z', 'doing', 'done'),
    ]);

    expect(trams).toHaveLength(2);
    expect(trams.find((t) => t.taskId === 't1')?.endedAt).toBe('2026-08-12T09:20:00.000Z');
    expect(trams.find((t) => t.taskId === 't2')?.endedAt).toBe('2026-08-12T09:40:00.000Z');
  });

  it('el temps és de qui va moure la targeta, no del propietari de la tasca', () => {
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing', 'marta'),
      canvi('t1', '2026-08-12T09:30:00.000Z', 'doing', 'done', 'borja'),
    ]);
    expect(trams[0]?.userId).toBe('marta');
  });
});

describe('el que val més no suposar', () => {
  it('una entrada sense sortida i amb vida després no dona cap bloc', () => {
    /**
     * Hi ha un forat a l'historial. Tancar-lo amb el següent rastre que hi hagi donaria una
     * durada que ningú ha mesurat: el que se sap és que hi va entrar, i prou.
     */
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing'),
      canvi('t1', '2026-08-12T11:00:00.000Z', 'todo', 'done'),
    ]);
    expect(trams).toEqual([]);
  });

  it("però la que hi és ARA es queda oberta: no és cap forat, s'està fent", () => {
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing'),
      canvi('t1', '2026-08-12T09:30:00.000Z', 'doing', 'todo'),
      canvi('t1', '2026-08-12T10:00:00.000Z', 'todo', 'doing'),
    ]);

    expect(trams).toHaveLength(2);
    expect(trams[1]?.endedAt).toBeNull();
  });

  it('un canvi sense persona —un convidat, el sistema— no genera cap bloc', () => {
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing', null),
      canvi('t1', '2026-08-12T09:30:00.000Z', 'doing', 'done', null),
    ]);
    expect(trams).toEqual([]);
  });

  it('i un bloc de durada zero tampoc: no és feina, és un clic', () => {
    const trams = rebuildSessions([
      canvi('t1', '2026-08-12T09:00:00.000Z', 'todo', 'doing'),
      canvi('t1', '2026-08-12T09:00:00.000Z', 'doing', 'todo'),
    ]);
    expect(trams).toEqual([]);
  });
});
