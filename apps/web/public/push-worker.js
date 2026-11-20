/* global self, caches, URL, Response */

// El registre versionat de Workbox importa aquest fitxer. El vincle no és cap credencial:
// només permet descartar avisos que arriben després de sortir o canviar de compte.
const activityCache = 'femho-activity-notifications';
const deviceBindingPath = '/.__femho-notify/device';
const seenPath = '/.__femho-notify/seen/';
const notificationTag = 'femho-activity-';
const activityKinds = new Set(['task_created', 'status_changed', 'task_activity', 'inbox_entry']);
const inFlight = new Set();

const isUuid = (value) =>
  typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(value);

async function isBound(cache, deviceId) {
  const binding = await cache.match(deviceBindingPath);
  return binding !== undefined && (await binding.text()) === deviceId;
}

function withBindingLock(action) {
  const locks = self.navigator.locks;
  return locks === undefined ? action() : locks.request(activityCache, action);
}

async function showActivity(payload) {
  if (
    !payload ||
    !activityKinds.has(payload.kind) ||
    !isUuid(payload.id) ||
    !isUuid(payload.device_id) ||
    !isUuid(payload.task_id) ||
    typeof payload.title !== 'string' ||
    typeof payload.body !== 'string' ||
    inFlight.has(payload.id)
  )
    return;

  inFlight.add(payload.id);
  try {
    await withBindingLock(async () => {
      const cache = await caches.open(activityCache);
      const seen = `${seenPath}${payload.id}`;
      if ((await cache.match(seen)) || !(await isBound(cache, payload.device_id))) return;
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/icons/icon-192.png',
        tag: `${notificationTag}${payload.id}`,
        data: { device_id: payload.device_id, task_id: payload.task_id },
      });
      await cache.put(seen, new Response(''));
      const previous = (await cache.keys()).filter((key) =>
        new URL(key.url).pathname.startsWith(seenPath),
      );
      await Promise.all(previous.slice(0, -512).map((key) => cache.delete(key)));
    });
  } finally {
    inFlight.delete(payload.id);
  }
}

self.addEventListener('push', (event) => {
  try {
    event.waitUntil(showActivity(event.data?.json()));
  } catch {
    // Un missatge que no sigui JSON no pot obrir ni tocar res.
  }
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((windows) => {
      // El worker no té la sessió. Si l'app és oberta, ella pot actualitzar el punt final.
      for (const window of windows) window.postMessage('femho-activity-renew');
    }),
  );
});

async function openActivity(data) {
  if (!isUuid(data?.device_id) || !isUuid(data?.task_id)) return;
  if (!(await isBound(await caches.open(activityCache), data.device_id))) return;
  const url = new URL('/', self.location.origin);
  url.searchParams.set('task', data.task_id);
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const app = windows.find((client) => new URL(client.url).pathname === '/');
  if (app !== undefined) {
    const page = await app.navigate(url.href);
    if (page !== null) {
      await page.focus();
      return;
    }
  }
  await self.clients.openWindow(url.href);
}

self.addEventListener('notificationclick', (event) => {
  if (!event.notification.tag.startsWith(notificationTag)) return;
  event.notification.close();
  event.waitUntil(openActivity(event.notification.data));
});
