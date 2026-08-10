/**
 * Les fonts de dades del calendari, contra el servidor real.
 *
 * `docs/07` §9 preveu un CalDAV o un `.ics` com a origen d'un àmbit; el disseny validat
 * hi afegeix l'RSS. Les tres coses que decideixen si això és utilitzable de veritat:
 * que se'n puguin afegir des d'Ajustos, que la contrasenya **no torni mai** a la
 * interfície, i que al calendari es puguin apagar sense treure-les a ningú.
 */

import { expect, test, type Page } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/**
 * Una crida a l'API **des de la pestanya**, amb la sessió que hi ha.
 *
 * `page.request` va per un context a part i no porta el testimoni: viu a `localStorage`
 * perquè Android fa servir la mateixa API amb `Authorization: Bearer` (veure
 * `app/api.ts`), i una cookie no serviria per a les dues.
 */
async function apiCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; raw: string }> {
  return page.evaluate(
    async ([method, path, body]) => {
      const stored = localStorage.getItem('femho.tokens');
      const token =
        stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
      const response = await fetch(path as string, {
        method: method as string,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, raw: await response.text() };
    },
    [method, path, body ?? null] as const,
  );
}

/** L'identificador del primer àmbit, que és on es proven les fonts. */
async function firstScope(page: Page): Promise<string> {
  const { raw } = await apiCall(page, 'GET', '/api/v1/scopes');
  return (JSON.parse(raw) as { id: string }[])[0]!.id;
}

test("s'hi poden afegir les tres menes de font", async ({ page }) => {
  await enter(page);
  const scope = await firstScope(page);

  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-calendars"]').click();

  await expect(page.locator(`[data-testid="sources-${scope}"]`)).toBeVisible();

  for (const [kind, name, url] of [
    ['ical', 'Festius', 'https://exemple.test/festius.ics'],
    ['rss', 'Escola', 'https://exemple.test/escola.xml'],
  ]) {
    await page.locator(`[data-testid="source-kind-${scope}-${kind}"]`).click();
    await page.locator(`[data-testid="source-name-${scope}"]`).fill(name!);
    await page.locator(`[data-testid="source-url-${scope}"]`).fill(url!);
    await page.locator(`[data-testid="source-add-${scope}"]`).click();
    await expect(page.locator(`[data-testid="sources-${scope}"]`)).toContainText(name!);
  }

  // Amb CalDAV apareixen usuari i contrasenya; amb les altres dues, no: un `.ics`
  // publicat i un RSS es baixen sense credencials.
  await page.locator(`[data-testid="source-kind-${scope}-caldav"]`).click();
  await expect(page.locator(`[data-testid="source-pass-${scope}"]`)).toBeVisible();
  await page.locator(`[data-testid="source-kind-${scope}-rss"]`).click();
  await expect(page.locator(`[data-testid="source-pass-${scope}"]`)).toHaveCount(0);
});

test('la contrasenya no torna mai a la interfície', async ({ page }) => {
  await enter(page);
  const scope = await firstScope(page);

  const created = await apiCall(page, 'POST', '/api/v1/calendars', {
    scope_id: scope,
    name: 'Feina externa',
    kind: 'events',
    origin: 'subscription',
    source_kind: 'caldav',
    source_url: 'https://exemple.test/dav/',
    source_username: 'borja',
    source_secret: 'la-contrasenya-del-caldav',
  });
  expect(created.status).toBe(201);

  /**
   * **Ni al cos de la resposta ni a la llista.**
   *
   * `docs/07` §9 la vol xifrada en repòs; que no torni és el que fa que xifrar-la
   * serveixi de res. Es mira el JSON cru i no un camp concret: si algun dia s'hi
   * afegeix `source_secret_enc` "per depurar", això ho ha de veure.
   */
  expect(created.raw).not.toContain('la-contrasenya-del-caldav');

  const { raw } = await apiCall(page, 'GET', '/api/v1/calendars');
  expect(raw).not.toContain('la-contrasenya-del-caldav');
  expect(raw).not.toContain('source_secret');
  // El que sí que hi ha d'haver: de quina mena és i qui hi entra.
  expect(raw).toContain('"source_kind":"caldav"');
  expect(raw).toContain('"source_username":"borja"');
});

test('al calendari, les fonts es poden apagar i encendre', async ({ page }) => {
  await enter(page);
  await page.goto('/calendar');

  const chips = page.locator('[data-testid="calendar-sources"]');
  // Amb una sola font no hi ha res a triar; a aquestes alçades ja n'hi ha tres.
  await expect(chips).toBeVisible({ timeout: 10_000 });

  const first = chips.locator('button').first();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'false');

  // I sobreviu a una recàrrega: és una preferència, no un estat de pantalla.
  await page.reload();
  await expect(page.locator('[data-testid="calendar-sources"] button').first()).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

test("l'interruptor de la bústia surt on toca i comença on toca", async ({ page }) => {
  await enter(page);
  const scope = await firstScope(page);

  /**
   * Es creen les dues menes per API perquè el que es prova aquí és **la posició inicial
   * de la casella**, no el formulari d'alta, que ja té prova pròpia més amunt.
   */
  const fetes: Record<string, string> = {};
  for (const [kind, name] of [
    ['ical', 'Festius de la bústia'],
    ['rss', 'Titulars de la bústia'],
  ] as const) {
    const { raw } = await apiCall(page, 'POST', '/api/v1/calendars', {
      scope_id: scope,
      name,
      kind: 'events',
      origin: 'subscription',
      source_kind: kind,
      source_url: `https://exemple.test/bustia.${kind}`,
    });
    fetes[kind] = (JSON.parse(raw) as { id: string }).id;
  }

  await page.goto('/settings?tab=calendars');

  const ics = page.locator(`[data-testid="source-inbox-${fetes.ical!}"]`);
  const rss = page.locator(`[data-testid="source-inbox-${fetes.rss!}"]`);

  /**
   * **Aquesta és la prova que val de debò.** Un `.ics` neix encès i un RSS apagat, i
   * cap dels dos té res desat a la base: la casella ensenya el defecte que li dona el
   * servidor. Si algú llegís el tri-estat com un booleà, totes dues sortirien apagades i
   * ningú veuria res a la bústia.
   */
  await expect(ics).toBeChecked();
  await expect(rss).not.toBeChecked();

  // I es pot canviar d'opinió, en els dos sentits.
  await rss.click();
  await expect(rss).toBeChecked();
  await page.reload();
  await expect(page.locator(`[data-testid="source-inbox-${fetes.rss!}"]`)).toBeChecked();
});
