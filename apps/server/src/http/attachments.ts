/**
 * Les rutes dels adjunts.
 *
 * **El cos va cru, no en multipart.** Un `POST` amb `application/octet-stream`, el nom a
 * la consulta i els bytes al cos. Dues raons: el navegador pot enviar un `File` tal qual
 * sense muntar cap `FormData`, i evita una dependència nova —que en aquest projecte costa
 * paperassa de procedència (`no-pinned-from-research`)— per analitzar un format que aquí
 * no aporta res: només hi ha un fitxer per petició.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import {
  deleteAttachment,
  listAttachments,
  readAttachment,
  uploadAttachment,
} from '../services/attachments.js';
import { handle, query, str } from './handle.js';

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

    app.post<{ Params: { id: string } }>(
      `/api/v1/${kind}/:id/attachments`,
      async (request, reply) =>
        handle(app, request, reply, async (principal) => {
          const data = request.body instanceof Buffer ? request.body : Buffer.alloc(0);
          const row = await auditedTransaction(db().db, principal, (ctx) =>
            uploadAttachment(
              ctx,
              principal,
              {
                [param]: request.params.id,
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
  }

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
