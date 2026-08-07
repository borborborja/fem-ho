/**
 * Compartir un àmbit, amb dos comptes de debò i contra el servidor real.
 *
 * És l'única prova que respon la pregunta que importa: **si convido algú, veu el que li
 * toca i no veu el que no?** Les unitàries diuen que les consultes filtren; això diu que
 * el camí sencer —convit, acceptació, tauler— fa el que promet.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN, enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const ALTRE = { name: 'Alba', email: 'alba@example.com', password: 'la-contrasenya-alba' };

/**
 * Una crida amb la sessió que hi ha a la pestanya.
 *
 * Torna **el codi i el cos**, no només el cos: una prova que ha de comprovar que una
 * cosa es rebutja necessita el codi, i deduir-lo de la forma del cos és com s'acaba
 * afirmant que un 200 és un 403.
 */
async function call(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ([method, path, body]) => {
      const stored = localStorage.getItem('femho.tokens');
      const token =
        stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
      // El `content-type` només si hi ha cos: Fastify rebutja amb 400 un cos buit
      // declarat com a JSON, i això taparia el 403 que la prova vol comprovar.
      const res = await fetch(path as string, {
        method: method as string,
        headers:
          body === null
            ? { authorization: `Bearer ${token}` }
            : { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: res.status,
        body: res.status === 204 ? null : ((await res.json()) as unknown),
      };
    },
    [method, path, body ?? null] as const,
  );
}

/** Una pestanya nova amb la seva pròpia sessió: dos usuaris alhora. */
async function fresh(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: 'ca-ES' });
  return context.newPage();
}

let scopeId: string;
let inviteUrl: string;

test("el propietari crea l'àmbit i n'emet un convit", async ({ page }) => {
  await enter(page, ADMIN);

  const scope = await call(page, 'POST', '/api/v1/scopes', {
    name: 'Cases',
    color: '--femho-scope-2',
    kind: 'collective',
  });
  scopeId = (scope.body as { id: string }).id;

  await call(page, 'POST', '/api/v1/tasks', { scope_id: scopeId, title: 'Pintar el rebedor' });

  const invite = await call(page, 'POST', `/api/v1/scopes/${scopeId}/invites`, {
    role: 'collaborator',
  });
  expect(invite.status, JSON.stringify(invite.body)).toBe(201);
  inviteUrl = (invite.body as { invite_url: string }).invite_url;
  expect(inviteUrl).toContain('/join/');
});

test("l'altre l'accepta i veu el tauler compartit", async ({ browser }) => {
  const page = await fresh(browser);

  // Un segon compte, per la via normal d'invitació a la instància.
  const admin = await fresh(browser);
  await enter(admin, ADMIN);
  const invite = (
    await call(admin, 'POST', '/api/v1/admin/users/invite', {
      email: ALTRE.email,
      name: ALTRE.name,
    })
  ).body as { invite_url: string };
  await admin.close();

  await page.goto(new URL(invite.invite_url).pathname);
  await page.locator('[data-testid="invite-password"]').fill(ALTRE.password);
  await page.locator('[data-testid="invite-repeat"]').fill(ALTRE.password);
  await page.locator('[data-testid="invite-submit"]').click();
  // En acabar, el formulari desapareix i queda la targeta d'"ja està".
  await expect(page.locator('[data-testid="invite"]')).toBeHidden({ timeout: 15_000 });

  await enter(page, ALTRE);

  // Abans d'acceptar, no veu l'àmbit.
  const abans = (await call(page, 'GET', '/api/v1/scopes')).body as { id: string }[];
  expect(abans.map((s) => s.id)).not.toContain(scopeId);

  // La pantalla del convit diu **de qui és** abans d'acceptar-lo.
  await page.goto(new URL(inviteUrl).pathname);
  await expect(page.locator('[data-testid="join-scope"]')).toContainText('Borja');
  await expect(page.locator('[data-testid="join-scope"]')).toContainText('Cases');
  await page.locator('[data-testid="join-accept"]').click();

  await expect(page.locator('[data-testid="topbar"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="topbar"]')).toContainText('Cases');

  // I la tasca del propietari hi és.
  const board = (await call(page, 'GET', `/api/v1/board?scope_ids=${scopeId}`)).body as {
    columns: { groups: { tasks: { title: string }[] }[] }[];
  };
  const titols = board.columns.flatMap((c) => c.groups.flatMap((g) => g.tasks.map((t) => t.title)));
  expect(titols).toContain('Pintar el rebedor');

  await page.close();
});

test('però no pot convidar, ni reanomenar, ni esborrar', async ({ browser }) => {
  const page = await fresh(browser);
  await enter(page, ALTRE);

  for (const [method, path, body] of [
    ['POST', `/api/v1/scopes/${scopeId}/invites`, { role: 'collaborator' }],
    ['PATCH', `/api/v1/scopes/${scopeId}`, { name: 'Meu ara' }],
    ['DELETE', `/api/v1/scopes/${scopeId}`, undefined],
  ] as const) {
    const res = await call(page, method, path, body);
    // Tots tres han de rebotar. El cos va al missatge perquè, si un passa, es vegi QUÈ
    // ha tornat en comptes d'un "esperava 403".
    expect(res.status, `${method} ${path} → ${JSON.stringify(res.body)}`).toBe(403);
  }

  await page.close();
});

test("i quan surt de l'àmbit, deixa de veure'l", async ({ browser }) => {
  const page = await fresh(browser);
  await enter(page, ALTRE);

  await call(page, 'DELETE', `/api/v1/scopes/${scopeId}/members/me`);

  const despres = (await call(page, 'GET', '/api/v1/scopes')).body as { id: string }[];
  expect(despres.map((s) => s.id)).not.toContain(scopeId);

  await page.close();
});
