import { catalogOf, FALLBACK, isLocale, type components } from '@fem-ho/contracts';
import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import type { AuditContext } from '../audit/audited-transaction.js';
import type { MigrationDb } from '../db/migration-db.js';
import { notFound, PolicyError } from '../policy/errors.js';
import type { Principal } from '../policy/principal.js';
import { visibleScopesPredicate } from '../policy/scope-visibility.js';
import { assertScopeAccess, listScopes } from './scopes.js';

type Schemas = components['schemas'];
export type TaskActivityKind = Schemas['TaskActivityKind'];
export type TaskActivityNotification = Schemas['TaskActivityNotification'];
type DeviceSettings = Schemas['PushDeviceSettings'];
type ScopeSettings = Schemas['PushScopeSettings'];
type ScopePatch = { [K in keyof Schemas['PushScopeSettingsUpdate']]: boolean | undefined };
type DeviceInput = Schemas['PushDeviceSettingsInput'];
type Platform = DeviceInput['platform'];

export const TASK_ACTIVITY_TTL = 24 * 60 * 60;
const PAGE_SIZE = 50;

const kindLabels = {
  task_created: 'notify.activity.taskCreated',
  status_changed: 'notify.activity.statusChanged',
  task_activity: 'notify.activity.taskActivity',
  inbox_entry: 'notify.activity.inboxEntry',
} as const satisfies Record<TaskActivityKind, string>;

interface DeviceRow {
  session_id: string;
  platform: Platform;
  enabled: number;
  subscription_id: string | null;
}

export function notificationSession(principal: Principal): string {
  if (
    principal.kind !== 'user' ||
    principal.credentialType !== 'session' ||
    !principal.credentialId
  ) {
    throw new PolicyError(
      'notification-session-required',
      'App session required',
      403,
      'Manage this device from an authenticated Fem-ho app session.',
    );
  }
  return principal.credentialId;
}

async function ownedDevice(db: MigrationDb, userId: string, deviceId: string) {
  const result = await sql<DeviceRow>`
    SELECT session_id, platform, enabled, subscription_id FROM notification_devices
    WHERE id = ${deviceId} AND user_id = ${userId}
  `.execute(db);
  return result.rows[0];
}

async function lockOwnedDevice(db: MigrationDb, userId: string, deviceId: string) {
  const result = await sql<DeviceRow>`
    UPDATE notification_devices SET enabled = enabled
    WHERE id = ${deviceId} AND user_id = ${userId}
    RETURNING session_id, platform, enabled, subscription_id
  `.execute(db);
  return result.rows[0];
}

function scopeSettings(
  scopeId: string,
  name: string,
  kinds: readonly TaskActivityKind[],
): ScopeSettings {
  return {
    scope_id: scopeId,
    scope_name: name,
    task_created: kinds.includes('task_created'),
    status_changed: kinds.includes('status_changed'),
    task_activity: kinds.includes('task_activity'),
    inbox_entry: kinds.includes('inbox_entry'),
  };
}

export async function getPushDeviceSettings(
  db: MigrationDb,
  principal: Principal,
  deviceId: string,
): Promise<DeviceSettings> {
  const sessionId = notificationSession(principal);
  const device = await ownedDevice(db, principal.userId, deviceId);
  const scopes = await listScopes(db, principal);
  const enabled = device?.session_id === sessionId && device.enabled === 1;
  const preferences = new Map<string, TaskActivityKind[]>();
  if (device) {
    const rows = await sql<{ scope_id: string; kind: TaskActivityKind }>`
      SELECT scope_id, kind FROM task_activity_preferences WHERE device_id = ${deviceId}
    `.execute(db);
    for (const row of rows.rows) {
      const kinds = preferences.get(row.scope_id) ?? [];
      kinds.push(row.kind);
      preferences.set(row.scope_id, kinds);
    }
  }
  return {
    enabled,
    subscribed: enabled && device.subscription_id !== null,
    scopes: scopes.map((scope) =>
      scopeSettings(scope.id, scope.name, preferences.get(scope.id) ?? []),
    ),
  };
}

async function discardActivitySubscription(db: MigrationDb, id: string | null) {
  if (id === null) return;
  await sql`DELETE FROM push_subscriptions WHERE id = ${id} AND activity_only = 1`.execute(db);
}

export async function setPushDeviceSettings(
  ctx: AuditContext,
  principal: Principal,
  deviceId: string,
  input: DeviceInput,
): Promise<DeviceSettings> {
  const sessionId = notificationSession(principal);
  const current = await lockOwnedDevice(ctx.tx, principal.userId, deviceId);

  if (!current && !input.enabled) {
    ctx.noChange();
    return getPushDeviceSettings(ctx.tx, principal, deviceId);
  }
  if (
    current &&
    current.platform === input.platform &&
    current.session_id === sessionId &&
    current.enabled === Number(input.enabled)
  ) {
    ctx.noChange();
    return getPushDeviceSettings(ctx.tx, principal, deviceId);
  }
  const updated = await sql<{ id: string }>`
    INSERT INTO notification_devices (id, user_id, session_id, platform, enabled)
    VALUES (${deviceId}, ${principal.userId}, ${sessionId}, ${input.platform}, ${Number(input.enabled)})
    ON CONFLICT (id) DO UPDATE
    SET subscription_id =
        CASE WHEN notification_devices.session_id = excluded.session_id AND excluded.enabled = 1
             THEN notification_devices.subscription_id ELSE NULL END,
        session_id = excluded.session_id, enabled = excluded.enabled
    WHERE notification_devices.user_id = excluded.user_id AND notification_devices.platform = excluded.platform
    RETURNING id
  `.execute(ctx.tx);
  if (!updated.rows[0]) throw notFound('push device', deviceId);

  if (current && (!input.enabled || current.session_id !== sessionId)) {
    await sql`DELETE FROM task_activity_notifications WHERE device_id = ${deviceId}`.execute(
      ctx.tx,
    );
    await discardActivitySubscription(ctx.tx, current.subscription_id);
  }
  ctx.record({
    entityType: 'notification_device',
    entityId: deviceId,
    verb: current ? 'updated' : 'created',
  });
  return getPushDeviceSettings(ctx.tx, principal, deviceId);
}

/** Pren el bloqueig de la fila abans de tocar la subscripció o els avisos del dispositiu. */
export async function lockPushActivityDevice(
  db: MigrationDb,
  principal: Principal,
  deviceId: string,
): Promise<DeviceRow> {
  const sessionId = notificationSession(principal);
  const result = await sql<DeviceRow>`
    UPDATE notification_devices SET enabled = enabled
    WHERE id = ${deviceId} AND user_id = ${principal.userId} AND session_id = ${sessionId} AND enabled = 1
    RETURNING session_id, platform, enabled, subscription_id
  `.execute(db);
  const device = result.rows[0];
  if (!device) throw notFound('push device', deviceId);
  return device;
}

export async function bindPushActivitySubscription(
  ctx: AuditContext,
  deviceId: string,
  device: DeviceRow,
  subscriptionId: string,
): Promise<void> {
  if (device.subscription_id === subscriptionId) return;
  const alreadyBound = await sql<{ id: string }>`
    SELECT id FROM notification_devices WHERE subscription_id = ${subscriptionId}
  `.execute(ctx.tx);
  if (alreadyBound.rows.length > 0) {
    throw new PolicyError(
      'push-subscription-in-use',
      'Subscription in use',
      409,
      'Renew the push subscription on this device.',
    );
  }
  await sql`UPDATE notification_devices SET subscription_id = ${subscriptionId} WHERE id = ${deviceId}`.execute(
    ctx.tx,
  );
  await discardActivitySubscription(ctx.tx, device.subscription_id);
  ctx.record({ entityType: 'notification_device', entityId: deviceId, verb: 'updated' });
}

export async function setPushScopeSettings(
  ctx: AuditContext,
  principal: Principal,
  deviceId: string,
  scopeId: string,
  patch: ScopePatch,
): Promise<ScopeSettings> {
  const scope = await assertScopeAccess(ctx.tx, principal, scopeId);
  await lockPushActivityDevice(ctx.tx, principal, deviceId);

  const rows = await sql<{ kind: TaskActivityKind }>`
    SELECT kind FROM task_activity_preferences WHERE device_id = ${deviceId} AND scope_id = ${scopeId}
  `.execute(ctx.tx);
  const kinds = new Set(rows.rows.map((row) => row.kind));
  let changed = false;
  for (const kind of Object.keys(kindLabels) as TaskActivityKind[]) {
    const enabled = patch[kind];
    if (enabled === undefined || kinds.has(kind) === enabled) continue;
    changed = true;
    if (enabled) {
      await sql`
        INSERT INTO task_activity_preferences (device_id, scope_id, kind)
        VALUES (${deviceId}, ${scopeId}, ${kind})
      `.execute(ctx.tx);
      kinds.add(kind);
    } else {
      await sql`
        DELETE FROM task_activity_preferences
        WHERE device_id = ${deviceId} AND scope_id = ${scopeId} AND kind = ${kind}
      `.execute(ctx.tx);
      await sql`
        DELETE FROM task_activity_notifications
        WHERE device_id = ${deviceId} AND scope_id = ${scopeId} AND kind = ${kind}
      `.execute(ctx.tx);
      kinds.delete(kind);
    }
  }
  if (changed)
    ctx.record({ entityType: 'notification_device', entityId: deviceId, verb: 'updated' });
  else ctx.noChange();
  return scopeSettings(scopeId, scope.name, [...kinds]);
}

export async function enqueueTaskActivityNotifications(
  tx: MigrationDb,
  {
    taskId,
    scopeId,
    kinds,
    now,
  }: { taskId: string; scopeId: string; kinds: readonly TaskActivityKind[]; now: string },
): Promise<void> {
  if (kinds.length === 0) return;
  const preferences = sql`
    FROM task_activity_preferences p
    JOIN notification_devices d ON d.id = p.device_id
    JOIN sessions sess ON sess.id = d.session_id AND sess.user_id = d.user_id
    JOIN users u ON u.id = d.user_id
    JOIN scopes s ON s.id = p.scope_id
    WHERE p.scope_id = ${scopeId} AND p.kind IN (${sql.join(kinds)}) AND d.enabled = 1
      AND (d.platform = 'android' OR d.subscription_id IS NOT NULL)
      AND s.deleted_at IS NULL AND u.kind = 'human' AND u.deleted_at IS NULL
      AND sess.revoked_at IS NULL AND sess.expires_at > ${now}
      AND ${visibleScopesPredicate(sql.ref('d.user_id'))}
  `;
  const targets = await sql<{ device_id: string }>`
    SELECT DISTINCT d.id AS device_id ${preferences} ORDER BY device_id
  `.execute(tx);

  const expiry = new Date(Date.parse(now) + TASK_ACTIVITY_TTL * 1000).toISOString();
  for (const { device_id: deviceId } of targets.rows) {
    // Una desactivació ha de buidar també els avisos que s'estan encuant en paral·lel.
    // Bloquegem tots els dispositius en el mateix ordre per evitar interbloquejos.
    await sql`UPDATE notification_devices SET enabled = enabled WHERE id = ${deviceId}`.execute(tx);
    const active = await sql<{ kind: TaskActivityKind }>`
      SELECT p.kind ${preferences} AND d.id = ${deviceId}
    `.execute(tx);
    const kind = kinds.find((candidate) => active.rows.some((row) => row.kind === candidate));
    if (kind === undefined) continue;
    await sql`
      INSERT INTO task_activity_notifications (id, device_id, scope_id, task_id, kind,
                                              created_at, expires_at, available_at)
      VALUES (${uuidv7()}, ${deviceId}, ${scopeId}, ${taskId}, ${kind}, ${now}, ${expiry}, ${now})
    `.execute(tx);
  }
}

export interface EligibleActivityRow {
  id: string;
  device_id: string;
  task_id: string;
  kind: TaskActivityKind;
  created_at: string;
  expires_at: string;
  title: string;
  locale: string;
}

export const activityAudience = sql`
  FROM task_activity_notifications n
  JOIN notification_devices d ON d.id = n.device_id AND d.enabled = 1
  JOIN sessions sess ON sess.id = d.session_id AND sess.user_id = d.user_id
  JOIN users u ON u.id = d.user_id AND u.kind = 'human' AND u.deleted_at IS NULL
  JOIN tasks t ON t.id = n.task_id AND t.scope_id = n.scope_id AND t.deleted_at IS NULL
  JOIN scopes s ON s.id = t.scope_id AND s.deleted_at IS NULL
  JOIN task_activity_preferences p
    ON p.device_id = d.id AND p.scope_id = s.id AND p.kind = n.kind
`;

export function activityVisibleAt(now: string) {
  return sql`n.expires_at > ${now} AND sess.revoked_at IS NULL AND sess.expires_at > ${now}
             AND ${visibleScopesPredicate(sql.ref('d.user_id'))}`;
}

export function activityPayload(row: EligibleActivityRow): TaskActivityNotification {
  const labels = catalogOf(isLocale(row.locale) ? row.locale : FALLBACK);
  return {
    id: row.id,
    kind: row.kind,
    device_id: row.device_id,
    task_id: row.task_id,
    title: labels[kindLabels[row.kind]]!,
    body: Array.from(row.title).slice(0, 200).join(''),
    created_at: row.created_at,
  };
}

export async function pendingPushActivity(
  db: MigrationDb,
  principal: Principal,
  deviceId: string,
  now: string,
): Promise<TaskActivityNotification[]> {
  const sessionId = notificationSession(principal);
  const rows = await sql<EligibleActivityRow>`
    SELECT n.id, n.device_id, n.task_id, n.kind, n.created_at, n.expires_at, t.title, u.locale
    ${activityAudience}
    WHERE d.id = ${deviceId} AND d.user_id = ${principal.userId} AND d.session_id = ${sessionId}
      AND d.platform = 'android' AND ${activityVisibleAt(now)}
    ORDER BY n.created_at, n.id LIMIT ${PAGE_SIZE}
  `.execute(db);
  return rows.rows.map(activityPayload);
}

export async function acknowledgePushActivity(
  db: MigrationDb,
  principal: Principal,
  deviceId: string,
  ids: readonly string[],
): Promise<void> {
  const sessionId = notificationSession(principal);
  if (ids.length === 0) return;
  // És comptabilitat de lliurament: l'historial conserva el canvi a la tasca, no l'acusament del mòbil.
  await sql`
    DELETE FROM task_activity_notifications
    WHERE device_id = ${deviceId} AND id IN (${sql.join(ids)}) AND EXISTS (
      SELECT 1 FROM notification_devices d
      WHERE d.id = ${deviceId} AND d.platform = 'android' AND d.user_id = ${principal.userId}
        AND d.session_id = ${sessionId} AND d.enabled = 1
    )
  `.execute(db);
}
