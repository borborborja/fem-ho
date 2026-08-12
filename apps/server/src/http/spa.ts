/**
 * Serveix l'aplicació web.
 *
 * **La imatge ja portava `apps/web/dist` i ningú la servia.** El Dockerfile la copiava
 * des de M14, i `docs/12` §3 diu que després d'un `docker compose up` s'obre
 * `https://el-teu-domini/setup` i es crea el primer administrador — cosa que amb un
 * servidor que només parla JSON dona un fitxer descarregat, no un formulari.
 *
 * Dues regles, i les dues importen:
 *
 *   1. **Les rutes de l'API no passen mai per aquí.** `/api`, `/mcp`, `/s/`, `/healthz`,
 *      `/readyz`, `/info` i `/dav` són del servidor; qualsevol altra cosa que no sigui un
 *      fitxer és una ruta del client i rep `index.html`. Sense la llista explícita, un
 *      `GET /api/v1/tasques-inexistents` tornaria l'HTML de l'app amb un 200 i el client
 *      es trobaria intentant fer `JSON.parse` d'un `<!doctype html>`.
 *
 *   2. **`index.html` no es guarda a la memòria cau.** Els fitxers amb hash al nom sí,
 *      un any, perquè el nom canvia quan canvia el contingut. L'`index.html` és el que
 *      apunta als altres: si un navegador se'l queda, l'app es queda clavada a la versió
 *      antiga i el desplegament següent no arriba mai.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Prefixos que són del servidor i no de l'app.
 *
 * **`/s/` i `/invite/` no hi són, i és el punt de tot això.** Són *alhora* una pàgina i un
 * endpoint: el `POST` va al servidor i el `GET` ha de pintar l'app. Hi eren, i el resultat
 * era que **obrir un enllaç compartit al navegador descarregava un JSON de 404** —el que
 * envies al lampista, el que fa que la funció existeixi—, i el mateix amb una invitació.
 *
 * No cal fer res més per distingir-ho: un `POST /s/:token` és una **ruta declarada** i mai
 * no arriba aquí; el que hi arriba és un `GET` que ningú ha reclamat, i aquest és de l'app.
 * `/setup` ja funcionava així des del primer dia, i el raonament era el mateix.
 *
 * **Cap prova del navegador ho podia veure**: en desenvolupament la web i l'API són dos
 * processos i el proxy de Vite ja desviava el `GET` a `index.html`, o sigui que la suite
 * provava una disposició que a producció no existeix. Aquesta llista, en canvi, és el que
 * corre a la imatge.
 */
const API_PREFIXES = ['/api/', '/mcp', '/dav/', '/healthz', '/readyz', '/info', '/brand/'];

/**
 * On és la construcció de la web.
 *
 * A la imatge, `apps/web/dist` penja de l'arrel de treball; en desenvolupament, del
 * repositori. Es busquen els dos i **si no hi és cap, no es registra res**: un servidor
 * d'API sense web ha de seguir arrencant, que és el cas de les proves i el de qui la
 * serveix amb un altre procés.
 */
function findWebRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Executant des de `apps/server/dist/http/`.
    resolve(here, '../../../web/dist'),
    // Executant des de l'arrel de la imatge.
    resolve(process.cwd(), 'apps/web/dist'),
  ];
  return candidates.find((path) => existsSync(join(path, 'index.html'))) ?? null;
}

export function registerSpaRoutes(app: FastifyInstance): boolean {
  const root = findWebRoot();
  if (root === null) {
    app.log.info("sense construcció de la web: només se serveix l'API");
    return false;
  }

  void app.register(fastifyStatic, {
    root,
    // Els actius porten un hash al nom (Vite): es poden guardar per sempre.
    maxAge: '1y',
    immutable: true,
    // L'`index.html` el serveix el gestor de sota, amb les seves capçaleres.
    index: false,
    wildcard: false,
  });

  app.setNotFoundHandler((request, reply) => {
    const url = request.url;

    // Regla 1: el que és de l'API es queda com a 404 de l'API, amb la seva forma.
    if (API_PREFIXES.some((prefix) => url === prefix || url.startsWith(prefix))) {
      void reply
        .code(404)
        .type('application/problem+json')
        .send({
          type: 'https://femho.app/errors/not-found',
          title: 'Not found',
          status: 404,
          detail: `No hi ha cap ruta ${request.method} ${url}.`,
        });
      return;
    }

    // Només els GET porten a l'app: un POST a una ruta inexistent és un error, no una
    // pàgina.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      void reply.code(404).send();
      return;
    }

    // Regla 2: l'`index.html` no es guarda mai.
    void reply
      .header('cache-control', 'no-cache, no-store, must-revalidate')
      .type('text/html; charset=utf-8')
      .sendFile('index.html');
  });

  return true;
}
