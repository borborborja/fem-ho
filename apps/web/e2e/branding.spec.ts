/**
 * La marca de la instància.
 *
 * `FEMHO_INSTANCE_NAME` existia des del primer dia i tres pantalles portaven «Fem-ho»
 * escrit a mà. Ara el llegeixen, i hi ha logo.
 *
 * **La prova arriba fins a la imatge pintada, i no fins a la resposta de l'API.** El
 * servidor la servia bé i el logo sortia trencat: `/brand/` no era al proxy de
 * desenvolupament, o sigui que la petició no hi arribava mai. És el mateix desacord entre
 * les dues disposicions que P22, per l'altra banda, i només es veu mirant-ho.
 */

import { expect, test } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

test('un logo pujat surt a la barra i al login, i es carrega de debò', async ({ page }) => {
  test.setTimeout(120000);
  await enter(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32"><rect width="120" height="32" rx="6" fill="#1f6feb"/><text x="60" y="21" font-family="sans-serif" font-size="14" font-weight="700" fill="#fff" text-anchor="middle">ACME</text></svg>';
  const pujada = await page.evaluate(async (body) => {
    const s = localStorage.getItem('femho.tokens');
    const tk = s === null ? '' : (JSON.parse(s) as { access_token: string }).access_token;
    const r = await fetch('/api/v1/admin/branding/logo?filename=acme.svg', {
      method: 'POST',
      headers: { authorization: `Bearer ${tk}`, 'content-type': 'image/svg+xml' },
      body,
    });
    return r.status;
  }, svg);
  expect(pujada).toBe(200);

  await page.reload();

  /**
   * **Que la imatge s'hagi carregat, no que l'etiqueta hi sigui.** Un `<img>` amb una
   * adreça que respon `index.html` també hi és: el que el distingeix és que
   * `naturalWidth` val zero i el que es veu és el text alternatiu.
   */
  const logo = page.getByTestId('brand-logo');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);

  // I al login, que és una de les dues pantalles on encara no hi ha sessió.
  await page.evaluate(() => {
    localStorage.removeItem('femho.tokens');
  });
  await page.goto('/');
  const alLogin = page.getByTestId('brand-logo');
  await expect(alLogin).toBeVisible();
  expect(await alLogin.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
});

test('i quan es treu, torna el nom de la instància', async ({ page }) => {
  await enter(page);
  const fora = await page.evaluate(async () => {
    const s = localStorage.getItem('femho.tokens');
    const tk = s === null ? '' : (JSON.parse(s) as { access_token: string }).access_token;
    return (
      await fetch('/api/v1/admin/branding/logo', {
        method: 'DELETE',
        headers: { authorization: `Bearer ${tk}` },
      })
    ).status;
  });
  expect(fora).toBe(200);

  await page.reload();
  await expect(page.getByTestId('brand-name')).toBeVisible();
  await expect(page.getByTestId('brand-name')).toHaveText('Fem-ho de proves');
});
