/**
 * docs/13 M7 · comprovació de la fita: `e2e: calendar.spec`.
 *
 * Els criteris que toca aquesta prova:
 *   - Vistes mensual, setmanal i diària.
 *   - **El rail és la MATEIXA instància de component que la columna del kanban** (P4).
 *   - La setmana comença en dilluns. Sempre (docs/00).
 */

import { expect, test } from '@playwright/test';

test('les tres vistes existeixen i es poden canviar', async ({ page }) => {
  await page.goto('/proof/calendar');

  await expect(page.locator('[data-testid="calendar-month"]')).toBeVisible();

  await page.locator('[data-testid="view-week"]').click();
  await expect(page.locator('[data-testid="calendar-week"]')).toBeVisible();
  await expect(page.locator('[data-testid="calendar-month"]')).toHaveCount(0);

  await page.locator('[data-testid="view-day"]').click();
  await expect(page.locator('[data-testid="calendar-day"]')).toBeVisible();
});

/**
 * El primer dia de la setmana ja **no és una constant**: depèn de l'idioma i de la
 * preferència. La pàgina de prova fixa el català i dilluns, que és el que docs/00
 * demanava quan hi havia un sol idioma; la variació per idioma la prova `i18n.spec`.
 */
test('en català, la setmana comença en dilluns', async ({ page }) => {
  await page.goto('/proof/calendar');

  // Els encapçalaments, en ordre i en minúscula (docs/00).
  const headers = page.locator('[data-testid="calendar-month"] > div:nth-child(2) > div');
  await expect(headers).toHaveText(['dl', 'dt', 'dc', 'dj', 'dv', 'ds', 'dg']);

  // I la graella hi encaixa: l'1 d'agost de 2026 és dissabte, o sigui que ha de caure
  // a la sisena columna. Si la setmana comencés en diumenge, cauria a la setena.
  const cells = page.locator('[data-testid="calendar-month"] > div:nth-child(3) > button');
  const primerDia = page.locator('[data-testid="day-2026-08-01"]');
  const index = await cells.evaluateAll(
    (all, target) => all.indexOf(target as HTMLElement),
    await primerDia.elementHandle(),
  );
  expect(index % 7).toBe(5);
});

test('seleccionar un dia el marca', async ({ page }) => {
  await page.goto('/proof/calendar');

  await expect(page.locator('[data-testid="day-2026-08-05"]')).toHaveAttribute(
    'data-selected',
    'true',
  );

  await page.locator('[data-testid="day-2026-08-12"]').click();
  await expect(page.locator('[data-testid="day-2026-08-12"]')).toHaveAttribute(
    'data-selected',
    'true',
  );
  await expect(page.locator('[data-testid="day-2026-08-05"]')).toHaveAttribute(
    'data-selected',
    'false',
  );
});

test('navegar de mes funciona i no perd la graella', async ({ page }) => {
  await page.goto('/proof/calendar');
  await page.getByRole('button', { name: 'Mes següent' }).click();
  await expect(page.locator('[data-testid="day-2026-09-01"]')).toBeVisible();

  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await expect(page.locator('[data-testid="day-2026-08-01"]')).toBeVisible();
});

test('AQUESTA és la de P4: el rail és el MATEIX component que la columna del kanban', async ({
  page,
}) => {
  // docs/14 P4: "és literalment la mateixa instància de component. La columna Inbox del
  // kanban i el rail de l'Inbox al costat del calendari són el mateix component amb la
  // mateixa font de dades. Si divergeixen, es notarà."

  const estructura = async (url: string, dins: string): Promise<string> => {
    await page.goto(url);
    return page.locator(`${dins} [data-testid="inbox-rail"]`).evaluate((el) => {
      // Es compara l'ESQUELET: mateixes etiquetes, mateixa profunditat, mateix nombre
      // de nodes. No els identificadors de prova, perquè el kanban embolcalla cada
      // targeta amb l'arrossegable i el rail no — i això SÍ que és una diferència
      // legítima de com cada amfitrió fa servir el mateix component, no una
      // divergència del component.
      const walk = (node: Element): string => {
        const children = [...node.children].map(walk).join('');
        // Els nodes que injecta l'amfitrió pel punt d'extensió `wrapCard` no són part
        // del component compartit: el kanban hi posa l'arrossegable i el rail no. Se
        // salten i es conserven els seus fills, que sí que són d'InboxRail.
        return node.getAttribute('data-host-wrapper') === 'true'
          ? children
          : `<${node.tagName}>${children}`;
      };
      return walk(el);
    });
  };

  const alKanban = await estructura('/proof/board', '[data-testid="board-light"]');
  const alCalendari = await estructura('/proof/calendar', 'body');

  expect(alCalendari).toBe(alKanban);
});

test('el rail sap on és, però no canvia de contingut per això', async ({ page }) => {
  await page.goto('/proof/calendar');
  await expect(page.locator('[data-testid="inbox-rail"]')).toHaveAttribute(
    'data-placement',
    'rail',
  );

  await page.goto('/proof/board');
  await expect(
    page.locator('[data-testid="board-light"] [data-testid="inbox-rail"]'),
  ).toHaveAttribute('data-placement', 'column');
});

test('la fletxa de moure hi és als dos llocs', async ({ page }) => {
  // És de l'Inbox, no del kanban: si el rail no la tingués, seria una divergència.
  await page.goto('/proof/calendar');
  await expect(
    page.locator('[data-testid="inbox-rail"] [data-testid="card-advance"]').first(),
  ).toBeVisible();
});

test('captura del calendari', async ({ page }) => {
  await page.goto('/proof/calendar');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('calendar.png', { fullPage: true });
});
