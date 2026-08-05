/**
 * El client de sincronització.
 *
 * Baixa el delta, aplica la memòria cau, i puja la cua. Res més: la resolució de
 * conflictes és del servidor (docs/06 §5) i la interfície només ensenya el que quedi
 * marcat com a `conflict`.
 */

import {
  CLOCK_SKEW_KEY,
  CURSOR_KEY,
  SERVER_TIME_KEY,
  readMeta,
  writeMeta,
  type FemHoDatabase,
  type SyncedEntity,
} from './db.js';
import type { OutboxRow } from './db.js';
import { applyResults, markSending, nextBatch, type OperationResult } from './outbox.js';

export interface SyncChange {
  seq: number;
  entity: SyncedEntity;
  id: string;
  op: 'upsert' | 'delete';
  data?: Record<string, unknown> | undefined;
}

export interface SyncResponse {
  changes: SyncChange[];
  next_cursor: string;
  has_more: boolean;
  server_time: string;
}

/** El transport. Es passa des de fora perquè les proves no necessitin xarxa. */
export interface SyncTransport {
  pull(cursor: string | undefined): Promise<
    | { ok: true; body: SyncResponse }
    // El 409 no és un error de xarxa: és una resposta legítima que vol dir
    // "el teu cursor és massa vell, torna a començar" (docs/06 §3).
    | { ok: false; mustResync: true }
  >;
  push(operations: unknown[]): Promise<{ results: OperationResult[] }>;
}

/** El client ha perdut el fil i ha de tornar a baixar-ho tot. */
export class MustResync extends Error {
  constructor() {
    super('El cursor és massa vell. Cal una sincronització completa.');
    this.name = 'MustResync';
  }
}

/**
 * Baixa fins que no queda res.
 *
 * Un `409` buida **la memòria cau i el cursor, però no la cua de sortida**: el que
 * l'usuari ha fet offline no s'ha de perdre perquè hagi estat mesos sense obrir
 * l'aplicació.
 */
export async function pull(
  db: FemHoDatabase,
  transport: SyncTransport,
  { resyncOnStale = true } = {},
): Promise<{ applied: number; resynced: boolean }> {
  let cursor = await readMeta(db, CURSOR_KEY);
  let applied = 0;
  let resynced = false;

  for (;;) {
    const response = await transport.pull(cursor);

    if (!response.ok) {
      if (!resyncOnStale) throw new MustResync();
      await db.transaction('rw', db.entities, db.meta, async () => {
        await db.entities.clear();
        await db.meta.delete(CURSOR_KEY);
      });
      cursor = undefined;
      resynced = true;
      continue;
    }

    const { changes, next_cursor, has_more, server_time } = response.body;

    await db.transaction('rw', db.entities, db.meta, async () => {
      for (const change of changes) {
        if (change.op === 'delete') {
          /**
           * Una tombstone **esborra la fila local**. Si es deixés amb una marca, cada
           * consulta local hauria de recordar-se de filtrar-la, i la primera que ho
           * oblidés ensenyaria una tasca que ja no existeix.
           */
          await db.entities.delete(change.id);
        } else if (change.data !== undefined) {
          await db.entities.put({ ...(change.data as { id: string }), entity_type: change.entity });
        }
      }

      await writeMeta(db, CURSOR_KEY, next_cursor);
      await writeMeta(db, SERVER_TIME_KEY, server_time);
    });

    applied += changes.length;
    cursor = next_cursor;
    if (!has_more) break;
  }

  return { applied, resynced };
}

/**
 * Puja el proper lot.
 *
 * Torna quantes operacions queden a la cua, que és el que la interfície ensenya al
 * comptador de "pendent de pujar".
 */
export async function push(
  db: FemHoDatabase,
  transport: SyncTransport,
): Promise<{ sent: number; remaining: number }> {
  const batch = await nextBatch(db);
  if (batch.length === 0) return { sent: 0, remaining: 0 };

  await markSending(db, batch);

  let results: OperationResult[];
  try {
    const response = await transport.push(batch.map(toOperation));
    results = response.results;
  } catch {
    /**
     * Sense xarxa no és un rebuig: les operacions tornen a `pending` **sense** gastar un
     * intent. Si es comptés, un avió de vuit hores esgotaria el comptador i la cua
     * quedaria morta en aterrar.
     */
    await db.outbox.bulkPut(batch.map((row) => ({ ...row, status: 'pending' as const })));
    return { sent: 0, remaining: await db.outbox.count() };
  }

  await applyResults(db, batch, results);
  return { sent: batch.length, remaining: await db.outbox.count() };
}

function toOperation(row: OutboxRow): Record<string, unknown> {
  return {
    op_id: row.id,
    entity: row.entity_type,
    op: row.op,
    id: row.entity_id,
    base_version: row.base_version,
    data: row.payload,
  };
}

/**
 * Una passada sencera: primer puja, després baixa.
 *
 * **Aquest ordre i no l'altre.** Si es baixés primer, el delta portaria l'estat antic
 * de les entitats que l'usuari acaba de canviar offline i la memòria cau local
 * retrocediria uns segons abans de tornar endavant — un parpelleig visible.
 */
export async function sync(
  db: FemHoDatabase,
  transport: SyncTransport,
): Promise<{ sent: number; applied: number; resynced: boolean }> {
  const pushed = await push(db, transport);
  const pulled = await pull(db, transport);
  return { sent: pushed.sent, applied: pulled.applied, resynced: pulled.resynced };
}

/**
 * Desviació entre el rellotge del client i el del servidor.
 *
 * `docs/06` §2 fa que cada resposta porti `server_time` justament per poder-la calcular.
 * Un client amb el rellotge mal posat genera `created_at` del futur i les seves
 * operacions surten sempre les últimes de la cua.
 */
export function recordClockSkew(
  db: FemHoDatabase,
  serverTime: string,
  localTime: string,
): Promise<void> {
  const skew = Date.parse(serverTime) - Date.parse(localTime);
  return writeMeta(db, CLOCK_SKEW_KEY, String(skew));
}
