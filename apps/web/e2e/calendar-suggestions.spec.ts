import { expect, test, type Locator, type Page } from '@playwright/test';
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
  const regular = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scope.id, title: 'Tasca del tauler', status: 'todo' },
  });
  await expect(regular).toBeOK();
  const { id: regularId } = (await regular.json()) as { id: string };
  const scheduled = now.getTime() - 60_000;
  for (const title of [
    'Acabada abans',
    'Inici previst',
    'Inici ara',
    'Ajornada',
    'Interval curt',
  ]) {
    const end = scheduled + (title === 'Interval curt' ? 24_000 : 1_800_000);
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
  const later = await page.request.post('/api/v1/events', {
    headers,
    data: {
      calendar_id: calendarId,
      summary: 'Cita amb una tasca prèvia',
      starts_at: new Date(scheduled + 7_200_000).toISOString(),
      ends_at: new Date(scheduled + 7_800_000).toISOString(),
    },
  });
  await expect(later).toBeOK();
  const { uid } = (await later.json()) as { uid: string };
  await expect(
    await page.request.post('/api/v1/tasks', {
      headers,
      data: {
        scope_id: scope.id,
        title: 'Tasca vinculada',
        status: 'todo',
        source_event: { calendar_id: calendarId, uid },
      },
    }),
  ).toBeOK();

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
  await page.clock.install({ time: scheduled - 30_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(todo.getByText(scope.name, { exact: true })).toBeVisible();
  await expect(early.getByTestId('calendar-task-origin')).toHaveAccessibleName('Origen calendari');
  await expect(early.getByRole('button', { name: /Ja he començat/ })).toHaveCount(0);
  await expect(early.getByRole('button', { name: 'Comença ara' })).toHaveCount(0);
  await expect(early).toHaveCSS('border-inline-start-width', '4px');
  const cardBackground = (locator: Locator) =>
    locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  const ordinary = todo.getByTestId(`task-${regularId}`).locator('[data-status="todo"]');
  await expect(ordinary).toBeVisible();
  expect(await cardBackground(early)).not.toBe(await cardBackground(ordinary));
  await todo.screenshot({ path: info.outputPath('propostes-per-fer.png') });
  await early.getByRole('button', { name: 'Moure a Fent' }).click();
  const earlyCard = doing.getByTestId(/^task-/).filter({ hasText: 'Acabada abans' });
  await expect(earlyCard.getByTestId('calendar-task-origin')).toBeVisible();
  await expect(earlyCard.locator('[data-status="doing"]')).toHaveCSS(
    'border-inline-start-width',
    '3px',
  );
  await earlyCard.getByTestId('card-toggle-done').click();
  await expect(done.getByText('Acabada abans', { exact: true })).toBeVisible();

  await page.clock.fastForward(30_001);
  const planned = doing.getByRole('article', { name: 'Inici previst' });
  await expect(planned).toHaveAttribute('data-calendar-active', 'true');
  await expect(planned).toHaveCSS('border-style', 'dashed');
  await expect(planned).toHaveCSS('border-inline-start-width', '2px');
  await expect(planned).toHaveCSS('opacity', '1');
  await expect(doing.getByRole('button', { name: 'No l’estic fent' })).toHaveCount(0);
  await expect(todo.getByRole('article', { name: 'Inici previst' })).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Acabada abans' })).toHaveCount(0);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByTestId('kanban')).toHaveAttribute('data-layout', 'scroll');
  await doing.evaluate((column) => column.scrollIntoView({ block: 'nearest', inline: 'start' }));
  await expect(planned).toBeInViewport({ ratio: 0.98 });
  await expect(page.getByTestId('board-screen')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('proposta-fent-fosc-360.png') });
  await page.setViewportSize({ width: 1440, height: 980 });
  await expect(page.getByTestId('kanban')).toHaveAttribute('data-layout', 'grid');
  const postponing = doing.getByTestId('calendar-suggestion-drag').filter({ hasText: 'Ajornada' });
  await dragSuggestion(page, postponing, done, false);
  await expect(postponing).toBeVisible();
  await dragSuggestion(page, postponing, todo, true);
  const postponed = todo.getByRole('article', { name: 'Ajornada' });
  await expect(postponed.getByRole('button')).toHaveCount(1);
  await expect(postponed.getByRole('button', { name: 'Moure a Fent' })).toBeVisible();
  await expect
    .poll(async () => {
      const { items } = (await (await page.request.get(path, { headers })).json()) as {
        items: { title: string; declined: boolean }[];
      };
      return items.find(({ title }) => title === 'Ajornada')?.declined;
    })
    .toBe(true);

  await page.clock.fastForward(24_000);
  const expired = todo.getByRole('article', { name: 'Interval curt' });
  await expect(expired.getByRole('button')).toHaveCount(1);
  await expect(expired.getByRole('button', { name: 'Moure a Fent' })).toBeVisible();
  const expiredDrag = todo
    .getByTestId('calendar-suggestion-drag')
    .filter({ hasText: 'Interval curt' });
  await expiredDrag.focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  // El sensor registra la tecla següent en el torn de rellotge posterior a agafar la targeta.
  await page.clock.runFor(32);
  await page.keyboard.press('ArrowRight');
  await expect(doing).toHaveAttribute('data-drop-target', 'true');
  await page.keyboard.press('Space');
  await expect(doing.getByTestId(/^task-/).filter({ hasText: 'Interval curt' })).toBeVisible();
  const linked = todo.getByRole('article', { name: 'Tasca vinculada' });
  await linked.getByRole('button', { name: /Tasca vinculada/ }).click();
  await expect(page.getByRole('dialog', { name: 'Tasca vinculada' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
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

async function dragSuggestion(page: Page, card: Locator, target: Locator, allowed: boolean) {
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('No es poden mesurar la proposta i la columna');
  await page.mouse.move(from.x + 20, from.y + 16);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 21, { steps: 6 });
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 10 });
  await expect(target).toHaveAttribute('data-drop-target', String(allowed));
  await page.mouse.up();
}

async function sessions(page: Page, headers: Record<string, string>, scope: string) {
  const response = await page.request.get(`/api/v1/sessions?scope_ids=${scope}`, { headers });
  await expect(response).toBeOK();
  const { data } = (await response.json()) as {
    data: { task_title: string; started_at: string }[];
  };
  return Object.fromEntries(data.map((row) => [row.task_title, row.started_at]));
}
