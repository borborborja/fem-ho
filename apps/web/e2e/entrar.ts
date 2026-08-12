/**
 * Entrar a l'app, una sola vegada i per a tothom.
 *
 * **Aquest fitxer existeix perquè n'hi havia vuit còpies.** Cada `*.spec.ts` es duia el
 * seu `enter()` retallat i enganxat, i totes tenien el mateix parany: la suite va
 * `fullyParallel` contra un sol servidor, la base comença buida, i **tots els fitxers
 * veuen la porta d'arrencada oberta alhora**. El primer que hi arriba crea la instància;
 * la resta reben un 403 i es queden a `/setup` per sempre —allà el camp de login no hi
 * apareixerà mai—, i esperar-lo era esperar el temps màxim sencer i caure.
 *
 * Amb `mode: 'serial'` a cada fitxer, una caiguda així no s'endú una prova: s'endú les que
 * venen darrere. Es veia com un fitxer que falla per torns, sense relació amb el que toca,
 * i cada fitxer nou feia més probable el xoc.
 *
 * El que fa la versió bona: **no exigeix guanyar la cursa**. Torna a mirar la portada fins
 * que hi hagi login, hi entri qui l'hagi creat.
 */

import { expect, type Page } from '@playwright/test';

export interface Compte {
  name: string;
  email: string;
  password: string;
}

export const ADMIN: Compte = {
  name: 'Borja',
  email: 'borja@example.com',
  password: 'la-contrasenya-de-prova',
};

/**
 * `who` és per a les proves amb **dos comptes**, com la de compartir un àmbit.
 *
 * Només l'administrador fa l'arrencada: la resta ja tenen compte quan hi arriben, i
 * intentar-la els portaria a un 403 i a una pantalla que no és la seva.
 */
export async function enter(page: Page, who: Compte = ADMIN): Promise<void> {
  /**
   * **Es pregunta al servidor si la porta és oberta**, no es dedueix del que es veu.
   *
   * Mirar si hi ha formulari de login no serveix: amb la base buida també n'hi ha, i
   * llavors s'intentava entrar amb un compte que encara no existeix.
   */
  const gate = await page.request.get('/api/v1/setup');
  const open = ((await gate.json()) as { open: boolean }).open;

  await page.goto('/');
  if ((await page.locator('[data-testid="topbar"]').count()) > 0) return;

  /**
   * **L'arrencada va per l'API, amb l'idioma escrit.**
   *
   * El formulari envia `navigator.language`, o sigui que el compte compartit de la suite
   * es creava **en l'idioma de qui guanyés la cursa** — i `i18n.spec` corre amb
   * `locale: 'en-GB'`. Quan hi arribava primer, tota la resta de la suite es trobava l'app
   * en anglès i les proves que busquen text català fallaven amb un missatge que no hi
   * apunta gens: "no trobo el botó «Per fer»".
   *
   * Amb l'idioma explícit, el compte és el mateix el guanyi qui el guanyi. El formulari
   * d'arrencada té la seva pròpia prova a `app.spec`; aquí el que cal és entrar-hi.
   */
  if (open && who === ADMIN) {
    await page.request
      .post('/setup', {
        data: { name: ADMIN.name, email: ADMIN.email, password: ADMIN.password, locale: 'ca' },
      })
      .catch(() => undefined);
  }

  // Perdre la cursa és normal i no és un error: el que importa és que hi hagi login.
  await expect
    .poll(
      async () => {
        if ((await page.locator('[data-testid="login-email"]').count()) === 0) {
          await page.goto('/');
        }
        return page.locator('[data-testid="login-email"]').count();
      },
      { timeout: 20_000, intervals: [200, 400, 800] },
    )
    .toBeGreaterThan(0);

  await page.locator('[data-testid="login-email"]').fill(who.email);
  await page.locator('[data-testid="login-password"]').fill(who.password);
  await page.locator('[data-testid="login-submit"]').click();
  await passaElWizard(page);
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible({ timeout: 15_000 });
}

/**
 * La primera pregunta —«com reparteixes la feina»— surt a qui no l'ha contestada mai, i
 * **això inclou tothom qui entra per primera vegada en una prova**.
 *
 * Es contesta «per àmbits», que és com funciona l'app de sempre: així la resta de la suite
 * segueix provant el que provava. El monoàmbit i el wizard tenen les seves proves pròpies a
 * `scope-mode.spec.ts` i `welcome.spec.ts`, que és on toca.
 *
 * **No s'esquiva desant la preferència per l'API abans d'entrar**: llavors cap prova
 * passaria mai per aquesta pantalla i el dia que es trenqués no ho diria ningú.
 */
export async function passaElWizard(page: Page): Promise<void> {
  // S'espera que aparegui **una de les dues**: comprovar-ho de seguida guanyaria la cursa a
  // la sessió i diria que no hi ha wizard just abans que es pinti.
  await expect
    .poll(
      async () =>
        (await page.locator('[data-testid="welcome-multi"]').count()) +
        (await page.locator('[data-testid="topbar"]').count()),
      { timeout: 15_000, intervals: [100, 200, 400] },
    )
    .toBeGreaterThan(0);

  const wizard = page.locator('[data-testid="welcome-multi"]');
  if ((await wizard.count()) === 0) return;
  await wizard.click();
}

/** El token de la sessió, per a les crides directes a l'API. */
export async function token(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('femho.tokens') ?? '{}') as { access_token?: string })
        .access_token ?? '',
  );
}

/**
 * Entrar amb un compte **propi d'aquest fitxer de proves**.
 *
 * La suite comparteix un sol compte contra un sol servidor, i això va bé fins que una
 * prova canvia una **preferència de l'usuari**: l'idioma, el calaix de la bústia. Llavors
 * la resta de fitxers, que corren en paral·lel, se la troben canviada i fallen amb
 * missatges que no hi apunten gens —"no trobo el botó «Per fer»" quan el que passa és que
 * l'app ha quedat en anglès—, o no fallen, segons l'ordre en què toqui córrer.
 *
 * **Restaurar-la al final no val**: mentre el fitxer corre, els altres ja la veuen
 * canviada. La regla és aquesta: **qui muta una preferència global s'ha de fer el seu
 * usuari.**
 *
 * Depèn que la instància tingui el registre obert, que és com corre la suite.
 */
export async function enterAsNew(page: Page, who: Compte): Promise<void> {
  // La instància ha d'existir: el primer compte el fa `enter`, i aquest se'n crea un.
  await enter(page);
  await page.evaluate(() => {
    localStorage.removeItem('femho.tokens');
  });

  await page.goto('/register');
  await page.locator('[data-testid="register-email"]').fill(who.email);
  await page.locator('[data-testid="register-name"]').fill(who.name);
  await page.locator('[data-testid="register-password"]').fill(who.password);
  await page.locator('[data-testid="register-submit"]').click();

  // Registrar-se ja entra: el wizard de la primera pregunta surt aquí mateix.
  await passaElWizard(page);

  /**
   * Si ja existia d'una prova anterior del mateix fitxer, el registre no entra i es queda
   * al formulari: llavors s'hi entra pel login.
   *
   * **S'espera el tauler abans de decidir-ho.** Mirar-ho de seguida deia «no hi ha tauler»
   * en el moment entre triar al wizard i que React repinti, i llavors anava a buscar un
   * formulari de login que no hi era perquè la sessió ja estava oberta.
   */
  const hiHaTauler = await page
    .locator('[data-testid="topbar"]')
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);

  if (!hiHaTauler) {
    await page.goto('/');
    await page.locator('[data-testid="login-email"]').fill(who.email);
    await page.locator('[data-testid="login-password"]').fill(who.password);
    await page.locator('[data-testid="login-submit"]').click();
    await passaElWizard(page);
  }
  await expect(page.locator('[data-testid="topbar"]')).toBeVisible({ timeout: 15_000 });
}
