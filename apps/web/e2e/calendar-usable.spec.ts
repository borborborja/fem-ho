/**
 * Les quatre coses que feien la web inservible, i que només es veien mirant-la.
 *
 * Cap d'aquestes hauria fallat en cap prova de servidor: totes tres capes estaven bé i el
 * defecte era la pantalla. Van sortir d'una sessió de fer-la servir de debò.
 */

import { expect, test, type Page } from '@playwright/test';
import { enter, enterAsNew } from './entrar.js';

test.describe.configure({ mode: 'serial' });

/** Una crida a l'API des de la pestanya, amb la sessió que hi ha. */
async function apiCall(page: Page, method: string, path: string, body?: unknown): Promise<string> {
  return page.evaluate(
    async ([method, path, body]) => {
      const stored = localStorage.getItem('femho.tokens');
      const token =
        stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
      const res = await fetch(path as string, {
        method: method as string,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      return res.text();
    },
    [method, path, body ?? null] as const,
  );
}

test('el «+» del calendari obre el modal, i no es queda carregant', async ({ page }) => {
  /**
   * **Es quedava girant per sempre.** El botó cridava `onOpenTask('')`, o sigui que el modal
   * s'obria demanant la tasca `''` al servidor, rebia un 404 i es quedava esperant. Un
   * identificador buit no és «cap tasca»: és una tasca que no existeix.
   */
  await enter(page);
  const fallides: string[] = [];
  page.on('response', (res) => {
    if (res.url().includes('/api/v1/tasks/') && !res.ok()) fallides.push(String(res.status()));
  });

  await page.goto('/calendar?date=2026-08-11');
  await page.getByTestId('full-edit-inbox').first().click();

  // El modal s'obre i porta **el dia que estaves mirant**: el botó és al peu d'aquell dia.
  const data = page.locator('input[type="date"]').first();
  await expect(data).toBeVisible();
  await expect(data).toHaveValue('2026-08-11');
  expect(fallides).toHaveLength(0);
});

test('la vista de mes diu què hi ha cada dia, i no només que n’hi ha', async ({ page }) => {
  await enter(page);

  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const scopeId = scopes[0]!.id;
  const cal = JSON.parse(
    await apiCall(page, 'POST', '/api/v1/calendars', {
      scope_id: scopeId,
      name: 'Proves del mes',
      kind: 'events',
    }),
  ) as { id: string };
  await apiCall(page, 'POST', '/api/v1/events', {
    calendar_id: cal.id,
    uid: 'mes-1',
    summary: 'Reunió de pares',
    starts_at: '2026-08-13T09:00:00.000Z',
    ends_at: '2026-08-13T10:00:00.000Z',
  });

  await page.goto('/calendar?date=2026-08-11');

  /**
   * **Escrit, no un punt.** Un punt de cinc píxels diu que el dia té alguna cosa i no diu
   * quina, que és l'única pregunta que una vista de mes ha de respondre.
   */
  const dia = page.getByTestId('day-items-2026-08-13');
  await expect(dia).toContainText('Reunió de pares');
});

test('el mes sencer cap en una pantalla de portàtil', async ({ page }) => {
  /**
   * `aspect-ratio: 1` lligava l'alçada a l'amplada: a 1440px les cel·les feien 137px, el mes
   * en feia 926, i **les dues últimes setmanes queien sota la línia de flotació**.
   */
  await enter(page);
  await page.setViewportSize({ width: 1366, height: 700 });
  await page.goto('/calendar?date=2026-08-11');

  const graella = page.getByTestId('calendar-month');
  await expect(graella).toBeVisible();
  const alt = (await graella.boundingBox())?.height ?? 0;
  expect(alt).toBeLessThan(700);

  // I l'última setmana es veu sense desplaçar-se.
  const ultim = page.getByTestId('day-2026-08-31');
  const caixa = await ultim.boundingBox();
  expect(caixa?.y ?? 9999).toBeLessThan(700);
});

test('els quatre camps d’afegida ràpida estan a la mateixa línia', async ({ page }) => {
  /**
   * Les tres columnes van dins d'un `KanbanGroup` que ja posa el farciment; cadascuna n'hi
   * tornava a posar a baix, i el camp quedava **catorze píxels més amunt** que el de la
   * bústia, que és la seva pròpia targeta. Es veia com una fila trencada, i era una suma.
   */
  await enter(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/board');

  const tops: number[] = [];
  for (const status of ['inbox', 'todo', 'doing', 'done']) {
    const caixa = await page.getByTestId(`quick-add-${status}`).boundingBox();
    expect(caixa, `falta el camp de ${status}`).not.toBeNull();
    tops.push(Math.round(caixa!.y));
  }

  // Tots iguals: un sol valor diferent vol dir una fila trencada.
  expect(new Set(tops).size).toBe(1);
});

test('amb vint-i-cinc tasques, la columna es desplaça per dins', async ({ page }) => {
  /**
   * **`fullHeight` mirava la ruta i no el que es pinta.** Deia `route.path === '/'`, i el
   * tauler també es pinta a `/board` i a qualsevol altra ruta que no sigui Ajustos, el
   * cercador o el tauler general. Allà les columnes no es desplaçaven per dins: amb
   * vint-i-cinc tasques la pàgina creixia fins a **2.168 píxels** i el camp d'afegida
   * ràpida quedava mil dos-cents per sota de la vista.
   *
   * No es notava perquè el commutador de dalt porta a `/` — **i perquè les proves anaven a
   * `/board`**, o sigui que comprovaven una disposició que ningú fa servir.
   */
  /**
   * **Un usuari propi, que és l'únic aïllament de debò que té aquesta suite.**
   *
   * Corre en paral·lel contra **una sola base**. Vint-i-cinc tasques a l'àmbit de tothom
   * canvien el que veuen les altres proves —i en van tombar dues que no tenen res a veure
   * amb això—. Fer-se un àmbit tampoc no basta: `design.spec` agafa **el primer xip**
   * d'àmbit, i un àmbit nou li canvia quin és.
   */
  await enterAsNew(page, {
    name: 'Volum',
    email: 'volum@example.com',
    password: 'la-contrasenya-de-prova',
  });
  await page.setViewportSize({ width: 1440, height: 900 });

  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const scopeId = scopes[0]!.id;
  for (let i = 0; i < 25; i++) {
    await apiCall(page, 'POST', '/api/v1/tasks', {
      scope_id: scopeId,
      title: `Molta feina ${String(i + 1)}`,
      status: 'todo',
      position: `m${String(i).padStart(3, '0')}`,
    });
  }

  for (const ruta of [`/?scopes=${scopeId}`, `/board?scopes=${scopeId}`]) {
    await page.goto(ruta);
    await expect(page.getByTestId('quick-add-todo')).toBeVisible();

    const mides = await page.evaluate(() => ({
      pagina: document.documentElement.scrollHeight,
      finestra: window.innerHeight,
      camp: document.querySelector('[data-testid="quick-add-todo"]')?.getBoundingClientRect()
        .bottom,
    }));

    // La pàgina no creix: el que es desplaça és la columna.
    expect(mides.pagina, `a ${ruta} la pàgina ha crescut`).toBeLessThanOrEqual(mides.finestra + 2);
    // I el camp d'afegir es veu sense desplaçar-se enlloc.
    expect(mides.camp ?? 9999, `a ${ruta} el camp queda fora`).toBeLessThanOrEqual(mides.finestra);
  }
});

test('i la setmana diu quantes cites amaga', async ({ page }) => {
  /**
   * Un dia amb vuit cites n'ensenyava tres i **callava les altres cinc**. Amagar és
   * inevitable en una columna de 130 píxels; amagar en silenci, no.
   */
  await enter(page);
  const scopes = JSON.parse(await apiCall(page, 'GET', '/api/v1/scopes')) as { id: string }[];
  const cal = JSON.parse(
    await apiCall(page, 'POST', '/api/v1/calendars', {
      scope_id: scopes[0]!.id,
      name: 'Setmana plena',
      kind: 'events',
    }),
  ) as { id: string };

  for (let i = 0; i < 6; i++) {
    await apiCall(page, 'POST', '/api/v1/events', {
      calendar_id: cal.id,
      uid: `plena-${String(i)}`,
      summary: `Cita ${String(i + 1)}`,
      starts_at: `2026-08-14T0${String(i + 3)}:00:00.000Z`,
      ends_at: `2026-08-14T0${String(i + 4)}:00:00.000Z`,
    });
  }

  await page.goto('/calendar?date=2026-08-14');
  await page.getByText('Setmanal', { exact: true }).click();
  await expect(page.getByTestId('week-more-2026-08-14')).toHaveText('+2');
});
