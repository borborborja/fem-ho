/**
 * El cicle de lectura del correu, **contra un client fals injectat**.
 *
 * No contra xarxa mocada: un mock de `fetch` prova el mock. El que aquí ha de ser cert és
 * el cicle, i el cicle no necessita cap servidor —a canvi, obliga a dissenyar sobre una
 * interfície, que de propina és l'assegurança que `imapflow` només toqui un fitxer.
 *
 * El primer cas és el que decideix si això es pot desplegar a casa d'algú: **una carpeta
 * de deu mil missatges n'ingereix zero la primera vegada**. Sense això, mapar una etiqueta
 * amb dotze anys de correu crea desenes de milers de tasques i no hi ha desfer massiu.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, beforeAll, describe, expect, it } from 'vitest';
import { connect, type Connection } from '../db/connection.js';
import { migrateToLatest } from '../db/migrator.js';
import type { MailBody, MailClient, MailHeader, MailboxStatus } from '../net/mail-client.js';
import { backoffSeconds, pollMail, pruneMail } from './mail-poll.js';

const tmp = mkdtempSync(join(tmpdir(), 'femho-mailpoll-'));
const NOW = '2026-08-11T10:00:00.000Z';

let conn: Connection;
let userId: string;
let scopeId: string;
let accountId: string;

/** Un servidor de mentida amb el que calgui a dins. Compta les crides que importen. */
class ServidorFals implements MailClient {
  status: MailboxStatus = { uidValidity: '1', uidNext: '1', exists: 0 };
  headers: MailHeader[] = [];
  bodies = new Map<string, MailBody>();
  descarregues: string[] = [];
  obertes: string[] = [];
  tancat = false;

  listFolders = async (): Promise<{ path: string; delimiter: string }[]> => [
    { path: 'INBOX', delimiter: '/' },
  ];

  openFolder = async (path: string): Promise<MailboxStatus> => {
    this.obertes.push(path);
    return this.status;
  };

  fetchHeaders = async (_path: string, sinceUid: string, limit: number): Promise<MailHeader[]> =>
    this.headers.filter((h) => Number(h.uid) > Number(sinceUid)).slice(0, limit);

  fetchBody = async (_path: string, uid: string): Promise<MailBody> => {
    this.descarregues.push(uid);
    return this.bodies.get(uid) ?? { text: 'un cos', html: null, attachments: [] };
  };

  fitxers = new Map<string, Uint8Array>();
  baixats: string[] = [];

  fetchAttachment = async (
    _path: string,
    uid: string,
    part: string,
    maxBytes: number,
  ): Promise<Uint8Array | null> => {
    this.baixats.push(`${uid}:${part}`);
    const data = this.fitxers.get(`${uid}:${part}`) ?? null;
    return data !== null && data.length > maxBytes ? null : data;
  };

  close = async (): Promise<void> => {
    this.tancat = true;
  };
}

function sobre(uid: string, over: Partial<MailHeader> = {}): MailHeader {
  return {
    uid,
    messageId: `<${uid}@escola.test>`,
    inReplyTo: null,
    references: [],
    subject: `Assumpte ${uid}`,
    fromName: 'Escola',
    fromAddress: 'secretaria@escola.test',
    toAddresses: ['borja@example.com'],
    internalDate: NOW,
    sentAt: NOW,
    size: 4096,
    hasHtml: false,
    ...over,
  };
}

let servidor: ServidorFals;

const córrer = async (now = NOW): Promise<Awaited<ReturnType<typeof pollMail>>> =>
  pollMail({ db: conn.db, openClient: async () => servidor, now: () => now });

const missatges = async (): Promise<{ message_key: string; disposition: string; uid: string }[]> =>
  (
    await sql<{ message_key: string; disposition: string; uid: string }>`
      SELECT message_key, disposition, uid FROM mail_messages ORDER BY uid
    `.execute(conn.db)
  ).rows;

/**
 * Una regla. **Ja no hi ha `action`**: cap regla converteix res sola, i el que es tria és si
 * el que arriba es veu a l'inbox de Tasques o només al calendari.
 */
async function regla(folder = 'INBOX'): Promise<string> {
  const id = uuidv7();
  await sql`
    INSERT INTO mail_rules (id, account_id, folder, scope_id, position,
                            created_at, updated_at)
    VALUES (${id}, ${accountId}, ${folder}, ${scopeId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);
  return id;
}

beforeAll(async () => {
  conn = connect(`sqlite://${join(tmp, 'test.db')}`);
  await migrateToLatest(conn.db, { engine: 'sqlite' });

  userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, created_at, updated_at)
    VALUES (${userId}, 'poll@example.com', 'Borja', 'x', 'human', 'admin', ${NOW}, ${NOW})
  `.execute(conn.db);
  scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, 'Casa', 'individual', '--plou-pink', ${userId}, 'a1', ${NOW}, ${NOW})
  `.execute(conn.db);
});

beforeEach(async () => {
  servidor = new ServidorFals();
  // `tasks` primer: hi ha files que apunten a `mail_accounts` i la clau forana ho vigila.
  for (const taula of [
    'attachments',
    'comments',
    'activity_log',
    'change_log',
    'mail_messages',
    'mail_threads',
    'mail_rules',
    'tasks',
    'mail_accounts',
  ]) {
    await sql.raw(`DELETE FROM ${taula}`).execute(conn.db);
  }

  accountId = uuidv7();
  await sql`
    INSERT INTO mail_accounts (id, user_id, name, host, username, secret_enc,
                               created_at, updated_at)
    VALUES (${accountId}, ${userId}, 'Personal', 'imap.escola.test', 'borja', 'segellat',
            ${NOW}, ${NOW})
  `.execute(conn.db);
});

afterAll(async () => {
  await conn.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('la primera lectura', () => {
  it("una carpeta de deu mil missatges n'ingereix zero", async () => {
    /**
     * **El risc número u de tota la funció**, i el que cau primer si algú «arregla» el
     * cursor inicial. Milers de tasques a un àmbit real, i cap desfer massiu.
     */
    await regla();
    servidor.status = { uidValidity: '7', uidNext: '10001', exists: 10_000 };
    servidor.headers = Array.from({ length: 10_000 }, (_, i) => sobre(String(i + 1)));

    const result = await córrer();

    expect(result.ingested).toBe(0);
    expect(await missatges()).toHaveLength(0);
    // I **ni tan sols s'han demanat els sobres**: no és que s'ingereixin i es descartin.
    expect(servidor.descarregues).toHaveLength(0);

    const cursor = await sql<{ last_uid: string; uid_validity: string }>`
      SELECT last_uid, uid_validity FROM mail_rules
    `.execute(conn.db);
    expect(cursor.rows[0]?.last_uid).toBe('10000');
    expect(cursor.rows[0]?.uid_validity).toBe('7');
  });

  it('i a partir d’aquí sí que entra el que arriba de nou', async () => {
    await regla();
    servidor.status = { uidValidity: '7', uidNext: '101', exists: 100 };
    servidor.headers = Array.from({ length: 100 }, (_, i) => sobre(String(i + 1)));
    await córrer();

    servidor.status = { uidValidity: '7', uidNext: '102', exists: 101 };
    servidor.headers = [...servidor.headers, sobre('101')];
    const result = await córrer('2026-08-11T11:00:00.000Z');

    expect(result.ingested).toBe(1);
    expect((await missatges()).map((m) => m.uid)).toEqual(['101']);
  });
});

describe('la segona passada', () => {
  it('no ingereix res', async () => {
    await regla();
    servidor.status = { uidValidity: '7', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '7', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1')];
    expect((await córrer('2026-08-11T11:00:00.000Z')).ingested).toBe(1);

    // Res nou al servidor: res nou aquí, i cap descàrrega de més.
    const abans = servidor.descarregues.length;
    expect((await córrer('2026-08-11T12:00:00.000Z')).ingested).toBe(0);
    expect(servidor.descarregues).toHaveLength(abans);
  });

  it('i un UIDVALIDITY nou rescaneja sense duplicar res', async () => {
    /**
     * Quan el servidor reindexa, el protocol diu «oblida tots els UID que t'he donat». Es
     * torna a mirar la carpeta sencera **amb UID nous**, i el que evita que cada tasca es
     * dupliqui és que la identitat és el `Message-ID` i no l'UID.
     */
    await regla();
    servidor.status = { uidValidity: '7', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '7', uidNext: '3', exists: 2 };
    servidor.headers = [sobre('1'), sobre('2')];
    await córrer('2026-08-11T11:00:00.000Z');
    expect(await missatges()).toHaveLength(2);

    // Reindexació: mateixos correus, UID completament diferents.
    servidor.status = { uidValidity: '99', uidNext: '5003', exists: 2 };
    servidor.headers = [
      sobre('5001', { messageId: '<1@escola.test>' }),
      sobre('5002', { messageId: '<2@escola.test>' }),
    ];
    const result = await córrer('2026-08-11T12:00:00.000Z');

    expect(result.ingested).toBe(0);
    expect(await missatges()).toHaveLength(2);
  });
});

describe('el que no entra', () => {
  it('un missatge de 30 MB se salta, i es veu', async () => {
    /**
     * **Es desa la fila igualment.** Un correu que no ha entrat s'ha de poder veure: si no,
     * l'usuari només sap que «no ha arribat» i no hi ha res a mirar.
     */
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1', { size: 30 * 1024 * 1024 })];
    await córrer('2026-08-11T11:00:00.000Z');

    const files = await missatges();
    expect(files).toHaveLength(1);
    expect(files[0]?.disposition).toBe('skipped');
    // I **no s'ha baixat**: la porta es tanca abans de demanar-lo, no després.
    expect(servidor.descarregues).toHaveLength(0);
  });

  it('una carpeta sense regla no es llegeix, i un compte sense cap no es connecta', async () => {
    // El correu d'algú és seu, i «per si de cas» no és una raó per copiar-lo al disc.
    servidor.status = { uidValidity: '1', uidNext: '50', exists: 49 };
    servidor.headers = [sobre('1')];

    const result = await córrer();
    expect(result.ingested).toBe(0);
    expect(servidor.obertes).toHaveLength(0);
  });
});

describe('el fil', () => {
  it('una resposta a una conversa que ja té tasca es desa com a comentari', async () => {
    /**
     * I **no obre una segona tasca**: si no, respondre un correu et partiria el fil en
     * dues coses a fer amb el mateix assumpte.
     */
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    const tasca = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, source_kind,
                         mail_account_id, mail_thread_key, created_by, created_at, updated_at)
      VALUES (${tasca}, ${scopeId}, 'D’un correu', 'inbox', 'a1', 'native', 'mail',
              ${accountId}, 'mid:arrel@escola.test', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [
      sobre('1', { messageId: '<resposta@escola.test>', references: ['<arrel@escola.test>'] }),
    ];
    await córrer('2026-08-11T11:00:00.000Z');

    const files = await missatges();
    expect(files).toHaveLength(1);
    expect(files[0]?.disposition).toBe('comment');

    const tasques = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM tasks`.execute(conn.db);
    expect(Number(tasques.rows[0]?.n)).toBe(1);
  });
});

describe('quan falla', () => {
  it("l'error va a la fila i la retirada creix", async () => {
    await regla();
    const trencat: MailClient = {
      listFolders: async () => [],
      openFolder: async () => {
        throw new Error('AUTHENTICATIONFAILED');
      },
      fetchHeaders: async () => [],
      fetchBody: async () => ({ text: null, html: null, attachments: [] }),
      fetchAttachment: async () => null,
      close: async () => undefined,
    };

    const result = await pollMail({
      db: conn.db,
      openClient: async () => trencat,
      now: () => NOW,
    });
    expect(result.errors).toBe(1);

    const compte = await sql<{ consecutive_errors: number; last_error: string | null }>`
      SELECT consecutive_errors, last_error FROM mail_accounts WHERE id = ${accountId}
    `.execute(conn.db);
    expect(Number(compte.rows[0]?.consecutive_errors)).toBe(1);
    // A la fila i no només al registre: sense això, un compte caigut es veu igual que un
    // que no rep correu.
    expect(compte.rows[0]?.last_error).toContain('AUTHENTICATIONFAILED');
  });

  it('i mentre dura la retirada, no es torna a trucar', async () => {
    /**
     * Reintentar una contrasenya errònia cada cinc minuts contra un proveïdor gros és
     * literalment com es bloqueja un compte.
     */
    await regla();
    await sql`
      UPDATE mail_accounts SET consecutive_errors = 4, last_polled_at = ${NOW}
      WHERE id = ${accountId}
    `.execute(conn.db);

    const result = await córrer('2026-08-11T10:05:00.000Z');
    expect(result.polled).toBe(0);
    expect(servidor.obertes).toHaveLength(0);
  });
});

describe('la corba de la retirada', () => {
  it('creix i para a sis hores', () => {
    expect(backoffSeconds(0)).toBe(300);
    expect(backoffSeconds(1)).toBe(600);
    expect(backoffSeconds(2)).toBe(1200);
    expect(backoffSeconds(20)).toBe(6 * 3600);
  });
});

describe('res es converteix sol', () => {
  it('un correu que arriba **no crea cap tasca**', async () => {
    /**
     * **La invariant del producte, i el que aquesta tanda va venir a arreglar.**
     *
     * Abans una regla podia dir «converteix-ho en tasca», i llavors el que et posava coses
     * a la llista de feina era una carpeta de correu. El model és el contrari: el que
     * arriba d'una font és **un element que pots convertir**, i qui converteix ets tu.
     */
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1', { subject: 'La factura de març' })];
    servidor.bodies.set('1', { text: 'Us adjuntem la factura.', html: null, attachments: [] });
    await córrer('2026-08-11T11:00:00.000Z');

    const tasques = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM tasks`.execute(conn.db);
    expect(Number(tasques.rows[0]?.n)).toBe(0);

    // I hi és, a la bústia, esperant que algú decideixi.
    const files = await missatges();
    expect(files).toHaveLength(1);
    expect(files[0]?.disposition).toBe('inbox');
  });

  it("i el cos s'hi desa igualment, per si el converteixes", async () => {
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1')];
    servidor.bodies.set('1', { text: 'El cos del correu.', html: null, attachments: [] });
    await córrer('2026-08-11T11:00:00.000Z');

    const cos = await sql<{ body_text: string | null }>`
      SELECT body_text FROM mail_messages
    `.execute(conn.db);
    expect(cos.rows[0]?.body_text).toBe('El cos del correu.');
  });
});

describe('el fil, quan ja hi ha tasca', () => {
  it('la resposta hi deixa un comentari i no obre una segona tasca', async () => {
    /**
     * **L'únic automatisme que queda**, i hi és per no partir la feina: si una resposta
     * obrís una tasca nova, respondre un correu et duplicaria la feina cada vegada.
     */
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    const tasca = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, source_kind,
                         mail_account_id, mail_thread_key, created_by, created_at, updated_at)
      VALUES (${tasca}, ${scopeId}, 'D’un correu', 'inbox', 'a1', 'native', 'mail',
              ${accountId}, 'mid:arrel@escola.test', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [
      sobre('1', {
        messageId: '<resposta@escola.test>',
        references: ['<arrel@escola.test>'],
        subject: 'Re: la factura',
      }),
    ];
    servidor.bodies.set('1', { text: 'Doncs ja està pagada.', html: null, attachments: [] });
    await córrer('2026-08-11T11:00:00.000Z');

    const tasques = await sql<{ n: number }>`SELECT COUNT(*) AS n FROM tasks`.execute(conn.db);
    expect(Number(tasques.rows[0]?.n)).toBe(1);

    const comentaris = await sql<{ body: string }>`SELECT body FROM comments`.execute(conn.db);
    expect(comentaris.rows).toHaveLength(1);
    // Amb **el remitent de debò**, el del correu i no el de cap plantilla.
    expect(comentaris.rows[0]?.body).toContain('Escola');
    expect(comentaris.rows[0]?.body).toContain('ja està pagada');

    expect((await missatges())[0]?.disposition).toBe('comment');
  });

  it('i si la tasca ja no hi és, el correu cau a la bústia i prou', async () => {
    /**
     * **Ni tan sols aquí es crea res.** La tasca s'ha esborrat entre que el correu va
     * arribar i que va passar el tic: la resposta no té on comentar, i el que toca és
     * deixar-la a la bústia —no obrir una tasca que ningú ha demanat.
     */
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    const tasca = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, source_kind,
                         mail_account_id, mail_thread_key, created_by, created_at, updated_at)
      VALUES (${tasca}, ${scopeId}, 'Ja esborrada', 'inbox', 'a1', 'native', 'mail',
              ${accountId}, 'mid:arrel@escola.test', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [
      sobre('1', { messageId: '<resp@escola.test>', references: ['<arrel@escola.test>'] }),
    ];
    // S'esborra just abans que el tic hi arribi.
    await sql`UPDATE tasks SET deleted_at = ${NOW} WHERE id = ${tasca}`.execute(conn.db);
    await córrer('2026-08-11T11:00:00.000Z');

    const vives = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL
    `.execute(conn.db);
    expect(Number(vives.rows[0]?.n)).toBe(0);
    expect((await missatges())[0]?.disposition).toBe('inbox');
  });
});

describe('els adjunts', () => {
  it("es baixen en arribar, i el nom i el tipus queden nets d'entrada", async () => {
    /**
     * **Es baixen encara que ningú hagi convertit res**, i és una tria amb motiu. Fer-ho en
     * convertir voldria dir xarxa dins d'una petició —i la conversió fallaria amb el
     * servidor de correu caigut, just al pitjor moment—, i un correu esborrat de la bústia
     * d'origen s'enduria els fitxers.
     *
     * El nom i el tipus es decideixen **un sol cop, quan tenim els bytes**: `safeFilename`
     * sobre el que deia el correu, i el tipus ensumat dels bytes amb el `Content-Type`
     * declarat llençat. Servir un fitxer amb el tipus que diu un desconegut és XSS
     * emmagatzemat des del teu propi domini.
     */
    const dades = mkdtempSync(join(tmpdir(), 'femho-adjunts-'));
    const córrerAmbDisc = async (now: string): Promise<void> => {
      await pollMail({
        db: conn.db,
        openClient: async () => servidor,
        now: () => now,
        dataDir: dades,
      });
    };

    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrerAmbDisc(NOW);

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1')];
    servidor.bodies.set('1', {
      text: 'La factura.',
      html: null,
      attachments: [
        {
          filename: '../../factura.pdf',
          contentType: 'application/pdf',
          size: 4,
          inline: false,
          part: '2',
        },
      ],
    });
    // `MZ` és la signatura d'un executable de Windows.
    servidor.fitxers.set('1:2', new Uint8Array([0x4d, 0x5a, 0x90, 0x00]));

    await córrerAmbDisc('2026-08-11T11:00:00.000Z');

    const fila = await sql<{ attachments: string | null }>`
      SELECT attachments FROM mail_messages
    `.execute(conn.db);
    const desats = JSON.parse(fila.rows[0]?.attachments ?? '[]') as {
      filename: string;
      mime_type: string;
      storage_path: string;
    }[];

    expect(desats).toHaveLength(1);
    // El nom no pot sortir de la seva carpeta.
    expect(desats[0]?.filename).not.toContain('..');
    // I el tipus no és el que deia el correu.
    expect(desats[0]?.mime_type).not.toBe('application/pdf');
    // Els bytes són a disc, i la fila diu on.
    expect(existsSync(join(dades, desats[0]!.storage_path))).toBe(true);

    /**
     * I **encara no hi ha cap adjunt de tasca**: no hi ha tasca. Les files d'`attachments`
     * apareixen quan algú converteix, que és quan hi ha on penjar-les.
     */
    const penjats = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM attachments
    `.execute(conn.db);
    expect(Number(penjats.rows[0]?.n)).toBe(0);

    rmSync(dades, { recursive: true, force: true });
  });

  it("i sense `dataDir` no se'n baixa cap: no hi hauria on posar-los", async () => {
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1')];
    servidor.bodies.set('1', {
      text: 'Text',
      html: null,
      attachments: [
        { filename: 'a.pdf', contentType: 'application/pdf', size: 4, inline: false, part: '2' },
      ],
    });
    servidor.fitxers.set('1:2', new Uint8Array([1, 2, 3, 4]));
    await córrer('2026-08-11T11:00:00.000Z');

    expect(servidor.baixats).toHaveLength(0);
    const fila = await sql<{ attachments: string | null }>`
      SELECT attachments FROM mail_messages
    `.execute(conn.db);
    expect(fila.rows[0]?.attachments).toBeNull();
  });
});

describe('la retenció', () => {
  it('purga el cos del correu i **mai la tasca**', async () => {
    /**
     * És el motiu pel qual `tasks.mail_thread_key` i `mail_message_key` són claus i no
     * claus foranes: amb una clau forana, purgar obligaria a triar entre trencar-la i
     * esborrar tasques d'algú. La tasca és teva; el correu és el que caduca.
     */
    await regla();
    servidor.status = { uidValidity: '1', uidNext: '1', exists: 0 };
    await córrer();

    servidor.status = { uidValidity: '1', uidNext: '2', exists: 1 };
    servidor.headers = [sobre('1')];
    servidor.bodies.set('1', { text: 'Un cos que caducarà.', html: null, attachments: [] });
    await córrer('2026-08-11T11:00:00.000Z');

    // Una tasca feta a mà a partir d'aquell correu: ara la conversió sempre la demana algú.
    const tasca = uuidv7();
    await sql`
      INSERT INTO tasks (id, scope_id, title, status, position, origin, source_kind,
                         mail_account_id, mail_message_key, created_by, created_at, updated_at)
      VALUES (${tasca}, ${scopeId}, 'D’un correu', 'inbox', 'a1', 'native', 'mail',
              ${accountId}, 'mid:1@escola.test', ${userId}, ${NOW}, ${NOW})
    `.execute(conn.db);

    const purgats = await pruneMail(conn.db, '2026-12-31T00:00:00.000Z', 30);
    expect(purgats).toBe(1);

    const missatge = await sql<{ body_text: string | null }>`
      SELECT body_text FROM mail_messages
    `.execute(conn.db);
    expect(missatge.rows[0]?.body_text).toBeNull();
    /**
     * **I la fila hi segueix.** Si s'esborrés, la pròxima reindexació del servidor tornaria
     * a ingerir el mateix correu i en tornaria a sortir un element a la bústia.
     */
    expect(missatge.rows).toHaveLength(1);

    const queda = await sql<{ title: string; source_kind: string | null }>`
      SELECT title, source_kind FROM tasks
    `.execute(conn.db);
    expect(queda.rows).toHaveLength(1);
    expect(queda.rows[0]?.source_kind).toBe('mail');
  });

  it('i amb 0 dies no purga res: 0 vol dir per sempre', async () => {
    expect(await pruneMail(conn.db, '2026-12-31T00:00:00.000Z', 0)).toBe(0);
  });
});
