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
import { ensureInstanceSecret } from './config/secret.js';
import { registerAuthRoutes } from './http/auth.js';
import { registerInstanceRoutes } from './http/instance.js';
import { registerMcpRoutes } from './http/mcp.js';
import { registerSyncRoutes } from './http/sync.js';
import { registerPushRoutes } from './http/push.js';
import { registerAdminRoutes } from './http/admin.js';
import { registerAgentRoutes } from './http/agents.js';
import { registerMeRoutes } from './http/me.js';
import { registerScopeRoutes } from './http/scopes.js';
import { registerSpaRoutes } from './http/spa.js';
import { registerSetupRoutes } from './http/setup.js';
import { registerShareRoutes } from './http/shares.js';
import { registerTokenRoutes } from './http/tokens.js';
import { registerChecklistRoutes, registerEventRoutes, registerTaskRoutes } from './http/tasks.js';

export interface BuildOptions {
  /**
   * La connexió a la base. Opcional perquè les proves de contracte de les rutes
   * públiques no n'han de muntar cap, i perquè /healthz ha de respondre encara que la
   * base no hi sigui — que és tot el motiu pel qual està separada de /readyz.
   */
  connection?: Connection;
  /**
   * El secret de la instància. Les proves en passen un de fix; en producció es genera
   * un sol cop al volum de dades i **no** a la base (`config/secret.ts`).
   */
  secret?: string;
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

  /**
   * Capçaleres de seguretat de docs/10 §8, aplicades **centralment**.
   *
   * S'escriuen aquí i no a cada ruta a posta: així cap ruta les pot afluixar per
   * descuit. La pàgina compartida en necessita una de **més estricta**
   * —`no-referrer`, docs/10 §4— i per això la decisió és aquí i no allà: si la posés la
   * ruta, aquest hook la sobreescriuria després i el token acabaria viatjant al referent
   * d'un servidor de tercers sense que ningú se n'adonés.
   */
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
    reply.header(
      'Referrer-Policy',
      request.url.startsWith('/s/') ? 'no-referrer' : 'strict-origin-when-cross-origin',
    );
  });

  registerInstanceRoutes(app);
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerAgentRoutes(app);
  /**
   * El secret es resol **quan es necessita**, no en construir l'app: `buildApp` no ha de
   * tocar el disc. Una instància que només serveixi `/healthz` no ha de crear cap fitxer,
   * i les proves de contracte no n'han de muntar cap volum.
   */
  let secret: string | undefined = options.secret;
  const instanceSecret = (): string => {
    secret ??= ensureInstanceSecret(config.dataDir, config.secret);
    return secret;
  };

  registerScopeRoutes(app, instanceSecret);
  registerTaskRoutes(app);
  registerEventRoutes(app, instanceSecret);
  registerChecklistRoutes(app);
  registerSyncRoutes(app);
  registerMcpRoutes(app);
  registerTokenRoutes(app);
  registerPushRoutes(app);
  registerSetupRoutes(app);
  registerShareRoutes(app, instanceSecret);
  registerAdminRoutes(app, instanceSecret);

  /**
   * L'app web va **l'última**.
   *
   * Registra un gestor de "no trobat" que porta a `index.html`, i si anés abans es
   * menjaria les rutes de l'API que encara no s'han declarat.
   */
  registerSpaRoutes(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    connection: Connection | undefined;
  }
}
