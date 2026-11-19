/**
 * Federació entre instàncies.
 *
 * LA IDEA, QUE ÉS EL QUE ESTALVIA MÉS CODI
 * ----------------------------------------
 * **Una instància remota no és una mena nova de principal: és un client d'API.**
 *
 * Quan algú d'una altra casa accepta un convit federat, aquesta instància li fa un
 * **usuari ombra** (`users.kind = 'remote'`) i un `api_token` limitat a l'àmbit compartit
 * i a les capacitats de contingut. A partir d'aquell moment el servidor remot es
 * presenta amb aquell token i passa exactament per on passa tothom: `resolveApiToken`,
 * `visibleScopesPredicate`, el filtre del sync i el tall dels calendaris.
 *
 * Les alternatives descartades, i per què:
 *
 * - **Un `PrincipalKind` `'remote'`** obligaria a repassar cada `hasCapability`, cada
 *   `assertScopeAccess` i cada `intersectScopes` per decidir què hi val. Un segon camí
 *   d'autorització és el que la regla 8 prohibeix, i seria el pitjor lloc per tenir-ne
 *   dos: el que ve de fora.
 * - **Una taula d'usuaris remots** obligaria a tocar una dotzena de claus foranes
 *   —assignats, comentaris, `activity_log`— que ja apunten a `users`.
 *
 * EL QUE SURT I EL QUE ENTRA
 * --------------------------
 * - **Entrant**: `redeemFederationGrant`, que crida el servidor remot sense sessió. Torna
 *   un token i prou.
 * - **Sortint**: `instance_links` i `pullFromLink`, que fa `GET /sync` contra l'altra
 *   instància amb el token com a `Bearer` i n'aplica el delta, i puja el que és nostre.
 *
 * **Només HTTPS pública.** Tota petició surt per `safeFetch`, que segueix blocant els
 * rangs privats (`docs/10` §7). Dues cases a la mateixa xarxa local no es poden federar
 * sense exposar-ne una, i és una decisió presa: obrir el forat per a la LAN el deixaria
 * obert també per a un àmbit que algú comparteixi amb un desconegut.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import type { Engine } from '../db/dialect.js';
import { generateApiToken } from '../auth/tokens.js';
import { open, seal } from '../crypto/secret-box.js';
import { safeFetch, type SafeFetchOptions } from '../dav/fetch-safe.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { normalizeForSearch } from '../text/search-text.js';
import { tokenHmac } from '../util/opaque-token.js';
import { isOpen, invalidGrant, type GrantRow } from './grants.js';
import { joinScope } from './scopes.js';
import { softDelete } from './sync.js';

/**
 * Les capacitats d'un usuari ombra: **contingut, i res més**.
 *
 * `scopes:read` hi és perquè el sync comença per saber quins àmbits veu qui pregunta, i
 * `scopes:write` **no**: la instància remota col·labora al tauler compartit i no en mana
 * —no el reanomena, no el pinta, no hi convida ningú—. `tasks:delete` i `events:delete`
 * tampoc: el que arriba de fora no ha de poder buidar l'àmbit de qui l'ha compartit.
 */
const REMOTE_CAPABILITIES = [
  'scopes:read',
  'projects:read',
  'tasks:read',
  'tasks:write',
  'events:read',
  'events:write',
  'checklists:read',
  'checklists:write',
  'comments:read',
  'comments:write',
  'attachments:read',
  'attachments:write',
] as const;

export interface InstanceLinkRow {
  id: string;
  scope_id: string;
  base_url: string;
  name: string | null;
  /** L'àmbit a l'altra banda. El de l'espill no vol dir res allà. */
  remote_scope_id: string | null;
  remote_role?: string | null;
  cursor: string | null;
  /** Per on anàvem del NOSTRE `change_log`: què hem escrit aquí i encara no hem enviat. */
  local_seq: number;
  last_sync_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `token_enc` no hi és mai: és un secret i no surt de la base. */
const LINK_COLUMNS = sql`
  id, scope_id, base_url, name, remote_scope_id, cursor, local_seq, last_sync_at,
  last_error, last_error_at, created_at, updated_at
`;

/**
 * El manifest públic de la instància.
 *
 * **Diu qui és i prou.** Res de comptar quants usuaris hi ha, ni quins àmbits, ni la
 * versió exacta: una instància de casa no ha de publicar la seva superfície a qui li
 * demani. Serveix perquè qui enganxa una URL vegi un nom abans d'enllaçar-s'hi.
 */
export interface Manifest {
  product: 'fem-ho';
  api: string;
  name: string | null;
}

// ---------------------------------------------------------------- el costat que rep

/**
 * Qui va emetre aquest convit federat.
 *
 * **Cal saber-ho abans d'obrir la transacció**, perquè `auditedTransaction` vol un
 * principal i qui truca a la porta és un servidor sense compte aquí. L'historial l'ha de
 * portar algú de casa, i el més honest és qui va decidir compartir: va ser la seva
 * decisió, no la de ningú altre.
 *
 * Torna `null` per a un token que no val, **sense dir per què**: la ruta ha de respondre
 * igual per a un d'inventat, un de caducat i un de revocat (`docs/10` §4).
 */
export async function federationGrantIssuer(
  db: MigrationDb,
  token: string,
  pepper: string,
): Promise<string | null> {
  const found = await sql<{ issuer_user_id: string | null }>`
    SELECT issuer_user_id FROM grants
    WHERE token_hmac = ${tokenHmac(token, pepper)} AND kind = 'scope_federation'
  `.execute(db);
  return found.rows[0]?.issuer_user_id ?? null;
}

export interface FederationRedeemResult {
  token: string;
  scope_id: string;
  scope_name: string;
  role: string;
}

/**
 * Accepta un convit federat i torna la credencial amb què l'altra instància ens parlarà.
 *
 * **No demana sessió, i és l'únic camí que no en demana.** Qui l'invoca és un servidor,
 * no una persona: no té compte aquí i no n'ha de tenir. El que el protegeix és el mateix
 * que protegeix els convits normals —el token opac, amb `tokenHmac` i el mateix silenci
 * per a un d'inventat, un de caducat i un de revocat (`docs/10` §4)— i que el que en surt
 * només val per a un àmbit.
 */
export async function redeemFederationGrant(
  ctx: AuditContext,
  token: string,
  pepper: string,
  remote: { instance_name?: string | undefined; user_name?: string | undefined },
): Promise<FederationRedeemResult> {
  const found = await sql<GrantRow & { scope_name: string | null }>`
    SELECT g.id, g.kind, g.subject_type, g.subject_id, g.issuer_user_id, g.role, g.max_uses,
           g.use_count, g.expires_at, g.revoked_at, g.first_used_at, g.last_used_at,
           g.created_at, s.name AS scope_name
    FROM grants g
    LEFT JOIN scopes s ON s.id = g.subject_id AND g.subject_type = 'scope'
    WHERE g.token_hmac = ${tokenHmac(token, pepper)}
  `.execute(ctx.tx);

  const grant = found.rows[0];
  // **Un convit d'una altra mena no val aquí.** Un `scope_invite` és per a una persona
  // amb compte; deixar-lo servir per federar donaria una credencial de servidor a qui
  // només se li havia obert una porta de convidat.
  if (
    grant === undefined ||
    grant.kind !== 'scope_federation' ||
    grant.subject_id === null ||
    grant.scope_name === null ||
    !isOpen(grant, ctx.now)
  ) {
    throw invalidGrant();
  }

  const scopeId = grant.subject_id;
  const role = grant.role ?? 'collaborator';

  /**
   * L'usuari ombra.
   *
   * Té correu `null` i contrasenya `null`: **no s'hi pot entrar per la porta de davant**.
   * L'única credencial que el fa servir és el token que es torna aquí, i revocar-lo el
   * deixa inert sense haver d'esborrar res del que hagi escrit.
   */
  const shadowId = uuidv7();
  const label = remote.user_name?.trim();
  const instance = remote.instance_name?.trim();
  const name =
    label !== undefined && label !== ''
      ? instance !== undefined && instance !== ''
        ? `${label} · ${instance}`
        : label
      : (instance ?? 'Una altra instància');

  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, remote_user_id,
                       created_at, updated_at)
    VALUES (${shadowId}, ${null}, ${name.slice(0, 120)}, ${null}, 'remote', 'member',
            ${label ?? null}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  // Un àmbit compartit és col·lectiu: si no, les tasques s'assignarien soles al
  // propietari i el que arribés de fora quedaria en un àmbit que diu que és d'un de sol.
  await sql`
    UPDATE scopes SET kind = 'collective', updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${scopeId} AND kind = 'individual'
  `.execute(ctx.tx);

  await joinScope(ctx, scopeId, shadowId, role === 'viewer' ? 'viewer' : 'collaborator');

  const generated = generateApiToken();
  await sql`
    INSERT INTO api_tokens (id, user_id, name, token_prefix, token_hash, capabilities,
                            scope_ids, expires_at, created_at)
    VALUES (${uuidv7()}, ${shadowId}, ${`Federació · ${name}`.slice(0, 120)},
            ${generated.prefix}, ${generated.hash},
            ${JSON.stringify([...REMOTE_CAPABILITIES])}, ${JSON.stringify([scopeId])},
            ${null}, ${ctx.now})
  `.execute(ctx.tx);

  await sql`
    UPDATE grants SET use_count = use_count + 1, last_used_at = ${ctx.now},
                      first_used_at = COALESCE(first_used_at, ${ctx.now})
    WHERE id = ${grant.id}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'scope',
    entityId: scopeId,
    scopeId,
    verb: 'joined',
    changes: { federated_with: { from: null, to: name } },
  });

  return { token: generated.token, scope_id: scopeId, scope_name: grant.scope_name, role };
}

// ------------------------------------------------------------- el costat que surt

export interface LinkInput {
  /** L'arrel de l'altra instància, tal com l'enganxa l'usuari. */
  base_url: string;
  token: string;
  /** El nom que tindrà l'àmbit espill aquí. Si falta, el que digui l'altra banda. */
  name?: string | undefined;
}

/** L'arrel neta, sense barra final ni camí, i **sempre HTTPS**. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PolicyError(
      'invalid-instance-url',
      'Invalid instance URL',
      422,
      'The address of the other instance is not a valid URL.',
    );
  }

  /**
   * **`http:` es rebutja aquí i no a `safeFetch`.**
   *
   * Aquell blocaria igualment una adreça privada, però un `http://` públic passaria: el
   * token de federació viatjaria en clar per internet, i qui el llegís pel camí tindria
   * accés escrivible a l'àmbit. És el mateix criteri que `docs/10` demana per a
   * qualsevol credencial de llarga vida.
   */
  if (url.protocol !== 'https:') {
    throw new PolicyError(
      'https-required',
      'HTTPS required',
      422,
      'Federation only works over public HTTPS: the token would otherwise travel in the clear.',
    );
  }

  return `${url.origin}${url.pathname.replace(/\/+$/u, '')}`;
}

export async function fetchManifest(
  baseUrl: string,
  options: SafeFetchOptions = {},
): Promise<Manifest> {
  const response = await safeFetch(`${baseUrl}/.well-known/femho`, options);
  if (response.status !== 200) {
    throw new PolicyError(
      'instance-unreachable',
      'Instance unreachable',
      502,
      `The other instance answered ${String(response.status)}.`,
      { status: response.status },
    );
  }

  let parsed: Partial<Manifest>;
  try {
    parsed = JSON.parse(response.body) as Partial<Manifest>;
  } catch {
    parsed = {};
  }
  if (parsed.product !== 'fem-ho') {
    throw new PolicyError(
      'not-femho',
      'Not a Fem-ho instance',
      422,
      'That address answers, but it is not a Fem-ho instance.',
    );
  }
  return { product: 'fem-ho', api: parsed.api ?? 'v1', name: parsed.name ?? null };
}

export interface LinkResult {
  link: InstanceLinkRow;
  scope_id: string;
}

/**
 * Enllaça un àmbit d'aquesta instància amb un de remot.
 *
 * Crea **un àmbit espill local**: les tasques que arriben de fora han de viure en algun
 * lloc d'aquí, i han de portar un `scope_id` local perquè el `change_log` i el kanban
 * funcionin sense saber res de la federació. Els identificadors de les entitats **no es
 * remapen**: són UUIDv7 generats pel client (D4) i no xoquen.
 */
export async function linkInstance(
  ctx: AuditContext,
  principal: Principal,
  input: LinkInput,
  masterSecret: string,
  fetchOptions: SafeFetchOptions = {},
): Promise<LinkResult> {
  if (!hasCapability(principal, 'scopes:share')) throw missingCapability('scopes:share');

  /**
   * **L'adreça arriba ja normalitzada.**
   *
   * `normalizeBaseUrl` —i amb ella l'exigència d'HTTPS— viu a la ruta, que és on hi ha
   * l'entrada de l'usuari. Aquí no es relaxa res: tota petició segueix sortint per
   * `safeFetch`, que bloca els rangs privats. El que es guanya és que aquesta funció es
   * pot provar contra una instància de debò a loopback, i el que es prova és el camí
   * sencer i no una imitació seva.
   */
  const baseUrl = input.base_url;
  const manifest = await fetchManifest(baseUrl, fetchOptions);

  const redeemed = await postJson<FederationRedeemResult>(
    `${baseUrl}/api/v1/federation/redeem`,
    { token: input.token, instance_name: null, user_name: null },
    {},
    fetchOptions,
  );

  const scopeId = uuidv7();
  const name = (input.name ?? redeemed.scope_name).slice(0, 120);
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, ${name}, 'collective', '--femho-scope-6', ${principal.userId},
            ${'zz'}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  const id = uuidv7();
  await sql`
    INSERT INTO instance_links (id, scope_id, base_url, name, remote_scope_id, remote_role, token_enc,
                                cursor, created_by, created_at, updated_at)
    VALUES (${id}, ${scopeId}, ${baseUrl}, ${manifest.name}, ${redeemed.scope_id},
            ${redeemed.role}, ${seal(masterSecret, `link:${id}`, redeemed.token)}, ${null},
            ${principal.userId}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'scope',
    entityId: scopeId,
    scopeId,
    verb: 'shared',
    changes: { federated_from: { from: null, to: baseUrl } },
  });

  const found = await sql<InstanceLinkRow>`
    SELECT ${LINK_COLUMNS} FROM instance_links WHERE id = ${id}
  `.execute(ctx.tx);
  return { link: found.rows[0]!, scope_id: scopeId };
}

export async function listLinks(db: MigrationDb, principal: Principal): Promise<InstanceLinkRow[]> {
  if (!hasCapability(principal, 'scopes:read')) throw missingCapability('scopes:read');

  const rows = await sql<InstanceLinkRow>`
    SELECT ${LINK_COLUMNS} FROM instance_links
    WHERE created_by = ${principal.userId}
    ORDER BY created_at
  `.execute(db);
  return rows.rows;
}

/**
 * Trenca l'enllaç.
 *
 * **L'àmbit espill es queda.** Esborrar-lo s'enduria tot el que hi hagués passat sense
 * avisar; desenllaçar-lo el deixa com un àmbit local qualsevol, que és el que la persona
 * pot mirar i decidir. El token remot es perd, que és el que sí que ha de passar.
 */
export async function unlinkInstance(
  ctx: AuditContext,
  principal: Principal,
  id: string,
): Promise<void> {
  if (!hasCapability(principal, 'scopes:share')) throw missingCapability('scopes:share');

  const found = await sql<{ scope_id: string }>`
    SELECT scope_id FROM instance_links WHERE id = ${id} AND created_by = ${principal.userId}
  `.execute(ctx.tx);
  const row = found.rows[0];
  if (row === undefined) throw notFound('instance_link', id);

  await sql`DELETE FROM instance_links WHERE id = ${id}`.execute(ctx.tx);

  ctx.record({
    entityType: 'scope',
    entityId: row.scope_id,
    scopeId: row.scope_id,
    verb: 'revoked',
    changes: { federation: { from: 'linked', to: null } },
  });
}

// ------------------------------------------------------------------- la rèplica

export interface PullResult {
  applied: number;
  /** Quantes operacions nostres han pujat cap a l'altra banda. */
  pushed: number;
  cursor: string | null;
}

/**
 * Baixa el delta d'un enllaç i l'aplica a l'àmbit espill.
 *
 * **Es reutilitza el sync que ja hi és**, sense un protocol nou: `GET /api/v1/sync` amb
 * el token com a `Bearer`. El que arriba ja ve filtrat per l'altra instància —els seus
 * àmbits, els seus calendaris compartits—, o sigui que aquí no cal decidir res sobre què
 * es pot veure: només reescriure l'`scope_id` al de l'espill.
 */
export async function pullFromLink(
  db: MigrationDb,
  link: InstanceLinkRow & { token_enc: string },
  masterSecret: string,
  now: string,
  fetchOptions: SafeFetchOptions = {},
  engine: Engine = 'sqlite',
): Promise<PullResult> {
  const token = open(masterSecret, `link:${link.id}`, link.token_enc);
  const cursor = link.cursor ?? '';

  // Primer pugem les edicions locals. Aplicar abans la instantània remota podria esborrar
  // allò que la cua encara ha d'enviar.
  const { pushed, hasMore } = await pushToLink(db, link, token, now, fetchOptions);
  if (hasMore) return { applied: 0, pushed, cursor: link.cursor };
  const response = await safeFetch(
    `${link.base_url}/api/v1/sync?cursor=${encodeURIComponent(cursor)}`,
    { ...fetchOptions, headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status !== 200) {
    throw new Error(`El sync remot ha respost ${String(response.status)}.`);
  }

  const delta = JSON.parse(response.body) as {
    changes: { entity: string; id: string; op: string; data?: Row }[];
    next_cursor: string;
  };
  if (!Array.isArray(delta.changes) || typeof delta.next_cursor !== 'string') {
    throw new Error('La rèplica ha rebut un delta sense cursor o sense canvis.');
  }

  const principal: Principal = {
    kind: 'user',
    userId: '',
    capabilities: new Set(),
    scopeIds: new Set([link.scope_id]),
    source: 'api',
  };
  return auditedTransaction(
    db,
    principal,
    async (ctx) => {
      // La fila i el cursor es confirmen en el mateix compromís. Si un altre tic ja ha
      // passat per aquí, aquest no pot aplicar una pàgina antiga ni recular el cursor.
      const moved = await sql`
      UPDATE instance_links SET cursor = ${delta.next_cursor}, last_sync_at = ${now},
        last_error = NULL, last_error_at = NULL, updated_at = ${now}
      WHERE id = ${link.id} AND COALESCE(cursor, '') = ${cursor}
    `.execute(ctx.tx);
      if (Number(moved.numAffectedRows ?? 0) === 0) {
        ctx.noChange();
        const latest = await sql<{ cursor: string | null }>`
        SELECT cursor FROM instance_links WHERE id = ${link.id}
      `.execute(ctx.tx);
        return { applied: 0, pushed, cursor: latest.rows[0]?.cursor ?? null };
      }

      principal.userId = await ensureRemoteFace(ctx.tx, link, now);
      const remote: AuditContext = {
        ...ctx,
        record: (entry) => ctx.record({ ...entry, originLinkId: link.id }),
      };
      let applied = 0;
      for (const change of delta.changes) {
        if (!isReplicated(change.entity)) continue;
        if (typeof change.id !== 'string' || !['delete', 'upsert'].includes(change.op)) {
          throw new Error('La rèplica ha rebut un canvi invàlid.');
        }
        applied += await applyRemoteChange(remote, link, change.entity, change, principal.userId);
      }
      if (applied === 0) ctx.noChange();
      return { applied, pushed, cursor: delta.next_cursor };
    },
    { engine, now },
  );
}

type Row = Record<string, unknown>;

const REPLICATED = {
  task: 'tasks',
  subtask: 'subtasks',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
  comment: 'comments',
} as const;
type Replicated = keyof typeof REPLICATED;

function isReplicated(entity: string): entity is Replicated {
  return Object.hasOwn(REPLICATED, entity);
}

const CONTENT_FIELDS: Record<Replicated, readonly string[]> = {
  task: [
    'title',
    'description',
    'due_date',
    'due_time',
    'deadline',
    'rrule',
    'recurrence_mode',
    'ai_mode',
    'ai_instructions',
    'status',
    'position',
  ],
  subtask: ['title', 'position', 'done'],
  checklist: ['name', 'position', 'subtask_id', 'show_completed_inline'],
  checklist_item: ['text', 'position', 'done'],
  comment: ['body'],
};

function selectFields(row: Row, fields: readonly string[]): Row {
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]),
  );
}

async function findReplica(
  db: MigrationDb,
  entity: Replicated,
  id: string,
): Promise<Row | undefined> {
  const found =
    await sql<Row>`SELECT * FROM ${sql.ref(REPLICATED[entity])} WHERE id = ${id}`.execute(db);
  return found.rows[0];
}

async function rootOf(db: MigrationDb, entity: Replicated, row: Row): Promise<Row | undefined> {
  if (entity === 'task') return row;
  if (entity === 'checklist_item') {
    const found = await sql<Row>`
      SELECT t.* FROM checklists c JOIN tasks t ON t.id = c.task_id WHERE c.id = ${row.checklist_id}
    `.execute(db);
    return found.rows[0];
  }
  return typeof row.task_id === 'string' ? findReplica(db, 'task', row.task_id) : undefined;
}

interface BatchOperation {
  op_id: string;
  entity: Replicated;
  op: 'create' | 'update' | 'delete';
  id: string;
  data?: Row;
}

const PUSH_PAGE_SIZE = 200;

/** Les operacions del lot només porten els camps que el servei remot pot desar. */
async function pushToLink(
  db: MigrationDb,
  link: InstanceLinkRow,
  token: string,
  now: string,
  fetchOptions: SafeFetchOptions,
): Promise<{ pushed: number; hasMore: boolean }> {
  if (link.remote_scope_id === null || link.remote_role === 'viewer') {
    return { pushed: 0, hasMore: false };
  }

  const pending = await sql<{
    seq: number;
    entity_type: string;
    entity_id: string;
    operation: string;
    changed_fields: string | null;
    first_seq: number;
    created_here: number;
  }>`
    SELECT c.seq, c.entity_type, c.entity_id, c.operation, c.changed_fields,
           (SELECT MIN(seq) FROM change_log
            WHERE entity_id = c.entity_id AND entity_type = c.entity_type AND scope_id = c.scope_id) AS first_seq,
           CASE WHEN EXISTS (
             SELECT 1 FROM activity_log a WHERE a.entity_id = c.entity_id AND a.entity_type = c.entity_type
               AND a.scope_id = c.scope_id AND a.verb = 'created'
           ) THEN 1 ELSE 0 END AS created_here
    FROM change_log c
    WHERE c.scope_id = ${link.scope_id} AND c.seq > ${link.local_seq}
      AND (c.origin_link_id IS NULL OR c.origin_link_id <> ${link.id})
    ORDER BY c.seq ASC LIMIT ${PUSH_PAGE_SIZE + 1}
  `.execute(db);
  const page = pending.rows.slice(0, PUSH_PAGE_SIZE);
  if (page.length === 0) return { pushed: 0, hasMore: false };

  const operations: BatchOperation[] = [];
  for (const row of page) {
    const entity = row.entity_type;
    if (!isReplicated(entity)) continue;
    const data = await findReplica(db, entity, row.entity_id);
    if (data === undefined) continue;
    const root = await rootOf(db, entity, data);
    if (root?.scope_id !== link.scope_id) continue;

    const localCreate = Number(row.created_here) === 1;
    const opId = `link:${link.id}:v2:${String(row.seq)}`;
    if (row.operation === 'delete') {
      // El propietari de l'origen conserva el dret exclusiu d'esborrar tasques. Tampoc
      // hi enviem les seves cascades ni l'esborrat d'una fila que no ens va arribar a sortir.
      if (root.deleted_at != null || (localCreate && Number(row.first_seq) > link.local_seq))
        continue;
      operations.push({ op_id: opId, id: row.entity_id, entity, op: 'delete' });
      continue;
    }
    if (data.deleted_at != null || root.deleted_at != null) continue;
    const create = localCreate && Number(row.first_seq) === Number(row.seq);
    const changed =
      row.changed_fields === null ? null : (JSON.parse(row.changed_fields) as string[]);
    const fields = selectFields(
      data,
      CONTENT_FIELDS[entity].filter(
        (field) => create || changed === null || changed.includes(field),
      ),
    );
    if (create) {
      if (entity === 'task') fields.scope_id = link.remote_scope_id;
      else if (entity === 'checklist_item') fields.checklist_id = data.checklist_id;
      else fields.task_id = data.task_id;
    }
    if (Object.keys(fields).length === 0) continue;
    operations.push({
      op_id: opId,
      id: row.entity_id,
      entity,
      op: create ? 'create' : 'update',
      data: fields,
    });
  }

  if (operations.length > 0) {
    const answer = await postJson<{
      results: { op_id: string; status: string; error?: { status?: number } }[];
    }>(
      `${link.base_url}/api/v1/sync/batch`,
      { operations },
      { authorization: `Bearer ${token}` },
      fetchOptions,
    );
    const results = new Map(answer.results.map((result) => [result.op_id, result]));
    const unconfirmed = operations.filter((operation) => {
      const result = results.get(operation.op_id);
      return (
        result?.status !== 'ok' && !(operation.op === 'delete' && result?.error?.status === 404)
      );
    });
    if (unconfirmed.length > 0) {
      throw new Error(
        `L'altra instància no ha confirmat ${String(unconfirmed.length)} de ${String(operations.length)} operacions.`,
      );
    }
  }

  const lastSeq = page.at(-1)!.seq;
  await sql`
    UPDATE instance_links SET local_seq = ${lastSeq}, updated_at = ${now}
    WHERE id = ${link.id} AND local_seq < ${lastSeq}
  `.execute(db);
  return { pushed: operations.length, hasMore: pending.rows.length > PUSH_PAGE_SIZE };
}

async function applyRemoteChange(
  ctx: AuditContext,
  link: InstanceLinkRow,
  entity: Replicated,
  change: { id: string; op: string; data?: Row },
  remoteFace: string,
): Promise<number> {
  const existing = await findReplica(ctx.tx, entity, change.id);
  if (change.op === 'delete') {
    if (existing === undefined || existing.deleted_at != null) return 0;
    const root = await rootOf(ctx.tx, entity, existing);
    if (root?.scope_id !== link.scope_id)
      throw new Error('La fila replicada pertany a un altre àmbit.');
    await softDelete(ctx, entity, change.id, link.scope_id);
    return 1;
  }

  const data = change.data;
  if (data === undefined || data.id !== change.id)
    throw new Error('El delta no porta la fila esperada.');
  // Fins i tot quan l'altra casa autentica la petició, els seus identificadors no donen
  // permís d'escriptura sobre un registre d'aquí que coincideixi amb un d'allà.
  const root = await rootOf(ctx.tx, entity, existing ?? data);
  if ((existing !== undefined || entity !== 'task') && root?.scope_id !== link.scope_id) {
    throw new Error('La fila replicada pertany a un altre àmbit.');
  }
  if (entity !== 'task' && root?.deleted_at != null) return 0;
  if (existing?.deleted_at != null) {
    const removed = await sql<{ origin_link_id: string | null }>`
      SELECT origin_link_id FROM change_log WHERE scope_id = ${link.scope_id}
        AND entity_type = ${entity} AND entity_id = ${change.id} AND operation = 'delete'
      ORDER BY seq DESC LIMIT 1
    `.execute(ctx.tx);
    if (removed.rows[0]?.origin_link_id !== link.id) return 0;
  }

  const row = selectFields(data, CONTENT_FIELDS[entity]);
  if (entity === 'task') {
    Object.assign(row, selectFields(data, ['completed_at']));
    row.search_text = normalizeForSearch(
      String(row.title ?? existing?.title ?? ''),
      (row.description as string | null | undefined) ?? null,
    );
  }
  if (entity === 'checklist_item' && Object.hasOwn(data, 'done_at')) {
    row.done_at = data.done_at;
    if (existing?.done_at !== data.done_at) row.done_by = data.done_at == null ? null : remoteFace;
  }
  for (const field of ['done', 'show_completed_inline']) {
    if (Object.hasOwn(row, field)) row[field] = dbBool(isTrue(row[field]));
  }
  if (entity === 'checklist' && typeof row.subtask_id === 'string') {
    const anchor = await findReplica(ctx.tx, 'subtask', row.subtask_id);
    if (anchor?.task_id !== (existing ?? data).task_id)
      throw new Error('La subtasca de la llista és d’una altra tasca.');
  }

  const table = sql.ref(REPLICATED[entity]);
  if (existing === undefined) {
    // Les referències que només tenen sentit a l'altra instància es queden a l'origen.
    const identity: Row = {
      id: change.id,
      created_at: data.created_at ?? ctx.now,
      updated_at: ctx.now,
    };
    if (entity === 'task')
      Object.assign(identity, { scope_id: link.scope_id, created_by: remoteFace });
    else if (entity === 'checklist_item') identity.checklist_id = data.checklist_id;
    else identity.task_id = data.task_id;
    if (entity === 'comment')
      Object.assign(identity, { author_id: remoteFace, guest_name: data.guest_name ?? null });
    const fields = Object.entries({ ...identity, ...row });
    await sql`INSERT INTO ${table} (${sql.join(fields.map(([field]) => sql.ref(field)))})
              VALUES (${sql.join(fields.map(([, value]) => sql.val(value)))})`.execute(ctx.tx);
    ctx.record({
      entityType: entity,
      entityId: change.id,
      scopeId: link.scope_id,
      verb: 'refreshed',
    });
    return 1;
  }

  if (existing.deleted_at != null) row.deleted_at = null;
  const fields = Object.entries(row).filter(([field, value]) => existing[field] !== value);
  if (fields.length === 0) return 0;
  const updates = fields.map(([field, value]) => sql`${sql.ref(field)} = ${value}`);
  await sql`UPDATE ${table} SET ${sql.join(updates)}, updated_at = ${ctx.now}, version = version + 1
            WHERE id = ${change.id}`.execute(ctx.tx);
  ctx.record({
    entityType: entity,
    entityId: change.id,
    scopeId: link.scope_id,
    verb: 'refreshed',
    changes: Object.fromEntries(
      fields.map(([field, value]) => [field, { from: existing[field], to: value }]),
    ),
  });
  return 1;
}

/**
 * La cara d'una instància remota en aquesta base.
 *
 * **Un sol usuari ombra per enllaç**, no un per persona de l'altra casa: aquesta banda no
 * sap qui són ni li'n toca portar la llibreta, i cada persona nova que aparegués a una
 * tasca acabaria a la llista de gent d'aquí. Es diu com l'altra instància, i això és
 * exactament el que aquesta banda pot afirmar sobre l'autoria del que replica.
 */
async function ensureRemoteFace(
  db: MigrationDb,
  link: { id: string; base_url: string; name: string | null },
  now: string,
): Promise<string> {
  const found = await sql<{ id: string }>`
    SELECT id FROM users WHERE kind = 'remote' AND instance_link_id = ${link.id}
  `.execute(db);
  const existing = found.rows[0];
  if (existing !== undefined) return existing.id;

  const id = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, instance_link_id,
                       created_at, updated_at)
    VALUES (${id}, ${null}, ${(link.name ?? link.base_url).slice(0, 120)}, ${null}, 'remote',
            'member', ${link.id}, ${now}, ${now})
  `.execute(db);
  return id;
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  fetchOptions: SafeFetchOptions,
): Promise<T> {
  const response = await safeFetch(url, {
    ...fetchOptions,
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (response.status >= 400) {
    throw new PolicyError(
      'federation-refused',
      'Federation refused',
      response.status === 404 ? 404 : 502,
      `The other instance refused the invitation (${String(response.status)}).`,
      { status: response.status },
    );
  }
  return JSON.parse(response.body) as T;
}
