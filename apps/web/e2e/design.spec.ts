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

test.describe.configure({ mode: 'serial' });

const ADMIN = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

async function enter(page: Page): Promise<void> {
  // **Es pregunta al servidor si la porta és oberta**, no es dedueix del que es veu:
  // amb la base buida també hi ha formulari de login.
  const gate = await page.request.get('/api/v1/setup');
  const open = ((await gate.json()) as { open: boolean }).open;

  await page.goto('/');
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  if (open) {
    await page.goto('/setup');
    await page.locator('[data-testid="setup-name"]').fill(ADMIN.name);
    await page.locator('[data-testid="setup-email"]').fill(ADMIN.email);
    await page.locator('[data-testid="setup-password"]').fill(ADMIN.password);
    await page.locator('[data-testid="setup-submit"]').click();
    await expect(page.locator('[data-testid="login"]')).toBeVisible({ timeout: 15_000 });
  }

  await page.locator('[data-testid="login-email"]').fill(ADMIN.email);
  await page.locator('[data-testid="login-password"]').fill(ADMIN.password);
  await page.locator('[data-testid="login-submit"]').click();
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
}

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
function card(page: Page, title: string) {
  return page.locator('[data-testid^="task-"]').filter({ hasText: title }).first();
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

  await card(page, title).locator('[data-testid="card-add-toggle"]').click();
  const field = card(page, title).locator('[data-testid="card-add-item"]');
  await field.fill('Passaport');
  await field.press('Enter');

  // Ara sí: un bloc, el de les subtasques.
  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toContainText('(1)', {
    timeout: 10_000,
  });
});

test('i una llista amb nom, que compta com un bloc a part', async ({ page }) => {
  await enter(page);

  const title = 'Fer la maleta';
  await card(page, title).locator('[data-testid="card-add-toggle"]').click();

  const nom = card(page, title).locator('input').first();
  await nom.fill('Farmaciola');
  const field = card(page, title).locator('[data-testid="card-add-item"]');
  await field.fill('Ibuprofè');
  await field.press('Enter');

  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toContainText('(2)', {
    timeout: 10_000,
  });

  // El nom es queda per poder encadenar ítems a la mateixa llista, i **no en crea una
  // altra d'igual**: escriure dues vegades "Farmaciola" donaria dues llistes bessones.
  await field.fill('Tiretes');
  await field.press('Enter');
  await expect(card(page, title).locator('[data-testid="card-lists-toggle"]')).toContainText('(2)');
});

test('desplegar ensenya els ítems, i marcar-ne un mou el recompte', async ({ page }) => {
  await enter(page);

  const title = 'Fer la maleta';
  await card(page, title).locator('[data-testid="card-lists-toggle"]').click();

  await expect(card(page, title)).toContainText('Passaport');
  await expect(card(page, title)).toContainText('Ibuprofè');
  // L'epígraf distingeix el bloc sense nom dels que en tenen.
  await expect(card(page, title)).toContainText('Subtasques');
  await expect(card(page, title)).toContainText('Farmaciola');

  await expect(card(page, title)).toContainText('0/3');
  await card(page, title).getByRole('checkbox', { name: /Passaport/u }).click();
  await expect(card(page, title)).toContainText('1/3', { timeout: 10_000 });
});
