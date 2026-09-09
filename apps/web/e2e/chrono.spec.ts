import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';
async function setup(page: Page, name: string) {
  await enterAsNew(page, {
    name,
    email: `chrono-${name}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scope = (
    (await (await page.request.get('/api/v1/scopes', { headers })).json()) as { id: string }[]
  )[0]!.id;
  await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
    headers,
    data: { time_tracking: true },
  });
  const makeProject = async (name: string) =>
    (
      (await (
        await page.request.post('/api/v1/projects', { headers, data: { scope_id: scope, name } })
      ).json()) as { id: string }
    ).id;
  const project = await makeProject('Projecte A'),
    target = await makeProject('Projecte B');
  const task = (
    (await (
      await page.request.post('/api/v1/tasks', {
        headers,
        data: { scope_id: scope, project_id: project, title: 'Bloc comprovable' },
      })
    ).json()) as { id: string }
  ).id;
  const session = (
    (await (
      await page.request.post('/api/v1/sessions', {
        headers,
        data: {
          task_id: task,
          started_at: '2026-07-23T08:00:00Z',
          ended_at: '2026-07-23T09:00:00Z',
        },
      })
    ).json()) as { id: string }
  ).id;
  const url = `/informes?tab=register&view=chrono&day=2026-07-23&scopes=${scope}`;
  await page.goto(url);
  await expect(page.getByTestId(`chrono-block-${session}`)).toBeVisible();
  const getSession = async () =>
    (
      (await (
        await page.request.get(`/api/v1/sessions?scope_ids=${scope}`, { headers })
      ).json()) as {
        data: {
          id: string;
          started_at: string;
          ended_at: string | null;
          minutes: number;
          project_id: string | null;
          can_edit: boolean;
          version: number;
        }[];
      }
    ).data.find((e) => e.id === session)!;
  return { headers, scope, project, target, task, session, url, getSession };
}
async function drag(page: Page, id: string, minutes: number) {
  const handle = page.getByTestId(id);
  await handle.scrollIntoViewIfNeeded();
  const box = (await handle.boundingBox())!;
  const track = (await handle.locator('xpath=ancestor::*[@data-chrono-lane]').boundingBox())!;
  const delta = (track.width / 600) * minutes;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}
test('les dues vores i el cos desen els minuts exactes; Escape cancel·la', async ({ page }) => {
  const f = await setup(page, 'edges');
  await drag(page, `chrono-resize-right-${f.session}`, 60);
  await expect.poll(async () => (await f.getSession()).minutes).toBe(120);
  await expect(page.getByTestId(`chrono-block-${f.session}`)).toContainText('2h');
  await drag(page, `chrono-block-${f.session}`, 30);
  await expect.poll(async () => (await f.getSession()).started_at).toBe('2026-07-23T08:30:00.000Z');
  expect((await f.getSession()).minutes).toBe(120);
  await drag(page, `chrono-resize-left-${f.session}`, 30);
  await expect.poll(async () => (await f.getSession()).minutes).toBe(90);
  const before = await f.getSession();
  const box = (await page.getByTestId(`chrono-resize-right-${f.session}`).boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 10);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await f.getSession()).toEqual(before);
  await page.screenshot({ path: '/tmp/femho-reporting/chrono-desktop.png', fullPage: true });
});
test('dibuixar crea una tasca feta i moure de fila demana confirmació', async ({ page }) => {
  const f = await setup(page, 'draw');
  const track = page.locator(`[data-chrono-lane="${f.scope}/${f.project}"]`);
  await track.scrollIntoViewIfNeeded();
  const box = (await track.boundingBox())!;
  const x = box.x + box.width * 0.6;
  await page.mouse.move(x, box.y + box.height - 4);
  await page.mouse.down();
  await page.mouse.move(x + box.width / 10, box.y + box.height - 4, { steps: 8 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Títol', { exact: true }).fill('Dibuixat i fet');
  await dialog.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.chrono-block').filter({ hasText: 'Dibuixat i fet' })).toContainText(
    '1h',
  );
  const tasks = (await (
    await page.request.get(`/api/v1/reports/tasks?scope_ids=${f.scope}&metric=completed`, {
      headers: f.headers,
    })
  ).json()) as { data: { title: string; completed_at: string }[] };
  expect(tasks.data.some((task) => task.title === 'Dibuixat i fet')).toBe(true);
  await page.getByTestId('chrono-add-lane').selectOption(`${f.scope}/${f.target}`);
  await page.locator(`[data-chrono-lane="${f.scope}/${f.target}"]`).scrollIntoViewIfNeeded();
  const block = (await page.getByTestId(`chrono-block-${f.session}`).boundingBox())!;
  const target = (await page.locator(`[data-chrono-lane="${f.scope}/${f.target}"]`).boundingBox())!;
  await page.mouse.move(block.x + block.width / 2, block.y + 15);
  await page.mouse.down();
  await page.mouse.move(block.x + block.width / 2, target.y + 20, { steps: 8 });
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  expect((await f.getSession()).project_id).toBe(f.project);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await f.getSession()).project_id).toBe(f.target);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/femho-reporting/chrono-mobile.png', fullPage: true });
});
test('editar per teclat manté oberta una sessió que està en curs', async ({ page }) => {
  const f = await setup(page, 'running');
  await page.request.post(`/api/v1/tasks/${f.task}/move`, {
    headers: f.headers,
    data: { status: 'doing' },
  });
  const report = (await (
    await page.request.get(`/api/v1/sessions?scope_ids=${f.scope}`, { headers: f.headers })
  ).json()) as { data: { id: string; open: boolean }[] };
  const running = report.data.find((entry) => entry.open)!;
  const started = new Date(Date.now() - 3600000).toISOString();
  await page.request.patch(`/api/v1/sessions/${running.id}`, {
    headers: f.headers,
    data: { started_at: started },
  });
  await page.goto(`/informes?tab=register&view=chrono&scopes=${f.scope}`);
  const block = page.getByTestId(`chrono-block-${running.id}`);
  await expect(block).toContainText('En curs');
  await expect(page.getByTestId(`chrono-resize-right-${running.id}`)).toHaveCount(0);
  await block.getByRole('button').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Final', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(dialog).toBeHidden();
  const after = (await (
    await page.request.get(`/api/v1/sessions?scope_ids=${f.scope}`, { headers: f.headers })
  ).json()) as { data: { id: string; ended_at: string | null }[] };
  expect(after.data.find((entry) => entry.id === running.id)?.ended_at).toBeNull();
});
test('un error de xarxa restaura el bloc i un conflicte conserva el canvi remot', async ({
  page,
}) => {
  const f = await setup(page, 'conflict');
  const before = await f.getSession();
  await page.route(`**/api/v1/sessions/${f.session}`, async (route) => {
    if (route.request().method() === 'PATCH') await route.abort('failed');
    else await route.continue();
  });
  await drag(page, `chrono-resize-right-${f.session}`, 60);
  await expect(page.getByTestId('toast')).toBeVisible();
  expect(await f.getSession()).toEqual(before);
  await expect(page.getByTestId(`chrono-block-${f.session}`)).toContainText('1h');
  await page.unroute(`**/api/v1/sessions/${f.session}`);
  await page.getByTestId(`chrono-block-${f.session}`).getByRole('button').focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/femho-reporting/chrono-dialog-mobile.png' });
  const response = await page.request.patch(`/api/v1/sessions/${f.session}`, {
    headers: f.headers,
    data: { ended_at: '2026-07-23T10:00:00Z', expected_version: before.version },
  });
  expect(response.status()).toBe(200);
  await dialog.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect((await f.getSession()).minutes).toBe(120);
  await expect(page.getByTestId(`chrono-block-${f.session}`)).toContainText('2h');
});
test('el zoom conserva els minuts del gest i afegir temps no canvia l’estat de la tasca', async ({
  page,
}) => {
  const f = await setup(page, 'zoom');
  await page.getByTestId('chrono-zoom-in').click();
  await drag(page, `chrono-resize-right-${f.session}`, 30);
  await expect.poll(async () => (await f.getSession()).minutes).toBe(90);
  await expect(page.getByTestId(`chrono-block-${f.session}`)).toContainText('1h 30m');
  const track = page.locator(`[data-chrono-lane="${f.scope}/${f.project}"]`);
  await track
    .locator('xpath=..')
    .getByRole('button', { name: /Afegeix/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('select').first().selectOption('existing');
  await dialog.getByRole('combobox', { name: 'Tasca existent', exact: true }).selectOption(f.task);
  await dialog.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(dialog).toBeHidden();
  const task = (await (
    await page.request.get(`/api/v1/tasks/${f.task}`, { headers: f.headers })
  ).json()) as { status: string };
  expect(task.status).toBe('inbox');
  const entries = (await (
    await page.request.get(`/api/v1/sessions?scope_ids=${f.scope}`, { headers: f.headers })
  ).json()) as { data: { task_id: string; minutes: number }[] };
  expect(
    entries.data
      .filter((e) => e.task_id === f.task)
      .map((e) => e.minutes)
      .sort((a, b) => a - b),
  ).toEqual([30, 90]);
});
