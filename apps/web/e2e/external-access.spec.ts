import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

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
    await page.getByTestId('token-create').click();
    const secret = page.getByTestId('token-value');
    await expect(secret).toBeVisible();
    await page.getByRole('button', { name: 'Comprovar connexió MCP' }).click();
    await expect(page.getByTestId('mcp-verified')).toContainText('Connexió verificada');
    await expect(page.getByTestId('mcp-verified')).toContainText('Personal MCP');
    await page.getByRole('button', { name: 'Ja he desat el token' }).click();
    await expect(secret).toHaveCount(0);
    await page.screenshot({ path: `/tmp/femho-mcp-settings-${theme}.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({ path: `/tmp/femho-mcp-settings-mobile-${theme}.png`, fullPage: true });

    // El consentiment passa pel servidor real i torna només al callback registrat.
    const registered = await page.request.post('/oauth/register', {
      data: {
        client_name: 'Client navegador',
        redirect_uris: ['http://localhost:4173/oauth-test-callback'],
        token_endpoint_auth_method: 'none',
      },
    });
    expect(registered.status()).toBe(201);
    const clientId = (await registered.json()).client_id as string;
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://localhost:4173/oauth-test-callback',
      resource: 'http://localhost:4173/mcp',
      state: 'browser-test',
      response_type: 'code',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      scope: 'femho:read femho:write',
    });
    await page.goto(`/oauth/authorize?${query}`);
    await expect(page.getByRole('heading', { name: 'Autoritzar connexió a Fem-ho' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Autoritzar', exact: true })).toBeDisabled();
    await page.getByLabel('Personal MCP', { exact: true }).check();
    await page.screenshot({ path: `/tmp/femho-mcp-consent-${theme}.png`, fullPage: true });
    await page.route('**/oauth-test-callback?**', (route) =>
      route.fulfill({ contentType: 'text/plain', body: 'Callback' }),
    );
    await page.getByRole('button', { name: 'Autoritzar', exact: true }).click();
    await page.waitForURL('**/oauth-test-callback?**');
    const callback = new URL(page.url());
    expect(callback.searchParams.get('state')).toBe('browser-test');
    const issued = await page.request.post('/oauth/token', {
      form: {
        client_id: clientId,
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
        resource: 'http://localhost:4173/mcp',
        redirect_uri: 'http://localhost:4173/oauth-test-callback',
      },
    });
    expect(issued.status()).toBe(200);
    expect((await issued.json()).scope).toBe('femho:read');
    const grants = await page.request.get('/api/v1/tokens', { headers });
    const grant = (await grants.json()).data.find(
      (g: { name: string }) => g.name === 'Client navegador',
    );
    expect(grant.scope_ids).toEqual([scopeId]);
    expect(grant.channels).toEqual(['mcp']);
    expect(grant.capabilities).not.toContain('tasks:write');
  });
}
