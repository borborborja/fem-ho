/** Un resum per targeta, sense retornar el detall de sessions d’altres persones. */
import { sql } from 'kysely';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';
import { roleOf } from '../policy/scope-visibility.js';
import { canReadOthersSessions } from '../policy/session-writes.js';
import { settingsOfMany } from './scope-settings.js';
export interface TaskTimeSummary {
  seconds: number;
  segments: number;
  open_started_at: string[];
}
export async function taskTimeSummaries(
  db: MigrationDb,
  principal: Principal,
  tasks: { id: string; scope_id: string; status: string }[],
) {
  const scopes = [...new Set(tasks.map((task) => task.scope_id))];
  const settings = await settingsOfMany(db, scopes);
  const others: string[] = [];
  for (const scope of scopes)
    if (canReadOthersSessions(await roleOf(db, principal.userId, scope))) others.push(scope);
  const selected = tasks.filter(
    (task) => settings.get(task.scope_id)?.time_tracking && ['doing', 'done'].includes(task.status),
  );
  const summaries = new Map<string, TaskTimeSummary>(
    selected.map((task) => [task.id, { seconds: 0, segments: 0, open_started_at: [] }]),
  );
  for (let i = 0; i < selected.length; i += 500) {
    const rows = await sql<{ task_id: string; started_at: string; ended_at: string | null }>`
      SELECT task_id, started_at, ended_at FROM task_sessions
      WHERE deleted_at IS NULL AND task_id IN (${sql.join(selected.slice(i, i + 500).map((task) => task.id))})
        AND (user_id=${principal.userId} ${others.length ? sql`OR scope_id IN (${sql.join(others)})` : sql``})
    `.execute(db);
    for (const row of rows.rows) {
      const summary = summaries.get(row.task_id)!;
      summary.segments++;
      if (row.ended_at === null) summary.open_started_at.push(row.started_at);
      else
        summary.seconds +=
          Math.max(0, Date.parse(row.ended_at) - Date.parse(row.started_at)) / 1000;
    }
  }
  return summaries;
}
