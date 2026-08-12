/**
 * La lent monoàmbit.
 *
 * Fem-ho posa els **àmbits** a la barra com el primer eix de navegació. Per a qui fa servir
 * l'eina per a una sola cosa —la seva feina, la seva empresa petita— això és una barra amb
 * un sol xip que no fa res, i el que li caldria a dalt són els **projectes**.
 *
 * **És una lent i no un model de dades diferent**: tota tasca segueix vivint dins d'un
 * àmbit. El que canvia és què posa la barra al davant, i per això això es prova aquí i no
 * al servidor: el que hi ha per comprovar és el que es veu.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Monoambit',
  email: 'monoambit@example.com',
  password: 'la-contrasenya-de-prova',
};

async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<string> {
  return page.evaluate(
    async ([method, path, body]) => {
      const stored = localStorage.getItem('femho.tokens');
      const token =
        stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
      const res = await fetch(path as string, {
        method: method as string,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      return res.text();
    },
    [method, path, body ?? null] as const,
  );
}

test('en monoàmbit la barra ensenya projectes, i el selector només si cal', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.setViewportSize({ width: 1440, height: 900 });

  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  for (const name of ['Obres', 'Clients']) {
    await apiCall(page, 'POST', '/api/v1/projects', { scope_id: scopes[0]!.id, name });
  }
  await apiCall(page, 'PATCH', '/api/v1/auth/settings', { scope_mode: 'single' });
  await page.reload();

  // Els projectes són el primer eix; els àmbits no hi són.
  await expect(page.getByTestId('project-chips')).toBeVisible();
  await expect(page.getByTestId('scope-chips')).toHaveCount(0);
  await expect(page.getByTestId('project-chips')).toContainText('Obres');

  /**
   * **Amb un sol àmbit, cap selector.** Un desplegable amb una sola opció és un control que
   * no fa res: ocupa lloc, convida a obrir-lo i no hi ha res a triar.
   */
  await expect(page.getByTestId('scope-picker')).toHaveCount(0);

  /**
   * I **el camp d'afegida deixa de demanar `#Àmbit` sol**. No hi ha cap regla nova: ja
   * decideix el marcador segons quants àmbits hi ha actius, i en monoàmbit sempre n'hi ha
   * un. És el senyal que la lent és la mateixa app i no una segona.
   */
  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  await expect(camp).toHaveAttribute('placeholder', /^\+ Afegir a Per fer…$/u);
});

test('amb un segon àmbit apareix el selector, i canviar-lo canvia on ets', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.setViewportSize({ width: 1440, height: 900 });
  await apiCall(page, 'POST', '/api/v1/scopes', {
    name: 'Casa',
    kind: 'individual',
    color: '--plou-pink',
  });
  await page.reload();

  const selector = page.getByTestId('scope-picker');
  await expect(selector).toBeVisible();

  // Triar-ne un altre ho escriu a l'adreça: el que es mira ha de sobreviure a una recàrrega.
  const casa = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as {
    id: string;
    name: string;
  }[];
  const altre = casa.find((scope) => scope.name === 'Casa')!;
  await selector.selectOption(altre.id);
  await expect.poll(() => new URL(page.url()).searchParams.get('scopes')).toBe(altre.id);

  // I n'hi ha **un**, no dos: en monoàmbit s'està en un àmbit i prou.
  expect(new URL(page.url()).searchParams.get('scopes')?.split(',')).toHaveLength(1);
});

test('en multiàmbit tot es queda com era', async ({ page }) => {
  /**
   * El defecte no canvia per a ningú: qui ja fa servir l'app no s'ha de trobar la barra
   * canviada un matí. Aquesta prova és la que ho vigila.
   */
  await enterAsNew(page, {
    name: 'Multi',
    email: 'multiambit@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.goto('/');

  await expect(page.getByTestId('scope-chips')).toBeVisible();
  await expect(page.getByTestId('project-chips')).toHaveCount(0);
  await expect(page.getByTestId('scope-picker')).toHaveCount(0);
});
