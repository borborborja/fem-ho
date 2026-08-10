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

/**
 * `#Àmbit/Projecte` a l'afegida ràpida, **a l'app de debò**.
 *
 * Ja hi havia una prova d'això, i va contra `/proof/quickadd`: una pàgina de mostra amb
 * àmbits i projectes inventats. Allò comprova el parser i el component, que és el que ha
 * de comprovar. El que no diu ningú és que **el tauler real hi passi els seus projectes**
 * i que la tasca acabi de debò dins d'aquell projecte al servidor: entre les dues coses
 * hi ha el context que munta `BoardScreen`, que és codi que es pot trencar sol.
 */
test("l'afegida ràpida encamina a #Àmbit/Projecte amb dades reals", async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);

  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
    name: string;
  }[];
  const scope = scopes[0]!;
  const projects = (await (
    await page.request.get(`/api/v1/projects?scope_id=${scope.id}`, { headers: auth })
  ).json()) as { id: string; name: string; scope_id: string }[];
  const obra = projects.find((project) => project.name === 'Obra')!;

  await page.goto(`/board?scopes=${scope.id}`);
  const field = page.locator('[data-testid="quick-add-inbox"] input[role="combobox"]');
  await field.fill(`#${scope.name}/Obra Canviar la caldera`);
  // Escape tanca el desplegable de suggeriments sense esborrar el que s'ha escrit.
  await field.press('Escape');
  await field.press('Enter');

  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Canviar la caldera', {
    timeout: 10_000,
  });

  // I al servidor hi és amb el projecte posat, no només amb el títol net.
  // `GET /tasks` torna una pàgina (`data`, `next_cursor`, `has_more`), no una llista.
  const page1 = (await (
    await page.request.get(`/api/v1/tasks?scope_id=${scope.id}`, { headers: auth })
  ).json()) as { data: { title: string; project_id: string | null }[] };
  const creada = page1.data.find((task) => task.title === 'Canviar la caldera');
  expect(creada?.project_id).toBe(obra.id);
});

/**
 * **"Nou projecte" ha de portar on es fan els projectes.**
 *
 * El menú `+` deia això i portava a Ajustos i prou: la persona queia a "General" i havia
 * de trobar sola que els projectes són a "Àmbits".
 */
test('el menú + porta directament on es creen els projectes', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.goto('/');

  await page.locator('[data-testid="topbar-add"]').click();
  await page.getByRole('menuitem').first().click();

  // Hi som, i el camp de crear-ne un hi és sense haver de clicar res més.
  await expect(page.locator('[data-testid="settings-tab-scopes"]')).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.locator('[data-testid^="new-project-"]').first()).toBeVisible();
});

/**
 * El grup de xip a mòbil.
 *
 * El botonet va **enganxat** al xip i tots dos han de continuar sent tocables: 44px de
 * costat és el mínim que `docs/02` §10 demana, i un control de 20px al costat d'un de
 * gran és el que fa que a mòbil s'acabi tocant el que no volies.
 */
test.describe('a mòbil', () => {
  test.use({ viewport: { width: 380, height: 760 } });

  test('el botonet de projectes segueix sent tocable', async ({ page }) => {
    await enterAsNew(page, MEU);
    const auth = await bearer(page);
    const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
      id: string;
    }[];
    const scope = scopes[0]!;

    await page.goto(`/board?scopes=${scope.id}`);
    const boto = page.locator(`[data-testid="scope-projects-${scope.id}"]`);
    await expect(boto).toBeVisible({ timeout: 10_000 });

    const caixa = await boto.boundingBox();
    expect(caixa?.height ?? 0).toBeGreaterThanOrEqual(44);

    // I obre el desplegable sense que el clic caigui al xip i apagui l'àmbit.
    await boto.click();
    await expect(page.locator(`[data-testid="scope-projects-${scope.id}-all"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="scope-${scope.id}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

/**
 * Esborrar un projecte **que està filtrant**.
 *
 * És el cas que deixa una interfície en un estat que ningú ha triat: la tria viu a la URL
 * i el projecte deixa d'existir. Si el tauler seguís filtrant per un identificador mort,
 * amagaria tasques sense cap control a la vista que ho expliqui — el mateix defecte que
 * el commutador de la bústia va tenir.
 */
test('esborrar un projecte filtrat no deixa el tauler amagant tasques', async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);

  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!;

  const efimer = (await (
    await page.request.post('/api/v1/projects', {
      headers: auth,
      data: { scope_id: scope.id, name: 'Efímer' },
    })
  ).json()) as { id: string };

  await page.request.post('/api/v1/tasks', {
    headers: auth,
    data: { scope_id: scope.id, project_id: efimer.id, title: 'Dins del que marxa' },
  });

  await page.goto(`/board?scopes=${scope.id}&projects=${efimer.id}`);
  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText('Dins del que marxa', { timeout: 10_000 });

  // El projecte se'n va; les seves tasques es queden a l'àmbit, sense projecte.
  await page.request.delete(`/api/v1/projects/${efimer.id}`, { headers: auth });
  await page.reload();

  // El tauler NO es queda buit filtrant per un identificador que ja no vol dir res.
  await expect(rail).toContainText('Dins del que marxa', { timeout: 10_000 });
  // I el botonet ja no compta el que no existeix.
  const boto = page.locator(`[data-testid="scope-projects-${scope.id}"]`);
  await expect(boto).not.toContainText('1');
});

/**
 * **Del desplegable se n'ha de poder sortir sense triar res.**
 *
 * Els menús de la barra es tanquen amb `Escape` i amb clic a fora (`docs/02` §3), i el
 * del xip és un menú més: si en quedés fora, seria l'únic de la barra que t'obliga a
 * decidir alguna cosa per marxar.
 */
test('el desplegable del xip es tanca amb Escape i amb clic a fora', async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!;

  await page.goto(`/board?scopes=${scope.id}`);
  const boto = page.locator(`[data-testid="scope-projects-${scope.id}"]`);
  const menu = page.locator(`[data-testid="scope-projects-${scope.id}-all"]`);

  await boto.click();
  await expect(menu).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  await boto.click();
  await expect(menu).toBeVisible();
  await page.locator('[data-testid="inbox-rail"]').click({ position: { x: 5, y: 5 } });
  await expect(menu).toHaveCount(0);
});

/**
 * **La sintaxi `#Àmbit/Projecte` s'ha de poder descobrir escrivint.**
 *
 * Que el parser l'entengui no serveix de res si ningú sap que existeix: qui escriu `#` ha
 * de veure que després de l'àmbit hi pot anar una barra. El desplegable ho ensenya llistant
 * els projectes amb el nom sencer, i filtrant-los quan escrius la barra.
 */
test("escrivint #Àmbit/ es veuen els projectes d'aquell àmbit", async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
    name: string;
  }[];
  const scope = scopes[0]!;

  await page.goto(`/board?scopes=${scope.id}`);
  const field = page.locator('[data-testid="quick-add-inbox"] input[role="combobox"]');

  // Amb el sigil sol, l'àmbit i els seus projectes hi són tots.
  await field.fill('#');
  const opcions = page.getByRole('option');
  await expect(opcions.filter({ hasText: `${scope.name}/Obra` })).toBeVisible({ timeout: 10_000 });

  // I amb la barra, només els projectes d'aquell àmbit.
  await field.fill(`#${scope.name}/`);
  await expect(opcions.filter({ hasText: `${scope.name}/Obra` })).toBeVisible();
  await expect(opcions.filter({ hasText: `${scope.name}/Jardí` })).toBeVisible();
  // L'àmbit sol ja no és una opció: la barra diu que vols un projecte.
  await expect(opcions.filter({ hasText: new RegExp(`^${scope.name}$`, 'u') })).toHaveCount(0);
});

/**
 * **Un àmbit apagat no ofereix filtre de projectes.**
 *
 * Les seves tasques no són al tauler, o sigui que el desplegable s'obria, es podia marcar
 * el que fos i no canviava res. Un botó que no fa res ensenya a ignorar la barra — que és
 * el motiu pel qual es va treure el desplegable global. Android ja ho feia així i la web
 * no: dues regles per al mateix control.
 */
test('un àmbit apagat no ensenya el botonet de projectes', async ({ page }) => {
  await enterAsNew(page, MEU);
  const auth = await bearer(page);
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: auth })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!;

  // Amb l'àmbit encès, el botonet hi és.
  await page.goto(`/board?scopes=${scope.id}`);
  await expect(page.locator(`[data-testid="scope-projects-${scope.id}"]`)).toBeVisible({
    timeout: 10_000,
  });

  // Un altre àmbit, sense projectes, actiu: el primer queda apagat i el botonet se'n va.
  const altre = (await (
    await page.request.post('/api/v1/scopes', {
      headers: auth,
      data: { name: 'Un altre', color: '--femho-scope-8' },
    })
  ).json()) as { id: string };

  await page.goto(`/board?scopes=${altre.id}`);
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
  await expect(page.locator(`[data-testid="scope-projects-${scope.id}"]`)).toHaveCount(0);
});
