/**
 * El calendari no ensenyava **cap tasca**.
 *
 * «Has d'imaginar el calendari com l'organitzador de tasques de la setmana o el mes», i la
 * graella només sabia d'esdeveniments i de correu. Una tasca amb venciment el dia 20 no
 * sortia enlloc: ni al mes, ni a la setmana, ni al dia. El rail tampoc, perquè el rail és
 * la bústia i una tasca a «Per fer» no hi és.
 *
 * O sigui que el calendari deia que el dia 20 no tenies res el dia que havies de fer la
 * declaració de la renda. Cap prova de servidor ho podia veure: les tasques hi eren i
 * l'API les tornava; el que faltava era que algú les demanés.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Agenda',
  email: 'agenda@example.com',
  password: 'la-contrasenya-de-prova',
};

async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<string> {
  return page.evaluate(
    async ([method, path, body]) => {
      const stored = localStorage.getItem('femho.tokens');
      const token =
        stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
      const res = await fetch(path as string, {
        method: method as string,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      return res.text();
    },
    [method, path, body ?? null] as const,
  );
}

test('una tasca amb data surt al mes, i diu a quina hora', async ({ page }) => {
  await enterAsNew(page, MEU);
  await page.setViewportSize({ width: 1440, height: 900 });

  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const scopeId = scopes[0]!.id;
  await apiCall(page, 'POST', '/api/v1/tasks', {
    scope_id: scopeId,
    title: 'Declaració de la renda',
    status: 'todo',
    position: 'a1',
    due_date: '2026-08-20',
  });
  await apiCall(page, 'POST', '/api/v1/tasks', {
    scope_id: scopeId,
    title: 'Dinar amb la iaia',
    status: 'todo',
    position: 'a2',
    due_date: '2026-08-20',
    due_time: '14:00',
  });

  await page.goto('/calendar?date=2026-08-12');

  const dia = page.getByTestId('day-items-2026-08-20');
  await expect(dia).toContainText('Declaració de la renda');
  // Amb hora, la porta escrita: és el que la fa ordenable entre les cites.
  await expect(dia).toContainText('14:00 Dinar amb la iaia');

  /**
   * **I la setmana diu el mateix que el mes.** Pintava només ocurrències, filtrant una
   * segona vegada pel seu compte: és així com dues vistes de la mateixa setmana acaben
   * ensenyant coses diferents.
   */
  await page.goto('/calendar?date=2026-08-20');
  await page.getByText('Setmanal', { exact: true }).click();
  await expect(page.getByTestId('week-day-2026-08-20')).toContainText('Declaració de la renda');
});

test('una tasca ja feta no omple el mes', async ({ page }) => {
  /**
   * El que ja has fet no és una cosa que t'esperi aquell dia, i el mes s'ompliria del que
   * ja no cal mirar. Es mira a la columna Fet, que per a això té el seu selector de dia.
   */
  await enterAsNew(page, MEU);
  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const feta = JSON.parse(
    await apiCall(page, 'POST', '/api/v1/tasks', {
      scope_id: scopes[0]!.id,
      title: 'Ja la vaig fer',
      status: 'todo',
      position: 'a3',
      due_date: '2026-08-21',
    }),
  ) as { id: string };
  await apiCall(page, 'POST', `/api/v1/tasks/${feta.id}/move`, { status: 'done' });

  await page.goto('/calendar?date=2026-08-12');
  await expect(page.getByTestId('day-items-2026-08-21')).not.toContainText('Ja la vaig fer');
});
