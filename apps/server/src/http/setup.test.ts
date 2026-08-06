/**
 * docs/13 M14 · el primer arrencament.
 *
 * `GET /setup` **és una pàgina** (docs/12 §3: "mostra un formulari per crear el primer
 * administrador"): la serveix l'app web. L'estat de la porta, en JSON, és
 * `GET /api/v1/setup`. Amb les dues coses al mateix camí, obrir-lo al navegador donava
 * el JSON i no el formulari.
 *
 * El que decideix aquesta peça: que `/setup` **es tanqui per sempre**. Una ruta que crea
 * administradors i es pot reobrir des d'internet no és una porta.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { INITIAL_SCOPES } from '../services/setup.js';

let tmp: string;
let conn: Connection;
let app: FastifyInstance;

const ADMIN = {
  email: 'Borja@Example.com',
  name: 'Borja',
  password: 'la-contrasenya-de-la-borja',
};

async function setup(payload: Record<string, unknown> = ADMIN) {
  return app.inject({ method: 'POST', url: '/setup', payload });
}

beforeEach(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  tmp = mkdtempSync(join(tmpdir(), 'femho-setup-'));
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent', dataDir: tmp },
    {
      connection: conn,
      secret: 'el-secret-de-la-instancia-prou-llarg',
    },
  );
});

afterEach(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('amb la base buida', () => {
  it('diu que està obert, i sense demanar credencials', async () => {
    // La interfície l'ha de poder consultar abans que existeixi cap usuari.
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ open: boolean }>().open).toBe(true);
  });

  it("crea l'administrador i els seus tres àmbits", async () => {
    const res = await setup();
    expect(res.statusCode).toBe(201);

    const cos = res.json<{ user_id: string; scope_ids: string[]; setup_closed: boolean }>();
    expect(cos.scope_ids).toHaveLength(3);
    expect(cos.setup_closed).toBe(true);

    const scopes = await sql<{ name: string; color: string }>`
      SELECT name, color FROM scopes ORDER BY position
    `.execute(conn.db);
    expect(scopes.rows.map((s) => s.name)).toEqual(INITIAL_SCOPES.map((s) => s.name));
    // Els colors de la tríada, com a nom de token i no com a literal.
    for (const row of scopes.rows) expect(row.color).toMatch(/^--plou-/u);
  });

  it('els tres àmbits NO són especials: es poden esborrar', async () => {
    const res = await setup();
    const { scope_ids } = res.json<{ scope_ids: string[] }>();

    // No hi ha cap marca que els protegeixi: són un punt de partida, no estructura.
    const columnes = await sql<{ name: string }>`
      SELECT name FROM pragma_table_info('scopes')
    `.execute(conn.db);
    expect(columnes.rows.map((c) => c.name)).not.toContain('is_initial');

    await sql`UPDATE scopes SET deleted_at = '2026-08-06T00:00:00Z' WHERE id = ${scope_ids[0]!}`.execute(
      conn.db,
    );
    const vius = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM scopes WHERE deleted_at IS NULL
    `.execute(conn.db);
    expect(Number(vius.rows[0]?.n)).toBe(2);
  });

  it('el correu es normalitza a minúscules', async () => {
    await setup();
    // `kind = 'human'`: la migració 004 sembra la fila d'usuari de la IA (D5), que hi és
    // sempre i no compta com a compte de ningú.
    const fila = await sql<{ email: string }>`
      SELECT email FROM users WHERE kind = 'human'
    `.execute(conn.db);
    expect(fila.rows[0]?.email).toBe('borja@example.com');
  });

  it('la contrasenya no es guarda en clar', async () => {
    await setup();
    const fila = await sql<{ password_hash: string }>`
      SELECT password_hash FROM users WHERE kind = 'human'
    `.execute(conn.db);
    expect(fila.rows[0]?.password_hash).not.toContain(ADMIN.password);
    expect(fila.rows[0]?.password_hash).toMatch(/^\$argon2id\$/u);
  });
});

describe('AQUESTA és la que compta: la porta es tanca', () => {
  it('un segon intent és 403', async () => {
    expect((await setup()).statusCode).toBe(201);

    const segon = await setup({ ...ADMIN, email: 'altre@example.com' });
    expect(segon.statusCode).toBe(403);

    const usuaris = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM users WHERE kind = 'human'`.execute(conn.db);
    expect(Number(usuaris.rows[0]?.n)).toBe(1);
  });

  it('i el GET ja diu que està tancat', async () => {
    await setup();
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(res.json<{ open: boolean }>().open).toBe(false);
  });

  it("NO es reobre esborrant l'administrador", async () => {
    await setup();
    await sql`UPDATE users SET deleted_at = '2026-08-06T00:00:00Z'`.execute(conn.db);

    // Si es reobrís, qualsevol que arribés abans que l'administrador tornés a entrar es
    // faria administrador ell.
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(res.json<{ open: boolean }>().open).toBe(false);
    expect((await setup({ ...ADMIN, email: 'oportunista@example.com' })).statusCode).toBe(403);
  });

  it('ni esborrant la fila del tot', async () => {
    await setup();

    // Cirurgia directa a la base, en ordre de dependència: les claus foranes no deixen
    // esborrar l'usuari mentre els seus àmbits hi apunten, i això ja és una protecció.
    await sql`DELETE FROM scopes`.execute(conn.db);
    await sql`DELETE FROM users WHERE kind = 'human'`.execute(conn.db);

    const usuaris = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM users WHERE kind = 'human'`.execute(conn.db);
    expect(Number(usuaris.rows[0]?.n)).toBe(0);

    // I tot i així: el rastre queda a `activity_log` encara que la fila desaparegui.
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(res.json<{ open: boolean }>().open).toBe(false);
  });

  it('dues peticions simultànies no creen dos administradors', async () => {
    // La comprovació és DINS de la transacció: entre una de fora i la creació hi cabria
    // una segona petició.
    const [a, b] = await Promise.all([setup(), setup({ ...ADMIN, email: 'segon@example.com' })]);

    const codis = [a.statusCode, b.statusCode].sort();
    expect(codis).toEqual([201, 403]);

    const usuaris = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM users WHERE kind = 'human'`.execute(conn.db);
    expect(Number(usuaris.rows[0]?.n)).toBe(1);
  });
});

describe('validació', () => {
  it('un correu que no ho és es rebutja', async () => {
    expect((await setup({ ...ADMIN, email: 'no-soc-un-correu' })).statusCode).toBe(422);
  });

  it('sense nom també', async () => {
    expect((await setup({ ...ADMIN, name: '  ' })).statusCode).toBe(422);
  });

  it('una contrasenya fluixa també, i el setup segueix obert', async () => {
    expect((await setup({ ...ADMIN, password: 'curta' })).statusCode).toBe(422);

    // Un intent fallit no ha de tancar la porta: seria deixar la instància inservible.
    const res = await app.inject({ method: 'GET', url: '/api/v1/setup' });
    expect(res.json<{ open: boolean }>().open).toBe(true);
  });
});
