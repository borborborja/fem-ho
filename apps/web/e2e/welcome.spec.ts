/**
 * La primera pregunta: com reparteixes la feina.
 *
 * Surt a qui no l'ha contestada mai, i **una sola vegada**. La prova la torna a fer sortir
 * amb `scope_mode: null` —«no ho ha dit»— que és el mateix estat en què arriba qui obre el
 * compte avui: no hi ha cap camí especial de proves, és l'estat de debò.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Benvinguda',
  email: 'benvinguda@example.com',
  password: 'la-contrasenya-de-prova',
};

/** Torna la persona a «encara no ho ha dit», que és com arriba qui es registra avui. */
async function oblidaLaTria(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const stored = localStorage.getItem('femho.tokens');
    const token =
      stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
    await fetch('/api/v1/auth/settings', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ scope_mode: null }),
    });
  });
}

test('qui no ho ha dit mai troba la pregunta, i en surt havent triat', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.setViewportSize({ width: 1440, height: 900 });
  await oblidaLaTria(page);
  await page.reload();

  const wizard = page.getByTestId('welcome-screen');
  await expect(wizard).toBeVisible();

  /**
   * **No hi ha barra al darrere.** La barra és justament el que s'està triant, i
   * ensenyar-ne una de provisional faria que la tria semblés un filtre més.
   */
  await expect(page.getByTestId('topbar')).toHaveCount(0);

  // Les dues opcions hi són, i cap tercera de «després»: no triar és el cas que això treu.
  await expect(page.getByTestId('welcome-multi')).toBeVisible();
  await expect(page.getByTestId('welcome-single')).toBeVisible();

  await page.getByTestId('welcome-single').click();

  /**
   * S'entra a l'app **ja amb la lent triada**: els àmbits no són a la barra.
   *
   * Es mira que no hi siguin els xips d'àmbit i no que hi siguin els de projecte: sense cap
   * projecte creat, el contenidor dels projectes hi és però buit, i un contenidor buit no
   * té alçada. El senyal de la lent és que els àmbits han deixat de manar.
   */
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('scope-chips')).toHaveCount(0);
  await expect(page.getByTestId('project-chips')).toHaveCount(1);
});

test('i no torna a sortir mai més', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);

  // Ni recarregant, que és on una condició mal escrita es nota.
  await page.reload();
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);
});

test("des d'Ajustos es canvia d'opinió, i es diu que no es perd res", async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.goto('/settings?tab=general');

  const commutador = page.getByTestId('scope-mode');
  await expect(commutador).toBeVisible();
  // Ve de la prova anterior amb `single`; es torna a àmbits.
  await page.getByTestId('scope-mode-multi').click();

  await page.goto('/');
  await expect(page.getByTestId('scope-chips')).toBeVisible();
  await expect(page.getByTestId('project-chips')).toHaveCount(0);
});
