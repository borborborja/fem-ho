/**
 * El navegador de dia de la bústia.
 *
 * `docs/02` §4 el demana des del primer dia —*"navegador de dia (`‹ 5 d'agost ›`)"*— i el
 * forat on va, la prop `header` d'`InboxRail`, existia amb aquell comentari escrit i mai
 * s'hi va posar res.
 *
 * **Per a què serveix, que és el que aquesta prova ha de demostrar**: has acabat el que
 * tocava avui i et situes a demà per avançar feina. O sigui que el que importa no és que
 * les fletxes es moguin, sinó que **canviï el contingut de la columna** i que les tasques
 * sense data hi siguin igualment tots els dies. Si desapareguessin en navegar, el
 * navegador seria una manera de perdre de vista el que t'has apuntat.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** Compte propi: aquest fitxer crea tasques amb data i compta què queda a la columna. */
const MEU = {
  name: 'Dies',
  email: 'dies@example.com',
  password: 'la-contrasenya-de-prova',
};

/** Un dia en local, com el fa la pantalla: mai per UTC. */
function iso(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Tres tasques a la bústia: una per avui, una per demà i una sense data.
 *
 * Per API i no clicant: el que es prova és el navegador, i muntar-ho per la interfície
 * seria provar l'afegida ràpida i el modal pel camí.
 */
async function escenari(page: Page): Promise<string> {
  const bearer = { authorization: `Bearer ${await token(page)}` };
  const scopes = (await (await page.request.get('/api/v1/scopes', { headers: bearer })).json()) as {
    id: string;
    kind: string;
  }[];
  const scope = scopes.find((s) => s.kind === 'individual')!.id;

  for (const [title, due] of [
    ["D'avui", iso(0)],
    ['De demà', iso(1)],
    ['Sense dia', null],
  ] as const) {
    await page.request.post('/api/v1/tasks', {
      headers: bearer,
      data: { scope_id: scope, title, status: 'inbox', ...(due === null ? {} : { due_date: due }) },
    });
  }
  return scope;
}

test('navegar a demà canvia què hi ha, i el que no té dia es queda', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText("D'avui", { timeout: 10_000 });
  await expect(rail).toContainText('Sense dia');
  await expect(rail).not.toContainText('De demà');

  // Avui es diu "avui", no la data: és on ets el 99% del temps i llegir-ho és més ràpid.
  await expect(page.locator('[data-testid="inbox-day-label"]')).toHaveText('Avui');
  // I no hi ha res a on tornar, o sigui que el botó de tornada no hi és.
  await expect(page.locator('[data-testid="inbox-day-today"]')).toHaveCount(0);

  await page.locator('[data-testid="inbox-day-next"]').click();

  // **El moll de l'os.** Canvia la que té data; la que no en té, es queda.
  await expect(rail).toContainText('De demà');
  await expect(rail).not.toContainText("D'avui");
  await expect(rail).toContainText('Sense dia');

  // I ara sí que hi ha on tornar.
  const today = page.locator('[data-testid="inbox-day-today"]');
  await expect(today).toBeVisible();
  await expect(page.locator('[data-testid="inbox-day-label"]')).not.toHaveText('Avui');

  await today.click();
  await expect(rail).toContainText("D'avui");
  await expect(rail).not.toContainText('De demà');
});

test('endarrere també funciona, i ahir no hi ha res', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const rail = page.locator('[data-testid="inbox-rail"]');
  await expect(rail).toContainText("D'avui", { timeout: 10_000 });

  await page.locator('[data-testid="inbox-day-prev"]').click();
  await expect(rail).not.toContainText("D'avui");
  await expect(rail).not.toContainText('De demà');
  // Les sense dia, igualment.
  await expect(rail).toContainText('Sense dia');
});

test('les altres tres columnes no es mouen en canviar de dia', async ({ page }) => {
  /**
   * El navegador és **de la bústia i de ningú més**. "Per fer", "Fent" i "Fet" són
   * l'estat de la feina, no una agenda: si canviessin amb el dia, el tauler deixaria de
   * ser un tauler. Vénen de `/board`, que no sap de dies, i això ho fixa.
   */
  await enterAsNew(page, MEU);
  const scope = await escenari(page);

  const bearer = { authorization: `Bearer ${await token(page)}` };
  await page.request.post('/api/v1/tasks', {
    headers: bearer,
    data: { scope_id: scope, title: 'Ja en marxa', status: 'doing' },
  });

  await page.goto(`/board?scopes=${scope}`);
  const doing = page.locator('[data-column-status="doing"]');
  await expect(doing).toContainText('Ja en marxa', { timeout: 10_000 });

  await page.locator('[data-testid="inbox-day-next"]').click();
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('De demà');
  await expect(doing).toContainText('Ja en marxa');
});

test('la bústia també té calendari, i sense límit de futur', async ({ page }) => {
  /**
   * Amb fletxes soles, anar d'aquí a deu dies són deu clics. I **aquí no hi ha límit de
   * futur**, a diferència de la columna Fet: allà mirar endavant no vol dir res —què vaig
   * fer demà— i aquí és per a què serveix, avançar feina.
   */
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  const boto = page.locator('[data-testid="inbox-day-pick"]');
  await expect(boto).toBeVisible({ timeout: 10_000 });
  // La mateixa icona que la columna Fet, i no un emoji.
  await expect(boto.locator('svg')).toHaveCount(1);

  await boto.click();
  // Un dia d'aquí a una setmana es pot triar: mirar endavant és el sentit de la bústia.
  const futur = page.locator(`[data-testid="day-${iso(7)}"]`);
  await expect(futur).toBeEnabled();
  await futur.click();

  await expect(page.locator('[data-testid="inbox-day-label"]')).not.toHaveText('Avui');
  // I les sense data hi són igualment, com a qualsevol altre dia.
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Sense dia');
});

test('i enrere també, que és on es mira què hi havia', async ({ page }) => {
  await enterAsNew(page, MEU);
  const scope = await escenari(page);
  await page.goto(`/board?scopes=${scope}`);

  await page.locator('[data-testid="inbox-day-pick"]').click();
  await page.locator(`[data-testid="day-${iso(-3)}"]`).click();

  await expect(page.locator('[data-testid="inbox-day-today"]')).toBeVisible();
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText('Sense dia');
});
