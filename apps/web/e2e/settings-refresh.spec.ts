/**
 * Els canvis fets a Ajustos arriben a la resta de l'app **sense refrescar la pàgina**.
 *
 * Ajustos mutava el servidor i refrescava la seva llista local, però la resta de la
 * interfície llegia les còpies carregades en entrar: un projecte nou no sortia al
 * desplegable del xip, i encendre el registre de dedicació no feia aparèixer l'entrada
 * del menú fins a un refresc complert — que un usuari normal no farà mai.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Canvis vius',
  email: 'canvisvius@example.com',
  password: 'la-contrasenya-de-prova',
};

async function bearer(page: Page): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await token(page)}` };
}

test('un projecte creat a Ajustos surt al desplegable del xip sense recarregar', async ({
  page,
}) => {
  await enterAsNew(page, MEU);
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-scopes"]').click();

  const scopes = (await (
    await page.request.get('/api/v1/scopes', { headers: await bearer(page) })
  ).json()) as {
    id: string;
    name: string;
  }[];
  const scope = scopes[0]!;

  const camp = page.locator(`[data-testid="new-project-${scope.id}"]`);
  await camp.fill('La golfa');
  await page.locator(`[data-testid="new-project-create-${scope.id}"]`).click();

  // Primer surt a la llista d'Ajustos: la mutació ha anat bé.
  await expect(page.getByText('La golfa')).toBeVisible({ timeout: 10_000 });

  // **Navegació de client, cap `page.reload()`**: aquest és el punt de la prova. El
  // desplegable del xip llegeix la llista de projectes de la sessió, i és exactament
  // la còpia que quedava encallada.
  await page.locator('[data-testid="settings-back"]').click();
  await expect(page.locator('[data-testid="inbox-rail"]')).toBeVisible({ timeout: 10_000 });

  const boto = page.locator(`[data-testid="scope-projects-${scope.id}"]`);
  await expect(boto).toBeVisible({ timeout: 10_000 });
  await boto.click();
  await expect(
    page.locator('[data-testid^="scope-project-"]').filter({ hasText: 'La golfa' }),
  ).toBeVisible({ timeout: 10_000 });
});

test("encendre el registre de dedicació fa aparèixer l'entrada del menú sense recarregar", async ({
  page,
}) => {
  await enterAsNew(page, MEU);
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-scopes"]').click();

  const scopes = (await (
    await page.request.get('/api/v1/scopes', { headers: await bearer(page) })
  ).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!;

  await page.locator(`[data-testid="scope-tracking-${scope.id}"]`).click();
  await page.locator(`[data-testid="tracking-on-${scope.id}"]`).click();

  // De sortida d'Ajustos: la còpia que mana el menú s'ha de refrescar sola.
  await page.locator('[data-testid="settings-back"]').click();
  await expect(page.locator('[data-testid="inbox-rail"]')).toBeVisible({ timeout: 10_000 });

  await page.locator('[data-testid="topbar-profile"]').click();
  await expect(page.getByRole('menuitem', { name: 'Registre' })).toBeVisible({
    timeout: 10_000,
  });
});
