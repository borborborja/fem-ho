/**
 * Les rutes dels adjunts.
 *
 * El navegador envia els bytes crus. Una integració també pot donar una URL de descàrrega
 * quan adjunta un fitxer a una tasca. Cada petició correspon a un sol fitxer.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError } from '../policy/errors.js';
import {
  deliverTaskAttachment,
  deleteAttachment,
  listAttachments,
  readAttachment,
  type TaskAttachmentInput,
  uploadAttachment,
} from '../services/attachments.js';
import { principalOf } from './auth.js';
import { handle, query, str } from './handle.js';

const DownloadInput = z.strictObject({
  id: z.string(),
  filename: z.string().min(1),
  url: z.string(),
  ai_context: z.boolean().optional(),
});

function taskAttachmentInput(
  request: FastifyRequest<{ Params: { id: string } }>,
): TaskAttachmentInput {
  const taskId = request.params.id;
  if (request.body === undefined || request.body instanceof Buffer) {
    const options = query(request);
    if (options.id !== undefined && typeof options.id !== 'string')
      throw new PolicyError(
        'invalid-attachment-id',
        'Invalid attachment identifier',
        422,
        'Use a single UUID for the attachment identifier.',
      );
    return {
      taskId,
      id: str(options.id),
      filename: str(options.filename) ?? 'fitxer',
      isAiContext: str(options.ai_context) === 'true',
      data: request.body ?? Buffer.alloc(0),
    };
  }
  const parsed = DownloadInput.safeParse(request.body);
  if (!parsed.success) {
    throw new PolicyError(
      'invalid-attachment-download',
      'Invalid attachment download',
      422,
      'Send an attachment id, filename and public HTTPS download URL.',
    );
  }
  const { id, filename, url, ai_context } = parsed.data;
  return { taskId, id, filename, url, isAiContext: ai_context };
}

export function registerAttachmentRoutes(app: FastifyInstance): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  /**
   * El cos cru.
   *
   * Fastify no en té cap analitzador per defecte i respondria 415. El límit de mida el
   * posa `bodyLimit` a la construcció de l'app; aquí el servei el torna a comprovar
   * perquè el sync i el MCP no passen per aquesta porta.
   */
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  for (const [kind, param] of [
    ['tasks', 'taskId'],
    ['events', 'eventId'],
  ] as const) {
    app.get<{ Params: { id: string } }>(`/api/v1/${kind}/:id/attachments`, async (request, reply) =>
      handle(app, request, reply, async (principal) =>
        listAttachments(db().db, principal, { [param]: request.params.id }),
      ),
    );
  }

  app.post<{ Params: { id: string } }>('/api/v1/tasks/:id/attachments', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const result = await deliverTaskAttachment(db(), principal, taskAttachmentInput(request), {
        dataDir: app.config.dataDir,
        maxUploadBytes: app.config.maxUploadBytes,
        reauthorize: () => principalOf(app, request),
      });
      void reply.code(result.created ? 201 : 200);
      return result.attachment;
    }),
  );

  app.post<{ Params: { id: string } }>('/api/v1/events/:id/attachments', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const data = request.body instanceof Buffer ? request.body : Buffer.alloc(0);
      const row = await auditedTransaction(db().db, principal, (ctx) =>
        uploadAttachment(
          ctx,
          principal,
          {
            eventId: request.params.id,
            filename: str(query(request).filename) ?? 'fitxer',
            data,
            isAiContext: str(query(request).ai_context) === 'true',
          },
          app.config.dataDir,
          app.config.maxUploadBytes,
        ),
      );
      void reply.code(201);
      return row;
    }),
  );

  /**
   * El contingut.
   *
   * `docs/10` §8, i cap d'aquestes capçaleres és decorativa: `attachment` perquè el
   * navegador el baixi en comptes d'obrir-lo, `nosniff` perquè no endevini el tipus, i
   * `private, no-store` perquè un proxy compartit no en guardi còpia.
   */
  app.get<{ Params: { id: string } }>('/api/v1/attachments/:id/content', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { row, data } = await readAttachment(
        db().db,
        principal,
        request.params.id,
        app.config.dataDir,
      );

      void reply
        .code(200)
        .header('content-type', row.mime_type)
        .header('content-length', String(row.size_bytes))
        // El nom en RFC 5987: els accents i els espais no sobreviuen a la forma curta.
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        )
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .send(data);
      return undefined;
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/attachments/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteAttachment(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );
}
