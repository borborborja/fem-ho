/**
 * La base de dades local de la web.
 *
 * Dexie sobre IndexedDB. La taula `outbox` és la de `docs/06` §4 traduïda a índexs
 * d'IndexedDB; la resta són la memòria cau de les entitats, que és el que fa que
 * l'aplicació obri en fred sense xarxa.
 */

import Dexie, { type EntityTable } from 'dexie';

/** Les entitats que se sincronitzen. Han de coincidir amb `TABLES` del servidor. */
export const SYNCED_ENTITIES = ['task', 'subtask', 'checklist', 'checklist_item'] as const;
export type SyncedEntity = (typeof SYNCED_ENTITIES)[number];

/** Una fila de la memòria cau: l'entitat sencera tal com la va servir el servidor. */
export interface CachedRow {
  id: string;
  scope_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  checklist_id?: string | null;
  version?: number;
  [field: string]: unknown;
}

export type OutboxOp = 'create' | 'update' | 'delete' | 'move';
export type OutboxStatus = 'pending' | 'sending' | 'failed' | 'conflict';

export interface OutboxRow {
  /** És l'`op_id` que veurà el servidor: la clau d'idempotència (docs/06 §4). */
  id: string;
  entity_type: SyncedEntity;
  entity_id: string;
  op: OutboxOp;
  payload: Record<string, unknown>;
  /** La versió sobre la qual s'edita. `undefined` en una creació. */
  base_version?: number | undefined;
  created_at: string;
  attempts: number;
  last_error?: string | undefined;
  status: OutboxStatus;
  /**
   * Els identificadors d'entitats que han d'existir al servidor abans que aquesta
   * operació. És el que permet l'ordre topològic dins del lot sense que la cua hagi de
   * conèixer l'esquema.
   */
  depends_on?: string[] | undefined;
  /** L'entitat que ha tornat el servidor quan `status = 'conflict'`. */
  server_entity?: Record<string, unknown> | undefined;
}

/** Claus de la taula `meta`. */
export const CURSOR_KEY = 'sync_cursor';
export const SERVER_TIME_KEY = 'server_time';
export const CLOCK_SKEW_KEY = 'clock_skew_ms';

export interface MetaRow {
  key: string;
  value: string;
}

export class FemHoDatabase extends Dexie {
  entities!: EntityTable<CachedRow & { entity_type: SyncedEntity }, 'id'>;
  outbox!: EntityTable<OutboxRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name = 'fem-ho') {
    super(name);
    this.version(1).stores({
      // Una sola taula per a totes les entitats: el delta arriba amb `entity` i `id`, i
      // partir-ho en quatre taules només afegiria un `switch` a cada camí.
      entities: 'id, entity_type, scope_id, project_id, task_id, checklist_id',
      // `status` i `created_at` són l'índex que recorre la cua; l'índex compost és el que
      // troba les operacions fusionables sense llegir la taula sencera.
      outbox: 'id, status, created_at, [entity_type+entity_id]',
      meta: 'key',
    });
  }
}

export async function readMeta(db: FemHoDatabase, key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function writeMeta(db: FemHoDatabase, key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
