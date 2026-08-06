/**
 * Rutes de compartits (docs/10).
 *
 * Dues superfícies molt diferents:
 *
 * - `/api/v1/shares` — qui té compte crea, llista i revoca enllaços.
 * - `/s/:token` — **la pàgina pública**, sense compte, amb les seves pròpies regles de
 *   capçaleres i de registre.
 */

import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { PolicyError, unauthenticated } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { listComments } from '../services/comments.js';
import { listChecklists, updateChecklistItem } from '../services/checklists.js';
import {
  createShare,
  guestPrincipal,
  listShares,
  openShare,
  revokeShare,
  type SharePermission,
} from '../services/shares.js';
import { getTask } from '../services/tasks.js';
import { principalOf } from './auth.js';

/**
 * Les capçaleres pròpies de `/s/*`.
 *
 * El `Referrer-Policy: no-referrer` **no és aquí**: el posa el hook central d'`app.ts`
 * per a tot el que comenci per `/s/`. Si es posés a la ruta, el hook —que corre
 * després— el sobreescriuria amb el valor per defecte i el token acabaria viatjant al
 * referent d'un servidor de tercers (docs/10 §4).
 */
const PUBLIC_HEADERS = {
  // Una pàgina compartida no s'ha d'indexar ni guardar a cap memòria cau compartida.
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

/**
 * El token, anonimitzat per als registres.
 *
 * "El token **no** ha d'aparèixer als registres del servidor" (docs/10 §4). Es registra
 * un resum curt: prou per correlacionar dues línies del mateix enllaç, insuficient per
 * reconstruir-lo.
 */
export function anonymiseToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 8);
}

async function handle<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  work: (principal: Principal) => Promise<T>,
): Promise<T | undefined> {
  try {
    if (app.connection === undefined) throw unauthenticated('La instància no té base de dades.');
    return await work(await principalOf(app, request));
  } catch (error) {
    if (error instanceof PolicyError) {
      void reply
        .code(error.status)
        .type('application/problem+json')
        .send(error.toProblem(request.url));
      return undefined;
    }
    throw error;
  }
}

/**
 * El secret arriba com a funció i no com a valor: així no es llegeix del disc fins que
 * hi ha de debò una petició de compartits (veure `app.ts`).
 */
export type SecretProvider = () => string;

export function registerShareRoutes(app: FastifyInstance, secret: SecretProvider): void {
  app.get('/api/v1/shares', async (request, reply) =>
    handle(app, request, reply, async (principal) => ({
      data: await listShares(app.connection!.db, principal),
    })),
  );

  app.post('/api/v1/shares', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const result = await auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) =>
          createShare(
            ctx,
            principal,
            {
              task_id: typeof body.task_id === 'string' ? body.task_id : undefined,
              checklist_id: typeof body.checklist_id === 'string' ? body.checklist_id : undefined,
              permission:
                typeof body.permission === 'string'
                  ? (body.permission as SharePermission)
                  : undefined,
              password: typeof body.password === 'string' ? body.password : undefined,
              require_name: body.require_name === true,
              expires_at: typeof body.expires_at === 'string' ? body.expires_at : null,
              max_views: typeof body.max_views === 'number' ? body.max_views : null,
            },
            secret(),
          ),
        { engine: app.connection!.engine },
      );

      /**
       * **L'URL sencer va aquí i enlloc més.** El token no es pot recuperar del
       * `token_hmac`: si l'usuari el perd, ha de crear-ne un de nou, i la interfície
       * l'hi ha de dir en aquest moment (docs/10 §6).
       */
      void reply.code(201);
      return {
        url: `${app.config.baseUrl ?? ''}/s/${result.token}`,
        token: result.token,
        share: result.share,
      };
    }),
  );

  app.delete('/api/v1/shares/:id', async (request, reply) =>
    handle(app, request, reply, async (principal) => {
      const { id } = request.params as { id: string };
      await auditedTransaction(
        app.connection!.db,
        principal,
        (ctx) => revokeShare(ctx, principal, id),
        { engine: app.connection!.engine },
      );
      void reply.code(204);
      return undefined;
    }),
  );

  registerPublicRoutes(app, secret);
}

function registerPublicRoutes(app: FastifyInstance, secret: SecretProvider): void {
  /**
   * Obrir un enllaç.
   *
   * És un `POST` i no un `GET` perquè hi pot anar la contrasenya i el nom, i perquè
   * **incrementa el comptador de visites**: un `GET` que compta visites el dispararien
   * els precarregadors dels navegadors i els previsualitzadors de missatgeria.
   */
  app.post('/s/:token', async (request, reply) => {
    void reply.headers(PUBLIC_HEADERS);

    if (app.connection === undefined) {
      void reply.code(503).send({ error: 'La instància no té base de dades.' });
      return;
    }

    const { token } = request.params as { token: string };
    const body = (request.body ?? {}) as { password?: string; name?: string };

    // El token no arriba mai als registres sencer.
    request.log.info({ share: anonymiseToken(token) }, 'obrint un enllaç compartit');

    const result = await auditedTransaction(
      app.connection.db,
      systemPrincipal(),
      (ctx) =>
        openShare(
          ctx,
          {
            token,
            password: typeof body.password === 'string' ? body.password : undefined,
            name: typeof body.name === 'string' ? body.name : undefined,
          },
          secret(),
        ),
      { engine: app.connection.engine },
    );

    if (!result.ok) {
      if (result.reason === 'locked') {
        void reply
          .code(429)
          .header('Retry-After', String(Math.ceil((result.retryAfterMs ?? 60_000) / 1000)))
          .send({ reason: 'locked' });
        return;
      }

      /**
       * `401` i **la mateixa forma** tant si l'enllaç existeix com si no. Un `404` per a
       * un i un `401` per a l'altre deixaria enumerar-los (docs/10 §4).
       */
      void reply.code(401).send({ reason: result.reason });
      return;
    }

    const guest = guestPrincipal(result.share, result.guestRef, result.guestName);
    const content = await loadSharedContent(app, guest, result.share);

    void reply.code(200);
    return {
      permission: result.share.permission,
      guest_ref: result.guestRef,
      guest_label: guest.label,
      ...content,
    };
  });

  /**
   * Marcar un ítem des d'un enllaç.
   *
   * **Escriu a les dades reals** i deixa la seva entrada a `activity_log` amb
   * `actor_type='guest'` i `source='share'` (docs/10 §5). La cascada amunt s'aplica
   * igual: qui marca l'últim ítem de la maleta completa la subtasca com ho faria
   * qualsevol.
   */
  app.post('/s/:token/items/:itemId', async (request, reply) => {
    void reply.headers(PUBLIC_HEADERS);

    if (app.connection === undefined) {
      void reply.code(503).send({ error: 'La instància no té base de dades.' });
      return;
    }

    const { token, itemId } = request.params as { token: string; itemId: string };
    const body = (request.body ?? {}) as { done?: boolean; name?: string };

    request.log.info({ share: anonymiseToken(token) }, 'un convidat marca un ítem');

    const opened = await auditedTransaction(
      app.connection.db,
      systemPrincipal(),
      (ctx) =>
        openShare(
          ctx,
          { token, name: typeof body.name === 'string' ? body.name : undefined },
          secret(),
        ),
      { engine: app.connection.engine },
    );

    if (!opened.ok) {
      void reply.code(401).send({ reason: opened.reason });
      return;
    }

    const guest = guestPrincipal(opened.share, opened.guestRef, opened.guestName);
    if (!guest.capabilities.has('checklists:write')) {
      // Un enllaç de només veure no marca res, i el motiu és accionable.
      void reply.code(403).send({ reason: 'read-only' });
      return;
    }

    try {
      const result = await auditedTransaction(
        app.connection.db,
        guest,
        (ctx) => updateChecklistItem(ctx, guest, itemId, { done: body.done === true }),
        { engine: app.connection.engine },
      );
      void reply.code(200);
      return result;
    } catch (error) {
      if (error instanceof PolicyError) {
        void reply.code(error.status).send({ reason: error.type });
        return;
      }
      throw error;
    }
  });
}

/**
 * El principal amb què s'obre un enllaç.
 *
 * Obrir-lo escriu —el comptador de visites i la fila d'accés— i per tant necessita un
 * principal. **No és el convidat**: el convidat encara no existeix quan es fa aquesta
 * escriptura, i donar-li un principal abans d'haver validat la contrasenya seria
 * exactament al revés del que toca.
 */
function systemPrincipal(): Principal {
  return {
    kind: 'user',
    userId: '',
    capabilities: new Set(),
    scopeIds: new Set(),
    source: 'share',
  };
}

/** El contingut que veu el convidat, retallat al que l'enllaç deixa veure. */
async function loadSharedContent(
  app: FastifyInstance,
  guest: Principal,
  share: { task_id: string | null; checklist_id: string | null; permission: SharePermission },
): Promise<Record<string, unknown>> {
  const db = app.connection!.db;

  // El convidat travessa la MATEIXA capa de servei que tothom (regla 8): actua en nom
  // de qui va crear l'enllaç, i l'abast el marca l'enllaç.
  const owner = guest;

  if (share.task_id !== null) {
    const task = await getTask(db, owner, share.task_id);
    return {
      task,
      checklists: await listChecklists(db, owner, share.task_id),
      comments: share.permission === 'comment' ? await listComments(db, owner, share.task_id) : [],
    };
  }

  /**
   * Compartir una llista sola: se'n busca la tasca mare per poder-la llegir, i es
   * retalla a la llista que l'enllaç diu. `listChecklists` va per tasca perquè és com
   * es llegeixen sempre, i afegir-hi un filtre per llista només per a aquest cas seria
   * un paràmetre que gairebé mai s'hi passa.
   */
  const found = await sql<{ task_id: string }>`
    SELECT task_id FROM checklists WHERE id = ${share.checklist_id} AND deleted_at IS NULL
  `.execute(db);
  const taskId = found.rows[0]?.task_id;
  if (taskId === undefined) return { checklists: [] };

  const totes = await listChecklists(db, owner, taskId);
  return { checklists: totes.filter((checklist) => checklist.id === share.checklist_id) };
}
