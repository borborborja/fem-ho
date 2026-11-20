import type { components, operations } from '@fem-ho/contracts';
import { v7 as uuidv7, validate as isUuid } from 'uuid';
import { api, ApiError, currentSessionEpoch, currentTokens } from './api.js';

export type PushDeviceSettings = components['schemas']['PushDeviceSettings'];
export type PushScopeSettings = components['schemas']['PushScopeSettings'];
export type PushScopeSettingsUpdate = components['schemas']['PushScopeSettingsUpdate'];
type PushSubscriptionInput = components['schemas']['PushSubscriptionInput'];
type VapidPublicKey =
  operations['getVapidPublicKey']['responses'][200]['content']['application/json'];

// El worker llegeix aquest vincle encara que totes les pestanyes estiguin tancades.
const CACHE_NAME = 'femho-activity-notifications';
const BINDING_PATH = '/.__femho-notify/device';
const RENEW_MESSAGE = 'femho-activity-renew';
const TAG_PREFIX = 'femho-activity-';
const deviceIds = new Map<string, string>();
let changing = 0;

export type BrowserPushSupport = 'available' | 'unsupported' | 'ios-install';
export function browserPushSupport(): BrowserPushSupport {
  const ios =
    /iPad|iPhone|iPod/u.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'ios-install';
  return window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    'caches' in window
    ? 'available'
    : 'unsupported';
}

export function devicePath(id: string): string {
  return `/api/v1/push/devices/${id}`;
}

function savedDeviceId(userId: string): string | undefined {
  const cached = deviceIds.get(userId);
  if (cached !== undefined) return cached;
  try {
    const id = localStorage.getItem(`femho.push.device.${userId}`);
    if (id !== null && isUuid(id)) {
      deviceIds.set(userId, id);
      return id;
    }
  } catch {
    // El dispositiu pot ser només temporal si el navegador no desa l'emmagatzematge.
  }
  return undefined;
}

export function browserDeviceId(userId: string): string {
  const known = savedDeviceId(userId);
  if (known !== undefined) return known;
  const id = uuidv7();
  deviceIds.set(userId, id);
  try {
    localStorage.setItem(`femho.push.device.${userId}`, id);
  } catch {
    // L'identificador encara és estable dins de la pestanya.
  }
  return id;
}

export interface BrowserPush {
  registration: ServiceWorkerRegistration;
  key: ArrayBuffer;
}

export async function prepareBrowserPush(): Promise<BrowserPush> {
  // El registre versionat de la PWA comença quan la pàgina acaba de carregar.
  if (document.readyState !== 'complete') {
    await new Promise<void>((resolve) =>
      window.addEventListener('load', () => resolve(), { once: true }),
    );
  }
  // En desenvolupament la PWA pot no estar registrada. No deixem el botó pendent per sempre.
  const [registration, { public_key }] = await Promise.all([
    navigator.serviceWorker.getRegistration(),
    api.get<VapidPublicKey>('/api/v1/push/public-key'),
  ]);
  if (registration === undefined) throw new Error('Push service worker is unavailable');
  const base64 = public_key.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return { registration: await navigator.serviceWorker.ready, key: bytes.buffer };
}

async function browserPushBinding(cache: Cache): Promise<string | undefined> {
  return (await cache.match(BINDING_PATH))?.text();
}

export async function browserPushBound(id: string): Promise<boolean> {
  if (!('caches' in window)) return false;
  return (await browserPushBinding(await caches.open(CACHE_NAME))) === id;
}

function withBindingLock<T>(action: () => Promise<T>): Promise<T> {
  // La subscripció és del navegador, compartida per les pestanyes del mateix origen.
  return navigator.locks === undefined ? action() : navigator.locks.request(CACHE_NAME, action);
}

function withDeviceLock<T>(id: string, action: () => Promise<T>): Promise<T> {
  return navigator.locks === undefined
    ? action()
    : navigator.locks.request(`${CACHE_NAME}:${id}`, action);
}

function writePendingDisable(id: string, pending: boolean): void {
  try {
    const key = `femho.push.disable.${id}`;
    if (pending) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // L'absència d'emmagatzematge no ha d'impedir aturar el lliurament local.
  }
}

function hasPendingDisable(id: string): boolean {
  try {
    return localStorage.getItem(`femho.push.disable.${id}`) === '1';
  } catch {
    return false;
  }
}

async function sendDisable(id: string): Promise<void> {
  await api.put(devicePath(id), { platform: 'web', enabled: false });
  writePendingDisable(id, false);
}

function currentDevice(userId: string, epoch: number, revision: number): boolean {
  return (
    epoch === currentSessionEpoch() && revision === changing && currentTokens()?.user_id === userId
  );
}

function subscribe({ registration, key }: BrowserPush): Promise<PushSubscription> {
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

function publicKeyMatches(subscription: PushSubscription, key: ArrayBuffer): boolean {
  const stored = subscription.options.applicationServerKey;
  if (stored === null || stored.byteLength !== key.byteLength) return false;
  const subscribed = new Uint8Array(stored);
  return new Uint8Array(key).every((byte, index) => byte === subscribed[index]);
}

async function withExistingSubscription(push: BrowserPush): Promise<PushSubscription> {
  const existing = await push.registration.pushManager.getSubscription();
  if (existing !== null) {
    if (publicKeyMatches(existing, push.key)) return existing;
    await existing.unsubscribe();
  }
  return subscribe(push);
}

async function registerSubscription(id: string, subscription: PushSubscription): Promise<void> {
  const value = subscription.toJSON();
  if (value.keys?.p256dh === undefined || value.keys.auth === undefined) {
    throw new Error('Push subscription missing encryption keys');
  }
  const input: PushSubscriptionInput = {
    endpoint: subscription.endpoint,
    p256dh: value.keys.p256dh,
    auth: value.keys.auth,
    platform: 'web',
    device_id: id,
  };
  await api.post('/api/v1/push/subscriptions', input);
}

async function bindSubscription(
  id: string,
  subscription: PushSubscription,
  push: BrowserPush,
  current: () => boolean,
): Promise<string | undefined> {
  try {
    await registerSubscription(id, subscription);
    return subscription.endpoint;
  } catch (cause) {
    if (!(cause instanceof ApiError) || !cause.problem?.type.endsWith('/push-subscription-in-use'))
      throw cause;
  }
  // Després de sortir sense connexió pot quedar un punt final lligat al compte anterior.
  // Renovar-lo preserva el vincle privat del servidor i permet activar el compte nou.
  if (!current()) return undefined;
  await subscription.unsubscribe();
  if (!current()) return undefined;
  const renewed = await subscribe(push);
  if (!current()) return undefined;
  await registerSubscription(id, renewed);
  return renewed.endpoint;
}

export async function enableBrowserPush(
  userId: string,
  id: string,
  push: BrowserPush,
): Promise<void> {
  const epoch = currentSessionEpoch();
  const revision = ++changing;
  const current = () => currentDevice(userId, epoch, revision);
  // Subscribe ha de començar a dins del gest que autoritza el navegador.
  const subscription = await subscribe(push).catch((cause: unknown) => {
    if (!(cause instanceof DOMException) || cause.name !== 'InvalidStateError') throw cause;
    return withExistingSubscription(push);
  });
  const cache = await caches.open(CACHE_NAME);
  await withDeviceLock(id, async () => {
    if (!current()) return;
    await api.put(devicePath(id), { platform: 'web', enabled: true });
    if (!current()) return;
    await bindSubscription(id, subscription, push, current);
    await withBindingLock(async () => {
      if (!current()) return;
      await cache.put(BINDING_PATH, new Response(id));
      if (current()) writePendingDisable(id, false);
    });
  });
}

export async function clearBrowserPush(id: string): Promise<void> {
  if (!('caches' in window) || !('serviceWorker' in navigator)) return;
  await withBindingLock(async () => {
    const cache = await caches.open(CACHE_NAME);
    if ((await browserPushBinding(cache)) !== id) return;
    await cache.delete(BINDING_PATH);
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration === undefined) return;
    const notices = await registration.getNotifications();
    for (const notice of notices) {
      if (notice.tag.startsWith(TAG_PREFIX) && notice.data?.device_id === id) notice.close();
    }
    if ((await browserPushBinding(cache)) === undefined) {
      await (await registration.pushManager.getSubscription())?.unsubscribe();
    }
  });
}

export async function disableBrowserPush(id: string): Promise<void> {
  const epoch = currentSessionEpoch();
  const revision = ++changing;
  writePendingDisable(id, true);
  await Promise.all([
    clearBrowserPush(id),
    withDeviceLock(id, async () => {
      if (epoch === currentSessionEpoch() && revision === changing) await sendDisable(id);
    }),
  ]);
}

export function clearBrowserPushForUser(userId: string | undefined): void {
  changing += 1;
  const id = userId === undefined ? undefined : savedDeviceId(userId);
  if (id !== undefined) void clearBrowserPush(id).catch(() => undefined);
}

export function disableBrowserPushForUser(userId: string | undefined): Promise<void> {
  const id = userId === undefined ? undefined : savedDeviceId(userId);
  if (id === undefined) return Promise.resolve();
  changing += 1;
  writePendingDisable(id, true);
  // Iniciem la crida abans que logout retire les credencials d'aquesta pestanya.
  return Promise.allSettled([sendDisable(id), clearBrowserPush(id)]).then(() => undefined);
}

export function watchBrowserPush(userId: string): () => void {
  if (browserPushSupport() !== 'available') return () => undefined;
  const epoch = currentSessionEpoch();
  let running = false;
  let stopped = false;
  let syncedEndpoint: string | undefined;

  const refresh = async (): Promise<void> => {
    if (stopped || running) return;
    const id = savedDeviceId(userId);
    if (id === undefined) return;
    running = true;
    const revision = changing;
    const current = () => !stopped && currentDevice(userId, epoch, revision);
    try {
      if (hasPendingDisable(id)) {
        // Tancar el vincle local funciona fora de línia. Quan torna la xarxa,
        // la mateixa sessió també dona de baixa el dispositiu del servidor.
        await withDeviceLock(id, async () => {
          if (current() && hasPendingDisable(id)) await sendDisable(id);
        });
        return;
      }
      if (Notification.permission !== 'granted') return;
      const cache = await caches.open(CACHE_NAME);
      if ((await browserPushBinding(cache)) !== id || !current()) return;
      const settings = await api.get<PushDeviceSettings>(devicePath(id));
      if (!current()) return;
      if (!settings.enabled) {
        await clearBrowserPush(id);
        return;
      }
      const push = await prepareBrowserPush();
      if (!current()) return;
      const subscription = await withExistingSubscription(push);
      if (current() && (!settings.subscribed || subscription.endpoint !== syncedEndpoint)) {
        syncedEndpoint = await bindSubscription(id, subscription, push, current);
      }
    } catch {
      // Sense xarxa, la següent obertura o reconnexió ho tornarà a provar.
    } finally {
      running = false;
    }
  };

  const onVisible = (): void => {
    if (document.visibilityState === 'visible') void refresh();
  };
  const onMessage = (event: MessageEvent): void => {
    if (event.data === RENEW_MESSAGE) void refresh();
  };
  void refresh();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onVisible);
    navigator.serviceWorker.removeEventListener('message', onMessage);
  };
}
