/**
 * El commutador de la bústia: tot / individuals / compartits.
 *
 * **Aquesta prova existeix perquè els tres botons no feien res.** Es pintaven, es podien
 * clicar, i cada clic anava a `/api/v1/me/settings` — una ruta que no existeix. El 404 es
 * menjava en silenci i ni desava, ni filtrava, ni es quedava marcat. Cap prova ho va veure
 * perquè cap prova els clicava: n'hi havia del filtre al servidor i de la preferència, i
 * cap del gest.
 *
 * O sigui que aquí es clica de debò i es compta què queda a la columna.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** El seu compte: aquest fitxer canvia `inbox_origin`, que és una preferència d'usuari. */
const MEU = {
  name: 'Bústia',
  email: 'bustia@example.com',
  password: 'la-contrasenya-de-prova',
};

/**
 * Un àmbit individual i un de col·lectiu, amb una tasca a cadascun.
 *
 * Es fa per l'API i no per la interfície: el que es prova és el commutador, i muntar
 * l'escenari clicant seria provar tres coses més pel camí.
 */
async function escenari(page: Page): Promise<{ ids: string[]; individual: string }> {
  const bearer = { authorization: `Bearer ${await token(page)}` };

  const existents = await page.request.get('/api/v1/scopes', { headers: bearer });
  const scopes = (await existents.json()) as { id: string; name: string; kind: string }[];

  const individual = scopes.find((scope) => scope.kind === 'individual')!;
  const collectiu =
    scopes.find((scope) => scope.name === 'Bústia compartida') ??
    ((await (
      await page.request.post('/api/v1/scopes', {
        headers: bearer,
        data: { name: 'Bústia compartida', kind: 'collective', color: '--femho-scope-4' },
      })
    ).json()) as { id: string });

  for (const [scopeId, title] of [
    [individual.id, 'Només meva'],
    [collectiu.id, 'De tots'],
  ] as const) {
    await page.request.post('/api/v1/tasks', {
      headers: bearer,
      data: { scope_id: scopeId, title },
    });
  }

  return { ids: [individual.id, collectiu.id], individual: individual.id };
}

test('el commutador filtra de debò, i cada posició ensenya el que diu', async ({ page }) => {
  await enterAsNew(page, MEU);
  const { ids } = await escenari(page);
  await page.goto(`/board?scopes=${ids.join(',')}`);

  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText('Només meva', { timeout: 10_000 });
  await expect(rail).toContainText('De tots');

  const chips = page.locator('[data-testid="inbox-mailbox"]');
  await expect(chips).toBeVisible();

  // Individuals: hi és la meva i **no** la compartida.
  await chips.locator('[data-testid="inbox-mailbox-own"]').click();
  await expect(rail).toContainText('Només meva');
  await expect(rail).not.toContainText('De tots');

  // Compartits: exactament al revés.
  await chips.locator('[data-testid="inbox-mailbox-shared"]').click();
  await expect(rail).toContainText('De tots');
  await expect(rail).not.toContainText('Només meva');

  // Tot: les dues.
  await chips.locator('[data-testid="inbox-mailbox-all"]').click();
  await expect(rail).toContainText('Només meva');
  await expect(rail).toContainText('De tots');
});

/**
 * **La tria és una preferència, no un estat de la pantalla.** Ha de sobreviure a una
 * recàrrega i valdre a tots els dispositius, com `inbox_show_overdue`.
 */
test('i la posició triada sobreviu a una recàrrega', async ({ page }) => {
  await enterAsNew(page, MEU);
  const { ids } = await escenari(page);
  await page.goto(`/board?scopes=${ids.join(',')}`);

  const chips = page.locator('[data-testid="inbox-mailbox"]');
  await chips.locator('[data-testid="inbox-mailbox-shared"]').click();
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Només meva');

  await page.reload();
  await expect(page.locator('[data-testid="inbox-mailbox-shared"]')).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 10_000 },
  );
  await expect(page.locator('[data-testid="inbox-rail"]')).not.toContainText('Només meva');
});

/**
 * **Els números són el que fa entendre els botons abans de clicar-los.** Amb tres
 * adjectius sols, l'única manera de saber què fan és provar-los d'un en un.
 */
test("cada botó diu quants n'hi ha, i què fa si t'hi atures", async ({ page }) => {
  await enterAsNew(page, MEU);
  const { ids } = await escenari(page);
  await page.goto(`/board?scopes=${ids.join(',')}`);

  const own = page.locator('[data-testid="inbox-mailbox-own"]');
  await expect(own).toBeVisible();
  await expect(own).toContainText(/\d/u);
  // La frase sencera hi és per a qui s'hi atura o hi navega amb lector de pantalla.
  await expect(own).toHaveAttribute('title', /individuals/iu);
});

/**
 * **Un commutador que no pot canviar res no ha de sortir.**
 *
 * Amb només àmbits individuals actius, les tres posicions ensenyen el mateix. Que hi hagi
 * un botó que no fa res és el que ensenya a ignorar la capçalera sencera.
 */
test('amb només àmbits individuals actius, el commutador no hi és', async ({ page }) => {
  await enterAsNew(page, MEU);
  const { individual } = await escenari(page);
  await page.goto(`/board?scopes=${individual}`);

  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Només meva', {
    timeout: 10_000,
  });
  await expect(page.locator('[data-testid="inbox-mailbox"]')).toHaveCount(0);
});
