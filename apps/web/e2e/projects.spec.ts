/**
 * Projectes i llistes pinejades.
 *
 * Dues coses que el disseny i `docs/02` demanen i que la interfície no acabava de fer:
 * el menú de pinejades ensenyava només noms, i els projectes només es podien crear des
 * del `+` de la barra —el lloc on es va a fer coses, no a configurar-les.
 */

import { expect, test, type Page } from '@playwright/test';
import { enter, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** El seu compte: aquest fitxer crea projectes i llistes, i no ha de moure els d'altri. */
const MEU = {
  name: 'Projectes',
  email: 'projectes@example.com',
  password: 'la-contrasenya-de-prova',
};

async function bearer(page: Page): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await token(page)}` };
}

test("els projectes es creen des d'Ajustos, agrupats per àmbit", async ({ page }) => {
  await enter(page);
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
  await expect(camp).toBeVisible();
  await camp.fill('La reforma');
  await page.locator(`[data-testid="new-project-create-${scope.id}"]`).click();

  // Surt a la llista de l'àmbit on s'ha creat.
  await expect(page.getByText('La reforma')).toBeVisible({ timeout: 10_000 });

  const projects = (await (
    await page.request.get('/api/v1/projects', { headers: await bearer(page) })
  ).json()) as { name: string; scope_id: string }[];
  const creat = projects.find((project) => project.name === 'La reforma');
  expect(creat?.scope_id).toBe(scope.id);
});

/**
 * **El menú de pinejades diu com va cada llista.**
 *
 * El disseny hi posa una segona línia amb el progrés, i és el que fa que serveixi: amb
 * quatre llistes pinejades, els noms sols obliguen a entrar a cadascuna per saber quina
 * té feina pendent.
 */
test('el menú de llistes pinejades ensenya el progrés de cadascuna', async ({ page }) => {
  await enter(page);
  const auth = await bearer(page);

  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
  }[];
  const task = (await (
    await page.request.post('/api/v1/tasks', {
      headers: auth,
      data: { scope_id: scopes[0]!.id, title: 'Amb llista pinejada' },
    })
  ).json()) as { id: string };

  const list = (await (
    await page.request.post(`/api/v1/tasks/${task.id}/checklists`, {
      headers: auth,
      data: { name: 'La maleta' },
    })
  ).json()) as { id: string };

  for (const text of ['Passaport', 'Carregador']) {
    await page.request.post(`/api/v1/checklists/${list.id}/items`, {
      headers: auth,
      data: { text },
    });
  }
  await page.request.post(`/api/v1/checklists/${list.id}/pin`, { headers: auth });

  await page.goto('/');
  const boto = page.locator('[data-testid="topbar-pinned"]');
  await expect(boto).toBeVisible({ timeout: 10_000 });

  // La xinxeta és un SVG i no un emoji: segueix el tema i l'accent com la resta de la barra.
  await expect(boto.locator('svg')).toHaveCount(1);

  await boto.click();
  const item = page.locator(`[data-testid="pinned-${list.id}"]`);
  await expect(item).toBeVisible();
  await expect(item).toContainText('La maleta');
  // Zero de dos: el progrés hi és abans de marcar res.
  await expect(item).toContainText('2');
});

test('i clicar-hi obre la llista', async ({ page }) => {
  await enter(page);
  await page.goto('/');
  await page.locator('[data-testid="topbar-pinned"]').click();
  await page.locator('[data-testid^="pinned-"]').first().click();
  await expect(page.locator('[data-testid="list-screen"]')).toBeVisible({ timeout: 10_000 });
});
