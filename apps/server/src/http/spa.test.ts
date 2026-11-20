/**
 * Les URL que són **una pàgina i un endpoint alhora**.
 *
 * `/s/{token}` és l'enllaç que s'envia a algú de fora i `/invite/{token}` el que s'envia a
 * algú de casa. Totes dues reben un `POST` del servidor i totes dues s'obren amb un `GET`
 * al navegador. Eren a la llista de prefixos «això és de l'API», i el resultat era que
 * **obrir-les descarregava un JSON de 404**: la funció de compartir no es podia fer servir.
 *
 * **Cap prova del navegador ho podia veure.** En desenvolupament la web i l'API són dos
 * processos i el proxy de Vite ja desviava el `GET` a `index.html`; la suite provava una
 * disposició que a producció no existeix. Això es prova aquí, contra el servidor que
 * s'empaqueta a la imatge, i amb una construcció de la web al costat —que és l'única manera
 * que el retorn a l'app estigui registrat.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { registerSpaRoutes } from './spa.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-spa-'));

let conn: Connection;
let app: FastifyInstance;
let cwd: string;

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  /**
   * Una construcció de la web de mentida, al lloc on el servidor la busca.
   *
   * `registerSpaRoutes` no registra res si no hi ha `apps/web/dist/index.html`, i sense
   * registrar-se no hi ha gestor de «no trobat» que retorni a l'app: la prova passaria
   * sense provar res. Es canvia el directori de treball perquè un dels dos candidats que
   * busca és relatiu a ell.
   */
  cwd = process.cwd();
  mkdirSync(join(tmp, 'apps', 'web', 'dist'), { recursive: true });
  writeFileSync(
    join(tmp, 'apps', 'web', 'dist', 'index.html'),
    '<!doctype html><title>Fem-ho</title>',
  );
  process.chdir(tmp);

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });
  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });
});

afterAll(async () => {
  process.chdir(cwd);
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('les URL que són pàgina i endpoint alhora', () => {
  it.each([
    ['un enllaç compartit', '/s/y2bbbu2MGdcwsQkekACBYbgLRyBihhkw'],
    ['una invitació', '/invite/y2bbbu2MGdcwsQkekACBYbgLRyBihhkw'],
    ['la configuració inicial', '/setup'],
  ])('obrir %s al navegador dona la pàgina i no un JSON', async (_nom, url) => {
    const res = await app.inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // I no la forma d'un error de l'API, que és el que arribava.
    expect(res.body).not.toContain('errors/not-found');
  });

  it("l'API segueix sent l'API: un POST inventat no torna una pàgina", async () => {
    // El `POST /s/:token` de debò és una ruta declarada i no passa mai pel gestor de "no
    // trobat"; el que hi arriba és una ruta que no existeix, i això és un error.
    const res = await app.inject({ method: 'POST', url: '/s/no/existeix/aixo' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type'] ?? '').not.toContain('text/html');
  });

  it('i un camí de /api/ que no existeix segueix donant un problema, no una pàgina', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/inventat' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('la memòria cau dels fitxers web', () => {
  const cacheRoot = join(tmp, 'web-cache');
  const files = {
    'index.html': '<!doctype html><title>Fem-ho</title>',
    'sw.js': 'self.skipWaiting();',
    'registerSW.js': "navigator.serviceWorker.register('/sw.js');",
    'manifest.webmanifest': '{"name":"Fem-ho"}',
    'favicon.svg': '<svg/>',
    'workbox-da147c5a.js': 'export {};',
    'assets/index-C3VvMzMj.js': 'export {};',
    'assets/fixed.css': 'body {}',
  };
  let web: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(join(cacheRoot, 'assets'), { recursive: true });
    for (const [file, body] of Object.entries(files)) writeFileSync(join(cacheRoot, file), body);
    web = fastify();
    registerSpaRoutes(web, cacheRoot);
    await web.ready();
  });

  afterAll(async () => {
    await web.close();
  });

  it.each([
    '/',
    '/settings',
    '/index.html',
    '/sw.js',
    '/registerSW.js',
    '/manifest.webmanifest',
    '/favicon.svg',
    '/assets/fixed.css',
  ])('només serveix una còpia actual de %s', async (url) => {
    const response = await web.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });

  it.each(['/assets/index-C3VvMzMj.js', '/workbox-da147c5a.js'])(
    'pot conservar el fitxer amb hash %s',
    async (url) => {
      const response = await web.inject({ method: 'HEAD', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    },
  );

  it('també envia la política correcta en revalidar el service worker', async () => {
    const worker = await web.inject({ method: 'GET', url: '/sw.js' });
    const etag = worker.headers.etag;
    expect(etag).toEqual(expect.any(String));
    const revalidated = await web.inject({
      method: 'GET',
      url: '/sw.js',
      headers: { 'if-none-match': String(etag) },
    });
    expect(revalidated.statusCode).toBe(304);
    expect(revalidated.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
  });
});
