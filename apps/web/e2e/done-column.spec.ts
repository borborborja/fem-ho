/**
 * La columna Fet, que no podia ensenyar res.
 *
 * `DoneColumn.ts` està bé, té les seves proves i filtra per `completed_at` dins del dia de
 * qui mira. El que no hi havia era **el segell**: l'únic camí que fa servir la interfície
 * per acabar una tasca —arrossegar-la a Fet, o el commutador de la targeta— és
 * `POST /tasks/{id}/move`, i `move` no tocava `completed_at`. `POST /complete`, que sí que
 * el tocava, no el crida cap client.
 *
 * O sigui que la targeta que deixaves anar a Fet **desapareixia de les quatre columnes**:
 * ja no era a Per fer i encara no era enlloc. Cap de les proves de servidor ho podia veure,
 * perquè totes anaven per `/complete`; i cap de les del navegador tampoc, perquè cap no
 * arrossegava fins al final. És la costura, un altre cop.
 */

import { expect, test } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Fetes',
  email: 'fetes@example.com',
  password: 'la-contrasenya-de-prova',
};

test('una tasca acabada apareix a Fet, i no es perd pel camí', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  await camp.fill('Treure les escombraries');
  await camp.press('Enter');

  const targeta = page.getByText('Treure les escombraries').first();
  await expect(targeta).toBeVisible();

  /**
   * El camí de la targeta, que és el que fa tothom: la fletxa la porta a Fent i allà
   * apareix el commutador. Totes dues coses acaben a `POST /move`, que és el que es prova.
   */
  /**
   * Per identificador i no per nom accessible: l'embolcall d'arrossegar és, per a
   * dnd-kit, un botó que es diu com tot el que porta a dins —hi surt «Moure a Fent»—, i
   * clicar-lo obre la fitxa. Buscar la fletxa pel nom agafa la targeta sencera.
   */
  await page.getByTestId('card-advance').first().click();
  await expect(page.locator('[data-column-status="doing"]')).toContainText(
    'Treure les escombraries',
  );
  await page.getByTestId('card-toggle-done').first().click();

  /**
   * **A Fet i visible.** Si `completed_at` es queda buit la tasca existeix, l'API la torna,
   * i la columna —que filtra pel dia— no l'ensenya: exactament el defecte que això tanca.
   */
  const fet = page.locator('[data-column-status="done"]');
  await expect(fet.getByText('Treure les escombraries')).toBeVisible();
});

test('i des de la fitxa, que és on s’acaba mirant una tasca', async ({ page }) => {
  /**
   * `docs/02` §7 demana l'estat a la fitxa i no hi era: obries «Edició completa» i l'única
   * cosa que no s'hi podia editar era **on és la tasca**. Al tauler s'arrossega; al mòbil,
   * que és on més s'obre la fitxa, arrossegar és el gest incòmode.
   */
  await enterAsNew(page, {
    name: 'Fitxa',
    email: 'fitxa-estat@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  await camp.fill('Canviar la bombeta');
  await camp.press('Enter');

  await page.locator('[data-testid^="task-"]').first().hover();
  await page.getByTestId('card-edit').first().click();

  // On és ara, dit pel control i no endevinat.
  await expect(page.getByTestId('task-status-todo')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('task-status-done').click();
  await expect(page.getByTestId('task-status-done')).toHaveAttribute('aria-pressed', 'true');

  // I en tancar la fitxa, la targeta és a Fet: el mateix camí i el mateix segell.
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-column-status="done"]')).toContainText('Canviar la bombeta');
});
