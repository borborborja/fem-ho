/**
 * `GET /api/v1/ai/status`.
 *
 * Dues coses, i la segona és la que importa de debò: **la clau no surt mai**, i la frase
 * que es dona és honesta —«configurada» vol dir que hi ha credencials, no que res les faci
 * servir encara (P10).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-ai-status-'));
const NOW = '2026-08-11T10:00:00.000Z';
const PASSWORD = 'la-contrasenya-de-la-borja';
const CLAU = 'sk-una-clau-que-no-ha-de-sortir-mai';

let conn: Connection;
let app: FastifyInstance;
let auth: { authorization: string };

interface Status {
  configured: boolean;
  provider: string;
  model: string | null;
  base_url_host: string | null;
  warnings: string[];
}

beforeAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }

  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  const userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'ai@example.com', 'Borja', ${await hashPassword(PASSWORD)}, 'human',
            'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  // Una instància **amb** proveïdor configurat: és l'únic cas on hi ha res a filtrar.
  process.env.FEMHO_AI_PROVIDER = 'openrouter';
  process.env.FEMHO_AI_API_KEY = CLAU;
  process.env.FEMHO_AI_MODEL = 'anthropic/claude-sonnet-4';
  process.env.FEMHO_AI_BASE_URL = 'https://openrouter.ai/api/v1?token=un-altre-secret';

  app = buildApp(
    { ...loadConfig('0.1.0-test'), logLevel: 'silent' },
    { connection: conn, secret: 'x'.repeat(40) },
  );

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'ai@example.com', password: PASSWORD },
  });
  auth = { authorization: `Bearer ${login.json<{ access_token: string }>().access_token}` };
});

afterAll(async () => {
  await app.close();
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEMHO_')) delete process.env[key];
  }
});

describe("l'estat del terreny d'IA", () => {
  it('diu que hi ha credencials i quin model', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth });
    const cos = res.json<Status>();

    expect(cos.configured).toBe(true);
    expect(cos.provider).toBe('openrouter');
    expect(cos.model).toBe('anthropic/claude-sonnet-4');
  });

  it('la clau no surt, ni emmascarada', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth });
    const cru = res.body;

    /**
     * Es mira **el cos sencer en cru**: comprovar els camps que ja coneixem no veuria un
     * camp nou que la portés. I tampoc un prefix: una màscara filtra la longitud i el
     * principi, que és exactament el que serveix per confirmar una clau robada.
     */
    expect(cru).not.toContain(CLAU);
    expect(cru).not.toContain('sk-una');
    expect(cru).not.toContain('api_key');
  });

  it("i de l'URL només l'amfitrió", async () => {
    // Una URL pot portar un testimoni a la cadena de consulta, i d'aquí aniria a la
    // pantalla, als registres i a una captura de pantalla en un xat de suport.
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth });
    expect(res.json<Status>().base_url_host).toBe('openrouter.ai');
    expect(res.body).not.toContain('un-altre-secret');
  });

  it('i avisa que encara no hi ha res que les faci servir', async () => {
    /**
     * **La frase honesta.** Sense això, algú configuraria el proveïdor, esperaria un
     * comportament que no arribarà, i ho llegiria com una avaria del producte.
     */
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status', headers: auth });
    expect(res.json<Status>().warnings).toContain('ai.status.configuredButUnused');
  });

  it('i sense sessió no es contesta res', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ai/status' });
    expect(res.statusCode).toBe(401);
  });
});
