/**
 * docs/13 M6 · comprovació de la fita: `e2e: quickadd.spec`.
 *
 * Els criteris d'acceptació:
 *   - `#Feina/Client Salt Enviar proposta @Alba` crea la tasca a l'àmbit, projecte i
 *     persona correctes **amb el títol net**.
 *   - Amb més d'un àmbit actiu i sense `#`, es mostra l'error i **no es crea res**.
 *   - **El xip es pot tornar a text pla.**
 *   - L'autocompletat funciona amb teclat.
 */

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/proof/quickadd');
});

test('AQUESTA és la de docs/13: àmbit, projecte, persona i títol net', async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.fill('#Feina/Client Salt Enviar proposta @Alba');
  await field.press('Enter');

  const created = page.locator('[data-testid="created-0"]');
  await expect(created).toHaveAttribute('data-title', 'Enviar proposta');
  await expect(created).toHaveAttribute('data-scope', 'scope-feina');
  await expect(created).toHaveAttribute('data-project', 'proj-client-salt');
  await expect(created).toHaveAttribute('data-assignees', 'user-alba');
});

test('Enter crea sense obrir cap modal i el camp manté el focus', async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.fill('#Personal Comprar pa');
  await field.press('Enter');

  await expect(page.locator('[data-testid="created-0"]')).toBeVisible();
  // "El camp es buida i manté el focus, per poder-ne encadenar" (docs/02 §4).
  await expect(field).toHaveValue('');
  await expect(field).toBeFocused();

  // I se'n pot encadenar una altra de seguida.
  await page.keyboard.type('#Personal Comprar llet');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="created-1"]')).toBeVisible();
});

test("amb més d'un àmbit actiu i sense #, es mostra l'error i NO es crea res", async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.fill('Una tasca sense àmbit');
  await field.press('Enter');

  await expect(page.locator('[data-testid="quickadd-error"]')).toBeVisible();
  await expect(page.locator('[data-testid="quickadd-error"]')).toContainText('#Personal');
  // No es crea res.
  await expect(page.locator('[data-testid="created"] li')).toHaveCount(0);
  // I el text no es perd: l'usuari només ha d'afegir-hi l'àmbit.
  await expect(field).toHaveValue('Una tasca sense àmbit');
});

test("l'error desapareix en tornar a escriure", async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.fill('Sense àmbit');
  await field.press('Enter');
  await expect(page.locator('[data-testid="quickadd-error"]')).toBeVisible();

  await field.fill('#Personal Amb àmbit');
  await expect(page.locator('[data-testid="quickadd-error"]')).toHaveCount(0);
});

test('AQUESTA és la de docs/13: el xip es pot tornar a text pla', async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.fill('#Feina Enviar proposta');

  // El tros reconegut es pinta com a pastilla dins del camp.
  const chip = page.locator('[data-testid="chip-scope"]');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-chip-label', 'Feina');

  // Clicar-la la torna a text pla (D12): "sense això, un parser agressiu és una trampa".
  await chip.click();
  await expect(field).toHaveValue('Feina Enviar proposta');
  await expect(page.locator('[data-testid="chip-scope"]')).toHaveCount(0);
});

test("l'autocompletat funciona amb teclat", async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.click();
  await page.keyboard.type('#');

  const list = page.locator('[data-testid="quickadd-suggestions"]');
  await expect(list).toBeVisible();
  // Combobox accessible: l'input ha de dir què hi ha seleccionat (docs/02 §4).
  await expect(field).toHaveAttribute('aria-expanded', 'true');
  await expect(field).toHaveAttribute('aria-activedescendant', /.+/);

  // Fletxes per navegar, Enter per triar.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(field).toHaveValue('#Feina ');
  await expect(page.locator('[data-testid="chip-scope"]')).toHaveAttribute(
    'data-chip-label',
    'Feina',
  );
});

test("Escape tanca el desplegable sense esborrar el que s'ha escrit", async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.click();
  await page.keyboard.type('#Fei');
  await expect(page.locator('[data-testid="quickadd-suggestions"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="quickadd-suggestions"]')).toHaveCount(0);
  // El text NO es toca: canviar el que l'usuari ha escrit per tancar un menú és
  // exactament el que un camp d'afegida ràpida no ha de fer.
  await expect(field).toHaveValue('#Fei');

  // I tornar a escriure el reobre.
  await page.keyboard.type('n');
  await expect(page.locator('[data-testid="quickadd-suggestions"]')).toBeVisible();
});

test("el sigil !ia posa el mode d'IA", async ({ page }) => {
  const field = page.getByRole('combobox');
  await field.fill('#Feina Migrar el servidor !ia');
  await field.press('Enter');

  const created = page.locator('[data-testid="created-0"]');
  await expect(created).toHaveAttribute('data-ai-mode', 'delegated');
  await expect(created).toHaveAttribute('data-title', 'Migrar el servidor');
});
