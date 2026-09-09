import { expect, test } from '@playwright/test';
import { enter } from './entrar.js';

test('un refresc temporalment indisponible conserva la sessió i el text per reintentar', async ({
  page,
}, testInfo) => {
  await enter(page);
  const original = await page.evaluate(() => localStorage.getItem('femho.tokens'));
  await page.route('**/api/v1/auth/refresh', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.route('**/api/v1/tasks', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({ status: 401, body: '{}' })
      : route.continue(),
  );

  const scope = await page.locator('[data-testid="scope-chips"] button').first().innerText();
  const title = 'Auditoria de recuperació de sessió';
  const text = `#${scope} ${title}`;
  const field = page.locator('input[role="combobox"]').first();
  await field.fill(text);
  await field.press('Escape');
  await field.press('Enter');

  await expect(field).toHaveValue(text);
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('femho.tokens'))).toBe(original);
  await page.screenshot({ path: testInfo.outputPath('sessio-conservada.png'), fullPage: true });

  await page.unroute('**/api/v1/tasks');
  await page.unroute('**/api/v1/auth/refresh');
  await field.press('Enter');
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText(title);
  await expect(field).toHaveValue('');
});
