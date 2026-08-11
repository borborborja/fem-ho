/**
 * Afegir des del calendari, i l'ordre del commutador.
 *
 * **El calendari va a l'esquerra i les tasques a la dreta**, i no és estètic: el calendari
 * és el marc —què tens aquests dies— i les tasques són el que en fas. D'esquerra a dreta,
 * primer el que ve i després la feina.
 *
 * I el `+` d'un dia no és una drecera cosmètica: sense ell, posar una tasca a dijous era
 * crear-la sense dia i arrossegar-la, o obrir el formulari sencer per un títol.
 */

import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Calendari',
  email: 'calendariadd@example.com',
  password: 'la-contrasenya-de-prova',
};

function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

test('el commutador porta el calendari a l’esquerra', async ({ page }) => {
  await enterAsNew(page, MEU);

  const botons = page.locator('[data-testid="view-switch"] button');
  await expect(botons.first()).toHaveAttribute('data-testid', 'view-calendar');
  await expect(botons.last()).toHaveAttribute('data-testid', 'view-tasks');
});

test('passar per sobre d’un dia el contorna i hi ofereix un +', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.goto('/calendar');

  const dia = page.locator(`[data-testid="day-${iso(1)}"]`);
  await expect(dia).toBeVisible({ timeout: 10_000 });

  // Sense ratolí a sobre no hi ha ni contorn ni botó: és un estat de passada.
  await expect(dia.locator('[data-testid="day-add"]')).toHaveCount(0);

  await dia.hover();
  await expect(dia).toHaveAttribute('data-hovered', 'true');
  await expect(dia.locator('[data-testid="day-add"]')).toBeVisible();

  // I el contorn es dibuixa de debò, amb el token i no amb un color escrit a mà.
  const ombra = await dia.evaluate((node) => getComputedStyle(node).boxShadow);
  expect(ombra).not.toBe('none');
});

test('i el + situa el rail en aquell dia', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.goto('/calendar');

  const dema = page.locator(`[data-testid="day-${iso(1)}"]`);
  await expect(dema).toBeVisible({ timeout: 10_000 });
  await dema.hover();
  await dema.locator('[data-testid="day-add"]').click();

  // El rail passa a ensenyar aquell dia: crear en un dia que no es veu semblaria que no
  // s'ha creat res.
  await expect(dema).toHaveAttribute('data-selected', 'true');
});

test('el rail té una afegida ràpida a cada bloc, i creen coses diferents', async ({ page }) => {
  /**
   * `docs/02` §5 en demana una per secció i no n'hi havia cap. **El que es crea depèn de
   * sota quin epígraf escrius**: la del dia neix amb data i la de sota, sense. Un sol camp
   * al peu de la columna no podria dir a quin dels dos blocs va.
   */
  await enterAsNew(page, MEU);
  await page.goto('/calendar');

  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toBeVisible({ timeout: 10_000 });
  await expect(rail.locator('[data-testid="quick-add-inbox"]')).toHaveCount(2);

  // La de dalt crea amb el dia seleccionat; la de baix, sense dia.
  const camps = rail.locator('[data-testid="quick-add-inbox"] input');
  await camps.first().fill('Amb dia');
  await camps.first().press('Enter');
  await camps.last().fill('Sense cap dia');
  await camps.last().press('Enter');

  await expect(rail).toContainText('Amb dia');
  await expect(rail).toContainText('Sense cap dia');

  // I es comprova contra l'API, que és qui sap si porten data.
  const bearer = { authorization: `Bearer ${await token(page)}` };
  const totes = (await (
    await page.request.get('/api/v1/tasks?status=inbox', { headers: bearer })
  ).json()) as { data: { title: string; due_date: string | null }[] };

  expect(totes.data.find((t) => t.title === 'Amb dia')?.due_date).not.toBeNull();
  expect(totes.data.find((t) => t.title === 'Sense cap dia')?.due_date).toBeNull();
});

test('a la vista diària el botó és permanent, no de passada', async ({ page }) => {
  /**
   * Al mes i a la setmana hi ha trenta o set cel·les i un `+` a cadascuna seria soroll:
   * per això surt en passar-hi per sobre. A la diària n'hi ha una, i amagar l'acció
   * darrere del ratolí seria amagar-la per res — i en una pantalla tàctil, on no hi ha
   * `hover`, amagar-la del tot.
   */
  await enterAsNew(page, MEU);
  await page.goto('/calendar');
  await page.locator('[data-testid="calendar-mode-day"]').click();

  const boto = page.locator('[data-testid="calendar-day"] [data-testid="day-add"]');
  // Sense passar-hi per sobre: hi és igualment.
  await expect(boto).toBeVisible({ timeout: 10_000 });

  // I porta on s'escriu, que és el camp del dia al rail.
  await boto.click();
  await expect(page.locator('[data-testid="quick-add-inbox"] input').first()).toBeFocused();
});
