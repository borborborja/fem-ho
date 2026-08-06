/**
 * L'iCalendar que arriba, cap a les files de Fem-ho (docs/07 §6).
 *
 * Aquest fitxer **no escriu res**: només tradueix. El que decideix què es guarda és
 * `write.ts`, i tenir-ho separat vol dir que el mapatge es pot provar amb fitxers reals
 * de DAVx⁵ o d'Apple sense muntar una base de dades.
 */

import ICAL from 'ical.js';
import { statusIn } from './ical.js';

export class IcalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IcalError';
  }
}

export interface ParsedTodo {
  uid: string;
  summary: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  completedAt: string | null;
  rrule: string | null;
  categories: string[];
  /** El `UID` de la mare si aquest component en té (`RELATED-TO;RELTYPE=PARENT`). */
  parentUid: string | null;
  /** Les propietats pròpies de docs/07 §7 que hem sabut llegir. */
  femho: {
    status: string | null;
    scope: string | null;
    project: string | null;
    position: string | null;
    aiMode: string | null;
    recurrenceMode: string | null;
    checklist: ChecklistData[] | null;
  };
}

export interface ChecklistData {
  title: string;
  items: { text: string; done: boolean }[];
}

export interface ParsedEvent {
  uid: string;
  recurrenceId: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  timezone: string | null;
  status: string | null;
  rrule: string | null;
  sequence: number;
}

export interface ParsedResource {
  /** Els components de la mateixa mena que porta el recurs. */
  todos: ParsedTodo[];
  events: ParsedEvent[];
  /** El component que hi ha de debò, per comprovar-lo contra el tipus de la col·lecció. */
  componentName: 'VEVENT' | 'VTODO' | undefined;
}

/**
 * Parseja un recurs sencer.
 *
 * **Es tolera l'ordre invers** entre mare i filles (docs/07 §6): les jerarquies amb
 * `RELATED-TO` depenen de l'ordre en què el client processi els components, i hi ha
 * implementacions que les escriuen al revés. Fem-ho les exporta sempre amb la mare
 * primer, però no exigeix rebre-les així.
 */
export function parseResource(ical: string): ParsedResource {
  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(ICAL.parse(ical));
  } catch (error) {
    throw new IcalError(`L'iCalendar no es pot llegir: ${String(error)}`);
  }

  const vtodos = calendar.getAllSubcomponents('vtodo');
  const vevents = calendar.getAllSubcomponents('vevent');

  if (vtodos.length === 0 && vevents.length === 0) {
    throw new IcalError('El recurs no porta cap VEVENT ni cap VTODO.');
  }
  if (vtodos.length > 0 && vevents.length > 0) {
    // RFC 4791 §5.2: un recurs no pot barrejar components. Acceptar-ho seria crear
    // exactament el recurs mixt que la col·lecció està dissenyada per evitar.
    throw new IcalError('Un recurs no pot barrejar VEVENT i VTODO.');
  }

  return {
    todos: vtodos.map(toTodo),
    events: vevents.map(toEvent),
    componentName: vtodos.length > 0 ? 'VTODO' : vevents.length > 0 ? 'VEVENT' : undefined,
  };
}

function toTodo(component: ICAL.Component): ParsedTodo {
  const uid = text(component, 'uid');
  if (uid === null) throw new IcalError('Un VTODO sense UID no es pot guardar.');

  const due = component.getFirstProperty('due');
  const dueValue = due === null ? null : (due.getFirstValue() as ICAL.Time);

  const femhoStatus = text(component, 'x-femho-status');

  return {
    uid,
    summary: text(component, 'summary') ?? '(untitled)',
    description: text(component, 'description'),
    status: statusIn(text(component, 'status'), femhoStatus),
    // `VALUE=DATE` és tot el dia i **no té fus**: es guarda la data nua i prou.
    dueDate: dueValue === null ? null : isoDate(dueValue),
    dueTime: dueValue === null || dueValue.isDate ? null : isoTime(dueValue),
    completedAt: instant(component, 'completed'),
    rrule: text(component, 'rrule'),
    categories: (text(component, 'categories') ?? '')
      .split(',')
      .map((category) => category.trim())
      .filter((category) => category !== ''),
    parentUid: parentOf(component),
    femho: {
      status: femhoStatus,
      scope: text(component, 'x-femho-scope'),
      project: text(component, 'x-femho-project'),
      position: text(component, 'x-femho-position'),
      aiMode: text(component, 'x-femho-ai-mode'),
      recurrenceMode: text(component, 'x-femho-recurrence-mode'),
      checklist: parseChecklist(text(component, 'x-femho-checklist')),
    },
  };
}

/**
 * `RELATED-TO;RELTYPE=PARENT`.
 *
 * Sense el paràmetre, `RELATED-TO` per defecte **és** PARENT (RFC 5545 §3.2.15), i hi
 * ha clients que no l'escriuen. Un `RELTYPE=CHILD` o `SIBLING` no és una mare.
 */
function parentOf(component: ICAL.Component): string | null {
  for (const property of component.getAllProperties('related-to')) {
    const reltype = (property.getParameter('reltype') as string | undefined) ?? 'PARENT';
    if (reltype.toUpperCase() === 'PARENT') return String(property.getFirstValue());
  }
  return null;
}

/**
 * La llista senzilla de `X-FEMHO-CHECKLIST`.
 *
 * Si la propietat hi és, **mana ella** per damunt dels VTODO fills (docs/07 §7): és la
 * que permet reconstruir la llista exactament, i els fills només hi són per als clients
 * que els sàpiguen ensenyar.
 */
function parseChecklist(raw: string | null): ChecklistData[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((list): list is ChecklistData => typeof (list as ChecklistData).title === 'string')
      .map((list) => ({
        title: list.title,
        items: Array.isArray(list.items)
          ? list.items.map((item) => ({ text: String(item.text), done: item.done === true }))
          : [],
      }));
  } catch {
    // Una propietat pròpia mal formada no ha de fer fallar el PUT sencer: es perd la
    // llista, però la tasca es guarda.
    return null;
  }
}

function toEvent(component: ICAL.Component): ParsedEvent {
  const uid = text(component, 'uid');
  if (uid === null) throw new IcalError('Un VEVENT sense UID no es pot guardar.');

  const dtstart = component.getFirstProperty('dtstart');
  if (dtstart === null) throw new IcalError('Un VEVENT sense DTSTART no es pot guardar.');

  const start = dtstart.getFirstValue() as ICAL.Time;
  const dtend = component.getFirstProperty('dtend');
  const end = dtend === null ? null : (dtend.getFirstValue() as ICAL.Time);
  const recurrenceId = component.getFirstProperty('recurrence-id');

  return {
    uid,
    recurrenceId: recurrenceId === null ? null : toIso(recurrenceId.getFirstValue() as ICAL.Time),
    summary: text(component, 'summary') ?? '(untitled)',
    description: text(component, 'description'),
    location: text(component, 'location'),
    startsAt: toIso(start),
    endsAt: end === null ? null : toIso(end),
    allDay: start.isDate,
    timezone: (dtstart.getParameter('tzid') as string | undefined) ?? null,
    status: text(component, 'status'),
    rrule: text(component, 'rrule'),
    sequence: Number(text(component, 'sequence') ?? '0'),
  };
}

function text(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : String(value);
}

function instant(component: ICAL.Component, name: string): string | null {
  const property = component.getFirstProperty(name);
  if (property === null) return null;
  return toIso(property.getFirstValue() as ICAL.Time);
}

/**
 * Un `ICAL.Time` a instant ISO.
 *
 * Un tot-el-dia es fixa a mitjanit **UTC** només aquí, on ja se sap que la fila que el
 * rebrà porta `all_day = true` al costat i per tant ningú el llegirà com una hora. El
 * que no es fa mai és convertir-lo com si fos hora local d'un fus (docs/07 §8).
 */
function toIso(time: ICAL.Time): string {
  if (time.isDate) return `${isoDate(time)}T00:00:00.000Z`;
  return time.toJSDate().toISOString();
}

function isoDate(time: ICAL.Time): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(time.year)}-${pad(time.month)}-${pad(time.day)}`;
}

function isoTime(time: ICAL.Time): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}
