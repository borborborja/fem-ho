/**
 * El correu a Ajustos, contra el servidor real.
 *
 * Aquest fitxer existeix per la doctrina de la casa: **«compila» no vol dir «arrenca»**.
 * Les proves de servidor ja diuen que l'API fa el que ha de fer; el que només es pot
 * comprovar amb la pantalla oberta són tres coses:
 *
 *   - Que la pestanya **hi és i es pot obrir**, que és el mínim que cap prova de servidor
 *     veuria si algú s'oblidés de posar-la a `TABS`.
 *   - Que la contrasenya **no torna a la interfície** després de desar-la. Al servidor es
 *     prova que no surti a la resposta; aquí, que no acabi al DOM.
 *   - Que la **previsualització del títol és en viu** i la fa la mateixa funció que el
 *     servidor. Si divergissin, el que veus escrivint no seria el que et surt al tauler.
 */

import { expect, test } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

test('un compte de correu es dona d’alta des d’Ajustos', async ({ page }) => {
  await enter(page);
  await page.goto('/settings?tab=mail');

  await expect(page.getByTestId('settings-tab-mail')).toBeVisible();
  await expect(page.getByTestId('mail-account-form')).toBeVisible();

  await page.getByTestId('mail-new-name').fill('Personal');
  await page.getByTestId('mail-new-host').fill('imap.example.test');
  await page.getByTestId('mail-new-username').fill('borja');
  await page.getByTestId('mail-new-password').fill('la-contrasenya-del-correu');
  await page.getByTestId('mail-add-account').click();

  const fila = page.locator('[data-testid^="mail-account-"]').first();
  await expect(fila).toContainText('Personal');
  await expect(fila).toContainText('imap.example.test');

  /**
   * **I la contrasenya no és enlloc de la pàgina.** Aquesta és la prova que el servidor no
   * pot fer: allà es comprova que no surti a la resposta; aquí, que ningú l'hagi tornat a
   * pintar en un camp «per comoditat», que és exactament com acabaria al DOM de qualsevol
   * pestanya oberta.
   */
  await page.reload();
  const html = await page.content();
  expect(html).not.toContain('la-contrasenya-del-correu');
});

test('una carpeta es mapa, i el títol es veu mentre s’escriu', async ({ page }) => {
  await enter(page);
  await page.goto('/settings?tab=mail');

  await page.getByTestId('mail-rule-folder').fill('INBOX/Escola');

  // El defecte és només l'assumpte.
  await expect(page.getByTestId('mail-rule-preview')).toContainText('La factura de març');

  // I el predefinit que el brief demana: REMITENT - ASSUMPTE.
  await page.getByTestId('mail-rule-preset').click();
  await expect(page.getByTestId('mail-rule-preview')).toContainText('Escola - La factura de març');

  await page.getByTestId('mail-add-rule').click();

  const regla = page.locator('[data-testid^="mail-rule-"]').filter({ hasText: 'INBOX/Escola' });
  await expect(regla.first()).toBeVisible();
});

test('una variable que no existeix es diu, i no es rebutja', async ({ page }) => {
  await enter(page);
  await page.goto('/settings?tab=mail');

  await page.getByTestId('mail-rule-template').fill('{{remitent}} - {{subject}}');

  /**
   * Es queda **literal** al títol i s'avisa a part. Un buit silenciós faria que una errata
   * sembli un camp buit per sempre, i ningú la trobaria.
   */
  await expect(page.getByTestId('mail-rule-preview')).toContainText('{{remitent}}');
  await expect(page.getByText('remitent', { exact: false }).last()).toBeVisible();
});
