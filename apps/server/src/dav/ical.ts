/**
 * El mapatge entre les files de Fem-ho i iCalendar (docs/07 §6 i §7).
 *
 * Dues regles que valen per a tot el fitxer:
 *
 * - **`VALUE=DATE` és tot el dia i no té fus.** Convertir un tot-el-dia a mitjanit UTC
 *   és l'error que fa que els aniversaris apareguin el dia abans a mig món (docs/07 §8).
 * - **La tasca mare va sempre abans que les filles** dins d'un mateix recurs. Les
 *   jerarquies amb `RELATED-TO` depenen de l'ordre en què el client processi els
 *   components, i és una font de bugs documentada.
 */

import ICAL from 'ical.js';
import { sql } from 'kysely';
import { isTrue } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';

export const PRODID = '-//Fem-ho//CalDAV//EN';

/** L'estat d'un VTODO i el del kanban no són el mateix (docs/07 §6). */
const STATUS_OUT: Record<string, string> = {
  inbox: 'NEEDS-ACTION',
  todo: 'NEEDS-ACTION',
  doing: 'IN-PROCESS',
  done: 'COMPLETED',
};

/**
 * `inbox` i `todo` col·lapsen tots dos a `NEEDS-ACTION` en sortir. Per no perdre la
 * distinció en un round-trip, la columna real viatja a `X-FEMHO-STATUS`; si el client
 * no la porta, `NEEDS-ACTION` cau a `todo`.
 */
export function statusIn(icalStatus: string | null, femhoStatus: string | null): string {
  if (femhoStatus !== null && ['inbox', 'todo', 'doing', 'done'].includes(femhoStatus)) {
    return femhoStatus;
  }
  switch ((icalStatus ?? '').toUpperCase()) {
    case 'IN-PROCESS':
      return 'doing';
    case 'COMPLETED':
      return 'done';
    default:
      return 'todo';
  }
}

export function statusOut(status: string): string {
  return STATUS_OUT[status] ?? 'NEEDS-ACTION';
}

/** Embolcalla components en un `VCALENDAR` amb els `VTIMEZONE` que calguin. */
export function wrap(components: ICAL.Component[], timezones: string[] = []): string {
  const calendar = new ICAL.Component('vcalendar');
  calendar.updatePropertyWithValue('prodid', PRODID);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('calscale', 'GREGORIAN');

  /**
   * **Un `VTIMEZONE` per cada `TZID` diferent** que es referenciï al recurs (docs/07
   * §8). Un VTIMEZONE absent o mal format és la primera causa d'error
   * d'interoperabilitat, i Apple hi és especialment sensible.
   */
  for (const tzid of [...new Set(timezones)]) {
    const timezone = timezoneComponent(tzid);
    if (timezone !== undefined) calendar.addSubcomponent(timezone);
  }

  for (const component of components) calendar.addSubcomponent(component);
  return calendar.toString();
}

/**
 * El `VTIMEZONE` d'un `TZID`, tret de la base de `ical.js`.
 *
 * `ICAL.TimezoneService` porta els fusos que Thunderbird distribueix. Si un `TZID` no hi
 * és, val més no emetre res que emetre una observança inventada: un `VTIMEZONE` mal
 * format és pitjor que cap.
 */
function timezoneComponent(tzid: string): ICAL.Component | undefined {
  const timezone = ICAL.TimezoneService.get(tzid);
  return timezone?.component ?? undefined;
}

interface EventRow {
  uid: string;
  recurrence_id: string | null;
  summary: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
  duration: string | null;
  all_day: number | boolean;
  timezone: string | null;
  status: string | null;
  transparency: string | null;
  classification: string | null;
  rrule: string | null;
  rdate: string | null;
  exdate: string | null;
  organizer: string | null;
  sequence: number;
  created_at: string;
  updated_at: string;
  raw_ical: string | null;
}

/**
 * Un `VEVENT` a partir de la seva fila.
 *
 * Si hi ha `raw_ical` es torna tal com va arribar: **es guarda sempre el component
 * original** (docs/07 §5), perquè un round-trip que perdi propietats que no modelem és
 * una pèrdua de dades des del punt de vista de qui les va escriure.
 */
export async function renderEvent(db: MigrationDb, eventId: string): Promise<string> {
  const found = await sql<EventRow>`SELECT * FROM events WHERE id = ${eventId}`.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw new Error(`L'esdeveniment ${eventId} no existeix.`);
  if (row.raw_ical !== null) return row.raw_ical;

  const event = new ICAL.Component('vevent');
  const allDay = row.all_day === true || row.all_day === 1;

  event.updatePropertyWithValue('uid', row.uid);
  event.updatePropertyWithValue('summary', row.summary);
  setDateTime(event, 'dtstart', row.starts_at, allDay, row.timezone);
  if (row.ends_at !== null) setDateTime(event, 'dtend', row.ends_at, allDay, row.timezone);
  if (row.duration !== null) event.updatePropertyWithValue('duration', row.duration);
  if (row.description !== null) event.updatePropertyWithValue('description', row.description);
  if (row.location !== null) event.updatePropertyWithValue('location', row.location);
  if (row.status !== null) event.updatePropertyWithValue('status', row.status);
  if (row.transparency !== null) event.updatePropertyWithValue('transp', row.transparency);
  if (row.classification !== null) event.updatePropertyWithValue('class', row.classification);
  if (row.rrule !== null) event.updatePropertyWithValue('rrule', ICAL.Recur.fromString(row.rrule));
  if (row.organizer !== null) event.updatePropertyWithValue('organizer', row.organizer);
  if (row.recurrence_id !== null) {
    setDateTime(event, 'recurrence-id', row.recurrence_id, allDay, row.timezone);
  }
  event.updatePropertyWithValue('sequence', row.sequence);
  setUtc(event, 'created', row.created_at);
  setUtc(event, 'last-modified', row.updated_at);
  setUtc(event, 'dtstamp', row.updated_at);

  return wrap([event], row.timezone === null ? [] : [row.timezone]);
}

interface TaskRow {
  id: string;
  caldav_uid: string | null;
  title: string;
  description: string | null;
  status: string;
  position: string;
  due_date: string | null;
  due_time: string | null;
  completed_at: string | null;
  ai_mode: string;
  rrule: string | null;
  recurrence_mode: string | null;
  scope_id: string;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Un `VTODO`, amb les subtasques com a fills i les propietats pròpies de docs/07 §7. */
export async function renderTodo(db: MigrationDb, taskId: string): Promise<string> {
  const found = await sql<TaskRow>`SELECT * FROM tasks WHERE id = ${taskId}`.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw new Error(`La tasca ${taskId} no existeix.`);

  const uid = row.caldav_uid ?? row.id;
  const todo = new ICAL.Component('vtodo');

  todo.updatePropertyWithValue('uid', uid);
  todo.updatePropertyWithValue('summary', row.title);
  if (row.description !== null) todo.updatePropertyWithValue('description', row.description);
  todo.updatePropertyWithValue('status', statusOut(row.status));

  if (row.due_date !== null) {
    // Sense hora és `VALUE=DATE` i **no té fus**: convertir-ho a mitjanit UTC és el que
    // desplaça la data un dia a mig món.
    const due =
      row.due_time === null
        ? ICAL.Time.fromDateString(row.due_date)
        : ICAL.Time.fromDateTimeString(`${row.due_date}T${row.due_time}`);
    todo.updatePropertyWithValue('due', due);
  }

  if (row.completed_at !== null) setUtc(todo, 'completed', row.completed_at);
  if (row.rrule !== null) todo.updatePropertyWithValue('rrule', ICAL.Recur.fromString(row.rrule));

  // `CATEGORIES` ↔ etiquetes (docs/07 §6). Les taules són `labels` i `task_labels`.
  const categories = await sql<{ name: string }>`
    SELECT l.name FROM labels l
    JOIN task_labels tl ON tl.label_id = l.id
    WHERE tl.task_id = ${row.id} AND l.deleted_at IS NULL
    ORDER BY l.name
  `.execute(db);
  if (categories.rows.length > 0) {
    todo.updatePropertyWithValue(
      'categories',
      categories.rows.map((label) => label.name).join(','),
    );
  }

  // Les propietats pròpies (docs/07 §7): el que Fem-ho té i iCalendar no sap dir.
  todo.updatePropertyWithValue('x-femho-status', row.status);
  todo.updatePropertyWithValue('x-femho-scope', row.scope_id);
  if (row.project_id !== null) todo.updatePropertyWithValue('x-femho-project', row.project_id);
  todo.updatePropertyWithValue('x-femho-position', row.position);
  todo.updatePropertyWithValue('x-femho-ai-mode', row.ai_mode);
  if (row.recurrence_mode !== null) {
    // RRULE no sap expressar "cada 3 dies des que la vaig fer" contra "cada dilluns".
    todo.updatePropertyWithValue('x-femho-recurrence-mode', row.recurrence_mode);
  }

  const checklist = await renderChecklist(db, row.id);
  if (checklist !== undefined) todo.updatePropertyWithValue('x-femho-checklist', checklist);

  setUtc(todo, 'created', row.created_at);
  setUtc(todo, 'last-modified', row.updated_at);
  setUtc(todo, 'dtstamp', row.updated_at);

  const subtasks = await renderSubtasks(db, row.id, uid);

  // La mare PRIMER, les filles després. Sempre.
  return wrap([todo, ...subtasks]);
}

async function renderSubtasks(
  db: MigrationDb,
  taskId: string,
  parentUid: string,
): Promise<ICAL.Component[]> {
  const found = await sql<{
    id: string;
    title: string;
    done: number | boolean;
    position: string;
    created_at: string;
    updated_at: string;
  }>`
    SELECT id, title, done, position, created_at, updated_at
    FROM subtasks WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY position, id
  `.execute(db);

  return found.rows.map((row) => {
    const child = new ICAL.Component('vtodo');
    // `subtasks` guarda si està feta, no quan. El `COMPLETED` d'iCalendar surt de
    // l'últim canvi, que és el més fidel que es pot dir sense inventar-se una data.
    const done = isTrue(row.done);
    child.updatePropertyWithValue('uid', row.id);
    child.updatePropertyWithValue('summary', row.title);
    child.updatePropertyWithValue('status', done ? 'COMPLETED' : 'NEEDS-ACTION');
    if (done) setUtc(child, 'completed', row.updated_at);

    const related = child.updatePropertyWithValue('related-to', parentUid);
    related.setParameter('reltype', 'PARENT');

    child.updatePropertyWithValue('x-femho-position', row.position);
    setUtc(child, 'created', row.created_at);
    setUtc(child, 'last-modified', row.updated_at);
    setUtc(child, 'dtstamp', row.updated_at);
    return child;
  });
}

/**
 * La llista senzilla, serialitzada.
 *
 * Les llistes tenen dues representacions possibles i **es fan servir les dues** (docs/07
 * §7): fills amb `RELATED-TO` per als clients que els sàpiguen ensenyar, i aquesta
 * propietat per poder-les reconstruir exactament. En importar, mana la propietat.
 */
async function renderChecklist(db: MigrationDb, taskId: string): Promise<string | undefined> {
  const lists = await sql<{ id: string; name: string }>`
    SELECT id, name FROM checklists
    WHERE task_id = ${taskId} AND deleted_at IS NULL
    ORDER BY position, id
  `.execute(db);

  if (lists.rows.length === 0) return undefined;

  const items = await sql<{ checklist_id: string; text: string; done: number | boolean }>`
    SELECT checklist_id, text, done FROM checklist_items
    WHERE checklist_id IN (${sql.join(lists.rows.map((list) => sql`${list.id}`))})
      AND deleted_at IS NULL
    ORDER BY position, id
  `.execute(db);

  /**
   * L'agregació a JSON es fa aquí i no a la consulta: SQLite té `json_group_array` i
   * Postgres `json_agg`, i escriure-ho amb la d'un motor funcionaria a un i fallaria a
   * l'altre sense avisar fins que algú provés la instància de Postgres (D11).
   */
  return JSON.stringify(
    lists.rows.map((list) => ({
      title: list.name,
      items: items.rows
        .filter((item) => item.checklist_id === list.id)
        .map((item) => ({ text: item.text, done: isTrue(item.done) })),
    })),
  );
}

function setDateTime(
  component: ICAL.Component,
  name: string,
  iso: string,
  allDay: boolean,
  tzid: string | null,
): void {
  if (allDay) {
    // Tot el dia: `VALUE=DATE`, sense hora i sense fus.
    const property = component.updatePropertyWithValue(
      name,
      ICAL.Time.fromDateString(iso.slice(0, 10)),
    );
    property.setParameter('value', 'DATE');
    return;
  }

  const time = ICAL.Time.fromJSDate(new Date(iso), true);
  const property = component.updatePropertyWithValue(name, time);
  if (tzid !== null) property.setParameter('tzid', tzid);
}

function setUtc(component: ICAL.Component, name: string, iso: string): void {
  component.updatePropertyWithValue(name, ICAL.Time.fromJSDate(new Date(iso), true));
}
