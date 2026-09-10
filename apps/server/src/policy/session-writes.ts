import { hasCapability, type Principal } from './principal.js';
import { roleCan, type ScopeRole } from './scope-roles.js';
/** El mateix criteri decideix què es pot arrossegar i què accepta el servei. */
export function canEditSession(
  principal: Principal,
  role: ScopeRole | null,
  userId: string,
): boolean {
  return (
    hasCapability(principal, 'tasks:write') &&
    role !== null &&
    roleCan(role, 'content') &&
    (userId === principal.userId || roleCan(role, 'reports'))
  );
}

/** El temps aliè té la mateixa visibilitat al registre i a les targetes. */
export function canReadOthersSessions(role: ScopeRole | null): boolean {
  return role !== null && roleCan(role, 'reports');
}
