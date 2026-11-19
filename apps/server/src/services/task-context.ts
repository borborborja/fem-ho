import { sql } from 'kysely';
import { isTrue } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import { TASK_OPERATIONS } from '../policy/capabilities.js';
import { missingCapability, notFound } from '../policy/errors.js';
import { canSeeScope, hasCapability, type Principal } from '../policy/principal.js';
import { roleCan } from '../policy/scope-roles.js';
import { roleOf, visibleScopesPredicate } from '../policy/scope-visibility.js';

export function hasTaskContext(principal: Principal): boolean {
  return (
    TASK_OPERATIONS.some((operation) => hasCapability(principal, operation)) ||
    hasCapability(principal, 'attachments:write')
  );
}

type NamedId = { id: string; name: string };

/** Metadades per preparar una operació, també quan la credencial només pot escriure. */
export async function getTaskContext(db: MigrationDb, principal: Principal, scopeId?: string) {
  if (!hasTaskContext(principal)) throw missingCapability('tasks:read');

  const scopeRows = await sql<
    NamedId & {
      task_types_enabled: unknown;
      task_type_required: unknown;
      owner_id: string;
      kind: string;
    }
  >`
    SELECT s.id, s.name, s.owner_id, s.kind, ss.task_types_enabled, ss.task_type_required
    FROM scopes s LEFT JOIN scope_settings ss ON ss.scope_id = s.id
    WHERE s.deleted_at IS NULL AND ${visibleScopesPredicate(principal.userId)}
      ${scopeId === undefined ? sql`` : sql`AND s.id = ${scopeId}`}
    ORDER BY s.position, s.id
  `.execute(db);
  const visible = scopeRows.rows.filter((scope) => canSeeScope(principal, scope.id));
  const selected = scopeId === undefined ? undefined : visible[0];
  if (scopeId !== undefined && selected === undefined) throw notFound('scope', scopeId);

  const timezone = await sql<{ timezone: string }>`
    SELECT timezone FROM users WHERE id = ${principal.userId}
  `.execute(db);
  const scopes = await Promise.all(
    visible.map(async (scope) => {
      const role = await roleOf(db, principal.userId, scope.id);
      return {
        id: scope.id,
        name: scope.name,
        writable: role !== null && roleCan(role, 'content'),
        task_type_required: isTrue(scope.task_types_enabled) && isTrue(scope.task_type_required),
      };
    }),
  );
  const result = { timezone: timezone.rows[0]?.timezone ?? 'UTC', scopes };
  if (selected === undefined) return result;

  const [projects, taskTypes, labels, assignees] = await Promise.all([
    sql<NamedId>`SELECT id, name FROM projects WHERE scope_id = ${selected.id}
      AND deleted_at IS NULL AND archived_at IS NULL ORDER BY position, id`.execute(db),
    sql<NamedId>`SELECT id, name FROM task_types WHERE scope_id = ${selected.id}
      AND deleted_at IS NULL ORDER BY position, id`.execute(db),
    sql<NamedId>`SELECT id, name FROM labels WHERE scope_id = ${selected.id}
      AND deleted_at IS NULL ORDER BY name, id`.execute(db),
    sql<NamedId>`SELECT u.id, u.name FROM users u WHERE u.deleted_at IS NULL
      AND (u.id = ${selected.owner_id} OR (${selected.kind} = 'collective'
        AND EXISTS (SELECT 1 FROM scopes s WHERE s.id = ${selected.id}
          AND ${visibleScopesPredicate(sql<string>`u.id`)}))) ORDER BY u.name, u.id`.execute(db),
  ]);

  return {
    ...result,
    details: {
      scope_id: selected.id,
      projects: projects.rows,
      task_types: taskTypes.rows,
      labels: labels.rows,
      assignees: assignees.rows,
    },
  };
}
