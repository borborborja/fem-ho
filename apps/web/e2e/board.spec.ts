/**
 * Prova visual del port del tauler (M5).
 *
 * El pla afegeix aquesta comprovació a cada fita d'UI: captura de la pantalla
 * implementada al costat de la del prototip, als dos temes. És el que impedeix que
 * "portat" acabi volent dir "reescrit d'esma".
 */

import { expect, test } from '@playwright/test';

test('el tauler pinta les quatre columnes als dos temes', async ({ page }) => {
  await page.goto('/proof/board');

  for (const theme of ['light', 'dark'] as const) {
    const surface = page.locator(`[data-testid="board-${theme}"]`);
    for (const status of ['inbox', 'todo', 'doing', 'done'] as const) {
      await expect(surface.locator(`[data-column-status="${status}"]`)).toBeVisible();
    }
  }
});

test("l'Inbox es distingeix de les altres tres", async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  const inbox = surface.locator('[data-column-status="inbox"]');
  const todo = surface.locator('[data-column-status="todo"]');

  const fons = async (loc: typeof inbox) =>
    loc.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.backgroundImage}|${s.backgroundColor}`;
    });

  // Brief línia 39: visualment ha de ser diferent l'Inbox de les tres llistes kanban.
  expect(await fons(inbox)).not.toBe(await fons(todo));
});

test("les tres columnes van dins d'una sola targeta", async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  // La segona meitat del que demana el brief: que les tres "es sentin un sol element".
  // El prototip ho fa envoltant-les d'una targeta; l'Inbox en queda fora.
  // Cada columna va dins d'un embolcall de destí d'arrossegament; la targeta
  // compartida és el nivell de sobre. Es compara l'ancestre que té fons propi.
  const contenidor = async (status: string) =>
    surface.locator(`[data-column-status="${status}"]`).evaluate((el) => {
      let node = el.parentElement;
      // check-ignore no-hardcoded-colors: no és un color de disseny, és el valor que
      // retorna el navegador quan un element no té fons.
      while (node !== null && getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)') {
        node = node.parentElement;
      }
      return node?.getAttribute('data-testid') ?? node?.tagName ?? 'cap';
    });

  const [perFer, fent, fet] = await Promise.all([
    contenidor('todo'),
    contenidor('doing'),
    contenidor('done'),
  ]);

  // Les tres comparteixen contenidor: "es senten un sol element" (brief línia 39).
  expect(perFer).toBe(fent);
  expect(fent).toBe(fet);
  // I l'Inbox en queda fora.
  expect(await contenidor('inbox')).not.toBe(perFer);
});

test("les accions ràpides són només a l'Inbox", async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  // docs/02 §4: "Accions ràpides: només a les targetes de l'Inbox".
  await expect(
    surface
      .locator('[data-column-status="inbox"]')
      .getByRole('button', { name: '→ Per fer' })
      .first(),
  ).toBeVisible();

  await expect(
    surface.locator('[data-column-status="todo"]').getByRole('button', { name: '→ Per fer' }),
  ).toHaveCount(0);
});

test('captura del tauler als dos temes', async ({ page }) => {
  await page.goto('/proof/board');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('board.png', { fullPage: true });
});

test('arrossegar entre columnes persisteix', async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  const card = surface.locator('[data-testid="task-1"]');
  const target = surface.locator('[data-column-status="doing"]');

  await expect(
    surface.locator('[data-column-status="inbox"] [data-testid="task-1"]'),
  ).toBeVisible();

  // Arrossegament amb ratolí en tres passos: dnd-kit necessita moviment intermedi per
  // superar la restricció d'activació de 6px que evita que un clic compti com a drag.
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('no es poden mesurar els elements');

  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 40, from.y + 40, { steps: 10 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(
    surface.locator('[data-column-status="doing"] [data-testid="task-1"]'),
  ).toBeVisible();
  await expect(surface.locator('[data-column-status="inbox"] [data-testid="task-1"]')).toHaveCount(
    0,
  );
});

test('AQUESTA és la de docs/13: moure amb teclat també', async ({ page }) => {
  // "Un tauler que només funciona amb ratolí no és accessible" (docs/02 §4).
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  // El focus va a l'element ARROSSEGABLE, que és el que porta els listeners i el
  // tabIndex del sensor de teclat.
  await surface.locator('[data-testid="task-3"]').focus();

  // dnd-kit anuncia cada pas a una regió aria-live. Esperar l'anunci en comptes de
  // prémer les tecles seguides no és cosmètic: sense això la prova corre contra el
  // sensor i falla quan la màquina va carregada, que és exactament el que passava
  // amb la suite sencera i no amb el fitxer sol.
  //
  // Hi ha una regió per tauler (clar i fosc), d'aquí el `.first()`. I no s'espera
  // "agafada": dnd-kit la substitueix a l'instant per l'anunci de la columna on ja és.
  const announcements = page.locator('[role="status"]').first();

  await page.keyboard.press('Space'); // agafa
  await expect(announcements).toContainText('Renovar el carnet');

  await page.keyboard.press('ArrowRight'); // salta a la columna següent
  await expect(announcements).toContainText('Per fer');

  await page.keyboard.press('Space'); // deixa anar

  await expect(surface.locator('[data-column-status="inbox"] [data-testid="task-3"]')).toHaveCount(
    0,
  );
});

test('Escape cancel·la el moviment amb teclat', async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  await surface.locator('[data-testid="task-2"]').focus();
  const announcements = page.locator('[role="status"]').first();

  await page.keyboard.press('Space');
  await expect(announcements).toContainText('Enviar proposta');
  await page.keyboard.press('ArrowRight');
  await expect(announcements).toContainText('Per fer');
  await page.keyboard.press('Escape');

  // Segueix on era: cancel·lar no mou res.
  await expect(
    surface.locator('[data-column-status="inbox"] [data-testid="task-2"]'),
  ).toBeVisible();
});

/**
 * El filtre de "tasques d'altres", del disseny validat.
 *
 * Fora de la bústia, el tauler és el que has de fer **tu**: les d'algú altre queden
 * darrere del commutador de l'epígraf. La bústia no en té, perquè és on es reparteix.
 */
test("les tasques d'altres s'amaguen darrere el commutador de l'epígraf", async ({ page }) => {
  await page.goto('/proof/board');

  // La pàgina en pinta dos, un per tema: es mira el clar.
  const board = page.locator('[data-testid="board-light"]');
  const column = board.locator('[data-column-status="todo"]');
  await expect(column).not.toContainText('Portar el cotxe al taller');

  await board.locator('[data-testid="others-todo:familia"]').click();
  await expect(column).toContainText('Portar el cotxe al taller');

  // I tornant-lo a prémer, desapareix un altre cop.
  await board.locator('[data-testid="others-todo:familia"]').click();
  await expect(column).not.toContainText('Portar el cotxe al taller');
});

test("l'Inbox no en té: allà s'ha de veure tot", async ({ page }) => {
  await page.goto('/proof/board');

  await expect(page.locator('[data-testid^="others-inbox:"]')).toHaveCount(0);
});
