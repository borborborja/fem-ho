/**
 * L'avatar, al navegador.
 *
 * La suite corre amb Gravatar apagat. La prova de la foto intercepta la ruta de
 * l'avatar per poder comprovar-ne la posició sense dependre de Gravatar.
 */

import { fileURLToPath } from 'node:url';
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

test('la foto de perfil queda centrada dins del botó a mòbil i a escriptori', async ({ page }) => {
  await page.route('**/api/v1/users/*/avatar', (route) =>
    route.fulfill({
      path: fileURLToPath(new URL('../public/icons/icon-192.png', import.meta.url)),
    }),
  );
  await enter(page);

  const photo = page.getByTestId('topbar-profile').locator('img');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(photo).toBeVisible();
    await expect
      .poll(() => photo.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
    const insets = await photo.evaluate((element) => {
      const photoBox = element.getBoundingClientRect();
      const buttonBox = element.closest('button')!.getBoundingClientRect();
      return [
        photoBox.left - buttonBox.left,
        buttonBox.right - photoBox.right,
        photoBox.top - buttonBox.top,
        buttonBox.bottom - photoBox.bottom,
      ].map((inset) => Math.round(inset));
    });
    expect(insets).toEqual([1, 1, 1, 1]);
  }
});
