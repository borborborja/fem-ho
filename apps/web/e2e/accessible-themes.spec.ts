import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

async function account(page: Page, name: string) {
  await enterAsNew(page, {
    name: 'Temes accessibles',
    email: `themes-${name}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  return { authorization: `Bearer ${await token(page)}` };
}

test('els temes accessibles persisteixen al navegador i conserven el tema i accent de perfil', async ({
  page,
  context,
}, info) => {
  const headers = await account(page, `ajustos-${info.retry}`);
  await page.goto('/settings');
  const html = page.locator('html');
  const dark = page.getByTestId('theme-chips-dark');
  const contrast = page.getByTestId('theme-chips-high-contrast');
  const eink = page.getByTestId('theme-chips-eink');
  const accent = page.getByTestId('accent-chips-mono-cool');

  await dark.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await accent.click();
  await expect(html).toHaveAttribute('data-accent', 'mono-cool');
  await contrast.click();
  await expect(html).toHaveAttribute('data-appearance', 'high-contrast');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(contrast).toHaveAttribute('aria-pressed', 'true');

  await dark.focus();
  await page.keyboard.press('Tab');
  await expect(contrast).toBeFocused();
  await expect(contrast).toHaveCSS('outline-style', 'solid');
  await expect(contrast).toHaveCSS('outline-width', '2px');

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await eink.click();
  await expect(accent).toBeDisabled();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(html).toHaveCSS('background-image', 'none');
  await expect(eink).toHaveCSS('transition-property', 'none');
  await page.reload();
  await expect(eink).toHaveAttribute('aria-pressed', 'true');
  await expect(html).toHaveAttribute('data-appearance', 'eink');
  await expect(page.getByRole('link', { name: 'El codi' })).toHaveCSS(
    'color',
    await page.locator('body').evaluate((body) => getComputedStyle(body).color),
  );
  await eink.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('ajustos-tinta-electronica.png') });

  await contrast.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(accent).toBeEnabled();
  await dark.click();
  await expect(html).toHaveAttribute('data-appearance', 'standard');
  await expect(html).toHaveAttribute('data-accent', 'mono-cool');
  await context.setOffline(false);
  const profile = await page.request.get('/api/v1/auth/settings', { headers });
  await expect(profile).toBeOK();
  expect(await profile.json()).toMatchObject({ profile: { theme: 'dark', accent: 'mono-cool' } });
});

test('la tinta electrònica conserva el nom de l’àmbit amb i sense espai per als títols', async ({
  page,
}, info) => {
  const headers = await account(page, `calendari-${info.retry}`);
  const scopesResponse = await page.request.get('/api/v1/scopes', { headers });
  const [scope] = (await scopesResponse.json()) as { id: string; name: string }[];
  const day = '2026-11-20';
  const created = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scope!.id, title: 'Llegeix el programa', due_date: day, status: 'todo' },
  });
  await expect(created).toBeOK();

  await page.goto('/settings');
  await page.getByTestId('theme-chips-eink').click();
  await page.goto(`/calendar?date=${day}&scopes=${scope!.id}`);
  const selected = page.getByTestId(`day-${day}`);
  const item = page.getByTestId(`day-items-${day}`);
  await expect(selected).toHaveAttribute('aria-pressed', 'true');
  await expect(item).toContainText('Llegeix el programa');
  await expect(item.getByText(scope!.name, { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 740 });
  await expect(selected).toHaveAccessibleName(new RegExp(scope!.name, 'u'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('el Pomodoro en tinta electrònica manté el compte exacte al final de la fase', async ({
  page,
  context,
}, info) => {
  const headers = await account(page, `pomodoro-${info.retry}`);
  await page.goto('/settings');
  await page.getByTestId('theme-chips-eink').click();
  const enabled = page.getByTestId('settings-pomodoro-enabled');
  await enabled.click();
  await expect(enabled).toBeChecked();
  const duration = page.getByTestId('settings-pomodoro-focus_minutes');
  await duration.fill('2');
  await duration.press('Enter');
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/v1/pomodoro', { headers });
      return ((await response.json()) as { settings: { focus_minutes: number } }).settings
        .focus_minutes;
    })
    .toBe(2);

  await page.getByTestId('settings-back').click();
  await page.getByTestId('pomodoro-open').click();
  const countdown = page.getByTestId('pomodoro-countdown');
  await expect(countdown).toHaveText('2 min');
  await expect(page.getByTestId('pomodoro-ring')).toHaveCSS('background-image', 'none');
  await expect(page.getByTestId('pomodoro-tomato')).toHaveCount(0);
  await page.clock.install({ time: new Date() });
  await page.getByTestId('pomodoro-start').click();
  await expect(page.getByTestId('pomodoro-pause')).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/v1/pomodoro', { headers });
      return ((await response.json()) as { timer: { status: string } | null }).timer?.status;
    })
    .toBe('running');
  await context.setOffline(true);
  await page.clock.fastForward(67_000);
  await expect(countdown).toHaveText(/^00:[0-5]\d$/u);
});
