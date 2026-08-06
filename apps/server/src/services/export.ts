/**
 * Exportació de les dades pròpies. docs/05 §4, docs/10 §9.
 *
 * **No demana permís a ningú.** Són les seves dades: `GET /export` no comprova cap
 * capacitat més enllà de tenir sessió, i això és deliberat. Un producte autoallotjat on
 * has de demanar permís per endur-te el que has escrit no és autoallotjat.
 *
 * El que surt és el que qui pregunta pot veure: els seus àmbits i els col·lectius on és
 * membre. No hi ha manera d'exportar l'àmbit d'algú altre.
 *
 * **Les entitats esborrades no s'exporten.** Una exportació és el que l'usuari té, no el
 * que va tenir: incloure-hi les lloses faria que el fitxer delatés coses que algú va
 * decidir treure, i que una importació les ressuscités com a files esborrades.
 */

import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';
import { listScopes } from './scopes.js';

export interface ExportBundle {
  format: 'fem-ho/export';
  version: 1;
  exported_at: string;
  user: { id: string; name: string; email: string | null };
  scopes: unknown[];
  projects: unknown[];
  tasks: unknown[];
  subtasks: unknown[];
  checklists: unknown[];
  checklist_items: unknown[];
  labels: unknown[];
  task_labels: unknown[];
  task_assignees: unknown[];
  calendars: unknown[];
  events: unknown[];
  comments: unknown[];
  activity: unknown[];
}

export async function exportAll(
  db: MigrationDb,
  principal: Principal,
  now: string,
): Promise<ExportBundle> {
  const scopes = await listScopes(db, principal);

  const user = await sql<{ id: string; name: string; email: string | null }>`
    SELECT id, name, email FROM users WHERE id = ${principal.userId}
  `.execute(db);

  const bundle: ExportBundle = {
    format: 'fem-ho/export',
    version: 1,
    exported_at: now,
    user: user.rows[0] ?? { id: principal.userId, name: '', email: null },
    scopes,
    projects: [],
    tasks: [],
    subtasks: [],
    checklists: [],
    checklist_items: [],
    labels: [],
    task_labels: [],
    task_assignees: [],
    calendars: [],
    events: [],
    comments: [],
    activity: [],
  };

  const scopeIds = scopes.map((s) => s.id);
  if (scopeIds.length === 0) return bundle;

  const projects = await sql`
    SELECT * FROM projects WHERE deleted_at IS NULL AND scope_id IN (${sql.join(scopeIds)})
  `.execute(db);
  const tasks = await sql<{ id: string }>`
    SELECT * FROM tasks WHERE deleted_at IS NULL AND scope_id IN (${sql.join(scopeIds)})
  `.execute(db);
  const labels = await sql`
    SELECT * FROM labels WHERE deleted_at IS NULL AND scope_id IN (${sql.join(scopeIds)})
  `.execute(db);
  const calendars = await sql<{ id: string }>`
    SELECT * FROM calendars WHERE deleted_at IS NULL AND scope_id IN (${sql.join(scopeIds)})
  `.execute(db);
  const activity = await sql`
    SELECT * FROM activity_log WHERE scope_id IN (${sql.join(scopeIds)})
    ORDER BY created_at, id
  `.execute(db);

  bundle.projects = projects.rows;
  bundle.tasks = tasks.rows;
  bundle.labels = labels.rows;
  bundle.calendars = calendars.rows;
  bundle.activity = activity.rows;

  const taskIds = tasks.rows.map((r) => r.id);
  if (taskIds.length > 0) {
    const subtasks = await sql`
      SELECT * FROM subtasks WHERE deleted_at IS NULL AND task_id IN (${sql.join(taskIds)})
    `.execute(db);
    const checklists = await sql<{ id: string }>`
      SELECT * FROM checklists WHERE deleted_at IS NULL AND task_id IN (${sql.join(taskIds)})
    `.execute(db);
    const taskLabels = await sql`
      SELECT * FROM task_labels WHERE task_id IN (${sql.join(taskIds)})
    `.execute(db);
    const assignees = await sql`
      SELECT * FROM task_assignees WHERE task_id IN (${sql.join(taskIds)})
    `.execute(db);
    const comments = await sql`
      SELECT * FROM comments WHERE deleted_at IS NULL AND task_id IN (${sql.join(taskIds)})
    `.execute(db);

    bundle.subtasks = subtasks.rows;
    bundle.checklists = checklists.rows;
    bundle.task_labels = taskLabels.rows;
    bundle.task_assignees = assignees.rows;
    bundle.comments = comments.rows;

    const checklistIds = checklists.rows.map((r) => r.id);
    if (checklistIds.length > 0) {
      const items = await sql`
        SELECT * FROM checklist_items
        WHERE deleted_at IS NULL AND checklist_id IN (${sql.join(checklistIds)})
      `.execute(db);
      bundle.checklist_items = items.rows;
    }
  }

  const calendarIds = calendars.rows.map((r) => r.id);
  if (calendarIds.length > 0) {
    const events = await sql`
      SELECT * FROM events WHERE deleted_at IS NULL AND calendar_id IN (${sql.join(calendarIds)})
    `.execute(db);
    bundle.events = events.rows;
  }

  return bundle;
}
