/**
 * Registre obert.
 *
 * Fins avui `FEMHO_REGISTRATION` era **una opció declarada que no feia res**: existia a
 * la configuració, es publicava a `/info` i a la pantalla d'administració, i no hi havia
 * cap ruta de registre enlloc. Qui la posés a `open` es quedava amb una instància que deia
 * que estava oberta i no ho estava. Ara hi ha la ruta i la porta la governa de debò.
 *
 * TRES COSES QUE ES DECIDEIXEN AQUÍ
 * ---------------------------------
 * **1 · Registrar-se amb la base buida ÉS el primer arrencament, no una cosa al costat.**
 *
 * Es va demanar que "el primer usuari que es registri serà admin", i això ja existeix:
 * `createFirstAdmin` fa exactament això i, a més, li deixa els tres àmbits inicials en el
 * seu idioma. Escriure aquí un segon camí que creï un administrador voldria dir dues
 * definicions de "primer usuari" que un dia divergeixen —i la que es quedés enrere seria
 * la que decideix qui mana. Per això el registre **delega** en aquella quan la instància
 * encara és nova, i només fa camí propi a partir del segon.
 *
 * **2 · El segon i els següents són `member`.**
 *
 * Sense això, obrir el registre seria regalar la instància a qui passés per allà.
 *
 * **3 · Es respon igual tant si el correu ja hi és com si no.**
 *
 * Un registre que digui "aquest correu ja existeix" és un formulari per esbrinar qui té
 * compte en aquesta casa, i el login ja s'aguanta de no dir-ho (`docs/02` §2). Qui repeteix
 * correu rep la mateixa resposta que qui se'l registra bé, i li arriba —o no— el que hagi
 * de rebre per un altre canal. La contrapartida és que un dit errat no sap per què no pot
 * entrar; és el mateix preu que ja paga el login, i es paga a posta.
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import { hashPassword, WeakPasswordError } from '../auth/password.js';
import { FALLBACK, catalogOf, isLocale, type Locale } from '@fem-ho/contracts';
import { PolicyError } from '../policy/errors.js';
import { createFirstAdmin, setupIsOpen } from './setup.js';
import { v7 as uuidv7 } from 'uuid';
import { generatePosition } from '@fem-ho/contracts';

export interface RegisterInput {
  email: string;
  /**
   * El nom amb què es veu la persona.
   *
   * És el mateix camp que demana el primer arrencament i el mateix que porta `users.name`.
   * **No s'afegeix un `username` a part**: seria una segona identitat amb què iniciar
   * sessió, i llavors caldria decidir si és única, si es pot canviar, i què passa quan
   * xoca amb el correu d'algú altre. El que es volia —"nom d'usuari"— ja el tenim.
   */
  name: string;
  password: string;
  /** L'idioma del navegador: l'únic moment en què "automàtic" és inequívoc. */
  locale?: string | undefined;
}

export interface RegisterResult {
  userId: string;
  /** Cert si aquesta persona és la primera de la instància i, per tant, administradora. */
  isFirst: boolean;
}

/**
 * Una contrasenya fluixa ha de sortir com a 422, no com a 500.
 *
 * `hashPassword` llança `WeakPasswordError`, que **no és un error de política** i per tant
 * puja fins a dalt i es converteix en un error intern: la persona veia "alguna cosa ha
 * anat malament" en comptes de "la contrasenya és massa curta". A `/setup` ja s'hi
 * traduïa a mà, amb un cos que no és `problem+json` com la resta de l'API; aquí es fa una
 * vegada i amb la forma bona.
 */
async function asPolicy<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof WeakPasswordError) {
      throw new PolicyError('weak-password', 'Password too short', 422, error.message);
    }
    throw error;
  }
}

/** Els àmbits que es deixen a qui arriba després del primer. */
const FIRST_SCOPE_KEY = 'setup.scope.personal';

export async function registerUser(
  ctx: AuditContext,
  input: RegisterInput,
  allowed: boolean,
): Promise<RegisterResult> {
  /**
   * **La porta es mira aquí, a la capa de servei** (regla 8), i no a la ruta.
   *
   * El dia que el registre es pugui fer també des del MCP o des d'un lot, la comprovació
   * ja hi serà. Una comprovació que viu al handler és una comprovació que només val per a
   * la porta on està escrita.
   */
  if (!allowed) {
    throw new PolicyError(
      'registration-closed',
      'Registration closed',
      403,
      'This instance does not accept new accounts. Ask whoever runs it for an invitation.',
    );
  }

  const email = input.email.trim().toLowerCase();
  if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    throw new PolicyError(
      'invalid-email',
      'Invalid email',
      422,
      'That does not look like an email address.',
    );
  }
  if (input.name.trim() === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'Falta el nom.');
  }

  /**
   * Amb la instància encara nova, això **és** el primer arrencament.
   *
   * `createFirstAdmin` ja fa la persona administradora i li deixa els tres àmbits en el
   * seu idioma; duplicar-ho aquí seria tenir dues definicions de "primer usuari".
   */
  if (await setupIsOpen(ctx.tx)) {
    const created = await asPolicy(() => createFirstAdmin(ctx, input));
    return { userId: created.userId, isFirst: true };
  }

  // La contrasenya la valida `hashPassword`, que és qui coneix el mínim: duplicar-lo aquí
  // voldria dir que un dia divergirien.
  const passwordHash = await asPolicy(() => hashPassword(input.password));

  /**
   * El correu repetit **no es delata**.
   *
   * Es fa la feina d'argon2id igualment abans de mirar-ho, perquè si es comprovés primer,
   * un registre amb un correu que ja hi és tornaria de seguida i un de nou trigaria el
   * que triga xifrar: la diferència de temps diria exactament el que el missatge calla.
   */
  const existing = await sql<{ id: string }>`
    SELECT id FROM users WHERE email = ${email} AND deleted_at IS NULL
  `.execute(ctx.tx);
  if (existing.rows[0] !== undefined) {
    ctx.noChange();
    return { userId: existing.rows[0].id, isFirst: false };
  }

  const locale: Locale = isLocale(input.locale) ? input.locale : FALLBACK;
  const userId = uuidv7();
  await sql`
    INSERT INTO users (id, email, name, password_hash, kind, role, locale,
                       created_at, updated_at)
    VALUES (${userId}, ${email}, ${input.name.trim()}, ${passwordHash}, 'human', 'member',
            ${locale}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'user',
    entityId: userId,
    scopeId: null,
    verb: 'created',
    changes: { email: { from: null, to: email }, role: { from: null, to: 'member' } },
  });

  /**
   * Un àmbit propi per començar.
   *
   * Qui s'acaba de registrar no és membre de res: sense un àmbit seu, la primera pantalla
   * és un tauler buit on l'afegida ràpida no té on posar la tasca. Se'n deixa **un**, i no
   * els tres del primer arrencament: aquells són el punt de partida d'una instància, i
   * aquest és el punt de partida d'una persona.
   */
  const name = catalogOf(locale)[FIRST_SCOPE_KEY] ?? 'Personal';
  const scopeId = uuidv7();
  await sql`
    INSERT INTO scopes (id, name, kind, color, owner_id, position, created_at, updated_at)
    VALUES (${scopeId}, ${name}, 'individual', '--plou-blue', ${userId},
            ${generatePosition(null, null)}, ${ctx.now}, ${ctx.now})
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'scope',
    entityId: scopeId,
    scopeId,
    verb: 'created',
    changes: { name: { from: null, to: name } },
  });

  return { userId, isFirst: false };
}
