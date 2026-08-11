/**
 * D'on ve cada cosa: la icona de provinença.
 *
 * Amb una sola font externa n'hi havia prou amb el context. Amb calendaris, `.ics`, canals
 * RSS i, aviat, correu, «d'on ha sortit això?» és una pregunta que la pantalla ha de
 * respondre sense obrir res — i és la que fa que la gent apagui una font sencera en comptes
 * d'ajustar-la.
 *
 * **Per què la resposta va simulada aquí.** Una cita amb provinença només pot venir d'un
 * calendari **subscrit**, i un calendari subscrit és de només lectura a la capa de servei:
 * el navegador no en pot fabricar cap per l'API, i és correcte que no pugui. Que la dada
 * viatgi de debò —a la bústia i a la tasca que en surt— es prova al servidor, a
 * `apps/server/src/http/inbox-sources.test.ts`. Aquí es prova **el dibuix**, que és el que
 * només es pot veure en un navegador.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const MEU = {
  name: 'Provinenca',
  email: 'provinenca@example.com',
  password: 'la-contrasenya-de-prova',
};

function avui(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Una bústia amb una cita d'un `.ics` i una d'un RSS. */
async function ambDuesFonts(page: Page, scope: string): Promise<void> {
  await page.route('**/api/v1/inbox?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: avui(),
        dated: [],
        overdue: [],
        undated: [],
        events: [
          {
            calendar_id: '00000000-0000-7000-8000-0000000000a1',
            scope_id: scope,
            uid: 'festiu',
            recurrence_id: null,
            summary: 'Sant Joan',
            location: null,
            starts_at: `${avui()}T09:00:00.000Z`,
            ends_at: `${avui()}T10:00:00.000Z`,
            all_day: false,
            source_kind: 'ical',
            calendar_name: 'Festius',
            calendar_color: null,
          },
          {
            calendar_id: '00000000-0000-7000-8000-0000000000a2',
            scope_id: scope,
            uid: 'titular',
            recurrence_id: null,
            summary: 'Un titular',
            location: null,
            starts_at: `${avui()}T11:00:00.000Z`,
            ends_at: `${avui()}T11:00:00.000Z`,
            all_day: false,
            source_kind: 'rss',
            calendar_name: 'Notícies',
            calendar_color: null,
          },
        ],
      }),
    }),
  );
}

async function elMeuAmbit(page: Page): Promise<string> {
  const bearer = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: bearer })).json()) as {
    id: string;
    kind: string;
  }[];
  return scopes.find((s) => s.kind === 'individual')!.id;
}

test('una cita d’un .ics i una d’un RSS es distingeixen d’un cop d’ull', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await elMeuAmbit(page);
  await ambDuesFonts(page, scope);
  await page.goto(`/board?scopes=${scope}`);

  const events = page.locator('[data-testid="inbox-events"]');
  await expect(events).toBeVisible({ timeout: 10_000 });
  await expect(events.locator('[data-testid="source-icon-ical"]')).toHaveCount(1);
  await expect(events.locator('[data-testid="source-icon-rss"]')).toHaveCount(1);
});

test('i la icona porta nom: sola no diria res a qui no la coneix', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await elMeuAmbit(page);
  await ambDuesFonts(page, scope);
  await page.goto(`/board?scopes=${scope}`);

  const icona = page.locator('[data-testid="source-icon-rss"]').first();
  await expect(icona).toBeVisible({ timeout: 10_000 });
  await expect(icona).toHaveAttribute('aria-label', /RSS/);
});

test('i hereta el color del text, no el seu', async ({ page }) => {
  /**
   * És la lliçó de l'emoji `📅` que hi havia a la columna Fet: el que no hereta el color
   * no segueix el tema. I `--ink-faint` està prohibit per a informació que cal llegir
   * (`docs/04` §8), o sigui que es comprova que el traç té color de debò.
   */
  await enterAsNew(page, MEU);
  const scope = await elMeuAmbit(page);
  await ambDuesFonts(page, scope);
  await page.goto(`/board?scopes=${scope}`);

  const icona = page.locator('[data-testid="source-icon-ical"]').first();
  await expect(icona).toBeVisible({ timeout: 10_000 });
  const traç = await icona.evaluate((node) => getComputedStyle(node).stroke);
  expect(traç).toContain('rgb');
});

test('una tasca que has escrit tu no porta cap icona', async ({ page }) => {
  /**
   * Sense resposta simulada: aquesta és de debò. Posar-hi una icona que digués «manual»
   * seria inventar una font i omplir de soroll totes les targetes del tauler.
   */
  await enterAsNew(page, MEU);
  const scope = await elMeuAmbit(page);
  const bearer = { authorization: `Bearer ${await token(page)}` };
  await page.request.post('/api/v1/tasks', {
    headers: bearer,
    data: { scope_id: scope, title: 'Escrita per mi', status: 'inbox' },
  });

  await page.goto(`/board?scopes=${scope}`);
  const tasca = page
    .locator('[data-testid="inbox-rail"] [data-testid^="task-"]')
    .filter({ hasText: 'Escrita per mi' })
    .first();
  await expect(tasca).toBeVisible({ timeout: 10_000 });
  await expect(tasca.locator('[data-testid^="source-icon-"]')).toHaveCount(0);
});
