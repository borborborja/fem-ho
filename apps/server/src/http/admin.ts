/**
 * Administració i exportació. docs/02 §9 (Admin), docs/05 §4, docs/12 §8.
 *
 * `POST /invite/{token}` és **l'única ruta d'aquest fitxer sense autenticar**, i ho és
 * perquè qui l'obre encara no en té: la prova d'identitat és el token d'un sol ús. Va
 * amb el mateix retard i la mateixa resposta tant si el token no existeix com si ja
 * s'ha fet servir.
 */

import type { FastifyInstance } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import {
  acceptInvite,
  deleteUser,
  inviteUser,
  listUsers,
  updateUser,
  wipeInstance,
} from '../services/admin.js';
import { exportAll } from '../services/export.js';
import { PolicyError } from '../policy/errors.js';
import { setupPrincipal } from '../services/setup.js';
import { body, handle, str } from './handle.js';

/**
 * El secret arriba per callback i no com a valor, pel mateix motiu que a les rutes de
 * compartits: `buildApp` no ha de tocar el disc, i una instància que només serveixi
 * `/healthz` no ha de crear cap fitxer de secret (`config/secret.ts`).
 */
export function registerAdminRoutes(app: FastifyInstance, secret: () => string): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;
  const baseUrl = (): string => app.config.baseUrl ?? `http://localhost:${String(app.config.port)}`;

  app.get('/api/v1/admin/users', async (request, reply) =>
    handle(app, request, reply, async (principal) => listUsers(db().db, principal)),
  );

  app.post('/api/v1/admin/users/invite', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        inviteUser(
          ctx,
          principal,
          { email: str(input.email), name: str(input.name), role: str(input.role) },
          secret(),
          baseUrl(),
        ),
      );
      void reply.code(201);
      return result;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/admin/users/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateUser(ctx, principal, request.params.id, {
          name: str(input.name),
          role: str(input.role),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/admin/users/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteUser(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  app.post('/api/v1/admin/wipe', async (request, reply) =>
    handle(app, request, reply, async (principal) =>
      auditedTransaction(db().db, principal, (ctx) =>
        wipeInstance(ctx, principal, String(body(request).confirmation ?? ''), app.config.instanceName),
      ),
    ),
  );

  /**
   * `GET /export` — tot el que és de qui pregunta.
   *
   * **No demana permís a ningú** (docs/10 §9). Es marca com a `readOnly` a l'embolcall
   * d'auditoria: una exportació no és un canvi d'estat i registrar-la ompliria
   * l'historial cada cop que algú es fa una còpia.
   */
  app.get('/api/v1/export', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      void reply.header(
        'Content-Disposition',
        `attachment; filename="fem-ho-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      return exportAll(db().db, principal, new Date().toISOString());
    }),
  );

  app.get('/api/v1/admin/diagnostics', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      if (!principal.capabilities.has('instance:manage')) {
        throw new PolicyError(
          'missing-capability',
          'Capability not granted',
          403,
          'This token does not have the "instance:manage" capability.',
        );
      }
      return diagnostics(app, secret());
    }),
  );

  app.post<{ Params: { token: string } }>('/invite/:token', async (request, reply) => {
    const conn = app.connection;
    if (conn === undefined) {
      void reply.code(503).send();
      return undefined;
    }

    try {
      const result = await auditedTransaction(
        conn.db,
        // El principal del sistema: encara no hi ha ningú autenticat, i l'entrada del
        // registre ha de dir que la va escriure el sistema i no un usuari inexistent.
        setupPrincipal(),
        (ctx) =>
          acceptInvite(
            ctx,
            request.params.token,
            String(body(request).password ?? ''),
            secret(),
          ),
      );
      void reply.code(200);
      return result;
    } catch (error) {
      if (error instanceof PolicyError) {
        void reply
          .code(error.status)
          .type('application/problem+json')
          .send(error.toProblem(request.url));
        return undefined;
      }
      throw error;
    }
  });
}

/**
 * El paquet de diagnòstic. docs/12 §8.
 *
 * **Amb tots els secrets ocultats.** El punt d'aquest endpoint és poder-lo enganxar a un
 * informe d'error, i qualsevol cosa que hi surti se n'anirà amb ell: per això no hi ha
 * cap valor de variable d'entorn, cap cadena de connexió i cap clau, només si hi són.
 */
function diagnostics(app: FastifyInstance, instanceSecret: string): Record<string, unknown> {
  const conn = app.connection;
  return {
    instance: {
      name: app.config.instanceName,
      version: app.config.version,
      registration: app.config.registration,
      base_url_set: app.config.baseUrl !== undefined,
    },
    database: {
      engine: conn?.engine ?? 'cap',
      // El camí del fitxer o l'amfitrió del servidor no hi surten: poden portar
      // credencials i, com a mínim, delaten estructura.
      configured: conn !== undefined,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime_seconds: Math.round(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
    dav: { port: app.config.davPort },
    secrets: {
      instance_secret_set: instanceSecret !== '',
      // Ni la clau pública: identifica la instància davant dels serveis de push.
      vapid_configured: true,
    },
  };
}
