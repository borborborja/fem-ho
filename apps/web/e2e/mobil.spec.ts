/**
 * Al telèfon, **la pàgina no es mou de costat**.
 *
 * Dues coses diferents ho trencaven, i totes dues es veuen amb el mateix número:
 *
 *   1. **El tauler.** Les columnes es desplacen per dins, que és el disseny; el que es
 *      desplaçava era el document sencer —a 390px en feia 677—, o sigui que la barra de
 *      dalt marxava de la vista en passar de columna. `main` porta `margin: 0 auto`, i
 *      dins d'un contenidor de flex en columna això el dimensiona **pel contingut**: la
 *      mida mínima del tauler són les quatre columnes juntes.
 *   2. **Ajustos.** El menú lateral era `220px` fixos i el contingut es quedava amb cent
 *      deu: el text queia a una paraula per línia, el selector deia «TLS · p» i el botó
 *      «Afegeix el compte» era un cercle amb tres línies a dins. Ajustos al mòbil és
 *      justament on es configura el correu.
 *
 * Es mesura `scrollWidth` del document contra `innerWidth`, que és l'única manera de
 * saber-ho: a una captura, una pàgina que es mou de costat es veu igual que una que no.
 */

import { expect, test } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test('cap pantalla es desplaça de costat en un telèfon', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Telefon',
    email: 'telefon@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.setViewportSize({ width: 390, height: 844 });

  for (const [nom, url] of [
    ['tauler', '/'],
    ['calendari', '/calendar'],
    ['tauler general', '/dashboard'],
    ['ajustos', '/settings?tab=mail'],
  ] as const) {
    await page.goto(url);
    // Hi ha d'haver alguna cosa pintada abans de mesurar-ne l'amplada.
    await expect(page.locator('header').first()).toBeVisible();

    const mida = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      finestra: window.innerWidth,
    }));
    expect(mida.document, `${nom} es desplaça de costat`).toBeLessThanOrEqual(mida.finestra + 1);
  }
});

test("a Ajustos el contingut té l'amplada de la pantalla, i el menú va a dalt", async ({
  page,
}) => {
  await enterAsNew(page, {
    name: 'Telefon',
    email: 'telefon@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings?tab=mail');

  /**
   * **Amplada, no captura.** Amb el menú al costat el contingut es quedava a 110px i tot
   * hi cabia «igualment», paraula per línia. El número és el que ho diu.
   */
  const seccio = page.locator('[data-testid="settings-screen"] > section');
  const ample = (await seccio.boundingBox())?.width ?? 0;
  expect(ample).toBeGreaterThan(300);

  // I el menú és a sobre del contingut, no a la seva esquerra.
  const nav = await page.locator('[data-testid="settings-screen"] > nav').boundingBox();
  const caixa = await seccio.boundingBox();
  expect(nav!.y + nav!.height).toBeLessThanOrEqual(caixa!.y + 1);
});
