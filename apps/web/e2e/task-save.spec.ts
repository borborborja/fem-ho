import { expect, test, type Page } from '@playwright/test';
import type { components } from '@fem-ho/contracts';
import { enterAsNew, token } from './entrar.js';

type Task = components['schemas']['Task'];

async function setup(page: Page, testName: string) {
  await enterAsNew(page, {
    name: 'Edició de tasques',
    email: `task-save-${testName}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const response = await page.request.get('/api/v1/scopes', { headers });
  expect(response.ok()).toBe(true);
  const scopes = (await response.json()) as components['schemas']['Scope'][];
  return { headers, scopes };
}

test("la tasca delegada neix a l'àmbit i al projecte del tauler amb tots els camps", async ({
  page,
}) => {
  const { headers } = await setup(page, 'create');
  const scopeResponse = await page.request.post('/api/v1/scopes', {
    headers,
    data: { name: 'Feina delegada', color: '--plou-blue' },
  });
  expect(scopeResponse.status()).toBe(201);
  const scope = (await scopeResponse.json()) as components['schemas']['Scope'];
  const agent = await page.request.post('/api/v1/ai/agents', {
    headers,
    data: { name: 'Agent de proves' },
  });
  expect(agent.status()).toBe(201);
  const project = await page.request.post('/api/v1/projects', {
    headers,
    data: { scope_id: scope.id, name: 'Projecte de proves' },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = (await project.json()) as { id: string };
  const taskType = await page.request.post('/api/v1/task-types', {
    headers,
    data: { scope_id: scope.id, name: 'Revisió' },
  });
  expect(taskType.status()).toBe(201);
  const { id: taskTypeId } = (await taskType.json()) as { id: string };
  const settings = await page.request.patch(`/api/v1/scopes/${scope.id}/settings`, {
    headers,
    data: { task_types_enabled: true, task_type_required: true },
  });
  expect(settings.ok()).toBe(true);

  await page.goto(`/?projects=${projectId}`);
  await page.getByTestId('full-edit-todo').click();
  await expect(page.getByTestId('task-scope')).toHaveValue('');
  await expect(page.getByTestId('task-save')).toBeDisabled();
  await page.getByTestId('task-scope').selectOption(scope.id);
  await expect(page.getByTestId('task-project')).toHaveValue(projectId);
  await page.getByTestId('task-cancel').click();
  await page.getByTestId('task-discard').click();

  await page.goto(`/?scopes=${scope.id}&projects=${projectId}`);
  await page.getByTestId('ai-board-toggle').click();
  await page.getByTestId('ai-new-task-todo').click();
  await expect(page.getByTestId('task-scope')).toHaveValue(scope.id);
  await expect(page.getByTestId('task-project')).toHaveValue(projectId);
  await page.getByTestId('task-title').fill('Preparar el proper lliurament');
  await page.getByTestId('task-description').fill('Una descripció per al projecte');
  await page.getByTestId('task-due-date').fill('2031-05-04');
  await page.getByTestId('task-due-time').fill('09:35');
  await page.getByTestId('task-deadline').fill('2031-05-05');
  await page.getByTestId('task-recurrence-weekly').click();
  await page.getByTestId('task-recurrence-completion').check();
  await page.getByTestId('task-ai-instructions').fill('Revisa primer les notes del projecte.');
  await page.getByTestId('task-type-select').selectOption(taskTypeId);
  const createdRequest = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/tasks' &&
      response.request().method() === 'POST',
  );
  await page.getByTestId('task-save').click();
  const created = await createdRequest;
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as Task;
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  await expect(page.getByTestId(`task-${id}`)).toBeVisible();

  const stored = await page.request.get(`/api/v1/tasks/${id}`, { headers });
  expect(stored.ok()).toBe(true);
  expect(await stored.json()).toMatchObject({
    scope_id: scope.id,
    project_id: projectId,
    task_type_id: taskTypeId,
    status: 'todo',
    ai_mode: 'delegated',
    title: 'Preparar el proper lliurament',
    description: 'Una descripció per al projecte',
    due_date: '2031-05-04',
    due_time: '09:35',
    deadline: '2031-05-05T23:59:59.000Z',
    rrule: 'FREQ=WEEKLY',
    recurrence_mode: 'completion',
    ai_instructions: 'Revisa primer les notes del projecte.',
  });
});

test("editar el títol conserva les instruccions i l'instant exacte de la data límit", async ({
  page,
}) => {
  const { headers, scopes } = await setup(page, 'edit');
  const created = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id: scopes[0]!.id, title: 'Títol anterior' },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as Task;
  const url = `/api/v1/tasks/${id}`;
  const deadline = '2031-05-05T14:37:15.000Z';
  const seeded = await page.request.patch(url, {
    headers,
    data: { ai_mode: 'assisted', ai_instructions: 'Text existent', deadline },
  });
  expect(seeded.ok()).toBe(true);

  await page.goto('/');
  await page.getByTestId(`task-${id}`).getByText('Títol anterior').click();
  await expect(page.getByTestId('task-ai-instructions')).toHaveValue('Text existent');
  const concurrent = await page.request.patch(url, {
    headers,
    data: { ai_instructions: 'Text actualitzat' },
  });
  expect(concurrent.ok()).toBe(true);
  await page.getByTestId('task-title').fill('Títol corregit');
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  const edited = await page.request.get(url, { headers });
  expect(await edited.json()).toMatchObject({
    title: 'Títol corregit',
    deadline,
    ai_instructions: 'Text actualitzat',
  });

  await page.getByTestId(`task-${id}`).getByText('Títol corregit').click();
  await expect(page.getByTestId('task-ai-instructions')).toHaveValue('Text actualitzat');
  await page.getByTestId('task-ai-instructions').clear();
  await page.getByTestId('task-save').click();
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  const cleared = await page.request.get(url, { headers });
  expect(await cleared.json()).toMatchObject({ deadline, ai_instructions: null });

  await page.getByTestId(`task-${id}`).getByText('Títol corregit').click();
  await page.getByTestId('task-title').fill('Títol sense desar');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-discard')).toBeVisible();
  await expect(page.getByTestId('task-title')).toHaveValue('Títol sense desar');
  await page.getByTestId('task-discard').click();
  await expect(page.getByTestId('task-modal')).toHaveCount(0);
  await expect(page.getByTestId(`task-${id}`).getByText('Títol corregit')).toBeVisible();
});

test("l'afegida ràpida del tauler desa el mode d'IA que indica el sigil", async ({ page }) => {
  const { headers, scopes } = await setup(page, 'quick');
  await page.goto(`/?scopes=${scopes[0]!.id}`);
  const input = page.getByTestId('quick-add-todo').getByRole('combobox');
  await input.fill('Preparar el recompte !ia');
  const createdRequest = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/tasks' &&
      response.request().method() === 'POST',
  );
  await input.press('Enter');
  const created = await createdRequest;
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as Task;
  const stored = await page.request.get(`/api/v1/tasks/${id}`, { headers });
  expect(await stored.json()).toMatchObject({
    title: 'Preparar el recompte',
    ai_mode: 'delegated',
  });
});
