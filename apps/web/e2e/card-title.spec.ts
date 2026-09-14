import { expect, test, type Locator, type Page } from '@playwright/test';
import { enter, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

async function createTask(page: Page, status = 'todo') {
  await enter(page);
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = await (await page.request.get('/api/v1/scopes', { headers })).json();
  const response = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scopes[0].id, title: 'Títol per editar', status },
  });
  expect(response.ok()).toBe(true);
  const task = await response.json();
  await page.goto(`/board?scopes=${scopes[0].id}`);
  const card = page.getByTestId(`task-${task.id}`);
  await expect(card).toBeVisible();
  return { card, task, headers };
}

async function hold(page: Page, title: Locator) {
  await title.hover();
  await page.mouse.down();
  // És el gest que es prova: deixar anar abans del llindar seria un clic normal.
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test('pulsació llarga: edició in situ, Enter desa només el títol i persisteix', async ({
  page,
}, info) => {
  const { card, task, headers } = await createTask(page, 'doing');
  await hold(page, card.getByTestId('card-title'));
  const input = card.getByTestId('card-title-input');
  await expect(input).toBeFocused();
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  await input.fill('Refer el vídeo amb subtítols');
  await page.screenshot({ path: info.outputPath('edicio-titol.png') });
  const saved = page.waitForRequest(
    (r) => r.method() === 'PATCH' && r.url().endsWith(`/tasks/${task.id}`),
  );
  await input.press('Enter');
  expect((await saved).postDataJSON()).toEqual({ title: 'Refer el vídeo amb subtítols' });
  await expect(input).toHaveCount(0);
  await expect(card.getByTestId('card-title')).toHaveText('Refer el vídeo amb subtítols');
  await page.reload();
  await expect(card.getByTestId('card-title')).toHaveText('Refer el vídeo amb subtítols');
  const stored = await (await page.request.get(`/api/v1/tasks/${task.id}`, { headers })).json();
  expect(stored.status).toBe('doing');
});

test('F2, Escape, validació buida i desament en sortir del camp', async ({ page }) => {
  const { card } = await createTask(page);
  await card.getByTestId('card-title').locator('..').press('F2');
  const input = card.getByTestId('card-title-input');
  await input.fill('Descarta això');
  await input.press('Escape');
  await expect(card.getByTestId('card-title')).toHaveText('Títol per editar');
  await hold(page, card.getByTestId('card-title'));
  await input.fill('   ');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(card.getByRole('alert')).toBeVisible();
  await input.fill('Títol desat en sortir');
  await input.press('Tab');
  await expect(input).toHaveCount(0);
  await expect(card.getByTestId('card-title')).toHaveText('Títol desat en sortir');
});

test('una fallada conserva l’esborrany i permet reintentar', async ({ page }) => {
  const { card, task } = await createTask(page);
  const url = `**/api/v1/tasks/${task.id}`;
  await page.route(url, async (route) => {
    if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, body: '{}' });
    else await route.continue();
  });
  await hold(page, card.getByTestId('card-title'));
  const input = card.getByTestId('card-title-input');
  await input.fill('Títol per reintentar');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-busy', 'false');
  await expect(input).toHaveValue('Títol per reintentar');
  await page.unroute(url);
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  await expect(card.getByTestId('card-title')).toHaveText('Títol per reintentar');
});

test('el clic curt obre la fitxa i moure el títol inicia l’arrossegament', async ({ page }) => {
  const { card } = await createTask(page);
  await card.getByTestId('card-title').click();
  await expect(page.getByTestId('task-modal')).toBeVisible();
  await page.getByTestId('task-cancel').click();
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  const title = card.getByTestId('card-title');
  await title.hover();
  const box = (await title.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2, { steps: 5 });
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  await page.waitForTimeout(650);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(card.getByTestId('card-title-input')).toHaveCount(0);
});

test('pulsació tàctil llarga i cancel·lació del gest', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { card } = await createTask(page);
  const title = card.getByTestId('card-title');
  await title.scrollIntoViewIfNeeded();
  const box = (await title.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(card.getByTestId('card-title-input')).toHaveCount(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(650);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(card.getByTestId('card-title-input')).toBeFocused();
  await cdp.detach();
});
