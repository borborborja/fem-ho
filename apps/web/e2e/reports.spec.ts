import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test('informes accessibles sense cronometratge, filtres, detall i impressió', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Informes',
    email: 'reports@example.com',
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const scope = scopes[0]!.id;
  const project = (await (
    await page.request.post('/api/v1/projects', {
      headers,
      data: { scope_id: scope, name: 'Web municipal' },
    })
  ).json()) as { id: string };
  const task = (await (
    await page.request.post('/api/v1/tasks', {
      headers,
      data: {
        scope_id: scope,
        project_id: project.id,
        title: 'Revisar contingut accessible',
        due_date: '2020-01-01',
      },
    })
  ).json()) as { id: string };
  await page.reload();
  await page.getByTestId('view-reports').click();
  await expect(page.getByRole('heading', { name: 'Informes', exact: true })).toBeVisible();
  await expect(page.getByTestId('view-reports')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('view-tasks')).toHaveAttribute('aria-selected', 'false');
  await page.getByRole('button', { name: 'Pendents ara' }).click();
  await expect(page.getByRole('button', { name: 'Revisar contingut accessible' })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar contingut accessible' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('task-title')).toHaveValue('Revisar contingut accessible');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByTestId('reports-period').selectOption('all');
  await page.getByTestId('reports-projects').locator('summary').click();
  await page.getByLabel('Web municipal', { exact: true }).check();
  await expect(page).toHaveURL(new RegExp(`projects=${project.id}`));
  await page.reload();
  await expect(page.getByTestId('reports-period')).toHaveValue('all');
  await expect(page.getByRole('button', { name: 'Revisar contingut accessible' })).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByTestId('reports-export').click();
  expect((await downloaded).suggestedFilename()).toBe('tasques.csv');
  await page.getByTestId('reports-tabs-time').click();
  await expect(
    page.getByText(
      'Els àmbits seleccionats no tenen activat el registre de dedicació. El resum de tasques continua disponible.',
    ),
  ).toBeVisible();
  await page.getByTestId('reports-tabs-summary').click();
  await expect(page.getByRole('button', { name: 'Revisar contingut accessible' })).toBeVisible();
  await page.screenshot({ path: '/tmp/femho-reporting/reports-desktop.png', fullPage: true });
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('topbar')).toBeHidden();
  await expect(page.getByTestId('reports-period')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Informes', exact: true })).toBeVisible();
  await page.pdf({ path: '/tmp/femho-reporting/reports.pdf', format: 'A4' });
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect(page.getByTestId('view-reports')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/femho-reporting/reports-mobile-dark.png', fullPage: true });
  await page.goto(
    `/estadistiques?scope_ids=${scope}&project_id=${project.id}&from=2026-01-01&to=2026-01-31`,
  );
  await expect(page).toHaveURL(/\/informes\?.*tab=time/);
  expect(new URL(page.url()).searchParams.get('projects')).toBe(project.id);
  expect(new URL(page.url()).searchParams.get('from')).toBe('2026-01-01');
  expect(task.id).toBeTruthy();
});

test('filtres i resum llegibles als vuit temes i als tres idiomes', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Traduccions informes',
    email: 'reports-languages@example.com',
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  for (const [locale, title] of [
    ['ca', 'Informes'],
    ['en', 'Reports'],
    ['es', 'Informes'],
  ] as const) {
    expect(
      (await page.request.patch('/api/v1/auth/me', { headers, data: { locale } })).ok(),
    ).toBeTruthy();
    await page.goto('/informes');
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByTestId('reports-screen')).not.toContainText('reports.');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark'])
    for (const accent of ['default', 'soft', 'mono-warm', 'mono-cool']) {
      await page.evaluate(
        ({ theme, accent }) => {
          document.documentElement.setAttribute('data-theme', theme);
          document.documentElement.setAttribute('data-accent', accent);
        },
        { theme, accent },
      );
      await expect(page.getByTestId('view-reports')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
    }
});
