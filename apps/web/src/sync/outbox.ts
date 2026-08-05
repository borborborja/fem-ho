/**
 * La cua de sortida (docs/06 §4).
 *
 * Tres regles i prou:
 *
 * 1. **Ordre de creació, en sèrie per entitat.** Dues edicions de la mateixa tasca
 *    s'apliquen en ordre.
 * 2. **Ordre topològic dins del lot.** Si es crea una tasca i tot seguit una subtasca
 *    seva, la tasca va primer.
 * 3. **Fusió.** Diverses edicions pendents de la mateixa entitat es fusionen en una.
 *    Marcar una tasca feta, desfer-ho i tornar-la a marcar produeix **una** operació.
 *
 * La fusió i l'ordre són funcions pures sobre files: així es poden provar sense
 * IndexedDB i, sobretot, es poden llegir.
 */

import { v7 as uuidv7 } from 'uuid';
import type { FemHoDatabase, OutboxOp, OutboxRow, SyncedEntity } from './db.js';

export interface EnqueueInput {
  op_id: string;
  entity_type: SyncedEntity;
  entity_id: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  base_version?: number | undefined;
  depends_on?: string[] | undefined;
  now: string;
}

/**
 * Fusiona una operació nova amb les pendents.
 *
 * **No es fusionen** operacions de tipus diferent (una edició i un esborrat no són la
 * mateixa cosa) ni res que ja estigui en `sending`: allò ja és a la xarxa i canviar-ho
 * ara faria que el servidor rebés un cos diferent sota un `op_id` que ja ha vist.
 */
export function mergeInto(pending: OutboxRow[], incoming: OutboxRow): OutboxRow[] {
  const fusionable = pending.find(
    (row) =>
      row.status === 'pending' &&
      row.entity_type === incoming.entity_type &&
      row.entity_id === incoming.entity_id &&
      row.op === incoming.op,
  );

  if (fusionable === undefined) return [...pending, incoming];

  return pending.map((row) =>
    row.id === fusionable.id
      ? {
          ...row,
          // El camp que arriba després mana; els que només tenia l'antiga es conserven.
          payload: { ...row.payload, ...incoming.payload },
          /**
           * Es conserva la `base_version` MÉS ANTIGA: és l'última versió que el client
           * va veure del servidor. Les edicions locals posteriors no venen del servidor
           * i per tant no són una base vàlida sobre la qual dir que s'ha editat.
           */
          base_version: row.base_version ?? incoming.base_version,
          depends_on: [...new Set([...(row.depends_on ?? []), ...(incoming.depends_on ?? [])])],
          // `created_at` i `id` no es toquen: la fusió no ha de reordenar la cua.
        }
      : row,
  );
}

/**
 * Ordena un lot de manera que cap operació surti abans que allò de què depèn.
 *
 * És una ordenació estable: entre operacions independents es manté l'ordre de creació,
 * que és el que la regla 1 exigeix.
 */
export function topologicalOrder(rows: OutboxRow[]): OutboxRow[] {
  const byEntity = new Map<string, OutboxRow[]>();
  for (const row of rows) {
    const list = byEntity.get(row.entity_id);
    if (list === undefined) byEntity.set(row.entity_id, [row]);
    else list.push(row);
  }

  const ordered: OutboxRow[] = [];
  const emitted = new Set<string>();
  const visiting = new Set<string>();

  const emit = (row: OutboxRow): void => {
    if (emitted.has(row.id)) return;
    // Un cicle no pot passar amb dades sanes, però si passés val més enviar-ho en
    // l'ordre de creació que penjar-se en una recursió infinita.
    if (visiting.has(row.id)) return;
    visiting.add(row.id);

    /**
     * La dependència mana per damunt del rellotge: encara que l'operació del pare
     * s'hagi encuat DESPRÉS, ha de sortir abans, o el servidor rebrà una subtasca d'una
     * tasca que encara no existeix i la rebutjarà amb un 404.
     *
     * Això no trenca la regla 1: dins de cada entitat l'ordre relatiu es manté, i entre
     * entitats diferents docs/06 §4 ja diu que poden anar en paral·lel.
     */
    for (const dependency of row.depends_on ?? []) {
      for (const previous of byEntity.get(dependency) ?? []) emit(previous);
    }

    visiting.delete(row.id);
    if (!emitted.has(row.id)) {
      emitted.add(row.id);
      ordered.push(row);
    }
  };

  for (const row of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) emit(row);
  return ordered;
}

/** Encua una operació, fusionant-la amb les pendents si toca. */
export async function enqueue(db: FemHoDatabase, input: EnqueueInput): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const pending = await db.outbox
      .where('[entity_type+entity_id]')
      .equals([input.entity_type, input.entity_id])
      .toArray();

    const incoming: OutboxRow = {
      id: input.op_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      op: input.op,
      payload: input.payload,
      base_version: input.base_version,
      depends_on: input.depends_on,
      created_at: input.now,
      attempts: 0,
      status: 'pending',
    };

    const merged = mergeInto(pending, incoming);
    // Només s'escriuen les que han canviat: `bulkPut` amb tota la llista faria d'una
    // fusió una reescriptura de tota la cua de l'entitat.
    const abans = new Map(pending.map((row) => [row.id, JSON.stringify(row)]));
    await db.outbox.bulkPut(merged.filter((row) => abans.get(row.id) !== JSON.stringify(row)));
  });
}

/**
 * El proper lot a enviar, ja ordenat.
 *
 * Les operacions en `conflict` no hi entren: esperen que l'usuari decideixi. Les
 * `failed` sí, perquè un rebuig pot ser transitori (el servidor estava caigut) i el que
 * les atura de debò és el comptador d'intents.
 */
export async function nextBatch(
  db: FemHoDatabase,
  { limit = 100, maxAttempts = 8 } = {},
): Promise<OutboxRow[]> {
  const candidates = await db.outbox
    .where('status')
    .anyOf('pending', 'failed')
    .filter((row) => row.attempts < maxAttempts)
    .toArray();

  return topologicalOrder(candidates).slice(0, limit);
}

export async function markSending(db: FemHoDatabase, rows: OutboxRow[]): Promise<void> {
  await db.outbox.bulkPut(rows.map((row) => ({ ...row, status: 'sending' as const })));
}

export interface OperationResult {
  op_id: string;
  status: 'ok' | 'conflict' | 'rejected';
  entity?: Record<string, unknown> | undefined;
  server_entity?: Record<string, unknown> | undefined;
  error?: { detail?: string } | undefined;
}

/**
 * Aplica els resultats del lot.
 *
 * Un `op_id` que no torna cap resultat es deixa en `pending`: la resposta s'ha perdut,
 * però com que l'`op_id` és la clau d'idempotència, reenviar-lo no duplica res.
 */
export async function applyResults(
  db: FemHoDatabase,
  sent: OutboxRow[],
  results: OperationResult[],
): Promise<void> {
  const byId = new Map(results.map((result) => [result.op_id, result]));

  await db.transaction('rw', db.outbox, db.entities, async () => {
    for (const row of sent) {
      const result = byId.get(row.id);

      if (result === undefined) {
        await db.outbox.put({ ...row, status: 'pending', attempts: row.attempts + 1 });
        continue;
      }

      if (result.status === 'ok') {
        await db.outbox.delete(row.id);
        if (result.entity !== undefined) {
          await db.entities.put({
            ...(result.entity as { id: string }),
            entity_type: row.entity_type,
          });
        }
        continue;
      }

      if (result.status === 'conflict') {
        await db.outbox.put({ ...row, status: 'conflict', server_entity: result.server_entity });
        if (result.server_entity !== undefined) {
          await db.entities.put({
            ...(result.server_entity as { id: string }),
            entity_type: row.entity_type,
          });
        }
        continue;
      }

      await db.outbox.put({
        ...row,
        status: 'failed',
        attempts: row.attempts + 1,
        last_error: result.error?.detail,
      });
    }
  });
}

/**
 * Resol un conflicte amb el que l'usuari ha triat.
 *
 * `mine` reencua l'operació amb la versió del servidor com a base nova, que és el que
 * fa que el segon intent no torni a xocar. `theirs` la descarta.
 *
 * **Amb un `op_id` NOU, i això no és opcional.** L'`op_id` vell ja té una resposta
 * definitiva del servidor: el conflicte. Com que el servidor memoritza el resultat per
 * `op_id` (docs/06 §4), reenviar-lo tornaria el mateix conflicte per sempre i el botó
 * "la meva" no faria res. És una operació nova sobre una base nova, i per tant li toca
 * una clau d'idempotència nova.
 */
export async function resolveConflict(
  db: FemHoDatabase,
  opId: string,
  choice: 'mine' | 'theirs',
  newOpId: string = uuidv7(),
): Promise<void> {
  await db.transaction('rw', db.outbox, async () => {
    const row = await db.outbox.get(opId);
    if (row === undefined) return;

    await db.outbox.delete(opId);
    if (choice === 'theirs') return;

    await db.outbox.put({
      ...row,
      id: newOpId,
      status: 'pending',
      attempts: 0,
      base_version: (row.server_entity?.version as number | undefined) ?? row.base_version,
      server_entity: undefined,
    });
  });
}
