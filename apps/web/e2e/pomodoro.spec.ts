import { expect, test, type Page } from '@playwright/test';
import type { PomodoroSnapshot } from '@fem-ho/contracts';
import { enterAsNew, token } from './entrar.js';

const account = (name: string) => ({
  name,
  email: `pomodoro-${name}@example.com`,
  password: 'la-contrasenya-de-prova',
});

async function serverState(page: Page, authorization: string): Promise<PomodoroSnapshot> {
  const result = await page.request.get('/api/v1/pomodoro', { headers: { authorization } });
  expect(result.ok()).toBe(true);
  return (await result.json()) as PomodoroSnapshot;
}

test('Pomodoro conserva la cua i el moviment offline; els dos estils comparteixen el rellotge', async ({
  page,
  context,
}, info) => {
  await enterAsNew(page, account('offline'));
  const authorization = `Bearer ${await token(page)}`;
  const headers = { authorization };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const [first, second] = await Promise.all(
    ['Preparar la sortida', 'Revisar el pressupost'].map(async (title) => {
      const result = await page.request.post('/api/v1/tasks', {
        headers,
        data: { scope_id: scopes[0]!.id, title, status: 'todo' },
      });
      expect(result.status()).toBe(201);
      return (await result.json()) as { id: string; title: string };
    }),
  );

  await expect(page.getByTestId('pomodoro-open')).toHaveCount(0);
  await page.goto('/settings');
  const enabled = page.getByTestId('settings-pomodoro-enabled');
  await expect(enabled).not.toBeChecked();
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect
    .poll(async () => (await serverState(page, authorization)).settings.enabled)
    .toBe(true);
  const duration = page.getByTestId('settings-pomodoro-focus_minutes');
  await expect(duration).toHaveValue('25');
  await duration.fill('1');
  await duration.press('Enter');
  await expect
    .poll(async () => (await serverState(page, authorization)).settings.focus_minutes)
    .toBe(1);

  await page.getByTestId('settings-back').click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.getByTestId('pomodoro-open').click();
  const dialog = page.getByTestId('pomodoro-panel');
  const tomato = dialog.getByTestId('pomodoro-tomato');
  await expect(tomato).toBeVisible();
  expect(await tomato.evaluate((node) => getComputedStyle(node).maskImage)).not.toBe('none');
  await expect(dialog.getByTestId('pomodoro-countdown')).toHaveText('01:00');
  const add = dialog.getByTestId('pomodoro-add-task');
  await add.selectOption(first!.id);
  await expect(dialog.getByTestId(`pomodoro-item-${first!.id}`)).toBeVisible();
  await add.selectOption(second!.id);
  await dialog
    .getByTestId(`pomodoro-item-${second!.id}`)
    .getByRole('button', { name: 'Puja' })
    .click();
  await expect
    .poll(async () => (await serverState(page, authorization)).queue)
    .toEqual([second!.id, first!.id]);
  await expect(dialog.getByTestId('pomodoro-choose-task')).toHaveValue(second!.id);
  await page.screenshot({ path: info.outputPath('pomodoro-desktop.png') });

  await context.setOffline(true);
  await dialog.getByTestId('pomodoro-start').click();
  await expect(dialog.getByTestId('pomodoro-pause')).toBeVisible();
  await dialog.getByTestId('pomodoro-close-panel').click();
  await expect(page.getByTestId('column-doing')).toContainText(second!.title);
  expect((await serverState(page, authorization)).timer).toBeNull();
  await page.reload();
  await expect(page.getByTestId('column-doing')).toContainText(second!.title);
  await page.getByTestId('pomodoro-open').click();
  await expect(dialog.getByTestId('pomodoro-pause')).toBeVisible();
  await context.setOffline(false);
  await expect
    .poll(async () => (await serverState(page, authorization)).timer?.task_id)
    .toBe(second!.id);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/tasks/${second!.id}`, { headers });
      return ((await response.json()) as { status: string }).status;
    })
    .toBe('doing');

  await dialog.getByTestId('pomodoro-close-panel').click();
  await page.goto('/settings');
  await page.getByTestId('settings-pomodoro-mode').selectOption('serious');
  await expect
    .poll(async () => (await serverState(page, authorization)).settings.mode)
    .toBe('serious');
  await page.getByTestId('settings-back').click();
  await page.getByTestId('pomodoro-open').click();
  await expect(dialog).toHaveAttribute('data-mode', 'serious');
  await expect(dialog.getByTestId('pomodoro-tomato')).toHaveCount(0);
  await dialog.getByTestId('pomodoro-pause').click();
  await expect(dialog.getByTestId('pomodoro-start')).toBeVisible();
  await expect
    .poll(async () => (await serverState(page, authorization)).timer?.status)
    .toBe('paused');
  await dialog.getByTestId('pomodoro-done').click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/tasks/${second!.id}`, { headers });
      return ((await response.json()) as { status: string }).status;
    })
    .toBe('done');
});

test('un Pomodoro activat des d’un altre client apareix sense recarregar', async ({
  page,
  browser,
}, info) => {
  const who = account('shared');
  await enterAsNew(page, who);
  await expect(page.getByTestId('pomodoro-open')).toHaveCount(0);
  const other = await browser.newContext({ locale: 'ca-ES' });
  try {
    const client = await other.newPage();
    await enterAsNew(client, who);
    const authorization = `Bearer ${await token(client)}`;
    await client.goto('/settings');
    await client.getByTestId('settings-pomodoro-enabled').click();
    await expect
      .poll(async () => (await serverState(client, authorization)).settings.enabled)
      .toBe(true);
    await expect(page.getByTestId('pomodoro-open')).toBeVisible({ timeout: 20_000 });
    await page.setViewportSize({ width: 320, height: 720 });
    await page.getByTestId('pomodoro-open').click();
    await expect(page.getByTestId('pomodoro-ring')).toBeVisible();
    await page.screenshot({ path: info.outputPath('pomodoro-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await other.close();
  }
});
