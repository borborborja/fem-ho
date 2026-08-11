/**
 * L'apartat «Quant a»: versió, crèdits i si hi ha una versió més nova.
 *
 * **Els crèdits no són decoració.** `NOTICE` diu que Plou és el design system d'un
 * producte a part, vendoritzat aquí amb condicions pròpies que **no cobreix l'AGPL**
 * d'aquest repositori. Amagar-ho en una llista de dependències seria fer passar per
 * nostre el que no ho és, i per això la prova mira que hi surti amb nom.
 */

import { expect, test } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Quantia',
  email: 'quanta@example.com',
  password: 'la-contrasenya-de-prova',
};

test('diu quina versió corres i a qui es deu', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.goto('/settings?tab=general');

  const info = await (await page.request.get('/info')).json();

  // La versió que diu la pantalla és la que diu el servidor, no una constant escrita.
  const about = page.locator('section', { hasText: 'Sobre' }).first();
  await expect(about).toContainText(String(info.version), { timeout: 10_000 });
  await expect(about).toContainText('AGPL');

  // Plou, amb nom, i el NOTICE on mirar-ho sencer.
  await expect(about).toContainText('Plou');
  await expect(about).toContainText('NOTICE');
});

test('i si no es pot consultar GitHub, no diu que vagis al dia', async ({ page }) => {
  /**
   * **`unreachable` no és `ok`.** Una instància sense sortida a internet estaria dient
   * "estàs al dia" sempre i callaria justament el dia que hi ha una actualització de
   * seguretat. Aquí es talla la crida i es comprova que ho diu.
   */
  await enterAsNew(page, MEU);
  await page.route('**/api/v1/updates', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        current: '0.4.0',
        latest: null,
        available: false,
        url: 'https://github.com/borborborja/fem-ho/releases',
        reason: 'unreachable',
      }),
    }),
  );
  await page.goto('/settings?tab=general');

  await expect(page.locator('[data-testid="update-unreachable"]')).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="update-available"]')).toHaveCount(0);
});

test('i quan n’hi ha una de nova, ho diu amb el número i un enllaç', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.route('**/api/v1/updates', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        current: '0.4.0',
        latest: '0.5.0',
        available: true,
        url: 'https://github.com/borborborja/fem-ho/releases/tag/v0.5.0',
        reason: 'ok',
      }),
    }),
  );
  await page.goto('/settings?tab=general');

  const avis = page.locator('[data-testid="update-available"]');
  await expect(avis).toContainText('0.5.0', { timeout: 10_000 });
  await expect(avis.locator('a')).toHaveAttribute('href', /releases\/tag\/v0\.5\.0/);
});

test('i quan vas al dia, NO diu res', async ({ page }) => {
  /**
   * Un "estàs al dia" permanent és una línia que la gent aprèn a no llegir, i llavors
   * l'avís que sí que importa cau al mateix sac. El silenci és la resposta correcta.
   */
  await enterAsNew(page, MEU);
  await page.route('**/api/v1/updates', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        current: '0.4.0',
        latest: '0.4.0',
        available: false,
        url: null,
        reason: 'ok',
      }),
    }),
  );
  await page.goto('/settings?tab=general');

  await expect(page.locator('[data-testid="settings-screen"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="update-available"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="update-unreachable"]')).toHaveCount(0);
});
