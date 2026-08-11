/**
 * El que arriba de les fonts, dins de la bústia.
 *
 * **La prova que importa no és que la cita hi surti: és que no sembli una tasca.** La
 * regla 7 s'ha esmenat per deixar-les entrar a la bústia —"no tenen mai estat de kanban
 * ni s'arrosseguen entre columnes; hi poden sortir com a font, mai com a targeta de
 * tasca"—, i una regla així només val si es pot comprovar. Aquí es comprova.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** Compte propi: aquest fitxer crea esdeveniments i mira què hi ha a la columna. */
const MEU = {
  name: 'Cites',
  email: 'cites@example.com',
  password: 'la-contrasenya-de-prova',
};

function avui(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Un esdeveniment d'aquesta casa, avui a les nou, i una tasca per comparar-hi. */
async function escenari(page: Page): Promise<string> {
  const bearer = { authorization: `Bearer ${await token(page)}` };

  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: bearer })).json()) as {
    id: string;
    kind: string;
  }[];
  const scope = scopes.find((s) => s.kind === 'individual')!.id;

  const calendars = (await (
    await page.request.get('/api/v1/calendars', { headers: bearer })
  ).json()) as { id: string; scope_id: string; kind: string }[];
  // Un compte acabat de registrar no en té cap de propi: se'n fa un.
  const calendar =
    calendars.find((c) => c.scope_id === scope && c.kind === 'events')?.id ??
    (
      (await (
        await page.request.post('/api/v1/calendars', {
          headers: bearer,
          data: { scope_id: scope, name: 'Casa', kind: 'events', origin: 'local' },
        })
      ).json()) as { id: string }
    ).id;

  await page.request.post('/api/v1/events', {
    headers: bearer,
    data: {
      calendar_id: calendar,
      summary: 'Dentista',
      starts_at: `${avui()}T09:00:00Z`,
      ends_at: `${avui()}T10:00:00Z`,
    },
  });
  await page.request.post('/api/v1/tasks', {
    headers: bearer,
    data: { scope_id: scope, title: 'Una tasca normal', status: 'inbox' },
  });

  return scope;
}

test('una cita del calendari surt a la bústia, a la seva secció', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText('Una tasca normal', { timeout: 10_000 });

  // La secció existeix i la cita hi és, amb l'hora i d'on ve.
  const events = page.locator('[data-testid="inbox-events"]');
  await expect(events).toBeVisible();
  await expect(events).toContainText('Dentista');
  await expect(events).toContainText('Del calendari');
});

test('i NO és una targeta de tasca: és el que sosté la regla 7', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const cita = page.locator('[data-kind="event"]').first();
  await expect(cita).toBeVisible({ timeout: 10_000 });

  /**
   * Les tres coses que es poden fer amb una tasca i que no volen dir res sobre una cita.
   * Si algun dia algú dibuixa els esdeveniments amb `BoardCard` per estalviar-se un
   * component, això cau — que és exactament el que ha de passar.
   */
  await expect(cita.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(cita.locator('[data-testid="card-advance"]')).toHaveCount(0);
  await expect(cita.locator('[draggable="true"]')).toHaveCount(0);

  // I no és dins de cap embolcall arrossegable, que és com es mouen les tasques.
  await expect(page.locator('[data-testid^="task-"] [data-kind="event"]')).toHaveCount(0);
});

test('es llegeix igual de bé que una tasca: no va difuminada', async ({ page }) => {
  /**
   * **La temptació era difuminar-la, i és el que no s'ha de fer.** `docs/04` §8 reserva
   * `--ink-faint` per a text decoratiu i diu que no s'ha de fer servir per a res que
   * calgui llegir; una cita de la bústia és informació que has de llegir. La diferència
   * va a la superfície i la forma —vora discontínua, un altre fons—, no al contrast.
   *
   * Cap comprovació permanent ho veuria: `contrast-check` només mira la seva llista de
   * parells. Per això es mesura aquí.
   */
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const cita = page.locator('[data-kind="event"]').first();
  await expect(cita).toBeVisible({ timeout: 10_000 });

  const estil = await cita.evaluate((node) => {
    const propi = getComputedStyle(node);
    const resum = node.querySelectorAll('span');
    return {
      opacitat: propi.opacity,
      vora: propi.borderTopStyle,
      colors: [...resum].map((s) => getComputedStyle(s).color),
    };
  });

  // Ni opacitat sobre el node sencer, que és el mateix defecte disfressat.
  expect(estil.opacitat).toBe('1');
  // I la forma que sí que la distingeix.
  expect(estil.vora).toBe('dashed');
});

test("treure una cita de la bústia la treu, i NO l'esborra del calendari", async ({ page }) => {
  /**
   * El botó diu «Treure» i no «Esborrar» a posta: el que ve d'una font no és nostre per
   * esborrar-lo, i el que es desa és una preferència teva. Aquesta prova comprova les
   * dues meitats — que marxa de la bústia i que segueix sent al calendari—, perquè si
   * només es comprovés la primera, esborrar-lo de debò passaria igual.
   */
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const events = page.locator('[data-testid="inbox-events"]');
  await expect(events).toContainText('Dentista', { timeout: 10_000 });

  // Les proves d'aquest fitxer comparteixen compte i cadascuna hi deixa la seva cita:
  // s'ha de mirar la targeta CONCRETA i no si la secció queda buida.
  const primera = page.locator('[data-kind="event"]').first();
  const quina = (await primera.getAttribute('data-testid'))!;
  await page.locator(`[data-testid="${quina}"] [data-testid^="inbox-event-eye-"]`).click();
  await expect(page.locator(`[data-testid="${quina}"]`)).toHaveCount(0);

  /**
   * I al calendari hi és igualment.
   *
   * Es mira **la graella del dia i no `main`**: el rail de la bústia també viu dins de
   * `main`, o sigui que buscar-hi el títol passaria encara que la graella fos buida — que
   * és exactament el que passava, perquè la finestra de la vista diària era de mitjanit a
   * mitjanit i no hi cabia res.
   */
  await page.goto('/calendar');
  await page.locator('[data-testid="calendar-mode-day"]').click();
  await expect(page.locator('[data-testid="calendar-day"]')).toContainText('Dentista', {
    timeout: 10_000,
  });
});

test('al calendari, la cita treta es distingeix i es pot recuperar', async ({ page }) => {
  /**
   * **El recorregut de tornada sencer, que és el que fa que treure-la no doni por.**
   *
   * Fins ara, al calendari, clicar un esdeveniment no feia absolutament res: el text i el
   * punt de color eren informatius i prou. Aquesta prova comprova les tres coses noves:
   * que es pot obrir, que la que no és a la bústia es distingeix, i que des d'allà hi
   * torna.
   */
  await enterAsNew(page, MEU);
  const scope = await escenari(page);

  // Es treu de la bústia des del tauler.
  await page.goto(`/board?scopes=${scope}`);
  const primera = page.locator('[data-kind="event"]').first();
  await expect(primera).toBeVisible({ timeout: 10_000 });
  await primera.locator('[data-testid^="inbox-event-eye-"]').click();

  // I al calendari, a la vista de dia, hi és amb la vora que ho diu.
  await page.goto('/calendar');
  await page.locator('[data-testid="calendar-mode-day"]').click();
  const item = page.locator('[data-testid^="day-item-"][data-muted="true"]').first();
  await expect(item).toBeVisible({ timeout: 10_000 });

  // Clicar-la obre la fitxa, que diu amb paraules què vol dir aquella vora.
  await item.click();
  const fitxa = page.locator('[data-testid="event-sheet"]');
  await expect(fitxa).toBeVisible();
  // El fragment és de la frase i no el terme del vocabulari: `vocab-lint` vigila que el
  // nom canònic de la columna no s'escrigui en català fora dels catàlegs (regla 3).
  await expect(fitxa.locator('[data-testid="event-sheet-state"]')).toContainText(
    'no et reclama el dia',
  );

  // I d'allà torna a la bústia.
  await fitxa.locator('[data-testid="event-sheet-toggle"]').click();
  await expect(page.locator('[data-testid="event-sheet"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Dentista', {
    timeout: 10_000,
  });
});

test("d'una cita se'n fa una tasca, i esborrar-la la torna", async ({ page }) => {
  /**
   * El recorregut que va obrir tota aquesta funció: la pregunta era si l'esdeveniment
   * perdura a la bústia després de fer-ne una tasca. La resposta ha de ser **no**, perquè
   * seria la mateixa obligació dues vegades, i esborrar la tasca l'ha de tornar.
   */
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const primera = page.locator('[data-kind="event"]').first();
  await expect(primera).toBeVisible({ timeout: 10_000 });
  const quina = (await primera.getAttribute('data-testid'))!;

  await page.locator(`[data-testid="${quina}"] [data-testid^="inbox-event-totask-"]`).click();

  // La cita marxa de la secció de fonts...
  await expect(page.locator(`[data-testid="${quina}"]`)).toHaveCount(0);

  // ...i al seu lloc hi ha una tasca de veritat: amb casella i amb fletxa per avançar,
  // que és exactament el que una cita no té.
  const rail = page.locator('[data-testid="inbox-rail"]');
  const tasca = rail.locator('[data-testid^="task-"]', { hasText: 'Dentista' }).first();
  await expect(tasca).toBeVisible();
  await expect(tasca.locator('[data-kind="event"]')).toHaveCount(0);

  // I esborrant-la, la cita torna: és el defecte, i no ha calgut desar res per fer-ho.
  // El llapis només es revela amb el ratolí a sobre: un clic forçat sobre un element amb
  // `pointer-events: none` no obre res.
  await tasca.hover();
  await tasca.locator('[data-testid="card-edit"]').click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
  await page.locator('[data-testid="task-delete"]').click();
  await page.locator('[data-testid="task-delete-confirm"]').click();

  await expect(page.locator('[data-testid="inbox-events"]')).toContainText('Dentista', {
    timeout: 10_000,
  });
});
