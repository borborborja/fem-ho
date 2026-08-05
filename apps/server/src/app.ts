/**
 * Muntatge de l'aplicació Fastify.
 *
 * Es construeix a part d'arrencar-la perquè les proves de contracte puguin llançar
 * peticions contra ella amb `app.inject()` sense obrir cap port.
 *
 * La superfície CalDAV NO viu aquí: va sobre node:http pelat, en un port propi dins del
 * mateix procés (docs/07 §1, D1). Fastify fa 404 silenciós als verbs DAV.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Connection } from './db/connection.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerInstanceRoutes } from './http/instance.js';
import { registerChecklistRoutes, registerEventRoutes, registerTaskRoutes } from './http/tasks.js';

export interface BuildOptions {
  /**
   * La connexió a la base. Opcional perquè les proves de contracte de les rutes
   * públiques no n'han de muntar cap, i perquè /healthz ha de respondre encara que la
   * base no hi sigui — que és tot el motiu pel qual està separada de /readyz.
   */
  connection?: Connection;
}

export function buildApp(config: Config, options: BuildOptions = {}): FastifyInstance {
  const app = Fastify({
    // Registres estructurats en JSON a stdout, sense cap secret (docs/12 §8).
    logger: { level: config.logLevel },
    // Darrere d'un proxy invers casolà; els rangs de confiança es fixaran amb
    // FEMHO_TRUSTED_PROXIES quan hi hagi límits de ritme i sessions (M3).
    trustProxy: false,
  });

  app.decorate('config', config);
  app.decorate('connection', options.connection);

  // Capçaleres de seguretat de docs/10 §8. La CSP arriba a M5, quan hi ha una pàgina
  // de veritat a què aplicar-la.
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  });

  registerInstanceRoutes(app);
  registerAuthRoutes(app);
  registerTaskRoutes(app);
  registerEventRoutes(app);
  registerChecklistRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    connection: Connection | undefined;
  }
}
