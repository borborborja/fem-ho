/**
 * La 013 **sobre una base amb adjunts**, i **als dos motors**.
 *
 * El refet de taula a SQLite ja es va espatllar un cop en aquest repositori, i el que el fa
 * invisible és provar-lo amb la base buida: sense files, copiar-les malament no es nota, i
 * amb zero adjunts un `DROP TABLE` que hauria de violar claus foranes no viola res. Per
 * això aquí hi ha files abans de migrar, i el que s'asserta és **que hi són després**.
 *
 * I els dos motors perquè **no és el mateix codi**: a Postgres el `CHECK` s'altera amb un
 * `ALTER TABLE` i a SQLite es refà la taula sencera. Provar-ne un i donar l'altre per bo és
 * exactament el que D11 vol evitar. Sense `FEMHO_TEST_POSTGRES_URL`, Postgres se salta.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from './connection.js';
import type { Engine } from './dialect.js';
import { connectTestSchema, postgresUrl, type TestSchema } from './test-postgres.js';
import { migrateDown, migrateToLatest } from './migrator.js';

const NOW = '2026-08-11T10:00:00.000Z';

interface Motor {
  engine: Engine;
  url: string | undefined;
}

const motors: Motor[] = [{ engine: 'sqlite', url: undefined }];
const pg = postgresUrl();
if (pg !== undefined) motors.push({ engine: 'postgres', url: pg });

describe.each(motors)('la 013 · $engine', (motor) => {
  const engine = motor.engine;
  const ids = { user: uuidv7(), scope: uuidv7(), task: uuidv7() };

  let conn: Connection;
  let schema: TestSchema | null = null;
  let tmp: string | null = null;

  const adjunt = async (source: string): Promise<string> => {
    const id = uuidv7();
    await sql`
      INSERT INTO attachments (id, task_id, scope_id, filename, mime_type, size_bytes,
                               storage_path, source, uploaded_by, created_at, updated_at)
      VALUES (${id}, ${ids.task}, ${ids.scope}, ${`${source}.pdf`}, 'application/pdf', 12,
              ${`/data/${id}`}, ${source}, ${ids.user}, ${NOW}, ${NOW})
    `.execute(conn.db);
    return id;
  };

  const compta = async (): Promise<number> => {
    const row = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM attachments`.execute(conn.db);
    return Number(row.rows[0]?.n ?? 0);
  };

  beforeAll(async () => {
    if (motor.url === undefined) {
      tmp = mkdtempSync(join(tmpdir(), 'femho-mail-'));
      conn = connect(`sqlite://${join(tmp, 'test.db')}`);
    } else {
      schema = await connectTestSchema(motor.url, 'mail_migration');
      conn = schema;
    }
    await migrateToLatest(conn.db, { engine });

    await sql`
      INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
      VALUES (${ids.user}, 'mail@example.com', 'Borja', 'x', 'human', 'admin', ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${ids.scope}, 'Casa', 'individual', '--plou-pink', ${ids.user}, 'a1', ${NOW}, ${NOW})
    `.execute(conn.db);
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, created_by,
                         created_at, updated_at)
      VALUES (${ids.task}, ${ids.scope}, 'Amb adjunts', 'inbox', 'a1', 'native', ${ids.user},
              ${NOW}, ${NOW})
    `.execute(conn.db);
  });

  afterAll(async () => {
    if (schema !== null) await schema.drop();
    else await conn.close();
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
  });

  describe('el refet dels adjunts', () => {
    it('els adjunts que ja hi eren sobreviuen a la migració, sencers', async () => {
      const pujat = await adjunt('upload');
      const dIcs = await adjunt('ical_attach');
      expect(await compta()).toBe(2);

      // Es desfà la 013 i es torna a aplicar **amb les files posades**: el refet, dos cops.
      expect(await migrateDown(conn.db, engine)).toBe('013-mail-sources');
      expect(await compta()).toBe(2);
      await migrateToLatest(conn.db, { engine });

      const files = await sql<{
        id: string;
        filename: string;
        source: string;
        task_id: string;
        scope_id: string;
        size_bytes: number;
        version: number;
      }>`SELECT * FROM attachments ORDER BY filename`.execute(conn.db);

      expect(files.rows).toHaveLength(2);
      const [ics, up] = files.rows;
      // No només que hi siguin: **que cada columna hagi arribat al seu lloc**. Un refet que
      // desplaci les columnes deixa el mateix compte de files i les dades barrejades.
      expect(ics).toMatchObject({
        id: dIcs,
        filename: 'ical_attach.pdf',
        source: 'ical_attach',
        task_id: ids.task,
        scope_id: ids.scope,
        size_bytes: 12,
        version: 1,
      });
      expect(up).toMatchObject({ id: pujat, filename: 'upload.pdf', source: 'upload' });
    });

    it('i després la taula admet el correu, que és tot el motiu del refet', async () => {
      const nou = await adjunt('mail_attach');
      const row = await sql<{ source: string }>`
        SELECT source FROM attachments WHERE id = ${nou}
      `.execute(conn.db);
      expect(row.rows[0]?.source).toBe('mail_attach');
    });

    it('una mena inventada segueix rebutjada', async () => {
      // El CHECK s'ha ampliat, no obert. I a Postgres, on la 008 no en va deixar cap, la
      // 013 és la que el posa: aquesta línia és la que ho comprova.
      await expect(adjunt('slack_attach')).rejects.toThrow();
    });

    it('desfer amb adjunts de correu a taula falla, i ho diu', async () => {
      /**
       * Desfer una migració **no pot voler dir perdre fitxers d'algú**. Amb el
       * `mail_attach` de la prova anterior a taula, la 013 s'ha de negar.
       */
      await expect(migrateDown(conn.db, engine)).rejects.toThrow(/adjunts de correu/u);
      expect(await compta()).toBe(3);
    });

    it.skipIf(engine !== 'sqlite')(
      "els índexs hi tornen a ser: el DROP TABLE se'ls emporta",
      async () => {
        const idx = await sql<{ name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'attachments'
      `.execute(conn.db);
        const noms = idx.rows.map((r) => r.name);
        expect(noms).toContain('idx_attachments_task');
        expect(noms).toContain('idx_attachments_event');
      },
    );
  });

  describe('les taules de correu', () => {
    it('la identitat és el Message-ID, i el mateix correu no hi entra dos cops', async () => {
      const compte = uuidv7();
      const fil = uuidv7();
      await sql`
        INSERT INTO mail_accounts (id, user_id, name, host, username, created_at, updated_at)
        VALUES (${compte}, ${ids.user}, 'Personal', 'imap.example.test', 'borja', ${NOW}, ${NOW})
      `.execute(conn.db);
      await sql`
        INSERT INTO mail_threads (id, account_id, thread_key, created_at, updated_at)
        VALUES (${fil}, ${compte}, 'mid:arrel@example.test', ${NOW}, ${NOW})
      `.execute(conn.db);

      const posa = (folder: string, uid: string): Promise<unknown> =>
        sql`
          INSERT INTO mail_messages (id, account_id, thread_id, message_key, folder,
                                     uid_validity, uid, created_at, updated_at)
          VALUES (${uuidv7()}, ${compte}, ${fil}, 'mid:u@example.test', ${folder}, '1', ${uid},
                  ${NOW}, ${NOW})
        `.execute(conn.db);

      await posa('INBOX', '10');

      /**
       * **El cas que ho justifica tot.** El mateix correu, vist a una altra carpeta i amb
       * un UID nou —que és el que passa quan l'arrossegues a Gmail, o quan el servidor
       * reindexa—: si la clau única fos per UID, aquí hi entraria una segona fila i demà
       * hi hauria dues tasques del mateix correu.
       */
      await expect(posa('Feina', '99')).rejects.toThrow();
    });

    it('una regla no pot mapar dues vegades la mateixa carpeta', async () => {
      const compte = uuidv7();
      await sql`
        INSERT INTO mail_accounts (id, user_id, name, host, username, created_at, updated_at)
        VALUES (${compte}, ${ids.user}, 'Segon', 'imap.example.test', 'borja', ${NOW}, ${NOW})
      `.execute(conn.db);

      const regla = (id: string): Promise<unknown> =>
        sql`
          INSERT INTO mail_rules (id, account_id, folder, scope_id, action, position,
                                  created_at, updated_at)
          VALUES (${id}, ${compte}, 'INBOX/Escola', ${ids.scope}, 'inbox', 'a1', ${NOW}, ${NOW})
        `.execute(conn.db);

      const primera = uuidv7();
      await regla(primera);
      await expect(regla(uuidv7())).rejects.toThrow();

      // I esborrada, la carpeta torna a quedar lliure: l'índex únic és parcial.
      await sql`UPDATE mail_rules SET deleted_at = ${NOW} WHERE id = ${primera}`.execute(conn.db);
      await expect(regla(uuidv7())).resolves.toBeDefined();
    });

    it("un compte de correu és d'una persona, i el CHECK no deixa IMAP en clar", async () => {
      await expect(
        sql`
          INSERT INTO mail_accounts (id, user_id, name, host, username, security,
                                     created_at, updated_at)
          VALUES (${uuidv7()}, ${ids.user}, 'Insegur', 'imap.example.test', 'borja', 'none',
                  ${NOW}, ${NOW})
        `.execute(conn.db),
      ).rejects.toThrow();
    });
  });
});
