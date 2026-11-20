import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { isLocale, type components, type Locale } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import type { Capability } from '../policy/capabilities.js';
import { missingCapability, notFound, PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { listAttachments, MCP_ATTACHMENT_MAX_BYTES, readAttachment } from './attachments.js';
import { insertTaskComment } from './comments.js';
import { requireHumanSession } from './external-access.js';
import { assertScopeRole } from './scopes.js';
import { destinationOf, settingsOfAi, aiUnavailable } from './task-ai-settings.js';
import { executionContextOf } from './task-ai-context.js';
import { getTask } from './tasks.js';
import { getProfile } from './users.js';

export {
  assertAiSubscriptionAccess,
  saveSubscription,
  removeSubscription,
} from './task-ai-settings.js';

export type TaskAiExecution = components['schemas']['TaskAiExecution'];
export interface ExecutionRow extends TaskAiExecution {
  user_id: string;
  task_id: string;
  scope_id: string;
  settings_revision: string;
  connection_id: string;
  oauth_session_id: string;
  attempts: number;
  created_at: string;
  available_at: string;
  claim_until: string | null;
}

const contextRead: Capability[] = [
  'tasks:read',
  'projects:read',
  'checklists:read',
  'comments:read',
  'attachments:read',
];

function executionView(row: ExecutionRow): TaskAiExecution {
  const { id, method, status, session_url, retry_at, result_comment_id } = row;
  return { id, method, status, session_url, retry_at, result_comment_id };
}

async function executionOf(db: MigrationDb, id: string) {
  const { rows } =
    await sql<ExecutionRow>`SELECT * FROM task_ai_executions WHERE id = ${id}`.execute(db);
  return rows[0];
}

async function replayOf(
  db: MigrationDb,
  id: string,
  userId: string,
  taskId: string,
  scopeId: string,
) {
  const { rows } = await sql<ExecutionRow>`
    SELECT e.* FROM task_ai_requests r
    JOIN task_ai_executions e ON e.id = r.execution_id WHERE r.id = ${id}
  `.execute(db);
  const row = rows[0];
  if (
    row !== undefined &&
    (row.user_id !== userId || row.task_id !== taskId || row.scope_id !== scopeId)
  )
    throw new PolicyError(
      'task-ai-id-conflict',
      'AI execution ID conflict',
      409,
      'Use a new request identifier.',
    );
  return row;
}

export function recordExecution(
  ctx: AuditContext,
  row: ExecutionRow,
  verb: 'ai_execution_requested' | 'ai_execution_updated' | 'ai_execution_result',
  previous: TaskAiExecution['status'] | null = null,
) {
  ctx.record({
    entityType: 'task',
    entityId: row.task_id,
    scopeId: row.scope_id,
    verb,
    changes: {
      execution_id: { from: null, to: row.id },
      method: { from: null, to: row.method },
      status: { from: previous, to: verb === 'ai_execution_result' ? 'result' : row.status },
    },
  });
}

export async function requestExecution(
  ctx: AuditContext,
  principal: Principal,
  taskId: string,
  id: string,
) {
  requireHumanSession(principal);
  const task = await getTask(ctx.tx, principal, taskId);
  await assertScopeRole(ctx.tx, principal, task.scope_id, 'content');
  const current = await sql<{ id: string }>`
    UPDATE tasks SET last_activity_at = last_activity_at
    WHERE id = ${taskId} AND scope_id = ${task.scope_id} AND deleted_at IS NULL RETURNING id
  `.execute(ctx.tx);
  if (current.rows.length === 0) throw aiUnavailable();
  const existing = await replayOf(ctx.tx, id, principal.userId, taskId, task.scope_id);
  if (existing !== undefined) {
    ctx.noChange();
    return executionView(existing);
  }
  const settings = await settingsOfAi(ctx.tx, principal.userId, task.scope_id);
  const destination = await destinationOf(ctx.tx, settings, ctx.now);
  if (destination === undefined || settings.method === 'copy') throw aiUnavailable();
  if (settings.method === 'claude_routine') {
    const { rows } = await sql<{ retry_at: string }>`
      SELECT retry_at FROM task_ai_executions WHERE user_id = ${principal.userId}
        AND scope_id = ${task.scope_id} AND settings_revision = ${settings.revision}
        AND retry_at > ${ctx.now} ORDER BY retry_at DESC LIMIT 1
    `.execute(ctx.tx);
    if (rows[0] !== undefined)
      throw new PolicyError(
        'task-ai-rate-limited',
        'AI destination rate limited',
        429,
        'Wait before running the routine again.',
        { retry_at: rows[0].retry_at },
      );
  }

  // La restricció parcial de la base arbitra els clics concurrents de dos dispositius.
  const inserted = await sql<ExecutionRow>`
    INSERT INTO task_ai_executions (id, user_id, task_id, scope_id, method, settings_revision,
      connection_id, oauth_session_id, status, created_at, available_at)
    VALUES (${id}, ${principal.userId}, ${taskId}, ${task.scope_id}, ${settings.method}, ${settings.revision},
      ${destination.conn.id}, ${destination.conn.oauth_session_id}, 'queued', ${ctx.now}, ${ctx.now})
    ON CONFLICT DO NOTHING RETURNING *
  `.execute(ctx.tx);
  let row = inserted.rows[0];
  if (row === undefined) {
    row = await replayOf(ctx.tx, id, principal.userId, taskId, task.scope_id);
    row ??= (
      await sql<ExecutionRow>`
      SELECT * FROM task_ai_executions WHERE user_id = ${principal.userId} AND task_id = ${taskId}
        AND scope_id = ${task.scope_id} AND status IN ('queued', 'sending')
    `.execute(ctx.tx)
    ).rows[0];
    if (row === undefined)
      throw new PolicyError(
        'task-ai-id-conflict',
        'AI execution ID conflict',
        409,
        'Retry the request.',
      );
  }

  const mapping = await sql<{ id: string }>`
    INSERT INTO task_ai_requests (id, execution_id) VALUES (${id}, ${row.id})
    ON CONFLICT DO NOTHING RETURNING id
  `.execute(ctx.tx);
  const replay = await replayOf(ctx.tx, id, principal.userId, taskId, task.scope_id);
  if (replay?.id !== row.id)
    throw new PolicyError(
      'task-ai-id-conflict',
      'AI execution ID conflict',
      409,
      'Use a new request identifier.',
    );
  if (inserted.rows.length > 0) recordExecution(ctx, row, 'ai_execution_requested');
  else if (mapping.rows.length > 0)
    ctx.record({ entityType: 'task_ai_request', entityId: id, verb: 'created' });
  else ctx.noChange();
  return executionView(row);
}

export async function listExecutions(db: MigrationDb, principal: Principal, taskId: string) {
  requireHumanSession(principal);
  const task = await getTask(db, principal, taskId);
  const { rows } = await sql<ExecutionRow>`
    SELECT * FROM task_ai_executions WHERE task_id = ${taskId} AND user_id = ${principal.userId}
      AND scope_id = ${task.scope_id}
    ORDER BY created_at DESC, id DESC
  `.execute(db);
  return rows.map(executionView);
}

export async function copyExecutionContext(db: MigrationDb, principal: Principal, taskId: string) {
  requireHumanSession(principal);
  const task = await getTask(db, principal, taskId);
  if (!(await settingsOfAi(db, principal.userId, task.scope_id)).enabled) throw aiUnavailable();
  const { locale } = await getProfile(db, principal.userId);
  const context = await executionContextOf(
    db,
    { ...principal, scopeIds: new Set([task.scope_id]) },
    taskId,
    isLocale(locale) ? locale : 'ca',
  );
  return { text: context.text };
}

async function assertReceivedExecution(
  db: MigrationDb,
  principal: Principal,
  id: string,
  now: string,
  capability: Capability,
): Promise<ExecutionRow> {
  if (
    principal.credentialType !== 'oauth' ||
    !hasCapability(principal, 'ai_executions:read') ||
    !hasCapability(principal, capability)
  )
    throw missingCapability(capability);

  const row = await executionOf(db, id);
  if (
    row === undefined ||
    row.user_id !== principal.userId ||
    row.connection_id !== principal.credentialId ||
    row.oauth_session_id !== principal.oauthSessionId ||
    row.attempts === 0 ||
    row.status === 'cancelled' ||
    row.status === 'failed'
  )
    throw notFound('execution', id);
  await assertScopeRole(db, principal, row.scope_id, 'content', { type: 'Execution', id });
  const settings = await settingsOfAi(db, row.user_id, row.scope_id);
  const destination = await destinationOf(db, settings, now);
  if (
    settings.revision !== row.settings_revision ||
    destination?.conn.oauth_session_id !== row.oauth_session_id
  )
    throw aiUnavailable();
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM tasks WHERE id = ${row.task_id} AND scope_id = ${row.scope_id} AND deleted_at IS NULL
  `.execute(db);
  if (rows.length === 0) throw notFound('execution', id);
  return row;
}

function taskReadPrincipal(principal: Principal, scopeId: string): Principal {
  // L'autorització del lliurament dona lectura d'una sola tasca. Els serveis compartits
  // comproven l'àmbit de nou i aquest principal temporal mai entra al catàleg MCP.
  return { ...principal, scopeIds: new Set([scopeId]), capabilities: new Set(contextRead) };
}

export async function getExecutionContext(
  db: MigrationDb,
  principal: Principal,
  id: string,
  locale: Locale = 'en',
) {
  const row = await assertReceivedExecution(
    db,
    principal,
    id,
    new Date().toISOString(),
    'ai_executions:read',
  );
  return executionContextOf(db, taskReadPrincipal(principal, row.scope_id), row.task_id, locale);
}

export async function getExecutionAttachment(
  db: MigrationDb,
  principal: Principal,
  id: string,
  attachmentId: string,
  dataDir: string,
) {
  const row = await assertReceivedExecution(
    db,
    principal,
    id,
    new Date().toISOString(),
    'ai_executions:read',
  );
  const reader = taskReadPrincipal(principal, row.scope_id);
  const attachments = await listAttachments(db, reader, { taskId: row.task_id });
  const attachment = attachments.find((file) => file.id === attachmentId && file.is_ai_context);
  if (attachment === undefined) throw notFound('attachment', attachmentId);
  const tooLarge = () =>
    new PolicyError(
      'attachment-too-big',
      'Attachment too large',
      413,
      'Download this attachment from Fem-ho and attach it manually.',
    );
  if (attachment.size_bytes > MCP_ATTACHMENT_MAX_BYTES) throw tooLarge();
  const { row: file, data } = await readAttachment(db, reader, attachmentId, dataDir);
  if (!file.is_ai_context || file.task_id !== row.task_id)
    throw notFound('attachment', attachmentId);
  if (data.length > MCP_ATTACHMENT_MAX_BYTES) throw tooLarge();
  return { data, mime_type: file.mime_type, filename: file.filename };
}

export async function reportExecutionResult(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  body: string,
) {
  const execution = await assertReceivedExecution(
    ctx.tx,
    principal,
    id,
    ctx.now,
    'ai_executions:write',
  );
  if (execution.result_comment_id !== null) {
    ctx.noChange();
    return { comment_id: execution.result_comment_id };
  }

  // Es pren el pany abans d'escriure per impedir que un canvi d'àmbit publiqui el resultat
  // en un altre lloc. És el mateix ordre que l'edició de la tasca i la seva auditoria.
  const task = await sql<{ id: string }>`
    UPDATE tasks SET last_activity_at = last_activity_at
    WHERE id = ${execution.task_id} AND scope_id = ${execution.scope_id} AND deleted_at IS NULL RETURNING id
  `.execute(ctx.tx);
  if (task.rows.length === 0) throw notFound('execution', id);
  const commentId = uuidv7();
  const { rows } = await sql<ExecutionRow>`
    UPDATE task_ai_executions SET result_comment_id = ${commentId}
    WHERE id = ${id} AND result_comment_id IS NULL RETURNING *
  `.execute(ctx.tx);
  const row = rows[0];
  if (row === undefined) {
    const first = await executionOf(ctx.tx, id);
    if (first?.result_comment_id === null || first === undefined) throw notFound('execution', id);
    ctx.noChange();
    return { comment_id: first.result_comment_id };
  }
  await insertTaskComment(ctx, principal, row.task_id, row.scope_id, body, commentId, {
    executionResult: true,
  });
  recordExecution(ctx, row, 'ai_execution_result', execution.status);
  return { comment_id: commentId };
}
