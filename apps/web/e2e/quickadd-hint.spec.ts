/**
 * El camp d'afegida ràpida anuncia **només el que serveix per a alguna cosa**.
 *
 * Deia sempre `#Àmbit @Persona`. A una casa amb un sol àmbit i sense ningú més, cap dels
 * dos sigils fa res —`#` no cal, s'agafa l'únic àmbit; `@` no té a qui assignar— i a sobre
 * el text no cabia i es tallava a mitja paraula. Un camp que et parla d'una sintaxi que no
 * necessites, i tallada, és el que et fa pensar que això està trencat abans de fer-lo servir.
 */

import { expect, test } from '@playwright/test';
import { enter, enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

test('amb un sol àmbit, el camp no parla de cap sigil', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Sola',
    email: 'sola@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.goto('/');

  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  const text = await camp.getAttribute('placeholder');

  expect(text).toContain('Per fer');
  expect(text).not.toContain('#');
  expect(text).not.toContain('@');

  /**
   * I **hi cap**: era això el que es tallava. Es compara el que es dibuixa amb el que
   * mesura el text, que és l'única manera de saber que no s'ha retallat.
   */
  const cap = await camp.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(cap, 'el text del camp no hi cap').toBe(true);
});

test("i amb més d'un àmbit actiu, sí que ofereix el sigil que cal", async ({ page }) => {
  // Amb dos àmbits actius **no es crea res sense dir-ne un**, o sigui que aquí el sigil és
  // informació útil i no soroll.
  await enter(page);
  await page.goto('/');

  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  await expect(camp).toHaveAttribute('placeholder', /#/);
});

test('si la creació no arriba, el camp recupera el que havies escrit', async ({ page }) => {
  /**
   * **Es perdia.** El camp es buida en prémer Enter —és el que fa que encadenar tasques
   * sigui instantani (`docs/02` §4)— però es buidava **abans de saber si s'havia creat**.
   * Sense connexió escrivies una tasca, premies Enter, el camp quedava net, la tasca no
   * era enlloc, i el que havies escrit ja no existia.
   *
   * Ara torna, i diu per què. El camí ràpid no canvia: quan va bé, es buida igual.
   */
  await enterAsNew(page, {
    name: 'Sensexarxa',
    email: 'sense-xarxa@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.goto('/');

  // El servidor no contesta: el mateix que passa amb el mòbil sense cobertura.
  await page.route('**/api/v1/tasks', (route) =>
    route.request().method() === 'POST' ? route.abort('failed') : route.continue(),
  );

  const camp = page.locator('[data-testid="quick-add-todo"] input[role="combobox"]');
  await camp.fill('Comprar pinso per al gat');
  await camp.press('Enter');

  await expect(camp).toHaveValue('Comprar pinso per al gat');
  await expect(page.getByText("No s'ha pogut crear. Torna-ho a provar.")).toBeVisible();

  // I amb la xarxa de tornada, la mateixa tecla la crea i el camp sí que es buida.
  await page.unroute('**/api/v1/tasks');
  await camp.press('Enter');
  await expect(camp).toHaveValue('');
  await expect(page.locator('[data-column-status="todo"]')).toContainText(
    'Comprar pinso per al gat',
  );
});
