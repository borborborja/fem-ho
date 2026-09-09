import { describe, it, expect } from 'vitest';
import { adjustInterval, inputInstant, localInput, stackIntervals } from './chrono-time.js';
describe('cronograma amb temps real', () => {
  it('manté dues hores reals en travessar el salt d’estiu', () => {
    const start = Date.parse('2026-03-29T00:30:00Z'),
      end = Date.parse('2026-03-29T02:30:00Z');
    const moved = adjustInterval(start, end, 300000, 'move', end);
    expect(moved.end! - moved.start).toBe(7200000);
    expect(localInput(start, 'Europe/Madrid')).toBe('2026-03-29T01:30');
    expect(localInput(end, 'Europe/Madrid')).toBe('2026-03-29T04:30');
    expect(inputInstant('2026-03-29T02:30', 'Europe/Madrid')).toBeNaN();
  });
  it('distingeix les dues ocurrències de les 02:30 de tardor', () => {
    for (const iso of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z'])
      expect(inputInstant('2026-10-25T02:30', 'Europe/Madrid', Date.parse(iso))).toBe(
        Date.parse(iso),
      );
  });
  it('no tanca les sessions obertes i evita invertir una vora', () => {
    expect(adjustInterval(0, null, 300000, 'move', 3600000)).toEqual({ start: 300000, end: null });
    expect(adjustInterval(0, 3600000, 7200000, 'left', 0)).toEqual({
      start: 3300000,
      end: 3600000,
    });
    expect(adjustInterval(0, 3600000, -7200000, 'right', 0)).toEqual({ start: 0, end: 300000 });
  });
  it('apila solapaments però reutilitza una subfila quan queda lliure', () => {
    expect(
      stackIntervals([
        { start: 0, end: 20 },
        { start: 10, end: 30 },
        { start: 20, end: 25 },
      ]).map((item) => item.row),
    ).toEqual([0, 1, 0]);
  });
});
