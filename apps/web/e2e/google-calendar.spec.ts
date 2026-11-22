import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

const root = '/api/v1/calendars/google';

test('vincula un calendari a dos àmbits i conserva una alta fora de línia', async ({
  page,
  context,
}) => {
  await enterAsNew(page, {
    name: 'Agenda Google de prova',
    email: 'agenda-google@example.test',
    password: 'agenda-google-password',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = [];
  for (const name of ['Agenda de feina', 'Agenda personal']) {
    const response = await page.request.post('/api/v1/scopes', {
      headers,
      data: { name, kind: 'individual' },
    });
    expect(response.status()).toBe(201);
    scopes.push((await response.json()) as { id: string; name: string });
  }

  let connected = false;
  let returned = false;
  const links: Array<{ id: string; scope_id: string; name: string }> = [];
  await page.route(`**${root}/oauth`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    return route.fulfill({
      json: {
        id: 'attempt-id',
        status: 'pending',
        authorization_url: `http://localhost:4173${root}/oauth/callback?state=mock`,
      },
    });
  });
  await page.route(`**${root}/oauth/callback?*`, async (route) => {
    returned = true;
    await route.fulfill({ status: 303, headers: { location: '/settings?tab=calendars' } });
  });
  const account = {
    id: 'account-id',
    email: 'agenda@google.example.test',
    oauth_status: 'connected',
  };
  await page.route(`**${root}/oauth/attempts/attempt-id`, (route) =>
    route.fulfill({
      json: {
        id: 'attempt-id',
        account_id: account.id,
        status: returned ? 'ready' : 'pending',
        email: account.email,
      },
    }),
  );
  await page.route(`**${root}/oauth/attempts/attempt-id/confirm`, (route) => {
    connected = true;
    return route.fulfill({ json: account });
  });
  await page.route(`**${root}/accounts`, (route) =>
    route.fulfill({ json: connected ? [account] : [] }),
  );
  await page.route(`**${root}/accounts/account-id/calendars`, (route) =>
    route.fulfill({
      json: [
        {
          id: 'remote-id',
          name: 'Agenda setmanal',
          primary: true,
          access_role: 'owner',
          writable: true,
        },
      ],
    }),
  );
  await page.route(`**${root}/links`, (route) => {
    const { id, scope_id, remote_calendar_id, writable } = route.request().postDataJSON() as {
      id: string;
      scope_id: string;
      remote_calendar_id: string;
      writable: boolean;
    };
    expect(remote_calendar_id).toBe('remote-id');
    expect(writable).toBe(true);
    const link = {
      id,
      scope_id,
      name: 'Agenda setmanal',
      writable,
      source_provider: 'google',
      source_kind: null,
      origin: 'subscription',
      kind: 'events',
      inbox_visible: null,
      inbox_visible_default: true,
    };
    links.push(link);
    return route.fulfill({ status: 201, json: link });
  });
  await page.route('**/api/v1/calendars', (route) => route.fulfill({ json: links }));
  await page.route(`**${root}/changes`, (route) => route.fulfill({ json: [] }));

  await page.goto('/settings?tab=calendars');
  const settings = page.getByTestId('google-calendar-settings');
  await settings.getByRole('button', { name: 'Connecta amb Google' }).click();
  await expect(settings.getByRole('status')).toContainText(account.email);
  await settings.getByRole('button', { name: 'Confirma' }).click();
  await settings.getByLabel('Calendari de Google').selectOption('remote-id');
  for (const scope of scopes) await settings.getByRole('checkbox', { name: scope.name }).check();
  await settings.getByRole('button', { name: 'Vincula el calendari' }).click();
  for (const scope of scopes)
    await expect(page.getByTestId(`sources-${scope.id}`)).toContainText('Agenda setmanal');

  await page.route('**/api/v1/sync/batch', async (route) => {
    const { operations } = route.request().postDataJSON() as {
      operations: Array<{ op_id: string; op: string; entity: string; data: { summary: string } }>;
    };
    expect(operations[0]).toMatchObject({
      op: 'create',
      entity: 'google_calendar_event',
      data: { summary: 'Cita fora de línia' },
    });
    await route.fulfill({
      json: { results: operations.map(({ op_id }) => ({ op_id, status: 'ok' })) },
    });
  });
  await page.goto('/calendar');
  await page.getByTestId('google-event-create').click();
  const editor = page.getByTestId('google-calendar-editor');
  for (const scope of scopes)
    await expect(
      editor.getByRole('option', { name: `Agenda setmanal · ${scope.name}` }),
    ).toHaveCount(1);
  await editor.getByLabel('Títol').fill('Cita fora de línia');
  await editor.getByRole('checkbox', { name: 'Tot el dia' }).check();
  await context.setOffline(true);
  await editor.getByRole('button', { name: 'Desa' }).click();
  await expect(editor).not.toBeVisible();
  const receipt = page.waitForResponse((response) => response.url().endsWith('/api/v1/sync/batch'));
  await context.setOffline(false);
  expect((await receipt).ok()).toBe(true);
});
