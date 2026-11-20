import { catalogOf, type Locale } from '@fem-ho/contracts';
import type { MigrationDb } from '../db/migration-db.js';
import type { Principal } from '../policy/principal.js';
import { assertScopeAccess, getProject } from './scopes.js';
import { listSubtasks } from './subtasks.js';
import { listChecklists } from './checklists.js';
import { listComments } from './comments.js';
import { listAttachments } from './attachments.js';
import { getTask } from './tasks.js';

const checklistItem = (text: string, done: boolean) => '- [' + (done ? 'x' : ' ') + '] ' + text;
const quote = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => '> ' + line)
    .join('\n');

export async function executionContextOf(
  db: MigrationDb,
  principal: Principal,
  taskId: string,
  locale: Locale,
) {
  const task = await getTask(db, principal, taskId);
  const [scope, project, subtasks, checklists, comments, files] = await Promise.all([
    assertScopeAccess(db, principal, task.scope_id),
    task.project_id === null ? null : getProject(db, principal, task.project_id),
    listSubtasks(db, principal, taskId),
    listChecklists(db, principal, taskId),
    listComments(db, principal, taskId),
    listAttachments(db, principal, { taskId }),
  ]);
  const attachments = files
    .filter((file) => file.is_ai_context)
    .map((file) => ({
      id: file.id,
      filename: file.filename,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
    }));
  const messages = catalogOf(locale);
  const lines = ['# ' + task.title, '', 'Fem-ho · ' + task.id];
  const add = (label: string, value: string | null | undefined) => {
    if (value) lines.push('', '## ' + label, value);
  };

  add(
    messages['ai.tasks.context.scope']!,
    [scope.name, scope.ai_description, scope.ai_instructions].filter(Boolean).join('\n\n'),
  );
  if (project !== null) {
    add(
      messages['ai.tasks.context.project']!,
      [project.name, project.ai_description, project.ai_instructions].filter(Boolean).join('\n\n'),
    );
  }
  add(messages['ai.tasks.context.due']!, [task.due_date, task.due_time].filter(Boolean).join(' '));
  add(messages['ai.tasks.context.deadline']!, task.deadline);
  add(messages['ai.tasks.context.instructions']!, task.ai_instructions);
  add(
    messages[
      task.source_kind === 'mail' ? 'ai.tasks.context.mail' : 'ai.tasks.context.description'
    ]!,
    task.source_kind === 'mail' && task.description !== null
      ? quote(task.description)
      : task.description,
  );
  add(
    messages['ai.tasks.context.subtasks']!,
    subtasks.map((item) => checklistItem(item.title, item.done)).join('\n'),
  );
  add(
    messages['ai.tasks.context.checklists']!,
    checklists
      .map((list) =>
        ['### ' + list.name, ...list.items.map((item) => checklistItem(item.text, item.done))].join(
          '\n',
        ),
      )
      .join('\n\n'),
  );
  add(
    messages['ai.tasks.context.comments']!,
    comments.map((comment) => comment.created_at + '\n' + quote(comment.body)).join('\n\n'),
  );
  add(
    messages['ai.tasks.context.attachments']!,
    attachments
      .map((file) => '- ' + file.filename + ' (' + file.mime_type + ', ' + file.id + ')')
      .join('\n'),
  );
  return { text: lines.join('\n'), attachments };
}
