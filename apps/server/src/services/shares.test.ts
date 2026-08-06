/**
 * docs/13 M12 · `test: shares-security`.
 *
 * Les de `docs/10` §10 que toquen aquí:
 *
 *   2. **Enumeració**: un token inexistent i un de revocat donen la mateixa resposta.
 *   3. **Força bruta**: 6 intents de contrasenya fan saltar el bloqueig.
 *   5. **Escalada de convidat**: una sessió de convidat no serveix per a res més.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import { capabilitiesForRole } from '../policy/capabilities.js';
import type { Principal } from '../policy/principal.js';
import {
  MAX_PASSWORD_ATTEMPTS,
  MIN_SHARE_PASSWORD_LENGTH,
  createShare,
  generateShareToken,
  guestLabel,
  guestPrincipal,
  openShare,
  revokeShare,
  tokenHmac,
  type Share,
} from './shares.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-shares-'));
const NOW = '2026-08-06T09:00:00.000Z';
const PEPPER = 'el-pebre-de-la-instancia-prou-llarg';

let conn: Connection;
let userId: string;
let scopeId: string;
let taskId: string;
let principal: Principal;

async function write<T>(work: Parameters<typeof auditedTransaction<T>>[2], now = NOW): Promise<T> {
  return auditedTransaction(conn.db, principal, work, { engine: 'sqlite', now });
}

async function nouEnllac(
  input: Parameters<typeof createShare>[2] = {},
): Promise<{ token: string; share: Share }> {
  return write(async (ctx) => createShare(ctx, principal, { task_id: taskId, ...input }, PEPPER));
}

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, kind, role, created_at, updated_at)
    VALUES (${userId}, 'borja@example.com', 'Borja', 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);

  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-blue', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);

  taskId = uuidv7();
  await sql`
    INSERT INTO tasks (id, scope_id, title, status, position, created_by, created_at, updated_at)
    VALUES (${taskId}, ${scopeId}, 'Fer la maleta', 'todo', 'a1', ${userId}, ${NOW}, ${NOW})
  `.execute(conn.db);

  principal = {
    kind: 'user',
    userId,
    capabilities: new Set(capabilitiesForRole('admin')),
    scopeIds: null,
    source: 'web',
  };
});

afterAll(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(async () => {
  await sql`DELETE FROM share_accesses`.execute(conn.db);
  await sql`DELETE FROM shares`.execute(conn.db);
});

describe('com es guarda', () => {
  it('el token NO és mai a la base de dades', async () => {
    const { token } = await nouEnllac();

    const files = await sql<{ token_hmac: string }>`SELECT token_hmac FROM shares`.execute(conn.db);
    // "Si algú es queda una còpia de la base, no en pot treure cap enllaç funcional."
    expect(files.rows[0]?.token_hmac).not.toBe(token);
    expect(files.rows[0]?.token_hmac).toBe(tokenHmac(token, PEPPER));
  });

  it("sense el pebre, l'HMAC no es pot recalcular", () => {
    const token = generateShareToken();
    expect(tokenHmac(token, PEPPER)).not.toBe(tokenHmac(token, 'un-altre-pebre'));
  });

  it('secret_version permet rotar el pebre sense invalidar-ho tot de cop', () => {
    const token = generateShareToken();
    expect(tokenHmac(token, PEPPER, 1)).not.toBe(tokenHmac(token, PEPPER, 2));
  });

  it("NO hi ha cap columna d'IP enlloc", async () => {
    // És una decisió de privadesa deliberada (docs/10 §3).
    for (const taula of ['shares', 'share_accesses']) {
      const columnes = await sql<{ name: string }>`
        SELECT name FROM pragma_table_info(${taula})
      `.execute(conn.db);
      const noms = columnes.rows.map((c) => c.name.toLowerCase());
      expect(noms.filter((n) => n.includes('ip') || n.includes('addr'))).toEqual([]);
    }
  });

  it("el token NO surt a l'historial", async () => {
    const { token } = await nouEnllac();
    const fila = await sql<{ changes: string }>`
      SELECT changes FROM activity_log WHERE verb = 'shared' ORDER BY id DESC LIMIT 1
    `.execute(conn.db);
    expect(fila.rows[0]?.changes).not.toContain(token);
  });

  it('el token és prou llarg per no endevinar-se', () => {
    const token = generateShareToken();
    expect(token).toHaveLength(32);
    // Alfabet segur per a URL, sense caràcters que es confonguin llegint-los en veu alta.
    expect(token).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/u);
  });

  it("dos tokens seguits no s'assemblen", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateShareToken()));
    expect(tokens.size).toBe(200);
  });
});

describe('què es pot compartir', () => {
  it('una tasca o una llista, mai les dues ni cap', async () => {
    await expect(write(async (ctx) => createShare(ctx, principal, {}, PEPPER))).rejects.toThrow(
      /una tasca/u,
    );

    await expect(
      write(async (ctx) =>
        createShare(ctx, principal, { task_id: taskId, checklist_id: 'x' }, PEPPER),
      ),
    ).rejects.toThrow(/una tasca/u);
  });

  it("no existeix el permís d'edició", async () => {
    // D10: un convidat anònim marca ítems i comenta; no reescriu tasques.
    await expect(
      write(async (ctx) =>
        createShare(ctx, principal, { task_id: taskId, permission: 'edit' as never }, PEPPER),
      ),
    ).rejects.toThrow(/edició/u);
  });
});

describe('CAS 2 de docs/10 §10 · no es pot enumerar', () => {
  it('un token inventat i un de revocat donen LA MATEIXA resposta', async () => {
    const { token, share } = await nouEnllac({ password: 'la-contrasenya-de-la-maleta' });
    await write(async (ctx) => {
      await revokeShare(ctx, principal, share.id);
    });

    const revocat = await write(async (ctx) => openShare(ctx, { token }, PEPPER));
    const inventat = await write(async (ctx) =>
      openShare(ctx, { token: generateShareToken() }, PEPPER),
    );

    // Si un donés 404 i l'altre demanés contrasenya, es podrien enumerar enllaços.
    expect(revocat).toEqual(inventat);
  });

  it('un de caducat també', async () => {
    const { token } = await nouEnllac({ expires_at: '2026-08-05T00:00:00.000Z' });

    const caducat = await write(async (ctx) => openShare(ctx, { token }, PEPPER));
    const inventat = await write(async (ctx) =>
      openShare(ctx, { token: generateShareToken() }, PEPPER),
    );

    expect(caducat).toEqual(inventat);
  });

  it('un que ha esgotat les visites, també', async () => {
    const { token } = await nouEnllac({ max_views: 1 });
    await write(async (ctx) => openShare(ctx, { token }, PEPPER));

    const esgotat = await write(async (ctx) => openShare(ctx, { token }, PEPPER));
    expect(esgotat).toEqual({ ok: false, reason: 'needs_password' });
  });

  it('i triguen el mateix', async () => {
    const { token } = await nouEnllac({ password: 'la-contrasenya-de-la-maleta' });

    const mesura = async (t: string): Promise<number> => {
      const inici = process.hrtime.bigint();
      await write(async (ctx) => openShare(ctx, { token: t, password: 'provant' }, PEPPER));
      return Number(process.hrtime.bigint() - inici) / 1e6;
    };

    const existent = await mesura(token);
    const inventat = await mesura(generateShareToken());

    // Sense verificar contra un hash de mentida, el token inventat tornaria de seguida i
    // el temps de resposta diria quins enllaços existeixen.
    expect(inventat).toBeGreaterThan(existent * 0.3);
  });
});

describe('la contrasenya', () => {
  it('té un mínim propi, més baix que el dels comptes', async () => {
    // El que protegeix aquí és el bloqueig a cinc intents, no la llargada.
    expect(MIN_SHARE_PASSWORD_LENGTH).toBeLessThan(10);
    await expect(nouEnllac({ password: 'curt' })).rejects.toThrow(/caràcters/u);
  });

  it('una de sis caràcters val i es verifica bé', async () => {
    const { token } = await nouEnllac({ password: 'maleta' });

    const dolenta = await write(async (ctx) =>
      openShare(ctx, { token, password: 'maletx' }, PEPPER),
    );
    expect(dolenta.ok).toBe(false);

    const bona = await write(async (ctx) => openShare(ctx, { token, password: 'maleta' }, PEPPER));
    expect(bona.ok).toBe(true);
  });
});

describe('CAS 3 de docs/10 §10 · força bruta', () => {
  it('el sisè intent fa saltar el bloqueig', async () => {
    const { token } = await nouEnllac({ password: 'la-bona-de-veritat' });

    for (let i = 0; i < MAX_PASSWORD_ATTEMPTS; i += 1) {
      const res = await write(async (ctx) =>
        openShare(ctx, { token, password: 'dolenta-de-veritat' }, PEPPER),
      );
      expect(res.ok).toBe(false);
    }

    const sise = await write(async (ctx) =>
      openShare(ctx, { token, password: 'la-bona-de-veritat' }, PEPPER),
    );
    // Ni amb la contrasenya bona: el bloqueig ja ha saltat.
    expect(sise).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('es compta per ENLLAÇ, no per IP', async () => {
    const primer = await nouEnllac({ password: 'la-bona-de-veritat' });
    const segon = await nouEnllac({ password: 'la-bona-de-veritat' });

    for (let i = 0; i < MAX_PASSWORD_ATTEMPTS; i += 1) {
      await write(async (ctx) => openShare(ctx, { token: primer.token, password: 'no' }, PEPPER));
    }

    // El segon enllaç no en té la culpa: el seu comptador és seu.
    const res = await write(async (ctx) =>
      openShare(ctx, { token: segon.token, password: 'la-bona-de-veritat' }, PEPPER),
    );
    expect(res.ok).toBe(true);
  });

  it('encertar-la neteja el comptador', async () => {
    const { token } = await nouEnllac({ password: 'la-bona-de-veritat' });

    await write(async (ctx) => openShare(ctx, { token, password: 'dolenta-de-veritat' }, PEPPER));
    await write(async (ctx) => openShare(ctx, { token, password: 'la-bona-de-veritat' }, PEPPER));

    const fila = await sql<{ failed_attempts: number }>`
      SELECT failed_attempts FROM shares
    `.execute(conn.db);
    expect(fila.rows[0]?.failed_attempts).toBe(0);
  });
});

describe('qui és el convidat', () => {
  it('amb nom demanat, "Extern · Marta"', async () => {
    const { token } = await nouEnllac({ require_name: true });

    const sense = await write(async (ctx) => openShare(ctx, { token }, PEPPER));
    expect(sense).toMatchObject({ ok: false, reason: 'needs_name' });

    const amb = await write(async (ctx) => openShare(ctx, { token, name: 'Marta' }, PEPPER));
    expect(amb.ok).toBe(true);
    if (amb.ok) expect(guestLabel(amb.guestName, amb.guestRef)).toBe('Extern · Marta');
  });

  it('sense nom, "Extern · a4f2" amb un pseudònim estable per sessió', async () => {
    const { token } = await nouEnllac();
    const obert = await write(async (ctx) => openShare(ctx, { token }, PEPPER));

    expect(obert.ok).toBe(true);
    if (obert.ok) {
      expect(obert.guestRef).toMatch(/^[0-9a-f]{4}$/u);
      expect(guestLabel(null, obert.guestRef)).toBe(`Extern · ${obert.guestRef}`);
    }
  });

  it('el pseudònim NO es deriva de res que identifiqui la persona', async () => {
    const { token } = await nouEnllac({ require_name: true });

    // El mateix nom, dues sessions: identificadors diferents. Si es derivés del nom,
    // dues visites de la mateixa persona serien enllaçables entre enllaços.
    const primera = await write(async (ctx) => openShare(ctx, { token, name: 'Marta' }, PEPPER));
    const segona = await write(async (ctx) => openShare(ctx, { token, name: 'Marta' }, PEPPER));

    if (primera.ok && segona.ok) expect(primera.guestRef).not.toBe(segona.guestRef);
  });
});

describe('CAS 5 de docs/10 §10 · el convidat no escala', () => {
  const share: Share = {
    id: 'share-1',
    task_id: 'tasca-1',
    checklist_id: null,
    permission: 'check',
    require_name: false,
    has_password: false,
    expires_at: null,
    max_views: null,
    view_count: 0,
    created_at: NOW,
    revoked_at: null,
  };

  it('el seu principal està lligat a AQUEST enllaç', () => {
    const convidat = guestPrincipal(share, 'a4f2', null);
    expect(convidat.kind).toBe('guest');
    expect(convidat.shareId).toBe('share-1');
    // Cap àmbit: no pot llistar res per la via normal de l'API.
    expect(convidat.scopeIds?.size).toBe(0);
  });

  it('el permís de veure NO deixa marcar', () => {
    const convidat = guestPrincipal({ ...share, permission: 'view' }, 'a4f2', null);
    expect(convidat.capabilities.has('checklists:write')).toBe(false);
    expect(convidat.capabilities.has('comments:write')).toBe(false);
  });

  it('el de marcar deixa marcar però NO comentar', () => {
    const convidat = guestPrincipal({ ...share, permission: 'check' }, 'a4f2', null);
    expect(convidat.capabilities.has('checklists:write')).toBe(true);
    expect(convidat.capabilities.has('comments:write')).toBe(false);
  });

  it('cap permís dona escriptura de tasques', () => {
    for (const permission of ['view', 'check', 'comment'] as const) {
      const convidat = guestPrincipal({ ...share, permission }, 'a4f2', null);
      // D10: no hi ha permís d'edició per cap camí.
      expect(convidat.capabilities.has('tasks:write')).toBe(false);
      expect(convidat.capabilities.has('shares:write')).toBe(false);
      expect(convidat.capabilities.has('tokens:manage')).toBe(false);
    }
  });

  it("queda a l'historial com a guest i amb source share", () => {
    const convidat = guestPrincipal(share, 'a4f2', 'Marta');
    expect(convidat.source).toBe('share');
    expect(convidat.label).toBe('Extern · Marta');
  });
});
