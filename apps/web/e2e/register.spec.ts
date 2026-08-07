/**
 * Fer-se un compte, al navegador.
 *
 * `FEMHO_REGISTRATION` era una opció declarada que **no feia res**: es publicava a `/info`
 * i no hi havia cap ruta de registre enlloc. Aquestes proves són el que fa que no hi pugui
 * tornar a ser: si la porta es tanca, es veuen caure.
 *
 * La suite corre amb `FEMHO_ALLOW_REGISTRATION=true`, que és l'única manera de provar la
 * pantalla de debò.
 */

import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

/** Un correu diferent a cada execució: la base de la suite viu tota una passada. */
function unCorreu(prefix: string): string {
  return `${prefix}-${String(Math.floor(performance.now() * 1000))}@example.com`;
}

test("l'enllaç per fer-se un compte surt al login quan la instància ho permet", async ({
  page,
}) => {
  await page.goto('/');

  // Si la instància encara és nova, primer hi ha l'arrencada. Amb el registre obert
  // tampoc cal: la pantalla de registre fa la mateixa feina.
  const enllac = page.locator('[data-testid="login-register"]');
  if ((await page.locator('[data-testid="login"]').count()) > 0) {
    await expect(enllac).toBeVisible({ timeout: 10_000 });
    await enllac.click();
    await expect(page.locator('[data-testid="register"]')).toBeVisible();
  }
});

test('el formulari demana correu, nom i contrasenya, i deixa la sessió oberta', async ({
  page,
}) => {
  await page.goto('/register');
  const form = page.locator('[data-testid="register"]');
  await expect(form).toBeVisible();

  await form.locator('[data-testid="register-email"]').fill(unCorreu('nova'));
  await form.locator('[data-testid="register-name"]').fill('Persona Nova');
  await form.locator('[data-testid="register-password"]').fill('la-contrasenya-de-prova');
  await form.locator('[data-testid="register-submit"]').click();

  // **Sense passar pel login.** Qui acaba de posar la contrasenya ja ha demostrat que la
  // sap; tornar-la a demanar és una pantalla de frec per res.
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible({ timeout: 15_000 });
});

test('i ja té un àmbit propi on posar la primera tasca', async ({ page }) => {
  await page.goto('/register');
  await page.locator('[data-testid="register-email"]').fill(unCorreu('ambit'));
  await page.locator('[data-testid="register-name"]').fill('Amb Àmbit');
  await page.locator('[data-testid="register-password"]').fill('la-contrasenya-de-prova');
  await page.locator('[data-testid="register-submit"]').click();
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible({ timeout: 15_000 });

  // Sense àmbit, la primera pantalla seria un tauler on l'afegida ràpida no té on posar res.
  await expect(page.locator('[data-testid="scope-chips"] button').first()).toBeVisible();
});

test('una contrasenya massa curta ho diu, i no crea res', async ({ page }) => {
  await page.goto('/register');
  await page.locator('[data-testid="register-email"]').fill(unCorreu('curta'));
  await page.locator('[data-testid="register-name"]').fill('Massa Curta');
  await page.locator('[data-testid="register-password"]').fill('curta');
  await page.locator('[data-testid="register-submit"]').click();

  await expect(page.locator('[data-testid="register-error"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-testid="topbar"]')).toHaveCount(0);
});
