/** Comptem tasques visibles, no sessions: treballar-hi no vol dir haver-les acabat. */
import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { missingCapability, PolicyError } from '../policy/errors.js';
import { listScopes } from './scopes.js';
import { localDateOf, localDayBounds } from '../time/local-day.js';
import type { SessionFilters } from './session-report.js';

const METRICS = ['created', 'completed', 'pending', 'overdue'] as const;
export type TaskMetric = (typeof METRICS)[number];
interface TaskReportRow {
  id: string;
  title: string;
  status: string;
  scope_id: string;
  project_id: string | null;
  project_name: string | null;
  created_at: string;
  completed_at: string | null;
  due_date: string | null;
  deadline: string | null;
}
export interface TaskReportEntry extends TaskReportRow {
  assignees: { id: string; name: string }[];
}
type Counts = Record<TaskMetric, number>;
const zero = (): Counts => ({ created: 0, completed: 0, pending: 0, overdue: 0 });
export async function taskReport(
  db: MigrationDb,
  principal: Principal,
  filters: SessionFilters & { assigneeId?: string | undefined; metric?: string | undefined },
  all = false,
) {
  if (!hasCapability(principal, 'tasks:read')) throw missingCapability('tasks:read');
  const metric = filters.metric ?? 'completed';
  if (!METRICS.includes(metric as TaskMetric))
    throw new PolicyError(
      'invalid-report-filter',
      'Invalid report filter',
      400,
      'Unknown task metric.',
    );
  const visible = (await listScopes(db, principal))
    .map((scope) => scope.id)
    .filter((id) => filters.scopeIds === undefined || filters.scopeIds.includes(id));
  const now = new Date();
  const today = localDateOf(filters.timezone, now);
  const from =
    filters.from === undefined
      ? undefined
      : localDayBounds(filters.timezone, filters.from).startUTC;
  const to =
    filters.to === undefined ? undefined : localDayBounds(filters.timezone, filters.to).endUTC;
  const inside = (date: string | null) =>
    date !== null && (from === undefined || date >= from) && (to === undefined || date < to);
  const counts = zero();
  const projects = new Map<string, Counts & { key: string; label: string }>();
  const days = new Map<string, { key: string; created: number; completed: number }>();
  const selected: TaskReportRow[] = [];
  const limit = filters.limit ?? 100;
  let after: string | undefined;
  if (visible.length > 0)
    for (;;) {
      const result = await sql<TaskReportRow>`
      SELECT t.id, t.title, t.status, t.scope_id, t.project_id, p.name AS project_name,
        t.created_at, t.completed_at, t.due_date, t.deadline
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND t.scope_id IN (${sql.join(visible)})
        ${after === undefined ? sql`` : sql`AND t.id > ${after}`}
        ${filters.projectId === undefined ? sql`` : filters.projectId === 'none' ? sql`AND t.project_id IS NULL` : sql`AND t.project_id = ${filters.projectId}`}
        ${filters.projectIds === undefined ? sql`` : sql`AND (t.project_id IN (${sql.join(filters.projectIds)}) ${filters.projectIds.includes('none') ? sql`OR t.project_id IS NULL` : sql``})`}
        ${filters.taskTypeId === undefined ? sql`` : filters.taskTypeId === 'none' ? sql`AND t.task_type_id IS NULL` : sql`AND t.task_type_id = ${filters.taskTypeId}`}
        ${filters.search === undefined || filters.search.trim() === '' ? sql`` : sql`AND LOWER(t.title) LIKE ${'%' + filters.search.trim().toLowerCase() + '%'}`}
        ${filters.assigneeId === undefined ? sql`` : sql`AND EXISTS (SELECT 1 FROM task_assignees a WHERE a.task_id = t.id AND a.user_id = ${filters.assigneeId})`}
      ORDER BY t.id LIMIT 500
    `.execute(db);
      for (const row of result.rows) {
        const matches = {
          created: inside(row.created_at),
          completed: row.status === 'done' && inside(row.completed_at),
          pending: row.status !== 'done',
          overdue: row.status !== 'done' && row.due_date !== null && row.due_date < today,
        };
        const key = row.project_id ?? 'none';
        const bucket = projects.get(key) ?? { key, label: row.project_name ?? '', ...zero() };
        for (const m of METRICS)
          if (matches[m]) {
            counts[m]++;
            bucket[m]++;
          }
        projects.set(key, bucket);
        for (const m of ['created', 'completed'] as const) {
          if (!matches[m]) continue;
          const day = localDateOf(
            filters.timezone,
            new Date(m === 'created' ? row.created_at : row.completed_at!),
          );
          const point = days.get(day) ?? { key: day, created: 0, completed: 0 };
          point[m]++;
          days.set(day, point);
        }
        if (
          matches[metric as TaskMetric] &&
          (filters.cursor === undefined || row.id > filters.cursor) &&
          (all || selected.length <= limit)
        )
          selected.push(row);
      }
      after = result.rows.at(-1)?.id;
      if (result.rows.length < 500) break;
    }
  const more = !all && selected.length > limit;
  const page = all ? selected : selected.slice(0, limit);
  const assignees = new Map<string, { id: string; name: string }[]>();
  for (let i = 0; i < page.length; i += 500) {
    const rows = await sql<{
      task_id: string;
      id: string;
      name: string;
    }>`SELECT a.task_id, u.id, u.name
      FROM task_assignees a JOIN users u ON u.id = a.user_id WHERE a.task_id IN (${sql.join(page.slice(i, i + 500).map((row) => row.id))}) ORDER BY u.name, u.id`.execute(
      db,
    );
    for (const row of rows.rows)
      assignees.set(row.task_id, [
        ...(assignees.get(row.task_id) ?? []),
        { id: row.id, name: row.name },
      ]);
  }
  const sortedDays = [...days.keys()].sort();
  const first = filters.from ?? sortedDays[0];
  const last = filters.to ?? sortedDays.at(-1);
  const evolution: { key: string; created: number; completed: number }[] = [];
  const span =
    first === undefined || last === undefined
      ? 0
      : Math.floor((Date.parse(last) - Date.parse(first)) / 86400000) + 1;
  const weekly = span > 70;
  for (let offset = 0; offset < span; offset += weekly ? 7 : 1) {
    const point = {
      key: new Date(Date.parse(first!) + offset * 86400000).toISOString().slice(0, 10),
      created: 0,
      completed: 0,
    };
    for (let d = 0; d < (weekly ? 7 : 1) && offset + d < span; d++) {
      const day = days.get(
        new Date(Date.parse(first!) + (offset + d) * 86400000).toISOString().slice(0, 10),
      );
      point.created += day?.created ?? 0;
      point.completed += day?.completed ?? 0;
    }
    evolution.push(point);
  }
  return {
    generated_at: now.toISOString(),
    timezone: filters.timezone,
    counts,
    metric,
    weekly,
    evolution,
    by_project: [...projects.values()].sort(
      (a, b) => b[metric as TaskMetric] - a[metric as TaskMetric] || a.key.localeCompare(b.key),
    ),
    data: page.map((row) => ({ ...row, assignees: assignees.get(row.id) ?? [] })),
    next_cursor: more ? (page.at(-1)?.id ?? null) : null,
  };
}
