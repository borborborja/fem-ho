/**
 * L'avatar, al navegador.
 *
 * La suite corre **amb Gravatar apagat**, que és el valor per defecte i el cas de la
 * immensa majoria d'instàncies. El que es comprova, doncs, és el que ha de passar llavors:
 * **les inicials són el cas normal i no el pla B**, i la pantalla d'Ajustos diu clarament
 * què costaria encendre-ho.
 */

import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

async function enter(page: import('@playwright/test').Page): Promise<void> {
  const gate = await page.request.get('/api/v1/setup');
  const open = ((await gate.json()) as { open: boolean }).open;

  await page.goto('/');
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  // La instància la crea `app.spec.ts`. Si aquest fitxer corre sol, la crea ell.
  if (open) {
    await page.goto('/setup');
    await page.locator('[data-testid="setup-name"]').fill(ADMIN.name);
    await page.locator('[data-testid="setup-email"]').fill(ADMIN.email);
    await page.locator('[data-testid="setup-password"]').fill(ADMIN.password);
    await page.locator('[data-testid="setup-submit"]').click();
  }

  /**
   * **Esperar tornant a mirar la portada, no quedant-se a `/setup`.**
   *
   * Qui perd la cursa d'arrencada rep un 403 i **es queda a la pantalla d'arrencada per
   * sempre**: allà el camp de login no hi apareixerà mai, i esperar-lo era esperar el
   * temps màxim sencer. Vint segons regalats a cada execució, i prou lentitud afegida
   * perquè una prova d'arrossegament d'un altre fitxer comencés a fallar.
   */
  await expect
    .poll(
      async () => {
        if ((await page.locator('[data-testid="login-email"]').count()) === 0) {
          await page.goto('/');
        }
        return page.locator('[data-testid="login-email"]').count();
      },
      { timeout: 20_000, intervals: [200, 400, 800] },
    )
    .toBeGreaterThan(0);

  await page.locator('[data-testid="login-email"]').fill(ADMIN.email);
  await page.locator('[data-testid="login-password"]').fill(ADMIN.password);
  await page.locator('[data-testid="login-submit"]').click();
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible({ timeout: 15_000 });
}

test('amb Gravatar apagat, la barra ensenya les inicials i no un forat', async ({ page }) => {
  await enter(page);

  const avatar = page.locator('[data-testid^="avatar-"]').first();
  await expect(avatar).toBeVisible();
  // Les inicials de "Borja". El que NO hi ha d'haver és una imatge trencada.
  await expect(avatar).toHaveText(/^[A-ZÀ-Ú]{1,2}$/u);
  await expect(avatar.locator('img')).toHaveCount(0);
});

test("la ruta de l'avatar respon 404 i no un error, que vol dir «no en té»", async ({ page }) => {
  await enter(page);

  const token = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('femho.tokens') ?? '{}') as { access_token?: string })
        .access_token ?? '',
  );
  const me = await page.request.get('/api/v1/auth/me', {
    headers: { authorization: `Bearer ${token}` },
  });
  const id = (await me.json()).id as string;

  const res = await page.request.get(`/api/v1/users/${id}/avatar`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(404);
});

test('i Ajustos diu què costaria encendre-ho, no només que existeix', async ({ page }) => {
  await enter(page);
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-profile"]').click();

  await expect(page.locator('[data-testid="settings-gravatar"]')).toBeVisible();
  // L'avís ha de parlar del hash, que és el punt que la gent no sap.
  await expect(page.getByText(/hash/iu).first()).toBeVisible();
});
