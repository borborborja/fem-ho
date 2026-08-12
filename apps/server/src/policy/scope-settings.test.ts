/**
 * Els defectes i el que s'accepta d'una petició.
 *
 * El que decideix aquí és **que la fila absent no encengui res**: és el que fa que la
 * migració que crea la taula no canviï el comportament de cap àmbit que ja existeix.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCOPE_SETTINGS,
  resolveScopeSettings,
  sanitizeScopeSettings,
  workHoursOf,
} from './scope-settings.js';

describe('quan ningú ha dit res', () => {
  it('la fila absent és tot per defecte, i el registre apagat', () => {
    expect(resolveScopeSettings(null)).toEqual(DEFAULT_SCOPE_SETTINGS);
    expect(resolveScopeSettings(undefined).time_tracking).toBe(false);
  });

  it('i els 0/1 de SQLite es llegeixen com a booleans', () => {
    const resolt = resolveScopeSettings({ time_tracking: 1, overtime_visible: 0 });
    expect(resolt.time_tracking).toBe(true);
    expect(resolt.overtime_visible).toBe(false);
  });

  it('un valor que no s’entén cau al defecte en comptes de propagar-se', () => {
    const resolt = resolveScopeSettings({
      work_start: '25:99',
      work_days: 'dilluns',
      long_session_hours: 'moltes',
      project_noun: 'client_final',
    });
    expect(resolt.work_start).toBe('09:00');
    expect(resolt.work_days).toBe('1111100');
    expect(resolt.long_session_hours).toBe(8);
    expect(resolt.project_noun).toBe('project');
  });

  it('i l’horari surt en la forma que espera el repartidor d’hores extres', () => {
    expect(workHoursOf(DEFAULT_SCOPE_SETTINGS)).toEqual({
      start: '09:00',
      end: '18:00',
      days: '1111100',
    });
  });
});

describe('el que s’accepta d’una petició', () => {
  it('passa el que és vàlid i **calla el que no**', () => {
    /**
     * Ignorar-ho i no petar: qui envia `work_start: 'de matí'` no ho arreglarà perquè li
     * diguem 422 —no és una persona escrivint un formulari, és un client mal fet—, i desar-hi
     * un valor inventat seria pitjor que deixar-ho com estava.
     */
    const net = sanitizeScopeSettings({
      time_tracking: true,
      work_start: '08:30',
      work_end: 'tard',
      work_days: '1111110',
      long_session_hours: 12,
      project_noun: 'client',
      name: 'Feina',
    });

    expect(net).toEqual({
      time_tracking: true,
      work_start: '08:30',
      work_days: '1111110',
      long_session_hours: 12,
      project_noun: 'client',
    });
  });

  it('el llindar es queda entre una hora i una setmana', () => {
    expect(sanitizeScopeSettings({ long_session_hours: 0 }).long_session_hours).toBe(1);
    expect(sanitizeScopeSettings({ long_session_hours: 1000 }).long_session_hours).toBe(168);
  });

  it('i «projecte» o «client», res més', () => {
    expect(sanitizeScopeSettings({ project_noun: 'compte' })).toEqual({});
  });
});
