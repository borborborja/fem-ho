/**
 * Identitat i salut de la instància. Les dues rutes són públiques i sense autenticar,
 * i pengen de l'arrel, no de /api/v1.
 *
 * Contracte: packages/contracts/openapi.yaml, operacions `getInfo` i `getHealthz`.
 * Els tipus surten d'allà (regla 5); aquí no se n'escriu cap a mà.
 */

import type { FastifyInstance } from 'fastify';
import type { components } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { setupIsOpen } from '../services/setup.js';

type Info = components['schemas']['Info'];
type Health = components['schemas']['Health'];
type Readiness = components['schemas']['Readiness'];

export function registerInstanceRoutes(app: FastifyInstance): void {
  /**
   * És el que fa servir Android per validar la URL del servidor abans de demanar
   * credencials (docs/03 §2). Per això diu el nom i la versió: perquè l'usuari sàpiga
   * que ha encertat abans d'escriure la contrasenya.
   */
  app.get('/info', async (): Promise<Info> => {
    /**
     * **Es pregunta a la base, no es dona per fet.**
     *
     * Això deia `true` sempre, amb un comentari que ho justificava "mentre no hi hagi
     * taula d'usuaris (M2)" — i M2 va arribar fa vuit fites. El resultat és que una
     * instància ja configurada seguia dient que li calia configuració, i Android, que
     * fa servir justament aquesta ruta per validar el servidor (docs/03 §2), hauria
     * ensenyat el missatge equivocat per sempre.
     *
     * Si la base no respon **es diu que sí que cal**: entre enviar algú a una pantalla
     * de configuració que es tancarà sola i deixar-lo mirant un login d'una instància
     * que potser no existeix, la primera és recuperable.
     */
    const conn = app.connection;
    const setupRequired = conn === undefined ? true : await setupIsOpen(conn.db).catch(() => true);

    return {
      name: app.config.instanceName,
      version: app.config.version,
      registration: app.config.registration,
      setup_required: setupRequired,
      /**
       * D'on surt el codi d'aquesta instància.
       *
       * **No és publicitat: és l'article 13 de l'AGPL.** Qui hi accedeix per xarxa té
       * dret al codi de la versió que està fent servir, i la manera d'oferir-lo és
       * dir-li on és. Va a `/info`, que és públic i sense autenticar, perquè el dret
       * el té qualsevol que hi arribi i no només qui hi tingui compte.
       *
       * Si algú publica una versió modificada, aquí hi ha d'anar la seva.
       */
      license: 'AGPL-3.0-or-later',
      source_url: app.config.sourceUrl,
    };
  });

  /**
   * Només diu que el procés és viu. No toca la base de dades a propòsit: si el
   * healthcheck del contenidor depengués de la base, una base lenta reiniciaria el
   * contenidor en bucle. Per a la base hi ha /readyz (docs/12 §8), que arriba a M2.
   */
  app.get('/healthz', async (): Promise<Health> => {
    return { status: 'ok' };
  });

  /**
   * Aquesta SÍ que toca la base (docs/12 §8). Diu si la instància pot servir peticions
   * de veritat: base accessible i migracions aplicades.
   */
  app.get('/readyz', async (_request, reply): Promise<Readiness | undefined> => {
    const conn = app.connection;
    if (conn === undefined) {
      void reply.code(503).type('application/problem+json').send({
        type: 'https://femho.app/errors/not-ready',
        title: 'Database not connected',
        status: 503,
        detail: 'La instància encara no té connexió a la base de dades.',
      });
      return undefined;
    }

    try {
      const result = await sql
        .raw('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')
        .execute(conn.db);
      const row = result.rows[0] as { name: string } | undefined;

      if (row === undefined) {
        void reply.code(503).type('application/problem+json').send({
          type: 'https://femho.app/errors/not-migrated',
          title: 'Schema not migrated',
          status: 503,
          detail: "La base respon però no s'hi ha aplicat cap migració.",
        });
        return undefined;
      }

      return { status: 'ready', database: conn.engine, schema_version: row.name };
    } catch (error) {
      app.log.error({ err: error }, 'readyz: la base no respon');
      void reply.code(503).type('application/problem+json').send({
        type: 'https://femho.app/errors/database-unavailable',
        title: 'Database unavailable',
        status: 503,
        detail: 'La base de dades no respon.',
      });
      return undefined;
    }
  });
}
