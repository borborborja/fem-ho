import type { Principal } from './principal.js';
import { missingCapability, PolicyError } from './errors.js';
import type { Capability } from './capabilities.js';

/** Les integracions entren només a recursos amb comprovació d'àmbit al servei.
 * Una ruta nova no hereta accés extern sense que se n'hagi revisat la política. */
export function assertExternalRequest(principal: Principal, method: string, path: string): void {
  if (principal.credentialType !== 'pat' && principal.credentialType !== 'oauth') return;
  if (path === '/mcp') return;
  const read = method === 'GET' || method === 'HEAD';
  let resource: string | undefined;
  const relative = path.replace(/^\/api\/v1\//, '');
  if (relative === 'auth/me' && read) return;
  // El lot comprova cada operació al seu servei: conserva les denegacions individuals.
  if (relative === 'sync/batch' && method === 'POST') return;
  if (relative === 'ai/next-task' && principal.kind === 'agent') {
    if (!principal.capabilities.has('tasks:write')) throw missingCapability('tasks:write');
    if (!principal.capabilities.has('tasks:read')) throw missingCapability('tasks:read');
    return;
  }
  if (relative === 'ai/skill' && read) return;
  if (relative === 'sync' && read) resource = 'tasks';
  else if (
    /^ai\/tasks\/[^/]+\/(claim|release|ask-user|resume|lease)$/.test(relative) &&
    principal.kind === 'agent'
  )
    resource = 'tasks';
  else if (/^(tasks)(\/|$)/.test(relative)) {
    resource = 'tasks';
    if (/\/(comments)(\/|$)/.test(relative)) resource = 'comments';
    if (/\/(checklists|checklist-items)(\/|$)/.test(relative)) resource = 'checklists';
    if (/\/(attachments)(\/|$)/.test(relative)) resource = 'attachments';
    if (/\/(shares|share|delegate|ai-mode|take-over)(\/|$)/.test(relative)) resource = undefined;
  } else if (/^(projects|events|checklists|attachments)(\/|$)/.test(relative))
    resource = relative.split('/')[0];
  else if (/^checklist-items(\/|$)/.test(relative)) resource = 'checklists';
  else if (
    /^scopes(\/|$)/.test(relative) &&
    read &&
    !/\/(members|settings|invites|calendars)/.test(relative)
  )
    resource = 'scopes';
  else if (['board', 'inbox'].includes(relative) && read) resource = 'tasks';
  if (resource === undefined)
    throw new PolicyError(
      'session-required',
      'Session required',
      403,
      'This endpoint is not available to external credentials.',
    );
  const action = read ? 'read' : method === 'DELETE' ? 'delete' : 'write';
  // Adjunts i checklists expressen l'eliminació amb :write al contracte existent.
  const capability =
    `${resource}:${action === 'delete' && ['attachments', 'checklists'].includes(resource) ? 'write' : action}` as Capability;
  if (!principal.capabilities.has(capability)) throw missingCapability(capability);
}
