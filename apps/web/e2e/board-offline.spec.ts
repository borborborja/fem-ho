import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

const PASSWORD = 'la-contrasenya-de-prova';

async function enterBoard(page: Page, account: string): Promise<void> {
  await enterAsNew(page, {
    email: `offline-${account}@example.com`,
    name: account,
    password: PASSWORD,
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers })).json()) as {
    id: string;
  }[];
  await page.goto(`/?scopes=${scopes[0]!.id}`);
  await expect(page.getByTestId('board-screen')).toBeVisible();
}

async function addTodo(page: Page, title: string): Promise<void> {
  const input = page.getByTestId('quick-add-todo').getByRole('combobox');
  await input.fill(title);
  await input.press('Enter');
  await expect(page.getByTestId('column-todo')).toContainText(title);
}

test('el tauler conserva una captura i un moviment després de recarregar-se sense xarxa', async ({
  page,
  context,
}) => {
  await enterBoard(page, 'captura-i-moviment');
  // La PWA ha d'haver instal·lat la còpia navegable abans de provar un arrencament en fred.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  const title = 'Preparar la bicicleta sense xarxa';
  await addTodo(page, title);
  await page.getByTestId('column-todo').getByTestId('card-advance').click();
  await expect(page.getByTestId('column-doing')).toContainText(title);
  await expect(page.getByTestId('sync-pill')).toContainText('Sense connexió');
  await expect(page.getByTestId('sync-pill')).toContainText('2');
  const draft = page.getByTestId('quick-add-todo').getByRole('combobox');
  await draft.fill('Això encara és un esborrany');

  await page.reload();
  await expect(page.getByTestId('column-doing')).toContainText(title);
  await expect(page.getByTestId('sync-pill')).toContainText('2');
  await expect(draft).toHaveValue('Això encara és un esborrany');

  let release!: () => void;
  const network = new Promise<void>((resolve) => {
    release = resolve;
  });
  const posted: string[][] = [];
  const headers = { authorization: `Bearer ${await token(page)}` };
  // També s'ha de poder tornar a obrir si el rebut arriba però no es pot refrescar el tauler.
  await page.route(/\/api\/v1\/board\?/, (route) => route.abort('failed'));
  await page.route('**/api/v1/sync/batch', async (route) => {
    const body = route.request().postDataJSON() as { operations: { op_id: string }[] };
    posted.push(body.operations.map((operation) => operation.op_id));
    if (posted.length === 1) {
      // El servidor confirma l'operació, però el navegador perd el rebut.
      const accepted = await page.request.post('/api/v1/sync/batch', { headers, data: body });
      expect(accepted.ok()).toBe(true);
      expect(await accepted.json()).toMatchObject({ results: [{ status: 'ok' }] });
      await route.fulfill({ status: 504, body: '{}' });
      return;
    }
    await network;
    await route.continue();
  });
  await context.setOffline(false);
  try {
    await expect.poll(() => posted.length, { timeout: 12_000 }).toBeGreaterThan(1);
    expect(posted[1]).toEqual(posted[0]);
    await expect(page.getByTestId('sync-pill')).toContainText('Pendent de pujar');
  } finally {
    release();
  }
  await expect(page.getByTestId('sync-pill')).toContainText('Sincronitzat');
  await expect(page.getByTestId('column-doing')).toContainText(title);
  await context.setOffline(true);
  await expect(page.getByTestId('sync-pill')).toHaveText('Sense connexió');
  await page.reload();
  await expect(page.getByTestId('column-doing')).toContainText(title);

  const stored = (await (await page.request.get('/api/v1/tasks', { headers })).json()) as {
    data: { title: string; status: string }[];
  };
  expect(stored.data.filter((task) => task.title === title)).toEqual([
    expect.objectContaining({ status: 'doing' }),
  ]);
});

test('la cua d’un compte queda inaccessible quan se n’obre un altre a la mateixa pestanya', async ({
  page,
  context,
}) => {
  await enterBoard(page, 'primer-compte');
  const title = 'Tasca encara pendent del primer compte';

  await context.setOffline(true);
  await addTodo(page, title);
  await expect(page.getByTestId('sync-pill')).toContainText('1');
  await page.route('**/api/v1/sync/batch', (route) => route.abort('failed'));
  await context.setOffline(false);
  await page.evaluate(() => localStorage.removeItem('femho.tokens'));
  await page.goto('/');
  await enterBoard(page, 'segon-compte');
  await page.unroute('**/api/v1/sync/batch');

  await expect(page.getByTestId('column-todo')).not.toContainText(title);
  await expect(page.getByTestId('sync-pill')).toHaveCount(0);
  const headers = { authorization: `Bearer ${await token(page)}` };
  const stored = (await (await page.request.get('/api/v1/tasks', { headers })).json()) as {
    data: { title: string }[];
  };
  expect(stored.data.some((task) => task.title === title)).toBe(false);
});

test('les subtasques d’una tasca pendent es conserven i se sincronitzen en ordre', async ({
  page,
  context,
}) => {
  await enterBoard(page, 'subtasques');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const headers = { authorization: `Bearer ${await token(page)}` };

  await context.setOffline(true);
  const title = 'Preparar el material sense xarxa';
  await addTodo(page, title);
  const card = page
    .getByTestId('column-todo')
    .locator('[data-testid^="task-"]')
    .filter({ has: page.getByTestId('card-title').filter({ hasText: title }) })
    .first();
  await card.hover();
  await card.getByTestId('card-add-toggle').click();
  const field = card.getByTestId('card-add-item');
  await field.fill('Fitxa vella');
  await field.press('Enter');
  await expect(field).toHaveValue('');
  await field.fill('Per esborrar');
  await field.press('Enter');
  const first = card.getByTestId('subtask-row').filter({ hasText: 'Fitxa vella' });
  await first.getByTestId('subtask-title').press('F2');
  const editor = card.getByTestId('subtask-title-input');
  await editor.fill('Fitxa nova');
  await editor.press('Enter');
  await card.getByRole('checkbox', { name: /Fitxa nova/u }).click();
  const second = card.getByTestId('subtask-row').filter({ hasText: 'Per esborrar' });
  await second.hover();
  await second.getByRole('button', { name: 'Esborra la subtasca' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Esborra' }).click();
  await expect(card).toContainText('1/1');
  const id = (await card.getAttribute('data-testid'))!.slice('task-'.length);

  await page.reload();
  await card.getByTestId('card-lists-toggle').click();
  await expect(card.getByRole('checkbox', { name: /Fitxa nova/u })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(card.getByText('Per esborrar')).toHaveCount(0);

  await context.setOffline(false);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/tasks/${id}/subtasks`, { headers });
      return response.ok() ? response.json() : [];
    })
    .toEqual([expect.objectContaining({ title: 'Fitxa nova', done: true })]);
  await expect(card).toContainText('1/1');
  await expect(card.getByText('Per esborrar')).toHaveCount(0);
});
