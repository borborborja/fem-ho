import { expect, test, type Locator, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

async function taskWithSubtask(page: Page, account: string) {
  await enterAsNew(page, {
    email: `subtask-${account}@example.com`,
    name: account,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  const task = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scopes[0]!.id, title: 'Preparar el viatge', status: 'todo' },
  });
  expect(task.ok()).toBe(true);
  const { id } = (await task.json()) as { id: string };
  const listPath = `/api/v1/tasks/${id}/subtasks`;
  expect((await page.request.post(listPath, { headers, data: { title: 'Passaport' } })).ok()).toBe(
    true,
  );
  await page.goto(`/?scopes=${scopes[0]!.id}`);
  const card = page.getByTestId(`task-${id}`);
  await card.getByTestId('card-lists-toggle').click();
  await expect(card.getByTestId('subtask-title')).toHaveText('Passaport');
  return { card, headers, listPath };
}

async function holdWithMouse(page: Page, title: Locator, move = 0) {
  const bounds = (await title.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (move) await page.mouse.move(x + move, y);
  await page.waitForTimeout(600);
  await page.mouse.up();
}

test('plegar conserva l’esborrany i la fila admet editar amb ratolí i teclat', async ({ page }) => {
  const { card, headers, listPath } = await taskWithSubtask(page, 'ratoli');
  await card.hover();
  await card.getByTestId('card-add-toggle').click();
  const field = card.getByTestId('card-add-item');
  await field.fill('Assegurança');
  const lists = card.getByTestId('card-lists-toggle');
  await lists.click();
  await expect(field).toHaveCount(0);
  await lists.click();
  await expect(field).toHaveValue('Assegurança');

  const subtaskTitle = card.getByTestId('subtask-title');
  await holdWithMouse(page, subtaskTitle, 12);
  await expect(card.getByTestId('subtask-title-input')).toHaveCount(0);
  await holdWithMouse(page, subtaskTitle);
  const editor = card.getByTestId('subtask-title-input');
  await expect(editor).toBeFocused();
  await expect(card.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  await editor.fill('Passaport nou');
  await editor.press('Enter');
  await expect(subtaskTitle).toHaveText('Passaport nou');
  await expect(subtaskTitle).toBeFocused();
  await card.getByRole('button', { name: 'Edita la subtasca' }).click();
  await expect(editor).toHaveValue('Passaport nou');
  await editor.press('Escape');

  await card.getByTestId('card-title').click();
  const modal = page.getByTestId('task-modal');
  const detailTitle = modal.getByTestId('subtask-title');
  await expect(detailTitle).toHaveText('Passaport nou');
  await detailTitle.press('F2');
  const detailEditor = modal.getByTestId('subtask-title-input');
  await detailEditor.fill('No desat');
  await detailEditor.press('Escape');
  await expect(detailTitle).toHaveText('Passaport nou');
  await expect(modal).toBeVisible();

  await detailTitle.hover();
  await modal.getByRole('button', { name: 'Esborra la subtasca' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Passaport nou');
  await confirm.getByRole('button', { name: 'Cancel·la' }).click();
  await expect(detailTitle).toHaveText('Passaport nou');
  await modal.getByRole('button', { name: 'Esborra la subtasca' }).click();
  await confirm.getByRole('button', { name: 'Esborra' }).click();
  await expect(detailTitle).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(listPath, { headers })).json()).toEqual([]);
});

test.describe('amb toc', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 393, height: 852 } });

  test('mantenir premut el títol obre l’editor i el menú també ofereix Edita', async ({
    page,
    context,
  }) => {
    const { card } = await taskWithSubtask(page, 'toc');
    const title = card.getByTestId('subtask-title');
    await title.scrollIntoViewIfNeeded();
    const bounds = (await title.boundingBox())!;
    const target = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-testid'),
        target,
      ),
    ).toBe('subtask-title');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [target],
    });
    await page.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const editor = card.getByTestId('subtask-title-input');
    await expect(editor).toHaveValue('Passaport');
    await editor.fill('DNI');
    await card.getByRole('button', { name: 'Desa' }).tap();
    await expect(title).toHaveText('DNI');
    await expect(card.getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await card.locator('summary[aria-label="Accions de la subtasca"]').tap();
    await card.getByRole('button', { name: 'Edita la subtasca' }).tap();
    await expect(editor).toHaveValue('DNI');
  });
});
