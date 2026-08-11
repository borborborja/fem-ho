/**
 * El rebliment de la migració 012, **sobre una base amb dades**.
 *
 * Una migració que afegeix una columna i n'omple el passat només es pot provar amb passat.
 * Contra una base buida, aquest fitxer passaria en verd sense executar ni una fila del
 * `UPDATE`, i el defecte —tasques d'abans de la columna que es queden sense icona per
 * sempre— apareixeria a la instància d'algú i no aquí.
 *
 * És la mateixa família de la lliçó que va deixar el refet de taules a SQLite: **el símptoma
 * només surt sobre dades**.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from './connection.js';
import { migrateDown, migrateToLatest } from './migrator.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-prov-'));
const NOW = '2026-08-11T10:00:00.000Z';

let conn: Connection;
const ids = { user: uuidv7(), scope: uuidv7() };

/** Un calendari d'una mena, i una tasca nascuda d'una cita seva. */
async function llavor(sourceKind: string | null, origin: string): Promise<string> {
  const calendar = uuidv7();
  const task = uuidv7();
  await sql`
    INSERT INTO calendars (id, scope_id, name, kind, origin, source_kind, sync_seq,
                           created_at, updated_at)
    VALUES (${calendar}, ${ids.scope}, ${`Cal ${origin}`}, 'events', ${origin},
            ${sourceKind}, 0, ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO tasks (id, scope_id, title, status, position, origin,
                       event_calendar_id, event_uid, created_by, created_at, updated_at)
    VALUES (${task}, ${ids.scope}, ${`De ${sourceKind ?? 'local'}`}, 'inbox',
            ${`a${task.slice(0, 4)}`}, 'native', ${calendar}, ${`uid-${task.slice(0, 6)}`},
            ${ids.user}, ${NOW}, ${NOW})
  `.execute(conn.db);
  return task;
}

/**
 * Desfà fins a treure la 012, inclosa.
 *
 * La 013 i la 014 hi són pel mig i **també es desfan sobre aquestes dades**, que de propina
 * fa que aquest fitxer exerciti els dos refets —el d'`attachments` i el de `mail_rules`— en
 * tots dos sentits i amb files a taula.
 */
async function desfesLa012(): Promise<void> {
  expect(await migrateDown(conn.db, 'sqlite')).toBe('014-mail-visibility');
  expect(await migrateDown(conn.db, 'sqlite')).toBe('013-mail-sources');
  expect(await migrateDown(conn.db, 'sqlite')).toBe('012-task-provenance');
}

const kindOf = async (taskId: string): Promise<string | null> => {
  const row = await sql<{ source_kind: string | null }>`
    SELECT source_kind FROM tasks WHERE id = ${taskId}
  `.execute(conn.db);
  return row.rows[0]?.source_kind ?? null;
};

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${ids.user}, 'prov@example.com', 'Borja', 'x', 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${ids.scope}, 'Casa', 'individual', '--plou-pink', ${ids.user}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);
});

afterAll(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('la 012 omple el passat', () => {
  it("una tasca d'abans de la columna rep la mena del seu calendari", async () => {
    /**
     * Es desfà la 012 i es torna a aplicar **amb les files ja posades**, que és l'única
     * manera d'executar el `UPDATE` de debò en una prova.
     */
    const deIcal = await llavor('ical', 'subscription');
    const deRss = await llavor('rss', 'subscription');
    const deCasa = await llavor(null, 'local');

    await desfesLa012();
    await migrateToLatest(conn.db, { engine: 'sqlite' });

    expect(await kindOf(deIcal)).toBe('ical');
    expect(await kindOf(deRss)).toBe('rss');

    /**
     * I la que ve d'un calendari d'aquesta casa **es queda sense provinença**: ve d'una
     * cita que has escrit tu, o sigui de tu. Posar-hi una mena seria dir que ve de fora.
     */
    expect(await kindOf(deCasa)).toBeNull();
  });

  it('i una tasca escrita per una persona no en rep cap', async () => {
    const propia = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, created_by,
                         created_at, updated_at)
      VALUES (${propia}, ${ids.scope}, 'Comprar pa', 'inbox', 'b1', 'native', ${ids.user},
              ${NOW}, ${NOW})
    `.execute(conn.db);

    await desfesLa012();
    await migrateToLatest(conn.db, { engine: 'sqlite' });

    expect(await kindOf(propia)).toBeNull();
  });

  it('el CHECK rebutja una mena que no existeix', async () => {
    /**
     * Que el vocabulari sigui únic (regla 3) ho ha de vigilar la base i no la disciplina.
     *
     * L'`UPDATE` ha d'encaixar amb una fila **de veritat**: la primera versió d'aquesta
     * prova apuntava a un id d'àmbit, no tocava cap tasca, i passava en verd sense que el
     * `CHECK` s'arribés a disparar mai. Una prova que no toca res prova que no toca res.
     */
    const alguna = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, created_by,
                         created_at, updated_at)
      VALUES (${alguna}, ${ids.scope}, 'Per provar el CHECK', 'inbox', 'c1', 'native',
              ${ids.user}, ${NOW}, ${NOW})
    `.execute(conn.db);

    const abans = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM tasks WHERE id = ${alguna}
    `.execute(conn.db);
    expect(Number(abans.rows[0]?.n)).toBe(1);

    await expect(
      sql`UPDATE tasks SET source_kind = 'telegram' WHERE id = ${alguna}`.execute(conn.db),
    ).rejects.toThrow();

    // I les que sí que existeixen, s'accepten.
    await sql`UPDATE tasks SET source_kind = 'rss' WHERE id = ${alguna}`.execute(conn.db);
    expect(await kindOf(alguna)).toBe('rss');
  });
});
