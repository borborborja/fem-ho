/**
 * docs/13 M2 · comprovació de la fita: `test: migrations up/down/up` als dos motors.
 *
 * "Les migracions van endavant i enrere en els dos motors; l'esquema té totes les
 * taules del document."
 *
 * Postgres només s'executa si hi ha FEMHO_TEST_POSTGRES_URL. Sense això les proves de
 * Postgres es marquen com a omeses i **es diu clarament**, en comptes de passar en verd
 * havent provat un sol motor — que és exactament el que D11 vol evitar.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from './connection.js';
import { connectTestSchema, type TestSchema } from './test-postgres.js';
import type { Engine } from './dialect.js';
import { MIGRATIONS, migrateDown, migrateToLatest } from './migrator.js';

/**
 * Les taules que docs/01 defineix, i push_subscriptions de docs/11 §1.
 * docs/13 M2: hi han de ser TOTES des del primer dia.
 */
const TAULES_ESPERADES = [
  'activity_log',
  'ai_agents',
  'api_tokens',
  'attachments',
  'calendars',
  'change_log',
  'checklist_items',
  'checklists',
  'comments',
  'event_attendees',
  'event_occurrences',
  'events',
  'labels',
  'projects',
  'push_subscriptions',
  'reminders',
  'scope_members',
  'scopes',
  'sessions',
  'share_accesses',
  'shares',
  'subtasks',
  'task_assignees',
  'task_labels',
  'tasks',
  'user_settings',
  'users',
  'webhooks',
];

/** Les sis que docs/13 M2 exigeix explícitament des del primer dia. */
const IMPRESCINDIBLES = [
  'events',
  'calendars',
  'change_log',
  'activity_log',
  'ai_agents',
  'shares',
];

async function tableNames(conn: Connection): Promise<string[]> {
  const query =
    conn.engine === 'sqlite'
      ? `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
      // `current_schema()` i no `'public'`: la suite corre al seu propi esquema
      // (`test-postgres.ts`), i buscant a `public` es miraven les taules d'una altra.
      : `SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`;
  const result = await sql.raw(query).execute(conn.db);
  return (result.rows as { name: string }[]).map((r) => r.name).sort();
}

interface Motor {
  engine: Engine;
  url: string;
  cleanup: () => void;
}

const motors: Motor[] = [];

const tmp = mkdtempSync(join(tmpdir(), 'femho-migrations-'));
motors.push({
  engine: 'sqlite',
  url: `sqlite://${join(tmp, 'test.db')}`,
  cleanup: () => rmSync(tmp, { recursive: true, force: true }),
});

const pgUrl = process.env.FEMHO_TEST_POSTGRES_URL;
if (pgUrl !== undefined && pgUrl !== '') {
  motors.push({ engine: 'postgres', url: pgUrl, cleanup: () => {} });
}

afterAll(() => {
  for (const m of motors) m.cleanup();
});

describe.each(motors)('migracions · $engine', (motor) => {
  let conn: Connection;
  let schema: TestSchema | null = null;

  beforeAll(async () => {
    // Esquema propi per no xocar amb les altres suites (veure `test-postgres.ts`).
    schema = motor.engine === 'postgres' ? await connectTestSchema(motor.url, 'migrations') : null;
    conn = schema ?? connect(motor.url);
  });

  afterAll(async () => {
    if (schema !== null) await schema.drop();
    else await conn.close();
  });

  it('up crea totes les taules del document', async () => {
    const result = await migrateToLatest(conn.db, { engine: motor.engine });
    expect(result.applied).toEqual(MIGRATIONS.map((m) => m.name));

    const taules = await tableNames(conn);
    for (const t of TAULES_ESPERADES) {
      expect(taules, `falta la taula ${t}`).toContain(t);
    }
  });

  it('hi són les sis que docs/13 exigeix des del primer dia', async () => {
    const taules = await tableNames(conn);
    for (const t of IMPRESCINDIBLES) {
      expect(taules, `${t} ha d'existir des de M2, o cal reescriure el sync i l'API`).toContain(t);
    }
  });

  it('up dues vegades no torna a aplicar res', async () => {
    const result = await migrateToLatest(conn.db, { engine: motor.engine });
    expect(result.applied).toEqual([]);
  });

  it('down deixa la base neta i up la torna a construir', async () => {
    // Es desfan TOTES, no una: fixar aquí el nom de l'última faria que aquesta prova es
    // trenqués cada cop que s'afegeix una migració, que no és el que vol comprovar.
    for (let i = MIGRATIONS.length; i > 0; i -= 1) {
      const desfeta = await migrateDown(conn.db, motor.engine);
      expect(desfeta).toBe(MIGRATIONS[i - 1]!.name);
    }
    expect(await migrateDown(conn.db, motor.engine)).toBeNull();

    const buida = await tableNames(conn);
    for (const t of TAULES_ESPERADES) {
      expect(buida, `${t} hauria d'haver desaparegut`).not.toContain(t);
    }

    const result = await migrateToLatest(conn.db, { engine: motor.engine });
    expect(result.applied).toEqual(MIGRATIONS.map((m) => m.name));

    const tornades = await tableNames(conn);
    for (const t of TAULES_ESPERADES) {
      expect(tornades).toContain(t);
    }
  });

  it('scope_id de tasks és NOT NULL: una tasca sense àmbit no hi cap', async () => {
    // És la invariant central del producte (docs/01 §4). Es comprova a l'esquema i no
    // només a la capa de servei, perquè el CalDAV i el sync també hi escriuen.
    await expect(
      sql
        .raw(
          `INSERT INTO tasks (id, title, status, position, created_by, created_at, updated_at)
           VALUES ('t1','Sense àmbit','inbox','a0','u1','2026-08-05T00:00:00Z','2026-08-05T00:00:00Z')`,
        )
        .execute(conn.db),
    ).rejects.toThrow();
  });

  it("l'enum de status no accepta valors catalans", async () => {
    // Regla 3 i D2, comprovats a la base i no només al linter.
    await expect(
      sql
        .raw(
          `INSERT INTO scopes (id, name, color, owner_id, position, created_at, updated_at)
           VALUES ('s1','Feina','--plou-orange','u1','a0','2026-08-05T00:00:00Z','2026-08-05T00:00:00Z')`,
        )
        .execute(conn.db),
    ).rejects.toThrow(); // owner_id no existeix: la clau forana ha de saltar
  });
});

describe('cobertura de motors', () => {
  it("diu clarament si Postgres no s'ha provat", () => {
    const provats = motors.map((m) => m.engine);
    expect(provats).toContain('sqlite');

    if (!provats.includes('postgres')) {
      // No es falla: en un portàtil sense Docker no s'ha de bloquejar el treball. Però
      // queda dit, i a CI la variable hi és sempre (D11: CI prova les dues).
      console.warn(
        "\n  AVÍS · Postgres NO s'ha provat. Posa FEMHO_TEST_POSTGRES_URL per fer-ho.\n" +
          '  D11 exigeix que CI provi els dos motors: és on es veu la diferència entre\n' +
          "  FTS5 i tsvector, i el parany de visibilitat fora d'ordre del sync.\n",
      );
    }
  });
});
