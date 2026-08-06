/**
 * Primer arrencament (docs/12 §7).
 *
 * Amb la base buida, el servidor crea l'esquema, genera els secrets i **espera**.
 * `/setup` mostra el formulari per crear el primer administrador, i **un cop creat la
 * ruta es tanca per sempre**.
 *
 * "Per sempre" vol dir que no es reobre ni esborrant l'usuari: la condició és que no hi
 * hagi **cap** usuari humà, i un cop n'hi ha hagut un, el rastre queda a `activity_log`
 * encara que la fila s'esborri. Si es reobrís, qualsevol que arribés abans que
 * l'administrador tornés a entrar es faria administrador ell.
 */

import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { generatePosition } from '@fem-ho/contracts';
import type { AuditContext } from '../audit/audited-transaction.js';
import { hashPassword } from '../auth/password.js';
import type { MigrationDb } from '../db/migration-db.js';
import { FALLBACK, isLocale } from '@fem-ho/contracts';
import { PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';

/**
 * Els tres àmbits inicials, amb els colors de la tríada de Plou.
 *
 * **No són especials** (docs/12 §7): es poden reanomenar i esborrar com qualsevol. Són
 * un punt de partida, no una estructura del producte.
 */
export const INITIAL_SCOPES = [
  { name: 'Personal', color: '--plou-blue' },
  { name: 'Feina', color: '--plou-orange' },
  { name: 'Família', color: '--plou-pink' },
] as const;

/**
 * Encara es pot fer el primer arrencament?
 *
 * La pregunta no és "hi ha usuaris ara" sinó "n'hi ha hagut mai". Amb la primera, un
 * administrador que s'esborrés el compte reobriria la porta a qui passés per allà.
 */
export async function setupIsOpen(db: MigrationDb): Promise<boolean> {
  const users = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM users WHERE kind = 'human'
  `.execute(db);
  if (Number(users.rows[0]?.n ?? 0) > 0) return false;

  // El rastre: si algun dia hi va haver un administrador, la instància ja no és nova.
  const history = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM activity_log WHERE verb = 'created' AND entity_type = 'user'
  `.execute(db);
  return Number(history.rows[0]?.n ?? 0) === 0;
}

export interface SetupInput {
  email: string;
  name: string;
  password: string;
  /**
   * L'idioma de qui crea el compte.
   *
   * El navegador el sap i la persona encara no ha pogut triar res: és **l'únic moment
   * en què "automàtic" és inequívoc**. Un cop hi ha perfil, `users.locale` ja porta una
   * tria deliberada i endevinar-la seria sobreescriure-la.
   */
  locale?: string | undefined;
}

export interface SetupResult {
  userId: string;
  scopeIds: string[];
}

/**
 * Crea el primer administrador i els seus tres àmbits.
 *
 * **Comprova que estigui obert dins de la mateixa transacció** que crea l'usuari: entre
 * una comprovació de fora i la creació hi cabria una segona petició, i acabarien
 * existint dos administradors creats per dos desconeguts.
 */
export async function createFirstAdmin(ctx: AuditContext, input: SetupInput): Promise<SetupResult> {
  if (!(await setupIsOpen(ctx.tx))) {
    throw new PolicyError(
      'setup-closed',
      'Setup closed',
      403,
      'This instance already has an administrator. If you have lost access, you have to go into the database.',
    );
  }

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    throw new PolicyError('invalid-email', 'Invalid email', 422, 'That does not look like an email address.');
  }
  if (input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'Falta el nom.');
  }

  // La contrasenya la valida `hashPassword`, que és qui coneix el mínim: duplicar-lo
  // aquí voldria dir que un dia divergirien.
  const passwordHash = await hashPassword(input.password);

  const userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, locale,
                       created_at, updated_at)
    VALUES (${userId}, ${email}, ${input.name.trim()}, ${passwordHash}, 'human', 'admin',
            ${isLocale(input.locale) ? input.locale : FALLBACK}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'user',
    entityId: userId,
    scopeId: null,
    verb: 'created',
    changes: { email: { from: null, to: email }, role: { from: null, to: 'admin' } },
  });

  const scopeIds: string[] = [];
  let previous: string | null = null;

  for (const scope of INITIAL_SCOPES) {
    const id = uuidv7();
    const position = generatePosition(previous, null);
    previous = position;

    await sql`
      INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
      VALUES (${id}, ${scope.name}, 'individual', ${scope.color}, ${userId}, ${position},
              ${ctx.now}, ${ctx.now})
    `.execute(ctx.tx);

    ctx.record({
      entityType: 'scope',
      entityId: id,
      scopeId: id,
      verb: 'created',
      changes: { name: { from: null, to: scope.name } },
    });

    scopeIds.push(id);
  }

  return { userId, scopeIds };
}

/** El principal amb què s'executa el primer arrencament: encara no hi ha ningú. */
export function setupPrincipal(): Principal {
  return {
    kind: 'user',
    userId: '',
    capabilities: new Set(),
    scopeIds: new Set(),
    source: 'system',
  };
}
