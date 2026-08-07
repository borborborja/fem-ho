/**
 * Rutes d'àmbits, membres, projectes i etiquetes. docs/05 §4.
 *
 * Vivien barrejades amb les de tasques mentre eren quatre. Amb `/scopes/{id}/members` i
 * `/labels` pel mig, tenir `/scopes` en un fitxer i `/scopes/{id}` en un altre seria la
 * mena de repartiment que fa que un dia s'afegeixi una comprovació a una banda i no a
 * l'altra.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { SCOPE_ROLES } from '../policy/scope-roles.js';
import { createLabel, deleteLabel, listLabels } from '../services/labels.js';
import {
  addMember,
  createProject,
  createScope,
  deleteProject,
  deleteScope,
  getProject,
  getScope,
  leaveScope,
  listMembers,
  listProjects,
  listScopes,
  removeMember,
  updateMember,
  updateProject,
  updateScope,
  type MemberRow,
} from '../services/scopes.js';
import { body, handle, nullable, query, str } from './handle.js';

const ROLES: MemberRow['role'][] = [...SCOPE_ROLES];

function parseRole(value: unknown): MemberRow['role'] | undefined {
  return typeof value === 'string' && (ROLES as string[]).includes(value)
    ? (value as MemberRow['role'])
    : undefined;
}

export function registerScopeRoutes(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get('/api/v1/scopes', async (request, reply) =>
    handle(app, request, reply, async (principal) => listScopes(db().db, principal)),
  );

  app.post('/api/v1/scopes', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createScope(ctx, principal, {
          id: str(input.id),
          name: String(input.name ?? ''),
          kind: input.kind === 'collective' ? 'collective' : 'individual',
          color: String(input.color ?? ''),
          icon: str(input.icon),
          ai_instructions: str(input.ai_instructions),
          ai_description: str(input.ai_description),
          position: str(input.position),
        }),
      );
      // 201 si s'ha creat, 200 si ja existia: idempotència amb identificadors de client.
      void reply.code(result.created ? 201 : 200);
      return result.entity;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/scopes/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      getScope(db().db, principal, request.params.id),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/scopes/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateScope(ctx, principal, request.params.id, {
          name: str(input.name),
          color: str(input.color),
          icon: nullable(input, 'icon'),
          ai_instructions: nullable(input, 'ai_instructions'),
          ai_description: nullable(input, 'ai_description'),
          position: str(input.position),
          // Qualsevol altre valor cau a `undefined` i el servei el deixa com està: un
          // `kind` inventat no ha de canviar res en silenci.
          kind: input.kind === 'individual' || input.kind === 'collective' ? input.kind : undefined,
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/scopes/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteScope(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  // ------------------------------------------------------------------ membres

  app.get<{ Params: { id: string } }>('/api/v1/scopes/:id/members', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listMembers(db().db, principal, request.params.id),
    ),
  );

  app.post<{ Params: { id: string } }>('/api/v1/scopes/:id/members', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const member = await auditedTransaction(db().db, principal, (ctx) =>
        addMember(ctx, principal, request.params.id, {
          user_id: str(input.user_id),
          external_calendar_id: str(input.external_calendar_id),
          role: parseRole(input.role),
        }),
      );
      void reply.code(201);
      return member;
    }),
  );

  app.patch<{ Params: { id: string; memberId: string } }>(
    '/api/v1/scopes/:id/members/:memberId',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        const role = parseRole(body(request).role);
        if (role === undefined) {
          void reply
            .code(422)
            .type('application/problem+json')
            .send({
              type: 'https://femho.app/errors/invalid-value',
              title: 'Invalid value',
              status: 422,
              detail: `El rol ha de ser un de: ${ROLES.join(', ')}.`,
            });
          return undefined;
        }
        return auditedTransaction(db().db, principal, (ctx) =>
          updateMember(ctx, principal, request.params.id, request.params.memberId, role),
        );
      }),
  );

  app.delete<{ Params: { id: string; memberId: string } }>(
    '/api/v1/scopes/:id/members/:memberId',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        await auditedTransaction(db().db, principal, (ctx) =>
          removeMember(ctx, principal, request.params.id, request.params.memberId),
        );
        void reply.code(204).send();
        return undefined;
      }),
  );

  /**
   * Sortir d'un àmbit un mateix.
   *
   * `/members/me` i no `/members/:memberId` amb detecció: el permís és un altre, i una
   * ruta que vol dir dues coses és on la comprovació s'acaba confonent.
   *
   * L'encaminador de Fastify prefereix un segment literal per damunt d'un paràmetre
   * sigui quin sigui l'ordre de registre, o sigui que `me` no cau mai a `:memberId`.
   * Hi ha una prova que ho fixa, perquè és el tipus de cosa que es dona per sabuda.
   */
  app.delete<{ Params: { id: string } }>('/api/v1/scopes/:id/members/me', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        leaveScope(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  // ---------------------------------------------------------------- projectes

  app.get('/api/v1/projects', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listProjects(db().db, principal, str(query(request).scope_id)),
    ),
  );

  app.post('/api/v1/projects', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createProject(ctx, principal, {
          id: str(input.id),
          scope_id: String(input.scope_id ?? ''),
          name: String(input.name ?? ''),
          ai_instructions: str(input.ai_instructions),
          ai_description: str(input.ai_description),
          position: str(input.position),
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.entity;
    }),
  );

  app.get<{ Params: { id: string } }>('/api/v1/projects/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      getProject(db().db, principal, request.params.id),
    ),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/projects/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateProject(ctx, principal, request.params.id, {
          name: str(input.name),
          ai_instructions: nullable(input, 'ai_instructions'),
          ai_description: nullable(input, 'ai_description'),
          position: str(input.position),
          archived: typeof input.archived === 'boolean' ? input.archived : undefined,
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/projects/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      auditedTransaction(db().db, principal, (ctx) =>
        deleteProject(ctx, principal, request.params.id),
      ),
    ),
  );

  // ---------------------------------------------------------------- etiquetes

  app.get('/api/v1/labels', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      listLabels(db().db, principal, str(query(request).scope_id)),
    ),
  );

  app.post('/api/v1/labels', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createLabel(ctx, principal, {
          id: str(input.id),
          scope_id: str(input.scope_id),
          name: str(input.name),
          color: str(input.color),
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.label;
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/labels/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteLabel(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );
}
