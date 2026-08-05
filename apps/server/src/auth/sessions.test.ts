/**
 * docs/13 M3 · criteri d'acceptació: "reutilitzar un token de refresc gastat revoca la
 * família".
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { createSession, revokeAllSessionsOf, rotateRefreshToken } from './sessions.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-sessions-'));
let conn: Connection;
let userId: string;

const NOW = '2026-08-05T10:00:00.000Z';

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, kind, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', 'human', ${NOW}, ${NOW})
  `.execute(conn.db);
});

afterAll(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('refresc rotatiu', () => {
  it("un refresc emet un token nou i invalida l'anterior", async () => {
    const primera = await createSession(conn.db, userId, NOW);

    const rotacio = await rotateRefreshToken(conn.db, primera.refreshToken, NOW);
    expect(rotacio.ok).toBe(true);
    if (!rotacio.ok) return;

    expect(rotacio.session.refreshToken).not.toBe(primera.refreshToken);
    expect(rotacio.userId).toBe(userId);

    // El nou funciona.
    const segona = await rotateRefreshToken(conn.db, rotacio.session.refreshToken, NOW);
    expect(segona.ok).toBe(true);
  });

  it('AQUESTA és la de docs/13: reutilitzar un token gastat revoca la família', async () => {
    const inicial = await createSession(conn.db, userId, NOW);

    // Rotació normal. `inicial.refreshToken` queda gastat.
    const rotat = await rotateRefreshToken(conn.db, inicial.refreshToken, NOW);
    expect(rotat.ok).toBe(true);
    if (!rotat.ok) return;

    // Algú fa servir la còpia gastada. Pot ser l'atacant o pot ser la víctima; no se
    // sap quin dels dos, i per això es tanca la sessió per als dos.
    const reutilitzat = await rotateRefreshToken(conn.db, inicial.refreshToken, NOW);
    expect(reutilitzat.ok).toBe(false);
    if (reutilitzat.ok) return;
    expect(reutilitzat.reason).toBe('reused');
    expect(reutilitzat.revokedSessionId).toBe(inicial.sessionId);

    // I el token BO, el que tenia qui refrescava legítimament, ha deixat de valer.
    const desprès = await rotateRefreshToken(conn.db, rotat.session.refreshToken, NOW);
    expect(desprès.ok).toBe(false);
    if (desprès.ok) return;
    expect(desprès.reason).toBe('revoked');
  });

  it('un token inventat no fa res i no diu res', async () => {
    const resultat = await rotateRefreshToken(conn.db, `${uuidv7()}.inventatinventat`, NOW);
    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.reason).toBe('unknown');
  });

  it('un token mal format es rebutja sense consultar la base', async () => {
    for (const dolent of ['', 'sensepunt', '.comença-amb-punt', 'acaba-amb-punt.']) {
      const r = await rotateRefreshToken(conn.db, dolent, NOW);
      expect(r.ok, `"${dolent}" no hauria de valer`).toBe(false);
    }
  });

  it('un token caducat es rebutja', async () => {
    const sessio = await createSession(conn.db, userId, NOW);
    const molt_despres = '2027-01-01T00:00:00.000Z';
    const r = await rotateRefreshToken(conn.db, sessio.refreshToken, molt_despres);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('expired');
  });

  it('el secret no es guarda mai en clar', async () => {
    const sessio = await createSession(conn.db, userId, NOW);
    const files = await sql<{
      refresh_hash: string;
    }>`SELECT refresh_hash FROM sessions WHERE id = ${sessio.sessionId}`.execute(conn.db);

    const guardat = files.rows[0]?.refresh_hash ?? '';
    expect(guardat).not.toContain(sessio.refreshToken);
    expect(guardat).toMatch(/^[0-9a-f]{64}$/); // SHA-256 en hexadecimal
  });
});

describe('revocació', () => {
  it('tancar totes les sessions les revoca alhora', async () => {
    const a = await createSession(conn.db, userId, NOW);
    const b = await createSession(conn.db, userId, NOW);

    await revokeAllSessionsOf(conn.db, userId, NOW);

    for (const sessio of [a, b]) {
      const r = await rotateRefreshToken(conn.db, sessio.refreshToken, NOW);
      expect(r.ok).toBe(false);
    }
  });
});
