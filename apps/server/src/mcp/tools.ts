/**
 * Les eines d'MCP (docs/08 §3).
 *
 * **Sense prefix, verb primer** (D6): els clients ja fan namespace pel seu compte —a
 * Claude una tool acaba sent `mcp__femho__list_tasks`— i posar-hi un `femho_` a sobre
 * malgasta tokens a cada nom, a cada crida i a cada finestra de context.
 *
 * Una definició de tool ocupa entre 100 i 500 tokens; amb catàlegs
 * de 40, una part gran de la finestra de context se'n va en metadades abans de començar. La
 * darrera que hi ha entrat, `ask_user`, és la que evita el pitjor error d'un agent que
 * treballa sol: endevinar en comptes de preguntar.
 *
 * **Cap tool d'esborrar.** Un agent no esborra res: com a molt marca i comenta.
 *
 * Les anotacions no són decoració: són el que permet que un client aprovi sol les de
 * lectura i sempre demani confirmació per a la resta.
 */

import { z } from 'zod';
import { taskCreateShape, taskMoveMcpShape, taskPatchShape } from '../services/task-delivery.js';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint?: boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  annotations: ToolAnnotations;
}

/** Les de lectura: aprovables soles pel client. */
const READ: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
/** Les que creen: no destructives, però **no** idempotents. */
const CREATE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};
/** Les que modifiquen: repetir-les dona el mateix resultat. */
const MODIFY: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

const scopeId = z.string().describe('Scope identifier. A bare UUID, no prefix.');
const taskId = z.string().describe('Task identifier. A bare UUID, no prefix.');
const origin = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((label) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(label), 'Use a single-line label.')
  .optional()
  .describe('Where this action came from, e.g. WhatsApp or Email. Use a short label.');

/**
 * El catàleg, **ordenat alfabèticament**.
 *
 * Els clients cacheguen la llista de tools, i un ordre estable millora els encerts de la
 * memòria cau de prompts. No és una manida: reordenar-la invalida la memòria cau de tots
 * els clients connectats.
 */
export const TOOLS: ToolSpec[] = [
  {
    name: 'add_comment',
    title: 'Comment on a task',
    description:
      'Adds a comment to a task. **This is the main way for an agent to report** what it has done or what it is missing in order to continue.',
    inputSchema: { task_id: taskId, body: z.string().describe('The comment text.'), origin },
    annotations: CREATE,
  },
  {
    name: 'add_task_attachment',
    title: 'Attach a file to a task',
    description:
      'Adds one file to an existing task. Supply Base64 bytes or a public HTTPS download URL. Reuse the same attachment UUID when retrying.',
    inputSchema: {
      task_id: taskId,
      id: z.uuid().describe('Client-generated attachment UUID. Keep it for retries.'),
      filename: z.string().min(1),
      content_base64: z.string().optional().describe('Standard Base64, up to 1 MiB decoded.'),
      url: z.string().optional().describe('Public HTTPS download URL for the file.'),
      ai_context: z.boolean().optional(),
      origin,
    },
    annotations: { ...MODIFY, openWorldHint: true },
  },
  {
    name: 'ask_user',
    title: 'Ask the person and wait',
    description:
      "Asks a question and **stops on this task until someone answers**. Use it instead of guessing: the question shows up in the task and the person sees a mark without having to open it. The mark goes away when a person replies — there is no 'seen' button.",
    inputSchema: {
      task_id: taskId,
      question: z.string().describe('What you need in order to carry on. One concrete question.'),
      origin,
    },
    annotations: CREATE,
  },
  {
    name: 'complete_task',
    title: 'Complete a task',
    description:
      'Marks a task as done. Applies the upward cascade and generates the next instance if it repeats.',
    inputSchema: { task_id: taskId, origin },
    annotations: MODIFY,
  },
  {
    name: 'create_task',
    title: 'Create a task',
    description:
      'Creates a task in Inbox, To do, Doing or Done with its initial data. Use get_task_context to find identifiers. Pass a client-generated id for safe retries. Attach files separately with add_task_attachment.',
    inputSchema: { ...taskCreateShape, origin },
    annotations: CREATE,
  },
  {
    name: 'get_briefing',
    title: 'Briefing for agents',
    description:
      'Scopes with their instructions, projects, what is pending and what is delegated, plus `taken_over`: the tasks a person has taken off you in the last day. **Saves six calls**: it is the second one an agent should call, after `whoami`.',
    inputSchema: { scope_id: z.string().optional() },
    annotations: READ,
  },
  {
    name: 'get_task',
    title: 'A whole task',
    description: 'Reads the task record by its identifier.',
    inputSchema: { task_id: taskId },
    annotations: READ,
  },
  {
    name: 'get_task_context',
    title: 'Find identifiers for task operations',
    description:
      'Lists authorized scopes. With scope_id, also lists projects, task types, labels and eligible assignees in that scope. Use the profile timezone for date-based task inputs.',
    inputSchema: { scope_id: scopeId.optional() },
    annotations: READ,
  },
  {
    name: 'list_events',
    title: 'Events in a window',
    description:
      'Events between two dates. **`from` and `to` are required**: without a window, a calendar with recurrences does not have a finite number of events.',
    inputSchema: {
      from: z.string().describe('Start of the window, ISO.'),
      to: z.string().describe('End of the window, ISO.'),
      scope_id: z.string().optional(),
    },
    annotations: READ,
  },
  {
    name: 'list_projects',
    title: 'Projects',
    description: 'Projects, filterable by scope.',
    inputSchema: { scope_id: z.string().optional() },
    annotations: READ,
  },
  {
    name: 'list_scopes',
    title: 'Scopes',
    description: 'Accessible scopes, with the description and AI instructions of each one.',
    inputSchema: {},
    annotations: READ,
  },
  {
    name: 'list_tasks',
    title: 'Tasks',
    description: 'Tasks with filters and pagination.',
    inputSchema: {
      scope_id: z.string().optional(),
      project_id: z.string().optional(),
      status: z.enum(['inbox', 'todo', 'doing', 'done']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    },
    annotations: READ,
  },
  {
    name: 'move_task',
    title: 'Move a task',
    description:
      'Moves a task inside its scope. Defaults to the end of the destination column. Pass expected_version to detect concurrent changes.',
    inputSchema: {
      task_id: taskId,
      ...taskMoveMcpShape,
      origin,
    },
    annotations: { ...MODIFY, idempotentHint: false },
  },
  {
    name: 'next_task',
    title: 'The next delegated task',
    description:
      'Returns the next available delegated task **and claims it** for 30 minutes. This is what stops two agents doing the same work. Call `release_task` if you cannot do it.',
    inputSchema: { scope_id: z.string().optional(), origin },
    // **No idempotent**: cada crida reserva una tasca diferent.
    annotations: CREATE,
  },
  {
    name: 'release_task',
    title: 'Release a claim',
    description: 'Releases the claim on a task, with a reason that stays in the history.',
    inputSchema: { task_id: taskId, reason: z.string().describe('Why you cannot do it.'), origin },
    annotations: MODIFY,
  },
  {
    name: 'resume_task',
    title: 'Carry on after learning something elsewhere',
    description:
      'Records what you learned outside Fem-ho —a chat, a call, a file you were given— and **clears the waiting mark**, then claims the task again. Say what you learned: the record is what clears the mark, not wanting it gone. Use it when the answer to your `ask_user` reached you by another channel.',
    inputSchema: {
      task_id: taskId,
      learned: z
        .string()
        .describe('What you now know that you did not know when you asked. In one paragraph.'),
      origin,
    },
    annotations: CREATE,
  },
  {
    name: 'search_tasks',
    title: 'Search tasks',
    description: 'Text search over titles and descriptions.',
    inputSchema: { query: z.string(), scope_id: z.string().optional() },
    annotations: READ,
  },
  {
    name: 'update_checklist_item',
    title: 'Check an item of a checklist',
    description:
      'Checks or unchecks an item. If it is the last one missing, the upward cascade can complete the subtask and the task.',
    inputSchema: { item_id: z.string(), done: z.boolean(), origin },
    annotations: MODIFY,
  },
  {
    name: 'update_task',
    title: 'Modify a task',
    description: 'Changes fields of a task. Only the ones given.',
    inputSchema: {
      task_id: taskId,
      ...taskPatchShape,
      origin,
    },
    annotations: MODIFY,
  },
  {
    name: 'whoami',
    title: 'Who am I',
    description:
      'Who this token is, what it can do and **which scopes it sees**. The first one an agent should call: without it, it does not know where it can write and ends up guessing.',
    inputSchema: {},
    annotations: READ,
  },
];

/** Comprovació d'invariants del catàleg. Es crida en construir el servidor. */
export function assertCatalogue(tools: ToolSpec[] = TOOLS): void {
  if (tools.length !== 20) {
    throw new Error(
      `El catàleg ha de tenir 20 tools i en té ${String(tools.length)} (docs/08 §3).`,
    );
  }

  const names = tools.map((tool) => tool.name);
  if (names.some((name) => name.startsWith('femho_'))) {
    throw new Error('Cap tool porta prefix: els clients ja fan namespace (D6).');
  }
  if (names.some((name) => /delete|remove|destroy|esborr/iu.test(name))) {
    throw new Error("Fem-ho no exposa cap tool d'esborrar (docs/08 §3).");
  }
  if ([...names].sort().join() !== names.join()) {
    throw new Error("El catàleg ha d'anar alfabètic: els clients cacheguen la llista.");
  }
}
