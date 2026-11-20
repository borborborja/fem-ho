import { expect, test, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import type { components } from '@fem-ho/contracts';
import { enterAsNew, token } from './entrar.js';

// El Chrome complet permet mostrar notificacions. El binari headless-shell les denega.
test.use({ channel: 'chromium' });

async function account(page: Page, testName: string) {
  await enterAsNew(page, {
    name: 'Prova notificacions',
    email: `push-${testName}-${uuidv7()}@example.com`,
    password: 'la-contrasenya-de-prova',
  });
  const headers = { authorization: `Bearer ${await token(page)}` };
  const scopes = await page.request.get('/api/v1/scopes', { headers });
  await expect(scopes).toBeOK();
  const first = ((await scopes.json()) as { id: string }[])[0]!;
  return { headers, scopeId: first.id };
}

async function enable(page: Page, staleEndpoint?: string): Promise<string> {
  const endpoint = `https://push.example.net/${uuidv7()}`;
  await page.context().grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
  await page.addInitScript(
    ({ initial, renewed }) => {
      let subscription: PushSubscription | null = null;
      let endpoint = initial;
      // Només se substitueix el transport del fabricant, no el registre ni el worker.
      PushManager.prototype.subscribe = async (options) => {
        subscription = {
          endpoint,
          options,
          toJSON: () => ({ endpoint, keys: { p256dh: 'public-key', auth: 'auth-secret' } }),
          unsubscribe: async () => {
            subscription = null;
            endpoint = renewed;
            return true;
          },
        } as PushSubscription;
        return subscription;
      };
      PushManager.prototype.getSubscription = async () => subscription;
    },
    { initial: staleEndpoint ?? endpoint, renewed: endpoint },
  );
  await page.goto('/settings?tab=notifications');
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/v1/push/subscriptions') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
    ),
    page.getByRole('button', { name: 'Activa els avisos' }).click(),
  ]);
  await expect(page.getByText('Subscripció push activa')).toBeVisible();
  const body = response.request().postDataJSON() as components['schemas']['PushSubscriptionInput'];
  return body.device_id!;
}

test('cada àmbit comença desactivat i el navegador conserva els canvis després de recarregar', async ({
  page,
}) => {
  const { headers, scopeId } = await account(page, 'settings');
  const deviceId = await enable(page);
  const group = page.getByTestId(`notification-scope-${scopeId}`);
  const inbox = group.getByRole('switch', { name: 'Entrades a Inbox' });
  const status = group.getByRole('switch', { name: 'Canvis d’estat' });
  const activity = group.getByRole('switch', { name: 'Activitat de la fitxa' });
  const created = group.getByRole('switch', { name: 'Tasques noves' });
  for (const item of [inbox, status, activity, created]) await expect(item).not.toBeChecked();
  await status.check();
  await expect(status).toBeChecked();
  await inbox.check();
  await expect(inbox).toBeChecked();
  await expect(inbox).toBeEnabled();

  await page.reload();
  await expect(status).toBeChecked();
  await expect(inbox).toBeChecked();
  await expect(activity).not.toBeChecked();

  const otherDevice = await page.request.get(`/api/v1/push/devices/${uuidv7()}`, { headers });
  await expect(otherDevice).toBeOK();
  const other = (await otherDevice.json()) as components['schemas']['PushDeviceSettings'];
  expect(other.scopes.find((scope) => scope.scope_id === scopeId)?.inbox_entry).toBe(false);

  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Desactiva els avisos' }).click();
  await expect(page.getByText('Avisos desactivats', { exact: true })).toBeVisible();
  await expect(inbox).toBeDisabled();
  await expect(page.getByText('Cal connexió per configurar els avisos.')).toBeVisible();
  await page.context().setOffline(false);
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/push/devices/${deviceId}`, { headers });
      await expect(response).toBeOK();
      return (await response.json()).enabled;
    })
    .toBe(false);
});

test('renova un punt final del navegador que encara pertany al compte anterior', async ({
  page,
}) => {
  await account(page, 'stale');
  const staleEndpoint = `https://push.example.net/${uuidv7()}`;
  const attempts: string[] = [];
  await page.route('**/api/v1/push/subscriptions', async (route) => {
    const input = route.request().postDataJSON() as components['schemas']['PushSubscriptionInput'];
    attempts.push(input.endpoint);
    if (input.endpoint === staleEndpoint) {
      await route.fulfill({
        status: 409,
        json: { type: 'https://femho.example/errors/push-subscription-in-use' },
      });
    } else {
      await route.continue();
    }
  });
  await enable(page, staleEndpoint);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toBe(staleEndpoint);
  expect(attempts[1]).not.toBe(staleEndpoint);
});

test('el worker de producció mostra l’avís, obre la fitxa i descarta un avís d’un compte tancat', async ({
  page,
  context,
}) => {
  const { headers, scopeId } = await account(page, 'worker');
  const deviceId = await enable(page);
  const taskId = uuidv7();
  const title = 'Tasca de la notificació';
  await expect(
    await page.request.post('/api/v1/tasks', {
      headers,
      data: { id: taskId, scope_id: scopeId, title, status: 'todo' },
    }),
  ).toBeOK();
  await page.goto('/');
  await expect(page.getByTestId('topbar')).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const cdp = await context.newCDPSession(page);
  let registrationId: string | undefined;
  const origin = new URL(page.url()).origin;
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    registrationId = registrations.find(
      (registration) => registration.scopeURL === `${origin}/` && !registration.isDeleted,
    )?.registrationId;
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrationId).toBeDefined();
  const event: components['schemas']['TaskActivityNotification'] = {
    id: uuidv7(),
    kind: 'task_created',
    device_id: deviceId,
    task_id: taskId,
    title: 'Tasca nova per API',
    body: title,
    created_at: new Date().toISOString(),
  };
  const deliver = (payload: typeof event) =>
    cdp.send('ServiceWorker.deliverPushMessage', {
      origin,
      registrationId: registrationId!,
      data: JSON.stringify(payload),
    });
  await deliver(event);
  const tag = `femho-activity-${event.id}`;
  await expect
    .poll(() =>
      page.evaluate(async (value) => {
        const registration = await navigator.serviceWorker.ready;
        const [notification] = await registration.getNotifications({ tag: value });
        return notification?.body;
      }, tag),
    )
    .toBe(title);

  const [worker] = context.serviceWorkers();
  // Executa el listener real amb la notificació que Chromium acaba de mostrar.
  await Promise.all([
    page.waitForURL(`**/?task=${taskId}`),
    worker!.evaluate(async (value) => {
      const global = self as unknown as { registration: ServiceWorkerRegistration };
      const [notification] = await global.registration.getNotifications({ tag: value });
      let work: Promise<unknown> | undefined;
      const click = Object.assign(new Event('notificationclick'), {
        notification,
        waitUntil: (promise: Promise<unknown>) => {
          work = promise;
        },
      });
      self.dispatchEvent(click);
      // L'esdeveniment de prova no pot posar una finestra en primer pla.
      await work?.catch(() => undefined);
    }, tag),
  ]);
  await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL('/');
  await deliver(event);
  expect(
    await page.evaluate(async (value) => {
      const registration = await navigator.serviceWorker.ready;
      return (await registration.getNotifications({ tag: value })).length;
    }, tag),
  ).toBe(0);

  await page.getByTestId('topbar-profile').click();
  await page.getByRole('menuitem', { name: 'Tancar sessió' }).click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const cache = await caches.open('femho-activity-notifications');
        return (await cache.match('/.__femho-notify/device')) !== undefined;
      }),
    )
    .toBe(false);
  await deliver({ ...event, id: uuidv7() });
  const notices = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.getNotifications()).filter((notice) =>
      notice.tag.startsWith('femho-activity-'),
    ).length;
  });
  expect(notices).toBe(0);
});

test('el permís bloquejat mostra com recuperar-lo i una tasca inaccessible no obre contingut', async ({
  page,
}) => {
  await account(page, 'permission');
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { value: 'denied' });
  });
  await page.goto('/settings?tab=notifications');
  await expect(page.getByText('El sistema ha blocat el permís de notificacions.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activa els avisos' })).toHaveCount(0);

  await page.goto(`/?task=${uuidv7()}`);
  const modal = page.getByTestId('task-modal');
  await expect(modal.getByRole('alert')).toHaveText('La tasca ja no està disponible.');
  await modal.getByRole('button', { name: 'Tanca', exact: true }).click();
  await expect(page).toHaveURL('/');
});
