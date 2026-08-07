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

/**
 * La barra de la dreta de la targeta, del disseny validat.
 *
 * **A la bústia i a "Per fer" és una fletxa** que la mou una columna endavant; a "Fent"
 * i a "Fet" és la casella d'estat. Substitueix els dos botons "→ Per fer" i "→ Fent"
 * que hi havia sota el títol i el cercle que hi havia a dalt a l'esquerra: un sol lloc
 * per a un sol gest, fer avançar la targeta.
 */
test('la barra de la dreta és fletxa fins a Fent, i allà casella', async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  for (const status of ['inbox', 'todo']) {
    const column = surface.locator(`[data-column-status="${status}"]`);
    await expect(column.locator('[data-testid="card-advance"]').first()).toBeVisible();
    await expect(column.locator('[data-testid="card-toggle-done"]')).toHaveCount(0);
  }

  for (const status of ['doing', 'done']) {
    const column = surface.locator(`[data-column-status="${status}"]`);
    await expect(column.locator('[data-testid="card-toggle-done"]').first()).toBeVisible();
    await expect(column.locator('[data-testid="card-advance"]')).toHaveCount(0);
  }
});

test('la fletxa mou la targeta una columna endavant', async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');
  const todo = surface.locator('[data-column-status="todo"]');

  await expect(todo).toContainText('Revisar el pressupost');
  await todo
    .locator('[data-testid^="task-"]')
    .filter({ hasText: 'Revisar el pressupost' })
    .locator('[data-testid="card-advance"]')
    .click();

  await expect(surface.locator('[data-column-status="doing"]')).toContainText(
    'Revisar el pressupost',
  );
  await expect(todo).not.toContainText('Revisar el pressupost');
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
  // dnd-kit no considera que s'arrossegui fins que el cursor ha fet 6px, i sota càrrega
  // el navegador pot ajuntar els moviments intermedis. Amb la pausa, el sensor rep el
  // primer desplaçament sempre; sense, la prova falla una vegada de cada moltes.
  await page.waitForTimeout(50);
  await page.mouse.move(from.x + from.width / 2 + 40, from.y + 40, { steps: 10 });
  await page.waitForTimeout(50);
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

/**
 * El tauler al mòbil. docs/02 §10.
 *
 * "Per sota de 860px la web ha de ser **gairebé idèntica a l'app**: el kanban passa a
 * columnes desplaçables horitzontalment, cadascuna al 80% de l'amplada, amb
 * desplaçament amb ajust."
 *
 * Sense això, la graella de dues columnes de l'escriptori hi entrava a la força: la
 * bústia quedava d'un dit d'ample i les altres tres, fora de pantalla i sense manera
 * d'arribar-hi. La prova mira les tres coses que ho fan navegable —la tira, l'amplada i
 * l'ajust— i que **la pàgina no es desplaci de costat**, que és el símptoma.
 */
test('per sota de 860px, les columnes es desplacen amb ajust', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
  await page.goto('/proof/board');

  const kanban = page.locator('[data-testid="board-light"] [data-testid="kanban"]');
  await expect(kanban).toHaveAttribute('data-layout', 'scroll');

  const mides = await kanban.evaluate((node) => ({
    ample: node.getBoundingClientRect().width,
    desplaçable: node.scrollWidth,
    primera: node.children[0]!.getBoundingClientRect().width,
    ajust: getComputedStyle(node).scrollSnapType,
  }));

  // Les quatre columnes no hi caben: per això es desplaça.
  expect(mides.desplaçable).toBeGreaterThan(mides.ample);
  // Al voltant del 78%: la següent s'endevina i convida a lliscar-hi.
  expect(mides.primera / mides.ample).toBeGreaterThan(0.7);
  expect(mides.primera / mides.ample).toBeLessThan(0.85);
  expect(mides.ajust).toContain('x');
});

test("i a l'escriptori torna a ser la graella de sempre", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/proof/board');

  await expect(page.locator('[data-testid="board-light"] [data-testid="kanban"]')).toHaveAttribute(
    'data-layout',
    'grid',
  );
});

/**
 * **La targeta arrossegada s'ha de veure fora de la seva columna.**
 *
 * Es movia l'element original amb un `transform`, i per tant continuava vivint dins de
 * la columna: amb el desplaçament propi de la columna i l'`overflow:hidden` de la
 * targeta que agrupa les tres, treure-la del seu lloc volia dir treure-la del rectangle
 * visible i **desapareixia a mig gest**.
 *
 * Aquí es comprova el que ho impedeix: que mentre s'arrossega hi ha una targeta que
 * segueix el cursor, que **penja de `<body>` i no del tauler** —que és l'única manera
 * que cap avantpassat la retalli— i que es veu quan el cursor ja és a l'altra punta.
 */
test('arrossegar no amaga la targeta en sortir de la columna', async ({ page }) => {
  await page.goto('/proof/board');
  const surface = page.locator('[data-testid="board-light"]');

  const card = surface.locator('[data-testid="task-1"]');
  const target = surface.locator('[data-column-status="done"]');
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('no es poden mesurar els elements');

  await page.mouse.move(from.x + from.width / 2, from.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.move(from.x + from.width / 2 + 40, from.y + 40, { steps: 5 });
  await page.waitForTimeout(50);
  // Fins a l'última columna: el camí travessa totes les vores que abans la retallaven.
  await page.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });

  const overlay = page.locator('[data-testid="drag-overlay"]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('Trucar al fontaner');

  // Penja de <body> i no del tauler: si fos a dins, tornaria a quedar retallada.
  expect(await overlay.evaluate((node) => node.closest('[data-testid="kanban"]') === null)).toBe(
    true,
  );

  // I és on és el cursor, no on era la targeta.
  const box = await overlay.boundingBox();
  if (box === null) throw new Error("l'overlay no es pot mesurar");
  expect(box.x + box.width / 2).toBeGreaterThan(to.x);

  // L'original es queda al seu lloc, atenuat (docs/02 §4).
  await expect(
    surface.locator('[data-column-status="inbox"] [data-testid="task-1"]'),
  ).toBeVisible();

  await page.mouse.up();
  await expect(surface.locator('[data-column-status="done"] [data-testid="task-1"]')).toBeVisible();
});
