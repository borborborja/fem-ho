/**
 * L'arrencada demana la contrasenya dues vegades.
 *
 * **Aquest és el primer compte de la instància, i no té recuperació.** No hi ha ningú que
 * et pugui reobrir la porta i el correu de recuperació no existeix (`docs/11`: l'SMTP
 * encara no hi és). Una lletra mal escrita en un camp que no es veu deixa la instància
 * tancada per sempre, i l'única sortida és esborrar el volum i tornar a començar.
 *
 * La pantalla de convit ho demanava dues vegades des del primer dia; aquesta, no.
 */

import { expect, test } from '@playwright/test';

test('sense repetir-la bé, no es crea res', async ({ page }) => {
  await page.goto('/setup');

  const formulari = page.locator('[data-testid="setup-name"]');
  if ((await formulari.count()) === 0) {
    /**
     * La instància ja està arrencada —un altre fitxer ha guanyat la cursa—, i llavors el
     * formulari no hi és. **No és un error**: el que aquesta prova comprova només existeix
     * abans de l'arrencada, i la invariant de després la cobreix `app.spec.ts`.
     */
    test.skip(true, 'la instància ja està arrencada');
    return;
  }

  await formulari.fill('Borja');
  await page.locator('[data-testid="setup-email"]').fill('confirmacio@example.com');
  await page.locator('[data-testid="setup-password"]').fill('una-contrasenya-prou-llarga');
  await page.locator('[data-testid="setup-password2"]').fill('una-contrasenya-prou-llargA');
  await page.locator('[data-testid="setup-submit"]').click();

  // Ho diu, i **no ha creat res**: el formulari segueix aquí.
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator('[data-testid="setup-name"]')).toBeVisible();
});
