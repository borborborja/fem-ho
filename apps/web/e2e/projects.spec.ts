/**
 * Projectes i llistes pinejades.
 *
 * Dues coses que el disseny i `docs/02` demanen i que la interfície no acabava de fer:
 * el menú de pinejades ensenyava només noms, i els projectes només es podien crear des
 * del `+` de la barra —el lloc on es va a fer coses, no a configurar-les.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/**
 * **El seu compte.** Pinejar és una cosa **per usuari** (`checklists.pinned`, `docs/01`),
 * i aquest fitxer en pineja una: amb el compte compartit, la barra de tothom es trobaria
 * un botó de pinejades que no hi era. La regla és la de sempre — qui muta estat d'usuari
 * es fa el seu.
 */
const MEU = {
  name: 'Projectes',
  email: 'projectes@example.com',
  password: 'la-contrasenya-de-prova',
};

async function bearer(page: Page): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await token(page)}` };
}

test("els projectes es creen des d'Ajustos, agrupats per àmbit", async ({ page }) => {
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
  await enterAsNew(page, MEU);
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
  await enterAsNew(page, MEU);
  await page.goto('/');
  await page.locator('[data-testid="topbar-pinned"]').click();
  await page.locator('[data-testid^="pinned-"]').first().click();
  await expect(page.locator('[data-testid="list-screen"]')).toBeVisible({ timeout: 10_000 });
});

/**
 * El filtre de projectes, **al xip de l'àmbit**.
 *
 * Abans era un desplegable a la dreta de tots els xips: triava **un** projecte, sortia
 * encara que no n'hi hagués cap, i estava lluny de l'àmbit que filtra. Ara el botonet és
 * a cada xip, se'n poden marcar diversos, i només surt si aquell àmbit en té.
 */
test('el filtre de projectes és a cada xip, i en filtra el kanban', async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);

  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!;

  const projects: Record<string, string> = {};
  for (const name of ['Obra', 'Jardí']) {
    const created = (await (
      await page.request.post('/api/v1/projects', {
        headers: auth,
        data: { scope_id: scope.id, name },
      })
    ).json()) as { id: string };
    projects[name] = created.id;
  }

  for (const [name, title] of [
    ['Obra', 'Trucar al paleta'],
    ['Jardí', 'Podar la figuera'],
  ] as const) {
    await page.request.post('/api/v1/tasks', {
      headers: auth,
      data: { scope_id: scope.id, project_id: projects[name], title },
    });
  }
  // I una sense projecte, que és el cas que decideix si el filtre es fa bé.
  await page.request.post('/api/v1/tasks', {
    headers: auth,
    data: { scope_id: scope.id, title: 'Sense projecte' },
  });

  await page.goto(`/board?scopes=${scope.id}`);
  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText('Trucar al paleta', { timeout: 10_000 });

  // **El selector global ja no hi és.**
  await expect(page.locator('[data-testid="project-filter"]')).toHaveCount(0);

  const boto = page.locator(`[data-testid="scope-projects-${scope.id}"]`);
  await expect(boto).toBeVisible();
  await boto.click();

  await page.locator(`[data-testid="scope-project-${projects['Obra']}"]`).click();
  await expect(rail).toContainText('Trucar al paleta');
  await expect(rail).not.toContainText('Podar la figuera');
  // Una tasca sense projecte d'un àmbit amb tria **no** hi és.
  await expect(rail).not.toContainText('Sense projecte');

  // El menú no s'ha tancat: triar-ne dos són dos clics, no dos clics i dues reobertures.
  await page.locator(`[data-testid="scope-project-${projects['Jardí']}"]`).click();
  await expect(rail).toContainText('Trucar al paleta');
  await expect(rail).toContainText('Podar la figuera');

  // "Tots" buida la tria de l'àmbit i torna la de sense projecte.
  await page.locator(`[data-testid="scope-projects-${scope.id}-all"]`).click();
  await expect(rail).toContainText('Sense projecte');
});

test('la tria viu a la URL i sobreviu a una recàrrega', async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!;
  const projects = (await (
    await page.request.get(`/api/v1/projects?scope_id=${scope.id}`, { headers: auth })
  ).json()) as { id: string; name: string; scope_id: string }[];
  const obra = projects.find((project) => project.name === 'Obra')!;

  await page.goto(`/board?scopes=${scope.id}&projects=${obra.id}`);
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Trucar al paleta', {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Podar la figuera');

  await page.reload();
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Podar la figuera', {
    timeout: 10_000,
  });
});

/** Un desplegable buit és una promesa que no es compleix. */
test('un àmbit sense projectes no ensenya el botonet', async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);
  /**
   * Un àmbit acabat de fer, sense res a dins.
   *
   * Es crea aquí i no es reaprofita cap dels que hi ha: un compte nou en té **un** de sol
   * —els tres inicials són del primer administrador— i aquell ja té projectes de les
   * proves d'abans.
   */
  const buit = (await (
    await page.request.post('/api/v1/scopes', {
      headers: auth,
      data: { name: 'Sense res', color: '--femho-scope-7' },
    })
  ).json()) as { id: string };

  await page.goto(`/board?scopes=${buit.id}`);
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
  await expect(page.locator(`[data-testid="scope-projects-${buit.id}"]`)).toHaveCount(0);
});

/**
 * **El botó hi és sempre, i el buit diu on es pinegen** (`docs/14` P8).
 *
 * Amagar-lo quan no n'hi ha cap sembla net i té un problema: pinejar no es descobreix
 * enlloc. Aquesta prova fa servir un compte acabat de fer, que és exactament qui es troba
 * la funció per primera vegada.
 */
test('sense cap llista pinejada, el botó hi és i diu on es pinegen', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Sense pinejar',
    email: 'sensepinejar@example.com',
    password: 'la-contrasenya-de-prova',
  });

  const boto = page.locator('[data-testid="topbar-pinned"]');
  await expect(boto).toBeVisible({ timeout: 10_000 });
  // El recompte NO hi és: un zero al costat de la xinxeta repetiria amb un número el que
  // el text ja diu.
  await expect(boto).not.toContainText('0');

  await boto.click();
  await expect(page.locator('[data-testid="pinned-empty"]')).toBeVisible();
  await expect(page.locator('[data-testid="pinned-empty"]')).toContainText(/tasca/iu);
});
