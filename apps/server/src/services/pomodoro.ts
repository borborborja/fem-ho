import {
  applyPomodoroCommand,
  emptyPomodoroSnapshot,
  generatePosition,
  InvalidPositionError,
  type PomodoroCommand,
  type PomodoroSnapshot,
} from '@fem-ho/contracts';
import { sql } from 'kysely';
import { z } from 'zod';
import { auditedTransaction, type AuditContext } from '../audit/audited-transaction.js';
import type { Connection } from '../db/connection.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError } from '../policy/errors.js';
import { canSeeScope, type Principal } from '../policy/principal.js';
import { visibleScopesPredicate } from '../policy/scope-visibility.js';
import { requireHumanSession } from './external-access.js';
import { lockSyncOp, recallOp, rememberOp, type BatchOperation, type BatchResult } from './sync.js';
import { moveTask } from './tasks.js';

const MINUTE_MS = 60_000;
const MINUTES = z.number().int().min(1).max(180);
const timedFields = {
  timer_id: z.uuid(),
  at_ms: z.number().int().nonnegative(),
  device_id: z.string().min(1).max(128),
  position: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-zA-Z0-9]+$/u)
    .optional(),
};
const commandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('settings'),
    patch: z.strictObject({
      enabled: z.boolean().optional(),
      mode: z.enum(['playful', 'serious']).optional(),
      focus_minutes: MINUTES.optional(),
      short_break_minutes: MINUTES.optional(),
      long_break_minutes: MINUTES.optional(),
      long_break_every: z.number().int().min(1).max(20).optional(),
      auto_start_focus: z.boolean().optional(),
      auto_start_break: z.boolean().optional(),
      sound: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('queue'),
    expected_version: z.number().int().nonnegative(),
    task_ids: z
      .array(z.uuid())
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
  }),
  z.strictObject({
    kind: z.literal('start'),
    ...timedFields,
    task_id: z.uuid().nullable(),
  }),
  z.strictObject({
    kind: z.literal('control'),
    ...timedFields,
    action: z.enum(['resume', 'pause', 'reset', 'skip', 'stop']),
    expected_version: z.number().int().nonnegative(),
    phase_number: z.number().int().nonnegative(),
    task_id: z.uuid().nullable().optional(),
  }),
]);

type StoredState = Pick<PomodoroSnapshot, 'settings' | 'queue' | 'queue_version' | 'timer'>;
type EligibleTask = { id: string; scope_id: string; status: 'todo' | 'doing'; version: number };

function invalidCommand(detail: string): PolicyError {
  return new PolicyError('invalid-pomodoro-command', 'Invalid Pomodoro command', 422, detail);
}

function parseCommand(raw: unknown, nowMs: number): PomodoroCommand {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw invalidCommand('Provide a valid timer, queue or settings command.');
  // Un camp opcional d'un cos JSON arriba absent o amb un valor, mai amb `undefined`.
  const command = parsed.data as PomodoroCommand;
  if (command.kind !== 'start' && command.kind !== 'control') return command;
  if (command.at_ms > nowMs + 5 * MINUTE_MS) throw invalidCommand('The device clock is ahead.');
  if (command.kind === 'control' && command.action !== 'resume' && command.task_id !== undefined)
    throw invalidCommand('A task can only be selected when starting a focus phase.');
  if (command.position !== undefined && command.task_id == null)
    throw invalidCommand('A position requires a selected task.');
  if (command.position !== undefined) {
    try {
      // El validador de posicions del tauler també comprova la part entera de la clau.
      generatePosition(command.position, null, () => 0);
    } catch (error) {
      if (!(error instanceof InvalidPositionError)) throw error;
      throw invalidCommand('Provide a valid task position.');
    }
  }
  return { ...command, at_ms: Math.min(command.at_ms, nowMs) };
}

async function eligibleTasks(db: MigrationDb, principal: Principal, ids: string[]) {
  if (ids.length === 0) return new Map<string, EligibleTask>();
  const tasks = await sql<EligibleTask>`
    SELECT t.id, t.scope_id, t.status, t.version FROM tasks t
    JOIN scopes s ON s.id = t.scope_id
    WHERE t.id IN (${sql.join(ids)}) AND t.deleted_at IS NULL AND s.deleted_at IS NULL
      AND t.status IN ('todo', 'doing') AND ${visibleScopesPredicate(principal.userId)}
  `.execute(db);
  return new Map(
    tasks.rows
      .filter((task) => canSeeScope(principal, task.scope_id))
      .map((task) => [task.id, task]),
  );
}

async function readState(
  db: MigrationDb,
  principal: Principal,
  nowMs: number,
): Promise<PomodoroSnapshot> {
  const result = await sql<{ state: string }>`
    SELECT state FROM pomodoro_states WHERE user_id = ${principal.userId}
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) return emptyPomodoroSnapshot(nowMs);

  const stored = JSON.parse(row.state) as StoredState;
  const { queue, timer } = stored;
  const linked = timer?.task_id;
  const tasks = await eligibleTasks(db, principal, linked == null ? queue : [...queue, linked]);
  return {
    ...stored,
    queue: queue.filter((id) => tasks.has(id)),
    timer:
      timer !== null && linked != null && !tasks.has(linked) ? { ...timer, task_id: null } : timer,
    server_time_ms: nowMs,
  };
}

export async function getPomodoro(
  db: MigrationDb,
  principal: Principal,
): Promise<PomodoroSnapshot> {
  requireHumanSession(principal);
  return readState(db, principal, Date.now());
}

async function applyTaskSelection(
  ctx: AuditContext,
  principal: Principal,
  command: Extract<PomodoroCommand, { kind: 'start' | 'control' }>,
) {
  if (command.task_id == null) return undefined;
  const tasks = await eligibleTasks(ctx.tx, principal, [command.task_id]);
  const task = tasks.get(command.task_id);
  if (task === undefined) throw invalidCommand('The selected task is no longer available.');
  if (task.status === 'doing') return undefined;

  return moveTask(ctx, principal, task.id, {
    status: 'doing',
    from_status: 'todo',
    expected_version: task.version,
    occurred_at: new Date(command.at_ms).toISOString(),
    position: command.position,
  });
}

async function saveState(
  ctx: AuditContext,
  principal: Principal,
  before: PomodoroSnapshot,
  after: PomodoroSnapshot,
): Promise<void> {
  const { settings, queue, queue_version, timer } = after;
  const stored: StoredState = { settings, queue, queue_version, timer };
  const fields = ['settings', 'queue', 'queue_version', 'timer'] as const;
  const changes = Object.fromEntries(
    fields
      .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
      .map((field) => [field, { from: before[field], to: after[field] }]),
  );
  if (Object.keys(changes).length === 0) {
    ctx.noChange();
    return;
  }

  await sql`
    INSERT INTO pomodoro_states (user_id, state) VALUES (${principal.userId}, ${JSON.stringify(stored)})
    ON CONFLICT (user_id) DO UPDATE SET state = excluded.state
  `.execute(ctx.tx);
  ctx.record({ entityType: 'pomodoro', entityId: principal.userId, verb: 'updated', changes });
}

export async function syncPomodoro(
  connection: Connection,
  principal: Principal,
  operation: BatchOperation,
): Promise<BatchResult> {
  requireHumanSession(principal);
  if (operation.op !== 'update' || operation.id !== principal.userId) {
    throw invalidCommand('A Pomodoro command must update your own account.');
  }

  return auditedTransaction(
    connection.db,
    principal,
    async (ctx): Promise<BatchResult> => {
      await lockSyncOp(ctx.tx, connection.engine, principal, operation.op_id);
      // No cal que existeixi una fila: els dos dispositius també es poden avançar en la primera escriptura.
      if (connection.engine === 'postgres') {
        await sql`SELECT pg_advisory_xact_lock(851005, hashtext(${principal.userId}))`.execute(
          ctx.tx,
        );
      }
      const nowMs = Date.parse(ctx.now);
      const before = await readState(ctx.tx, principal, nowMs);
      const conflict = (): Extract<BatchResult, { status: 'conflict' }> => ({
        op_id: operation.op_id,
        status: 'conflict',
        server_entity: { ...before },
      });

      const previous = await recallOp(ctx.tx, principal, operation);
      if (previous !== undefined) {
        ctx.noChange();
        // El rebut no ha de lliurar identificadors o dades d'un àmbit que ja no es veu.
        if (previous.status === 'ok') return { ...previous, entity: { ...before } };
        return previous.status === 'conflict' ? conflict() : previous;
      }

      const command = parseCommand(operation.data, nowMs);
      const after = applyPomodoroCommand(before, command);
      if (after === null) {
        ctx.noChange();
        await rememberOp(
          ctx.tx,
          principal,
          operation,
          { ...conflict(), server_entity: {} },
          ctx.now,
        );
        return conflict();
      }

      if (command.kind === 'queue') {
        const tasks = await eligibleTasks(ctx.tx, principal, command.task_ids);
        if (
          command.task_ids.some(
            (id) =>
              !tasks.has(id) || (tasks.get(id)?.status !== 'todo' && !before.queue.includes(id)),
          )
        ) {
          throw invalidCommand('Only available to-do tasks can be added to the queue.');
        }
      }
      const movedTask =
        command.kind === 'start' || command.kind === 'control'
          ? await applyTaskSelection(ctx, principal, command)
          : undefined;

      await saveState(ctx, principal, before, after);
      await rememberOp(
        ctx.tx,
        principal,
        operation,
        { op_id: operation.op_id, status: 'ok' },
        ctx.now,
      );
      return {
        op_id: operation.op_id,
        status: 'ok',
        entity: {
          ...after,
          server_time_ms: nowMs,
          ...(movedTask === undefined ? {} : { moved_task: movedTask }),
        },
      };
    },
    { engine: connection.engine },
  );
}
