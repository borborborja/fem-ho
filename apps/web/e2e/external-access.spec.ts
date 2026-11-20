import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import type { components } from '@fem-ho/contracts';
import { enterAsNew, token } from './entrar.js';

type Credential = components['schemas']['ApiTokenSummary'];
const baseUrl = 'http://localhost:4173';
const resource = `${baseUrl}/mcp`;
const redirectUri = `${baseUrl}/oauth-test-callback`;
const operation = (page: Page, capability: string) =>
  page.getByTestId(`credential-operation-${capability}`);

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
}

async function startAuthorization(page: Page, name: string, scope?: string) {
  const registered = await page.request.post('/oauth/register', {
    data: {
      client_name: name,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    },
  });
  expect(registered.status()).toBe(201);
  const clientId = (await registered.json()).client_id as string;
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    resource,
    state: 'browser-test',
    response_type: 'code',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  if (scope !== undefined) query.set('scope', scope);
  await page.route('**/oauth-test-callback?**', (route) =>
    route.fulfill({ contentType: 'text/plain', body: 'Callback' }),
  );
  await page.goto(`/oauth/authorize?${query}`);
  return { clientId, verifier };
}

async function exchangeCode(page: Page, clientId: string, verifier: string, code: string) {
  const response = await page.request.post('/oauth/token', {
    form: {
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      resource,
      redirect_uri: redirectUri,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as OAuthTokens;
}

async function capture(page: Page, path: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  // Chromium només pinta el fons fix a la finestra visible d'una captura de pàgina sencera.
  await page.screenshot({ path, fullPage: true, style: 'html { background-attachment: scroll; }' });
}

async function callMcp(page: Page, accessToken: string, method: string) {
  return page.request.post('/mcp', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
    },
    data: { jsonrpc: '2.0', id: 1, method },
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`credencial granular i consentiment OAuth al navegador · ${theme}`, async ({ page }) => {
    await enterAsNew(page, {
      name: 'MCP test',
      email: `external-${theme}@example.com`,
      password: 'la-contrasenya-de-prova',
    });
    const headers = { authorization: `Bearer ${await token(page)}` };
    await page.request.patch('/api/v1/auth/me', { headers, data: { theme } });
    const scope = await page.request.post('/api/v1/scopes', {
      headers,
      data: { name: 'Personal MCP', color: '--plou-blue', kind: 'individual' },
    });
    expect(scope.status()).toBe(201);
    const scopeId = (await scope.json()).id as string;
    const secondScope = await page.request.post('/api/v1/scopes', {
      headers,
      data: { name: 'Feina MCP', color: '--plou-blue', kind: 'individual' },
    });
    expect(secondScope.status()).toBe(201);
    const secondScopeId = (await secondScope.json()).id as string;
    await page.goto('/settings');
    await page.getByTestId('settings-tab-mcp').click();
    const mcp = page.getByRole('switch', { name: 'Activar accés MCP' });
    await expect(mcp).not.toBeChecked();
    await mcp.click();
    await expect(mcp).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Activar accés API extern' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Crea un token', exact: true }).click();
    await page.getByTestId('token-name').fill('Personal de prova');
    await expect(page.getByTestId('token-create')).toBeDisabled();
    await page.getByLabel('Personal MCP', { exact: true }).check();
    await page.getByLabel('Consultar tasques', { exact: true }).uncheck();
    await expect(page.getByTestId('token-create')).toBeDisabled();
    await page.getByLabel('Crear tasques', { exact: true }).check();
    await page.getByTestId('token-create').click();
    const secret = page.getByTestId('token-value');
    await expect(secret).toBeVisible();
    const manualToken = await secret.inputValue();
    await page.getByRole('button', { name: 'Comprovar connexió MCP' }).click();
    await expect(page.getByTestId('mcp-verified')).toContainText('Connexió verificada');
    await expect(page.getByTestId('mcp-verified')).toContainText('Personal MCP');
    await expect(page.getByTestId('mcp-verified')).toContainText('Crear tasques');
    await page.getByRole('button', { name: 'Ja he desat el token' }).click();
    await expect(secret).toHaveCount(0);
    const credential = page.getByRole('article').filter({ hasText: 'Personal de prova' });
    await credential.getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(page.getByLabel('Consultar tasques', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Crear tasques', { exact: true })).toBeChecked();
    await page.getByTestId('token-name').fill('Tasques de prova');
    await page.getByTestId('token-create').click();
    await expect(page.getByRole('article').filter({ hasText: 'Tasques de prova' })).toBeVisible();
    await capture(page, `/tmp/femho-mcp-settings-${theme}.png`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await capture(page, `/tmp/femho-mcp-settings-mobile-${theme}.png`);

    const { clientId, verifier } = await startAuthorization(page, 'Client navegador');
    await expect(page.getByRole('heading', { name: 'Autoritzar connexió a Fem-ho' })).toBeVisible();
    await expect(page.getByTestId('mcp-consent-account')).toContainText('MCP test');
    await expect(page.getByTestId('login')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Autoritzar', exact: true })).toBeDisabled();
    await expect(page.getByTestId(`credential-scope-${scopeId}`)).not.toBeChecked();
    for (const capability of ['read', 'create', 'move', 'update', 'attach']) {
      await expect(operation(page, `tasks:${capability}`)).toBeChecked();
    }
    await expect(operation(page, 'ai_executions:read')).not.toBeChecked();
    await expect(operation(page, 'ai_executions:write')).not.toBeChecked();
    await page.getByLabel('Personal MCP', { exact: true }).check();
    await page.getByLabel('Feina MCP', { exact: true }).check();
    for (const capability of ['create', 'update', 'attach']) {
      await operation(page, `tasks:${capability}`).uncheck();
    }
    await capture(page, `/tmp/femho-mcp-consent-${theme}.png`);
    await page.getByRole('button', { name: 'Autoritzar', exact: true }).click();
    await page.waitForURL('**/oauth-test-callback?**');
    const callback = new URL(page.url());
    expect(callback.searchParams.get('state')).toBe('browser-test');
    const oauth = await exchangeCode(page, clientId, verifier, callback.searchParams.get('code')!);
    expect(oauth.scope).toBe('femho:read femho:write');
    const grants = await page.request.get('/api/v1/tokens', { headers });
    expect(grants.ok()).toBe(true);
    const { data: all } = (await grants.json()) as { data: Credential[] };
    const grant = all.find((g) => g.name === 'Client navegador')!;
    expect(grant.scope_ids).toEqual(expect.arrayContaining([scopeId, secondScopeId]));
    expect(grant.channels).toEqual(['mcp']);
    expect(grant.capabilities).toEqual(['tasks:read', 'tasks:move']);
    expect(grant.oauth?.status).toBe('active');
    expect(all.find((g) => g.name === 'Tasques de prova')?.capabilities).toEqual(['tasks:create']);
    expect(await (await callMcp(page, oauth.access_token, 'tools/list')).text()).toContain(
      '"name":"move_task"',
    );

    await page.goto('/settings');
    await page.getByTestId('settings-tab-mcp').click();
    const oauthRow = page.getByTestId(`credential-${grant.id}`);
    await expect(oauthRow).toContainText('Connexió OAuth');
    await expect(page.getByTestId(`oauth-status-${grant.id}`)).toHaveText('Actiu');
    await page.getByTestId(`oauth-restrict-${grant.id}`).click();
    await page.getByTestId('oauth-restrict-capability-tasks:move').uncheck();
    await page.getByTestId(`credential-scope-${secondScopeId}`).uncheck();
    await page.getByTestId('oauth-restrict-save').click();
    await expect(page.getByTestId('oauth-restrict-save')).toHaveCount(0);
    await expect(oauthRow).not.toContainText('Feina MCP');
    const reduced = await callMcp(page, oauth.access_token, 'tools/list');
    expect(reduced.ok()).toBe(true);
    const toolList = await reduced.text();
    expect(toolList).toContain('"name":"list_tasks"');
    expect(toolList).not.toContain('"name":"move_task"');

    const refresh = (refreshToken: string) =>
      page.request.post('/oauth/token', {
        form: {
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          resource,
        },
      });
    const refreshed = await refresh(oauth.refresh_token);
    expect(refreshed.ok()).toBe(true);
    const latest = (await refreshed.json()) as typeof oauth;
    expect(latest.scope).toBe('femho:read');
    await page.getByTestId(`token-revoke-${grant.id}`).click();
    await expect(page.getByTestId(`oauth-status-${grant.id}`)).toHaveText('Revocat');
    expect((await callMcp(page, latest.access_token, 'tools/list')).status()).toBe(401);
    expect((await refresh(latest.refresh_token)).ok()).toBe(false);
    expect((await callMcp(page, manualToken, 'tools/list')).ok()).toBe(true);
  });
}

test('OAuth conserva la petició al login i només activa MCP en autoritzar-lo', async ({
  page,
  browser,
}) => {
  const account = {
    name: 'MCP sense sessió',
    email: 'external-login@example.com',
    password: 'la-contrasenya-de-prova',
  };
  await enterAsNew(page, account);
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scope = await page.request.post('/api/v1/scopes', {
    headers,
    data: { name: 'Personal login MCP', color: '--plou-blue', kind: 'individual' },
  });
  expect(scope.status()).toBe(201);

  const context = await browser.newContext({ baseURL: baseUrl, locale: 'ca-ES' });
  try {
    const anonymous = await context.newPage();
    await startAuthorization(anonymous, 'Client sense sessió', 'femho:read');
    const consentUrl = anonymous.url();
    expect(consentUrl).toMatch(/\/connect\/mcp\?request=/);
    await expect(anonymous.getByTestId('mcp-login-context')).toBeVisible();
    await anonymous.getByTestId('login-email').fill(account.email);
    await anonymous.getByTestId('login-password').fill(account.password);
    await anonymous.getByTestId('login-submit').click();

    await expect(anonymous.getByTestId('mcp-consent-account')).toContainText(account.email);
    await expect(anonymous).toHaveURL(consentUrl);
    await expect(anonymous.getByRole('heading', { name: 'Client sense sessió' })).toBeVisible();
    await expect(operation(anonymous, 'tasks:read')).toBeChecked();
    await expect(operation(anonymous, 'tasks:create')).toHaveCount(0);
    await expect(operation(anonymous, 'ai_executions:read')).not.toBeChecked();
    await expect(operation(anonymous, 'ai_executions:write')).toHaveCount(0);
    await anonymous.getByLabel('Personal login MCP', { exact: true }).check();
    await anonymous.getByTestId('mcp-consent-enable').check();
    await anonymous.getByRole('button', { name: 'Denegar', exact: true }).click();
    await anonymous.waitForURL('**/oauth-test-callback?**');
    const callback = new URL(anonymous.url());
    expect(callback.searchParams.get('state')).toBe('browser-test');
    expect(callback.searchParams.get('error')).toBe('access_denied');
    expect(callback.searchParams.has('code')).toBe(false);
    const access = await page.request.get('/api/v1/external-access', { headers });
    expect(await access.json()).toMatchObject({ mcp_enabled: false, api_enabled: false });
    const grants = await page.request.get('/api/v1/tokens', { headers });
    expect((await grants.json()).data).toEqual([]);

    const { clientId, verifier } = await startAuthorization(
      anonymous,
      'Client de lectura',
      'femho:read',
    );
    await expect(anonymous.getByTestId('mcp-consent-account')).toContainText(account.email);
    await anonymous.getByLabel('Personal login MCP', { exact: true }).check();
    const allow = anonymous.getByRole('button', { name: 'Autoritzar', exact: true });
    await expect(allow).toBeDisabled();
    await anonymous.getByTestId('mcp-consent-enable').check();
    await operation(anonymous, 'ai_executions:read').check();
    await allow.click();
    await anonymous.waitForURL('**/oauth-test-callback?**');
    const confirmed = new URL(anonymous.url());
    const issued = await exchangeCode(
      anonymous,
      clientId,
      verifier,
      confirmed.searchParams.get('code')!,
    );
    expect(issued.scope).toBe('femho:read');
    expect(await (await callMcp(anonymous, issued.access_token, 'tools/list')).text()).toContain(
      'get_task_execution_context',
    );
    const updated = await page.request.get('/api/v1/external-access', { headers });
    expect(await updated.json()).toMatchObject({ mcp_enabled: true, api_enabled: false });
  } finally {
    await context.close();
  }
});
