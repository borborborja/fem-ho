import { defineConfig, devices } from '@playwright/test';

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

  // Es prova la construcció de producció, no el servidor de desenvolupament: el que
  // s'ha de verificar és l'ordre de la cascada al CSS empaquetat.
  webServer: {
    command: 'npm run build -w @fem-ho/web && npm run preview -w @fem-ho/web -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: process.env.CI === undefined,
    timeout: 120_000,
  },
});
