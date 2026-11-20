import { sql } from 'kysely';
import { z } from 'zod';
import { auditedTransaction } from '../audit/audited-transaction.js';
import { safeFetch } from '../dav/fetch-safe.js';
import type { Connection } from '../db/connection.js';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { assertScopeRole } from '../services/scopes.js';
import { recordExecution, type ExecutionRow, type TaskAiExecution } from '../services/task-ai.js';
import {
  destinationOf,
  routineToken,
  settingsOfAi,
  subscriptionCredentials,
} from '../services/task-ai-settings.js';
import { dispatchMcpEvent } from '../services/task-ai-events.js';

const CLAIM_MS = 60_000;
const MCP_ATTEMPTS = 3;
const after = (now: string, ms: number) => new Date(Date.parse(now) + ms).toISOString();
const fireResponse = z.object({
  type: z.literal('routine_fire'),
  claude_code_session_id: z.string().regex(/^session_[a-zA-Z0-9_-]+$/u),
  claude_code_session_url: z.string(),
});

type Outcome = {
  status: TaskAiExecution['status'];
  session_url?: string | undefined;
  retry_at?: string | undefined;
};

function retryAt(header: string | null, now: string): string {
  if (header === null || header.trim() === '') return after(now, 60_000);
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return after(now, Math.max(1, Math.min(seconds, 86_400)) * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) && date > Date.parse(now)
    ? new Date(date).toISOString()
    : after(now, 60_000);
}

export async function fireClaudeRoutine(
  routineId: string,
  token: string,
  executionId: string,
  now: string,
): Promise<Outcome> {
  if (!/^trig_[a-zA-Z0-9]+$/u.test(routineId)) return { status: 'failed' };
  const response = await safeFetch(
    'https://api.anthropic.com/v1/claude_code/routines/' + routineId + '/fire',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-version': '2026-10-21',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: JSON.stringify({ execution_id: executionId }) }),
      allowHosts: ['api.anthropic.com'],
      maxRedirects: 0,
      maxBytes: 32_768,
      timeoutMs: 10_000,
    },
  );
  if (response.status === 429)
    return { status: 'failed', retry_at: retryAt(response.headers.get('retry-after'), now) };
  if (response.status !== 200) return { status: response.status >= 500 ? 'uncertain' : 'failed' };
  const result = fireResponse.safeParse(JSON.parse(response.body));
  if (!result.success) return { status: 'uncertain' };
  const url = new URL(result.data.claude_code_session_url);
  if (url.href !== 'https://claude.ai/code/' + result.data.claude_code_session_id)
    return { status: 'uncertain' };
  return { status: 'delivered', session_url: url.href };
}

const workerPrincipal = (row: ExecutionRow): Principal => ({
  kind: 'user',
  userId: row.user_id,
  source: 'system',
  label: 'Fem-ho',
  capabilities: new Set(),
  scopeIds: null,
});

type Transports = { event: typeof dispatchMcpEvent; claude: typeof fireClaudeRoutine };
const transports = { event: dispatchMcpEvent, claude: fireClaudeRoutine };

async function transition(
  connection: Connection,
  row: ExecutionRow,
  outcome: Outcome,
  now: string,
): Promise<ExecutionRow | undefined> {
  return auditedTransaction(
    connection.db,
    workerPrincipal(row),
    async (ctx) => {
      // L'auditoria actualitza la tasca i el retorn MCP també pren aquest pany primer.
      await sql`UPDATE tasks SET last_activity_at = last_activity_at WHERE id = ${row.task_id}`.execute(
        ctx.tx,
      );
      const claiming = outcome.status === 'sending';
      const result = await sql<ExecutionRow>`
      UPDATE task_ai_executions SET status = ${outcome.status},
        attempts = attempts + ${claiming ? 1 : 0},
        available_at = ${outcome.status === 'queued' ? after(now, 1_000 * 5 ** row.attempts) : now},
        claim_until = ${claiming ? after(now, CLAIM_MS) : null},
        session_url = ${outcome.session_url ?? null}, retry_at = ${outcome.retry_at ?? null}
      WHERE id = ${row.id} AND status = ${row.status} AND attempts = ${row.attempts}
      RETURNING *
    `.execute(ctx.tx);
      const updated = result.rows[0];
      if (updated === undefined) ctx.noChange();
      else recordExecution(ctx, updated, 'ai_execution_updated', row.status);
      return updated;
    },
    { engine: connection.engine, now },
  );
}

async function send(
  connection: Connection,
  row: ExecutionRow,
  secret: string,
  now: string,
  transport: Transports,
): Promise<Outcome> {
  const db = connection.db;
  const { rows } = await sql<{ id: string }>`
    SELECT id FROM tasks WHERE id = ${row.task_id} AND scope_id = ${row.scope_id} AND deleted_at IS NULL
  `.execute(db);
  if (rows.length === 0) return { status: 'cancelled' };
  try {
    await assertScopeRole(db, workerPrincipal(row), row.scope_id, 'content');
  } catch (error) {
    if (error instanceof PolicyError) return { status: 'cancelled' };
    throw error;
  }
  const settings = await settingsOfAi(db, row.user_id, row.scope_id);
  if (settings.revision !== row.settings_revision) return { status: 'cancelled' };
  const destination = await destinationOf(db, settings, now);
  if (destination === undefined || destination.conn.oauth_session_id !== row.oauth_session_id)
    return { status: 'cancelled' };

  const canRetry = row.method === 'mcp_events' && row.attempts < MCP_ATTEMPTS;
  try {
    if (destination.sub !== undefined) {
      const status = await transport.event({
        ...subscriptionCredentials(destination.sub, secret, now),
        id: row.id,
        scopeId: row.scope_id,
        taskId: row.task_id,
        createdAt: row.created_at,
      });
      if (status >= 200 && status < 300) return { status: 'delivered' };
      if (status === 429 || status >= 500) return { status: canRetry ? 'queued' : 'failed' };
      return { status: 'failed' };
    }
    return await transport.claude(
      settings.routine_id!,
      routineToken(settings, secret),
      row.id,
      now,
    );
  } catch {
    // No es registren errors crus: poden contenir la URL privada del receptor.
    return { status: canRetry ? 'queued' : 'uncertain' };
  }
}

export async function processTaskAiExecutions(
  connection: Connection,
  secret: string,
  now = new Date().toISOString(),
  transport: Transports = transports,
): Promise<void> {
  const { rows } = await sql<ExecutionRow>`
    SELECT * FROM task_ai_executions
    WHERE (status = 'queued' AND available_at <= ${now})
       OR (status = 'sending' AND claim_until <= ${now})
    ORDER BY available_at, id LIMIT 8
  `.execute(connection.db);
  const processed = await Promise.allSettled(
    rows.map(async (row) => {
      if (row.status === 'sending') {
        // Després d'un tall ja es podria haver creat una sessió de Claude. Amb MCP el
        // mateix identificador permet reintentar el webhook i desduplicar el resultat.
        await transition(
          connection,
          row,
          {
            status:
              row.method === 'mcp_events' && row.attempts < MCP_ATTEMPTS ? 'queued' : 'uncertain',
          },
          now,
        );
        return;
      }

      const claimed = await transition(connection, row, { status: 'sending' }, now);
      if (claimed === undefined) return;
      const outcome = await send(connection, claimed, secret, now, transport);
      await transition(connection, claimed, outcome, new Date().toISOString());
    }),
  );
  // Si un intent falla a la base, els altres poden seguir fent xarxa. El tancament
  // ha d'esperar tots els intents abans de tancar la connexió a la base de dades.
  const failed = processed.find((result) => result.status === 'rejected');
  if (failed !== undefined) throw failed.reason;
}

export function startTaskAiWorker(connection: Connection, secret: string, onError: () => void) {
  let current: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (current !== undefined) return;
    current = processTaskAiExecutions(connection, secret)
      .catch(onError)
      .finally(() => {
        current = undefined;
      });
  }, 1_000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await current;
  };
}
