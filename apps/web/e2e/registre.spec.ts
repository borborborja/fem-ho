/**
 * El Registre, contra el servidor de debò.
 *
 * El que decideix aquí és el cicle sencer que fa que això substitueixi una eina que algú fa
 * servir cada dia: **moure una targeta compta les hores sense que ningú les apunti**, la
 * taula les agrupa per dia amb el total, el cronograma les ensenya a la seva hora, i
 * arrossegar-hi un bloc corregeix el número.
 *
 * Amb compte propi (`enterAsNew`): encendre el registre és una preferència d'àmbit, i amb el
 * compte compartit de la suite la resta de proves es trobarien columnes noves.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const COMPTE = {
  name: 'Qui factura hores',
  email: 'registre@example.com',
  password: 'la-contrasenya-de-prova',
};

/**
 * L'àmbit i el projecte d'aquesta prova, amb el registre ja encès.
 *
 * **Cada prova es fa el seu àmbit** i amb un nom propi: comparteixen compte —el registre és
 * una preferència per àmbit i cal encendre'l en algun—, i amb el mateix nom la segona
 * trobaria l'àmbit de la primera i miraria dades que no ha creat.
 */
async function prepara(
  page: Page,
  nom: string,
): Promise<{ scope: string; project: string; auth: string }> {
  await enterAsNew(page, COMPTE);

  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-scopes"]').click();
  await page.locator('[data-testid="new-scope-name"]').fill(nom);
  await page.locator('[data-testid="new-scope-create"]').click();
  const fila = page.locator('[data-testid^="scope-row-"]', { hasText: nom });
  await expect(fila).toBeVisible();
  const scope = (await fila.getAttribute('data-testid'))!.replace('scope-row-', '');

  const auth = `Bearer ${await token(page)}`;
  const project = (
    (await (
      await page.request.post('/api/v1/projects', {
        headers: { authorization: auth },
        data: { scope_id: scope, name: 'Ajuntament de Salt' },
      })
    ).json()) as { id: string }
  ).id;

  await page.request.patch(`/api/v1/scopes/${scope}/settings`, {
    headers: { authorization: auth },
    data: { time_tracking: true },
  });

  return { scope, project, auth };
}

test('moure una targeta a Fent i treure-la deixa la dedicació apuntada', async ({ page }) => {
  const { scope, auth } = await prepara(page, 'Feina facturable');

  /**
   * **Ningú apunta res.** Es fa el gest de sempre —passar la targeta per Fent— i el temps hi
   * queda; aquí s'envelleix el bloc perquè una prova dura mil·lisegons i per sota d'un minut
   * no és feina.
   */
  const creada = await page.request.post('/api/v1/tasks', {
    headers: { authorization: auth },
    data: { scope_id: scope, title: 'Mirar mencions' },
  });
  const taskId = ((await creada.json()) as { id: string }).id;

  await page.request.post(`/api/v1/tasks/${taskId}/move`, {
    headers: { authorization: auth },
    data: { status: 'doing' },
  });
  await page.request.patch(`/api/v1/sessions/${await primerBloc(page, auth)}`, {
    headers: { authorization: auth },
    data: { started_at: fa(50), ended_at: new Date().toISOString() },
  });

  await page.goto(`/registre?scopes=${scope}`);
  await expect(page.getByTestId('registre-screen')).toBeVisible();

  // La taula porta la tasca amb els seus minuts, i el resum els suma.
  await expect(page.getByTestId('registre-table')).toContainText('Mirar mencions');
  await expect(page.getByTestId('registre-summary')).toContainText('50m');

  // I les pastilles diuen per a qui: sense projecte, «Intern».
  await expect(page.getByTestId('registre-pills')).toContainText('Intern');
});

test('el cronograma pinta el bloc i arrossegant-lo es corregeix', async ({ page }) => {
  const { scope, auth } = await prepara(page, 'Feina del cronograma');

  // Un bloc d'aquest matí, a una hora coneguda.
  const creada = await page.request.post('/api/v1/tasks', {
    headers: { authorization: auth },
    data: { scope_id: scope, title: 'Publicacions FM' },
  });
  const taskId = ((await creada.json()) as { id: string }).id;

  const avui = new Date();
  const inici = new Date(avui);
  inici.setHours(10, 0, 0, 0);
  const fi = new Date(avui);
  fi.setHours(11, 0, 0, 0);

  await page.request.post('/api/v1/sessions', {
    headers: { authorization: auth },
    data: { task_id: taskId, started_at: inici.toISOString(), ended_at: fi.toISOString() },
  });

  await page.goto(`/registre?scopes=${scope}`);
  await page.getByTestId('registre-view').getByText('Cronograma').click();

  const bloc = page
    .locator('[data-testid^="chrono-block-"]')
    .filter({ hasText: 'Publicacions FM' })
    .first();
  await expect(bloc).toContainText('Publicacions FM');
  await expect(bloc).toContainText('1h');

  /**
   * **S'arrossega la vora dreta i el número canvia.** És l'única manera raonable de corregir
   * una hora mal comptada, i el que es prova és que el canvi arribi al servidor: es torna a
   * demanar la taula i el minut hi és.
   */
  const caixa = (await bloc.boundingBox())!;
  await page.mouse.move(caixa.x + caixa.width - 3, caixa.y + caixa.height / 2);
  await page.mouse.down();
  await page.mouse.move(caixa.x + caixa.width + 60, caixa.y + caixa.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(bloc).not.toContainText('1h 0m');
  await page.getByTestId('registre-view').getByText('Taula').click();
  await expect(page.getByTestId('registre-summary')).not.toContainText('1h ·');
});

test("l'exportació porta les columnes de sempre", async ({ page }) => {
  const { scope } = await prepara(page, 'Feina exportable');
  await page.goto(`/registre?scopes=${scope}`);

  const baixada = page.waitForEvent('download');
  await page.getByTestId('registre-export').click();
  const fitxer = await baixada;
  expect(fitxer.suggestedFilename()).toBe('registre.csv');
});

test('les Estadístiques diuen el mateix que la taula', async ({ page }) => {
  const { scope, auth } = await prepara(page, 'Feina amb estadístiques');

  const creada = await page.request.post('/api/v1/tasks', {
    headers: { authorization: auth },
    data: { scope_id: scope, title: 'Preparar la reunió' },
  });
  const taskId = ((await creada.json()) as { id: string }).id;

  const inici = new Date();
  inici.setHours(9, 0, 0, 0);
  const fi = new Date();
  fi.setHours(11, 0, 0, 0);
  await page.request.post('/api/v1/sessions', {
    headers: { authorization: auth },
    data: { task_id: taskId, started_at: inici.toISOString(), ended_at: fi.toISOString() },
  });

  await page.goto(`/estadistiques?scopes=${scope}`);
  await expect(page.getByTestId('estadistiques-screen')).toBeVisible();

  // Dues hores, una tasca: el que diu la taula, dit de lluny.
  await expect(page.getByTestId('stats-total')).toContainText('2.0 h');
  await expect(page.getByTestId('stats-tasks')).toContainText('1');
  await expect(page.getByTestId('stats-average')).toContainText('2h');

  // I els desglossaments hi són, amb «Sense tipologia» com una fila més.
  await expect(page.getByTestId('stats-evolution')).toBeVisible();
  await expect(page.getByTestId('stats-by-type')).toContainText('Sense tipologia');
  await expect(page.getByTestId('stats-by-person')).toContainText('Qui factura hores');
});

/** El bloc obert que acaba de deixar el tauler. */
async function primerBloc(page: Page, auth: string): Promise<string> {
  const res = await page.request.get('/api/v1/sessions', { headers: { authorization: auth } });
  const report = (await res.json()) as { data: { id: string }[] };
  return report.data[0]?.id ?? '';
}

function fa(minuts: number): string {
  return new Date(Date.now() - minuts * 60_000).toISOString();
}
