/**
 * Una sola regla de visibilitat, per a les quatre menes de font.
 *
 * El model que aquest fitxer fixa, i que és tot el producte en tres línies:
 *
 * > Tot el que arriba d'una font va a la bústia. Pot ser **visible** —surt a l'inbox de la
 * > pestanya Tasques— o **no visible** —només al calendari—. **Res no arriba sol a la teva
 * > llista de feina**, i el calendari és des d'on decideixes què hi puja.
 *
 * Les tres coses que es proven són les tres que fallarien en silenci: que el defecte d'una
 * carpeta nova és «no», que el que s'amaga **segueix sent recuperable**, i que la bústia i
 * el calendari són la mateixa consulta amb dues lents.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-mail-vis-'));
const NOW = '2026-08-11T10:00:00.000Z';
const DIA = '2026-08-11';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let userId: string;
let scopeId: string;
let accountId: string;
let ruleId: string;

interface MailItem {
  id: string;
  subject: string | null;
  in_inbox: boolean;
  source_kind: string;
}

async function api(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: Record<string, unknown>,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: auth })
    : app.inject({ method, url, headers: auth, payload });
}

/** La bústia amb la lent del **tauler**: només el que has decidit que és feina. */
const alTauler = async (): Promise<MailItem[]> =>
  (await api('GET', `/api/v1/inbox?date=${DIA}`)).json<{ mail: MailItem[] }>().mail;

/** I amb la lent del **calendari**: tot, cadascun amb el seu `in_inbox`. */
const alCalendari = async (): Promise<MailItem[]> =>
  (await api('GET', `/api/v1/inbox?date=${DIA}&include_hidden=true`)).json<{ mail: MailItem[] }>()
    .mail;

/** Un correu ingerit, tal com el deixaria la lectura. */
async function correu(subject: string, key: string): Promise<string> {
  const id = uuidv7();
  const fil = uuidv7();
  await sql`
    INSERT INTO mail_threads (id, account_id, thread_key, created_at, updated_at)
    VALUES (${fil}, ${accountId}, ${`mid:${key}`}, ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO mail_messages (id, account_id, thread_id, message_key, folder, uid_validity,
                               uid, internal_date, from_name, from_address, subject,
                               disposition, rule_id, created_at, updated_at)
    VALUES (${id}, ${accountId}, ${fil}, ${`mid:${key}`}, 'INBOX/Escola', '1', ${key},
            ${NOW}, 'Escola', 'secretaria@escola.test', ${subject}, 'inbox', ${ruleId},
            ${NOW}, ${NOW})
  `.execute(conn.db);
  return id;
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'vis@example.com', 'Borja', ${await hashPassword(PASSWORD)}, 'human',
            'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-pink', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent' },
    { connection: conn, secret: 'x'.repeat(40) },
  );
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'vis@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
});

beforeEach(async () => {
  for (const taula of ['mail_messages', 'mail_threads', 'mail_rules', 'tasks', 'mail_accounts']) {
    await sql.raw(`DELETE FROM ${taula}`).execute(conn.db);
  }

  accountId = uuidv7();
  await sql`
    INSERT INTO mail_accounts (id, user_id, name, host, username, secret_enc,
                               created_at, updated_at)
    VALUES (${accountId}, ${userId}, 'Personal', 'imap.escola.test', 'borja', 'segellat',
            ${NOW}, ${NOW})
  `.execute(conn.db);

  ruleId = uuidv7();
  await sql`
    INSERT INTO mail_rules (id, account_id, folder, scope_id, position, created_at, updated_at)
    VALUES (${ruleId}, ${accountId}, 'INBOX/Escola', ${scopeId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('el defecte', () => {
  it("una carpeta nova NO entra a l'inbox de Tasques, però es veu al calendari", async () => {
    /**
     * **El defecte que has triat, i el que fa que això sigui utilitzable.** Mapar una
     * carpeta és dir «vull veure això en algun lloc», no «posa-m'ho tot a la llista de coses
     * per fer»: una bústia amb volum enterraria la pantalla principal el primer matí.
     */
    await correu('La factura de març', 'a@x');

    expect(await alTauler()).toHaveLength(0);

    const tot = await alCalendari();
    expect(tot).toHaveLength(1);
    expect(tot[0]).toMatchObject({ subject: 'La factura de març', in_inbox: false });
  });

  it('i encendre la carpeta els fa entrar tots de cop', async () => {
    await correu('Un', 'a@x');
    await correu('Dos', 'b@x');

    const res = await api('PATCH', `/api/v1/mail/rules/${ruleId}`, { inbox_visible: true });
    expect(res.statusCode).toBe(200);

    expect(await alTauler()).toHaveLength(2);
  });
});

describe("l'excepció d'un correu concret", () => {
  it("un correu es puja a l'inbox sense tocar la carpeta", async () => {
    const id = await correu('Només aquest', 'a@x');
    await correu('Aquest no', 'b@x');

    const res = await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: true });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ in_inbox: boolean }>().in_inbox).toBe(true);

    const tauler = await alTauler();
    expect(tauler).toHaveLength(1);
    expect(tauler[0]?.subject).toBe('Només aquest');
  });

  it('i es torna a baixar, que és el que el `dismiss` no deixava fer', async () => {
    /**
     * **Abans això era un carreró sense sortida**: descartar un correu el treia per sempre i
     * cap ruta ho desfeia. Ara amagar-lo el deixa al calendari, i des d'allà torna.
     */
    const id = await correu('Va i ve', 'a@x');
    await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: true });
    expect(await alTauler()).toHaveLength(1);

    await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: false });
    expect(await alTauler()).toHaveLength(0);
    // I segueix al calendari, que és d'on el pots tornar a pujar.
    expect(await alCalendari()).toHaveLength(1);
  });

  it("l'excepció guanya la carpeta, en tots dos sentits", async () => {
    // La carpeta encesa, aquest correu no.
    await api('PATCH', `/api/v1/mail/rules/${ruleId}`, { inbox_visible: true });
    const id = await correu('Aquest no, gràcies', 'a@x');
    await correu('Aquest sí', 'b@x');

    await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: false });

    const tauler = await alTauler();
    expect(tauler.map((m) => m.subject)).toEqual(['Aquest sí']);
  });

  it('i `null` treu l’excepció i torna a manar la carpeta', async () => {
    await api('PATCH', `/api/v1/mail/rules/${ruleId}`, { inbox_visible: true });
    const id = await correu('Tornem-hi', 'a@x');

    await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: false });
    expect(await alTauler()).toHaveLength(0);

    const res = await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: null });
    expect(res.json<{ visible: boolean | null; in_inbox: boolean }>()).toEqual({
      visible: null,
      in_inbox: true,
    });
    expect(await alTauler()).toHaveLength(1);
  });
});

describe('el nivell que guanya a tot', () => {
  it('un correu que ja és una tasca marxa de la bústia', async () => {
    /**
     * És el nivell 0 de la política, i evita el problema que va obrir tota aquesta funció:
     * **veure la mateixa obligació dues vegades**, una com a element i una com a feina. Si
     * ja n'has fet una tasca, la feina viu a la targeta.
     */
    await api('PATCH', `/api/v1/mail/rules/${ruleId}`, { inbox_visible: true });
    await correu('Ja és feina', 'a@x');
    expect(await alTauler()).toHaveLength(1);

    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, source_kind,
                         mail_account_id, mail_message_key, created_by, created_at, updated_at)
      VALUES (${uuidv7()}, ${scopeId}, 'Ja és feina', 'inbox', 'a1', 'native', 'mail',
              ${accountId}, 'mid:a@x', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    expect(await alTauler()).toHaveLength(0);

    /**
     * **Al calendari hi segueix, difuminat.** No desapareix perquè el nivell 0 no és una
     * supressió sinó una resposta a «és feina pendent?»: ja no ho és, però el correu existeix
     * i el calendari és l'organitzador —hi surt tot el que ha arribat.
     */
    const calendari = await alCalendari();
    expect(calendari).toHaveLength(1);
    expect(calendari[0]?.in_inbox).toBe(false);
  });

  it('i quan el converteixes de debò, marxa dels dos llocs', async () => {
    /**
     * El camí de veritat, que és un altre: convertir posa `disposition = 'task'`, i llavors
     * el correu **deixa de ser un element**. La diferència amb el cas de sobre és qui ho ha
     * fet: allà una tasca que apunta al correu, aquí la conversió mateixa.
     */
    await api('PATCH', `/api/v1/mail/rules/${ruleId}`, { inbox_visible: true });
    const id = await correu('Es farà tasca', 'a@x');
    expect(await alTauler()).toHaveLength(1);

    const res = await api('POST', `/api/v1/mail/messages/${id}/convert`);
    expect(res.statusCode).toBe(200);

    expect(await alTauler()).toHaveLength(0);
    expect(await alCalendari()).toHaveLength(0);
  });
});

describe('les dues lents', () => {
  it('són la mateixa consulta, i el que canvia és el filtre', async () => {
    /**
     * **P4**: la columna del kanban i el rail del calendari són el mateix component amb la
     * mateixa font de dades. Si fossin dues consultes, un dia divergirien i el que es veu
     * difuminat al calendari i el que falta a la bústia deixarien de ser la mateixa cosa.
     */
    const id = await correu('Un de sol', 'a@x');
    await api('POST', '/api/v1/inbox/mail', { message_id: id, visible: true });
    await correu('I un altre', 'b@x');

    const tauler = await alTauler();
    const calendari = await alCalendari();

    expect(tauler).toHaveLength(1);
    expect(calendari).toHaveLength(2);
    // El que surt a les dues és **la mateixa cosa amb el mateix valor**.
    expect(calendari.find((m) => m.id === tauler[0]?.id)?.in_inbox).toBe(true);
    expect(calendari.every((m) => m.source_kind === 'mail')).toBe(true);
  });

  it("i el correu d'un interval surt per al calendari, també el no visible", async () => {
    await correu('Del dia', 'a@x');

    const res = await api(
      'GET',
      `/api/v1/mail/messages?from=${DIA}T00:00:00.000Z&to=2026-08-12T00:00:00.000Z`,
    );
    expect(res.statusCode).toBe(200);
    const items = res.json<MailItem[]>();
    expect(items).toHaveLength(1);
    expect(items[0]?.in_inbox).toBe(false);

    // I fora de l'interval, res: la graella demana un mes de cop i no vol la resta.
    const buit = await api(
      'GET',
      '/api/v1/mail/messages?from=2026-09-01T00:00:00.000Z&to=2026-10-01T00:00:00.000Z',
    );
    expect(buit.json<MailItem[]>()).toHaveLength(0);
  });
});
