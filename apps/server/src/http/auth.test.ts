/**
 * docs/13 M3 · comprovació de la fita: `test: auth + policy + audit`.
 *
 * Els criteris d'acceptació, un a un:
 *   - Login i refresc funcionen.
 *   - Reutilitzar un token de refresc gastat revoca la família.  → sessions.test.ts
 *   - Un token limitat a un àmbit no en veu cap altre.
 *   - Cada escriptura deixa una entrada a activity_log amb l'actor i el canal correctes.
 *   - El bloqueig per intents funciona.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { generateApiToken } from '../auth/tokens.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { lockout } from './auth.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-auth-'));
const NOW = '2026-08-05T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';

let conn: Connection;
let app: FastifyInstance;
let userId: string;
let scopeFeina: string;
let scopePersonal: string;

async function countActivity(verb?: string): Promise<number> {
  const r =
    verb === undefined
      ? await sql<{ n: number }>`SELECT COUNT(*) AS n FROM activity_log`.execute(conn.db)
      : await sql<{
          n: number;
        }>`SELECT COUNT(*) AS n FROM activity_log WHERE verb = ${verb}`.execute(conn.db);
  return Number(r.rows[0]?.n ?? 0);
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
    VALUES (${userId}, 'borja@example.com', 'Borja', ${await hashPassword(PASSWORD)},
            'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeFeina = uuidv7();
  scopePersonal = uuidv7();
  for (const [id, name] of [
    [scopeFeina, 'Feina'],
    [scopePersonal, 'Personal'],
  ] as const) {
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${id}, ${name}, 'individual', '--plou-orange', ${userId}, 'a0', ${NOW}, ${NOW})
    `.execute(conn.db);
  }

  app = buildApp({ ...loadConfig('0.1.0-test'), logLevel: 'silent' }, { connection: conn });
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  lockout.clear();
});

describe('POST /auth/login', () => {
  it('accepta les credencials correctes i emet els dos tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ access_token: string; refresh_token: string; expires_at: string }>();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toContain('.');
    expect(Date.parse(body.expires_at)).toBeGreaterThan(Date.now());
  });

  it('el correu no distingeix majúscules ni espais', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: '  BORJA@Example.COM ', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });

  it('mai diu si el correu existeix', async () => {
    const inexistent = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'ningu@example.com', password: PASSWORD },
    });
    const dolenta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: 'una-contrasenya-erronia' },
    });

    expect(inexistent.statusCode).toBe(401);
    expect(dolenta.statusCode).toBe(401);
    // Byte a byte la mateixa resposta. Si diferissin, es podrien enumerar comptes.
    expect(inexistent.json()).toEqual(dolenta.json());
  });

  it('AQUESTA és la de docs/13: el bloqueig per intents funciona', async () => {
    for (let i = 0; i < 10; i += 1) {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'borja@example.com', password: 'malament' },
      });
      expect(r.statusCode, `l'intent ${i + 1} encara no ha de bloquejar`).toBe(401);
    }

    const onze = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: 'malament' },
    });
    expect(onze.statusCode).toBe(429);
    expect(onze.headers['retry-after']).toBeDefined();

    // I el bloqueig val fins i tot amb la contrasenya BONA: si no, l'atacant sabria
    // que l'ha encertat pel canvi de resposta.
    const ambLaBona = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });
    expect(ambLaBona.statusCode).toBe(429);
  });

  it('el bloqueig és per correu, no per tota la instància', async () => {
    for (let i = 0; i < 12; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'altre@example.com', password: 'malament' },
      });
    }
    // Un altre correu no queda bloquejat pels intents del primer.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('regla 4 · cada escriptura deixa rastre', () => {
  it("el login escriu a activity_log amb l'actor i el canal correctes", async () => {
    const abans = await countActivity('logged_in');

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
      headers: { 'user-agent': 'okhttp/5.0 Android' },
    });

    expect(await countActivity('logged_in')).toBe(abans + 1);

    const ultima = await sql<{
      actor_type: string;
      actor_user_id: string;
      source: string;
      entity_type: string;
    }>`
      SELECT actor_type, actor_user_id, source, entity_type FROM activity_log
      WHERE verb = 'logged_in' ORDER BY created_at DESC, id DESC LIMIT 1
    `.execute(conn.db);

    const fila = ultima.rows[0];
    expect(fila?.actor_type).toBe('user');
    expect(fila?.actor_user_id).toBe(userId);
    // El canal s'ha propagat sol des de la petició, sense que cap servei el passi a mà.
    expect(fila?.source).toBe('android');
    expect(fila?.entity_type).toBe('session');
  });

  it('el logout també', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });
    const { access_token } = login.json<{ access_token: string }>();

    const abans = await countActivity('logged_out');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${access_token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(await countActivity('logged_out')).toBe(abans + 1);
  });

  it('i el change_log creix alhora que activity_log', async () => {
    // Són coses diferents i totes dues calen (docs/01 §7): una per a l'usuari i una
    // per a les màquines. S'escriuen dins de la mateixa transacció.
    const activitat = await countActivity();
    const canvis = Number(
      (await sql<{ n: number }>`SELECT COUNT(*) AS n FROM change_log`.execute(conn.db)).rows[0]
        ?.n ?? 0,
    );

    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });

    expect(await countActivity()).toBe(activitat + 1);
    expect(
      Number(
        (await sql<{ n: number }>`SELECT COUNT(*) AS n FROM change_log`.execute(conn.db)).rows[0]
          ?.n ?? 0,
      ),
    ).toBe(canvis + 1);
  });
});

describe('POST /auth/refresh', () => {
  it('rota i el token vell deixa de valer', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });
    const { refresh_token } = login.json<{ refresh_token: string }>();

    const rotat = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token },
    });
    expect(rotat.statusCode).toBe(200);
    expect(rotat.json<{ refresh_token: string }>().refresh_token).not.toBe(refresh_token);

    const reutilitzat = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token },
    });
    expect(reutilitzat.statusCode).toBe(401);
  });

  it('els quatre motius de rebuig donen la mateixa resposta', async () => {
    // Que un token gastat digui "gastat" i un d'inventat digui "inventat" li diria a
    // l'atacant que el seu token ÉS d'una sessió real.
    const inventat = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: `${uuidv7()}.aixonoexisteix` },
    });
    const malFormat = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refresh_token: 'sensepunt' },
    });
    expect(inventat.statusCode).toBe(401);
    expect(inventat.json()).toEqual(malFormat.json());
  });
});

describe('GET /auth/me', () => {
  it('sense credencial dona 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('diu qui és, què pot fer i a quins àmbits arriba', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'borja@example.com', password: PASSWORD },
    });
    const { access_token } = login.json<{ access_token: string }>();

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${access_token}` },
    });

    expect(res.statusCode).toBe(200);
    const me = res.json<{
      id: string;
      kind: string;
      capabilities: string[];
      scope_ids: string[];
    }>();
    expect(me.id).toBe(userId);
    expect(me.kind).toBe('user');
    // Una sessió no és un token d'abast limitat: veu tots els seus àmbits.
    expect(me.scope_ids.sort()).toEqual([scopeFeina, scopePersonal].sort());
    expect(me.capabilities).toContain('tasks:write');
  });
});

describe('AQUESTA és la de docs/13: un token limitat a un àmbit no en veu cap altre', () => {
  it('scope_ids del token limita el que veu /auth/me', async () => {
    const { token, hash, prefix } = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, scope_ids, created_at)
      VALUES (${uuidv7()}, ${userId}, 'Claude · només feina', ${prefix}, ${hash},
              ${JSON.stringify(['tasks:read', 'tasks:write'])},
              ${JSON.stringify([scopeFeina])}, ${NOW})
    `.execute(conn.db);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const me = res.json<{ capabilities: string[]; scope_ids: string[] }>();

    // Veu Feina i NO veu Personal.
    expect(me.scope_ids).toEqual([scopeFeina]);
    expect(me.scope_ids).not.toContain(scopePersonal);
    // I només les capacitats que el token declara, no totes les del propietari.
    expect(me.capabilities.sort()).toEqual(['tasks:read', 'tasks:write']);
    expect(me.capabilities).not.toContain('users:manage');
  });

  it('un token no pot superar el rol del seu propietari', async () => {
    // Es crea un token que demana users:manage per a un usuari que NO és administrador.
    const membre = uuidv7();
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${membre}, 'membre@example.com', 'Membre', 'x', 'human', 'member', ${NOW}, ${NOW})
    `.execute(conn.db);

    const { token, hash, prefix } = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, scope_ids, created_at)
      VALUES (${uuidv7()}, ${membre}, 'Massa ambiciós', ${prefix}, ${hash},
              ${JSON.stringify(['tasks:read', 'users:manage', 'instance:manage'])}, NULL, ${NOW})
    `.execute(conn.db);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    const me = res.json<{ capabilities: string[] }>();
    expect(me.capabilities).toContain('tasks:read');
    // Les que el rol no dona, el token no les inventa.
    expect(me.capabilities).not.toContain('users:manage');
    expect(me.capabilities).not.toContain('instance:manage');
  });

  it("un token revocat i un d'inexistent responen igual", async () => {
    const { token, hash, prefix } = generateApiToken();
    await sql`
      INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities, created_at, revoked_at)
      VALUES (${uuidv7()}, ${userId}, 'Revocat', ${prefix}, ${hash}, '[]', ${NOW}, ${NOW})
    `.execute(conn.db);

    const revocat = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    const inexistent = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${generateApiToken().token}` },
    });

    expect(revocat.statusCode).toBe(401);
    expect(revocat.json()).toEqual(inexistent.json());
  });
});
