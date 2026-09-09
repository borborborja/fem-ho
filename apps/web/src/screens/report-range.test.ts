import { describe, it, expect } from 'vitest';
import { reportRange } from './report-range.js';
describe('rang local dels informes', () => {
  it('utilitza el fus del perfil i no el del navegador', () => {
    expect(reportRange('today', 'Europe/Madrid', new Date('2026-07-22T22:30:00Z'))).toEqual({
      from: '2026-07-23',
      to: '2026-07-23',
    });
    expect(reportRange('today', 'America/Los_Angeles', new Date('2026-07-22T22:30:00Z'))).toEqual({
      from: '2026-07-22',
      to: '2026-07-22',
    });
  });
  it('compta dies de calendari al canvi d’hora i respecta l’inici de setmana', () => {
    expect(reportRange('days30', 'Europe/Madrid', new Date('2026-03-30T10:00:00Z'))).toEqual({
      from: '2026-03-01',
      to: '2026-03-30',
    });
    expect(reportRange('week', 'Europe/Madrid', new Date('2026-07-22T10:00:00Z'), 0).from).toBe(
      '2026-07-19',
    );
  });
});
