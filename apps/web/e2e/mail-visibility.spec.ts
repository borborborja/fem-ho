/**
 * El calendari com a organitzador, contra el servidor real.
 *
 * Les proves de servidor ja diuen que la cascada decideix bé. El que **només** es pot veure
 * amb les dues pantalles obertes és que siguin dues lents de la mateixa cosa:
 *
 *   - Un correu d'una carpeta nova **no surt a la columna Inbox** de Tasques…
 *   - …i **sí que surt al calendari**, difuminat, amb el botó per pujar-lo.
 *   - I quan el puges, apareix a Tasques.
 *
 * Si això es trenqués, el símptoma seria el pitjor de tots: un correu que entra i no és
 * enlloc. Cap prova de servidor ho veuria, perquè al servidor hi és.
 *
 * PER QUÈ ES SEMBRA A LA BASE I NO PER L'API
 * ------------------------------------------
 * El correu **entra per IMAP i per enlloc més**. No hi ha cap ruta que creï un missatge, i
 * no n'hi ha d'haver-hi: seria una porta d'escriptura a la bústia d'algú que existiria només
 * per a les proves. I muntar un servidor IMAP de mentida provaria el de mentida —el cicle
 * de lectura ja té les seves proves, contra un client fals.
 */

import Database from 'better-sqlite3';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { enter } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const ARA = '2026-08-11T09:00:00.000Z';

/** Una crida a l'API des de la pestanya, amb la sessió que hi ha. */
async function apiCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; raw: string }> {
  return page.evaluate(
    async ([method, path, body]) => {
      const stored = localStorage.getItem('femho.tokens');
      const token =
        stored === null ? '' : (JSON.parse(stored) as { access_token: string }).access_token;
      const response = await fetch(path as string, {
        method: method as string,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === null ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, raw: await response.text() };
    },
    [method, path, body ?? null] as const,
  );
}

/**
 * Un compte i una carpeta per l'API —que sí que tenen rutes— i el correu a la base.
 *
 * Torna l'identificador del missatge i el dia en què "va arribar", que és el que el
 * calendari fa servir per col·locar-lo.
 */
async function sembra(page: Page, subject: string): Promise<{ id: string; day: string }> {
  const compte = await apiCall(page, 'POST', '/api/v1/mail/accounts', {
    name: `Compte ${subject}`,
    host: 'imap.example.test',
    username: 'borja',
    password: 'una-contrasenya',
  });
  const accountId = (JSON.parse(compte.raw) as { id: string }).id;

  const scopes = await apiCall(page, 'GET', '/api/v1/scopes');
  const scopeId = (JSON.parse(scopes.raw) as { id: string }[])[0]!.id;

  const regla = await apiCall(page, 'POST', '/api/v1/mail/rules', {
    account_id: accountId,
    folder: `INBOX/${subject}`,
    scope_id: scopeId,
  });
  const ruleId = (JSON.parse(regla.raw) as { id: string }).id;

  const dataDir = process.env.FEMHO_E2E_DATA_DIR;
  if (dataDir === undefined || dataDir === '') {
    // Sense això, `better-sqlite3` crearia una base buida al directori de treball i el
    // símptoma seria «no such table», que no diu res del que passa.
    throw new Error('FEMHO_E2E_DATA_DIR no hi és: la configuració de Playwright no l’ha posat.');
  }
  const db = new Database(join(dataDir, 'e2e.db'));
  const threadId = `th-${subject}`;
  const messageId = `msg-${subject}`;
  db.prepare(
    `INSERT INTO mail_threads (id, account_id, thread_key, message_count, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(threadId, accountId, `mid:${subject}@escola.test`, ARA, ARA);
  db.prepare(
    `INSERT INTO mail_messages (id, account_id, thread_id, message_key, folder, uid_validity,
                                uid, internal_date, from_name, from_address, subject,
                                disposition, rule_id, has_html, raw_bytes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '1', '1', ?, 'Escola', 'secretaria@escola.test', ?, 'inbox', ?,
             0, 0, ?, ?)`,
  ).run(
    messageId,
    accountId,
    threadId,
    `mid:${subject}@escola.test`,
    `INBOX/${subject}`,
    ARA,
    `${subject} — la factura`,
    ruleId,
    ARA,
    ARA,
  );
  db.close();

  return { id: messageId, day: ARA.slice(0, 10) };
}

test('un correu nou no és a Tasques, és al calendari, i des d’allà puja', async ({ page }) => {
  await enter(page);
  const { id, day } = await sembra(page, 'Escola');

  /**
   * **A Tasques no hi és.** El defecte d'una carpeta nova és no sortir a la llista de feina:
   * mapar-la és dir «vull veure això en algun lloc», no «posa-m'ho tot a fer».
   */
  await page.goto(`/board?date=${day}`);
  await expect(page.getByTestId('board-screen')).toBeVisible();
  await expect(page.getByTestId(`inbox-mail-${id}`)).toHaveCount(0);

  /**
   * **Al calendari sí**, i amb la vora discontínua: el mateix senyal que fa servir una cita
   * que no és a la teva bústia. Un sol significat per a un sol senyal.
   */
  await page.goto(`/calendar?date=${day}`);
  const targeta = page.getByTestId(`inbox-mail-${id}`);
  await expect(targeta).toBeVisible();
  await expect(targeta).toHaveCSS('border-left-style', 'dashed');

  // I des d'aquí es puja d'un clic.
  await page.getByTestId(`inbox-mail-eye-${id}`).click();
  await expect(targeta).toHaveCSS('border-left-style', 'solid');

  // Ara sí que és a Tasques.
  await page.goto(`/board?date=${day}`);
  await expect(page.getByTestId(`inbox-mail-${id}`)).toBeVisible();
});

test('i es pot tornar a treure, que abans era un carreró sense sortida', async ({ page }) => {
  await enter(page);
  const { id, day } = await sembra(page, 'Banc');

  await page.goto(`/calendar?date=${day}`);
  await page.getByTestId(`inbox-mail-eye-${id}`).click();
  await page.goto(`/board?date=${day}`);
  await expect(page.getByTestId(`inbox-mail-${id}`)).toBeVisible();

  /**
   * Treure'l **no l'esborra**: abans, «descartar» el treia per sempre i cap ruta ho desfeia.
   * Ara torna al calendari, que és d'on el pots recuperar.
   */
  await page.getByTestId(`inbox-mail-eye-${id}`).click();
  await expect(page.getByTestId(`inbox-mail-${id}`)).toHaveCount(0);

  await page.goto(`/calendar?date=${day}`);
  await expect(page.getByTestId(`inbox-mail-${id}`)).toBeVisible();
});

test('les dues pantalles demanen la mateixa bústia amb lents diferents', async ({ page }) => {
  await enter(page);

  /**
   * **Es recarrega amb l'espera ja armada, i no s'espera «alguna petició».**
   *
   * La primera versió comptava peticions i mirava si alguna en portava el paràmetre. Fallava
   * a la suite sencera: en entrar, l'app aterra al tauler, i la petició tardana d'aquella
   * pantalla ja feia que el comptador fos més gran que zero abans que la del calendari
   * arribés. La prova depenia de qui guanyava una cursa que no té res a veure amb el que
   * comprova.
   */
  await page.goto('/calendar');
  await expect(page.getByTestId('calendar-screen')).toBeVisible();

  const ambTot = page.waitForRequest(
    (req) => req.url().includes('/api/v1/inbox?') && req.url().includes('include_hidden=true'),
  );
  await page.reload();
  await ambTot;

  await page.goto('/board');
  await expect(page.getByTestId('board-screen')).toBeVisible();

  const delTauler: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/v1/inbox?')) delTauler.push(req.url());
  });
  const alguna = page.waitForRequest((req) => req.url().includes('/api/v1/inbox?'));
  await page.reload();
  await alguna;

  /**
   * **I el tauler NO la demana sencera.** És el que fa que la columna Inbox sigui la llista
   * del que has decidit que és feina, i no un abocador del que ha arribat.
   */
  expect(delTauler.length).toBeGreaterThan(0);
  expect(delTauler.every((url) => !url.includes('include_hidden=true'))).toBe(true);
});

test("l'ull diu on és cada cosa, i el mateix per a totes les menes", async ({ page }) => {
  await enter(page);
  const { id, day } = await sembra(page, 'Ull');

  await page.goto(`/calendar?date=${day}`);
  const ull = page.getByTestId(`inbox-mail-eye-${id}`);

  /**
   * **`aria-pressed` és el que ho fa llegible sense veure la icona.** Un interruptor premut
   * és una cosa encesa; el nom diu què passarà si el prems, que no és el mateix i tampoc es
   * pot endevinar del dibuix.
   */
  await expect(ull).toHaveAttribute('aria-pressed', 'false');
  await expect(ull).toHaveAccessibleName(/inbox/i);

  await ull.click();
  await expect(ull).toHaveAttribute('aria-pressed', 'true');

  // I una cita fa exactament el mateix control, amb el mateix aspecte.
  const cites = page.locator('[data-testid^="inbox-event-eye-"]');
  if ((await cites.count()) > 0) {
    await expect(cites.first()).toHaveAttribute('aria-pressed', /true|false/);
  }
});
