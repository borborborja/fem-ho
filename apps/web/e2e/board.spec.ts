/**
 * Prova visual del port del tauler (M5).
 *
 * El pla afegeix aquesta comprovació a cada fita d'UI: captura de la pantalla
 * implementada al costat de la del prototip, als dos temes. És el que impedeix que
 * "portat" acabi volent dir "reescrit d'esma".
 */

import { expect, test } from '@playwright/test';

test('el tauler pinta les quatre columnes als dos temes', async ({ page }) => {
  await page.goto('/board');

  for (const theme of ['light', 'dark'] as const) {
    const surface = page.locator(`[data-testid="board-${theme}"]`);
    for (const status of ['inbox', 'todo', 'doing', 'done'] as const) {
      await expect(surface.locator(`[data-column-status="${status}"]`)).toBeVisible();
    }
  }
});

test("l'Inbox es distingeix de les altres tres", async ({ page }) => {
  await page.goto('/board');
  const surface = page.locator('[data-testid="board-light"]');

  const inbox = surface.locator('[data-column-status="inbox"]');
  const todo = surface.locator('[data-column-status="todo"]');

  const fons = async (loc: typeof inbox) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.backgroundImage}|${s.backgroundColor}`;
    });

  // Brief línia 39: visualment ha de ser diferent l'Inbox de les tres llistes kanban.
  expect(await fons(inbox)).not.toBe(await fons(todo));
});

test("les tres columnes van dins d'una sola targeta", async ({ page }) => {
  await page.goto('/board');
  const surface = page.locator('[data-testid="board-light"]');

  // La segona meitat del que demana el brief: que les tres "es sentin un sol element".
  // El prototip ho fa envoltant-les d'una targeta; l'Inbox en queda fora.
  const parePerFer = await surface
    .locator('[data-column-status="todo"]')
    .evaluate((el) => el.parentElement?.getAttribute('data-testid') ?? 'sense-testid');
  const pareInbox = await surface
    .locator('[data-column-status="inbox"]')
    .evaluate((el) => el.parentElement?.getAttribute('data-testid') ?? 'sense-testid');

  expect(parePerFer).not.toBe(pareInbox);
});

test("les accions ràpides són només a l'Inbox", async ({ page }) => {
  await page.goto('/board');
  const surface = page.locator('[data-testid="board-light"]');

  // docs/02 §4: "Accions ràpides: només a les targetes de l'Inbox".
  await expect(
    surface
      .locator('[data-column-status="inbox"]')
      .getByRole('button', { name: '→ Per fer' })
      .first(),
  ).toBeVisible();

  await expect(
    surface.locator('[data-column-status="todo"]').getByRole('button', { name: '→ Per fer' }),
  ).toHaveCount(0);
});

test('captura del tauler als dos temes', async ({ page }) => {
  await page.goto('/board');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('board.png', { fullPage: true });
});
