/**
 * Les dues coses que la pestanya d'Admin feia malament.
 *
 * `docs/02` §9 la reserva a qui és administrador, i el codi ja ho tenia present al menú
 * —«ensenyar una pestanya que sempre dona 403 és una mala broma», diu—, però **la mateixa
 * pestanya s'obria escrivint-la a l'adreça**, i llavors sí que ensenyava el 403: un
 * «Alguna cosa ha fallat» en vermell que no diu que el que passa és que això no és per a
 * tu.
 *
 * I «Netejar instància» demanava escriure el nom de la instància **sense dir quin és**: el
 * marcador es llegia literalment «Escriu «» per confirmar» fins que hi clicaves a dins, i
 * llavors el text desapareixia en començar a escriure. El servidor exigeix el nom exacte,
 * o sigui que sense saber-lo l'acció no es pot fer.
 */

import { expect, test } from '@playwright/test';
import { enter, enterAsNew } from './entrar.js';

test("qui no és administrador no cau al panell d'Admin escrivint-ho a l'adreça", async ({
  page,
}) => {
  await enterAsNew(page, {
    name: 'Membre',
    email: 'membre-admin@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.goto('/settings?tab=admin');

  // Cau a General, com qualsevol pestanya que no existeix, i sense cap banda vermella.
  await expect(page.getByTestId('settings-tab-general')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('error-banner')).toHaveCount(0);
  // I la pestanya no és al menú.
  await expect(page.getByTestId('settings-tab-admin')).toHaveCount(0);
});

test('el camp de netejar la instància diu quin nom cal escriure', async ({ page }) => {
  await enter(page);
  await page.goto('/settings?tab=admin');

  const camp = page.getByTestId('wipe-confirmation');
  await expect(camp).toBeVisible();

  /**
   * **Sense clicar-hi.** El nom es demanava en enfocar el camp, o sigui que la instrucció
   * que et diu què escriure estava buida justament mentre la llegies.
   */
  await expect
    .poll(async () => await camp.getAttribute('placeholder'))
    .toContain('Fem-ho de proves');

  // I el botó no s'activa amb un text qualsevol: el servidor exigeix el nom exacte, i
  // deixar prémer per rebre'n un 422 és fer el camí llarg a qui s'ha equivocat.
  await camp.fill('el que sigui');
  await expect(page.getByTestId('wipe-submit')).toBeDisabled();
});
