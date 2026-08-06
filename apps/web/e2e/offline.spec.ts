/**
 * docs/13 M9 · comprovació de la fita: `e2e: offline.spec`.
 *
 * El cas 1 de `docs/06` §10 —mode avió— però al navegador de debò, amb IndexedDB de
 * debò. El que es prova aquí i no a `sync.test.ts` és la meitat del client: que la cua
 * sobreviu a una recàrrega, que fusiona, i que reconnectar no duplica res.
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/proof/offline');
  await expect(page.locator('[data-testid="task-tasca-1"]')).toBeVisible();
});

test('AQUESTA és la de docs/13: editar sense xarxa i que arribi tot en reconnectar', async ({
  page,
}) => {
  await page.locator('[data-testid="toggle-network"]').click();
  await expect(page.locator('[data-testid="network"]')).toHaveAttribute('data-online', 'false');

  await page.locator('[data-testid="rename-tasca-1"]').click();
  await page.locator('[data-testid="complete-tasca-2"]').click();

  // El canvi es veu de seguida encara que no hagi sortit: l'escriptura és local primer.
  await expect(page.locator('[data-testid="task-tasca-1"]')).toHaveAttribute(
    'data-title',
    'Comprar pa ·',
  );
  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '2');

  // Sincronitzar sense xarxa no perd res ni gasta intents.
  await page.locator('[data-testid="sync"]').click();
  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '2');

  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="sync"]').click();

  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '0');
  await expect(page.locator('[data-testid="task-tasca-1"]')).toHaveAttribute(
    'data-title',
    'Comprar pa ·',
  );
  await expect(page.locator('[data-testid="task-tasca-2"]')).toHaveAttribute('data-status', 'done');
});

test('tres canvis del mateix camp són UNA operació', async ({ page }) => {
  await page.locator('[data-testid="toggle-network"]').click();

  for (let i = 0; i < 3; i += 1) await page.locator('[data-testid="rename-tasca-1"]').click();

  // Fusionades a la cua...
  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '1');

  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="sync"]').click();

  // ...i el servidor n'aplica UNA, no tres.
  await expect(page.locator('[data-testid="applied"]')).toHaveAttribute('data-count', '1');
  await expect(page.locator('[data-testid="task-tasca-1"]')).toHaveAttribute(
    'data-title',
    'Comprar pa · · ·',
  );
});

test('la cua sobreviu a tancar la pestanya', async ({ page, context }) => {
  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="rename-tasca-1"]').click();
  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '1');

  // IndexedDB és per origen, no per pestanya: una pestanya nova ha de trobar la cua.
  const altra = await context.newPage();
  await altra.goto('/proof/offline');
  await expect(altra.locator('[data-testid="task-tasca-1"]')).toBeVisible();
  await expect(altra.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '1');
  await altra.close();
});

test("un xoc de títol es pregunta i l'usuari decideix", async ({ page }) => {
  // Un altre dispositiu canvia el títol...
  await page.locator('[data-testid="remote-edit"]').click();

  // ...i aquest, sense saber-ho, també.
  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="rename-tasca-1"]').click();
  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="sync"]').click();

  await expect(page.locator('[data-testid="conflict"]')).toBeVisible();

  // Triar la meva la reencua sobre la versió nova, i el segon intent ja no xoca.
  await page.locator('[data-testid="keep-mine"]').click();
  await page.locator('[data-testid="sync"]').click();

  await expect(page.locator('[data-testid="conflict"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '0');
  await expect(page.locator('[data-testid="task-tasca-1"]')).toHaveAttribute(
    'data-title',
    'Comprar pa ·',
  );
});

test("triar la de l'altre dispositiu descarta el canvi local", async ({ page }) => {
  await page.locator('[data-testid="remote-edit"]').click();
  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="rename-tasca-1"]').click();
  await page.locator('[data-testid="toggle-network"]').click();
  await page.locator('[data-testid="sync"]').click();

  await page.locator('[data-testid="keep-theirs"]').click();
  await page.locator('[data-testid="sync"]').click();

  await expect(page.locator('[data-testid="queue"]')).toHaveAttribute('data-count', '0');
  await expect(page.locator('[data-testid="task-tasca-1"]')).toHaveAttribute(
    'data-title',
    'Comprar pa de pagès',
  );
});

test('el manifest de la PWA hi és i parla català', async ({ page }) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).not.toBeNull();

  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as { lang: string; name: string; icons: unknown[] };
  expect(manifest.lang).toBe('ca');
  expect(manifest.name).toBe('Fem-ho');
  // Sense les icones no hi ha cap invitació a instal·lar-la.
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
});
