import { TASK_STATUSES } from '@fem-ho/contracts';
import { z } from 'zod';
import type { AuditContext } from '../audit/audited-transaction.js';
import { PolicyError } from '../policy/errors.js';
import { hasCapability, type Principal } from '../policy/principal.js';
import { insertChecklist, insertChecklistItem } from './checklists.js';
import { insertTaskComment } from './comments.js';
import { setTaskLabelInScope } from './labels.js';
import { insertSubtask } from './subtasks.js';
import { createTask, moveTask, refreshTaskReferences, updateTask, type Task } from './tasks.js';

const id = z.string().min(1);
const text = z.string().min(1);
const status = z.enum(TASK_STATUSES).describe('inbox, todo, doing or done.');
const aiMode = z.enum(['manual', 'assisted', 'delegated']);
const recurrenceMode = z.enum(['schedule', 'completion']);
const checklist = z.object({
  name: text,
  show_completed_inline: z.boolean().optional(),
  items: z.array(z.object({ text, done: z.boolean().optional() })).optional(),
});
const taskReferences = {
  assignee_ids: z.array(id).optional(),
  label_ids: z.array(id).optional(),
};

export const taskCreateShape = {
  id: id.optional().describe('Reuse the same client task ID to retry without duplicating it.'),
  scope_id: id.describe('An authorized scope identifier.'),
  title: text,
  project_id: id.nullish(),
  description: z.string().optional(),
  status: status.optional().describe('Defaults to inbox.'),
  position: text.optional(),
  due_date: z.string().optional().describe('Due day in YYYY-MM-DD.'),
  due_time: z.string().optional().describe('Local due time.'),
  deadline: z.string().optional().describe('ISO 8601 deadline with a time zone.'),
  completed_at: z.string().optional().describe('For done: a profile date or RFC 3339 instant.'),
  rrule: z.string().optional().describe('RFC 5545 recurrence rule.'),
  recurrence_mode: recurrenceMode.optional(),
  ai_mode: aiMode.optional(),
  ai_instructions: z.string().optional(),
  task_type_id: id.optional(),
  source_event: z
    .object({ calendar_id: id, uid: text, recurrence_id: text.nullable().optional() })
    .optional(),
  ...taskReferences,
  subtasks: z
    .array(
      z.object({
        title: text,
        done: z.boolean().optional(),
        checklists: z.array(checklist).optional(),
      }),
    )
    .optional(),
  checklists: z.array(checklist).optional(),
  comments: z.array(z.object({ body: text })).optional(),
};

const placement = {
  position: text.optional().describe('A fractional index; otherwise provide neighbours or append.'),
  before_id: id.nullable().optional().describe('The preceding task in the destination column.'),
  after_id: id.nullable().optional().describe('The following task in the destination column.'),
  expected_version: z.number().int().min(1).optional(),
};

export const taskMoveMcpShape = { status, ...placement };

export const taskMoveShape = {
  status: status.optional(),
  ...placement,
  time_entry: z.object({ id, minutes: z.number(), ended_at: z.string() }).optional(),
};

export const taskPatchShape = {
  title: text.optional(),
  description: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  due_time: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
  project_id: id.nullable().optional(),
  task_type_id: z.string().nullable().optional(),
  rrule: z.string().nullable().optional(),
  recurrence_mode: recurrenceMode.optional(),
  ai_mode: aiMode.optional(),
  ai_instructions: z.string().nullable().optional(),
  ...taskReferences,
};

// REST conserva els errors específics de títol i àmbit del servei, també de clients antics.
const creation = z.object({
  ...taskCreateShape,
  scope_id: z.string().optional(),
  title: z.string().optional(),
});
const movement = z.object(taskMoveShape);
const revision = z.object(taskPatchShape);

function parseTaskInput<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new PolicyError(
      'invalid-task-input',
      'Invalid task input',
      422,
      `Check the type and value of ${fields.filter(Boolean).join(', ') || 'the task input'}.`,
    );
  }
  return result.data;
}

export function taskMutationReceipt(principal: Principal, task: Task) {
  if (hasCapability(principal, 'tasks:read') || principal.capabilities.has('tasks:write'))
    return task;
  const { id, scope_id, status, position, version, completed_at } = task;
  return { id, scope_id, status, position, version, completed_at };
}

export async function createDeliveredTask(
  ctx: AuditContext,
  principal: Principal,
  raw: unknown,
  engine: 'sqlite' | 'postgres',
): Promise<{ task: Task; created: boolean }> {
  const { label_ids, checklists, subtasks, comments, ...input } = parseTaskInput(creation, raw);
  const result = await createTask(ctx, principal, input, engine);
  if (!result.created) return result;

  // Només els fills d'aquesta tasca acabada de crear viatgen amb el permís de creació.
  const { id: taskId, scope_id: scopeId } = result.task;
  const addList = async (draft: z.infer<typeof checklist>, subtaskId?: string) => {
    const { items, ...fields } = draft;
    const list = await insertChecklist(ctx, principal, taskId, scopeId, {
      ...fields,
      subtask_id: subtaskId,
    });
    for (const item of items ?? [])
      await insertChecklistItem(ctx, principal, list.id, { scopeId, taskId }, item);
  };
  for (const labelId of new Set(label_ids))
    await setTaskLabelInScope(ctx, taskId, scopeId, labelId, true);
  for (const list of checklists ?? []) await addList(list);
  for (const { checklists: lists, ...draft } of subtasks ?? []) {
    const subtask = await insertSubtask(ctx, taskId, scopeId, draft);
    for (const list of lists ?? []) await addList(list, subtask.id);
  }
  for (const comment of comments ?? [])
    await insertTaskComment(ctx, principal, taskId, scopeId, comment.body);

  if (!label_ids?.length && !checklists?.length && !subtasks?.length && !comments?.length)
    return result;
  return { ...result, task: await refreshTaskReferences(ctx.tx, result.task) };
}

export function moveDeliveredTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  raw: unknown,
) {
  return moveTask(ctx, principal, id, parseTaskInput(movement, raw));
}

export function updateDeliveredTask(
  ctx: AuditContext,
  principal: Principal,
  id: string,
  raw: unknown,
) {
  return updateTask(ctx, principal, id, parseTaskInput(revision, raw));
}
