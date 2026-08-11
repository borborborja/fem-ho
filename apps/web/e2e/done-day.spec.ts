/**
 * La columna Fet: quin dia ensenya, i què diu quan no hi ha res.
 *
 * **La columna ensenyava tot l'històric.** `groupDone` existia amb les seves proves i no
 * el cridava ningú; `done_cleared_at` s'escrivia i no el llegia ningú; i l'estat buit no
 * s'arribava a veure mai, perquè amb una sola tasca acabada el mes passat la columna ja
 * no era buida. El mini-calendari s'obria i triar-hi un dia no feia res.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Fetes',
  email: 'fetes@example.com',
  password: 'la-contrasenya-de-prova',
};

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Una tasca acabada avui i una acabada fa tres dies, escrites per l'API. */
async function escenari(page: Page): Promise<string> {
  const bearer = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: bearer })).json()) as {
    id: string;
    kind: string;
  }[];
  const scope = scopes.find((s) => s.kind === 'individual')!.id;

  for (const title of ["D'avui", 'De fa tres dies']) {
    const creada = (await (
      await page.request.post('/api/v1/tasks', {
        headers: bearer,
        data: { scope_id: scope, title, status: 'todo' },
      })
    ).json()) as { id: string };
    await page.request.post(`/api/v1/tasks/${creada.id}/complete`, { headers: bearer });
  }
  return scope;
}

test('la capçalera porta una icona i no un emoji', async ({ page }) => {
  /**
   * Un emoji el dibuixa la font del sistema: canvia de forma i de color a cada
   * plataforma, no hereta `currentColor` i per tant no segueix el tema. Al costat de dos
   * botons de text que sí que el segueixen, es veia com una enganxina.
   */
  await enterAsNew(page, MEU);
  await page.goto('/');

  const boto = page.locator('[data-testid="done-calendar"]');
  await expect(boto).toBeVisible({ timeout: 10_000 });
  await expect(boto.locator('svg')).toHaveCount(1);
  await expect(boto).not.toContainText('📅');
});

test('ensenya el dia que mires i no tot l’històric', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const fet = page.locator('[data-column-status="done"]');
  // Totes dues s'han acabat avui —les acaba la prova—, o sigui que totes dues hi són.
  await expect(fet).toContainText("D'avui", { timeout: 10_000 });

  // I anant a ahir, cap de les dues: es va fer una altra cosa.
  await page.locator('[data-testid="done-calendar"]').click();
  await page.locator(`[data-testid="day-${iso(-1)}"]`).click();

  await expect(fet).not.toContainText("D'avui");
  await expect(fet).toContainText('Cap tasca feta');
});

test('i des d’un altre dia es pot tornar a avui', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);
  const fet = page.locator('[data-column-status="done"]');
  await expect(fet).toContainText("D'avui", { timeout: 10_000 });

  await page.locator('[data-testid="done-calendar"]').click();
  await page.locator(`[data-testid="day-${iso(-2)}"]`).click();

  // Mirant un altre dia, «Netejar» i «Tot avui» no hi són: totes dues parlen d'avui.
  await expect(page.locator('[data-testid="done-clear"]')).toHaveCount(0);
  const tornar = page.locator('[data-testid="done-back-today"]');
  await expect(tornar).toBeVisible();

  await tornar.click();
  await expect(fet).toContainText("D'avui");
  await expect(page.locator('[data-testid="done-clear"]')).toBeVisible();
});

test('no es pot anar a un dia futur', async ({ page }) => {
  /**
   * «Què vaig fer dijous que ve» no vol dir res. I un dia que es pot clicar i sempre surt
   * buit és pitjor que un que no es pot clicar: el primer et fa dubtar de si has perdut
   * una tasca.
   */
  await enterAsNew(page, MEU);
  await page.goto('/');
  await page.locator('[data-testid="done-calendar"]').click();

  const dema = page.locator(`[data-testid="day-${iso(1)}"]`);
  await expect(dema).toBeVisible({ timeout: 10_000 });
  await expect(dema).toBeDisabled();
  await expect(dema).toHaveAttribute('data-beyond', 'true');

  // I avui sí que es pot triar: el límit és inclusiu.
  await expect(page.locator(`[data-testid="day-${iso(0)}"]`)).toBeEnabled();
});
