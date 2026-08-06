/**
 * El multiidioma, contra el servidor real.
 *
 * La resta de la suite corre amb `locale: 'ca-ES'` fixat a `playwright.config.ts`, que
 * és el que fa que les seves assercions de text català segueixin valent. **Aquí és
 * l'única que el mou**, perquè és l'única que el comprova.
 *
 * Tres coses decideixen si "automàtic amb opció de canviar" és cert:
 * que el navegador mani abans d'entrar, que el perfil mani després, i que la tria
 * sobrevisqui a una recàrrega. Si qualsevol de les tres falla, l'idioma és decoració.
 */

import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

async function enter(page: Page): Promise<void> {
  const gate = await page.request.get('/api/v1/setup');
  const open = ((await gate.json()) as { open: boolean }).open;

  await page.goto('/');
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  if (open) {
    await page.goto('/setup');
    await page.locator('[data-testid="setup-name"]').fill(ADMIN.name);
    await page.locator('[data-testid="setup-email"]').fill(ADMIN.email);
    await page.locator('[data-testid="setup-password"]').fill(ADMIN.password);
    await page.locator('[data-testid="setup-submit"]').click();
    await expect(page.locator('[data-testid="login"]')).toBeVisible({ timeout: 15_000 });
  }

  await page.locator('[data-testid="login-email"]').fill(ADMIN.email);
  await page.locator('[data-testid="login-password"]').fill(ADMIN.password);
  await page.locator('[data-testid="login-submit"]').click();
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
}

/**
 * **Abans d'entrar, mana el navegador.**
 *
 * La pantalla d'entrada la veu gent que encara no té perfil: si sortís sempre en català,
 * "automàtic" no voldria dir res per a la primera impressió del producte, que és
 * justament on importa.
 */
test.describe("abans d'entrar, mana el navegador", () => {
  test.use({ locale: 'en-GB' });

  test('amb el navegador en anglès, la pantalla surt en anglès', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="login-submit"]')).toHaveText('Sign in');
    // L'`lang` de l'`<html>` no és decoració: és el que fa que un lector de pantalla
    // llegeixi amb la pronúncia bona.
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('i en castellà, en castellà', () => {
  test.use({ locale: 'es-ES' });

  test("l'etiqueta d'entrar surt en castellà", async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="login-submit"]')).toHaveText('Entrar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });
});

/**
 * **Un cop hi ha sessió, mana el perfil.**
 *
 * És el que fa que canviar l'idioma al portàtil també el canviï al telèfon, i el que
 * permet que el servidor sàpiga en quin idioma enviar una notificació.
 */
test('canviar-lo a Ajustos ho canvia a l\'acte i sobreviu a una recàrrega', async ({ page }) => {
  await enter(page);

  await page.goto('/settings');
  await expect(page.locator('[data-testid="settings-tab-general"]')).toBeVisible();

  await page.locator('[data-testid="language-chips-en"]').click();
  // A l'acte, sense recarregar: és la pantalla on l'estàs triant.
  await expect(page.locator('[data-testid="settings-tab-general"]')).toHaveText('General');
  await expect(page.locator('[data-testid="settings-tab-scopes"]')).toHaveText('Scopes');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(page.locator('[data-testid="settings-tab-scopes"]')).toHaveText('Scopes');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('i el perfil mana per damunt del navegador', async ({ page }) => {
  // El navegador d'aquesta prova és català —el de la resta de la suite— i el perfil ha
  // quedat en anglès de la prova anterior. Ha de guanyar el perfil.
  await enter(page);
  await expect(page.locator('[data-testid="view-tasks"]')).toHaveText('Tasks');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('i es pot tornar al català', async ({ page }) => {
  await enter(page);
  await page.goto('/settings');
  await page.locator('[data-testid="language-chips-ca"]').click();
  await expect(page.locator('[data-testid="settings-tab-scopes"]')).toHaveText('Àmbits');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ca');
});

/**
 * Un idioma que no tenim no ha de deixar l'app a mitges.
 *
 * `negotiate` cau al català: val més una llengua que la persona potser no té que una
 * pantalla amb les claus escrites a la cara.
 */
test.describe('un idioma que no tenim', () => {
  test.use({ locale: 'de-DE' });

  test('cau al català i no deixa cap clau crua', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-testid="login-submit"]')).toHaveText('Entrar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ca');
    // Cap clau del catàleg escrita a la pantalla: seria el símptoma d'una reserva trencada.
    await expect(page.locator('body')).not.toContainText('login.submit');
  });
});

/**
 * El calendari, per idioma.
 *
 * En anglès la setmana comença en diumenge i l'hora es veu de 12 h; en català i en
 * castellà, dilluns i 24 h. Fins ara dilluns era **una constant en tres llocs** i
 * l'hora un tall de cadena: dues coses que no es podien adaptar a res.
 */
test.describe('el calendari segueix l\'idioma', () => {
  test.use({ locale: 'en-GB' });

  test('en anglès, la setmana comença en diumenge', async ({ page }) => {
    await enter(page);
    await page.goto('/settings');
    await page.locator('[data-testid="language-chips-en"]').click();
    await page.goto('/calendar');

    const headers = page.locator('[data-testid="calendar-month"] > div:nth-child(2) > div');
    await expect(headers.first()).toHaveText('sun');
    // I els mesos surten de CLDR, no de dotze noms separats per comes al catàleg.
    await expect(page.locator('[data-testid="calendar-month"]')).toContainText(/[A-Z][a-z]+ 20\d\d/u);
  });
});

test('i la tria manual mana per damunt de l\'idioma', async ({ page }) => {
  await enter(page);
  await page.goto('/settings');

  // Segueix en anglès de la prova anterior: diumenge per idioma.
  await page.goto('/calendar');
  await expect(
    page.locator('[data-testid="calendar-month"] > div:nth-child(2) > div').first(),
  ).toHaveText('sun');

  /**
   * El primer dia de la setmana **no és només una convenció lingüística**: qui treballa
   * el cap de setmana el vol d'una manera i qui no, d'una altra, amb la mateixa llengua.
   */
  await page.goto('/settings');
  await page.locator('[data-testid="week-start-monday"]').click();
  await page.goto('/calendar');
  await expect(
    page.locator('[data-testid="calendar-month"] > div:nth-child(2) > div').first(),
  ).toHaveText('mon');

  // I sobreviu a una recàrrega: és una preferència, no un estat de pantalla.
  await page.reload();
  await expect(
    page.locator('[data-testid="calendar-month"] > div:nth-child(2) > div').first(),
  ).toHaveText('mon');

  // Es deixa com estava per no condicionar les proves que vinguin després.
  await page.goto('/settings');
  await page.locator('[data-testid="week-start-auto"]').click();
  await page.locator('[data-testid="language-chips-ca"]').click();
});

/**
 * Els errors del servidor, en l'idioma de qui mira.
 *
 * El servidor ja no escriu català: envia `type` i `params`, i el `detail` en anglès per
 * a les màquines —clients CalDAV, agents d'MCP, qui programi contra l'API—. El text el
 * posa el catàleg de cada app.
 *
 * **I si no en té la clau, ensenya el `detail`.** És el que fa que un error nou del
 * servidor no deixi mai una pantalla muda ni obligui a desplegar les dues bandes alhora.
 */
test('un error del servidor es veu traduït, no en anglès', async ({ page }) => {
  await enter(page);

  // Un àmbit que no existeix: el servidor respon `not-found` amb el tipus i les dades.
  const problem = await page.evaluate(async () => {
    const stored = localStorage.getItem('femho.tokens');
    const token = stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
    const response = await fetch('/api/v1/tasks/no-existeixo', {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  });

  expect(problem.status).toBe(404);
  // El `detail` ve en anglès i porta les dades a part.
  expect(problem.body.detail).toMatch(/^There is no task/u);
  expect(problem.body.params).toMatchObject({ entityType: 'task', id: 'no-existeixo' });

  // El text no és enlloc de la resposta: el posa el client. Qui el compon és
  // `problemText`, i el prova `apps/web/src/app/api.test.ts` als tres idiomes.
  expect(JSON.stringify(problem.body)).not.toContain('Això ja no hi és');
});
