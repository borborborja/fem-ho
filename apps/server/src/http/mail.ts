/**
 * Rutes del correu com a font d'entrada.
 *
 * **LA CONTRASENYA ES XIFRA AQUÍ I NO VIATJA MAI MÉS**
 * ----------------------------------------------------
 * Igual que als calendaris: el segell es fa a la ruta i no al servei, perquè el secret de
 * la instància és de l'app —el servei no ha de conèixer ni la configuració ni el disc—. I
 * l'identificador es fixa **abans** de xifrar, perquè el secret es lliga a
 * `mail_account:<id>`: si el servei en generés un altre després, la contrasenya no es
 * podria desxifrar mai més i el compte fallaria en silenci a cada lectura.
 *
 * Cap resposta d'aquest fitxer porta la contrasenya en cap forma, **ni emmascarada**: una
 * màscara filtra la longitud i el prefix, i el que es dona és `has_secret`.
 */

import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { open, seal } from '../crypto/secret-box.js';
import { SsrfError } from '../dav/fetch-safe.js';
import { probeImap } from '../net/imap-connect.js';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { convertOwnMail } from '../services/mail-convert-http.js';
import { dismissMail } from '../services/mail-convert.js';
import {
  createMailAccount,
  createMailRule,
  deleteMailAccount,
  deleteMailRule,
  listMailAccounts,
  listMailRules,
  listInboxMail,
  setMailInboxVisibility,
  updateMailAccount,
  updateMailRule,
} from '../services/mail.js';
import { body, handle, ids, num, query, str } from './handle.js';

const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const security = (value: unknown): 'tls' | 'starttls' | undefined =>
  value === 'starttls' ? 'starttls' : value === 'tls' ? 'tls' : undefined;

/**
 * `inbox_visible`, amb el tri-estat sencer.
 *
 * **Es mira si la clau HI ÉS i no només el seu tipus**: `{ inbox_visible: null }` vol dir
 * «treu l'excepció» i s'ha de distingir de no enviar-la, que vol dir «no ho toquis». Sense
 * el `null` no hi hauria manera de desdir-se'n, i la carpeta es quedaria clavada al valor
 * que se li va posar encara que el defecte canviés. Mateix patró que als calendaris.
 */
const inboxVisible = (input: Record<string, unknown>): boolean | null | undefined =>
  'inbox_visible' in input
    ? typeof input.inbox_visible === 'boolean'
      ? input.inbox_visible
      : null
    : undefined;

/** El propòsit del segell. Una constant perquè crear i obrir no puguin divergir. */
const purpose = (id: string): string => `mail_account:${id}`;

/**
 * La contrasenya que arriba, **sense els espais dels extrems**.
 *
 * EL DEFECTE QUE EXISTEIX PER ATURAR
 * ----------------------------------
 * Una contrasenya d'aplicació es copia i s'enganxa, i el que s'enganxa sovint porta un
 * espai o un salt de línia al final: el navegador el fica al camp, el camp no el dibuixa, i
 * el que veus és **exactament** el que hauries d'haver escrit. El servidor la desa sencera,
 * el servidor de correu la rebutja, i el missatge que en surt és «l'usuari o la contrasenya
 * no són correctes» —que és cert i no serveix de res, perquè la contrasenya que llegeixes a
 * la pantalla ÉS la bona.
 *
 * Va passar el primer dia que es va configurar un compte de debò, amb Fastmail: la desada
 * tenia disset caràcters i les d'aplicació de Fastmail en tenen setze.
 *
 * **Es retallen els dos extrems i es diu al contracte**, en comptes de fer-ho en silenci:
 * una contrasenya amb un espai volgut a la punta existeix en teoria, i qui en tingui una ha
 * de poder llegir per què no li funciona en comptes de descobrir-ho mai.
 */
function password(input: Record<string, unknown>): string | undefined {
  const raw = str(input.password);
  return raw === undefined ? undefined : raw.trim();
}

export function registerMailRoutes(app: FastifyInstance, secret: () => string): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get('/api/v1/mail/accounts', async (request, reply) =>
    handle(app, request, reply, async (principal) => listMailAccounts(db().db, principal)),
  );

  app.post('/api/v1/mail/accounts', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const id = str(input.id) ?? uuidv7();
      const clau = password(input);

      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createMailAccount(ctx, principal, {
          id,
          name: str(input.name),
          host: str(input.host),
          port: num(input.port),
          security: security(input.security),
          username: str(input.username),
          secret_enc:
            clau !== undefined && clau !== '' ? seal(secret(), purpose(id), clau) : undefined,
          poll_interval: 'poll_interval' in input ? (num(input.poll_interval) ?? null) : undefined,
          enabled: bool(input.enabled),
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.account;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/mail/accounts/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const clau = password(input);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateMailAccount(ctx, principal, request.params.id, {
          name: str(input.name),
          host: str(input.host),
          port: num(input.port),
          security: security(input.security),
          username: str(input.username),
          // Buida vol dir «no la toquis», no «esborra-la»: el formulari no la torna a
          // ensenyar mai, i canviar el nom del compte no ha de perdre'n les credencials.
          secret_enc:
            clau !== undefined && clau !== ''
              ? seal(secret(), purpose(request.params.id), clau)
              : undefined,
          poll_interval: 'poll_interval' in input ? (num(input.poll_interval) ?? null) : undefined,
          enabled: bool(input.enabled),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/mail/accounts/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteMailAccount(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );

  /**
   * Provar la connexió. **No desa res.**
   *
   * És el botó que `docs/11` ja reclama per a l'SMTP, i pel mateix motiu: sense ell,
   * l'única manera de saber si unes credencials van bé és desar-les, esperar el cicle
   * següent i anar a mirar els registres del servidor.
   *
   * Tres coses que val la pena veure juntes:
   *
   * - **La contrasenya es pot enviar al cos** per provar-la abans de desar-la. Si no
   *   s'envia, es fa servir la desada, i llavors s'obre aquí —dins de la ruta, que és on
   *   viu el secret de la instància.
   * - **Un compte sense contrasenya no arriba a connectar-se.** Provar-ho seria enviar
   *   l'usuari amb una cadena buida a un servidor de fora.
   * - **Una adreça interna dona 422 i no un resultat.** No és «ha anat malament»: és una
   *   petició que no es pot fer, i la diferència importa perquè un `ok: false` convida a
   *   tornar-ho a provar.
   */
  app.post<{ Params: { id: string } }>('/api/v1/mail/accounts/:id/test', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const accounts = await listMailAccounts(db().db, principal);
      const account = accounts.find((a) => a.id === request.params.id);
      if (account === undefined) {
        throw new PolicyError(
          'mail-account-not-found',
          'Not found',
          404,
          'Aquest compte de correu no existeix.',
        );
      }

      const enviada = password(input);
      let clau = enviada ?? '';
      if (clau === '') {
        if (!account.has_secret) {
          throw new PolicyError(
            'mail-secret-required',
            'Password required',
            422,
            'Aquest compte encara no té contrasenya desada: escriu-la per provar-la.',
          );
        }
        clau = await openStored(app, secret(), principal, account.id);
      }

      try {
        return await probeImap(
          {
            host: account.host,
            port: account.port,
            security: account.security,
            username: account.username,
            password: clau,
          },
          { allowHosts: app.config.mailAllowHosts },
        );
      } catch (error) {
        if (error instanceof SsrfError) {
          throw new PolicyError('mail-host-not-allowed', 'Host not allowed', 422, error.message);
        }
        throw error;
      }
    }),
  );

  /**
   * Fer una tasca d'un correu de la bústia.
   *
   * La destinació **surt de la regla que el va fer entrar**, no del cos de la petició: si
   * es pogués triar aquí, el client podria enviar correu a un àmbit que la regla no vol i
   * la barrera entre un text hostil i el sistema seria una decisió de la interfície.
   */
  app.post<{ Params: { id: string } }>(
    '/api/v1/mail/messages/:id/convert',
    async (request, reply) =>
      handle(app, request, reply, async (principal) =>
        auditedTransaction(db().db, principal, (ctx) =>
          convertOwnMail(ctx, principal, request.params.id),
        ),
      ),
  );

  /**
   * Fer visible o invisible un correu a l'inbox de Tasques.
   *
   * **Bessona de `POST /inbox/events`**, i a posta: un correu i una cita són coses diferents
   * i la pregunta «vull veure això a la meva llista?» és la mateixa. Amagar-lo **no
   * l'esborra i no el treu del calendari**: és des d'allà que el pots tornar a pujar.
   */
  app.post('/api/v1/inbox/mail', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        setMailInboxVisibility(
          ctx,
          principal,
          str(input.message_id) ?? '',
          // Absent o nul volen dir el mateix: treu l'excepció i torna a manar la carpeta.
          typeof input.visible === 'boolean' ? input.visible : null,
        ),
      );
    }),
  );

  /**
   * Els correus d'un interval, per a la graella del calendari.
   *
   * El calendari els pinta **al dia que van arribar**, i per això necessita un interval i no
   * un dia: la vista mensual en demana trenta-un de cop. Porta els no visibles igualment
   * —difuminats— perquè el calendari és l'organitzador i hi ha de sortir tot.
   */
  app.get('/api/v1/mail/messages', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const q = query(request);
      return listInboxMail(db().db, principal, {
        from: str(q.from),
        to: str(q.to),
        scopeIds: ids(q.scope_ids),
        includeHidden: true,
      });
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/mail/messages/:id/dismiss',
    async (request, reply) =>
      handle(app, request, reply, async (principal) => {
        await auditedTransaction(db().db, principal, async (ctx) => {
          await dismissMail(ctx, request.params.id, principal.userId);
          // Descartar no és un canvi d'estat del producte: no toca cap tasca ni cap àmbit,
          // i el correu segueix sencer a la bústia de veritat.
          ctx.noChange();
        });
        void reply.code(204).send();
        return undefined;
      }),
  );

  /**
   * Les carpetes del servidor, per poder-les triar en comptes d'escriure-les.
   *
   * És la mateixa connexió que `/test` i **tampoc desa res**. Va a part perquè la pregunta
   * és una altra: allà preguntes «van bé les credencials?», aquí «quines carpetes hi ha?»,
   * i el formulari de regla necessita la segona sense haver de fer la primera.
   */
  app.get<{ Params: { id: string } }>('/api/v1/mail/accounts/:id/folders', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const accounts = await listMailAccounts(db().db, principal);
      const account = accounts.find((a) => a.id === request.params.id);
      if (account === undefined || !account.has_secret) {
        throw new PolicyError(
          'mail-account-not-found',
          'Not found',
          404,
          'Aquest compte de correu no existeix, o encara no té contrasenya.',
        );
      }

      try {
        const probe = await probeImap(
          {
            host: account.host,
            port: account.port,
            security: account.security,
            username: account.username,
            password: await openStored(app, secret(), principal, account.id),
          },
          { allowHosts: app.config.mailAllowHosts },
        );
        return { folders: probe.folders, delimiter: probe.delimiter, error: probe.error };
      } catch (error) {
        if (error instanceof SsrfError) {
          throw new PolicyError('mail-host-not-allowed', 'Host not allowed', 422, error.message);
        }
        throw error;
      }
    }),
  );

  app.get('/api/v1/mail/rules', async (request, reply) =>
    handle(app, request, reply, async (principal) => listMailRules(db().db, principal)),
  );

  app.post('/api/v1/mail/rules', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createMailRule(ctx, principal, {
          id: str(input.id),
          account_id: str(input.account_id),
          folder: str(input.folder),
          scope_id: str(input.scope_id),
          project_id: 'project_id' in input ? (str(input.project_id) ?? null) : undefined,
          inbox_visible: inboxVisible(input),
          title_template: str(input.title_template),
          body_to_description: bool(input.body_to_description),
          attachments_to_task: bool(input.attachments_to_task),
          position: str(input.position),
          enabled: bool(input.enabled),
        }),
      );
      void reply.code(result.created ? 201 : 200);
      return result.rule;
    }),
  );

  app.patch<{ Params: { id: string } }>('/api/v1/mail/rules/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      return auditedTransaction(db().db, principal, (ctx) =>
        updateMailRule(ctx, principal, request.params.id, {
          folder: str(input.folder),
          scope_id: str(input.scope_id),
          project_id: 'project_id' in input ? (str(input.project_id) ?? null) : undefined,
          inbox_visible: inboxVisible(input),
          title_template: str(input.title_template),
          body_to_description: bool(input.body_to_description),
          attachments_to_task: bool(input.attachments_to_task),
          position: str(input.position),
          enabled: bool(input.enabled),
        }),
      );
    }),
  );

  app.delete<{ Params: { id: string } }>('/api/v1/mail/rules/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      await auditedTransaction(db().db, principal, (ctx) =>
        deleteMailRule(ctx, principal, request.params.id),
      );
      void reply.code(204).send();
      return undefined;
    }),
  );
}

/**
 * Obre la contrasenya desada d'un compte.
 *
 * Va a part perquè **és l'única lectura del secret de tot el fitxer** i s'ha de poder
 * llegir d'una ullada: es demana per identificador **i per propietari**, es desxifra amb
 * el propòsit d'aquell identificador, i el text pla no surt d'aquí cap a cap resposta —el
 * rep `probeImap` i mor amb la connexió.
 *
 * El `user_id` a la consulta és redundant amb la comprovació que ja s'ha fet abans, i hi
 * és igualment: és l'última línia abans d'una contrasenya en clar, i no ha de dependre de
 * que qui l'ha cridada ho hagi fet bé.
 */
async function openStored(
  app: FastifyInstance,
  masterSecret: string,
  principal: Principal,
  accountId: string,
): Promise<string> {
  const found = await sql<{ secret_enc: string | null }>`
    SELECT secret_enc FROM mail_accounts
    WHERE id = ${accountId} AND user_id = ${principal.userId} AND deleted_at IS NULL
  `.execute(app.connection!.db);

  const sealed = found.rows[0]?.secret_enc;
  if (sealed === undefined || sealed === null || sealed === '') {
    throw new PolicyError(
      'mail-secret-required',
      'Password required',
      422,
      'Aquest compte encara no té contrasenya desada: escriu-la per provar-la.',
    );
  }

  try {
    return open(masterSecret, purpose(accountId), sealed);
  } catch {
    /**
     * Passa de veritat: si algú restaura una base sense restaurar el secret de la
     * instància, cap contrasenya no es pot obrir. **La frase ho ha de dir**, perquè el
     * símptoma —«totes les fonts han deixat d'anar»— no assenyala enlloc.
     */
    throw new PolicyError(
      'mail-secret-unreadable',
      'Password unreadable',
      500,
      "La contrasenya desada no es pot desxifrar amb el secret d'aquesta instància. Torna-la a escriure.",
    );
  }
}
