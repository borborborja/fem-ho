/**
 * Identitat i salut de la instància. Les dues rutes són públiques i sense autenticar,
 * i pengen de l'arrel, no de /api/v1.
 *
 * Contracte: packages/contracts/openapi.yaml, operacions `getInfo` i `getHealthz`.
 * Els tipus surten d'allà (regla 5); aquí no se n'escriu cap a mà.
 */

import type { FastifyInstance } from 'fastify';
import type { components } from '@fem-ho/contracts';

type Info = components['schemas']['Info'];
type Health = components['schemas']['Health'];

export function registerInstanceRoutes(app: FastifyInstance): void {
  /**
   * És el que fa servir Android per validar la URL del servidor abans de demanar
   * credencials (docs/03 §2). Per això diu el nom i la versió: perquè l'usuari sàpiga
   * que ha encertat abans d'escriure la contrasenya.
   */
  app.get('/info', async (): Promise<Info> => {
    return {
      name: app.config.instanceName,
      version: app.config.version,
      registration: app.config.registration,
      // Mentre no hi hagi taula d'usuaris (M2), no hi ha cap administrador i per tant
      // la instància sempre necessita configuració inicial.
      setup_required: true,
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
}
