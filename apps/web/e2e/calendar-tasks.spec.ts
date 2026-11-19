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
import { generatePosition } from '@fem-ho/contracts';
import { v7 as uuidv7 } from 'uuid';
import { enter, enterAsNew, token } from './entrar.js';

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
  await enter(page, MEU);
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

test('canviar la data de l’enllaç actualitza la graella sense remuntar la pantalla', async ({
  page,
}) => {
  await enter(page, MEU);
  await page.goto('/calendar?date=2026-08-20');
  await expect(page.getByTestId('day-items-2026-08-20')).toBeVisible();
  await page.evaluate(() => {
    window.history.pushState(null, '', '/calendar?date=2026-09-09');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByTestId('day-items-2026-08-20')).toHaveCount(0);
  await page.goBack();
  await expect(page.getByTestId('day-items-2026-08-20')).toBeVisible();
});

test('el dia i l’hora de les cites segueixen el fus del perfil', async ({ page }) => {
  await enter(page, MEU);
  const headers = { authorization: `Bearer ${await token(page)}` };
  expect(
    (
      await page.request.patch('/api/v1/auth/me', { headers, data: { timezone: 'Europe/Madrid' } })
    ).ok(),
  ).toBe(true);
  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const calendar = JSON.parse(
    await apiCall(page, 'POST', '/api/v1/calendars', {
      scope_id: scopes[0]!.id,
      name: 'Canvi de dia',
      kind: 'events',
    }),
  ) as { id: string };
  const event = await page.request.post('/api/v1/events', {
    headers,
    data: {
      calendar_id: calendar.id,
      uid: 'mitjanit-perfil',
      summary: 'Cita de matinada',
      starts_at: '2026-11-24T23:30:00.000Z',
      ends_at: '2026-11-25T00:00:00.000Z',
    },
  });
  expect(event.status()).toBe(201);
  await page.goto('/calendar?date=2026-11-25');
  await expect(page.getByTestId('day-items-2026-11-25')).toContainText('Cita de matinada');
  await expect(page.getByTestId('day-items-2026-11-24')).not.toContainText('Cita de matinada');
  await page.getByTestId('calendar-mode-day').click();
  await expect(page.getByTestId('calendar-day')).toContainText('Cita de matinada');
  await expect(page.getByTestId('calendar-day')).toContainText('0:30');
});

test('el calendari carrega totes les pàgines dels àmbits seleccionats', async ({ page }) => {
  await enter(page, MEU);
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const selected = await page.request.post('/api/v1/scopes', {
    headers,
    data: { name: 'Segona agenda', color: '--plou-blue' },
  });
  expect(selected.status()).toBe(201);
  const other = (await selected.json()) as { id: string };
  const day = '2026-11-26';
  let position: string | null = null;
  const operations = Array.from({ length: 201 }, (_, index) => {
    position = generatePosition(position, null);
    return {
      op_id: uuidv7(),
      entity: 'task',
      op: 'create',
      id: uuidv7(),
      base_version: 0,
      data: {
        scope_id: index % 2 === 0 ? scopes[0]!.id : other.id,
        due_date: day,
        status: 'todo',
        position,
        title: `Tasca paginada ${index + 1}`,
      },
    };
  });
  for (let offset = 0; offset < operations.length; offset += 50) {
    const response = await page.request.post('/api/v1/sync/batch', {
      headers,
      data: { operations: operations.slice(offset, offset + 50) },
    });
    expect(response.ok()).toBe(true);
    expect(
      ((await response.json()) as { results: { status: string }[] }).results.every(
        ({ status }) => status === 'ok',
      ),
    ).toBe(true);
  }
  const query = new URLSearchParams({ date: day, scopes: `${scopes[0]!.id},${other.id}` });
  await page.goto(`/calendar?${query}`);
  await page.getByTestId('calendar-mode-day').click();
  await expect(page.getByTestId('calendar-day')).toContainText('Tasca paginada 201');
});
