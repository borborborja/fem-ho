import { devices, expect, test, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { enterAsNew, token } from './entrar.js';

async function callMcp<T>(
  page: Page,
  credential: string,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const response = await page.request.post('/mcp', {
    headers: {
      authorization: `Bearer ${credential}`,
      accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  });
  await expect(response).toBeOK();
  const body = await response.text();
  const data =
    body
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6) ?? body;
  const { result, error } = JSON.parse(data) as {
    result?: { content: { text: string }[]; isError?: boolean };
    error?: { message: string };
  };
  expect(error?.message).toBeUndefined();
  expect(result?.isError, result?.content[0]?.text).not.toBe(true);
  return JSON.parse(result!.content[0]!.text) as T;
}

test('el distintiu MCP i l’historial conserven l’origen de cada canvi', async ({
  page,
  browser,
}, testInfo) => {
  await enterAsNew(page, {
    name: 'Prova del canal MCP',
    email: `mcp-provenance-${testInfo.repeatEachIndex}-${testInfo.retry}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = await page.request.get('/api/v1/scopes', { headers });
  await expect(scopes).toBeOK();
  const scope_id = ((await scopes.json()) as { id: string }[])[0]!.id;
  await expect(
    await page.request.patch('/api/v1/external-access', {
      headers,
      data: { mcp_enabled: true },
    }),
  ).toBeOK();
  const tokenResult = await page.request.post('/api/v1/tokens', {
    headers,
    data: {
      name: 'Credencial privada de prova',
      channels: ['mcp'],
      capabilities: ['tasks:create', 'tasks:update', 'tasks:read', 'tasks:attach'],
      scope_ids: [scope_id],
    },
  });
  await expect(tokenResult).toBeOK();
  const { token: credential } = (await tokenResult.json()) as { token: string };
  const original = 'Captura de WhatsApp';
  const attachmentOrigin = 'Exportació de fitxers';
  const latest = 'Selecció <b>nocturna</b>';
  const { task } = await callMcp<{ task: { id: string } }>(page, credential, 'create_task', {
    scope_id,
    title: 'Preparar la revisió',
    origin: original,
  });
  await callMcp(page, credential, 'add_task_attachment', {
    task_id: task.id,
    id: uuidv7(),
    filename: 'revisio.txt',
    content_base64: Buffer.from('Revisió').toString('base64'),
    origin: attachmentOrigin,
  });
  await callMcp(page, credential, 'update_task', {
    task_id: task.id,
    description: 'Revisió del flux',
    origin: latest,
  });
  await expect(
    await page.request.patch(`/api/v1/tasks/${task.id}`, {
      headers,
      data: { title: 'Revisió manual' },
    }),
  ).toBeOK();

  const manual = await page.request.post('/api/v1/tasks', {
    headers,
    data: { scope_id, title: 'Tasca sense origen indicat' },
  });
  await expect(manual).toBeOK();
  const { id: manualId } = (await manual.json()) as { id: string };
  await callMcp(page, credential, 'update_task', { task_id: manualId, description: 'Canvi MCP' });

  await page.reload();
  const card = page.getByTestId(`task-${task.id}`);
  const badge = card.getByRole('button', { name: 'Origen MCP' });
  const dialog = page.getByTestId('task-modal');
  const panel = page.locator('[popover]:popover-open');
  await expect(badge).toHaveText('MCP');
  await badge.hover();
  await expect(panel.getByText(original, { exact: true })).toBeVisible();
  await expect(panel.getByText(latest, { exact: true })).toBeVisible();
  await expect(panel).not.toContainText('Credencial privada de prova');
  await panel.hover();
  await expect(panel).toBeVisible();
  await page.mouse.move(2, 2);
  await expect(panel).toHaveCount(0);

  await page.keyboard.press('Tab');
  await badge.focus();
  await expect(badge).toBeFocused();
  await expect(panel).toBeVisible();
  await badge.press('Space');
  await expect(page.getByTestId('drag-overlay')).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  await card.getByTestId('card-title').click();
  const channels = dialog.getByTestId('activity-channel');
  await expect(channels.filter({ hasText: original })).toHaveText(`MCP · ${original}`);
  const attachmentRow = dialog.getByRole('listitem').filter({
    has: page.getByTestId('activity-channel').filter({ hasText: attachmentOrigin }),
  });
  await expect(attachmentRow).toContainText('ha afegit un adjunt');
  await expect(attachmentRow.getByTestId('activity-channel')).toHaveText(
    `MCP · ${attachmentOrigin}`,
  );
  await expect(channels.filter({ hasText: latest })).toHaveText(`MCP · ${latest}`);
  await expect(channels.filter({ hasText: /^Web$/u })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Origen MCP' }).click();
  await expect(panel).toContainText(original);
  await expect(panel).toContainText(latest);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // La mateixa targeta pot venir del correu i tenir una escriptura MCP posterior.
  // La ruta real ja ens dona l’activitat MCP. Afegim només la font de correu a la fixture.
  await page.route(/\/api\/v1\/inbox\?/u, async (route) => {
    const response = await route.fetch();
    const inbox = (await response.json()) as { undated: { id: string; source_kind?: string }[] };
    const mailTask = inbox.undated.find(({ id }) => id === manualId);
    if (mailTask !== undefined) mailTask.source_kind = 'mail';
    await route.fulfill({ response, json: inbox });
  });
  await page.goto('/calendar');
  const rail = page.getByTestId('inbox-rail');
  await expect(rail.getByRole('button', { name: 'Origen MCP' })).toHaveCount(2);
  await expect(rail.getByTestId('source-icon-mail')).toBeVisible();
  const mailCard = rail
    .locator('[data-status="inbox"]')
    .filter({ has: page.getByTestId('source-icon-mail') });
  await mailCard.getByRole('button', { name: 'Origen MCP' }).click();
  await expect(panel).toContainText('Origen no indicat');
  await expect(panel).not.toContainText('Creada per MCP');

  const phone = await browser.newContext({
    ...devices['Pixel 7'],
    locale: 'ca-ES',
    baseURL: testInfo.project.use.baseURL,
    storageState: await page.context().storageState(),
  });
  try {
    const mobile = await phone.newPage();
    await mobile.goto('/board');
    await mobile.getByTestId(`task-${task.id}`).getByRole('button', { name: 'Origen MCP' }).tap();
    const mobilePanel = mobile.locator('[popover]:popover-open');
    await expect(mobilePanel).toContainText(latest);
    await expect(mobile.getByTestId('task-modal')).toHaveCount(0);
    await mobile.touchscreen.tap(4, 4);
    await expect(mobilePanel).toHaveCount(0);
  } finally {
    await phone.close();
  }
});
