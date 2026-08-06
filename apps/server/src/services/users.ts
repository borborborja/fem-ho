/**
 * El perfil i les preferències de qui pregunta. docs/02 §9, docs/05 §4.
 *
 * **Aquí es toca només el compte propi.** El brief és explícit (línia 42): al Perfil no
 * s'editen els altres. Els altres usuaris es gestionen des d'Admin, que és una altra
 * capacitat (`users:manage`) i un altre servei.
 */

import { sql } from 'kysely';
import type { AuditContext } from '../audit/audited-transaction.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { dbBool, isTrue } from '../db/bool.js';
import type { MigrationDb } from '../db/migration-db.js';
import { PolicyError, notFound } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';

export const THEMES = ['system', 'light', 'dark'] as const;
export const ACCENTS = ['default', 'soft', 'mono-warm', 'mono-cool'] as const;
export const INBOX_POSITIONS = ['left', 'right', 'below'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];
export type InboxPosition = (typeof INBOX_POSITIONS)[number];

export interface UserProfile {
  id: string;
  email: string | null;
  name: string;
  role: 'admin' | 'member';
  kind: 'human' | 'ai' | 'caldav_only';
  timezone: string;
  locale: string;
  theme: Theme;
  accent: Accent;
  avatar_color: string | null;
}

export interface UserSettings {
  done_cleared_at: string | null;
  inbox_position: InboxPosition;
  inbox_show_overdue: boolean;
  collapsed_groups: string[];
  show_calendar_widget: boolean;
  show_overdue_section: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  daily_digest_at: string | null;
}

const PROFILE_COLUMNS = sql`
  id, email, name, role, kind, timezone, locale, theme, accent, avatar_color
`;

export async function getProfile(db: MigrationDb, userId: string): Promise<UserProfile> {
  const found = await sql<UserProfile>`
    SELECT ${PROFILE_COLUMNS} FROM users WHERE id = ${userId} AND deleted_at IS NULL
  `.execute(db);
  const row = found.rows[0];
  if (row === undefined) throw notFound('usuari', userId);
  return row;
}

export interface UpdateProfileInput {
  name?: string | undefined;
  timezone?: string | undefined;
  locale?: string | undefined;
  theme?: string | undefined;
  accent?: string | undefined;
  avatar_color?: string | null | undefined;
}

/**
 * **Els valors d'enum es validen aquí i no només al CHECK de la base.**
 *
 * Un `theme: 'fosc'` passaria el tipus de TypeScript si vingués de fora i petaria com a
 * violació de CHECK, que és un 500 que no explica res. Rebutjar-lo amb la llista de
 * valors vàlids és el que permet corregir en comptes de reintentar (docs/05 §3).
 */
export async function updateProfile(
  ctx: AuditContext,
  principal: Principal,
  input: UpdateProfileInput,
): Promise<UserProfile> {
  const before = await getProfile(ctx.tx, principal.userId);

  const name = input.name?.trim() ?? before.name;
  if (name === '') {
    throw new PolicyError('name-required', 'Name required', 422, 'El nom no pot quedar buit.');
  }

  const theme = pickEnum('theme', input.theme, THEMES, before.theme);
  const accent = pickEnum('accent', input.accent, ACCENTS, before.accent);
  const timezone = input.timezone ?? before.timezone;
  const locale = input.locale ?? before.locale;
  const avatarColor = input.avatar_color === undefined ? before.avatar_color : input.avatar_color;

  // Un fus que no existeix deixaria totes les vistes de calendari en un estat
  // incomprensible; `Intl` és qui sap quins existeixen de veritat.
  if (input.timezone !== undefined && !isValidTimezone(timezone)) {
    throw new PolicyError(
      'invalid-timezone',
      'Invalid timezone',
      422,
      `"${timezone}" no és cap fus horari. Fes servir un nom de la base IANA, com Europe/Madrid.`,
    );
  }

  const igual =
    name === before.name &&
    theme === before.theme &&
    accent === before.accent &&
    timezone === before.timezone &&
    locale === before.locale &&
    avatarColor === before.avatar_color;
  if (igual) {
    ctx.noChange();
    return before;
  }

  await sql`
    UPDATE users SET name = ${name}, timezone = ${timezone}, locale = ${locale},
                     theme = ${theme}, accent = ${accent}, avatar_color = ${avatarColor},
                     updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${principal.userId}
  `.execute(ctx.tx);

  ctx.record({
    entityType: 'user',
    entityId: principal.userId,
    verb: 'updated',
    changes: {
      name: { from: before.name, to: name },
      theme: { from: before.theme, to: theme },
      accent: { from: before.accent, to: accent },
    },
  });

  return getProfile(ctx.tx, principal.userId);
}

function pickEnum<T extends string>(
  field: string,
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new PolicyError(
    'invalid-value',
    'Invalid value',
    422,
    `"${value}" no és un valor de ${field}. Els vàlids són: ${allowed.join(', ')}.`,
  );
}

function isValidTimezone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Canvi de contrasenya.
 *
 * **Demana l'actual encara que hi hagi sessió.** Una sessió oberta en un ordinador
 * compartit no és prova d'identitat suficient per canviar la credencial que obre totes
 * les altres.
 *
 * I **revoca la resta de sessions**: si algú ha canviat la contrasenya és perquè sospita
 * que algú altre la sabia, i deixar-li les sessions obertes buida el gest de sentit.
 */
export async function changePassword(
  ctx: AuditContext,
  principal: Principal,
  input: { current?: string | undefined; next?: string | undefined },
): Promise<{ revoked_sessions: number }> {
  const found = await sql<{ password_hash: string | null }>`
    SELECT password_hash FROM users WHERE id = ${principal.userId} AND deleted_at IS NULL
  `.execute(ctx.tx);
  const row = found.rows[0];
  if (row === undefined) throw notFound('usuari', principal.userId);

  if (input.next === undefined || input.next.length < 10) {
    throw new PolicyError(
      'password-too-short',
      'Password too short',
      422,
      'La contrasenya ha de tenir com a mínim 10 caràcters.',
    );
  }

  const correcta = await verifyPassword(input.current ?? '', row.password_hash);
  if (!correcta) {
    throw new PolicyError(
      'wrong-password',
      'Wrong password',
      403,
      'La contrasenya actual no és correcta.',
    );
  }

  await sql`
    UPDATE users SET password_hash = ${await hashPassword(input.next)},
                     updated_at = ${ctx.now}, version = version + 1
    WHERE id = ${principal.userId}
  `.execute(ctx.tx);

  const revoked = await sql`
    UPDATE sessions SET revoked_at = ${ctx.now}
    WHERE user_id = ${principal.userId} AND revoked_at IS NULL
  `.execute(ctx.tx);

  ctx.record({ entityType: 'user', entityId: principal.userId, verb: 'updated' });

  return { revoked_sessions: Number(revoked.numAffectedRows ?? 0n) };
}

// ---------------------------------------------------------------- preferències

const DEFAULT_SETTINGS: UserSettings = {
  done_cleared_at: null,
  inbox_position: 'right',
  inbox_show_overdue: true,
  collapsed_groups: [],
  show_calendar_widget: true,
  show_overdue_section: true,
  quiet_hours_start: null,
  quiet_hours_end: null,
  daily_digest_at: null,
};

/**
 * Les preferències, amb els valors per defecte si encara no n'hi ha fila.
 *
 * No es crea la fila en llegir: un usuari que no ha tocat mai res no ha de deixar
 * escriptures a la base només per haver obert el tauler.
 */
export async function getSettings(db: MigrationDb, userId: string): Promise<UserSettings> {
  const found = await sql<{
    done_cleared_at: string | null;
    inbox_position: InboxPosition;
    inbox_show_overdue: unknown;
    collapsed_groups: string | null;
    show_calendar_widget: unknown;
    show_overdue_section: unknown;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    daily_digest_at: string | null;
  }>`SELECT done_cleared_at, inbox_position, inbox_show_overdue, collapsed_groups,
            show_calendar_widget, show_overdue_section, quiet_hours_start, quiet_hours_end,
            daily_digest_at
     FROM user_settings WHERE user_id = ${userId}`.execute(db);

  const row = found.rows[0];
  if (row === undefined) return { ...DEFAULT_SETTINGS };

  return {
    done_cleared_at: row.done_cleared_at,
    inbox_position: row.inbox_position,
    inbox_show_overdue: isTrue(row.inbox_show_overdue),
    collapsed_groups: parseGroups(row.collapsed_groups),
    show_calendar_widget: isTrue(row.show_calendar_widget),
    show_overdue_section: isTrue(row.show_overdue_section),
    quiet_hours_start: row.quiet_hours_start,
    quiet_hours_end: row.quiet_hours_end,
    daily_digest_at: row.daily_digest_at,
  };
}

/** Un JSON corrupte a la columna no ha de deixar l'usuari sense tauler. */
function parseGroups(raw: string | null): string[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export interface UpdateSettingsInput {
  done_cleared_at?: string | null | undefined;
  inbox_position?: string | undefined;
  inbox_show_overdue?: boolean | undefined;
  collapsed_groups?: string[] | undefined;
  show_calendar_widget?: boolean | undefined;
  show_overdue_section?: boolean | undefined;
  quiet_hours_start?: string | null | undefined;
  quiet_hours_end?: string | null | undefined;
  daily_digest_at?: string | null | undefined;
}

export async function updateSettings(
  ctx: AuditContext,
  principal: Principal,
  input: UpdateSettingsInput,
): Promise<UserSettings> {
  const before = await getSettings(ctx.tx, principal.userId);

  const next: UserSettings = {
    done_cleared_at:
      input.done_cleared_at === undefined ? before.done_cleared_at : input.done_cleared_at,
    inbox_position: pickEnum(
      'inbox_position',
      input.inbox_position,
      INBOX_POSITIONS,
      before.inbox_position,
    ),
    inbox_show_overdue: input.inbox_show_overdue ?? before.inbox_show_overdue,
    collapsed_groups: input.collapsed_groups ?? before.collapsed_groups,
    show_calendar_widget: input.show_calendar_widget ?? before.show_calendar_widget,
    show_overdue_section: input.show_overdue_section ?? before.show_overdue_section,
    quiet_hours_start:
      input.quiet_hours_start === undefined ? before.quiet_hours_start : input.quiet_hours_start,
    quiet_hours_end:
      input.quiet_hours_end === undefined ? before.quiet_hours_end : input.quiet_hours_end,
    daily_digest_at:
      input.daily_digest_at === undefined ? before.daily_digest_at : input.daily_digest_at,
  };

  if (JSON.stringify(next) === JSON.stringify(before)) {
    ctx.noChange();
    return before;
  }

  // Un UPSERT i no un INSERT-o-UPDATE en dos passos: entre els dos passos, dues pestanyes
  // que canviessin preferències alhora es trepitjarien amb una violació de clau primària.
  await sql`
    INSERT INTO user_settings (user_id, done_cleared_at, inbox_position, inbox_show_overdue,
                               collapsed_groups, show_calendar_widget, show_overdue_section,
                               quiet_hours_start, quiet_hours_end, daily_digest_at,
                               notify_prefs, updated_at)
    VALUES (${principal.userId}, ${next.done_cleared_at}, ${next.inbox_position},
            ${dbBool(next.inbox_show_overdue)}, ${JSON.stringify(next.collapsed_groups)},
            ${dbBool(next.show_calendar_widget)}, ${dbBool(next.show_overdue_section)},
            ${next.quiet_hours_start}, ${next.quiet_hours_end}, ${next.daily_digest_at},
            '{}', ${ctx.now})
    ON CONFLICT (user_id) DO UPDATE SET
      done_cleared_at = excluded.done_cleared_at,
      inbox_position = excluded.inbox_position,
      inbox_show_overdue = excluded.inbox_show_overdue,
      collapsed_groups = excluded.collapsed_groups,
      show_calendar_widget = excluded.show_calendar_widget,
      show_overdue_section = excluded.show_overdue_section,
      quiet_hours_start = excluded.quiet_hours_start,
      quiet_hours_end = excluded.quiet_hours_end,
      daily_digest_at = excluded.daily_digest_at,
      updated_at = excluded.updated_at
  `.execute(ctx.tx);

  ctx.record({ entityType: 'user_settings', entityId: principal.userId, verb: 'updated' });
  return next;
}
