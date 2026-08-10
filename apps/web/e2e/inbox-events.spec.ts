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
