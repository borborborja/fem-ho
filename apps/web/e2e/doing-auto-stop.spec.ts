import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { enterAsNew, token } from './entrar.js';

async function account(page: Page, name: string) {
  await enterAsNew(page, {
    name: 'Aturada de tasques',
    email: `doing-auto-stop-${name}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const response = await page.request.get('/api/v1/scopes', { headers });
  await expect(response).toBeOK();
  const scopes = (await response.json()) as { id: string }[];
  return { headers, scope: scopes[0]!.id };
}

async function taskStatus(
  request: APIRequestContext,
  headers: Record<string, string>,
  id: string,
): Promise<string> {
  const response = await request.get(`/api/v1/tasks/${id}`, { headers });
  await expect(response).toBeOK();
  return ((await response.json()) as { status: string }).status;
}

async function limit(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.get('/api/v1/auth/settings', { headers });
  await expect(response).toBeOK();
  return ((await response.json()) as { settings: { doing_auto_stop_minutes: number | null } })
    .settings.doing_auto_stop_minutes;
}

async function saveOneMinute(page: Page) {
  await page.getByTestId('settings-doing-auto-stop').check();
  const duration = page.getByTestId('settings-doing-auto-stop-duration');
  const unit = page.getByTestId('settings-doing-auto-stop-unit');
  await expect(duration).toHaveValue('4');
  await expect(unit).toHaveValue('hours');
  await unit.selectOption('minutes');
  await duration.fill('1');
  await page.getByTestId('settings-doing-auto-stop-save').click();
}

test('el servidor torna la tasca a Per fer i el tauler obert ho mostra sol', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(110_000);
  const { headers, scope } = await account(page, `obert-${testInfo.retry}`);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-doing-auto-stop')).not.toBeChecked();
  await saveOneMinute(page);
  await expect.poll(() => limit(request, headers)).toBe(1);

  const created = await request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scope, title: 'Fer el seguiment del tauler', status: 'todo' },
  });
  await expect(created).toBeOK();
  const { id, version } = (await created.json()) as { id: string; version: number };
  const started = new Date(Date.now() - 45_000).toISOString();
  const move = await request.post('/api/v1/sync/batch', {
    headers,
    data: {
      operations: [
        {
          op_id: uuidv7(),
          entity: 'task',
          op: 'move',
          id,
          base_version: version,
          occurred_at: started,
          data: { status: 'doing', from_status: 'todo', occurred_at: started },
        },
      ],
    },
  });
  await expect(move).toBeOK();
  expect(await move.json()).toMatchObject({
    results: [{ status: 'ok', entity: { status: 'doing' } }],
  });

  await page.goto(`/?scopes=${scope}`);
  await expect(page.getByTestId('column-doing').getByTestId(`task-${id}`)).toBeVisible();
  await expect(page.getByTestId('column-todo').getByTestId(`task-${id}`)).toBeVisible({
    timeout: 80_000,
  });
  expect(await taskStatus(request, headers, id)).toBe('todo');
});

test('el límit i el moviment offline es confirmen i la tasca s’atura amb la PWA tancada', async ({
  context,
  page,
  request,
}, testInfo) => {
  test.setTimeout(110_000);
  const { headers, scope } = await account(page, `tancat-${testInfo.retry}`);
  const created = await request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scope, title: 'Fer el seguiment sense connexió', status: 'todo' },
  });
  await expect(created).toBeOK();
  const { id } = (await created.json()) as { id: string };
  const boardPath = `/?scopes=${scope}`;
  await page.goto(boardPath);
  await expect(page.getByTestId(`task-${id}`)).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-doing-auto-stop')).toBeVisible();

  await context.setOffline(true);
  await saveOneMinute(page);
  await expect(page.getByTestId('sync-pill')).toContainText('Sense connexió');
  expect(await limit(request, headers)).toBeNull();
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('board-screen')).toBeVisible();

  // La reconnexió pot arribar mentre el gest espera per desar-se a la cua.
  await page.evaluate(async () => {
    const { user_id } = JSON.parse(localStorage.getItem('femho.tokens') ?? '{}') as {
      user_id: string;
    };
    await new Promise<void>((acquired) => {
      void navigator.locks.request(`fem-ho-account:${user_id}`, async () => {
        const released = new Promise<void>((resolve) => {
          window.addEventListener('e2e-release-outbox', () => resolve(), { once: true });
        });
        acquired();
        await released;
      });
    });
  });
  const started = new Date(Date.now() - 25_000);
  await page.clock.setFixedTime(started);
  await page.getByTestId(`task-${id}`).getByTestId('card-advance').click();
  await expect(page.getByTestId('column-doing').getByTestId(`task-${id}`)).toBeVisible();
  expect(await taskStatus(request, headers, id)).toBe('todo');
  await context.setOffline(false);
  await page.waitForFunction(() => navigator.onLine);
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-release-outbox')));
  await expect.poll(() => limit(request, headers)).toBe(1);
  await expect.poll(() => taskStatus(request, headers, id)).toBe('doing');
  await page.close();

  await expect.poll(() => taskStatus(request, headers, id), { timeout: 70_000 }).toBe('todo');
  const activity = await request.get(`/api/v1/tasks/${id}/activity`, { headers });
  await expect(activity).toBeOK();
  const history = (await activity.json()) as { data: unknown[] };
  expect(history.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        changes: expect.objectContaining({
          status: { from: 'todo', to: 'doing' },
          occurred_at: { from: null, to: started.toISOString() },
        }),
      }),
      expect.objectContaining({
        source: 'system',
        changes: expect.objectContaining({ status: { from: 'doing', to: 'todo' } }),
      }),
    ]),
  );

  const reopened = await context.newPage();
  await reopened.goto(boardPath);
  await expect(reopened.getByTestId('column-todo').getByTestId(`task-${id}`)).toBeVisible();
});
