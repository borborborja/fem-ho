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
import {
  createMailAccount,
  createMailRule,
  deleteMailAccount,
  deleteMailRule,
  listMailAccounts,
  listMailRules,
  updateMailAccount,
  updateMailRule,
} from '../services/mail.js';
import { body, handle, num, str } from './handle.js';

const bool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

const security = (value: unknown): 'tls' | 'starttls' | undefined =>
  value === 'starttls' ? 'starttls' : value === 'tls' ? 'tls' : undefined;

const action = (value: unknown): 'inbox' | 'task' | undefined =>
  value === 'task' ? 'task' : value === 'inbox' ? 'inbox' : undefined;

/** El propòsit del segell. Una constant perquè crear i obrir no puguin divergir. */
const purpose = (id: string): string => `mail_account:${id}`;

export function registerMailRoutes(app: FastifyInstance, secret: () => string): void {
  const db = (): NonNullable<FastifyInstance['connection']> => app.connection!;

  app.get('/api/v1/mail/accounts', async (request, reply) =>
    handle(app, request, reply, async (principal) => listMailAccounts(db().db, principal)),
  );

  app.post('/api/v1/mail/accounts', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const input = body(request);
      const id = str(input.id) ?? uuidv7();
      const password = str(input.password);

      const result = await auditedTransaction(db().db, principal, (ctx) =>
        createMailAccount(ctx, principal, {
          id,
          name: str(input.name),
          host: str(input.host),
          port: num(input.port),
          security: security(input.security),
          username: str(input.username),
          secret_enc:
            password !== undefined && password !== ''
              ? seal(secret(), purpose(id), password)
              : undefined,
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
      const password = str(input.password);
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
            password !== undefined && password !== ''
              ? seal(secret(), purpose(request.params.id), password)
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

      const enviada = str(input.password);
      let password = enviada ?? '';
      if (password === '') {
        if (!account.has_secret) {
          throw new PolicyError(
            'mail-secret-required',
            'Password required',
            422,
            'Aquest compte encara no té contrasenya desada: escriu-la per provar-la.',
          );
        }
        password = await openStored(app, secret(), principal, account.id);
      }

      try {
        return await probeImap(
          {
            host: account.host,
            port: account.port,
            security: account.security,
            username: account.username,
            password,
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
          action: action(input.action),
          inbox_visible: bool(input.inbox_visible),
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
          action: action(input.action),
          inbox_visible: bool(input.inbox_visible),
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
