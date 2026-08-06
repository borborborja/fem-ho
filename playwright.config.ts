import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Un volum de dades nou a cada execució.
 *
 * Amb un de fix, la primera prova —el primer arrencament— només passaria un cop i
 * després fallaria per sempre amb un 403 que sembla un error del producte. Amb un de
 * nou, cada execució comença amb la instància buida, que és exactament l'escenari que
 * `fresh-install` ha de comprovar.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'femho-e2e-'));
const API_PORT = 4174;

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 2 : 0,
  reporter: process.env.CI !== undefined ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      /**
       * El servidor de veritat, amb una base buida.
       *
       * `app.spec.ts` hi passa pel primer arrencament, hi entra amb contrasenya i fa
       * servir el producte. És l'única prova que pot veure els errors que només
       * existeixen quan les peces van juntes.
       */
      command: 'npm run build -w @fem-ho/contracts && npm run build -w @fem-ho/server && node apps/server/dist/index.js',
      url: `http://localhost:${String(API_PORT)}/healthz`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        FEMHO_PORT: String(API_PORT),
        FEMHO_DAV_PORT: '4175',
        FEMHO_DATA_DIR: DATA_DIR,
        FEMHO_DATABASE_URL: `sqlite://${join(DATA_DIR, 'e2e.db')}`,
        FEMHO_LOG_LEVEL: 'warn',
        FEMHO_INSTANCE_NAME: 'Fem-ho de proves',
        FEMHO_BASE_URL: 'http://localhost:4173',
      },
    },
    {
      // Es prova la construcció de producció, no el servidor de desenvolupament: el que
      // s'ha de verificar és l'ordre de la cascada al CSS empaquetat.
      command: 'npm run build -w @fem-ho/web && npm run preview -w @fem-ho/web -- --port 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 180_000,
      env: { FEMHO_API_ORIGIN: `http://localhost:${String(API_PORT)}` },
    },
  ],
});
