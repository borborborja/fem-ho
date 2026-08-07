/**
 * Esborrar una tasca.
 *
 * **El botó no hi era.** La cadena de confirmació existia al catàleg des del primer dia
 * —"També se n'aniran les seves subtasques i llistes"— i no la feia servir ningú: des de
 * la interfície no hi havia cap manera d'esborrar una tasca. Es va veure fent servir
 * l'app, no llegint el codi.
 *
 * Es prova el gest sencer perquè és destructiu i no es pot desfer: `undo` només val per a
 * un canvi autònom de la IA amb valors anteriors.
 */

import { expect, test, type Page } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** Crea la tasca per l'API i l'obre al modal, dins d'un àmbit sol per no molestar ningú. */
async function openTask(page: Page, title: string): Promise<void> {
  const token = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('femho.tokens') ?? '{}') as { access_token?: string })
        .access_token ?? '',
  );
  const bearer = { authorization: `Bearer ${token}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: bearer })).json()) as {
    id: string;
  }[];
  const scopeId = scopes[0]!.id;

  await page.request.post('/api/v1/tasks', { headers: bearer, data: { scope_id: scopeId, title } });
  await page.goto(`/board?scopes=${scopeId}`);
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText(title, {
    timeout: 10_000,
  });
  await page.locator('[data-testid="inbox-rail"]').getByText(title).first().click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
}

test("hi ha botó d'esborrar, i demana confirmació dient què més se n'anirà", async ({ page }) => {
  await enter(page);
  await openTask(page, 'Per esborrar');

  await page.locator('[data-testid="task-delete"]').click();

  const dialog = page.locator('[data-testid="task-confirm-delete"]');
  await expect(dialog).toBeVisible();
  // El nom de la tasca i què arrossega. "Segur?" a seques obliga a recordar-ho de memòria.
  await expect(dialog).toContainText('Per esborrar');
  await expect(dialog).toContainText(/subtasques/iu);
});

test('cancel·lar no esborra res', async ({ page }) => {
  await enter(page);
  await openTask(page, 'Que es queda');

  await page.locator('[data-testid="task-delete"]').click();
  await page.locator('[data-testid="task-delete-cancel"]').click();
  await expect(page.locator('[data-testid="task-confirm-delete"]')).toHaveCount(0);

  await page.locator('[data-testid="task-cancel"]').click();
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Que es queda');
});

test('confirmar tanca el modal i la tasca desapareix del tauler', async ({ page }) => {
  await enter(page);
  await openTask(page, 'Adeu');

  await page.locator('[data-testid="task-delete"]').click();
  await page.locator('[data-testid="task-delete-confirm"]').click();

  await expect(page.locator('[data-testid="task-modal"]')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Adeu');

  // I no torna en recarregar: no era només la vista.
  await page.reload();
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Adeu', {
    timeout: 10_000,
  });
});

/** Una tasca que encara no existeix no es pot esborrar. */
test("en crear-ne una de nova, el botó d'esborrar no hi és", async ({ page }) => {
  await enter(page);
  await page.goto('/');
  await page.locator('[data-testid="full-edit-doing"]').click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="task-delete"]')).toHaveCount(0);
});
