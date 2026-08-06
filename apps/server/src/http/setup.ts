/**
 * `/setup` — el primer arrencament (docs/12 §7).
 *
 * La ruta **es tanca per sempre** un cop hi ha administrador. No hi ha cap manera de
 * reobrir-la des de fora: si algú perd l'accés, cal entrar a la base de dades, i és el
 * que toca — una porta que es pugui reobrir des d'internet no és una porta.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError } from '../policy/errors.js';
import { createFirstAdmin, setupIsOpen, setupPrincipal } from '../services/setup.js';

export function registerSetupRoutes(app: FastifyInstance): void {
  /**
   * Diu si encara cal fer el primer arrencament.
   *
   * És **pública i sense credencials**: la interfície l'ha de poder consultar abans que
   * existeixi cap usuari. No filtra res que no es pugui deduir provant `POST /setup`.
   */
  /**
   * L'estat de la porta, en JSON.
   *
   * Va sota `/api/v1` i no a `/setup` a seques perquè **`/setup` és una pàgina**
   * (docs/12 §3: "mostra un formulari per crear el primer administrador"). Amb les dues
   * coses al mateix camí, obrir-lo al navegador donava el JSON i no el formulari.
   */
  app.get('/api/v1/setup', async (_request, reply) => {
    if (app.connection === undefined) {
      void reply.code(503).send({ error: 'La instància no té base de dades.' });
      return;
    }
    return { open: await setupIsOpen(app.connection.db) };
  });

  app.post('/setup', async (request, reply) => {
    if (app.connection === undefined) {
      void reply.code(503).send({ error: 'La instància no té base de dades.' });
      return;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;

    try {
      const result = await auditedTransaction(
        app.connection.db,
        setupPrincipal(),
        (ctx) =>
          createFirstAdmin(ctx, {
            email: String(body.email ?? ''),
            name: String(body.name ?? ''),
            password: String(body.password ?? ''),
          }),
        { engine: app.connection.engine },
      );

      void reply.code(201);
      return {
        user_id: result.userId,
        scope_ids: result.scopeIds,
        // Es diu explícitament que ja no es pot tornar a fer: qui munta la instància ha
        // de saber que aquest moment no torna.
        setup_closed: true,
      };
    } catch (error) {
      if (error instanceof PolicyError) {
        void reply
          .code(error.status)
          .type('application/problem+json')
          .send(error.toProblem(request.url));
        return;
      }
      // Una contrasenya fluixa arriba com a `WeakPasswordError`, que no és de política.
      void reply.code(422).send({ error: String((error as Error).message) });
      return;
    }
  });
}
