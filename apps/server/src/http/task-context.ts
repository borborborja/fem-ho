import type { FastifyInstance } from 'fastify';
import { getTaskContext } from '../services/task-context.js';
import { handle, query, str } from './handle.js';

export function registerTaskContextRoutes(app: FastifyInstance): void {
  app.get('/api/v1/task-context', async (request, reply) =>
    handle(app, request, reply, (principal) => {
      reply.header('Cache-Control', 'private, no-store');
      return getTaskContext(app.connection!.db, principal, str(query(request).scope_id));
    }),
  );
}
