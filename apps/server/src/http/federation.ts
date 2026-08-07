/**
 * Les rutes de la federació.
 *
 * Dues cares: el **manifest** i el **bescanvi**, que són les úniques que una altra
 * instància toca sense sessió, i la gestió d'enllaços, que és de l'usuari d'aquesta casa
 * i va per la porta de sempre.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { PolicyError } from '../policy/errors.js';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import { invalidGrant } from '../services/grants.js';
import {
  federationGrantIssuer,
  linkInstance,
  normalizeBaseUrl,
  listLinks,
  redeemFederationGrant,
  unlinkInstance,
} from '../services/federation.js';
import { body, handle, str } from './handle.js';

/** La mateixa negativa, vingui d'on vingui: mateix cos, mateix codi. */
function refuse(reply: FastifyReply): undefined {
  const problem = invalidGrant();
  void reply.code(problem.status).type('application/problem+json').send(problem.toProblem());
  return undefined;
}

export function registerFederationRoutes(app: FastifyInstance, secret: () => string): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  /**
   * El manifest.
   *
   * **Diu qui és i prou.** Ni quants usuaris, ni quins àmbits, ni la versió exacta: una
   * instància de casa no ha de publicar la seva superfície a qui li demani. Serveix
   * perquè qui enganxa una adreça vegi un nom abans d'enllaçar-s'hi, i perquè enganxar la
   * d'un servidor que no és Fem-ho falli de seguida i amb un motiu.
   */
  app.get('/.well-known/femho', async (_request, reply) => {
    void reply
      .code(200)
      .header('cache-control', 'public, max-age=300')
      .send({ product: 'fem-ho', api: 'v1', name: app.config.instanceName });
  });

  /**
   * El bescanvi d'un convit federat.
   *
   * **Sense sessió, i és l'única ruta d'escriptura que no en demana.** Qui la crida és un
   * servidor, no una persona: no té compte aquí ni n'ha de tenir. El que la protegeix és
   * el token opac —amb `tokenHmac` i el mateix silenci per a un d'inventat, un de caducat
   * i un de revocat (`docs/10` §4)— i que el que en surt només val per a un àmbit i per a
   * les capacitats de contingut.
   */
  app.post('/api/v1/federation/redeem', async (request, reply) => {
    const input = body(request);
    const token = str(input.token) ?? '';

    /**
     * **L'historial el porta qui va emetre el convit.** Regla 4: la fila ha d'existir, i
     * qui truca a la porta és un servidor sense compte aquí. Compartir va ser una decisió
     * d'algú d'aquesta casa, i és la seva.
     */
    const issuer = await federationGrantIssuer(db().db, token, secret());
    if (issuer === null) return refuse(reply);

    const result = await auditedTransaction(
      db().db,
      {
        kind: 'user',
        userId: issuer,
        capabilities: new Set(capabilitiesForRole('admin')),
        scopeIds: null,
        source: 'api',
      },
      (ctx) =>
        redeemFederationGrant(ctx, token, secret(), {
          instance_name: str(input.instance_name),
          user_name: str(input.user_name),
        }),
    ).catch((error: unknown) => {
      /**
       * **Un token inventat i un de revocat han de respondre EXACTAMENT igual**, i no ho
       * feien: el primer sortia per la branca de dalt amb un `problem+json` i el segon
       * petava dins de la transacció, on Fastify el convertia en el seu error genèric.
       * Dues formes diferents són una manera d'enumerar convits (`docs/10` §4), i es va
       * veure comparant les dues respostes a la prova, no llegint el codi.
       */
      if (error instanceof PolicyError) return null;
      throw error;
    });

    if (result === null) return refuse(reply);
    void reply.code(200);
    return result;
  });

  app.get('/api/v1/federation/links', async (request, reply) =>
    handle(app, request, reply, async (principal) => listLinks(db().db, principal)),
  );

  app.post('/api/v1/federation/links', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        linkInstance(
          ctx,
          principal,
          {
            // La validació de l'entrada va aquí, a la vora: HTTPS pública i prou.
            base_url: normalizeBaseUrl(str(input.base_url) ?? ''),
            token: str(input.token) ?? '',
            name: str(input.name),
          },
          secret(),
        ),
      );
      void reply.code(201);
      return result;
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/federation/links/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        unlinkInstance(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );
}
