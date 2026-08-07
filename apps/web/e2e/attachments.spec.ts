/**
 * Els adjunts, al navegador de debò.
 *
 * Va contra el servidor real perquè el que es vol comprovar és precisament el que una
 * prova amb dades fixes no veuria: que el fitxer **puja tal qual** —cos cru, sense
 * `FormData`— i que en tornar a baixar-lo surt amb `Content-Disposition: attachment` i
 * `nosniff`, que és el que separa un adjunt d'un XSS emmagatzemat.
 */

import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

async function enter(page: import('@playwright/test').Page): Promise<void> {
  const gate = await page.request.get('/api/v1/setup');
  const open = ((await gate.json()) as { open: boolean }).open;

  await page.goto('/');
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  /**
   * **La instància la crea qui hi arribi primer, i aquí es tolera perdre.**
   *
   * La suite va `fullyParallel`: amb la base buida, aquest fitxer i `app.spec` veuen
   * tots dos la porta oberta i tots dos van a `/setup`. El segon rep un 403 i es queda
   * a la pantalla d'arrencada, o sigui que exigir la de login just després fallava una
   * execució de cada dues. El que importa no és qui l'ha creat: és que hi hagi login.
   */
  if (open) {
    await page.goto('/setup');
    await page.locator('[data-testid="setup-name"]').fill(ADMIN.name);
    await page.locator('[data-testid="setup-email"]').fill(ADMIN.email);
    await page.locator('[data-testid="setup-password"]').fill(ADMIN.password);
    await page.locator('[data-testid="setup-submit"]').click();
  }

  await expect
    .poll(async () => page.locator('[data-testid="login-email"]').count(), { timeout: 20_000 })
    .toBeGreaterThan(0)
    .catch(async () => {
      await page.goto('/');
    });

  await page.locator('[data-testid="login-email"]').fill(ADMIN.email);
  await page.locator('[data-testid="login-password"]').fill(ADMIN.password);
  await page.locator('[data-testid="login-submit"]').click();
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible();
}

/** El token de la sessió, per a les crides directes a l'API. */
async function token(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('femho.tokens') ?? '{}') as { access_token?: string })
        .access_token ?? '',
  );
}

/**
 * Crea la tasca **per l'API** i obre el tauler filtrat al seu àmbit.
 *
 * Dues coses apreses de fer-ho malament. Amb l'afegida ràpida, les tasques queien a la
 * safata compartida amb la resta de la suite, que va `fullyParallel` contra un sol
 * servidor. I creant un àmbit propi per aïllar-se, `app.spec` —que compta que n'hi hagi
 * exactament tres al resum— passava a veure'n quatre: **l'aïllament no pot consistir a
 * afegir res que altri compti**. Es reutilitza el que ja hi ha i es filtra la vista.
 */
async function openTask(page: import('@playwright/test').Page, title: string): Promise<void> {
  const bearer = { authorization: `Bearer ${await token(page)}` };

  const scopes = await page.request.get('/api/v1/scopes', { headers: bearer });
  const scopeId = ((await scopes.json()) as { id: string }[])[0]?.id ?? '';

  await page.request.post('/api/v1/tasks', {
    headers: bearer,
    data: { scope_id: scopeId, title },
  });

  await page.goto(`/board?scopes=${scopeId}`);
  await expect(page.locator('[data-testid="inbox-rail"]')).toContainText(title, {
    timeout: 10_000,
  });
  await page.locator('[data-testid="inbox-rail"]').getByText(title).first().click();
  await expect(page.locator('[data-testid="task-modal"]')).toBeVisible();
}

test('un fitxer es puja i apareix a la tasca amb la seva mida', async ({ page }) => {
  await enter(page);
  await openTask(page, 'Amb factura');

  const seccio = page.locator('[data-testid="task-attachments"]');
  await expect(seccio).toBeVisible();

  await seccio.locator('[data-testid="attachment-input"]').setInputFiles({
    name: 'factura.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 la factura del lampista', 'utf8'),
  });

  await expect(seccio.getByText('factura.pdf')).toBeVisible({ timeout: 10_000 });
  // La mida es veu en unitats humanes, no en bytes crus.
  await expect(seccio).toContainText('B');
});

test('i en baixar-lo, el servidor el marca com a descàrrega i prohibeix endevinar-ne el tipus', async ({
  page,
}) => {
  await enter(page);
  await openTask(page, 'Per baixar');

  const seccio = page.locator('[data-testid="task-attachments"]');
  await seccio.locator('[data-testid="attachment-input"]').setInputFiles({
    // Es diu `.html` i el contingut ho sembla: el cas que porta a XSS emmagatzemat si el
    // servidor es refia de l'extensió.
    name: 'maliciós.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<script>alert(1)</script>', 'utf8'),
  });

  const enllac = seccio.getByText('maliciós.html');
  await expect(enllac).toBeVisible({ timeout: 10_000 });

  /**
   * **Es demana amb la sessió posada**, com fa l'app: el token viu a `localStorage` i va
   * a `Authorization`. Aquesta prova va descobrir que un `<a href>` pelat rebia un 401 i
   * el fitxer no baixava mai — el component ara l'agafa per `fetch` i en fa un `blob:`.
   */
  const bearer = { authorization: `Bearer ${await token(page)}` };
  const id = (
    await seccio.locator('[data-testid^="attachment-"]').first().getAttribute('data-testid')
  )?.replace('attachment-', '');
  const res = await page.request.get(`/api/v1/attachments/${id ?? ''}/content`, {
    headers: bearer,
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('attachment');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
  // **Mai `text/html`**, encara que el fitxer ho sembli i el client ho hagi declarat.
  expect(res.headers()['content-type']).toContain('text/plain');
});

test('es pot treure, i llavors ja no hi és', async ({ page }) => {
  await enter(page);
  await openTask(page, 'Per treure');

  const seccio = page.locator('[data-testid="task-attachments"]');
  await seccio.locator('[data-testid="attachment-input"]').setInputFiles({
    name: 'temporal.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('res important', 'utf8'),
  });
  await expect(seccio.getByText('temporal.txt')).toBeVisible({ timeout: 10_000 });

  await seccio.locator('button[aria-label]').first().click();
  await expect(seccio.getByText('temporal.txt')).toHaveCount(0, { timeout: 10_000 });
});
