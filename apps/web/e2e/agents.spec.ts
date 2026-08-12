/**
 * Posar un agent a treballar, des de la pantalla.
 *
 * Fins avui la delegació tenia tot el terreny fet —els agents, el kanban de la IA, setze
 * tools d'MCP— i **cap manera d'arribar-hi**: no es podia crear cap credencial d'agent, o
 * sigui que el que hi havia era una porta tapiada. Això prova el camí sencer tal com el fa
 * una persona: crear l'agent, dir-li d'on agafa feina, i treure'n la credencial.
 *
 * I les dues coses que fan que sigui utilitzable i no només possible:
 *
 *   - **Un àmbit que ja porta un altre agent surt desactivat amb el seu nom**, no marcable
 *     per rebre un 422 després.
 *   - **La credencial es veu a MCP i API**, que és on la gent busca els tokens, dient de
 *     quin agent és i amb un botó que hi porta.
 *
 * Amb compte propi (`enterAsNew`): l'exclusivitat és per àmbit i, amb el compte compartit
 * de la suite, un agent d'aquest fitxer prendria àmbits a les proves que corren alhora.
 */

import { expect, test, type Page } from '@playwright/test';
import { enterAsNew, token } from './entrar.js';

test.describe.configure({ mode: 'serial' });

const COMPTE = {
  name: 'Qui configura agents',
  email: 'agents@example.com',
  password: 'la-contrasenya-de-prova',
};

async function obreIA(page: Page): Promise<void> {
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-ai"]').click();
  await expect(page.locator('[data-testid="agent-name"]')).toBeVisible();
}

async function creaAgent(page: Page, nom: string): Promise<void> {
  await page.locator('[data-testid="agent-name"]').fill(nom);
  await page.locator('[data-testid="agent-create"]').click();
  await expect(page.locator('[data-testid^="agent-"]', { hasText: nom }).first()).toBeVisible();
}

test('un agent es queda amb un àmbit, i el següent el veu pres amb el nom de qui el porta', async ({
  page,
}) => {
  await enterAsNew(page, COMPTE);

  // Un àmbit propi d'aquest fitxer: el que es prova és qui se'l queda.
  await page.goto('/settings');
  await page.locator('[data-testid="settings-tab-scopes"]').click();
  await page.locator('[data-testid="new-scope-name"]').fill('Feina delegada');
  await page.locator('[data-testid="new-scope-create"]').click();
  const fila = page.locator('[data-testid^="scope-row-"]', { hasText: 'Feina delegada' });
  await expect(fila).toBeVisible();
  const ambit = (await fila.getAttribute('data-testid'))!.replace('scope-row-', '');

  await obreIA(page);
  await creaAgent(page, 'Hermes');
  await creaAgent(page, 'Codex');

  const hermes = page.locator('[data-testid^="agent-"]', { hasText: 'Hermes' }).first();
  const codex = page.locator('[data-testid^="agent-"]', { hasText: 'Codex' }).first();
  const idHermes = (await hermes.getAttribute('data-testid'))!.replace('agent-', '');
  const idCodex = (await codex.getAttribute('data-testid'))!.replace('agent-', '');

  /**
   * **`click` i no `check`.** La casella és controlada: no es marca sola en clicar-hi, es
   * marca quan el servidor ha desat i la llista d'agents torna. `check()` mira l'estat tot
   * seguit i es queixa que el clic no ha fet res; el que s'ha d'esperar és el desat.
   */
  await page.locator(`[data-testid="agent-scope-${idHermes}-${ambit}"]`).click();
  await expect(page.locator(`[data-testid="agent-scope-${idHermes}-${ambit}"]`)).toBeChecked();

  /**
   * **La casella de l'altre agent es desactiva sola**, sense recarregar la pantalla. La
   * disponibilitat la sap el servidor i cada fila se la demana per separat: si desar no la
   * fes tornar a demanar a **totes**, aquesta casella es podria marcar per rebre un 422.
   */
  const seva = page.locator(`[data-testid="agent-scope-${idCodex}-${ambit}"]`);
  await expect(seva).toBeDisabled();
  // I diu de qui és: un «no es pot» és una porta tancada; un «el té en Hermes» és el pas
  // següent.
  await expect(seva.locator('xpath=..')).toHaveAttribute('title', /Hermes/);
  await expect(codex).toContainText('Hermes');
});

test('la credencial de l’agent surt una sola vegada, i es veu a MCP i API amb qui la porta', async ({
  page,
}) => {
  await enterAsNew(page, COMPTE);
  await obreIA(page);

  const hermes = page.locator('[data-testid^="agent-"]', { hasText: 'Hermes' }).first();
  const idHermes = (await hermes.getAttribute('data-testid'))!.replace('agent-', '');

  await page.locator(`[data-testid="agent-credential-new-${idHermes}"]`).click();

  const camp = page.locator(`[data-testid="agent-credential-value-${idHermes}"]`);
  await expect(camp).toBeVisible();
  const testimoni = await camp.inputValue();
  // Un testimoni de debò i no un espai en blanc amb bona cara.
  expect(testimoni.length).toBeGreaterThan(20);

  /**
   * **I val de debò**: es fa servir contra `/auth/me`, que ha de dir que qui parla és
   * aquest agent. Sense això la pantalla podria ensenyar un text qualsevol i la prova
   * passaria igual.
   */
  const qui = await page.request.get('/api/v1/auth/me', {
    headers: { authorization: `Bearer ${testimoni}` },
  });
  expect(qui.status()).toBe(200);
  expect(((await qui.json()) as { agent_id: string | null }).agent_id).toBe(idHermes);

  // A MCP i API hi surt —és on la gent busca els tokens— però no s'hi toca.
  await page.locator('[data-testid="settings-tab-mcp"]').click();
  const marca = page.locator('[data-testid^="token-ai-"]').first();
  await expect(marca).toContainText('Hermes');
  await expect(page.locator('[data-testid^="token-revoke-"]')).toHaveCount(0);

  // I el botó porta a l'agent, que és on sí que s'hi toca.
  await page.locator('[data-testid^="token-ai-go-"]').first().click();
  await expect(page.locator(`[data-testid="agent-credential-new-${idHermes}"]`)).toBeVisible();
});

test("l'agent pregunta, es veu sense entrar-hi, i la marca marxa quan respons", async ({
  page,
}) => {
  await enterAsNew(page, COMPTE);
  await obreIA(page);

  const hermes = page.locator('[data-testid^="agent-"]', { hasText: 'Hermes' }).first();
  const idHermes = (await hermes.getAttribute('data-testid'))!.replace('agent-', '');
  await page.locator(`[data-testid="agent-credential-new-${idHermes}"]`).click();
  const credencial = await page
    .locator(`[data-testid="agent-credential-value-${idHermes}"]`)
    .inputValue();
  const comAgent = { authorization: `Bearer ${credencial}` };

  /**
   * **La tasca es prepara per l'API i la pregunta la fa l'agent de debò**, amb la seva
   * credencial. Fer-ho tot per la pantalla provaria la pantalla dues vegades; el que aquí
   * s'ha de provar és que el que fa un agent de fora arribi a qui mira l'app.
   */
  const meu = { authorization: `Bearer ${await token(page)}` };
  const ambits = await page.request.get('/api/v1/scopes', { headers: meu });
  const ambit = ((await ambits.json()) as { id: string; name: string }[]).find(
    (scope) => scope.name === 'Feina delegada',
  )!;

  const creada = await page.request.post('/api/v1/tasks', {
    headers: meu,
    data: { scope_id: ambit.id, title: 'Enviar la factura' },
  });
  const tascaId = ((await creada.json()) as { id: string }).id;
  await page.request.post(`/api/v1/tasks/${tascaId}/ai-mode`, {
    headers: meu,
    data: { ai_mode: 'delegated' },
  });

  const pregunta = await page.request.post(`/api/v1/ai/tasks/${tascaId}/ask-user`, {
    headers: comAgent,
    data: { question: 'A quin dels dos correus?' },
  });
  expect(pregunta.status()).toBe(201);

  // **Es veu sense entrar a la tasca**: el punt va al commutador que hi porta.
  await page.goto(`/?scopes=${ambit.id}`);
  await expect(page.getByTestId('ai-attention-count')).toHaveText('1');

  // I al kanban de la IA, la targeta destacada **amb text**, no només amb color.
  await page.getByTestId('ai-board-toggle').click();
  const targeta = page.locator('[data-testid^="task-"]', { hasText: 'Enviar la factura' }).first();
  await expect(targeta.getByTestId('task-attention')).toContainText('Espera resposta');

  // S'obre, s'hi respon, i la marca marxa: no hi ha cap botó de «vist».
  await targeta.getByText('Enviar la factura').click();
  await expect(page.getByTestId('task-attention-notice')).toBeVisible();
  await expect(page.getByTestId('task-ai-message')).toContainText('A quin dels dos correus?');

  await page.getByTestId('task-new-comment').fill('Al de la gestoria.');
  await page.getByTestId('task-ai-conversation').getByRole('button', { name: 'Envia' }).click();
  await expect(page.getByTestId('task-attention-notice')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByTestId('ai-attention-count')).toHaveCount(0);
});

test("una tasca que l'agent té a les mans no es toca, i quan la deixa te la pots endur", async ({
  page,
}) => {
  await enterAsNew(page, COMPTE);
  await obreIA(page);

  const hermes = page.locator('[data-testid^="agent-"]', { hasText: 'Hermes' }).first();
  const idHermes = (await hermes.getAttribute('data-testid'))!.replace('agent-', '');
  await page.locator(`[data-testid="agent-credential-new-${idHermes}"]`).click();
  const credencial = await page
    .locator(`[data-testid="agent-credential-value-${idHermes}"]`)
    .inputValue();
  const comAgent = { authorization: `Bearer ${credencial}` };
  const meu = { authorization: `Bearer ${await token(page)}` };

  const ambits = await page.request.get('/api/v1/scopes', { headers: meu });
  const ambit = ((await ambits.json()) as { id: string; name: string }[]).find(
    (scope) => scope.name === 'Feina delegada',
  )!;

  const creada = await page.request.post('/api/v1/tasks', {
    headers: meu,
    data: { scope_id: ambit.id, title: 'Migrar el servidor' },
  });
  const tascaId = ((await creada.json()) as { id: string }).id;
  await page.request.post(`/api/v1/tasks/${tascaId}/ai-mode`, {
    headers: meu,
    data: { ai_mode: 'delegated' },
  });

  // L'agent l'agafa i hi treballa: reserva, la mou i hi deixa el que ha trobat.
  await page.request.post(`/api/v1/ai/tasks/${tascaId}/claim`, { headers: comAgent });
  await page.request.post(`/api/v1/tasks/${tascaId}/move`, {
    headers: comAgent,
    data: { status: 'doing' },
  });
  await page.request.post(`/api/v1/tasks/${tascaId}/comments`, {
    headers: comAgent,
    data: { body: 'He fet la còpia de seguretat.' },
  });

  await page.goto(`/?scopes=${ambit.id}`);
  await page.getByTestId('ai-board-toggle').click();

  // El cadenat es veu **amb text**: saber per què no es pot moure abans de provar-ho.
  const targeta = page.locator('[data-testid^="task-"]', { hasText: 'Migrar el servidor' }).first();
  await expect(targeta.getByTestId('task-locked')).toContainText("L'agent hi treballa");

  // I dins, no hi ha botó de reclamar-la: hi ha l'explicació i l'hora en què es deixa anar.
  await targeta.getByText('Migrar el servidor').click();
  await expect(page.getByTestId('task-locked-notice')).toBeVisible();
  await expect(page.getByTestId('task-take-over')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // L'agent pregunta: això el desbloqueja, perquè un agent que espera no treballa.
  await page.request.post(`/api/v1/ai/tasks/${tascaId}/ask-user`, {
    headers: comAgent,
    data: { question: 'Reinicio ara o de matinada?' },
  });

  await page.reload();
  await page.getByTestId('ai-board-toggle').click();
  await targeta.getByText('Migrar el servidor').click();

  await page.getByTestId('task-take-over').click();
  await page.getByTestId('task-take-over-doing').click();

  /**
   * **I es queda tot.** El que l'agent hi va deixar escrit és de la tasca i no del mode: si
   * en reclamar-la desaparegués, reclamar-la seria començar de zero.
   */
  await expect(page.getByTestId('task-take-over')).toHaveCount(0);
  await expect(page.getByTestId('task-ai-conversation')).toContainText(
    'He fet la còpia de seguretat.',
  );
  await expect(page.getByTestId('task-ai-conversation')).toContainText('Reinicio ara');

  /**
   * I ara és al tauler humà, a «Fent» —que és on l'has demanada— i ja no al de la IA. Es
   * recarrega la pàgina en comptes de tancar el modal: així es comprova de passada que el
   * canvi és al servidor i no només a la pantalla que l'ha fet.
   */
  await page.goto(`/?scopes=${ambit.id}`);
  await expect(
    page.locator('[data-column-status="doing"]').getByText('Migrar el servidor'),
  ).toBeVisible();

  await page.getByTestId('ai-board-toggle').click();
  await expect(
    page.locator('[data-column-status="doing"]').getByText('Migrar el servidor'),
  ).toHaveCount(0);
});
