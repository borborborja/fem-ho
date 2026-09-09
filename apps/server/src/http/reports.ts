import type { FastifyInstance } from 'fastify';
import { taskReport } from '../services/task-report.js';
import { getProfile } from '../services/users.js';
import { handle, query, str } from './handle.js';
import { reportFilters } from './report-filters.js';
import { escapeCsv } from './sessions.js';
export function registerReportRoutes(app: FastifyInstance): void {
  app.get('/api/v1/reports/tasks', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      const profile = await getProfile(app.connection!.db, principal.userId);
      return taskReport(app.connection!.db, principal, {
        ...reportFilters(q),
        timezone: profile.timezone,
        assigneeId: str(q.assignee_id),
        metric: str(q.metric),
      });
    }),
  );
  app.get('/api/v1/reports/tasks/export.csv', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      const profile = await getProfile(app.connection!.db, principal.userId);
      const report = await taskReport(
        app.connection!.db,
        principal,
        {
          ...reportFilters(q),
          cursor: undefined,
          timezone: profile.timezone,
          assigneeId: str(q.assignee_id),
          metric: str(q.metric),
        },
        true,
      );
      const rows = [
        [
          'ID',
          'Tasca',
          'Estat',
          'Projecte',
          'Persones',
          'Creada',
          'Completada',
          'Data prevista',
          'Deadline',
        ],
        ...report.data.map((row) => [
          row.id,
          row.title,
          row.status,
          row.project_name ?? '',
          row.assignees.map((person) => person.name).join('; '),
          row.created_at,
          row.completed_at ?? '',
          row.due_date ?? '',
          row.deadline ?? '',
        ]),
      ];
      void reply
        .type('text/csv; charset=utf-8')
        .header('content-disposition', 'attachment; filename="tasques.csv"')
        .send('\uFEFF' + rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n') + '\r\n');
    }),
  );
}
