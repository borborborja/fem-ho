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
import { dbBool } from './bool.js';

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

  /**
   * Baixa fins a **treure** la migració que es diu, i torna les que ha desfet pel camí.
   *
   * Escrit així i no amb un nombre fix de passos: aquest fitxer prova el refet de dues
   * taules, no quantes migracions hi ha al repositori, i amb els noms comptats a mà afegir-ne
   * una de nova el feia fallar sense que hi tingués res a veure.
   */
  async function baixaFinsA(nom: string): Promise<string[]> {
    const desfetes: string[] = [];
    for (;;) {
      const feta = await migrateDown(conn.db, engine);
      expect(feta, `no s'ha trobat ${nom} baixant`).not.toBeNull();
      desfetes.push(feta!);
      if (feta === nom) return desfetes;
    }
  }

  describe('el refet dels adjunts', () => {
    it('els adjunts que ja hi eren sobreviuen a la migració, sencers', async () => {
      const pujat = await adjunt('upload');
      const dIcs = await adjunt('ical_attach');
      expect(await compta()).toBe(2);

      // Es desfan la 014 i la 013 i es tornen a aplicar **amb les files posades**: els dos
      // refets, dues vegades cadascun.
      expect(await baixaFinsA('013-mail-sources')).toContain('014-mail-visibility');
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
      // La 014 se'n va sense problema; és la 013 la que s'ha de negar.
      await baixaFinsA('014-mail-visibility');
      await expect(migrateDown(conn.db, engine)).rejects.toThrow(/adjunts de correu/u);
      expect(await compta()).toBe(3);

      // I es torna a deixar al dia: el que ve després d'aquest fitxer escriu a l'esquema
      // d'ara, i deixar-lo a mig desfer faria que una prova fallés per l'ordre i no pel
      // que comprova.
      await migrateToLatest(conn.db, { engine });
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

  describe('la 014 sobre dades de la 013', () => {
    /**
     * El rebliment només es pot provar **amb files d'abans**: es desfà fins a treure la 014,
     * s'hi escriuen les tres situacions que existien i es torna a aplicar. Contra una base
     * buida, aquest bloc passaria en verd sense executar ni una línia dels tres `UPDATE`.
     */
    it('cap correu es queda esperant una conversió que ja no existeix', async () => {
      await baixaFinsA('014-mail-visibility');

      const compte = uuidv7();
      const fil = uuidv7();
      await sql`
        INSERT INTO mail_accounts (id, user_id, name, host, username, created_at, updated_at)
        VALUES (${compte}, ${ids.user}, 'Vell', 'imap.example.test', 'borja', ${NOW}, ${NOW})
      `.execute(conn.db);
      await sql`
        INSERT INTO mail_threads (id, account_id, thread_key, created_at, updated_at)
        VALUES (${fil}, ${compte}, 'mid:vell@escola.test', ${NOW}, ${NOW})
      `.execute(conn.db);

      // Una regla de les que convertien soles, amb el booleà antic a `true`.
      const regla = uuidv7();
      await sql`
        INSERT INTO mail_rules (id, account_id, folder, scope_id, action, inbox_visible,
                                position, created_at, updated_at)
        VALUES (${regla}, ${compte}, 'INBOX/Vella', ${ids.scope}, 'task', ${dbBool(true)},
                'a1', ${NOW}, ${NOW})
      `.execute(conn.db);

      const posa = async (id: string, key: string, disposition: string): Promise<void> => {
        await sql`
          INSERT INTO mail_messages (id, account_id, thread_id, message_key, folder,
                                     uid_validity, uid, disposition, rule_id,
                                     created_at, updated_at)
          VALUES (${id}, ${compte}, ${fil}, ${key}, 'INBOX/Vella', '1', ${key},
                  ${disposition}, ${regla}, ${NOW}, ${NOW})
        `.execute(conn.db);
      };
      const pendent = uuidv7();
      const descartat = uuidv7();
      const normal = uuidv7();
      await posa(pendent, 'mid:p@x', 'pending');
      await posa(descartat, 'mid:d@x', 'dismissed');
      await posa(normal, 'mid:n@x', 'inbox');

      await migrateToLatest(conn.db, { engine });

      const files = await sql<{ id: string; disposition: string; inbox_visible: number | null }>`
        SELECT id, disposition, inbox_visible FROM mail_messages
        WHERE id IN (${pendent}, ${descartat}, ${normal})
      `.execute(conn.db);
      const per = new Map(files.rows.map((r) => [r.id, r]));

      // El que esperava la conversió automàtica ara espera una persona.
      expect(per.get(pendent)?.disposition).toBe('inbox');
      expect(per.get(pendent)?.inbox_visible).toBeNull();

      /**
       * I el descartat deixa de ser un carreró sense sortida: passa a ser «no visible», que
       * **es veu al calendari i es pot recuperar**.
       */
      expect(per.get(descartat)?.disposition).toBe('inbox');
      expect(Boolean(per.get(descartat)?.inbox_visible)).toBe(false);
      expect(per.get(descartat)?.inbox_visible).not.toBeNull();

      // Un que ja hi era no es toca.
      expect(per.get(normal)?.disposition).toBe('inbox');
      expect(per.get(normal)?.inbox_visible).toBeNull();

      /**
       * I la regla perd `action` i el seu `true` heretat: **ningú va decidir aquell `true`**,
       * era el defecte de la 013, i deixar-l'hi seria convertir-lo en una decisió.
       */
      const després = await sql<{ inbox_visible: number | null }>`
        SELECT inbox_visible FROM mail_rules WHERE id = ${regla}
      `.execute(conn.db);
      expect(després.rows[0]?.inbox_visible).toBeNull();
    });
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
          INSERT INTO mail_rules (id, account_id, folder, scope_id, position,
                                  created_at, updated_at)
          VALUES (${id}, ${compte}, 'INBOX/Escola', ${ids.scope}, 'a1', ${NOW}, ${NOW})
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
