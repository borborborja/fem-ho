/**
 * Comptes i regles de correu, per l'API.
 *
 * Aquest fitxer prova sobretot **el que no ha de passar**, perquè és on hi ha el risc: un
 * compte de correu porta una contrasenya personal i una regla escriu al tauler de la casa.
 *
 *   - La contrasenya **no torna mai**, en cap resposta, ni emmascarada.
 *   - Un compte és **d'una persona**: un altre usuari —encara que sigui administrador— no
 *     el veu, i demanar-lo per identificador dona el mateix que si no existís.
 *   - Una regla necessita **dues coses alhora**: que el compte sigui teu i que puguis
 *     escriure a l'àmbit. Quedar-se amb la primera deixaria encaminar correu cap a un
 *     àmbit on no hi ets.
 *   - `127.0.0.1` **es refusa**, i amb un 422 que diu que no es pot demanar —no un
 *     resultat que convidi a tornar-ho a provar.
 *   - Provar la connexió **no desa res**.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-mail-http-'));
const NOW = '2026-08-11T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };
let altreAuth: { authorization: string };
let scopeId: string;
let scopeAlie: string;

interface Compte {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  has_secret: boolean;
  consecutive_errors: number;
}

interface Regla {
  id: string;
  folder: string;
  scope_id: string;
  action: string;
  title_template: string;
}

async function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
  who: { authorization: string } = auth,
): Promise<LightMyRequestResponse> {
  return payload === undefined
    ? app.inject({ method, url, headers: who })
    : app.inject({ method, url, headers: who, payload });
}

const compta = async (taula: string): Promise<number> => {
  const row = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM activity_log
    WHERE entity_type = ${taula}`.execute(conn.db);
  return Number(row.rows[0]?.n ?? 0);
};

async function crearCompte(over: Record<string, unknown> = {}): Promise<Compte> {
  const res = await api('POST', '/api/v1/mail/accounts', {
    name: 'Personal',
    host: 'imap.example.test',
    username: 'borja',
    password: 'una-contrasenya',
    ...over,
  });
  expect(res.statusCode).toBe(201);
  return res.json<Compte>();
}

async function usuari(email: string, role: 'admin' | 'member'): Promise<string> {
  const id = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${id}, ${email}, ${email}, ${await hashPassword(PASSWORD)}, 'human', ${role},
            ${NOW}, ${NOW})
  `.execute(conn.db);
  return id;
}

async function entrar(email: string): Promise<{ authorization: string }> {
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: PASSWORD },
  });
  return { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const meu = await usuari('correu@example.com', 'admin');
  // **Administrador a posta**: si un compte de correu fos visible per rol, aquest el veuria.
  const altre = await usuari('altre@example.com', 'admin');

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-pink', ${meu}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeAlie = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeAlie}, 'La seva feina', 'individual', '--plou-blue', ${altre}, 'a1',
            ${NOW}, ${NOW})
  `.execute(conn.db);

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent' },
    { connection: conn, secret: 'x'.repeat(40) },
  );
  auth = await entrar('correu@example.com');
  altreAuth = await entrar('altre@example.com');
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('els comptes', () => {
  it("un compte es dona d'alta i deixa rastre", async () => {
    const abans = await compta('mail_account');
    const compte = await crearCompte();

    expect(compte.host).toBe('imap.example.test');
    // El defecte de port va lligat a la seguretat: 993 és IMAPS.
    expect(compte.port).toBe(993);
    expect(compte.has_secret).toBe(true);
    expect(await compta('mail_account')).toBe(abans + 1);
  });

  it('i la contrasenya no torna mai, en cap forma', async () => {
    const compte = await crearCompte({ name: 'Amb secret', password: 'super-secreta' });

    const llista = await api('GET', '/api/v1/mail/accounts');
    const cru = llista.body;
    /**
     * Es mira **el cos sencer en cru** i no els camps un per un: si algú afegeix un camp
     * nou que la porti, comprovar els que ja coneixem no ho veuria.
     */
    expect(cru).not.toContain('super-secreta');
    // I tampoc el text xifrat: si el segell surt, l'única cosa que en protegeix és el
    // secret de la instància, que viu al mateix disc que la base.
    expect(cru).not.toContain('secret_enc');

    const fila = await sql<{ secret_enc: string | null }>`
      SELECT secret_enc FROM mail_accounts WHERE id = ${compte.id}
    `.execute(conn.db);
    expect(fila.rows[0]?.secret_enc).not.toBeNull();
    expect(fila.rows[0]?.secret_enc).not.toContain('super-secreta');
  });

  it('un port que no és d’IMAP es refusa amb 422', async () => {
    // Sense això, un «compte de correu» a `localhost:6379` és una manera de fer que el
    // servidor parli amb el Redis de la casa.
    const res = await api('POST', '/api/v1/mail/accounts', {
      name: 'Estrany',
      host: 'imap.example.test',
      username: 'borja',
      port: 6379,
    });
    expect(res.statusCode).toBe(422);
  });

  it('editar el compte deixa rastre, i buida no vol dir esborra', async () => {
    const compte = await crearCompte({ name: 'Per editar' });
    const abans = await compta('mail_account');

    const res = await api('PATCH', `/api/v1/mail/accounts/${compte.id}`, { name: 'Reanomenat' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Compte>().name).toBe('Reanomenat');
    // Desar el nom no ha de perdre les credencials.
    expect(res.json<Compte>().has_secret).toBe(true);
    expect(await compta('mail_account')).toBe(abans + 1);
  });

  it('i arreglar les credencials reinicia la retirada', async () => {
    const compte = await crearCompte({ name: 'Amb errors' });
    await sql`
      UPDATE mail_accounts SET consecutive_errors = 7, last_error = 'AUTH' WHERE id = ${compte.id}
    `.execute(conn.db);

    /**
     * Sense això, un compte que ha anat a la retirada de sis hores per una contrasenya
     * dolenta es quedaria callat sis hores **després** que l'arreglessis, i el que veuries
     * és que corregir-ho no serveix de res.
     */
    const res = await api('PATCH', `/api/v1/mail/accounts/${compte.id}`, {
      password: 'la-bona-de-veritat',
    });
    expect(res.json<Compte>().consecutive_errors).toBe(0);
  });

  it("un compte és d'una persona: un altre administrador no el veu ni el pot tocar", async () => {
    const compte = await crearCompte({ name: 'Ben meu' });

    const seus = await api('GET', '/api/v1/mail/accounts', undefined, altreAuth);
    expect(seus.json<Compte[]>().map((c) => c.id)).not.toContain(compte.id);

    // I demanar-lo dona 404, no 403: distingir-los diria quins identificadors existeixen.
    const toca = await api(
      'PATCH',
      `/api/v1/mail/accounts/${compte.id}`,
      { name: 'Meu ara' },
      altreAuth,
    );
    expect(toca.statusCode).toBe(404);
  });

  it("treure el compte s'endú les regles i no les tasques", async () => {
    const compte = await crearCompte({ name: 'Per treure' });
    const regla = await api('POST', '/api/v1/mail/rules', {
      account_id: compte.id,
      folder: 'INBOX/Efímera',
      scope_id: scopeId,
    });
    expect(regla.statusCode).toBe(201);

    // Una tasca que va sortir d'aquest compte. **No l'ha de tocar ningú.**
    const tasca = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, source_kind,
                         mail_account_id, mail_thread_key, created_by, created_at, updated_at)
      VALUES (${tasca}, ${scopeId}, 'Va sortir d’un correu', 'inbox', 'z1', 'native', 'mail',
              ${compte.id}, 'mid:arrel@example.test',
              (SELECT id FROM users WHERE email = 'correu@example.com'), ${NOW}, ${NOW})
    `.execute(conn.db);

    const abans = await compta('mail_account');
    const res = await api('DELETE', `/api/v1/mail/accounts/${compte.id}`);
    expect(res.statusCode).toBe(204);
    expect(await compta('mail_account')).toBe(abans + 1);

    const regles = await api('GET', '/api/v1/mail/rules');
    expect(regles.json<Regla[]>().map((r) => r.folder)).not.toContain('INBOX/Efímera');

    /**
     * I la tasca hi és, amb la provinença sencera. Que esborrar el compte et buidés el
     * tauler seria la mena de neteja que ningú demana i que no es pot desfer.
     */
    const queda = await sql<{ n: number; source_kind: string | null }>`
      SELECT COUNT(*) AS n, MAX(source_kind) AS source_kind FROM tasks WHERE id = ${tasca}
    `.execute(conn.db);
    expect(Number(queda.rows[0]?.n)).toBe(1);
    expect(queda.rows[0]?.source_kind).toBe('mail');
  });
});

describe('les regles', () => {
  it('una carpeta es mapa una sola vegada', async () => {
    const compte = await crearCompte({ name: 'Amb regles' });
    const abans = await compta('mail_rule');

    const primera = await api('POST', '/api/v1/mail/rules', {
      account_id: compte.id,
      folder: 'INBOX/Escola',
      scope_id: scopeId,
      action: 'task',
      title_template: '{{from}} - {{subject}}',
    });
    expect(primera.statusCode).toBe(201);
    expect(primera.json<Regla>().title_template).toBe('{{from}} - {{subject}}');
    expect(await compta('mail_rule')).toBe(abans + 1);

    // La segona dona 409 amb una frase, i no un error de restricció de la base.
    const segona = await api('POST', '/api/v1/mail/rules', {
      account_id: compte.id,
      folder: 'INBOX/Escola',
      scope_id: scopeId,
    });
    expect(segona.statusCode).toBe(409);
    expect(segona.json<{ detail: string }>().detail).toContain('INBOX/Escola');
  });

  it("no es pot encaminar correu cap a un àmbit on no hi ets", async () => {
    /**
     * **Les dues comprovacions són diferents i totes dues hi són.** El compte és meu; el
     * que no és meu és l'àmbit. Amb només la primera, qualsevol podria fer arribar el que
     * vulgui al tauler d'un altre.
     */
    const compte = await crearCompte({ name: 'Per colar-se' });
    const res = await api('POST', '/api/v1/mail/rules', {
      account_id: compte.id,
      folder: 'INBOX/Coladissa',
      scope_id: scopeAlie,
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("i tampoc amb el compte d'un altre cap a un àmbit teu", async () => {
    const seu = await api(
      'POST',
      '/api/v1/mail/accounts',
      { name: 'Seu', host: 'imap.example.test', username: 'altre' },
      altreAuth,
    );
    const res = await api('POST', '/api/v1/mail/rules', {
      account_id: seu.json<Compte>().id,
      folder: 'INBOX/Seva',
      scope_id: scopeId,
    });
    expect(res.statusCode).toBe(404);
  });

  it('canviar de carpeta reinicia el cursor', async () => {
    const compte = await crearCompte({ name: 'Amb cursor' });
    const regla = (
      await api('POST', '/api/v1/mail/rules', {
        account_id: compte.id,
        folder: 'INBOX/Primera',
        scope_id: scopeId,
      })
    ).json<Regla>();

    await sql`
      UPDATE mail_rules SET uid_validity = '42', last_uid = '4000' WHERE id = ${regla.id}
    `.execute(conn.db);

    const abans = await compta('mail_rule');
    const res = await api('PATCH', `/api/v1/mail/rules/${regla.id}`, { folder: 'INBOX/Segona' });
    expect(res.statusCode).toBe(200);
    expect(await compta('mail_rule')).toBe(abans + 1);

    /**
     * L'UID 4.000 d'una carpeta no vol dir res a una altra: arrossegar-lo faria que la
     * carpeta nova s'ingerís des d'un punt arbitrari —o se salta correus, o els reingereix
     * tots—. Es torna a començar, que amb la regla del cursor inicial vol dir «des d'ara».
     */
    const cursor = await sql<{ uid_validity: string | null; last_uid: string | null }>`
      SELECT uid_validity, last_uid FROM mail_rules WHERE id = ${regla.id}
    `.execute(conn.db);
    expect(cursor.rows[0]?.uid_validity).toBeNull();
    expect(cursor.rows[0]?.last_uid).toBeNull();
  });

  it("i editar-la sense tocar la carpeta no el toca", async () => {
    const compte = await crearCompte({ name: 'Cursor intacte' });
    const regla = (
      await api('POST', '/api/v1/mail/rules', {
        account_id: compte.id,
        folder: 'INBOX/Quieta',
        scope_id: scopeId,
      })
    ).json<Regla>();
    await sql`UPDATE mail_rules SET last_uid = '900' WHERE id = ${regla.id}`.execute(conn.db);

    await api('PATCH', `/api/v1/mail/rules/${regla.id}`, { action: 'task' });

    const cursor = await sql<{ last_uid: string | null }>`
      SELECT last_uid FROM mail_rules WHERE id = ${regla.id}
    `.execute(conn.db);
    expect(cursor.rows[0]?.last_uid).toBe('900');
  });

  it('deixar de llegir una carpeta deixa rastre, i la torna a alliberar', async () => {
    const compte = await crearCompte({ name: 'Per deixar' });
    const regla = (
      await api('POST', '/api/v1/mail/rules', {
        account_id: compte.id,
        folder: 'INBOX/Temporal',
        scope_id: scopeId,
      })
    ).json<Regla>();

    const abans = await compta('mail_rule');
    expect((await api('DELETE', `/api/v1/mail/rules/${regla.id}`)).statusCode).toBe(204);
    expect(await compta('mail_rule')).toBe(abans + 1);

    // I la carpeta torna a quedar lliure: l'índex únic és parcial.
    const altra = await api('POST', '/api/v1/mail/rules', {
      account_id: compte.id,
      folder: 'INBOX/Temporal',
      scope_id: scopeId,
    });
    expect(altra.statusCode).toBe(201);
  });
});

describe('provar la connexió', () => {
  it('una adreça interna es refusa, i amb un 422', async () => {
    /**
     * **No és «ha anat malament»: és una petició que no es pot fer.** La diferència importa
     * perquè un `ok: false` convida a tornar-ho a provar, i aquí tornar-hi no canviarà res.
     */
    const compte = await crearCompte({ name: 'Cap a dins', host: '127.0.0.1' });
    const res = await api('POST', `/api/v1/mail/accounts/${compte.id}/test`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json<{ detail: string }>().detail).toContain('127.0.0.1');
  });

  it('i un nom que resol a loopback, també', async () => {
    // La comprovació és sobre l'adreça i no sobre el nom: `localhost` no s'hi val com a
    // cadena, però el que la rebutja és el que resol.
    const compte = await crearCompte({ name: 'Cap a dins II', host: 'localhost' });
    const res = await api('POST', `/api/v1/mail/accounts/${compte.id}/test`, {});
    expect(res.statusCode).toBe(422);
  });

  it('un compte sense contrasenya no arriba a connectar-se', async () => {
    // Provar-ho seria enviar l'usuari amb una cadena buida a un servidor de fora.
    const res0 = await api('POST', '/api/v1/mail/accounts', {
      name: 'Sense clau',
      host: 'imap.example.test',
      username: 'borja',
    });
    const compte = res0.json<Compte>();
    expect(compte.has_secret).toBe(false);

    const res = await api('POST', `/api/v1/mail/accounts/${compte.id}/test`, {});
    expect(res.statusCode).toBe(422);
    expect(res.json<{ type: string }>().type).toContain('mail-secret-required');
  });

  it('i provar-la amb una contrasenya enviada al cos no la desa', async () => {
    /**
     * És el que fa que el botó sigui útil: es pot comprovar **abans** de desar. Si desés,
     * «prova-ho» i «desa-ho» serien el mateix botó amb dos noms.
     */
    const res0 = await api('POST', '/api/v1/mail/accounts', {
      name: 'Prova sense desar',
      host: '127.0.0.1',
      username: 'borja',
    });
    const compte = res0.json<Compte>();

    await api('POST', `/api/v1/mail/accounts/${compte.id}/test`, { password: 'la-que-provo' });

    const després = await api('GET', '/api/v1/mail/accounts');
    const trobat = després.json<Compte[]>().find((c) => c.id === compte.id);
    expect(trobat?.has_secret).toBe(false);
  });
});

describe('el correu a la bústia', () => {
  it("un correu ingerit surt a la bústia amb la seva provinença", async () => {
    /**
     * **Array a part de les tasques**, i és el que fa que la distinció de la regla 7
     * esmenada es pugui comprovar en comptes de discutir: un correu de la bústia no té
     * `status` ni `position`, i cap identificador d'aquí pot arribar a `/tasks/{id}/move`.
     */
    const compte = await crearCompte({ name: 'Amb bústia' });
    const regla = (
      await api('POST', '/api/v1/mail/rules', {
        account_id: compte.id,
        folder: 'INBOX/Bústia',
        scope_id: scopeId,
      })
    ).json<Regla>();

    const fil = uuidv7();
    await sql`
      INSERT INTO mail_threads (id, account_id, thread_key, created_at, updated_at)
      VALUES (${fil}, ${compte.id}, 'mid:b@escola.test', ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO mail_messages (id, account_id, thread_id, message_key, folder, uid_validity,
                                 uid, internal_date, from_name, from_address, subject,
                                 disposition, rule_id, created_at, updated_at)
      VALUES (${uuidv7()}, ${compte.id}, ${fil}, 'mid:b@escola.test', 'INBOX/Bústia', '1', '1',
              ${NOW}, 'Escola', 'secretaria@escola.test', 'La factura de març', 'inbox',
              ${regla.id}, ${NOW}, ${NOW})
    `.execute(conn.db);

    const vista = await api('GET', '/api/v1/inbox?date=2026-08-11');
    const cos = vista.json<{ mail: Record<string, unknown>[] }>();

    expect(cos.mail).toHaveLength(1);
    expect(cos.mail[0]).toMatchObject({
      subject: 'La factura de març',
      from_address: 'secretaria@escola.test',
      // La icona es dibuixa amb això, amb el mateix component que la resta.
      source_kind: 'mail',
      scope_id: scopeId,
    });
    expect(cos.mail[0]).not.toHaveProperty('status');
    expect(cos.mail[0]).not.toHaveProperty('position');
  });

  it("i el correu d'un altre no surt a la teva bústia", async () => {
    // Un compte de correu és d'una persona. Que el seu correu entrés a la bústia d'un
    // company d'àmbit seria el pitjor error que aquesta funció pot cometre.
    const vista = await api('GET', '/api/v1/inbox?date=2026-08-11', undefined, altreAuth);
    expect(vista.json<{ mail: unknown[] }>().mail).toHaveLength(0);
  });
});
