/** Validació compartida: una exportació no pot interpretar el rang d'una altra manera. */
import { PolicyError } from '../policy/errors.js';
import { ids, str, num } from './handle.js';
export function reportFilters(q: Record<string, unknown>) {
  const fail = () => {
    throw new PolicyError(
      'invalid-report-filter',
      'Invalid report filter',
      400,
      'Check dates, project filters and page size.',
    );
  };
  const from = str(q.from),
    to = str(q.to);
  for (const value of [from, to]) {
    if (
      value !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      fail();
  }
  if (from !== undefined && to !== undefined && from > to) fail();
  if (q.project_id !== undefined && q.project_ids !== undefined) fail();
  const limit = num(q.limit);
  if (
    q.limit !== undefined &&
    (limit === undefined || !Number.isInteger(limit) || limit < 1 || limit > 500)
  )
    fail();
  return {
    from,
    to,
    scopeIds: ids(q.scope_ids),
    projectId: str(q.project_id),
    projectIds: ids(q.project_ids),
    userId: str(q.user_id),
    taskTypeId: str(q.task_type_id),
    search: str(q.search),
    limit,
    cursor: str(q.cursor),
  };
}
