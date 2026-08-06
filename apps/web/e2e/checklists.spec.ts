/**
 * docs/13 M8 · comprovació de la fita: `e2e: checklists.spec`.
 *
 * Els criteris d'acceptació: es pot crear una llista dins d'una tasca, marcar-ne l'últim
 * ítem **completa la subtasca ancorada i la tasca** (la cascada amunt, P1), el
 * commutador de completats funciona en les dues posicions, i en completar-se una llista
 * pinejada **es proposa** despinejar-la — es proposa, no es fa.
 *
 * Va contra el servidor real, com `app.spec.ts`: la cascada passa dins d'una transacció
 * al servidor i una prova amb dades fixes no en veuria res.
 */

import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

async function enter(page: import('@playwright/test').Page): Promise<void> {
  /**
   * **Es pregunta al servidor si la porta és oberta**, no es dedueix del que es veu.
   *
   * Mirar si hi ha formulari de login no serveix: amb la base buida també n'hi ha, i
   * llavors s'intentava entrar amb un compte que encara no existeix. `GET /api/v1/setup`
   * ho diu sense ambigüitat.
   */
  const gate = await page.request.get('/api/v1/setup');
  const open = ((await gate.json()) as { open: boolean }).open;

  await page.goto('/');
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  // La instància la crea `app.spec.ts`. Si aquest fitxer corre sol, la crea ell.
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

/** Crea una tasca amb l'afegida ràpida i l'obre. */
async function taskWithList(
  page: import('@playwright/test').Page,
  title: string,
): Promise<string> {
  const scope = await page.locator('[data-testid="scope-chips"] button').first().innerText();
  const field = page.locator('input[role="combobox"]').first();
  await field.fill(`#${scope} ${title}`);
  await field.press('Escape');
  await field.press('Enter');

  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText(title, {
    timeout: 10_000,
  });
  await page.locator('[data-testid="inbox-rail"]').getByText(title).first().click();

  const modal = page.locator('[data-testid="task-modal"]');
  await expect(modal).toBeVisible();
  await modal.locator('[data-testid="task-new-checklist"]').click();

  const link = modal.locator('[data-testid^="task-checklist-"]').first();
  await expect(link).toBeVisible();
  const testId = await link.getAttribute('data-testid');
  await link.click();

  await expect(page.locator('[data-testid="list-screen"]')).toBeVisible();
  return (testId ?? '').replace('task-checklist-', '');
}

async function addItem(page: import('@playwright/test').Page, text: string): Promise<void> {
  const field = page.locator('[data-testid="list-add"]');
  await field.fill(text);
  await field.press('Enter');
  await expect(page.locator('[data-testid="list-screen"]')).toContainText(text);
}

test('es pot crear una llista dins d\'una tasca i afegir-hi ítems', async ({ page }) => {
  await enter(page);
  await taskWithList(page, 'La maleta');

  await addItem(page, 'Passaport');
  await addItem(page, 'Carregador');

  // El camp manté el focus per poder-ne encadenar (docs/02 §6).
  await expect(page.locator('[data-testid="list-add"]')).toBeFocused();
});

test('marcar un ítem el ratlla, i desmarcar-lo el desfà', async ({ page }) => {
  await enter(page);
  await taskWithList(page, 'Per marcar');
  await addItem(page, 'Una cosa');

  const caixa = page.locator('[data-testid="list-screen"] [role="checkbox"]').first();
  await expect(caixa).toHaveAttribute('aria-checked', 'false');

  await caixa.click();
  await expect(caixa).toHaveAttribute('aria-checked', 'true');

  await caixa.click();
  await expect(caixa).toHaveAttribute('aria-checked', 'false');
});

test('el commutador mou els completats a una secció plegada amb el recompte', async ({ page }) => {
  await enter(page);
  await taskWithList(page, 'Amb completats');
  await addItem(page, 'Feta');
  await addItem(page, 'Pendent');

  await page.locator('[data-testid="list-screen"] [role="checkbox"]').first().click();

  // Per defecte, en línia: els dos ítems es veuen al mateix lloc.
  await expect(page.locator('[data-testid="list-completed-section"]')).toHaveCount(0);

  await page.locator('[data-testid="list-completed-toggle"] button').nth(1).click();

  // Ara hi ha una secció "Completats · 1", i **plegada**: no s'amaga res, es plega.
  const seccio = page.locator('[data-testid="list-completed-section"]');
  await expect(seccio).toBeVisible();
  await expect(seccio).toContainText('1');
  await expect(page.locator('[data-testid="list-screen"]')).not.toContainText('Feta');

  await seccio.click();
  await expect(page.locator('[data-testid="list-screen"]')).toContainText('Feta');
});

test('AQUESTA és la de docs/13: la cascada amunt completa la tasca', async ({ page }) => {
  await enter(page);
  const listId = await taskWithList(page, 'Amb cascada');
  await addItem(page, 'L\'única');

  await page.locator('[data-testid="list-screen"] [role="checkbox"]').first().click();
  await expect(page.locator('[data-testid="list-screen"] [role="checkbox"]').first()).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // La tasca d'origen ha de quedar feta: la cascada puja de la llista a la tasca dins
  // de la mateixa transacció (P1), i per tant es veu de seguida a l'API.
  const response = await page.request.get(`/api/v1/checklists/${listId}`, {
    headers: { authorization: `Bearer ${await accessToken(page)}` },
  });
  const view = (await response.json()) as { task_id: string };

  const task = await page.request.get(`/api/v1/tasks/${view.task_id}`, {
    headers: { authorization: `Bearer ${await accessToken(page)}` },
  });
  expect(((await task.json()) as { status: string }).status).toBe('done');
});

test('en completar una llista PINEJADA es proposa despinejar-la, i es pot mantenir', async ({
  page,
}) => {
  await enter(page);
  const listId = await taskWithList(page, 'Pinejada');
  await addItem(page, 'Últim ítem');

  // Es pineja per l'API: el gest de pinejar viu al modal i aquí el que es prova és què
  // passa en completar-la.
  await page.request.post(`/api/v1/checklists/${listId}/pin`, {
    headers: { authorization: `Bearer ${await accessToken(page)}` },
  });
  await page.reload();
  await expect(page.locator('[data-testid="list-screen"]')).toBeVisible();

  await page.locator('[data-testid="list-screen"] [role="checkbox"]').first().click();

  const prompt = page.locator('[data-testid="list-unpin-prompt"]');
  await expect(prompt).toBeVisible();

  // **Es proposa, no es fa**: mantenir-la la deixa pinejada.
  await prompt.getByRole('button').nth(1).click();
  await expect(prompt).toBeHidden();

  const pinned = await page.request.get('/api/v1/pinned-checklists', {
    headers: { authorization: `Bearer ${await accessToken(page)}` },
  });
  expect(((await pinned.json()) as { id: string }[]).map((c) => c.id)).toContain(listId);
});

/** El testimoni que el navegador ja té: les crides directes van amb el mateix. */
async function accessToken(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('femho.tokens');
    return raw === null ? '' : (JSON.parse(raw) as { access_token: string }).access_token;
  });
}
