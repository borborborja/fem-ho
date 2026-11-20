import { expect, test, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@fem-ho/contracts';
import { enterAsNew, token } from './entrar.js';

type TaskAiSetting = components['schemas']['TaskAiSettings'];
type TaskAiExecution = components['schemas']['TaskAiExecution'];

async function fixture(page: Page, suffix: string) {
  await enterAsNew(page, {
    name: 'Prova de tasques amb IA',
    email: `task-ai-${suffix}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = await page.request.get('/api/v1/scopes', { headers });
  await expect(scopes).toBeOK();
  const [first] = (await scopes.json()) as { id: string }[];
  const scopeId = first!.id;
  const secondScope = await page.request.post('/api/v1/scopes', {
    headers,
    data: { name: 'Feina de prova IA', color: '--plou-orange', kind: 'individual' },
  });
  await expect(secondScope).toBeOK();
  const { id: otherScopeId } = (await secondScope.json()) as { id: string };

  const create = async (scope_id: string, title: string) => {
    const id = uuidv7();
    await expect(
      await page.request.post('/api/v1/tasks', {
        headers,
        data: {
          id,
          scope_id,
          title,
          description: 'Revisa el pressupost i prepara els totals.',
          status: 'todo',
        },
      }),
    ).toBeOK();
    return id;
  };
  const taskId = await create(scopeId, 'Tasca per revisar amb IA');
  const otherTaskId = await create(otherScopeId, 'Tasca d’un altre àmbit');
  return { headers, scopeId, taskId, otherTaskId };
}

test('activa un àmbit, copia el context i ofereix text seleccionable si falla el portapapers', async ({
  page,
}, testInfo) => {
  const { headers, scopeId, taskId, otherTaskId } = await fixture(
    page,
    `copy-${testInfo.repeatEachIndex}-${testInfo.retry}`,
  );
  const card = page.getByTestId(`task-${taskId}`);
  const action = card.getByTestId('task-ai-action');
  await expect(
    await page.request.post(`/api/v1/tasks/${taskId}/subtasks`, {
      headers,
      data: { title: 'Verificar els totals' },
    }),
  ).toBeOK();
  await page.goto('/');
  await expect(card).toBeVisible();
  await expect(action).toHaveCount(0);

  await page.goto('/settings?tab=aiTasks');
  const settings = page.getByTestId(`task-ai-scope-${scopeId}`);
  const enabled = settings.getByRole('switch', { name: 'Activa les tasques amb IA' });
  await expect(enabled).not.toBeChecked();
  await enabled.check();
  await expect(settings.getByLabel('Mètode')).toHaveValue('copy');
  await settings.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(page.getByText('Configuració desada')).toBeVisible();
  await page.getByTestId('settings-back').click();
  await expect(action).toBeVisible();
  const rail = card.getByTestId('card-action-rail');
  const advance = rail.getByTestId('card-advance');
  await expect(advance).toBeVisible();
  await expect(rail.getByTestId('task-ai-action')).toBeVisible();
  await expect(card.getByLabel('Accions de la tasca')).toHaveCount(0);
  const [railBounds, advanceBounds, actionBounds, titleBounds] = await Promise.all([
    rail.boundingBox(),
    advance.boundingBox(),
    action.boundingBox(),
    card.getByTestId('card-title').boundingBox(),
  ]);
  expect(actionBounds!.y).toBeGreaterThan(advanceBounds!.y);
  expect(actionBounds!.y + actionBounds!.height).toBeCloseTo(railBounds!.y + railBounds!.height);
  expect(railBounds!.x - (titleBounds!.x + titleBounds!.width)).toBeLessThanOrEqual(13);
  await expect(page.getByTestId(`task-${otherTaskId}`).getByTestId('task-ai-action')).toHaveCount(
    0,
  );

  let launches = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/ai-executions')) launches += 1;
  });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await action.click();
  await expect(page.getByText('Context copiat', { exact: true })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Tasca per revisar amb IA');
  expect(text).toContain('Revisa el pressupost i prepara els totals.');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { write: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    });
  });
  await card.getByTestId('card-title').click();
  const modal = page.getByTestId('task-modal');
  await modal.getByLabel('Accions de la tasca').press('Space');
  await modal.getByTestId('task-ai-copy').press('Enter');
  const fallback = page.getByTestId('ai-context-fallback');
  await expect(fallback).toBeVisible();
  await expect(fallback.getByRole('textbox')).toHaveValue(text);
  await page.keyboard.press('Escape');
  await expect(fallback).toHaveCount(0);
  await expect(modal).toBeVisible();
  expect(launches).toBe(0);

  await page.goto('/settings?tab=aiTasks');
  await enabled.uncheck();
  await settings.getByRole('button', { name: 'Desa', exact: true }).click();
  await expect(page.getByText('Configuració desada')).toBeVisible();
  await page.getByTestId('settings-back').click();
  await expect(card).toBeVisible();
  await expect(action).toHaveCount(0);
});

test('clic dret copia encara que falti la connexió i el clic principal envia només quan està preparada', async ({
  page,
}, testInfo) => {
  const { headers, scopeId, taskId } = await fixture(
    page,
    `dispatch-${testInfo.repeatEachIndex}-${testInfo.retry}`,
  );
  const putSettings = (method: TaskAiSetting['method']) =>
    page.request.put(`/api/v1/ai/task-settings/${scopeId}`, {
      headers,
      data: { enabled: true, method },
    });
  await expect(await putSettings('mcp_events')).toBeOK();

  const outcomes: TaskAiExecution[] = [];
  await page.route(`**/api/v1/tasks/${taskId}/ai-executions`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { data: [...outcomes].reverse() } });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    expect(body).toEqual({ id: expect.any(String) });
    const result: TaskAiExecution = {
      id: body.id as string,
      method: outcomes.length === 0 ? 'mcp_events' : 'claude_routine',
      status: 'delivered',
      result_comment_id: null,
      retry_at: null,
      session_url: outcomes.length === 0 ? null : 'https://claude.ai/code/session_ai_test',
    };
    outcomes.push(result);
    await route.fulfill({ status: 202, json: result });
  });
  await page.route(`**/api/v1/tasks/${taskId}/activity`, async (route) => {
    const response = await route.fetch();
    const activity = (await response.json()) as { data: components['schemas']['ActivityEntry'][] };
    await route.fulfill({
      response,
      json: {
        data: [
          ...outcomes.map((result) => ({
            id: result.id,
            entity_type: 'task',
            verb: 'ai_execution_updated',
            actor_type: 'user',
            actor_label: 'Prova de tasques amb IA',
            source: 'system',
            changes: {
              execution_id: { from: null, to: result.id },
              method: { from: null, to: result.method },
              status: { from: 'sending', to: result.status },
            },
            created_at: new Date().toISOString(),
          })),
          ...activity.data,
        ],
      },
    });
  });
  const card = page.getByTestId(`task-${taskId}`);
  const action = card.getByTestId('task-ai-action');
  await page.goto('/');
  await action.click();
  await expect(page.getByText('La destinació encara no està preparada.')).toBeVisible();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await action.click({ button: 'right' });
  await expect(page.getByText('Context copiat', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'Tasca per revisar amb IA',
  );
  const copiedByKeyboard = page.waitForResponse(`**/api/v1/tasks/${taskId}/ai-context`);
  await action.press('Shift+F10');
  expect((await copiedByKeyboard).ok()).toBe(true);
  expect(outcomes).toHaveLength(0);
  await expect(page.getByTestId('column-todo').getByTestId(`task-${taskId}`)).toBeVisible();

  await page.route('**/api/v1/ai/task-settings', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as { data: TaskAiSetting[] };
    const setting = config.data.find(({ scope_id }) => scope_id === scopeId);
    if (setting !== undefined) setting.ready = true;
    await route.fulfill({ response, json: config });
  });
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(action).toBeVisible();
  const copiedByTouch = page.waitForResponse(`**/api/v1/tasks/${taskId}/ai-context`);
  await action.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0 });
  expect((await copiedByTouch).ok()).toBe(true);
  await action.dispatchEvent('pointerup', { pointerType: 'touch', button: 0 });
  await action.dispatchEvent('click', { detail: 1 });
  await expect(page.getByText('Context copiat', { exact: true })).toBeVisible();
  expect(outcomes).toHaveLength(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.context().setOffline(true);
  await action.click();
  await expect(page.getByTestId('toast-viewport').locator('[data-tone="error"]')).toBeVisible();
  await page.context().setOffline(false);
  expect(outcomes).toHaveLength(0);
  await action.click();
  await expect(page.getByText('Lliurat al receptor', { exact: true })).toBeVisible();
  expect(outcomes).toHaveLength(1);

  await expect(await putSettings('claude_routine')).toBeOK();
  await page.reload();
  await card.getByTestId('card-title').click();
  const modal = page.getByTestId('task-modal');
  const modalAction = modal.getByTestId('task-ai-action');
  await modalAction.click({ button: 'right' });
  await expect(page.getByText('Context copiat', { exact: true })).toBeVisible();
  expect(outcomes).toHaveLength(1);
  await modalAction.press('Enter');
  await expect(modal.getByText('Sessió de Claude iniciada', { exact: true })).toBeVisible();
  await expect(modal.getByRole('link', { name: 'Obre la sessió' })).toHaveAttribute(
    'href',
    'https://claude.ai/code/session_ai_test',
  );
  expect(outcomes).toHaveLength(2);
});
