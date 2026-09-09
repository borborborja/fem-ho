import { expect, test, type Page } from '@playwright/test';
import { enter, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

async function createTask(page: Page, fromEvent = false) {
  await enter(page);
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scopeId = scopes[0]!.id;
  let sourceEvent: { calendar_id: string; uid: string } | undefined;
  if (fromEvent) {
    const calendarResponse = await page.request.post('/api/v1/calendars', {
      headers,
      data: { scope_id: scopeId, name: 'Calendari de la paperera', kind: 'events' },
    });
    expect(calendarResponse.ok()).toBe(true);
    const calendar = (await calendarResponse.json()) as { id: string };
    sourceEvent = { calendar_id: calendar.id, uid: 'paperera-cita' };
    const eventResponse = await page.request.post('/api/v1/events', {
      headers,
      data: {
        ...sourceEvent,
        summary: 'Cita que es conserva',
        starts_at: '2026-09-09T10:00:00.000Z',
        ends_at: '2026-09-09T11:00:00.000Z',
      },
    });
    expect(eventResponse.ok()).toBe(true);
  }
  const response = await page.request.post('/api/v1/tasks', {
    headers,
    data: {
      scope_id: scopeId,
      title: 'Tasca de la paperera',
      status: 'todo',
      ...(sourceEvent === undefined ? {} : { source_event: sourceEvent }),
    },
  });
  expect(response.ok()).toBe(true);
  const task = (await response.json()) as { id: string };
  await page.goto(`/board?scopes=${scopeId}`);
  const card = page.getByTestId(`task-${task.id}`);
  await expect(card).toBeVisible();
  return { card, headers, task };
}

test('paperera al hover: cancel·lar i Escape conserven la tasca', async ({ page }, testInfo) => {
  const { card, headers, task } = await createTask(page);
  await page.mouse.move(0, 0);
  await expect(card.getByTestId('card-delete')).toHaveCSS('opacity', '0');
  await card.hover();
  await expect(card.getByTestId('card-delete')).toHaveCSS('opacity', '1');
  await card.getByTestId('card-delete').click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('definitivament');
  await expect(dialog).toContainText('l’esdeveniment es conservarà');
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  await expect(page.getByTestId('card-delete-cancel')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('confirmacio-paperera.png') });
  await page.getByTestId('card-delete-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toBeVisible();
  await card.hover();
  await card.getByTestId('card-delete').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await page.request.get(`/api/v1/tasks/${task.id}`, { headers })).status()).toBe(200);
});

test('confirmar elimina la tasca però conserva la cita al calendari', async ({ page }) => {
  const { card, headers, task } = await createTask(page, true);
  await card.hover();
  await card.getByTestId('card-delete').click();
  await page.getByTestId('card-delete-confirm').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect((await page.request.get(`/api/v1/tasks/${task.id}`, { headers })).status()).toBe(404);
  await page.goto('/calendar?date=2026-09-09');
  await expect(page.getByTestId('day-items-2026-09-09')).toContainText('Cita que es conserva');
  await page.reload();
  await expect(page.getByTestId('day-items-2026-09-09')).toContainText('Cita que es conserva');
});

test('si falla la petició, es mostra l’error i es pot reintentar', async ({ page }) => {
  const { card, task } = await createTask(page);
  const url = `**/api/v1/tasks/${task.id}`;
  await page.route(url, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    } else await route.continue();
  });
  await card.hover();
  await card.getByTestId('card-delete').click();
  await page.getByTestId('card-delete-confirm').click();
  await expect(page.getByRole('alertdialog').getByRole('alert')).toBeVisible();
  await expect(card).toBeVisible();
  await page.unroute(url);
  await page.getByTestId('card-delete-confirm').click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

test('la paperera també és accessible amb teclat i al mòbil', async ({ page }) => {
  const { card } = await createTask(page);
  const remove = card.getByTestId('card-delete');
  await page.mouse.move(0, 0);
  await remove.focus();
  await expect(remove).toHaveCSS('opacity', '1');
  await remove.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('topbar').click({ position: { x: 5, y: 5 } });
  await expect(remove).toHaveCSS('opacity', '1');
});
