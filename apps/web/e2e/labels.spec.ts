/**
 * Les etiquetes, que existien a la base de dades i enlloc més.
 *
 * `docs/02` §7 les demana a la fitxa i hi eren: un epígraf «Etiquetes» i, a sota, **res**.
 * Tres coses trencades l'una darrere de l'altra:
 *
 *   1. **Cap pantalla en sabia crear una.** Ni la fitxa ni Ajustos. Amb zero etiquetes,
 *      la secció no pintava ni estat buit —totes les altres seccions de la fitxa en tenen.
 *   2. **Els xips no deien si l'etiqueta hi era.** El `Task` no portava `label_ids`, o sigui
 *      que la fitxa no ho podia saber ni ensenyant-ho ni volent.
 *   3. **Treure'n una era clicar-la i esperar que el `POST` fallés**, i caure al `DELETE` del
 *      `catch`. Un tall de xarxa esborrava etiquetes sense que ningú ho demanés.
 *
 * Res d'això ho hauria vist cap prova de servidor: els tres endpoints funcionaven.
 */

import { expect, test } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test('una etiqueta es crea des de la fitxa, es veu posada, i es treu', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Etiquetes',
    email: 'etiquetes@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  await camp.fill('Pintar la tanca');
  await camp.press('Enter');

  await page.locator('[data-testid^="task-"]').first().hover();
  await page.getByTestId('card-edit').first().click();

  // Sense cap etiqueta a l'àmbit, la secció diu que no n'hi ha i ofereix fer-ne una.
  await expect(page.getByText('Aquest àmbit encara no té cap etiqueta.')).toBeVisible();

  await page.getByTestId('task-label-new').click();
  await page.getByTestId('task-label-name').fill('Urgent');
  await page.getByTestId('task-label-name').press('Enter');

  /**
   * **Neix posada**, i el xip ho diu. `aria-pressed` és la comprovació que importa: el
   * defecte era justament que tots els xips es dibuixaven igual.
   */
  const xip = page.locator('[data-testid^="task-label-"][aria-pressed]').first();
  await expect(xip).toHaveText('Urgent');
  await expect(xip).toHaveAttribute('aria-pressed', 'true');

  // I clicar-la la treu, sense fer fallar cap crida per saber-ho.
  await xip.click();
  await expect(xip).toHaveAttribute('aria-pressed', 'false');
});
