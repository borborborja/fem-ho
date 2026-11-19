import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

function waitForTaskMove(page: Page, taskId: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/tasks/${taskId}/move`,
  );
}

test('completar pregunta minuts, reobrir afegeix un tram i el rellotge es pot ocultar', async ({
  page,
}, testInfo) => {
  await enterAsNew(page, {
    name: 'Temps',
    email: `task-time-${testInfo.repeatEachIndex}-${testInfo.retry}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!.id;
  const settings = await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
    headers,
    data: { time_tracking: true },
  });
  await expect(settings).toBeOK();
  const created = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scope, title: 'Publicacions amb dedicació', status: 'todo' },
  });
  await expect(created).toBeOK();
  const task = (await created.json()) as { id: string };
  const card = page.getByTestId(`task-${task.id}`);
  const open = card.getByText('Publicacions amb dedicació', { exact: true });
  await page.reload();
  await open.click();
  await page.getByTestId('task-status-done').click();
  const modal = page.getByTestId('completion-time-dialog');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('task-status-todo')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('task-status-done').click();
  await page.getByTestId('completion-minutes').fill('23');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
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
  const completion = waitForTaskMove(page, task.id);
  await modal.getByRole('button', { name: 'Desa el temps i marca com a feta' }).click();
  const completed = await completion;
  expect(completed.ok(), await completed.text()).toBe(true);
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('task-status-done')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const badge = card.getByTestId('task-time');
  await expect(badge).toHaveText('23:00');
  await expect(badge).toHaveAttribute('title', /1 tram/);
  await open.click();
  await page.getByTestId('task-status-doing').click();
  await expect(page.getByTestId('task-status-doing')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(badge).toHaveAttribute('data-running', 'true');
  const clock = await badge.textContent();
  await expect(badge).not.toHaveText(clock!);
  await expect(badge).toHaveAttribute('title', /2 trams/);
  await open.click();
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

test('arrossegar directament a Fet respecta l’opció de cada àmbit', async ({ page }, testInfo) => {
  await enterAsNew(page, {
    name: 'Sense temps',
    email: `task-time-off-${testInfo.repeatEachIndex}-${testInfo.retry}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!.id;
  const created = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scope, title: 'Sense comptar', status: 'todo' },
  });
  await expect(created).toBeOK();
  const task = (await created.json()) as { id: string };
  const todo = page.getByTestId('column-todo');
  const done = page.getByTestId('column-done');
  const doneCard = done.getByTestId(`task-${task.id}`);
  const modal = page.getByTestId('completion-time-dialog');
  async function dragToDone() {
    const card = todo
      .getByTestId(`task-${task.id}`)
      .getByRole('button', { name: 'Sense comptar', exact: true });
    await expect(card).toBeVisible();
    await expect(done).toBeVisible();
    const source = (await card.boundingBox())!;
    const target = (await done.boundingBox())!;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 15, source.y + source.height / 2, {
      steps: 5,
    });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 20 });
    await page.mouse.up();
  }
  await page.reload();
  const firstMove = waitForTaskMove(page, task.id);
  await dragToDone();
  const moved = await firstMove;
  expect(moved.ok(), await moved.text()).toBe(true);
  await expect(doneCard).toBeVisible();
  await expect(modal).toHaveCount(0);
  await expect(doneCard.getByTestId('task-time')).toHaveCount(0);
  // El moviment ja és al servidor. Esperem que el navegador també el tregui de la cua.
  await expect(page.getByTestId('sync-pill').filter({ hasText: 'Pendent de pujar' })).toBeHidden();
  const settings = await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
    headers,
    data: { time_tracking: true },
  });
  await expect(settings).toBeOK();
  const reopened = await page.request.post(`/api/v1/tasks/${task.id}/move`, {
    headers,
    data: { status: 'todo' },
  });
  await expect(reopened).toBeOK();
  await page.reload();
  await dragToDone();
  await expect(modal).toBeVisible();
  await page.getByTestId('completion-minutes').fill('19');
  const completion = waitForTaskMove(page, task.id);
  await modal.getByRole('button', { name: 'Desa el temps i marca com a feta' }).click();
  const completed = await completion;
  expect(completed.ok(), await completed.text()).toBe(true);
  await expect(modal).toBeHidden();
  await expect(doneCard).toBeVisible();
  await expect(doneCard.getByTestId('task-time')).toHaveText('19:00');
});
