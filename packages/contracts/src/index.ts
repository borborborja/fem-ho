/**
 * @fem-ho/contracts — el que web, servidor i Android han de compartir per força.
 *
 * Regla 5 d'instruccions.md: openapi.yaml és la font de veritat i els tipus es
 * generen des d'ell. Res d'aquí s'escriu a mà dues vegades.
 *
 * Aquí hi acabarà vivint, a mesura que arribin les seves fites:
 *   - els tipus generats d'OpenAPI (`./generated/api`)
 *   - l'índex fraccional amb jitter i els seus fixtures (M4, D3)
 *   - els fixtures del parser d'afegida ràpida (M6), compartits amb Kotlin
 *   - el catàleg català, que exporta cap a strings.xml (M13)
 */

export type { paths, components, operations } from './generated/api.js';

export {
  ALPHABET,
  InvalidPositionError,
  comparePositions,
  generatePosition,
  generatePositions,
  midpoint,
} from './position.js';
export type { RandomSource } from './position.js';

export { MESSAGES, messageKeys, t } from './i18n.js';
export type { MessageKey, TranslateOptions } from './i18n.js';

/** Els valors canònics de `status`. `column` no existeix (D2). */
export const TASK_STATUSES = ['inbox', 'todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Els tres modes d'IA. Delegar no és assignar (D5). */
export const AI_MODES = ['manual', 'assisted', 'delegated'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** El canal pel qual ha entrat una escriptura. Va a activity_log.source (regla 4). */
export const SOURCES = ['web', 'android', 'api', 'mcp', 'caldav', 'share', 'system'] as const;
export type Source = (typeof SOURCES)[number];
