/**
 * El que el disseny validat va afegir al tauler, contra el servidor real.
 *
 * Són tres gestos que abans no existien i que cap altra prova mira: l'afegida ràpida
 * viu **al peu de cada columna** i crea a la seva, el botó rodó del costat obre el
 * formulari sencer, i les subtasques i les llistes es despleguen i s'afegeixen **des de
 * la targeta** sense obrir-la.
 *
 * Va contra el servidor de veritat i no contra dades fixes: el que es vol comprovar és
 * justament que la targeta plegada sap que té llistes sense haver-les demanat, i això
 * depèn d'un agregat que només existeix a la resposta del tauler.
 */

import { expect, test, type Page } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** Escriu al peu d'una columna i prem Enter. Torna el títol perquè el pugui buscar. */
async function quickAdd(page: Page, status: string, title: string): Promise<string> {
  const scope = await page.locator('[data-testid="scope-chips"] button').first().innerText();
  const field = page.locator(`[data-testid="quick-add-${status}"] input[role="combobox"]`);
  await field.fill(`#${scope} ${title}`);
  // El desplegable d'autocompletat tapa el camp; Escape el tanca sense esborrar res.
  await field.press('Escape');
  await field.press('Enter');
  return title;
}

/** La targeta d'una tasca, buscada pel títol. */
/**
 * Una targeta del tauler.
 *
 * **Es busca dins d'una columna, i no a la pàgina sencera.** `[data-testid^="task-"]` casa
 * també amb `task-modal`, `task-assignees` i `task-cancel`: quan el modal encara no s'ha
 * acabat de tancar, el `.first()` agafava el modal —que conté el títol— i llavors la prova
 * esperava trenta segons un botó de targeta dins d'un diàleg. Semblava una prova que falla
 * per càrrega i era un selector que casa amb massa coses.
 */
function card(page: Page, title: string) {
  return page
    .locator('[data-column-status] [data-testid^="task-"]')
    .filter({ hasText: title })
    .first();
}

/**
 * Les accions de la cantonada **surten en passar-hi per sobre** (disseny validat).
 *
 * Mentre no s'hi passa no reben el ratolí, a posta: un botó invisible que igualment es
 * pot clicar és una trampa. Per això les proves fan el mateix gest que una persona —
 * primer el ratolí sobre la targeta, després el clic.
 */
async function cardAction(page: Page, title: string, testId: string) {
  await card(page, title).hover();
  return card(page, title).locator(`[data-testid="${testId}"]`);
}

test('cada columna té la seva afegida ràpida, i crea a la seva columna', async ({ page }) => {
  await enter(page);

  await quickAdd(page, 'todo', 'Pintar el rebedor');

  await expect(page.locator('[data-column-status="todo"]')).toContainText('Pintar el rebedor', {
    timeout: 10_000,
  });
  // I NO a la bústia: si el peu de la columna creés sempre a l'inbox, el gest seria una
  // mentida i això és el que ho veuria.
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Pintar el rebedor');
});

test("el botó rodó del costat obre el formulari sencer, ja a la columna d'on surt", async ({
  page,
}) => {
  await enter(page);

  await page.locator('[data-testid="full-edit-doing"]').click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();

  // I es pot tancar sense deixar res creat.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="task-modal"]')).toHaveCount(0);
});

test("l'Inbox també en té: és l'entrada de tot", async ({ page }) => {
  await enter(page);

  await quickAdd(page, 'inbox', 'Mirar el pressupost');
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Mirar el pressupost', {
    timeout: 10_000,
  });
});

test('des de la targeta es pot afegir una subtasca sense obrir-la', async ({ page }) => {
  await enter(page);

  const title = await quickAdd(page, 'todo', 'Fer la maleta');
  await expect(card(page, title)).toBeVisible({ timeout: 10_000 });

  // Sense res a dins, no hi ha commutador: no hi hauria res a desplegar.
  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toHaveCount(0);

  // Sense passar-hi el ratolí, el botó d'afegir no hi és per a ningú.
  await expect(card(page, title).locator('[data-testid="card-add-toggle"]')).toHaveCSS(
    'opacity',
    '0',
  );

  await (await cardAction(page, title, 'card-add-toggle')).click();
  const field = card(page, title).locator('[data-testid="card-add-item"]');
  await field.fill('Passaport');
  await field.press('Enter');

  // Ara sí: un bloc, el de les subtasques.
  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toContainText(
    '(1)',
    {
      timeout: 10_000,
    },
  );
});

test('i una llista amb nom, que compta com un bloc a part', async ({ page }) => {
  await enter(page);

  const title = 'Fer la maleta';
  await (await cardAction(page, title, 'card-add-toggle')).click();

  // **Un sol camp**: `#Llista element` va a la llista, sense sigil és una subtasca.
  const field = card(page, title).locator('[data-testid="card-add-item"]');
  await field.fill('#Farmaciola Ibuprofè');
  await field.press('Enter');

  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toContainText(
    '(2)',
    {
      timeout: 10_000,
    },
  );

  // I escriure el mateix nom una segona vegada **no crea una llista bessona**.
  await field.fill('#Farmaciola Tiretes');
  await field.press('Enter');
  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toContainText('(2)');
});

test('desplegar ensenya els ítems, i marcar-ne un mou el recompte', async ({ page }) => {
  await enter(page);

  const title = 'Fer la maleta';
  await card(page, title).locator('[data-testid="card-lists-toggle"]').click();

  await expect(card(page, title)).toContainText('Passaport');
  await expect(card(page, title)).toContainText('Ibuprofè');
  // Les subtasques van nues; la llista amb nom, en caixa amb el seu nom.
  await expect(card(page, title)).toContainText('Farmaciola');

  await expect(card(page, title)).toContainText('0/3');
  await card(page, title)
    .getByRole('checkbox', { name: /Passaport/u })
    .click();
  await expect(card(page, title)).toContainText('1/3', { timeout: 10_000 });
});

/**
 * **Assignar només té sentit a la bústia d'un àmbit col·lectiu.**
 *
 * A un àmbit individual no hi ha ningú més; i un cop la tasca surt de la bústia, ja és
 * de qui la fa. El disseny validat treu el camp als dos casos.
 */
test('el camp de persones no surt a un àmbit individual', async ({ page }) => {
  await enter(page);

  await page.locator('[data-testid="inbox-rail"]').getByText('Mirar el pressupost').first().click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="task-assignees"]')).toHaveCount(0);
  await page.locator('[data-testid="task-cancel"]').click();
  await expect(page.locator('[data-testid="task-modal"]')).toHaveCount(0);
});

test('i a un de col·lectiu, només mentre la tasca és a la bústia', async ({ page }) => {
  await enter(page);

  // Un àmbit col·lectiu nou: els tres del primer arrencament són individuals.
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-scopes"]').click();
  // Sense espais: l'afegida ràpida només parseja sigils sense espai (D12), i un àmbit
  // que se'n digués "Pis compartit" no es podria escriure amb `#`.
  await page.locator('[data-testid="new-scope-name"]').fill('Pis');
  await page.locator('[data-testid="new-scope-kind-collective"]').click();
  await page.locator('[data-testid="new-scope-create"]').click();

  await page.goto('/');
  await expect(page.locator('[data-testid="scope-chips"]')).toContainText('Pis');

  const field = page.locator('[data-testid="quick-add-inbox"] input[role="combobox"]');
  await field.fill('#Pis Buidar la nevera');
  await field.press('Escape');
  await field.press('Enter');

  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText('Buidar la nevera', { timeout: 10_000 });
  await rail.getByText('Buidar la nevera').first().click();
  await expect(page.locator('[data-testid="task-assignees"]')).toBeVisible();
  await page.locator('[data-testid="task-cancel"]').click();
  await expect(page.locator('[data-testid="task-modal"]')).toHaveCount(0);

  // I en sortir de la bústia, el camp desapareix: ja és de qui la fa.
  await card(page, 'Buidar la nevera')
    .getByRole('button', { name: /Per fer/u })
    .click();
  await expect(page.locator('[data-column-status="todo"]')).toContainText('Buidar la nevera', {
    timeout: 10_000,
  });

  await card(page, 'Buidar la nevera').getByText('Buidar la nevera').click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="task-assignees"]')).toHaveCount(0);
});

/**
 * El llapis d'editar, a la cantonada i **només en passar-hi per sobre**.
 *
 * El disseny validat el va treure de la columna esquerra de la targeta i el va posar
 * amb els altres dos a dalt a la dreta, amagats fins que hi passes. Amb el teclat també
 * s'hi ha d'arribar: qui tabula no té ratolí, i si el llapis només existís amb el
 * cursor a sobre, hi hauria una acció que no es pot fer sense.
 */
test('el llapis surt en passar-hi per sobre i obre el modal', async ({ page }) => {
  await enter(page);

  const title = 'Pintar el rebedor';
  const pencil = card(page, title).locator('[data-testid="card-edit"]');
  await expect(pencil).toHaveCSS('opacity', '0');

  await card(page, title).hover();
  await expect(pencil).toHaveCSS('opacity', '1');

  await pencil.click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
  await page.locator('[data-testid="task-cancel"]').click();
});

test('i amb el teclat també, sense ratolí', async ({ page }) => {
  await enter(page);

  const title = 'Pintar el rebedor';
  const pencil = card(page, title).locator('[data-testid="card-edit"]');
  await expect(pencil).toHaveCSS('opacity', '0');

  await pencil.focus();
  await expect(pencil).toHaveCSS('opacity', '1');
});

/**
 * **Res del que flota pot ser translúcid en tema fosc.**
 *
 * `--card-bg` és, en tema fosc, un vel blanc del 6%: està fet per posar-se damunt d'una
 * superfície opaca, no per ser-ne una. Com a fons del modal d'edició deixava veure el
 * tauler a través i **l'editor no es podia fer servir**. El mateix token estava a la
 * paleta d'ordres, al diàleg de compartir i als dos desplegables de la barra.
 *
 * La prova mira el símptoma i no el token: quin color efectiu té el panell. Un
 * `rgba(...)` amb alfa per sota d'1 és exactament el que es veia malament.
 */
async function alphaOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((node) => {
    const colour = getComputedStyle(node).backgroundColor;
    const match = /^rgba?\(([^)]+)\)$/u.exec(colour);
    if (match === null) return 0;
    const parts = match[1]!.split(',').map((part) => Number(part.trim()));
    return parts.length < 4 ? 1 : (parts[3] ?? 1);
  });
}

test('en tema fosc, el modal i la paleta són opacs', async ({ page }) => {
  await enter(page);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

  /**
   * S'obre clicant **la targeta** i no el llapis.
   *
   * El que aquesta prova mira és l'opacitat del modal i de la paleta, no com s'obren. El
   * llapis només existeix mentre el ratolí és a sobre, i mesurant-ho es va veure que en
   * una passada sencera arribava a no estar revelat en el moment del clic: la targeta es
   * refà i, com que el cursor ja hi és a dins, no torna a arribar cap `mouseenter`. Res
   * no el tapava. La targeta sencera obre el mateix modal i no depèn de cap estat de
   * ratolí. Qui vulgui provar el llapis, ja té la seva prova a "el llapis surt en
   * passar-hi per sobre i obre el modal".
   */
  const card = page.locator('[data-column-status] [data-testid^="task-"]').first();
  await card.click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();

  // El panell és el fill del vel: el vel sí que ha de ser translúcid, el panell no.
  expect(await alphaOf(page, '[data-testid="task-modal"] > div')).toBe(1);
  await page.locator('[data-testid="task-cancel"]').click();

  await page.keyboard.press('Control+k');
  await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
  expect(await alphaOf(page, '[data-testid="command-palette"] > div')).toBe(1);
});
