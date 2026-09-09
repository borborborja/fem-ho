import { expect, test, type Page } from '@playwright/test';
import { enter, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

async function oneScope(page: Page) {
  await enter(page);
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  await page.goto(`/board?scopes=${scopes[0]!.id}`);
  await expect(page.getByTestId('kanban')).toBeVisible();
  await page.clock.install();
  return { scopes, headers, chip: page.getByTestId(`scope-${scopes[0]!.id}`) };
}

test('l’avís de l’últim àmbit desapareix i no desplaça el tauler', async ({ page }, testInfo) => {
  const { chip } = await oneScope(page);
  const before = await page.getByTestId('kanban').boundingBox();
  await chip.click();
  const toast = page.getByTestId('toast');
  await expect(toast).toContainText('Ha de quedar almenys un àmbit actiu.');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  expect(await page.getByTestId('kanban').boundingBox()).toEqual(before);
  await page.screenshot({ path: testInfo.outputPath('toast-ambit.png') });
  await page.clock.fastForward(5100);
  await expect(toast).toHaveCount(0);
});

test('repetir l’avís no l’apila i reinicia el temps', async ({ page }) => {
  const { chip } = await oneScope(page);
  await chip.click();
  await page.clock.fastForward(4000);
  await chip.click();
  await expect(page.getByTestId('toast')).toHaveCount(1);
  await page.clock.fastForward(4000);
  await expect(page.getByTestId('toast')).toBeVisible();
  await page.clock.fastForward(1100);
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('el temps es pausa amb el ratolí i amb el focus', async ({ page }) => {
  const { chip } = await oneScope(page);
  const toast = page.getByTestId('toast');
  await chip.click();
  await page.clock.fastForward(3000);
  await toast.hover();
  await page.clock.fastForward(10000);
  await expect(toast).toBeVisible();
  await chip.hover();
  await page.clock.fastForward(2100);
  await expect(toast).toHaveCount(0);

  await chip.click();
  await page.getByTestId('toast-dismiss').focus();
  await page.clock.fastForward(10000);
  await expect(toast).toBeVisible();
  await chip.focus();
  await page.clock.fastForward(5100);
  await expect(toast).toHaveCount(0);
});

test('es pot tancar i desapareix quan la selecció torna a ser vàlida', async ({ page }) => {
  const { chip, scopes } = await oneScope(page);
  await chip.click();
  await page.getByTestId('toast-dismiss').click();
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await chip.click();
  await page.getByTestId(`scope-${scopes[1]!.id}`).click();
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('les dreceres comparteixen els toasts i Escape els tanca', async ({ page }) => {
  await oneScope(page);
  await page.keyboard.press('1');
  await expect(page.getByTestId('toast')).toContainText('Ha de quedar almenys un àmbit actiu.');
  await page.keyboard.press('?');
  await expect(page.getByTestId('toast')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('toast')).toHaveCount(0);
});

test('un moviment rebutjat mostra un toast i conserva la tasca al seu lloc', async ({ page }) => {
  const { scopes, headers } = await oneScope(page);
  const response = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scopes[0]!.id, title: 'Moviment rebutjat', status: 'todo' },
  });
  expect(response.ok()).toBe(true);
  const task = (await response.json()) as { id: string };
  await page.reload();
  const card = page.getByTestId(`task-${task.id}`);
  await expect(card).toBeVisible();
  const url = `**/api/v1/tasks/${task.id}/move`;
  await page.route(url, (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await card.getByTestId('card-advance').click();
  await expect(page.getByTestId('toast')).toHaveAttribute('data-tone', 'error');
  await expect(card.locator('[data-status]')).toHaveAttribute('data-status', 'todo');
  await page.mouse.move(0, 0);
  await page.clock.fastForward(8100);
  await expect(page.getByTestId('toast')).toHaveCount(0);
  await page.unroute(url);
  await card.getByTestId('card-advance').click();
  await expect(card.locator('[data-status]')).toHaveAttribute('data-status', 'doing');
});

test('el toast cap al mòbil i conserva el contrast en tema fosc', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { chip } = await oneScope(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark';
  });
  await chip.click();
  const toast = page.getByTestId('toast');
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: testInfo.outputPath('toast-mobile-dark.png') });
  await page.getByTestId('toast-dismiss').click();
  await expect(toast).toHaveCount(0);
});
