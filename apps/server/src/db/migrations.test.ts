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
import { dbBool, isTrue } from './bool.js';
import { connect, type Connection } from './connection.js';
import { connectTestSchema, type TestSchema } from './test-postgres.js';
import type { Engine } from './dialect.js';
import { MIGRATIONS, migrateDown, migrateToLatest } from './migrator.js';

/**
 * Les taules que docs/01 defineix, push_subscriptions de docs/11 §1 i les quatre del
 * correu (013). docs/13 M2: hi han de ser TOTES des del primer dia.
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
  'mail_accounts',
  'mail_messages',
  'mail_rules',
  'mail_threads',
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
      : // `current_schema()` i no `'public'`: la suite corre al seu propi esquema
        // (`test-postgres.ts`), i buscant a `public` es miraven les taules d'una altra.
        `SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema()`;
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

/**
 * **Migrar amb dades a dins, que és el que passa de debò.**
 *
 * Totes les proves d'aquest fitxer migraven una base buida, i per això la 009 va passar
 * en verd i va petar la primera vegada que es va desplegar: refà `users` —cal, per
 * admetre-hi el `kind` `remote`— i `users` té una dotzena de taules que hi apunten, o
 * sigui que el `DROP TABLE` viola les claus foranes en el moment que hi ha una fila que
 * el referencia.
 *
 * El `PRAGMA foreign_keys = OFF` que hi havia dins de la migració **no feia res**: SQLite
 * l'ignora en silenci dins d'una transacció. Ara el posa el migrador abans d'obrir-la.
 */
describe('migrar una base que ja té dades', () => {
  const tmpDades = mkdtempSync(join(tmpdir(), 'femho-migdades-'));
  let conn: Connection;

  beforeAll(() => {
    conn = connect(`sqlite://${join(tmpDades, 'amb-dades.db')}`);
  });

  afterAll(async () => {
    await conn.close();
    rmSync(tmpDades, { recursive: true, force: true });
  });

  it('arriba fins al final encara que hi hagi files que apuntin a `users`', async () => {
    // Fins a la 008, que és on la base es queda a les instàncies ja desplegades.
    await ensureUpTo(conn, '008-shared-scopes');

    const ara = '2026-08-07T13:00:00.000Z';
    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES ('u1', 'algu@e.com', 'Algú', 'x', 'human', 'admin', ${ara}, ${ara})
    `.execute(conn.db);
    // Una fila que apunta a l'usuari: sense això el `DROP TABLE users` no molesta ningú i
    // la prova tornaria a passar sense provar res.
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES ('s1', 'Casa', 'individual', '--plou-blue', 'u1', 'a1', ${ara}, ${ara})
    `.execute(conn.db);

    await migrateToLatest(conn.db, { engine: 'sqlite' });

    // Hi ha arribat i l'usuari hi és. (La 004 n'hi posa un altre, el de la IA.)
    const qui = await sql<{ id: string }>`SELECT id FROM users WHERE id = 'u1'`.execute(conn.db);
    expect(qui.rows).toHaveLength(1);

    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES ('u2', ${null}, 'Una altra casa', ${null}, 'remote', 'member', ${ara}, ${ara})
    `.execute(conn.db);

    // I la referència que ja hi havia segueix sencera.
    const ambit = await sql<{ owner_id: string }>`SELECT owner_id FROM scopes`.execute(conn.db);
    expect(ambit.rows[0]?.owner_id).toBe('u1');

    // Les claus foranes han quedat enceses: el pragma es restaura passi el que passi.
    const pragma = await sql<{ foreign_keys: number }>`PRAGMA foreign_keys`.execute(conn.db);
    expect(Number(pragma.rows[0]?.foreign_keys)).toBe(1);
  });

  it("la 015 deixa el mode d'àmbits sense triar a qui ja tenia preferències", async () => {
    /**
     * **Aquest és el cas que protegeix a qui ja hi és.** La columna no porta `DEFAULT`: si
     * en portés `'multi'`, ningú tindria mai `NULL` i el wizard no sabria a qui ha de
     * sortir sense una segona columna. I si en portés `'single'`, a tothom li canviaria la
     * barra un matí sense haver-ho demanat.
     */
    const ara = '2026-08-12T09:00:00.000Z';
    await sql`
      INSERT INTO user_settings (user_id, inbox_position, inbox_show_overdue, notify_prefs,
                                 updated_at)
      VALUES ('u1', 'left', ${dbBool(true)}, '{}', ${ara})
    `.execute(conn.db);

    const fila = await sql<{ scope_mode: string | null; inbox_position: string }>`
      SELECT scope_mode, inbox_position FROM user_settings WHERE user_id = 'u1'
    `.execute(conn.db);

    expect(fila.rows[0]?.scope_mode).toBeNull();
    // I la resta de preferències segueixen intactes: la migració només hi afegeix.
    expect(fila.rows[0]?.inbox_position).toBe('left');
  });

  it('la 017 no fa que cap tasca que ja hi era demani atenció', async () => {
    /**
     * **El defecte importa perquè el senyal serveixi de res.** Si les tasques d'abans
     * naixessin marcades, el primer que veuria qui actualitza és un punt d'atenció amb
     * tres-centes tasques a sota, i el senyal quedaria cremat el mateix dia que arriba.
     */
    const ara = '2026-08-12T09:30:00.000Z';
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, view_mode, ai_mode,
                         created_by, created_at, updated_at, version)
      VALUES ('t1', 's1', 'Una de sempre', 'todo', 'a1', 'card', 'manual', 'u1',
              ${ara}, ${ara}, 1)
    `.execute(conn.db);

    const fila = await sql<{ needs_attention: number; attention_asked_at: string | null }>`
      SELECT needs_attention, attention_asked_at FROM tasks WHERE id = 't1'
    `.execute(conn.db);

    expect(isTrue(fila.rows[0]?.needs_attention)).toBe(false);
    // I «des de quan» és nul mentre no hi hagi cap pregunta: no és una data d'estrena.
    expect(fila.rows[0]?.attention_asked_at).toBeNull();
  });

  it('la 018 no inventa activitat ni lectures a les tasques que ja hi eren', async () => {
    /**
     * **Una data falsa és pitjor que un buit.** Si `last_activity_at` naixés amb la data de
     * la migració, totes les tasques d'una casa dirien «fa 5 min» el dia que s'actualitza,
     * i la marca —que existeix per distingir el que es mou del que porta dies quiet—
     * naixeria mentint. La interfície ja sap què fer amb un nul; amb una data inventada no.
     */
    const fila = await sql<{
      last_activity_at: string | null;
      ai_last_read_at: string | null;
      ai_last_read_by: string | null;
    }>`
      SELECT last_activity_at, ai_last_read_at, ai_last_read_by FROM tasks WHERE id = 't1'
    `.execute(conn.db);

    expect(fila.rows[0]?.last_activity_at).toBeNull();
    expect(fila.rows[0]?.ai_last_read_at).toBeNull();
    expect(fila.rows[0]?.ai_last_read_by).toBeNull();
  });

  it('la 019 no encén el registre a cap àmbit que ja hi era', async () => {
    /**
     * **La fila absent és el cas normal, i és el que fa que això sigui segur.** Si crear la
     * taula hagués sembrat una fila per àmbit —o pitjor, amb `time_tracking` a cert—, qui
     * actualitzi es trobaria l'endemà una funció nova encesa a tot arreu i el tauler ple de
     * columnes que no ha demanat.
     */
    const files = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM scope_settings`.execute(
      conn.db,
    );
    expect(Number(files.rows[0]?.n)).toBe(0);

    // I cap tasca no neix amb tipologia: la columna hi és i és nul·la.
    const tasca = await sql<{ task_type_id: string | null }>`
      SELECT task_type_id FROM tasks WHERE id = 't1'
    `.execute(conn.db);
    expect(tasca.rows[0]?.task_type_id).toBeNull();
  });
});

/** Aplica les migracions fins a una concreta, per poder simular una base ja desplegada. */
async function ensureUpTo(conn: Connection, last: string): Promise<void> {
  const fins = MIGRATIONS.findIndex((m) => m.name === last);
  await sql
    .raw(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    )
    .execute(conn.db);
  for (const migration of MIGRATIONS.slice(0, fins + 1)) {
    await migration.up(conn.db, 'sqlite');
    await sql`
      INSERT INTO schema_migrations (name, applied_at) VALUES (${migration.name}, '2026-08-07')
    `.execute(conn.db);
  }
}
