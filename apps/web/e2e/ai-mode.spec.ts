/**
 * docs/13 M11 · comprovació de la fita: `e2e: ai-mode.spec`.
 *
 * Els criteris que decideixen: que el distintiu **cicli amb un clic**, que `manual` no
 * pinti cap pastilla, que el punt de canvi no vist desaparegui en obrir la tasca, i que
 * "Desfés" **no esborri res de l'historial**.
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/proof/ai');
});

test('AQUESTA és la de docs/09 §3: manual no pinta cap pastilla', async ({ page }) => {
  // "És el cas normal i no ha d'ocupar espai."
  await expect(page.locator('[data-ai-mode]')).toHaveCount(0);
  await expect(page.locator('[data-testid="mode-manual"]')).toBeVisible();
});

test('un clic cicla entre els tres modes', async ({ page }) => {
  const boto = page.locator('[data-testid="cycle-mode"]');

  await boto.click();
  await expect(page.locator('[data-ai-mode="assisted"]')).toBeVisible();

  await boto.click();
  await expect(page.locator('[data-ai-mode="delegated"]')).toBeVisible();

  await boto.click();
  await expect(page.locator('[data-ai-mode]')).toHaveCount(0);
});

test("el color no és mai l'únic senyal: sempre hi ha icona i text", async ({ page }) => {
  await page.locator('[data-testid="cycle-mode"]').click();

  const pastilla = page.locator('[data-ai-mode="assisted"]');
  await expect(pastilla).toContainText('Amb ajuda');
  // La icona `sparkles`: sense ella, qui no distingeixi els dos tons no veu res.
  await expect(pastilla.locator('svg')).toHaveCount(1);
});

test('delegada i amb ajuda es distingeixen per alguna cosa més que el to', async ({ page }) => {
  const boto = page.locator('[data-testid="cycle-mode"]');

  await boto.click();
  const ambAjuda = await page.locator('[data-ai-mode="assisted"]').textContent();

  await boto.click();
  const delegada = await page.locator('[data-ai-mode="delegated"]').textContent();

  expect(ambAjuda).not.toBe(delegada);
});

test('el punt de canvi no vist desapareix en obrir la tasca', async ({ page }) => {
  const punt = page.locator('[data-testid="unseen-ai-dot"]');
  await expect(punt).toBeVisible();

  // Sis píxels a la cantonada superior dreta (docs/09 §3).
  const caixa = await punt.boundingBox();
  expect(caixa?.width).toBeCloseTo(6, 0);
  expect(caixa?.height).toBeCloseTo(6, 0);

  // I té text alternatiu: un punt de color sense text no diu res a un lector de pantalla.
  await expect(punt).toHaveAttribute('aria-label', /canvi autònom/u);

  await page.locator('[data-testid="open-task"]').click();
  await expect(punt).toHaveCount(0);
});

test('una tasca reservada per un agent es marca', async ({ page }) => {
  await page.locator('[data-testid="cycle-mode"]').click();
  await page.locator('[data-testid="toggle-lease"]').click();

  await expect(page.locator('[data-ai-mode="assisted"]')).toHaveAttribute('data-leased', 'true');
});

test("l'historial distingeix humans, IA i externs", async ({ page }) => {
  await expect(page.locator('[data-testid="actor-human"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="actor-ai"]')).toBeVisible();
  await expect(page.locator('[data-testid="actor-external"]')).toBeVisible();
});

test('un canvi de camp ensenya el valor anterior i el nou', async ({ page }) => {
  const linia = page.locator('[data-testid="activity-e2"]');
  // "15 ag → 22 ag": sense el valor anterior, la línia diu que alguna cosa va canviar
  // però no de què a què.
  await expect(linia).toContainText('2026-08-15');
  await expect(linia).toContainText('2026-08-22');
});

test('el filtre deixa veure només la IA o només les persones', async ({ page }) => {
  await page.locator('[data-testid="filter-ai"]').click();
  await expect(page.locator('[data-actor="ai_agent"]')).toHaveCount(1);
  await expect(page.locator('[data-actor="user"]')).toHaveCount(0);

  await page.locator('[data-testid="filter-human"]').click();
  await expect(page.locator('[data-actor="user"]')).toHaveCount(1);
  await expect(page.locator('[data-actor="ai_agent"]')).toHaveCount(0);

  await page.locator('[data-testid="filter-all"]').click();
  await expect(page.locator('[data-actor="ai_agent"]')).toHaveCount(1);
});

test("AQUESTA és la de docs/09 §7: Desfés NO esborra res de l'historial", async ({ page }) => {
  const abans = await page.locator('li[data-actor]').count();

  // Només els canvis autònoms el porten.
  await expect(page.locator('[data-testid="undo-e1"]')).toHaveCount(0);
  await page.locator('[data-testid="undo-e2"]').click();

  // L'historial ha CRESCUT: hi consta el que va fer la IA i que algú ho ha desfet.
  await expect(page.locator('li[data-actor]')).toHaveCount(abans + 1);
  await expect(page.locator('[data-testid="activity-e2"]')).toBeVisible();

  // I el botó ja no hi és: no es pot desfer dues vegades.
  await expect(page.locator('[data-testid="undo-e2"]')).toHaveCount(0);
});

test('el canvi invers ensenya els valors al revés', async ({ page }) => {
  await page.locator('[data-testid="undo-e2"]').click();

  const invers = page.locator('[data-testid="activity-e2-undo"]');
  await expect(invers).toContainText('2026-08-22');
  await expect(invers).toContainText('2026-08-15');
});
