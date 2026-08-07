/**
 * Fem-ho com a **client** CalDAV (docs/07 §9).
 *
 * L'usuari pot posar un CalDAV o un `.ics` com a origen d'un àmbit o d'un projecte, i pot
 * no posar-ne cap i fer servir Fem-ho com a font principal.
 *
 * Tota petició surt per `safeFetch`: la URL la dona l'usuari i això és una falsificació
 * de peticions del costat servidor si no es mira (docs/10 §7).
 */

import ICAL from 'ical.js';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { dbBool, isTrue } from '../db/bool.js';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import { open } from '../crypto/secret-box.js';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';
import { safeFetch, type SafeFetchOptions } from './fetch-safe.js';
import { etagOf } from './objects.js';
import { extractFeedEvents } from './rss.js';
import { safeFilename, sniffMime, storeAttachment } from '../services/attachments.js';

/**
 * L'interval mínim entre refrescos.
 *
 * Encara que el calendari remot digui que es refresqui cada minut, no s'hi va: **no
 * s'ha de martellejar el servidor de ningú** (docs/07 §9), i un calendari de festius no
 * canvia cada minut.
 */
export const MIN_REFRESH_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_SECONDS = 60 * 60;

export interface SubscriptionRow {
  id: string;
  scope_id: string;
  name: string;
  /**
   * De quina mena és la font: `caldav`, `ical` o `rss`.
   *
   * `null` a les files velles, que es tracten com a `ical` — veure la migració 006.
   */
  source_kind?: string | null;
  source_url: string;
  source_username: string | null;
  source_secret_enc: string | null;
  refresh_interval: number | null;
  last_refreshed_at: string | null;
  strip_alarms: number | boolean;
}

/**
 * Cada quant s'ha de refrescar aquest origen.
 *
 * L'ordre de preferència és el de docs/07 §9: `REFRESH-INTERVAL` del propi calendari,
 * si no `X-PUBLISHED-TTL`, i si no el valor configurat. Sempre amb el mínim per sota.
 */
export function refreshInterval(ical: string, configured: number | null): number {
  const declared =
    durationSeconds(property(ical, 'REFRESH-INTERVAL')) ??
    durationSeconds(property(ical, 'X-PUBLISHED-TTL'));
  const wanted = declared ?? configured ?? DEFAULT_REFRESH_SECONDS;
  return Math.max(wanted, MIN_REFRESH_SECONDS);
}

function property(ical: string, name: string): string | null {
  const match = new RegExp(`^${name}[^:\\r\\n]*:(.+)$`, 'mu').exec(ical);
  return match?.[1]?.trim() ?? null;
}

/** `PT1H`, `P1D`… a segons. Torna `null` si no és una durada d'iCalendar. */
export function durationSeconds(value: string | null): number | null {
  if (value === null) return null;
  try {
    return ICAL.Duration.fromString(value).toSeconds();
  } catch {
    return null;
  }
}

/** Toca refrescar aquest origen ara? */
export function isDue(subscription: SubscriptionRow, ical: string | null, now: number): boolean {
  if (subscription.last_refreshed_at === null) return true;
  const interval =
    ical === null
      ? Math.max(subscription.refresh_interval ?? DEFAULT_REFRESH_SECONDS, MIN_REFRESH_SECONDS)
      : refreshInterval(ical, subscription.refresh_interval);
  return now - Date.parse(subscription.last_refreshed_at) >= interval * 1000;
}

/**
 * Treu les alarmes d'un component.
 *
 * **De les subscripcions s'eliminen per defecte** (docs/07 §9): no es volen
 * notificacions duplicades d'un calendari que l'usuari ja té al telèfon.
 */
export function stripAlarms(component: ICAL.Component): void {
  for (const alarm of component.getAllSubcomponents('valarm')) {
    component.removeSubcomponent(alarm);
  }
}

/** Un component tal com arriba d'un origen, sigui un `.ics` o un canal RSS. */
export interface FetchedComponent {
  uid: string;
  summary: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  timezone: string | null;
  raw: string;
  etag: string;
  attachments: FetchedAttachment[];
}

/**
 * Un `ATTACH` d'un VEVENT (RFC 5545 §3.8.1.1).
 *
 * En té dues formes i **es tracten diferent a posta**:
 *
 * - **`VALUE=BINARY;ENCODING=BASE64`**: els bytes ja són al `.ics` que s'ha baixat. Es
 *   guarden com un adjunt normal.
 * - **Una URI**: només se'n desa l'enllaç a `external_url` i **no es baixa mai per
 *   iniciativa pròpia**. Baixar-la seria fer que el servidor segueixi una URL escollida
 *   per un tercer cada cop que refresca —el mateix forat que `safeFetch` tanca a la font
 *   del calendari— i a més un `.ics` podria fer créixer el volum sense límit.
 */
export interface FetchedAttachment {
  filename: string;
  mimeType: string | null;
  /** Els bytes, si venien en base64 dins del propi `.ics`. */
  data: Buffer | null;
  /** L'enllaç, si l'`ATTACH` era una URI. */
  url: string | null;
}

/** Els `ATTACH` d'un component, sense baixar-ne cap. */
export function extractAttachments(event: ICAL.Component): FetchedAttachment[] {
  const found: FetchedAttachment[] = [];

  for (const property of event.getAllProperties('attach')) {
    /**
     * **Un `ATTACH` binari no torna una cadena.** `ical.js` el desa com un `ICAL.Binary`
     * i `getFirstValue()` en dona l'objecte; el base64 és a `.value`. Llegir-lo com si
     * fos text donava una llista buida i cap error enlloc.
     */
    const raw: unknown = property.getFirstValue();
    const value =
      typeof raw === 'string'
        ? raw
        : typeof (raw as { value?: unknown }).value === 'string'
          ? String((raw as { value: string }).value)
          : '';
    if (value === '') continue;

    const mimeType = (property.getParameter('fmttype') as string | undefined) ?? null;
    // `FILENAME` no és estàndard, però és el que fan servir Google i Nextcloud.
    const declared =
      (property.getParameter('filename') as string | undefined) ??
      (property.getParameter('x-filename') as string | undefined);

    const encoding = (property.getParameter('encoding') as string | undefined) ?? '';
    if (encoding.toUpperCase() === 'BASE64') {
      found.push({
        filename: declared ?? 'adjunt',
        mimeType,
        data: Buffer.from(value, 'base64'),
        url: null,
      });
      continue;
    }

    // Una URI: se'n desa el nom que se n'endevini, i prou.
    found.push({
      filename: declared ?? decodeURIComponent(value.split('/').pop() ?? 'adjunt'),
      mimeType,
      data: null,
      url: value,
    });
  }

  return found;
}

/** Extreu els VEVENT d'un `.ics` sencer, amb les alarmes tretes si toca. */
export function extractEvents(
  ical: string,
  { stripAlarms: strip = true } = {},
): FetchedComponent[] {
  const calendar = new ICAL.Component(ICAL.parse(ical));

  return calendar.getAllSubcomponents('vevent').map((event) => {
    if (strip) stripAlarms(event);

    const dtstart = event.getFirstProperty('dtstart');
    const start = dtstart?.getFirstValue() as ICAL.Time | undefined;
    const dtend = event.getFirstProperty('dtend');
    const end = dtend?.getFirstValue() as ICAL.Time | undefined;

    // Cada component es guarda embolicat en el seu propi VCALENDAR: és el que un client
    // espera trobar-se en llegir el recurs, i el que fa que `raw_ical` sigui servible
    // tal com està.
    const wrapper = new ICAL.Component('vcalendar');
    wrapper.updatePropertyWithValue('version', '2.0');
    wrapper.updatePropertyWithValue('prodid', '-//Fem-ho//CalDAV//EN');
    wrapper.addSubcomponent(event);
    const raw = wrapper.toString();

    return {
      uid: String(event.getFirstPropertyValue('uid') ?? ''),
      summary: String(event.getFirstPropertyValue('summary') ?? '(untitled)'),
      startsAt: start === undefined ? new Date(0).toISOString() : start.toJSDate().toISOString(),
      endsAt: end === undefined ? null : end.toJSDate().toISOString(),
      allDay: start?.isDate === true,
      timezone: (dtstart?.getParameter('tzid') as string | undefined) ?? null,
      raw,
      etag: etagOf(raw),
      attachments: extractAttachments(event),
    };
  });
}

export interface RefreshResult {
  fetched: number;
  created: number;
  updated: number;
  removed: number;
}

/**
 * Refresca un origen.
 *
 * **Es comparen els UID i s'esborra el que ha desaparegut de l'origen** (docs/07 §9).
 * Sense això, un esdeveniment cancel·lat a l'origen es quedaria a Fem-ho per sempre.
 */
export async function refreshSubscription(
  db: MigrationDb,
  principal: Principal,
  subscription: SubscriptionRow,
  {
    masterSecret,
    engine,
    fetchOptions = {},
    dataDir,
  }: {
    masterSecret: string;
    engine?: 'sqlite' | 'postgres';
    fetchOptions?: SafeFetchOptions;
    /**
     * On van els bytes dels `ATTACH` en base64. Sense `dataDir` no se'n desa cap: els
     * enllaços sí, que no ocupen res, però els bytes necessiten saber on.
     */
    dataDir?: string | undefined;
  },
): Promise<RefreshResult> {
  const headers: Record<string, string> = {};
  if (subscription.source_username !== null && subscription.source_secret_enc !== null) {
    const password = open(
      masterSecret,
      `calendar:${subscription.id}`,
      subscription.source_secret_enc,
    );
    headers.Authorization = `Basic ${Buffer.from(`${subscription.source_username}:${password}`).toString('base64')}`;
  }

  const response = await safeFetch(subscription.source_url, { ...fetchOptions, headers });
  if (response.status !== 200) {
    throw new Error(`L'origen ha respost ${String(response.status)}.`);
  }

  /**
   * Un RSS es llegeix diferent, però **a partir d'aquí és igual**.
   *
   * `extractFeedEvents` torna els mateixos components que `extractEvents`, o sigui que
   * tot el que ve després —comparar UID, esborrar el que ha desaparegut, guardar el
   * `raw_ical`— no sap ni li cal saber d'on venen.
   */
  const strip = isTrue(subscription.strip_alarms);
  const components =
    subscription.source_kind === 'rss'
      ? extractFeedEvents(response.body, subscription.id)
      : extractEvents(response.body, { stripAlarms: strip });

  return auditedTransaction(
    db,
    principal,
    async (ctx) => applyFetched(ctx, subscription, components, response.body, dataDir),
    { ...(engine === undefined ? {} : { engine }) },
  );
}

/**
 * Els `ATTACH` d'un esdeveniment que ve d'un origen.
 *
 * **És un reemplaçament, no una fusió.** L'origen mana: si allà s'ha tret un adjunt, aquí
 * ha de desaparèixer, i comparar-los un per un demanaria una identitat que l'iCal no dona
 * —dos `ATTACH` poden tenir el mateix nom—. Es tornen a escriure només quan l'esdeveniment
 * ha canviat d'etag, que és el que evita reescriure-ho tot a cada refresc.
 *
 * L'esborrat és **suau**, com sempre: la tombstone encara ha de viatjar als clients.
 */
async function applyAttachments(
  ctx: AuditContext,
  subscription: SubscriptionRow,
  eventId: string,
  attachments: FetchedAttachment[],
  dataDir: string | undefined,
): Promise<void> {
  const previous = await sql<{ id: string }>`
    SELECT id FROM attachments WHERE event_id = ${eventId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (previous.rows.length === 0 && attachments.length === 0) return;

  for (const old of previous.rows) {
    await sql`
      UPDATE attachments SET deleted_at = ${ctx.now}, updated_at = ${ctx.now}, version = version + 1
      WHERE id = ${old.id}
    `.execute(ctx.tx);
  }

  for (const attachment of attachments) {
    const id = uuidv7();
    let storagePath: string | null = null;
    let size = 0;
    let mime = attachment.mimeType;

    if (attachment.data !== null && dataDir !== undefined) {
      const stored = await storeAttachment(id, attachment.data, ctx.now, dataDir);
      storagePath = stored.path;
      size = attachment.data.length;
      // El tipus surt del contingut encara que l'origen n'hagi declarat un: `FMTTYPE` el
      // posa qui publica el calendari, i és exactament de qui no ens en refiem.
      mime = sniffMime(attachment.data);
    } else if (attachment.data !== null) {
      // Sense on desar-los, els bytes es descarten i no es desa una fila que menteixi.
      continue;
    }

    await sql`
      INSERT INTO attachments (id, event_id, scope_id, filename, mime_type, size_bytes,
                               storage_path, external_url, source, is_ai_context,
                               created_at, updated_at)
      VALUES (${id}, ${eventId}, ${subscription.scope_id}, ${safeFilename(attachment.filename)},
              ${mime ?? 'application/octet-stream'}, ${size}, ${storagePath},
              ${attachment.url}, 'ical_attach', ${dbBool(false)}, ${ctx.now}, ${ctx.now})
    `.execute(ctx.tx);
  }
}

async function applyFetched(
  ctx: AuditContext,
  subscription: SubscriptionRow,
  components: FetchedComponent[],
  body: string,
  dataDir: string | undefined,
): Promise<RefreshResult> {
  const existing = await sql<{ id: string; uid: string; etag: string | null }>`
    SELECT id, uid, etag FROM events
    WHERE calendar_id = ${subscription.id} AND deleted_at IS NULL
  `.execute(ctx.tx);

  const byUid = new Map(existing.rows.map((row) => [row.uid, row]));
  const result: RefreshResult = { fetched: components.length, created: 0, updated: 0, removed: 0 };

  for (const component of components) {
    const row = byUid.get(component.uid);
    byUid.delete(component.uid);

    /**
     * **Es compara l'etag amb què va arribar l'última vegada** (docs/07 §9, punt 1).
     * Sense això es reescriuria cada fila a cada refresc, i cada reescriptura mouria el
     * `change_log` i faria que tots els clients de Fem-ho es rebaixessin el calendari
     * sencer cada hora sense que hagués canviat res.
     */
    if (row !== undefined && row.etag === component.etag) continue;

    if (row === undefined) {
      const eventId = uuidv7();
      await sql`
        INSERT INTO events (id, calendar_id, uid, summary, starts_at, ends_at, all_day,
                            timezone, etag, raw_ical, created_at, updated_at)
        VALUES (${eventId}, ${subscription.id}, ${component.uid}, ${component.summary},
                ${component.startsAt}, ${component.endsAt}, ${dbBool(component.allDay)},
                ${component.timezone}, ${component.etag}, ${component.raw}, ${ctx.now}, ${ctx.now})
      `.execute(ctx.tx);
      await applyAttachments(ctx, subscription, eventId, component.attachments, dataDir);
      result.created += 1;
    } else {
      await sql`
        UPDATE events SET summary = ${component.summary}, starts_at = ${component.startsAt},
                          ends_at = ${component.endsAt}, all_day = ${dbBool(component.allDay)},
                          timezone = ${component.timezone}, etag = ${component.etag},
                          raw_ical = ${component.raw}, updated_at = ${ctx.now},
                          version = version + 1
        WHERE id = ${row.id}
      `.execute(ctx.tx);
      await applyAttachments(ctx, subscription, row.id, component.attachments, dataDir);
      result.updated += 1;
    }
  }

  // El que queda al mapa ja no és a l'origen.
  for (const [, row] of byUid) {
    await sql`
      UPDATE events SET deleted_at = ${ctx.now}, updated_at = ${ctx.now} WHERE id = ${row.id}
    `.execute(ctx.tx);
    result.removed += 1;
  }

  await sql`
    UPDATE calendars
    SET last_refreshed_at = ${ctx.now},
        refresh_interval = ${refreshInterval(body, subscription.refresh_interval)},
        sync_seq = sync_seq + 1,
        updated_at = ${ctx.now}
    WHERE id = ${subscription.id}
  `.execute(ctx.tx);

  if (result.created + result.updated + result.removed === 0) {
    // Un refresc que no canvia res no és un canvi: sense això, l'embolcall d'auditoria
    // es queixaria amb raó que una transacció d'escriptura no ha deixat cap rastre.
    ctx.noChange();
    return result;
  }

  ctx.record({
    entityType: 'calendar',
    entityId: subscription.id,
    scopeId: subscription.scope_id,
    verb: 'refreshed',
    changes: {
      created: { from: null, to: result.created },
      updated: { from: null, to: result.updated },
      removed: { from: null, to: result.removed },
    },
  });

  return result;
}

/**
 * Aquesta escriptura ha de sortir cap a l'origen?
 *
 * **No, si ve del propi origen** (docs/07 §9, punt 3). Sense aquesta comprovació, dos
 * servidors sincronitzats entre ells es farien rebotar els canvis indefinidament.
 */
export function shouldPushOutbound(source: string): boolean {
  return source !== 'caldav';
}
