import { expect, test } from '@playwright/test';
import { enterAsNew } from './entrar.js';

test('connecta dos Gmail i assigna la safata de cadascun a un àmbit', async ({ page }) => {
  await enterAsNew(page, {
    name: 'Correu Google',
    email: 'gmail-settings@example.test',
    password: 'contrasenya-de-prova',
  });
  await page.goto('/settings');
  await page.getByTestId('settings-tab-scopes').click();
  await page.getByTestId('new-scope-name').fill('Feina Gmail');
  await page.getByTestId('new-scope-create').click();
  await expect(
    page.locator('[data-testid^="scope-row-"]', { hasText: 'Feina Gmail' }),
  ).toBeVisible();

  const accounts: {
    id: string;
    name: string;
    username: string;
    transport: string;
    host: string;
    auth_method: string;
    oauth_status: string;
  }[] = [];
  const rules: {
    id: string;
    account_id: string;
    folder: string;
    scope_id: string;
    title_template: string;
    gmail_label_id: string | null;
    enabled: boolean;
  }[] = [];
  let currentId = '';
  const emails = ['work@example.test', 'personal@example.test'];
  const attempt = () => ({
    id: currentId,
    account_id: currentId,
    email: emails[accounts.length],
    status: 'ready',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    authorization_url: 'https://accounts.google.com/test-femho-consent',
    transport: 'gmail_api',
  });
  await page.route('https://accounts.google.com/test-femho-consent', (route) =>
    route.fulfill({
      status: 303,
      headers: { location: 'http://localhost:4173/settings?tab=mail' },
    }),
  );
  await page.route('**/api/v1/mail/oauth/google', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true } });
    const input = route.request().postDataJSON() as { account_id: string; transport: string };
    expect(input.transport).toBe('gmail_api');
    currentId = input.account_id;
    return route.fulfill({ json: attempt() });
  });
  await page.route('**/api/v1/mail/oauth/attempts/**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: attempt() });
    const email = emails[accounts.length]!;
    const account = {
      id: currentId,
      name: email,
      username: email,
      transport: 'gmail_api',
      host: 'imap.gmail.com',
      auth_method: 'google',
      oauth_status: 'connected',
    };
    accounts.push(account);
    return route.fulfill({ json: account });
  });
  await page.route('**/api/v1/mail/accounts', (route) => route.fulfill({ json: accounts }));
  await page.route('**/api/v1/mail/accounts/*/folders', (route) =>
    route.fulfill({
      json: {
        folders: ['INBOX', 'Documents'],
        labels: [
          { id: 'INBOX', name: 'INBOX' },
          { id: 'Label_02', name: 'Documents' },
        ],
        delimiter: '/',
        error: null,
      },
    }),
  );
  await page.route('**/api/v1/mail/rules', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: rules });
    const input = route.request().postDataJSON() as (typeof rules)[number];
    const rule = { ...input, enabled: true };
    expect(rule.gmail_label_id).toBe('INBOX');
    rules.push(rule);
    return route.fulfill({ status: 201, json: rule });
  });
  await page.route('**/api/v1/mail/rules/legacy-rule', (route) => {
    const rule = rules.find(({ id }) => id === 'legacy-rule')!;
    const input = route.request().postDataJSON() as Partial<(typeof rules)[number]>;
    Object.assign(rule, input);
    if (input.gmail_label_id === 'Label_02') rule.folder = 'Documents';
    return route.fulfill({ json: rule });
  });

  await page.goto('/settings?tab=mail');
  const google = page.getByTestId('google-mail');
  for (const email of emails) {
    await google.getByRole('button', { name: 'Connecta amb Google' }).click();
    await expect(google.getByRole('status')).toHaveText(`Connectar el correu ${email}?`);
    await google.getByRole('button', { name: 'Confirma la connexió' }).click();
    await expect(
      page.getByTestId('mail-rule-account').getByRole('option', { name: email }),
    ).toHaveCount(1);
  }

  const scope = page.getByTestId('mail-rule-scope');
  const scopes = await scope
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(scopes.length).toBeGreaterThanOrEqual(2);
  for (const [index, account] of accounts.entries()) {
    await page.getByTestId('mail-rule-account').selectOption(account.id);
    await page.getByTestId('mail-rule-folder').selectOption('INBOX');
    await scope.selectOption(scopes[index]!);
    await page.getByTestId('mail-add-rule').click();
    await expect(page.getByTestId('mail-rule-folder')).toHaveValue('');
  }
  expect(rules.map(({ account_id, scope_id }) => [account_id, scope_id])).toEqual(
    accounts.map(({ id }, index) => [id, scopes[index]]),
  );

  rules.push({
    id: 'legacy-rule',
    account_id: accounts[0]!.id,
    folder: 'Carpeta antiga',
    scope_id: scopes[0]!,
    title_template: '{{subject}}',
    gmail_label_id: null,
    enabled: false,
  });
  await page.reload();
  const legacy = page.getByTestId('mail-rule-legacy-rule');
  await expect(legacy.getByText('Aquesta regla necessita una etiqueta de Gmail.')).toBeVisible();
  await legacy.getByRole('button', { name: 'Tria una etiqueta de Gmail' }).click();
  await legacy.getByRole('combobox', { name: 'Etiqueta de Gmail' }).selectOption('Label_02');
  await legacy.getByRole('button', { name: 'Desa l’etiqueta' }).click();
  await expect(legacy.getByText('Documents', { exact: true })).toBeVisible();
  await legacy.getByRole('button', { name: 'Activa la regla' }).click();
  await expect(legacy.getByRole('button', { name: 'Activa la regla' })).toHaveCount(0);
  expect(rules.find(({ id }) => id === 'legacy-rule')).toMatchObject({
    scope_id: scopes[0],
    gmail_label_id: 'Label_02',
    enabled: true,
  });
});
