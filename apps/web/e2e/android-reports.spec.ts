import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test('els trams offline d’Android arriben sencers al registre i al resum', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Android reports',
    email: 'android-report@example.com',
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!.id;
  expect(
    (
      await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
        headers,
        data: { time_tracking: true },
      })
    ).ok(),
  ).toBeTruthy();
  const task = (await (
    await page.request.post('/api/v1/tasks', {
      headers,
      data: { scope_id: scope, title: 'Feina feta des d’Android', status: 'todo' },
    })
  ).json()) as { id: string; version: number };
  const start = Date.now() - 60 * 60000;
  const transitions = [
    ['todo', 'doing', 0],
    ['doing', 'done', 23],
    ['done', 'doing', 30],
    ['doing', 'done', 49],
  ] as const;
  const operations = transitions.map(([from, status, minute]) => ({
    op_id: randomUUID(),
    entity: 'task',
    op: 'move',
    id: task.id,
    base_version: task.version,
    data: {
      status,
      from_status: from,
      occurred_at: new Date(start + minute * 60000).toISOString(),
    },
  }));
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await page.request.post('/api/v1/sync/batch', {
      headers,
      data: { operations },
    });
    expect(
      ((await response.json()) as { results: { status: string }[] }).results.map((r) => r.status),
    ).toEqual(['ok', 'ok', 'ok', 'ok']);
  }
  const report = (await (
    await page.request.get(`/api/v1/sessions?scope_ids=${scope}`, { headers })
  ).json()) as { data: { minutes: number }[]; totals: { minutes: number; tasks: number } };
  expect(report.data.map((row) => row.minutes).sort((a, b) => a - b)).toEqual([19, 23]);
  expect(report.totals).toMatchObject({ minutes: 42, tasks: 1 });
  await page.goto(`/informes?tab=register&scopes=${scope}&period=all`);
  const table = page.getByTestId('registre-table');
  await expect(table.getByText('Feina feta des d’Android', { exact: true })).toHaveCount(2);
  await expect(table.getByRole('cell', { name: '23m', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '19m', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/femho-android-audit/reports-register.png', fullPage: true });
  await page.getByTestId('reports-tabs-summary').click();
  await expect(page.getByText('42m', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: '/tmp/femho-android-audit/reports-summary.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('reports-tabs-register').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/femho-android-audit/reports-mobile.png', fullPage: true });
});
