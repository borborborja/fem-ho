import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

const path = '/api/v1/calendar-task-suggestions';

test('les propostes passen de Per fer a Fent a l’hora i desen l’inici escollit', async ({
  page,
  context,
}, info) => {
  await enterAsNew(page, {
    name: 'Dia de calendari',
    email: `calendar-suggestions-${info.repeatEachIndex}-${info.retry}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
    name: string;
    kind: string;
  }[];
  const scope = scopes.find((item) => item.kind === 'individual')!;
  const second = await page.request.post('/api/v1/scopes', {
    headers,
    data: { name: 'Segon àmbit', kind: 'individual', color: '--plou-orange' },
  });
  await expect(second).toBeOK();
  const { id: secondId } = (await second.json()) as { id: string };
  const board = `/board?scopes=${scope.id},${secondId}`;
  const now = new Date();
  // El dia de la prova ha de ser el mateix quan el servidor consulta i el navegador torna enrere.
  const shift = 12 - now.getUTCHours();
  const timezone = shift === 0 ? 'Etc/UTC' : `Etc/GMT${shift < 0 ? '+' : '-'}${Math.abs(shift)}`;
  await expect(
    await page.request.patch('/api/v1/auth/me', { headers, data: { timezone, theme: 'dark' } }),
  ).toBeOK();
  await expect(
    await page.request.patch(`/api/v1/scopes/${scope.id}/settings`, {
      headers,
      data: { time_tracking: true },
    }),
  ).toBeOK();
  const calendar = await page.request.post('/api/v1/calendars', {
    headers,
    data: { scope_id: scope.id, name: 'Agenda de treball', kind: 'events', origin: 'local' },
  });
  await expect(calendar).toBeOK();
  const { id: calendarId } = (await calendar.json()) as { id: string };
  const scheduled = now.getTime() - 60_000;
  for (const title of [
    'Acabada abans',
    'Inici previst',
    'Inici ara',
    'Ajornada',
    'Interval curt',
  ]) {
    const end = scheduled + (title === 'Interval curt' ? 8000 : 1_800_000);
    await expect(
      await page.request.post('/api/v1/events', {
        headers,
        data: {
          calendar_id: calendarId,
          summary: title,
          starts_at: new Date(scheduled).toISOString(),
          ends_at: new Date(end).toISOString(),
        },
      }),
    ).toBeOK();
  }

  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(board);
  await expect(page.getByTestId('board-screen')).toBeVisible();
  await expect(page.getByTestId('calendar-suggestion')).toHaveCount(0);
  await page.goto('/settings');
  const toggle = page.getByTestId('settings-calendar-suggestions');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect
    .poll(
      async () =>
        (
          (await (await page.request.get(path, { headers })).json()) as {
            enabled: boolean;
          }
        ).enabled,
    )
    .toBe(true);

  await page.goto(board);
  const todo = page.getByTestId('column-todo');
  const doing = page.getByTestId('column-doing');
  const done = page.getByTestId('column-done');
  const early = todo.getByRole('article', { name: 'Acabada abans' });
  await expect(doing.getByRole('article', { name: 'Inici previst' })).toBeVisible();
  await page.clock.install({ time: scheduled - 10_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(todo.getByText(scope.name, { exact: true })).toBeVisible();
  await expect(early.getByTestId('calendar-task-origin')).toHaveAccessibleName('Origen calendari');
  await expect(early.getByRole('button', { name: /Ja he començat/ })).toHaveCount(0);
  await early.getByRole('button', { name: 'Comença ara' }).click();
  const earlyCard = doing.getByTestId(/^task-/).filter({ hasText: 'Acabada abans' });
  await expect(earlyCard.getByTestId('calendar-task-origin')).toBeVisible();
  await earlyCard.getByTestId('card-toggle-done').click();
  await expect(done.getByText('Acabada abans', { exact: true })).toBeVisible();

  await page.clock.fastForward(10_001);
  const planned = doing.getByRole('article', { name: 'Inici previst' });
  await expect(planned).toHaveAttribute('data-calendar-active', 'true');
  await expect(todo.getByRole('article', { name: 'Inici previst' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Acabada abans' })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId('kanban')).toHaveAttribute('data-layout', 'scroll');
  await doing.evaluate((column) => column.scrollIntoView({ block: 'nearest', inline: 'start' }));
  await expect(planned).toBeInViewport({ ratio: 0.98 });
  await page.screenshot({ path: info.outputPath('proposta-fent-fosc-360.png') });
  await page.setViewportSize({ width: 1440, height: 980 });
  await doing
    .getByRole('article', { name: 'Ajornada' })
    .getByRole('button', { name: 'No l’estic fent' })
    .click();
  await expect(todo.getByRole('article', { name: 'Ajornada' })).toBeVisible();

  await page.clock.fastForward(8_000);
  await expect(todo.getByRole('article', { name: 'Interval curt' })).toBeVisible();
  const actionAt = await page.evaluate(() => Date.now());
  await doing
    .getByRole('article', { name: 'Inici ara' })
    .getByRole('button', { name: 'Comença ara' })
    .click();
  await expect(doing.getByTestId(/^task-/).filter({ hasText: 'Inici ara' })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await context.setOffline(true);
  await planned.getByRole('button', { name: /Ja he començat a les/ }).click();
  await expect(doing.getByTestId(/^task-/).filter({ hasText: 'Inici previst' })).toBeVisible();
  await page.reload();
  await expect(doing.getByTestId(/^task-/).filter({ hasText: 'Inici previst' })).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => sessions(page, headers, scope.id))
    .toEqual(
      expect.objectContaining({
        'Inici ara': expect.any(String),
        'Inici previst': new Date(scheduled).toISOString(),
      }),
    );
  const nowStarted = Date.parse((await sessions(page, headers, scope.id))['Inici ara']!);
  expect(nowStarted).toBeGreaterThanOrEqual(actionAt);
  expect(nowStarted - actionAt).toBeLessThan(2000);

  await page.setViewportSize({ width: 320, height: 790 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await todo.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('propostes-mobile.png') });
  await page.goto('/settings');
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
  await page.goto(board);
  await expect(page.getByTestId('calendar-suggestion')).toHaveCount(0);
  await expect(doing.getByText('Inici previst', { exact: true })).toBeVisible();
});

async function sessions(page: Page, headers: Record<string, string>, scope: string) {
  const response = await page.request.get(`/api/v1/sessions?scope_ids=${scope}`, { headers });
  await expect(response).toBeOK();
  const { data } = (await response.json()) as {
    data: { task_title: string; started_at: string }[];
  };
  return Object.fromEntries(data.map((row) => [row.task_title, row.started_at]));
}
