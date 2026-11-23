import { expect, test, type Page } from '@playwright/test';
import type { components, operations } from '@fem-ho/contracts';
import { enterAsNew, token } from './entrar.js';

const root = '/api/v1/calendars/google';
const account = {
  id: 'account-id',
  email: 'agenda@google.example.test',
  oauth_status: 'connected',
} satisfies components['schemas']['GoogleCalendarAccount'];
const additionalAccount = {
  id: 'additional-account-id',
  email: 'segona-agenda@google.example.test',
  oauth_status: 'connected',
} satisfies components['schemas']['GoogleCalendarAccount'];
const writable = {
  id: 'remote-id',
  name: 'Agenda setmanal',
  primary: true,
  access_role: 'owner',
  writable: true,
} satisfies components['schemas']['GoogleCalendarChoice'];
const readOnly = {
  id: 'read-only-id',
  name: 'Dies festius',
  primary: false,
  access_role: 'reader',
  writable: false,
} satisfies components['schemas']['GoogleCalendarChoice'];

type Scope = components['schemas']['Scope'];
type Link = operations['linkGoogleCalendar']['requestBody']['content']['application/json'];

async function createScope(page: Page, name: string, accessToken: string, kind = 'individual') {
  const response = await page.request.post('/api/v1/scopes', {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { name, kind },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as Scope;
}

async function enterWithScopes(page: Page, scenario: string) {
  await enterAsNew(page, {
    name: 'Agenda Google de prova',
    email: `agenda-google-${scenario}@example.test`,
    password: 'agenda-google-password',
  });
  const accessToken = await token(page);
  const origin = await createScope(page, 'Agenda de feina', accessToken);
  const secondary = await createScope(page, 'Agenda personal', accessToken);
  return { origin, secondary, accessToken };
}

async function mockGoogle(page: Page, { enabled = true, connected = true, failOnceIn = '' } = {}) {
  let returned = false;
  const accounts = connected ? [account] : [];
  const authorizing = connected ? additionalAccount : account;
  const requests: Link[] = [];
  const links: components['schemas']['Calendar'][] = [];
  await page.route(`**${root}/oauth`, async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled } });
    return route.fulfill({
      json: {
        id: 'attempt-id',
        status: 'pending',
        authorization_url: new URL(`${root}/oauth/callback?state=mock`, route.request().url()).href,
      },
    });
  });
  await page.route(`**${root}/oauth/callback?*`, async (route) => {
    returned = true;
    await route.fulfill({ status: 303, headers: { location: '/settings?tab=calendars' } });
  });
  await page.route(`**${root}/oauth/attempts/attempt-id`, (route) =>
    route.fulfill({
      json: {
        id: 'attempt-id',
        account_id: authorizing.id,
        status: returned ? 'ready' : 'pending',
        email: authorizing.email,
      },
    }),
  );
  await page.route(`**${root}/oauth/attempts/attempt-id/confirm`, (route) => {
    accounts.push(authorizing);
    return route.fulfill({ json: authorizing });
  });
  await page.route(`**${root}/accounts`, (route) => route.fulfill({ json: accounts }));
  for (const authorized of [account, additionalAccount]) {
    await page.route(`**${root}/accounts/${authorized.id}/calendars`, (route) =>
      route.fulfill({ json: [writable, readOnly] }),
    );
  }
  await page.route(`**${root}/links`, (route) => {
    const request = route.request().postDataJSON() as Link;
    requests.push(request);
    if (request.scope_id === failOnceIn) {
      failOnceIn = '';
      return route.fulfill({ status: 503, json: { title: 'Servei de proves no disponible' } });
    }
    expect(accounts.map(({ id }) => id)).toContain(request.account_id);
    const selected = [writable, readOnly].find(
      (choice) => choice.id === request.remote_calendar_id,
    );
    expect(selected).toBeDefined();
    const link: components['schemas']['Calendar'] = {
      id: request.id,
      scope_id: request.scope_id,
      name: selected!.name,
      writable: request.writable === true,
      source_provider: 'google',
      source_kind: null,
      origin: 'subscription',
      kind: 'events',
      shared_with_scope: false,
      inbox_visible: null,
      inbox_visible_default: true,
    };
    links.push(link);
    return route.fulfill({ status: 201, json: link });
  });
  await page.route('**/api/v1/calendars', (route) => route.fulfill({ json: links }));
  await page.route(`**${root}/changes`, (route) => route.fulfill({ json: [] }));
  return requests;
}

function linkedSource(page: Page, request: Link) {
  return page.getByTestId(`sources-${request.scope_id}`).getByTestId(`source-${request.id}`);
}

async function openGoogleSource(page: Page, scope: Scope) {
  await page.getByTestId(`source-kind-${scope.id}-google`).click();
  return page.getByTestId(`google-calendar-source-${scope.id}`);
}

test('vincula un calendari a dos àmbits i conserva una alta fora de línia', async ({
  page,
  context,
}) => {
  const { origin, secondary } = await enterWithScopes(page, 'offline');
  const scopes = [origin, secondary];
  const requests = await mockGoogle(page);

  await page.goto('/settings');
  await page.getByTestId('settings-tab-calendars').click();
  const form = await openGoogleSource(page, origin);
  for (const kind of ['caldav', 'ical', 'rss', 'google'])
    await expect(page.getByTestId(`source-kind-${origin.id}-${kind}`)).toBeVisible();
  await expect(page.getByTestId(`source-url-${origin.id}`)).toHaveCount(0);
  await expect(
    page.getByTestId('google-calendar-settings').getByLabel('Calendari de Google'),
  ).toHaveCount(0);
  await expect(form.getByLabel('Compte de Google')).toHaveValue(account.id);
  await form.getByLabel('Calendari de Google').selectOption(writable.id);
  await expect(form.getByRole('checkbox', { name: origin.name })).toBeChecked();
  await expect(form.getByRole('checkbox', { name: origin.name })).toBeDisabled();
  await form.getByRole('checkbox', { name: secondary.name }).check();
  await form.getByRole('button', { name: 'Vincula el calendari' }).click();
  await expect.poll(() => requests.length).toBe(2);
  for (const scope of scopes) {
    const request = requests.find(({ scope_id }) => scope_id === scope.id);
    expect(request).toMatchObject({
      account_id: account.id,
      remote_calendar_id: writable.id,
      writable: true,
    });
    await expect(linkedSource(page, request!)).toContainText(writable.name);
  }
  await page.reload();
  await page.getByTestId('settings-tab-calendars').click();
  for (const request of requests)
    await expect(linkedSource(page, request)).toContainText(writable.name);

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
      editor.getByRole('option', { name: `${writable.name} · ${scope.name}` }),
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

for (const connected of [false, true]) {
  test(`torna a l'àmbit després del consentiment ${connected ? 'd’un altre compte' : 'del primer compte'} de Google`, async ({
    page,
  }) => {
    const { origin, secondary } = await enterWithScopes(page, `oauth-${connected}`);
    const authorized = connected ? additionalAccount : account;
    const requests = await mockGoogle(page, { connected });
    await page.setViewportSize({ width: 360, height: 800 });

    await page.goto('/settings?tab=calendars');
    const form = await openGoogleSource(page, secondary);
    await form
      .getByRole('button', { name: connected ? 'Connecta un compte nou' : 'Connecta amb Google' })
      .click();

    await expect(form.getByRole('status')).toContainText(authorized.email);
    const confirm = form.getByRole('button', { name: 'Confirma la connexió' });
    await expect(confirm).toBeInViewport();
    await confirm.click();
    await expect(form.getByLabel('Compte de Google')).toHaveValue(authorized.id);
    if (connected)
      await expect(form.getByRole('option', { name: account.email, exact: true })).toHaveCount(1);
    await expect(page.getByTestId(`google-calendar-source-${origin.id}`)).toHaveCount(0);
    await form.getByLabel('Calendari de Google').selectOption(writable.id);
    await expect(form.getByRole('checkbox', { name: secondary.name })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: origin.name })).not.toBeChecked();
    await form.getByRole('button', { name: 'Vincula el calendari' }).click();
    await expect.poll(() => requests.map(({ scope_id }) => scope_id)).toEqual([secondary.id]);
    expect(requests[0]).toMatchObject({ account_id: authorized.id });
    await expect(linkedSource(page, requests[0]!)).toContainText(writable.name);
  });
}

test('vincula en només lectura i reintenta només els àmbits pendents', async ({ page }) => {
  const { origin, secondary } = await enterWithScopes(page, 'retry');
  const requests = await mockGoogle(page, { failOnceIn: secondary.id });

  await page.goto('/settings?tab=calendars');
  const form = await openGoogleSource(page, origin);
  await form.getByLabel('Calendari de Google').selectOption(readOnly.id);
  await expect(form.getByText('Només lectura', { exact: true })).toBeVisible();
  await expect(
    form.getByRole('checkbox', { name: 'Permet editar cites des de Fem-ho' }),
  ).toHaveCount(0);
  await form.getByRole('checkbox', { name: secondary.name }).check();
  const submit = form.getByRole('button', { name: 'Vincula el calendari' });
  await submit.click();

  await expect(form.getByRole('alert')).toBeVisible();
  expect(requests.map((request) => request.scope_id).sort()).toEqual(
    [origin.id, secondary.id].sort(),
  );
  const created = requests.find(({ scope_id }) => scope_id === origin.id)!;
  await expect(linkedSource(page, created)).toContainText(readOnly.name);
  await expect(form.getByRole('checkbox', { name: origin.name })).not.toBeChecked();
  await expect(form.getByRole('checkbox', { name: secondary.name })).toBeChecked();
  await submit.click();
  await expect
    .poll(() => requests.slice(2).map(({ scope_id }) => scope_id))
    .toEqual([secondary.id]);
  await expect(linkedSource(page, requests[2]!)).toContainText(readOnly.name);
  for (const request of requests)
    expect(request).toMatchObject({ remote_calendar_id: readOnly.id, writable: false });
});

test('amaga el mètode de Google sense integració activa', async ({ page }) => {
  const { origin } = await enterWithScopes(page, 'disabled');
  await mockGoogle(page, { enabled: false, connected: false });

  const availability = page.waitForResponse((response) => response.url().endsWith(`${root}/oauth`));
  await page.goto('/settings?tab=calendars');
  expect(await (await availability).json()).toEqual({ enabled: false });
  await expect(page.getByTestId(`source-kind-${origin.id}-caldav`)).toBeVisible();
  await expect(page.getByTestId(`source-kind-${origin.id}-google`)).toHaveCount(0);
});

test('ofereix Google Calendar només en àmbits propis', async ({ page }) => {
  const { origin, accessToken } = await enterWithScopes(page, 'ownership');
  const me = await page.request.get('/api/v1/auth/me', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(me.ok()).toBeTruthy();
  const member = (await me.json()) as components['schemas']['Me'];
  const register = await page.request.post('/api/v1/auth/register', {
    data: {
      name: 'Titular de l’agenda compartida',
      email: 'agenda-google-owner@example.test',
      password: 'agenda-owner-test-password',
      locale: 'ca',
    },
  });
  expect(register.ok()).toBeTruthy();
  const owner = (await register.json()) as components['schemas']['AuthTokens'];
  const shared = await createScope(
    page,
    'Agenda compartida d’un altre compte',
    owner.access_token,
    'collective',
  );
  const invite = await page.request.post(`/api/v1/scopes/${shared.id}/members`, {
    headers: { authorization: `Bearer ${owner.access_token}` },
    data: { user_id: member.id, role: 'collaborator' },
  });
  expect(invite.status()).toBe(201);
  await mockGoogle(page);

  await page.goto('/settings?tab=calendars');
  const form = await openGoogleSource(page, origin);
  await form.getByLabel('Calendari de Google').selectOption(writable.id);
  await expect(form.getByRole('checkbox', { name: shared.name })).toHaveCount(0);
  await expect(page.getByTestId(`source-kind-${shared.id}-caldav`)).toBeVisible();
  await expect(page.getByTestId(`source-kind-${shared.id}-google`)).toHaveCount(0);
});
