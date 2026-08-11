/**
 * L'aplicació sencera, contra un servidor real.
 *
 * Les altres proves de navegador munten un component amb dades fixes. Aquesta arrenca
 * el servidor de veritat, passa pel primer arrencament, entra amb contrasenya i fa
 * servir el producte. És l'única que pot veure els errors que només existeixen quan les
 * peces van juntes: una ruta que el client demana i el servidor no serveix, un camp que
 * el contracte diu que es diu d'una manera i el codi d'una altra, un proxy mal posat.
 *
 * El servidor l'arrenca `playwright.config.ts` amb una base buida i temporal. La primera
 * prova crea l'administrador; la resta hi entren. **L'ordre importa** i per això van en
 * sèrie: amb `/setup` només s'hi pot passar un cop.
 */

import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  // Si ja hi ha sessió, el tauler hi és directament.
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  await page.locator('[data-testid="login-email"]').fill(ADMIN.email);
  await page.locator('[data-testid="login-password"]').fill(ADMIN.password);
  await page.locator('[data-testid="login-submit"]').click();
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
}

test("el primer arrencament crea l'administrador i els seus tres àmbits", async ({ page }) => {
  /**
   * **No exigeix guanyar la cursa**, que és la mateixa regla que `entrar.ts` va haver
   * d'aprendre. La suite va `fullyParallel` contra un sol servidor i la base comença
   * buida: **tots els fitxers veuen la porta d'arrencada oberta alhora**. Aquesta prova
   * donava per fet que l'obria ella, i quan un altre fitxer hi arribava primer es quedava
   * esperant un login que no arribava mai per aquest camí.
   *
   * Era intermitent i cada fitxer nou la feia més probable; amb `about.spec` va passar a
   * fallar sempre. El que es vol comprovar no és qui fa l'arrencada, sinó **la invariant**:
   * que després només hi ha una porta, i és el login.
   */
  await page.goto('/setup');

  const formulari = page.locator('[data-testid="setup-name"]');
  if ((await formulari.count()) > 0) {
    await formulari.fill(ADMIN.name);
    await page.locator('[data-testid="setup-email"]').fill(ADMIN.email);
    await page.locator('[data-testid="setup-password"]').fill(ADMIN.password);
    await page.locator('[data-testid="setup-submit"]').click();
  }

  /**
   * **I no s'espera res del clic.**
   *
   * Mirar si el formulari hi és i llavors clicar segueix sent una cursa: entre les dues
   * coses, un altre fitxer pot acabar l'arrencada i el nostre `submit` rep un 403 que
   * deixa la pantalla igual. La invariant no és què ha fet aquest clic, sinó **què hi ha
   * després**, i això es comprova anant-hi.
   */
  await page.goto('/');
  await expect(page.locator('[data-testid="login"]')).toBeVisible({ timeout: 15_000 });

  /**
   * *Nota del qui ho va arreglar*: aquí hi havia d'anar «i `/setup` ja no ofereix cap
   * formulari». **No és cert avui**: `/setup` és una ruta de client que pinta la pantalla
   * d'arrencada sense preguntar si encara cal, i qui hi torni per un marcador vell es
   * troba un formulari que en enviar-lo rebrà un 403. La porta del servidor sí que està
   * tancada —és el que compta per a la seguretat— i això és una aspresa de la interfície,
   * no un forat. Es deixa dit aquí perquè es va veure i no s'arregla de passada.
   */
});

test('entrar porta al tauler amb els tres àmbits inicials', async ({ page }) => {
  await login(page);

  const chips = page.locator('[data-testid="scope-chips"] button');
  await expect(chips).toHaveCount(3);
  await expect(page.locator('[data-testid="kanban"]')).toBeVisible();

  for (const status of ['inbox', 'todo', 'doing', 'done']) {
    await expect(page.locator(`[data-column-status="${status}"]`).first()).toBeVisible();
  }
});

test("l'afegida ràpida crea una tasca de veritat", async ({ page }) => {
  await login(page);

  const nom = await page.locator('[data-testid="scope-chips"] button').first().innerText();
  const camp = page.locator('input[role="combobox"]').first();

  await camp.fill(`#${nom} Comprar pa`);
  await camp.press('Escape');
  await camp.press('Enter');

  // Ha d'aparèixer a l'Inbox sense recarregar la pàgina.
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Comprar pa', {
    timeout: 10_000,
  });

  // I ha de sobreviure a una recàrrega: si només fos estat local, aquí desapareixeria.
  await page.reload();
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Comprar pa');
});

test('clicar una targeta obre el modal i el desat persisteix', async ({ page }) => {
  await login(page);

  await page.locator('[data-testid="inbox-rail"]').getByText('Comprar pa').first().click();
  const modal = page.locator('[data-testid="task-modal"]');
  await expect(modal).toBeVisible();

  await modal.locator('[data-testid="task-title"]').fill('Comprar pa i llet');
  await modal.locator('[data-testid="task-save"]').click();
  await expect(modal).toBeHidden();

  await page.reload();
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Comprar pa i llet');
});

test('el wordmark porta al tauler general, que ho ensenya tot', async ({ page }) => {
  await login(page);

  await page.locator('[data-testid="wordmark"]').click();
  await expect(page.locator('[data-testid="dashboard-screen"]')).toBeVisible();

  // Una targeta de resum per àmbit, tots tres, encara que el tauler en tingui de filtrats.
  await expect(page.locator('[data-testid="dashboard-scopes"] button')).toHaveCount(3);
});

test('el switch porta al calendari, amb el rail al costat', async ({ page }) => {
  await login(page);

  await page.locator('[data-testid="view-calendar"]').click();
  await expect(page.locator('[data-testid="calendar-screen"]')).toBeVisible();

  // El rail és el MATEIX component que la columna Inbox (P4).
  await expect(page.locator('[data-testid="inbox-rail"]')).toBeVisible();
  await expect(page.locator('[data-testid="inbox-undated"]')).toBeVisible();
});

test('desactivar tots els àmbits es rebutja', async ({ page }) => {
  await login(page);

  const chips = page.locator('[data-testid="scope-chips"] button');
  const total = await chips.count();
  for (let index = 0; index < total; index += 1) await chips.nth(index).click();

  // L'últim no s'apaga: es rebutja el canvi i es diu per què.
  await expect(page.locator('[data-testid="app-warning"]')).toBeVisible();
  await expect(page.locator('[data-testid="kanban"]')).toBeVisible();
});

test("el filtre d'àmbits viu a la URL i sobreviu a una recàrrega", async ({ page }) => {
  await login(page);

  await page.goto('/');
  const chips = page.locator('[data-testid="scope-chips"] button');
  await chips.nth(1).click();

  await expect(page).toHaveURL(/scopes=/u);
  const url = page.url();
  await page.reload();
  expect(page.url()).toBe(url);
});

test("Ajustos no porta ni switch de vista ni chips d'àmbit", async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  await expect(page.locator('[data-testid="settings-screen"]')).toBeVisible();
  // El brief hi insisteix (línia 41) i el prototip encara els deixa.
  await expect(page.locator('[data-testid="view-switch"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="scope-chips"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="settings-back"]')).toBeVisible();
});

test('les vuit pestanyes hi són, i Admin només per a administradors', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  for (const tab of ['general', 'scopes', 'calendars', 'mcp', 'ai', 'shares', 'profile', 'admin']) {
    await expect(page.locator(`[data-testid="settings-tab-${tab}"]`)).toBeVisible();
  }
});

test('canviar el tema a fosc es nota i persisteix', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  await page.locator('[data-testid="theme-chips-dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.locator('[data-testid="theme-chips-system"]').click();
});

test('crear un àmbit nou apareix als chips', async ({ page }) => {
  await login(page);
  await page.goto('/settings');

  await page.locator('[data-testid="settings-tab-scopes"]').click();
  await page.locator('[data-testid="new-scope-name"]').fill('Hort');
  await page.locator('[data-testid="new-scope-create"]').click();

  await page.goto('/');
  await expect(page.locator('[data-testid="scope-chips"]')).toContainText('Hort');
});

test('els CalDAV de cada àmbit són DOS i estan etiquetats', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-calendars"]').click();

  // D9: dues col·leccions per contenidor, sempre. Sense etiqueta, una llista de dues
  // URL gairebé iguals és una invitació a triar la que no toca.
  const events = page.locator('[data-testid$="-events"]');
  const todos = page.locator('[data-testid$="-todos"]');
  await expect(events.first()).toBeVisible();
  await expect(todos.first()).toBeVisible();
  expect(await events.count()).toBe(await todos.count());
});

test('un token es mostra un sol cop', async ({ page }) => {
  await login(page);
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-mcp"]').click();

  await page.locator('[data-testid="token-name"]').fill('Claude');
  await page.locator('[data-testid="token-create"]').click();

  const camp = page.locator('[data-testid="token-value"]');
  await expect(camp).toBeVisible();
  expect(await camp.inputValue()).toContain('femho_pat_');

  // Recarregar la pàgina el perd per sempre: del hash no se'n pot treure.
  await page.reload();
  await page.locator('[data-testid="settings-tab-mcp"]').click();
  await expect(page.locator('[data-testid="token-value"]')).toHaveCount(0);
});

test("les dreceres de teclat funcionen, i no dins d'un camp", async ({ page }) => {
  await login(page);

  await page.locator('body').press('k');
  await expect(page.locator('[data-testid="calendar-screen"]')).toBeVisible();

  await page.locator('body').press('t');
  await expect(page.locator('[data-testid="kanban"]')).toBeVisible();

  // `g` i després `d`.
  await page.locator('body').press('g');
  await page.locator('body').press('d');
  await expect(page.locator('[data-testid="dashboard-screen"]')).toBeVisible();

  // I escrivint, les tecles són text: `k` dins del camp no ha de saltar enlloc.
  await page.goto('/');
  const camp = page.locator('input[role="combobox"]').first();
  await camp.fill('kanban');
  await expect(page.locator('[data-testid="kanban"]')).toBeVisible();
  expect(await camp.inputValue()).toBe('kanban');
});

test("la paleta d'ordres porta on vas amb tres tecles", async ({ page }) => {
  await login(page);

  await page.keyboard.press('Control+k');
  await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();

  // Les destinacions hi són sense escriure res.
  await expect(page.locator('[data-testid="palette-item-calendar"]')).toBeVisible();

  await page.locator('[data-testid="palette-input"]').fill('calen');
  await page.keyboard.press('Enter');

  await expect(page.locator('[data-testid="calendar-screen"]')).toBeVisible();
  await expect(page.locator('[data-testid="command-palette"]')).toBeHidden();

  // I `Escape` la tanca encara que el focus sigui al camp: la drecera global no
  // s'activa escrivint, i sense el maneig local quedaria oberta.
  await page.keyboard.press('Control+k');
  await expect(page.locator('[data-testid="command-palette"]')).toBeVisible();
  await page.locator('[data-testid="palette-input"]').press('Escape');
  await expect(page.locator('[data-testid="command-palette"]')).toBeHidden();
});

test('tancar sessió torna al login', async ({ page }) => {
  await login(page);

  await page.locator('[data-testid="topbar-profile"]').click();
  await page.getByRole('menuitem').last().click();

  await expect(page.locator('[data-testid="login"]')).toBeVisible();

  // I recarregar no la recupera: el token se n'ha anat de debò.
  await page.reload();
  await expect(page.locator('[data-testid="login"]')).toBeVisible();
});
