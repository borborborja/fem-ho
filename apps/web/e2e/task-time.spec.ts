import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test('completar pregunta minuts, reobrir afegeix un tram i el rellotge es pot ocultar', async ({
  page,
}) => {
  await enterAsNew(page, {
    name: 'Temps',
    email: 'task-time@example.com',
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!.id;
  await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
    headers,
    data: { time_tracking: true },
  });
  const task = (await (
    await page.request.post('/api/v1/tasks', {
      headers,
      data: { scope_id: scope, title: 'Publicacions amb dedicació', status: 'todo' },
    })
  ).json()) as { id: string };
  await page.reload();
  await page.getByText('Publicacions amb dedicació', { exact: true }).click();
  await page.getByTestId('task-status-done').click();
  const modal = page.getByTestId('completion-time-dialog');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('task-status-todo')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('task-status-done').click();
  await page.getByTestId('completion-minutes').fill('23');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/femho-time/completion-mobile.png' });
  await page.route(`**/api/v1/tasks/${task.id}/move`, (route) => route.abort('failed'), {
    times: 1,
  });
  await modal.getByRole('button', { name: 'Desa el temps i marca com a feta' }).click();
  await expect(modal.getByRole('alert')).toBeVisible();
  expect(
    (
      (await (await page.request.get(`/api/v1/tasks/${task.id}`, { headers })).json()) as {
        status: string;
      }
    ).status,
  ).toBe('todo');
  await modal.getByRole('button', { name: 'Desa el temps i marca com a feta' }).click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('task-status-done')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const badge = page.getByTestId('task-time');
  await expect(badge).toHaveText('23:00');
  await expect(badge).toHaveAttribute('title', /1 tram/);
  await page.getByText('Publicacions amb dedicació', { exact: true }).click();
  await page.getByTestId('task-status-doing').click();
  await expect(page.getByTestId('task-status-doing')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(badge).toHaveAttribute('data-running', 'true');
  const clock = await badge.textContent();
  await expect(badge).not.toHaveText(clock!);
  await expect(badge).toHaveAttribute('title', /2 trams/);
  await page.getByText('Publicacions amb dedicació', { exact: true }).click();
  await page.getByTestId('task-status-done').click();
  await expect(page.getByTestId('task-status-done')).toHaveAttribute('aria-pressed', 'true');
  await expect(modal).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(badge).toHaveAttribute('data-running', 'false');
  await expect(badge).toHaveAttribute('title', /2 trams/);
  await page.screenshot({ path: '/tmp/femho-time/task-cards.png', fullPage: true });
  const report = (await (
    await page.request.get(`/api/v1/sessions?scope_ids=${scope}`, { headers })
  ).json()) as { data: { task_id: string; started_at: string; ended_at: string }[] };
  const sessions = report.data.filter((row) => row.task_id === task.id);
  expect(sessions).toHaveLength(2);
  expect(
    sessions.some((row) => Date.parse(row.ended_at) - Date.parse(row.started_at) === 23 * 60000),
  ).toBe(true);
  await page.goto(`/informes?tab=register&scopes=${scope}&period=all`);
  await expect(
    page.getByTestId('registre-table').getByText('Publicacions amb dedicació', { exact: true }),
  ).toHaveCount(2);
  await expect(
    page.getByTestId('registre-table').getByRole('cell', { name: /^\d+s$/ }),
  ).toHaveCount(1);
  await page.goto('/settings');
  await page.getByTestId('settings-show-task-time').uncheck();
  await expect(page.getByTestId('settings-show-task-time')).toBeEnabled();
  await page.reload();
  await expect(page.getByTestId('settings-show-task-time')).not.toBeChecked();
  await page.getByTestId('settings-back').click();
  await page.getByTestId('view-tasks').click();
  await expect(badge).toHaveCount(0);
  await page.goto('/settings');
  await page.route('**/api/v1/auth/settings', async (route) => {
    if (route.request().method() === 'PATCH') await route.abort('failed');
    else await route.continue();
  });
  await page.getByTestId('settings-show-task-time').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('settings-show-task-time')).not.toBeChecked();
});

test('arrossegar directament a Fet respecta l’opció de cada àmbit', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Sense temps',
    email: 'task-time-off@example.com',
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!.id;
  async function dragToDone() {
    const card = page
      .getByTestId('column-todo')
      .getByRole('button', { name: 'Sense comptar', exact: true });
    await expect(card).toBeVisible();
    const source = (await card.boundingBox())!;
    const target = (await page.getByTestId('column-done').boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 15, source.y + source.height / 2, {
      steps: 5,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
    await page.mouse.up();
  }
  const task = (await (
    await page.request.post('/api/v1/tasks', {
      headers,
      data: { scope_id: scope, title: 'Sense comptar', status: 'todo' },
    })
  ).json()) as { id: string };
  await page.reload();
  await dragToDone();
  await expect(page.getByTestId('column-done')).toContainText('Sense comptar');
  await expect(page.getByTestId('completion-time-dialog')).toHaveCount(0);
  await expect(page.getByTestId('task-time')).toHaveCount(0);
  await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
    headers,
    data: { time_tracking: true },
  });
  await page.request.post(`/api/v1/tasks/${task.id}/move`, { headers, data: { status: 'todo' } });
  await page.reload();
  await dragToDone();
  await expect(page.getByTestId('completion-time-dialog')).toBeVisible();
  await page.getByTestId('completion-minutes').fill('19');
  await page
    .getByTestId('completion-time-dialog')
    .getByRole('button', { name: 'Desa el temps i marca com a feta' })
    .click();
  await expect(page.getByTestId('column-done')).toContainText('Sense comptar');
  await expect(page.getByTestId('task-time')).toHaveText('19:00');
});
