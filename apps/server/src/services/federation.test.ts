/**
 * La federació entre instàncies, amb dues instàncies de debò.
 *
 * **No hi ha dobles.** Es munten dos servidors Fem-ho sencers, cadascun amb la seva base
 * i el seu secret, i el de la casa A parla amb el de la casa B pel port de loopback. És
 * l'única manera de comprovar el que importa: que el token que dona B val a B, que només
 * val per a l'àmbit que s'ha compartit, i que el que arriba pel sync es replica.
 *
 * **El que aquí no es pot provar, i es diu.** En producció la federació és només HTTPS
 * pública. Cap de les dues defenses es relaxa: `normalizeBaseUrl` —que exigeix `https:`—
 * es prova a part sobre la funció, i viu a la ruta, que és on arriba el que escriu
 * l'usuari; i `safeFetch` segueix blocant els rangs privats, amb el guarda de loopback
 * injectat només aquí, com ja es feia per al client CalDAV.
 *
 * El que queda fora, doncs, és **una sola línia**: que la ruta cridi la normalització. La
 * resta del camí —manifest, bescanvi, enllaç, rèplica, desenllaç— es recorre sencera.
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { seal } from '../crypto/secret-box.js';
import { isBlockedAddress, SsrfError } from '../dav/fetch-safe.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import { issueGrant } from './grants.js';
import {
  forgetTableColumns,
  linkInstance,
  normalizeBaseUrl,
  pullFromLink,
  unlinkInstance,
} from './federation.js';

const tmpA = mkdtempSync(join(tmpdir(), 'femho-fedA-'));
const tmpB = mkdtempSync(join(tmpdir(), 'femho-fedB-'));
const NOW = '2026-08-07T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-prova';
const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);

/** Igual d'estricta que la de debò, menys per al servidor de proves a loopback. */
const permetLoopback = {
  guard: async (url: URL) => {
    const host = url.hostname;
    if (host !== '127.0.0.1' && isBlockedAddress(host)) {
      throw new SsrfError(`"${host}" és una adreça interna.`);
    }
    return { address: host, family: 4 as const };
  },
};

let connA: Connection;
let connB: Connection;
let appA: FastifyInstance;
let appB: FastifyInstance;
let httpB: Server;
let baseB = '';

let userA = '';
let userB = '';
let scopeB = '';
let scopeMirall = '';
let scopeAltreB = '';
let authB: Record<string, string>;

/** El propietari de la casa A, per cridar-hi serveis directament. */
function ownerA(): Principal {
  return {
    kind: 'user',
    userId: userA,
    capabilities: new Set(capabilitiesForRole('admin')),
    scopeIds: null,
    source: 'api',
  };
}

/** Un principal de propietari a B, per cridar-hi serveis directament. */
function ownerB(): Principal {
  return {
    kind: 'user',
    userId: userB,
    capabilities: new Set(capabilitiesForRole('admin')),
    scopeIds: null,
    source: 'api',
  };
}

async function emetConvit(kind: 'scope_federation' | 'scope_invite', scopeId: string) {
  return auditedTransaction(connB.db, ownerB(), (ctx) =>
    issueGrant(ctx, ownerB(), { kind, scopeId }, SECRET_B),
  );
}

beforeAll(async () => {
  for (const k of Object.keys(process.env)) if (k.startsWith('FEMHO_')) delete process.env[k];
  forgetTableColumns();

  connA = connect(`sqlite://${join(tmpA, 'a.db')}`);
  connB = connect(`sqlite://${join(tmpB, 'b.db')}`);
  await migrateToLatest(connA.db, { engine: 'sqlite' });
  await migrateToLatest(connB.db, { engine: 'sqlite' });

  // --- La casa B: qui comparteix.
  userB = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userB}, 'b@e.com', 'Berta', ${await hashPassword(PASSWORD)}, 'human', 'admin',
            ${NOW}, ${NOW})
  `.execute(connB.db);

  for (const [id, name] of [
    ['compartit', 'Casa'],
    ['reservat', 'Feina'],
  ] as const) {
    const scopeId = uuidv7();
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${scopeId}, ${name}, 'collective', '--femho-scope-1', ${userB}, ${id}, ${NOW}, ${NOW})
    `.execute(connB.db);
    if (id === 'compartit') scopeB = scopeId;
    else scopeAltreB = scopeId;
  }

  appB = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmpB, instanceName: 'Casa Berta' },
    { connection: connB, secret: SECRET_B },
  );
  await appB.ready();

  // Un servidor HTTP de debò: la federació parla per la xarxa, no per `inject`.
  httpB = createServer((req, res) => {
    appB.server.emit('request', req, res);
  });
  await new Promise<void>((resolve) => httpB.listen(0, '127.0.0.1', resolve));
  baseB = `http://127.0.0.1:${String((httpB.address() as AddressInfo).port)}`;

  const login = await appB.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'b@e.com', password: PASSWORD },
  });
  authB = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };

  // --- La casa A: qui rep.
  userA = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userA}, 'a@e.com', 'Arnau', ${await hashPassword(PASSWORD)}, 'human', 'admin',
            ${NOW}, ${NOW})
  `.execute(connA.db);

  scopeMirall = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeMirall}, 'Casa (Berta)', 'collective', '--femho-scope-6', ${userA}, 'zz',
            ${NOW}, ${NOW})
  `.execute(connA.db);

  appA = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmpA },
    { connection: connA, secret: SECRET_A },
  );
  await appA.ready();
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    httpB.close(() => {
      resolve();
    }),
  );
  await appA.close();
  await appB.close();
  await connA.close();
  await connB.close();
  rmSync(tmpA, { recursive: true, force: true });
  rmSync(tmpB, { recursive: true, force: true });
});

describe("l'adreça de l'altra instància", () => {
  it("es neteja de la barra final i del que hi hagi després de l'arrel", () => {
    expect(normalizeBaseUrl('https://casa.exemple.org/')).toBe('https://casa.exemple.org');
    expect(normalizeBaseUrl('  https://casa.exemple.org/femho/  ')).toBe(
      'https://casa.exemple.org/femho',
    );
  });

  /**
   * **`http:` es rebutja abans que `safeFetch` hi arribi.** Aquell blocaria una adreça
   * privada, però un `http://` públic hi passaria: el token de federació viatjaria en
   * clar i qui el llegís pel camí tindria accés escrivible a l'àmbit.
   */
  it('i en text pla es rebutja, encara que sigui una adreça pública', () => {
    expect(() => normalizeBaseUrl('http://casa.exemple.org')).toThrow(/HTTPS/u);
  });

  it('i el que no és una URL també', () => {
    expect(() => normalizeBaseUrl('casa.exemple.org')).toThrow();
  });
});

describe('el manifest', () => {
  it('diu qui és, i prou: ni usuaris, ni àmbits, ni la versió', async () => {
    const res = await appB.inject({ method: 'GET', url: '/.well-known/femho' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ product: 'fem-ho', api: 'v1', name: 'Casa Berta' });
  });

  it('i no demana sessió, que és el punt', async () => {
    const res = await appB.inject({ method: 'GET', url: '/.well-known/femho' });
    expect(res.statusCode).toBe(200);
  });
});

describe('el bescanvi', () => {
  it("d'un convit federat dona un token, sense demanar cap sessió", async () => {
    const { token } = await emetConvit('scope_federation', scopeB);

    const res = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token, instance_name: 'Casa Arnau', user_name: 'Arnau' },
    });
    expect(res.statusCode, res.body).toBe(200);

    const result = res.json<{ token: string; scope_id: string; scope_name: string }>();
    expect(result.scope_id).toBe(scopeB);
    expect(result.scope_name).toBe('Casa');
    expect(result.token).toMatch(/^femho_pat_/u);

    // L'usuari ombra existeix i **no s'hi pot entrar per la porta de davant**.
    const ombra = await sql<{ email: string | null; password_hash: string | null; kind: string }>`
      SELECT u.email, u.password_hash, u.kind FROM users u
      JOIN scope_members m ON m.user_id = u.id
      WHERE m.scope_id = ${scopeB} AND u.kind = 'remote'
    `.execute(connB.db);
    expect(ombra.rows[0]).toMatchObject({ email: null, password_hash: null, kind: 'remote' });
  });

  /**
   * **El token només val per a l'àmbit que s'ha compartit.** És el que fa que federar un
   * àmbit no sigui obrir la casa sencera, i passa pel camí de sempre —`scope_ids` del
   * registre del token, regla 9— sense cap branca nova.
   */
  it('i el token que en surt només veu aquell àmbit', async () => {
    const { token } = await emetConvit('scope_federation', scopeB);
    const redeemed = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token },
    });
    const remot = {
      authorization: `Bearer ${redeemed.json<{ token: string }>().token}`,
    };

    const scopes = await appB.inject({ method: 'GET', url: '/api/v1/scopes', headers: remot });
    const vistos = scopes.json<{ id: string }[]>().map((s) => s.id);
    expect(vistos).toEqual([scopeB]);
    expect(vistos).not.toContain(scopeAltreB);
  });

  it('i no pot tocar la configuració, només el contingut', async () => {
    const { token } = await emetConvit('scope_federation', scopeB);
    const redeemed = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token },
    });
    const remot = {
      authorization: `Bearer ${redeemed.json<{ token: string }>().token}`,
    };

    const escriu = await appB.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: remot,
      payload: { scope_id: scopeB, title: "D'una altra casa" },
    });
    expect(escriu.statusCode, escriu.body).toBe(201);

    const mana = await appB.inject({
      method: 'PATCH',
      url: `/api/v1/scopes/${scopeB}`,
      headers: remot,
      payload: { name: 'Meu ara' },
    });
    expect(mana.statusCode).toBe(403);
  });

  /**
   * **Un convit de persona no serveix per federar.** Deixar-lo servir donaria una
   * credencial de servidor —de llarga vida i sense cara— a qui només se li havia obert
   * una porta de convidat.
   */
  it("d'un convit que no és federat es rebutja", async () => {
    const { token } = await emetConvit('scope_invite', scopeB);
    const res = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token },
    });
    expect(res.statusCode).toBe(404);
  });

  /** `docs/10` §4: un d'inventat i un de revocat responen igual. */
  it('i un token inventat respon igual que un de revocat', async () => {
    const inventat = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token: 'femho_inv_aixonoexisteixdecapmanera' },
    });

    const { grant, token } = await emetConvit('scope_federation', scopeB);
    await sql`UPDATE grants SET revoked_at = ${NOW} WHERE id = ${grant.id}`.execute(connB.db);
    const revocat = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token },
    });

    expect(inventat.statusCode).toBe(revocat.statusCode);
    expect(inventat.json()).toEqual(revocat.json());
  });
});

describe('la rèplica', () => {
  it("porta les tasques de l'altra casa a l'àmbit espill", async () => {
    // B comparteix, A n'obté el token, i A el desa com un enllaç.
    const { token } = await emetConvit('scope_federation', scopeB);
    const redeemed = await appB.inject({
      method: 'POST',
      url: '/api/v1/federation/redeem',
      payload: { token, instance_name: 'Casa Arnau' },
    });
    const remoteToken = redeemed.json<{ token: string }>().token;

    // Una tasca a la casa B, feta per la porta de sempre perquè entri al `change_log`.
    const creada = await appB.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: authB,
      payload: { scope_id: scopeB, title: 'Comprar el pa' },
    });
    expect(creada.statusCode).toBe(201);

    // I una a l'àmbit que NO s'ha compartit, que no ha de creuar mai.
    await appB.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: authB,
      payload: { scope_id: scopeAltreB, title: 'La nòmina' },
    });

    const linkId = uuidv7();
    await sql`
      INSERT INTO instance_links (id, scope_id, base_url, name, token_enc, cursor,
                                  created_at, updated_at)
      VALUES (${linkId}, ${scopeMirall}, ${baseB}, 'Casa Berta',
              ${seal(SECRET_A, `link:${linkId}`, remoteToken)}, ${null}, ${NOW}, ${NOW})
    `.execute(connA.db);

    const link = await sql<never>`SELECT * FROM instance_links WHERE id = ${linkId}`.execute(
      connA.db,
    );

    const result = await pullFromLink(
      connA.db,
      link.rows[0] as never,
      SECRET_A,
      NOW,
      permetLoopback,
    );
    expect(result.applied).toBeGreaterThan(0);

    const aqui = await sql<{ title: string; scope_id: string }>`
      SELECT title, scope_id FROM tasks
    `.execute(connA.db);
    const titols = aqui.rows.map((r) => r.title);

    expect(titols).toContain('Comprar el pa');
    // **L'altra instància ja ha fet el tall**: el que no es comparteix no arriba.
    expect(titols).not.toContain('La nòmina');
    // I el que arriba viu a l'àmbit espill, no al de la casa d'origen.
    expect(aqui.rows.every((r) => r.scope_id === scopeMirall)).toBe(true);
  });

  it('i el cursor avança, perquè el proper tic no ho torni a baixar tot', async () => {
    const abans = await sql<{ cursor: string | null }>`
      SELECT cursor FROM instance_links
    `.execute(connA.db);
    expect(abans.rows[0]?.cursor).not.toBeNull();
  });
});

/**
 * El camí sencer, i és el que val la pena provar.
 *
 * L'exigència d'HTTPS viu a la ruta, que és on arriba el que escriu l'usuari; el servei
 * treballa amb l'adreça ja normalitzada i surt igualment per `safeFetch`. Això permet
 * muntar la casa B de debò a loopback i recórrer el camí de veritat —manifest, bescanvi,
 * enllaç, rèplica— en comptes d'una imitació seva.
 */
describe("enllaçar-se amb l'altra casa", () => {
  let linkId = '';

  it('crea un àmbit espill i deixa rastre', async () => {
    const { token } = await emetConvit('scope_federation', scopeB);

    const result = await auditedTransaction(connA.db, ownerA(), (ctx) =>
      linkInstance(ctx, ownerA(), { base_url: baseB, token }, SECRET_A, permetLoopback),
    );
    linkId = result.link.id;

    expect(result.link.base_url).toBe(baseB);
    // El nom surt del manifest de l'altra banda, que és qui sap com es diu.
    expect(result.link.name).toBe('Casa Berta');
    // El secret **no** surt de la base.
    expect(Object.keys(result.link)).not.toContain('token_enc');

    const espill = await sql<{ name: string; kind: string }>`
      SELECT name, kind FROM scopes WHERE id = ${result.scope_id}
    `.execute(connA.db);
    expect(espill.rows[0]).toMatchObject({ name: 'Casa', kind: 'collective' });

    const rastre = await sql<{ verb: string }>`
      SELECT verb FROM activity_log WHERE entity_id = ${result.scope_id}
    `.execute(connA.db);
    expect(rastre.rows.map((r) => r.verb)).toContain('shared');
  });

  it("i replicant-lo hi arriba el que hi ha a l'altra banda", async () => {
    await appB.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: authB,
      payload: { scope_id: scopeB, title: 'Regar les plantes' },
    });

    const link = await sql<never>`SELECT * FROM instance_links WHERE id = ${linkId}`.execute(
      connA.db,
    );
    await pullFromLink(connA.db, link.rows[0] as never, SECRET_A, NOW, permetLoopback);

    const aqui = await sql<{ title: string }>`SELECT title FROM tasks`.execute(connA.db);
    expect(aqui.rows.map((r) => r.title)).toContain('Regar les plantes');
  });

  /**
   * **L'autoria replicada té una sola cara per instància**, no una per persona. Aquesta
   * banda no sap qui són les de l'altra casa i no li'n toca portar la llibreta.
   */
  it("i el que arriba porta el nom de l'altra casa, no el de ningú d'aquí", async () => {
    const autors = await sql<{ name: string; kind: string }>`
      SELECT u.name, u.kind FROM tasks t JOIN users u ON u.id = t.created_by
      WHERE t.title = 'Regar les plantes'
    `.execute(connA.db);
    expect(autors.rows[0]).toMatchObject({ name: 'Casa Berta', kind: 'remote' });
  });

  it("desenllaçar deixa l'àmbit espill i es perd el token", async () => {
    const abans = await sql<{ scope_id: string }>`
      SELECT scope_id FROM instance_links WHERE id = ${linkId}
    `.execute(connA.db);
    const scopeEspill = abans.rows[0]!.scope_id;

    await auditedTransaction(connA.db, ownerA(), (ctx) => unlinkInstance(ctx, ownerA(), linkId));

    const enllacos = await sql<{ id: string }>`
      SELECT id FROM instance_links WHERE id = ${linkId}
    `.execute(connA.db);
    expect(enllacos.rows).toHaveLength(0);

    // L'àmbit es queda: esborrar-lo s'enduria el que hi hagi passat sense avisar.
    const espill = await sql<{ id: string }>`
      SELECT id FROM scopes WHERE id = ${scopeEspill} AND deleted_at IS NULL
    `.execute(connA.db);
    expect(espill.rows).toHaveLength(1);

    const rastre = await sql<{ verb: string }>`
      SELECT verb FROM activity_log WHERE entity_id = ${scopeEspill}
    `.execute(connA.db);
    expect(rastre.rows.map((r) => r.verb)).toContain('revoked');
  });
});

/**
 * **La rèplica va en tots dos sentits.**
 *
 * Sense la pujada, federar seria mirar el tauler d'algú altre. El que es va demanar és
 * que se sincronitzi tot: qui rep un àmbit hi ha de poder col·laborar.
 */
describe('la pujada', () => {
  it("porta cap a l'altra casa el que s'escriu a l'àmbit espill", async () => {
    const { token } = await emetConvit('scope_federation', scopeB);
    const enllac = await auditedTransaction(connA.db, ownerA(), (ctx) =>
      linkInstance(ctx, ownerA(), { base_url: baseB, token }, SECRET_A, permetLoopback),
    );

    // Una tasca escrita a la casa A, dins de l'àmbit espill.
    const meva = await appA.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@e.com', password: PASSWORD },
    });
    const authA = {
      authorization: `Bearer ${meva.json<{ access_token: string }>().access_token}`,
    };
    const creada = await appA.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: authA,
      payload: { scope_id: enllac.scope_id, title: 'Portar el cotxe al taller' },
    });
    expect(creada.statusCode, creada.body).toBe(201);

    const link = await sql<never>`
      SELECT * FROM instance_links WHERE id = ${enllac.link.id}
    `.execute(connA.db);
    const result = await pullFromLink(
      connA.db,
      link.rows[0] as never,
      SECRET_A,
      NOW,
      permetLoopback,
    );
    expect(result.pushed).toBeGreaterThan(0);

    // I ha arribat a l'àmbit de l'altra banda, no a cap altre.
    const alla = await sql<{ title: string; scope_id: string }>`
      SELECT title, scope_id FROM tasks WHERE title = 'Portar el cotxe al taller'
    `.execute(connB.db);
    expect(alla.rows[0]?.scope_id).toBe(scopeB);
  });

  /**
   * **El que ve de fora no torna a sortir.** Sense aquesta parada, cada tic reenviaria a
   * la casa B el que la casa B ens acaba d'enviar, i les dues instàncies es passarien la
   * mateixa tasca per sempre.
   */
  it('i el que ha arribat de fora no hi torna, que seria un bucle', async () => {
    const enllacos = await sql<{ id: string; local_seq: number }>`
      SELECT id, local_seq FROM instance_links ORDER BY created_at DESC
    `.execute(connA.db);
    const linkId = enllacos.rows[0]!.id;

    const link = await sql<never>`SELECT * FROM instance_links WHERE id = ${linkId}`.execute(
      connA.db,
    );
    const segon = await pullFromLink(
      connA.db,
      link.rows[0] as never,
      SECRET_A,
      NOW,
      permetLoopback,
    );

    // Res de nou per pujar: el que hi ha a l'espill o ja ha pujat, o ve d'ells.
    expect(segon.pushed).toBe(0);
  });
});
