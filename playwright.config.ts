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
/**
 * **El volum es crea un sol cop i el nom viatja per l'entorn.**
 *
 * Aquest fitxer el llegeix el procés que orquestra i **també cada procés de treball**: amb
 * un `mkdtempSync` a seques, cada treballador se'n fabricava un de propi i buit, i una
 * prova que hi volgués sembrar res obria una base que no era la del servidor —sense error,
 * amb una taula que no hi és—. Amb la variable, el primer el crea i la resta el troben.
 *
 * Serveix perquè una prova pugui sembrar **el que l'API no deixa crear**: el correu entra
 * per IMAP i per enlloc més, i no hi ha d'haver cap ruta que creï un missatge —seria una
 * porta d'escriptura a la bústia d'algú que existiria només per a les proves.
 */
const DATA_DIR = process.env.FEMHO_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'femho-e2e-'));
process.env.FEMHO_E2E_DATA_DIR = DATA_DIR;
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
    /**
     * **L'idioma de la suite és explícit.**
     *
     * Per defecte Playwright obre el navegador en `en-US`, i des que l'app és
     * multiidioma això vol dir que totes les pantalles surten en anglès i que les
     * proves que esperen text català fallen. Abans no es notava perquè no hi havia res
     * a triar; ara l'idioma és una entrada més de la prova i s'escriu.
     *
     * Les proves que comproven **el multiidioma** el sobreescriuen per test amb
     * `test.use({ locale: ... })`; veure `i18n.spec.ts`.
     */
    locale: 'ca-ES',
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
      command:
        'npm run build -w @fem-ho/contracts && npm run build -w @fem-ho/server && node apps/server/dist/index.js',
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
        /**
         * El registre, obert a la suite.
         *
         * No és per comoditat: és **l'única manera de comprovar-lo al navegador**. Una
         * instància de proves amb el registre tancat faria que la pantalla de registre no
         * s'arribés a provar mai, que és exactament com `FEMHO_REGISTRATION` va viure
         * anys sent una opció que no feia res.
         */
        FEMHO_ALLOW_REGISTRATION: 'true',
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
