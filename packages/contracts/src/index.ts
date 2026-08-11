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

export {
  FALLBACK,
  LOCALES,
  MESSAGES,
  catalogOf,
  getLocale,
  isLocale,
  messageKeys,
  negotiate,
  setLocale,
  t,
} from './i18n.js';
export {
  WEEK_START_CHOICES,
  dateTime,
  longDay,
  monthName,
  resolveWeekStart,
  shortTime,
  startOfWeek,
  weekIndex,
  weekStart,
  weekdayNames,
} from './dates.js';
export type { WeekStart, WeekStartChoice } from './dates.js';
export { parseQuickAdd, revertToken } from './quickadd.js';
export type {
  QuickAddContext,
  QuickAddErrorCode,
  QuickAddPerson,
  QuickAddResult,
  QuickAddScope,
  QuickAddToken,
} from './quickadd.js';
export type { Locale, MessageKey, TranslateOptions } from './i18n.js';
export {
  DEFAULT_MAIL_TEMPLATE,
  MAIL_TEMPLATE_VARS,
  MAIL_TITLE_MAX,
  renderMailTitle,
  unknownMailVars,
} from './mailtemplate.js';
export type { MailTemplateVars } from './mailtemplate.js';

/** Els valors canònics de `status`. `column` no existeix (D2). */
export const TASK_STATUSES = ['inbox', 'todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Els tres modes d'IA. Delegar no és assignar (D5). */
export const AI_MODES = ['manual', 'assisted', 'delegated'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** El canal pel qual ha entrat una escriptura. Va a activity_log.source (regla 4). */
export const SOURCES = ['web', 'android', 'api', 'mcp', 'caldav', 'share', 'system'] as const;
export type Source = (typeof SOURCES)[number];

/**
 * De quina mena de font ve una cosa.
 *
 * **No és el mateix que `SOURCES`**, i val la pena no confondre-ho mai: aquell diu *per
 * quin canal ha entrat una escriptura* —web, Android, MCP— i aquest diu *d'on ve el
 * contingut*. Un correu ingerit pel planificador entra per `system` i ve de `mail`.
 *
 * **Un sol vocabulari, i és el que fa que això escali.** `calendars.source_kind` ja fa
 * servir els tres primers valors des de la migració 006. La provinença d'una tasca
 * viu en columnes específiques de cada mena —`event_calendar_id`, `event_uid`…— i
 * afegir-ne una quarta en sumaria tres més, i una cinquena tres més. Amb un valor
 * canònic, la pregunta que fa la icona —«d'on ve això?»— té **una sola resposta**, i
 * afegir Slack o Telegram serà un valor més aquí, una icona més, i una ingesta més:
 * mai una columna més a `tasks`.
 */
export const SOURCE_KINDS = ['caldav', 'ical', 'rss', 'mail'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isSourceKind(value: unknown): value is SourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}
