/**
 * Ajustos ▸ Àmbits, contra el servidor real.
 *
 * Fins avui aquesta pestanya **només llistava i creava**: no es podia reanomenar, ni
 * esborrar, ni triar el color —tots els àmbits creats des d'aquí sortien blaus perquè
 * `--plou-blue` anava cablejat— ni gestionar els membres. Els vuit tokens
 * `--femho-scope-*` existien des del primer dia i no els feia servir ningú.
 *
 * Es prova contra el servidor de debò i no amb dobles: el que ha de valdre és que el
 * color que es tria arribi a la base i torni pintat, no que un component rebi una prop.
 */

import { expect, test, type Page } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

async function openScopes(page: Page): Promise<void> {
  // La pestanya és estat del component, no de la URL: s'hi arriba clicant.
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-scopes"]').click();
  await expect(page.locator('[data-testid="new-scope-name"]')).toBeVisible();
}

test('es crea un àmbit amb el color que es tria, i no blau per defecte', async ({ page }) => {
  await enter(page);
  await openScopes(page);

  await page.locator('[data-testid="new-scope-name"]').fill('Bicicleta');
  await page.locator('[data-testid="new-scope-color---femho-scope-3"]').click();
  await page.locator('[data-testid="new-scope-create"]').click();

  // Ha de sortir a la llista, i el punt ha de portar el token triat i no `--plou-blue`.
  const fila = page.locator('[data-testid^="scope-row-"]', { hasText: 'Bicicleta' });
  await expect(fila).toBeVisible();

  const color = await fila
    .locator('span[aria-hidden="true"]')
    .first()
    .evaluate((node) => {
      return getComputedStyle(node).backgroundColor;
    });
  const blau = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--plou-blue)';
    document.body.append(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  });
  expect(color).not.toBe(blau);
});

test('es reanomena i es canvia el color', async ({ page }) => {
  await enter(page);
  await openScopes(page);

  const fila = page.locator('[data-testid^="scope-row-"]', { hasText: 'Bicicleta' });
  const id = (await fila.getAttribute('data-testid'))!.replace('scope-row-', '');

  await page.locator(`[data-testid="scope-edit-${id}"]`).click();
  await page.locator(`[data-testid="scope-name-${id}"]`).fill('Bici');
  await page.locator(`[data-testid="scope-color-${id}---femho-scope-6"]`).click();
  await page.locator(`[data-testid="scope-save-${id}"]`).click();

  await expect(page.locator('[data-testid^="scope-row-"]', { hasText: 'Bici' })).toBeVisible();
});

test("un àmbit amb tasques no s'esborra, i la pantalla diu quantes en té", async ({ page }) => {
  await enter(page);

  // Una tasca dins de l'àmbit nou, per la via normal.
  await page.goto('/');
  const id = await page.evaluate(async () => {
    const stored = localStorage.getItem('femho.tokens');
    const token =
      stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
    const scopes = (await (
      await fetch('/api/v1/scopes', { headers: { authorization: `Bearer ${token}` } })
    ).json()) as { id: string; name: string }[];
    const scope = scopes.find((s) => s.name === 'Bici')!;
    await fetch('/api/v1/tasks', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope_id: scope.id, title: 'Inflar les rodes' }),
    });
    return scope.id;
  });

  await openScopes(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator(`[data-testid="scope-edit-${id}"]`).click();
  await page.locator(`[data-testid="scope-delete-${id}"]`).click();

  /**
   * **El missatge ha de dir quantes coses queden.** Un "no s'ha pogut esborrar" obliga a
   * endevinar què el bloqueja, i el servidor ja ho sap: el 409 porta el recompte.
   */
  const error = page.locator(`[data-testid="scope-error-${id}"]`);
  await expect(error).toBeVisible();
  await expect(error).toContainText('1');
});

/**
 * Les tres portes per fer un àmbit.
 *
 * Es va demanar que en crear-ne un es pugui fer de nou, o sincronitzar-lo amb un que ja
 * existeix —d'aquest servidor amb un token, o d'un altre amb l'adreça i el token—. El que
 * es comprova aquí és **que siguin una sola pantalla**: un commutador i els camps que
 * calen, i no tres llocs on s'hagi de saber d'entrada quin es vol.
 */
test('en crear un àmbit hi ha tres portes, i cadascuna demana el que li cal', async ({ page }) => {
  await enter(page);
  await openScopes(page);

  const font = page.locator('[data-testid="new-scope-source"]');
  await expect(font).toBeVisible();

  // De nou: nom i color, res de tokens.
  await expect(page.locator('[data-testid="new-scope-name"]')).toBeVisible();
  await expect(page.locator('[data-testid="new-scope-token"]')).toHaveCount(0);

  // D'aquest servidor: només el token, que és tot el que cal.
  await font.getByRole('button').nth(1).click();
  await expect(page.locator('[data-testid="new-scope-token"]')).toBeVisible();
  await expect(page.locator('[data-testid="new-scope-server"]')).toHaveCount(0);

  // D'un altre: l'adreça també.
  await font.getByRole('button').nth(2).click();
  await expect(page.locator('[data-testid="new-scope-server"]')).toBeVisible();
  await expect(page.locator('[data-testid="new-scope-token"]')).toBeVisible();
});

/**
 * **I `http:` es rebutja amb un motiu, no amb un silenci.** El token de federació viatjaria
 * en clar, i qui el llegís pel camí tindria accés escrivible a l'àmbit.
 */
test('una adreça en text pla es rebutja i la pantalla ho diu', async ({ page }) => {
  await enter(page);
  await openScopes(page);

  await page.locator('[data-testid="new-scope-source"]').getByRole('button').nth(2).click();
  await page.locator('[data-testid="new-scope-server"]').fill('http://exemple.org');
  await page.locator('[data-testid="new-scope-token"]').fill('femho_inv_qualsevolcosa');
  await page.locator('[data-testid="new-scope-create"]').click();

  await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
});
