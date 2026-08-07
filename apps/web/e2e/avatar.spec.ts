/**
 * L'avatar, al navegador.
 *
 * La suite corre **amb Gravatar apagat**, que és el valor per defecte i el cas de la
 * immensa majoria d'instàncies. El que es comprova, doncs, és el que ha de passar llavors:
 * **les inicials són el cas normal i no el pla B**, i la pantalla d'Ajustos diu clarament
 * què costaria encendre-ho.
 */

import { expect, test } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

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
