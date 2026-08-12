/**
 * Com es comporta un àmbit, i què val quan ningú ho ha dit.
 *
 * **LA FILA ABSENT ÉS EL CAS NORMAL.** `scope_settings` neix buida i s'hi escriu només quan
 * algú toca alguna cosa: així la migració que la crea no encén res a ningú, i un àmbit d'ara
 * fa exactament el que feia ahir. Els valors vius són els d'aquí.
 *
 * Els defectes no són gustos:
 *
 *   - **El registre, apagat.** És una funció de nínxol —qui factura hores— i encendre-la a
 *     tothom ompliria de columnes una app que per a la majoria és una llista de coses a fer.
 *   - **De nou a sis, de dilluns a divendres.** Ha de ser alguna cosa perquè les hores extres
 *     vulguin dir res, i aquest és l'horari que la gent que ho farà servir canviarà primer.
 *   - **Vuit hores per marcar un bloc.** Més que una jornada seguida sense tocar la targeta
 *     és, gairebé sempre, una targeta oblidada a Fent.
 *   - **«Projecte».** És com es diu a tot arreu de Fem-ho; «client» és la traducció que
 *     demana qui treballa per encàrrec, i és **només** una paraula de la interfície: el camp
 *     segueix sent `project_id` a la base, a l'API i a les tools (regla 3).
 *
 * Fitxer **pur**: no toca la base. Qui el crida ja ha llegit la fila, si n'hi havia.
 */

import { isTrue } from '../db/bool.js';
import type { WorkHours } from './work-hours.js';

/** Com es diu un projecte, a la interfície i enlloc més. */
export const PROJECT_NOUNS = ['project', 'client'] as const;
export type ProjectNoun = (typeof PROJECT_NOUNS)[number];

export interface ScopeSettings {
  time_tracking: boolean;
  work_start: string;
  work_end: string;
  work_days: string;
  overtime_visible: boolean;
  long_session_hours: number;
  project_noun: ProjectNoun;
  task_types_enabled: boolean;
  task_type_required: boolean;
}

export const DEFAULT_SCOPE_SETTINGS: ScopeSettings = {
  time_tracking: false,
  work_start: '09:00',
  work_end: '18:00',
  work_days: '1111100',
  overtime_visible: true,
  long_session_hours: 8,
  project_noun: 'project',
  task_types_enabled: false,
  task_type_required: false,
};

/** El que hi ha a la base, tal com arriba: booleans 0/1 i camps que poden faltar. */
export type ScopeSettingsRow = Partial<Record<keyof ScopeSettings, unknown>>;

/** La fila, normalitzada. `null` o `undefined` volen dir «res dit»: tot per defecte. */
export function resolveScopeSettings(row: ScopeSettingsRow | null | undefined): ScopeSettings {
  if (row === null || row === undefined) return { ...DEFAULT_SCOPE_SETTINGS };

  return {
    time_tracking: isTrue(row.time_tracking),
    work_start: time(row.work_start, DEFAULT_SCOPE_SETTINGS.work_start),
    work_end: time(row.work_end, DEFAULT_SCOPE_SETTINGS.work_end),
    work_days: days(row.work_days),
    overtime_visible: isTrue(row.overtime_visible),
    long_session_hours: hours(row.long_session_hours),
    project_noun: row.project_noun === 'client' ? 'client' : 'project',
    task_types_enabled: isTrue(row.task_types_enabled),
    task_type_required: isTrue(row.task_type_required),
  };
}

/** L'horari, en la forma que espera `splitWorkTime`. */
export function workHoursOf(settings: ScopeSettings): WorkHours {
  return { start: settings.work_start, end: settings.work_end, days: settings.work_days };
}

/**
 * Valida el que arriba d'una petició. Torna els camps que es poden escriure i **prou**: el
 * que no s'entengui es queda com estava, que és menys sorprenent que desar-hi un valor
 * inventat.
 */
export function sanitizeScopeSettings(input: Record<string, unknown>): Partial<ScopeSettings> {
  const out: Partial<ScopeSettings> = {};

  for (const key of [
    'time_tracking',
    'overtime_visible',
    'task_types_enabled',
    'task_type_required',
  ] as const) {
    if (typeof input[key] === 'boolean') out[key] = input[key];
  }

  if (isTime(input.work_start)) out.work_start = input.work_start;
  if (isTime(input.work_end)) out.work_end = input.work_end;
  if (typeof input.work_days === 'string' && /^[01]{7}$/u.test(input.work_days)) {
    out.work_days = input.work_days;
  }
  if (typeof input.long_session_hours === 'number' && Number.isFinite(input.long_session_hours)) {
    out.long_session_hours = hours(input.long_session_hours);
  }
  if (input.project_noun === 'project' || input.project_noun === 'client') {
    out.project_noun = input.project_noun;
  }

  return out;
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

function time(value: unknown, fallback: string): string {
  return isTime(value) ? value : fallback;
}

function days(value: unknown): string {
  return typeof value === 'string' && /^[01]{7}$/u.test(value)
    ? value
    : DEFAULT_SCOPE_SETTINGS.work_days;
}

/**
 * Entre una hora i una setmana.
 *
 * Menys d'una hora marcaria per revisar gairebé tot, i més d'una setmana no marcaria mai
 * res: als dos extrems el llindar deixa de ser un llindar.
 */
function hours(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SCOPE_SETTINGS.long_session_hours;
  return Math.min(168, Math.max(1, n));
}
