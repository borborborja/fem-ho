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
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { generateApiToken } from '../auth/tokens.js';
import { open, seal } from '../crypto/secret-box.js';
import { safeFetch, type SafeFetchOptions } from '../dav/fetch-safe.js';
import { PolicyError, missingCapability, notFound } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { tokenHmac } from '../util/opaque-token.js';
import { isOpen, invalidGrant, type GrantRow } from './grants.js';
import { joinScope } from './scopes.js';

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
    INSERT INTO instance_links (id, scope_id, base_url, name, remote_scope_id, token_enc,
                                cursor, created_by, created_at, updated_at)
    VALUES (${id}, ${scopeId}, ${baseUrl}, ${manifest.name}, ${redeemed.scope_id},
            ${seal(masterSecret, `link:${id}`, redeemed.token)}, ${null},
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
): Promise<PullResult> {
  const token = open(masterSecret, `link:${link.id}`, link.token_enc);
  const cursor = link.cursor ?? '';

  const response = await safeFetch(
    `${link.base_url}/api/v1/sync?cursor=${encodeURIComponent(cursor)}`,
    { ...fetchOptions, headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status !== 200) {
    throw new Error(`El sync remot ha respost ${String(response.status)}.`);
  }

  const delta = JSON.parse(response.body) as {
    changes: { entity: string; id: string; op: string; data?: Record<string, unknown> }[];
    next_cursor: string;
  };

  const remoteFace = await ensureRemoteFace(db, link, now);

  let applied = 0;
  for (const change of delta.changes) {
    const table = REPLICATED[change.entity];
    if (table === undefined) continue;

    if (change.op === 'delete') {
      await sql
        .raw(`UPDATE ${table} SET deleted_at = '${now}' WHERE id = ?`)
        .execute(db)
        .catch(() => undefined);
      continue;
    }
    if (change.data === undefined) continue;

    applied += await replicateRow(
      db,
      table,
      change.entity,
      change.data,
      link.scope_id,
      now,
      remoteFace,
    );
  }

  const pushed = await pushToLink(db, link, token, now, fetchOptions);

  await sql`
    UPDATE instance_links
    SET cursor = ${delta.next_cursor}, last_sync_at = ${now}, last_error = NULL,
        last_error_at = NULL, updated_at = ${now}
    WHERE id = ${link.id}
  `.execute(db);

  return { applied, pushed, cursor: delta.next_cursor };
}

/**
 * Puja el que s'ha escrit aquí cap a l'altra instància.
 *
 * **Sense això la federació seria de només lectura**, i el que es va demanar és que se
 * sincronitzi tot: qui rep un àmbit hi ha de poder col·laborar de debò, no mirar-lo.
 *
 * S'aprofita el lot que ja hi és (`POST /api/v1/sync/batch`) i, amb ell, la seva
 * idempotència: l'`op_id` es deriva del `seq` local, o sigui que **reenviar el mateix
 * canvi després d'una caiguda no el duplica** encara que el cursor no s'hagi desat. I
 * l'`scope_id` es reescriu al de l'altra banda, que és l'únic que allà vol dir alguna
 * cosa.
 *
 * El que arriba de fora **no torna a sortir**: les files replicades porten l'autoria de
 * l'usuari ombra, i enviar-les faria un bucle entre les dues cases.
 */
async function pushToLink(
  db: MigrationDb,
  link: InstanceLinkRow & { token_enc: string },
  token: string,
  now: string,
  fetchOptions: SafeFetchOptions,
): Promise<number> {
  if (link.remote_scope_id === null) return 0;

  const face = await sql<{ id: string }>`
    SELECT id FROM users WHERE kind = 'remote' AND instance_link_id = ${link.id}
  `.execute(db);
  const faceId = face.rows[0]?.id ?? '';

  const pending = await sql<{
    seq: number;
    entity_type: string;
    entity_id: string;
    operation: string;
    is_first: number;
  }>`
    SELECT c.seq, c.entity_type, c.entity_id, c.operation,
           CASE WHEN c.seq = (
             SELECT MIN(seq) FROM change_log WHERE entity_id = c.entity_id
           ) THEN 1 ELSE 0 END AS is_first
    FROM change_log c
    WHERE c.scope_id = ${link.scope_id} AND c.seq > ${link.local_seq}
    ORDER BY c.seq ASC
    LIMIT 200
  `.execute(db);
  if (pending.rows.length === 0) return 0;

  const operations: BatchOperation[] = [];
  let lastSeq = link.local_seq;

  for (const row of pending.rows) {
    lastSeq = row.seq;
    const table = REPLICATED[row.entity_type];
    if (table === undefined) continue;

    const found = await sql
      .raw(`SELECT * FROM ${table} WHERE id = '${row.entity_id.replace(/'/gu, '')}'`)
      .execute(db);
    const data = found.rows[0] as Record<string, unknown> | undefined;
    if (data === undefined) continue;
    // El que ve de fora no torna a sortir: seria un bucle entre les dues cases.
    if (faceId !== '' && data.created_by === faceId) continue;

    const payload = { ...data };
    delete payload.version;
    if (row.entity_type === 'task') payload.scope_id = link.remote_scope_id;

    operations.push({
      op_id: `link:${link.id}:${String(row.seq)}`,
      entity: row.entity_type,
      /**
       * **Crear i actualitzar no són el mateix a l'altra banda.** El lot resol una
       * actualització buscant la fila, i una que allà encara no existeix la rebutja: la
       * tasca es donava per pujada i no hi arribava mai.
       *
       * El `change_log` no ho diu —només distingeix `upsert` de `delete`— però sí que ho
       * diu la posició: **la creació és la primera fila d'aquella entitat**.
       */
      op: data.deleted_at != null ? 'delete' : Number(row.is_first) === 1 ? 'create' : 'update',
      id: row.entity_id,
      data: payload,
    });
  }

  if (operations.length > 0) {
    /**
     * **El 200 del lot no vol dir que hagi anat bé.** Cada operació es resol per separat
     * (`docs/06` §4) i el cos porta el veredicte de cadascuna; quedar-se amb el codi
     * d'estat és donar per pujat el que l'altra banda ha rebutjat. El que falli es queda
     * al registre de l'enllaç, que és on l'usuari el pot llegir.
     */
    const answer = await postJson<{ results: { op_id: string; status: string }[] }>(
      `${link.base_url}/api/v1/sync/batch`,
      { operations },
      { authorization: `Bearer ${token}` },
      fetchOptions,
    );
    const refused = answer.results.filter((r) => r.status === 'rejected');
    if (refused.length > 0) {
      throw new Error(
        `L'altra instància ha rebutjat ${String(refused.length)} de ${String(operations.length)} operacions: ` +
          JSON.stringify(refused[0]),
      );
    }
  }

  await sql`
    UPDATE instance_links SET local_seq = ${lastSeq}, updated_at = ${now} WHERE id = ${link.id}
  `.execute(db);

  return operations.length;
}

/** La forma d'una operació del lot, tal com l'espera `POST /sync/batch`. */
interface BatchOperation {
  op_id: string;
  entity: string;
  op: 'create' | 'update' | 'delete';
  id: string;
  data?: Record<string, unknown> | undefined;
}

/**
 * Què es replica, i on.
 *
 * **Els àmbits no.** L'àmbit remot ja té el seu espill local, i copiar-ne la fila
 * duplicaria el tauler. La resta són les entitats de contingut, que és el que la persona
 * de l'altra casa vol veure.
 */
const REPLICATED: Record<string, string> = {
  task: 'tasks',
  subtask: 'subtasks',
  checklist: 'checklists',
  checklist_item: 'checklist_items',
  comment: 'comments',
};

/**
 * Escriu una fila replicada, amb l'`scope_id` reescrit al de l'espill.
 *
 * És un `INSERT ... ON CONFLICT DO UPDATE` a mà perquè les columnes varien per taula i el
 * que arriba és el que l'altra instància hagi decidit enviar. **Les columnes que aquí no
 * existeixen s'ignoren** en comptes de fer petar la rèplica sencera: dues instàncies
 * poden anar per versions diferents, i una columna nova a l'altra banda no ha de deixar
 * un àmbit compartit congelat fins que algú actualitzi.
 */
async function replicateRow(
  db: MigrationDb,
  table: string,
  entity: string,
  data: Record<string, unknown>,
  scopeId: string,
  now: string,
  fallbackUser: string,
): Promise<number> {
  const existing = await sql
    .raw(`SELECT 1 AS hi FROM ${table} WHERE id = '${String(data.id).replace(/'/gu, '')}'`)
    .execute(db);

  const row: Record<string, unknown> = { ...data, updated_at: now };
  // Només les entitats que en tenen de propi: una subtasca el treu de la seva tasca.
  if (entity === 'task') row.scope_id = scopeId;
  delete row.version;

  /**
   * **Les persones de l'altra casa no existeixen aquí.**
   *
   * Una tasca replicada porta `created_by`, `assignee_id`, `completed_by`… apuntant a
   * usuaris de la instància d'origen, i aquestes columnes són claus foranes dures a
   * `users`. Escriure-les tal qual peta amb un `FOREIGN KEY constraint failed` i deixa la
   * rèplica sencera aturada, que és com es va veure.
   *
   * Buidar-les no serveix: `tasks.created_by` és `NOT NULL`. I atribuir-ho a qui va muntar
   * l'enllaç seria mentir —posaria el teu nom a la feina d'algú altre—. El que es fa és
   * **una sola cara per instància remota**: un usuari ombra que es diu com l'altra casa.
   * És menys precís que un usuari per persona, i és tot el que aquesta banda pot afirmar
   * amb honestedat; el nom de qui ho va fer de debò viu a l'historial de la instància
   * d'origen, que és on aquella informació és certa.
   */
  for (const field of USER_REFERENCES) {
    if (row[field] == null) continue;
    if (!(await userExists(db, String(row[field])))) row[field] = fallbackUser;
  }

  const columns = await tableColumns(db, table);
  const usable = Object.entries(row).filter(([key]) => columns.has(key));
  if (usable.length === 0) return 0;

  if (existing.rows.length > 0) {
    const sets = usable
      .filter(([key]) => key !== 'id')
      .map(([key, value]) => sql`${sql.raw(key)} = ${value as string}`);
    if (sets.length === 0) return 0;
    await sql`
      UPDATE ${sql.raw(table)} SET ${sql.join(sets)} WHERE id = ${String(data.id)}
    `.execute(db);
    return 1;
  }

  await sql`
    INSERT INTO ${sql.raw(table)} (${sql.raw(usable.map(([key]) => key).join(', '))})
    VALUES (${sql.join(usable.map(([, value]) => sql`${value as string}`))})
  `.execute(db);
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

/** Les columnes que apunten a `users` a les taules que es repliquen. */
const USER_REFERENCES = ['created_by', 'assignee_id', 'completed_by', 'author_id'];

async function userExists(db: MigrationDb, id: string): Promise<boolean> {
  const found = await sql<{ id: string }>`SELECT id FROM users WHERE id = ${id}`.execute(db);
  return found.rows.length > 0;
}

/** Les columnes que aquesta base té de debò, per no escriure'n cap d'inventada. */
const columnCache = new Map<string, Set<string>>();

async function tableColumns(db: MigrationDb, table: string): Promise<Set<string>> {
  const cached = columnCache.get(table);
  if (cached !== undefined) return cached;

  const found = await sql.raw(`SELECT * FROM ${table} LIMIT 1`).execute(db);
  const names = new Set<string>(
    // Amb la taula buida no hi ha fila d'on treure els noms: es demana al catàleg.
    found.rows.length > 0 ? Object.keys(found.rows[0] as object) : await catalogColumns(db, table),
  );
  columnCache.set(table, names);
  return names;
}

async function catalogColumns(db: MigrationDb, table: string): Promise<string[]> {
  try {
    const found = await sql<{ name: string }>`
      SELECT column_name AS name FROM information_schema.columns WHERE table_name = ${table}
    `.execute(db);
    if (found.rows.length > 0) return found.rows.map((r) => r.name);
  } catch {
    // No és Postgres.
  }
  const found = await sql.raw(`PRAGMA table_info(${table})`).execute(db);
  return (found.rows as { name: string }[]).map((r) => r.name);
}

/** Buida la memòria de columnes. Les proves canvien de base entre fitxers. */
export function forgetTableColumns(): void {
  columnCache.clear();
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
