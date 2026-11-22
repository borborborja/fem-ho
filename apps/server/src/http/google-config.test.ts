import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { loadConfig } from '../config.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { connectTestSchema, type TestSchema } from '../db/test-postgres.js';
import { resolveGoogleConfig } from '../services/google-config.js';

const path = '/api/v1/admin/oauth/google';
const dataDir = mkdtempSync(join(tmpdir(), 'femho-google-config-'));
const instanceSecret = 'google-config-test-instance-secret';
const savedSecret = 'google-client-secret-stored';
const password = 'test-login-password';
const config = {
  ...loadConfig('test'),
  baseUrl: 'https://femho.example.test',
  googleClientId: undefined,
  googleClientSecret: undefined,
  logLevel: 'silent',
};

let connection: Connection;
let pgSchema: TestSchema | undefined;
let app: FastifyInstance;
let admin: { authorization: string };
let member: { authorization: string };
let adminId: string;

beforeAll(async () => {
  const url = process.env.FEMHO_TEST_POSTGRES_URL;
  pgSchema = url ? await connectTestSchema(url, 'google_config') : undefined;
  connection = pgSchema ?? connect(`sqlite://${join(dataDir, 'test.db')}`);
  await migrateToLatest(connection.db, { engine: connection.engine });
  app = buildApp(config, { connection, secret: instanceSecret });
  const hashed = await hashPassword(password);
  const now = new Date().toISOString();
  const login = async (role: 'admin' | 'member') => {
    const id = uuidv7();
    const email = `${role}@example.test`;
    if (role === 'admin') adminId = id;
    await sql`INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${id}, ${email}, ${role}, ${hashed}, 'human', ${role}, ${now}, ${now})`.execute(
      connection.db,
    );
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(result.statusCode, result.body).toBe(200);
    return { authorization: `Bearer ${result.json<{ access_token: string }>().access_token}` };
  };
  admin = await login('admin');
  member = await login('member');
});

beforeEach(async () => {
  await sql`DELETE FROM instance_settings WHERE key = 'google_oauth'`.execute(connection.db);
  await sql`DELETE FROM activity_log WHERE entity_id = 'google_oauth'`.execute(connection.db);
});

afterAll(async () => {
  await app?.close();
  if (pgSchema) await pgSchema.drop();
  else await connection?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const credentials = { client_id: 'google-client', client_secret: savedSecret };
function save(payload: Record<string, unknown> = credentials, target = app) {
  return target.inject({ method: 'PUT', url: path, headers: admin, payload });
}

it('reserva la configuració a una sessió de l’administrador', async () => {
  expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(401);
  expect((await app.inject({ method: 'GET', url: path, headers: member })).statusCode).toBe(403);
  expect(
    (await app.inject({ method: 'PUT', url: path, headers: member, payload: credentials }))
      .statusCode,
  ).toBe(403);
  expect((await app.inject({ method: 'DELETE', url: path, headers: member })).statusCode).toBe(403);
});

it('desa el secret xifrat, aplica la configuració en calent i audita el canvi sense credencials', async () => {
  expect((await app.inject({ method: 'GET', url: path, headers: admin })).json()).toMatchObject({
    source: 'none',
    enabled: false,
    has_secret: false,
  });
  expect((await save({ client_id: credentials.client_id })).statusCode).toBe(422);

  const updated = await save();
  expect(updated.statusCode, updated.body).toBe(200);
  expect(updated.headers['cache-control']).toBe('no-store');
  expect(updated.body).not.toContain(savedSecret);
  expect(updated.json()).toEqual({
    source: 'settings',
    enabled: true,
    client_id: credentials.client_id,
    has_secret: true,
    reason: null,
    gmail_callback_url: 'https://femho.example.test/api/v1/mail/oauth/google/callback',
    calendar_callback_url: 'https://femho.example.test/api/v1/calendars/google/oauth/callback',
  });
  const stored = (
    await sql<{
      value: string;
    }>`SELECT value FROM instance_settings WHERE key = 'google_oauth'`.execute(connection.db)
  ).rows[0];
  expect(stored?.value).not.toContain(savedSecret);
  expect(await resolveGoogleConfig(connection.db, instanceSecret, config)).toMatchObject({
    googleClientSecret: savedSecret,
    enabled: true,
  });
  const memberAvailability = await app.inject({
    method: 'GET',
    url: '/api/v1/mail/oauth/google',
    headers: member,
  });
  expect(memberAvailability.json()).toMatchObject({ enabled: true });
  expect(memberAvailability.body).not.toContain(savedSecret);
  expect(memberAvailability.body).not.toContain(credentials.client_id);

  expect((await save({ client_id: credentials.client_id })).statusCode).toBe(200);
  expect((await save({ client_id: 'different-client' })).statusCode).toBe(422);
  expect((await save({ ...credentials, client_secret: 'replacement-secret' })).statusCode).toBe(
    200,
  );
  expect(
    (await resolveGoogleConfig(connection.db, instanceSecret, config)).googleClientSecret,
  ).toBe('replacement-secret');

  const disabled = await app.inject({ method: 'DELETE', url: path, headers: admin });
  expect(disabled.json()).toMatchObject({ source: 'none', enabled: false, has_secret: false });
  expect((await app.inject({ method: 'DELETE', url: path, headers: admin })).statusCode).toBe(200);
  const entries = await sql<{ verb: string; changes: string | null; actor_user_id: string }>`
    SELECT verb, changes, actor_user_id FROM activity_log WHERE entity_id = 'google_oauth'
  `.execute(connection.db);
  expect(entries.rows).toHaveLength(3);
  expect(entries.rows).toEqual(
    expect.arrayContaining(
      ['created', 'updated', 'deleted'].map((verb) => ({
        verb,
        changes: null,
        actor_user_id: adminId,
      })),
    ),
  );
});

it('un entorn incomplet també bloqueja el formulari i no barreja els dos orígens', async () => {
  expect((await save()).statusCode).toBe(200);
  const partial = { ...config, googleClientId: 'deployment-client' };
  const fixed = buildApp(partial, { connection, secret: instanceSecret });
  try {
    const response = await fixed.inject({ method: 'GET', url: path, headers: admin });
    expect(response.json()).toMatchObject({
      source: 'environment',
      enabled: false,
      client_id: partial.googleClientId,
      has_secret: false,
      reason: 'missing_credentials',
    });
    expect((await save(credentials, fixed)).statusCode).toBe(409);
    expect((await fixed.inject({ method: 'DELETE', url: path, headers: admin })).statusCode).toBe(
      409,
    );
    expect(await resolveGoogleConfig(connection.db, instanceSecret, partial)).toMatchObject({
      googleClientSecret: undefined,
      enabled: false,
    });
  } finally {
    await fixed.close();
  }

  const deploymentSecret = 'google-env-client-secret';
  expect(
    await resolveGoogleConfig(connection.db, instanceSecret, {
      ...partial,
      googleClientSecret: deploymentSecret,
    }),
  ).toMatchObject({ source: 'environment', enabled: true, googleClientSecret: deploymentSecret });
  expect(
    (await resolveGoogleConfig(connection.db, instanceSecret, config)).googleClientSecret,
  ).toBe(savedSecret);
});

it('diu quan manca l’URL de retorn o quan s’ha perdut el secret de la instància', async () => {
  expect((await save()).statusCode).toBe(200);
  expect(
    await resolveGoogleConfig(connection.db, instanceSecret, { ...config, baseUrl: undefined }),
  ).toMatchObject({
    enabled: false,
    reason: 'invalid_base_url',
  });
  expect(
    await resolveGoogleConfig(connection.db, 'another-test-instance-secret-here', config),
  ).toMatchObject({
    enabled: false,
    reason: 'unreadable_credentials',
  });
});
