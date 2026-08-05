# Fem-ho — Gap Dossier 3: Reminder and notification DELIVERY on the web/PWA and by email from a self-hosted server

This dossier closes the question the existing twelve dossiers leave open: **when the backend job `reminder.dispatch` (dossier 08 §8.3) decides that a reminder whose canonical REST shape is `{"trigger": "-PT1H", "method": "push"}` (dossier 05 §1.7) must now fire, what physically happens on a browser, on an installed PWA, on iOS, and in an inbox — and what a self-hosted Docker box can actually make happen without Google, without a paid provider, and without an SMTP reputation.** Dossier 06 answered this for native Android (UnifiedPush/ntfy, FCM-optional). Dossier 07, 2500 lines of web frontend including a full service-worker section, contains the string `push` zero times. Dossier 11 declares `FEMHO_SMTP_*` environment variables but never researches whether mail sent through them arrives. Everything below is fetched from RFCs, W3C/WHATWG specs, MDN browser-compat-data, caniuse, vendor documentation, package registries and library source — not from blog summaries. Anything I could not confirm against a primary source is listed in `## UNVERIFIED` at the end rather than asserted in the body.

**Date of research: 2026-08-05.** Browser "current version" baselines used throughout come from the caniuse dataset fetched on that date: Chrome 150, Edge 150, Firefox 152, Safari 26.4, iOS Safari 26.4, Chrome Android 150, Samsung Internet 30.

---

## 0. The five hard constraints, up front

Before any architecture, these are the facts that cannot be designed around. An AI writing this feature will get it wrong unless it internalises all five.

1. **Web Push is not a notification system. It is a wake-up-the-service-worker system.** The push service (FCM for Chrome, Mozilla autopush for Firefox, Apple's `web.push.apple.com` for Safari) delivers an encrypted blob to the browser, which starts your service worker and fires a `push` event. If your handler does not call `showNotification()`, Chrome shows its own notification reading *"This site has been updated in the background"*. You cannot do a silent data sync on the web push channel without the user seeing something.

2. **On desktop Chrome, Edge and Firefox, push messages only arrive while the browser process is running.** caniuse annotates the Push API rows for Chrome, Edge and Firefox with note #2: *"Requires full browser to be running to receive messages."* Safari on macOS is the exception — WebKit's own post says *"Safari doesn't even need to be running for a push message to be delivered"*, because macOS routes it through the `webpushd` daemon and APNs. A family member who closes Chrome at night will not get a 07:00 reminder until they reopen Chrome.

3. **On iOS and iPadOS, Web Push works only for a web app the user has added to the Home Screen.** caniuse marks every iOS Safari version from 16.4 to 26.5 as *partial* with note #7: *"Requires website to first be added to the Home Screen."* This has not relaxed in three years and did not relax with Declarative Web Push. In a Safari tab on iPhone, `PushManager.subscribe()` is simply not available. There is no way to prompt for install; the user must use Share → Add to Home Screen manually.

4. **The VAPID key pair is permanent infrastructure, not a rotatable secret.** RFC 8292 states that *"An application server that needs to replace its signing key needs to request the creation of a new subscription by the user agent that is restricted to the updated key."* ntfy's own operator documentation says it plainly: *"Changing your public/private keypair is **not recommended**. Browsers only allow one server identity per origin, and changing them prevents clients from subscribing until users manually clear notification permissions."* If Fem-ho generates a VAPID key pair at container start and does not persist it to a volume, every `docker compose up` silently breaks every existing web subscription in a way the user can only fix by revoking the site's notification permission in browser settings.

5. **A self-hosted box on a home connection cannot deliver mail directly.** Spamhaus's PBL lists *"end-user IP address ranges from which email should never be sent directly to the final destination"* — roughly 1.4 billion IPv4 addresses, about 40% of routable IPv4 space. Google Cloud blocks outbound port 25 entirely: *"Due to the risk of abuse, connections to destination TCP Port 25 are blocked when the destination is external to your VPC network."* Fem-ho must be built assuming email goes through an authenticated relay/smarthost on port 587 or 465, and must degrade cleanly when no relay is configured at all.

---

# PART 1 — Web Push end to end

## 1.1 The three actors and the three RFCs

RFC 8030 defines three roles:

| Role | In Fem-ho | Notes |
|---|---|---|
| **user agent** | the browser on a family member's laptop/phone | creates subscriptions, holds the private ECDH key |
| **push service** | FCM / Mozilla autopush / Apple `web.push.apple.com` / a self-hosted ntfy acting as a UnifiedPush push server | operated by the browser vendor; you do not choose it |
| **application server** | the Fem-ho Node backend | holds the VAPID private key, POSTs encrypted payloads |

Three RFCs stack:

- **RFC 8030 — Generic Event Delivery Using HTTP Push.** The transport: what you POST, which headers, which status codes come back.
- **RFC 8291 — Message Encryption for Web Push.** The payload: how the body is encrypted so the push service cannot read it.
- **RFC 8292 — Voluntary Application Server Identification (VAPID) for Web Push.** The identity: how you prove to the push service that you are the same sender the user subscribed to.

All three are mandatory in practice. Firefox and Apple both require VAPID. Chrome requires an `applicationServerKey` at subscribe time in practice for any modern deployment.

## 1.2 RFC 8030 — the wire protocol

### Request

An application server sends a push message by making an HTTP **POST** to the *push resource* URL — this is exactly the string in `PushSubscription.endpoint`. There is no other endpoint to discover, no service registration, no API key. The endpoint is the capability.

### Headers the application server sets

| Header | Required? | Exact semantics from RFC 8030 |
|---|---|---|
| `TTL` | **MUST** be present | *"an application server MUST include the TTL header field in its request for push message delivery."* Value is *"a non-negative integer, representing time in seconds."* `TTL: 0` means deliver now or discard. |
| `Urgency` | optional | One of `very-low`, `low`, `normal`, `high`. *"Default is normal if omitted."* Push services and devices may defer low-urgency messages to save battery. |
| `Topic` | optional | A `token`, *"no more than 32 characters from the URL and filename-safe Base 64 alphabet."* A new message with a matching Topic **replaces** any prior undelivered message with the same Topic for that subscription. This is server-side coalescing and it is the correct mechanism for "the reminder for task X". |
| `Content-Encoding` | required when a payload is sent | `aes128gcm` (see §1.3). |
| `Content-Type` | conventional | `application/octet-stream`. |
| `Content-Length` | per HTTP | length of the encrypted body. |
| `Authorization` | required by real push services | VAPID (see §1.4). |
| `Prefer: respond-async` | optional | asks the push service to create a *receipt subscription* and return `202 Accepted` instead of `201`; the receipt lets you learn about actual delivery. Not supported uniformly; treat as an optimisation you do not depend on. |

### Response status codes

| Code | RFC 8030 meaning | What Fem-ho's dispatcher must do |
|---|---|---|
| `201 Created` | message accepted for delivery | success; record `last_success_at` |
| `202 Accepted` | accepted, delivery confirmation requested via `Prefer: respond-async` | treat as success |
| `204 No Content` | acknowledgement of a successful delivery-receipt operation | not seen on the send path |
| `307 Temporary Redirect` | load redistribution | follow once; do **not** persist the new URL as the subscription endpoint unless the push service documents it |
| `400 Bad Request` | invalid TTL, Topic, Urgency, or subscription parameters | **permanent** — a bug in Fem-ho. Log loudly, do not retry, do not delete the subscription. |
| `404 Not Found` | *"expired subscriptions or resources"* | **delete the subscription row** |
| `410 Gone` | *"message delivery failed permanently"* | **delete the subscription row** |
| `413 Payload Too Large` | entity body exceeds limits — *"only if >4096 bytes"* | **permanent** — shrink the payload; never retry unchanged |
| `429 Too Many Requests` | rate limit exceeded | back off using `Retry-After`; retry |

Anything `5xx` or a socket error is transient: retry with backoff, bounded by the TTL you set (retrying past the TTL is pointless).

### Resource model

RFC 8030 distinguishes a **push resource** (the endpoint, shared with the application server, effectively public — anyone who has it can push to it) from a **subscription resource** (private to the user agent, used to monitor and delete the subscription) and a **receipt subscription** (created when `Prefer: respond-async` is used). Fem-ho only ever sees push resources. **Security consequence: the `endpoint` column is a bearer capability. Treat it like a token — never log it in full, never expose it through the REST API or the MCP server, never include it in an audit-log payload.**

## 1.3 RFC 8291 — encryption and the size ceiling

RFC 8291 is why the `PushSubscription` has two key fields.

- **`p256dh`** — *"For each new subscription that the user agent generates for an application, it also generates a P-256 key pair for use in ECDH."* This is the user agent's ECDH **public** key, uncompressed point form, base64url-encoded when serialised.
- **`auth`** — *"A user agent MUST generate and provide a hard-to-guess sequence of 16 octets that is used for authentication of push messages."* 16 octets, base64url-encoded.

Encryption:

- Content coding is **`aes128gcm` only**. The RFC is explicit: *"An application server MUST NOT use other content encodings for push messages. In particular, content encodings that compress could result in leaking of push message contents."*
- The `Content-Encoding` header carries exactly the one value `aes128gcm`.
- Key derivation is HKDF-SHA256 over the ECDH shared secret combined with the `auth` secret; the info string is `"WebPush: info"` followed by a zero octet and then both parties' uncompressed public keys.
- A random **salt** and the **record size (`rs`)** live in the `aes128gcm` content-coding header block prepended to the body.

**Size ceiling — this is a design constraint, not a footnote.** The absolute maximum request body is **4096 octets**. After the 86-octet content-coding header, the 16-octet GCM authentication tag, the 1-octet padding delimiter and minimum padding, *"the maximum plaintext capacity is at most 3993 octets."*

Practical consequence for Fem-ho: **the push payload is a pointer, not a document.** Do not serialise a task with its description, subtasks and comments into a push. Send an identifier and just enough text to render a useful notification offline:

```json
{"v":1,"k":"rem","t":"01J8Z…","s":"fam","ti":"Comprar pa","b":"Venç a les 18:00","u":"/t/01J8Z…","g":"rem:01J8Z…"}
```

Short keys matter at 3993 bytes when a task title is Catalan UTF-8 and you also want the scope name and a deep link. Budget: keep the JSON under ~1500 bytes so that emoji, accents and long project paths never push you over.

An older, pre-RFC scheme (`aesgcm`, with `Crypto-Key: dh=…`) exists and is still implemented by `web-push` for legacy browsers. **Fem-ho should never use it.** Every browser Fem-ho targets supports `aes128gcm`.

## 1.4 RFC 8292 — VAPID, and the key-lifetime trap

### What you sign

VAPID is a JWS/JWT signed with **ECDSA over P-256** — `alg: ES256`. RFC 8292: the signing key *"MUST be usable with the Elliptic Curve Digital Signature Algorithm (ECDSA) over the P-256 curve"*, and it must be a **separate key from any key-exchange key**.

Header:

```json
{ "typ": "JWT", "alg": "ES256" }
```

Claims:

| Claim | Rule (quoted) |
|---|---|
| `aud` | *"An 'aud' (Audience) claim in the token MUST include the Unicode serialization of the origin of the push resource URL."* i.e. `https://fcm.googleapis.com`, `https://updates.push.services.mozilla.com`, `https://web.push.apple.com` — scheme + host + port only, derived per-endpoint at send time. |
| `exp` | *"An 'exp' claim MUST NOT be more than 24 hours from the time of the request. Limiting this to 24 hours balances the need for reuse against the potential cost and likelihood of theft."* |
| `sub` | *"The 'sub' claim SHOULD include a contact URI for the application server as either a 'mailto:' (email) or an 'https:' URI."* |

### The header you send

```
Authorization: vapid t=<JWT>,k=<base64url-encoded public key>
```

The `k` parameter is *"an ECDSA public key in uncompressed form encoded using base64url encoding"* — the same 65-byte `0x04||X||Y` value the browser received as `applicationServerKey`.

A **legacy** form exists and `web-push` still emits it when you force `contentEncoding: 'aesgcm'`:

```
Authorization: WebPush <JWT>
Crypto-Key: p256ecdsa=<base64url public key>
```

Do not use it.

### Subscription restriction — and why the key can never change

RFC 8292 defines a *restricted subscription*: the user agent may pass the application server's public key to the push service when creating the subscription, using media type `application/webpush-options+json`:

```json
{ "vapid": "<base64url P-256 public key>" }
```

Once a subscription is restricted, *"the request for push message delivery MUST include a JWT signed by the private key that corresponds to the public key used when creating the subscription."*

And then the sentence that governs Fem-ho's entire key-management story:

> *"An application server that needs to replace its signing key needs to request the creation of a new subscription by the user agent that is restricted to the updated key."*

This is compounded on the browser side by the Push API spec: if `subscribe()` is called again with a different `applicationServerKey` while a subscription already exists,

> *"If any attribute on |options| contains a different value to that stored for |subscription|, then queue a global task … to reject |promise| with an `InvalidStateError` DOMException."*

**So the full failure chain when a VAPID key changes is:**

1. Server generates a new key pair (e.g. because the operator did not mount a volume, or reset `FEMHO_VAPID_PRIVATE_KEY`).
2. Every stored subscription becomes unusable: the push service rejects the JWT because it does not match the key the subscription was restricted to. You get 400/403 forever, not 410, so naive pruning does not clean up.
3. The browser client tries to re-subscribe with the new `applicationServerKey` — and gets `InvalidStateError`, because a subscription with the old key still exists in the browser.
4. The client must first call `subscription.unsubscribe()` and then `subscribe()` with the new key. If your code does not do this, the only fix is the user manually resetting the site's notification permission in browser settings — exactly what ntfy warns about.

**Therefore the client-side subscribe routine must be defensive:**

```ts
const existing = await reg.pushManager.getSubscription();
if (existing) {
  const currentKey = existing.options?.applicationServerKey;
  if (!currentKey || !sameKey(currentKey, serverKeyBytes)) {
    await existing.unsubscribe();          // MUST happen before re-subscribe
  }
}
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: serverKeyBytes,
});
```

**And the server must expose the current public key at a stable endpoint** (`GET /api/v1/push/vapid-public-key`) so the client can compare and heal, and must **persist the private key across restarts** in a bind-mounted file or the database, generating it exactly once on first boot.

### Other `subscribe()` rejections worth handling

From the Push API spec:

- `NotAllowedError` if the service worker scope is not `https:`.
- `NotAllowedError` if `userVisibleOnly` is `false` and the user agent requires it to be `true` (Chrome does).
- `NotAllowedError` if `applicationServerKey` is `null` and the push service requires it to be non-null.
- `InvalidStateError` if the registration has no active worker.

## 1.5 The `PushSubscription` shape, exactly

Current W3C Push API IDL:

```webidl
[Exposed=(Window,Worker), SecureContext]
interface PushSubscription {
  readonly attribute USVString endpoint;
  readonly attribute EpochTimeStamp? expirationTime;
  [SameObject] readonly attribute PushSubscriptionOptions options;
  ArrayBuffer? getKey(PushEncryptionKeyName name);
  Promise<boolean> unsubscribe();
  PushSubscriptionJSON toJSON();
};

dictionary PushSubscriptionJSON {
  USVString endpoint;
  EpochTimeStamp? expirationTime = null;
  record<DOMString, USVString> keys;
};

[Exposed=(Window,Worker), SecureContext]
interface PushSubscriptionOptions {
  readonly attribute boolean userVisibleOnly;
  [SameObject] readonly attribute ArrayBuffer? applicationServerKey;
};
```

`getKey()` accepts exactly `"p256dh"` or `"auth"`. `toJSON()` produces the three-field object with `keys.p256dh` and `keys.auth` as base64url strings — this is precisely the JSON blob that `web-push` accepts as its first argument, so the correct client code is simply:

```ts
await fetch('/api/v1/push/subscriptions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    subscription: sub.toJSON(),
    device_label: navigator.userAgent.slice(0, 120),
    locale: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }),
});
```

`expirationTime` is *"the time, in milliseconds since 00:00:00 UTC on 1 January 1970, at which the subscription will be deactivated"*; the user agent *"SHOULD attempt to refresh the push subscription before the subscription expires"*. In practice it is `null` on all browsers Fem-ho targets, but store it — if it is ever non-null you can pre-emptively stop sending.

`applicationServerKey` *"MUST include a point on the P-256 elliptic curve, encoded in the uncompressed form"* — 65 bytes starting `0x04`.

> Note: MDN's `PushSubscription` page currently also lists a `subscriptionId` property. It is **not** in the spec IDL fetched from `w3c.github.io/push-api`. Do not use it.

## 1.6 `pushsubscriptionchange` — the self-healing event

The spec: this event *"indicates a change in a push subscription that was triggered outside of the application's control, for example because it has been refreshed, revoked or lost."* It carries `oldSubscription` (*"SHOULD NOT be used anymore"*) and `newSubscription` (*"the currently valid subscription"*, `null` if none was established).

Browser support (MDN browser-compat-data, `ServiceWorkerGlobalScope.pushsubscriptionchange_event`):

| Browser | Support |
|---|---|
| Chrome / Edge | **138** |
| Chrome Android | mirrors Chrome (138) |
| Firefox | 44, **partial** — *"The event does not have the `oldSubscription` and `newSubscription` properties"* (bugzilla 1497429) |
| Safari (macOS) | 16 |
| **Safari iOS** | **not supported** |

So the event is unavailable exactly where you would most want it (iOS) and incomplete on Firefox. **Do not rely on it as the only healing path.** The reliable pattern is a *reconciliation on every app open*: on each load of the web app, read `getSubscription()`, compare the endpoint to what the server has for this device, and POST an update if they differ. Implement `pushsubscriptionchange` as an opportunistic extra:

```js
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const applicationServerKey = await getStoredServerKey();     // from IndexedDB
    const newSub = event.newSubscription
      ?? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    await fetch('/api/v1/push/subscriptions/rotate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        old_endpoint: event.oldSubscription?.endpoint ?? null,
        subscription: newSub.toJSON(),
      }),
    });
  })());
});
```

The service worker has no access to the auth token in memory, so `/rotate` must be authenticated by a **device-scoped rotation secret** stored in IndexedDB at subscribe time, or by a cookie. Do not make it unauthenticated: `old_endpoint` is guessable-adjacent and an open rotate endpoint lets an attacker redirect another user's notifications.

## 1.7 `web-push` (npm) — version, API, maintenance status

Fetched from the npm registry and the GitHub repository on 2026-08-05.

| Fact | Value |
|---|---|
| Package | `web-push` |
| **Latest published version** | **3.6.7** |
| **Published** | **2024-01-16** |
| License (published) | **MPL-2.0** |
| `engines.node` | `>= 16` |
| Dependencies (3.6.7) | `asn1.js ^5.3.0`, `http_ece 1.2.0`, `https-proxy-agent ^7.0.0`, `jws ^4.0.0`, `minimist ^1.2.5` |
| Module format (3.6.7) | CommonJS (`main: src/index.js`, no `exports`, no `type`) |
| Bundled types | none — use `@types/web-push` **3.6.4** (published 2024-10-22) |
| CLI | yes, `bin: { "web-push": "src/cli.js" }` |
| Repo | `github.com/web-push-libs/web-push`, 3533 stars, **not archived** |
| Last commit to `master` | **2026-08-03** |
| Open issues | 42 |
| Latest tagged GitHub release | `v3.6.5`, 2023-08-29 (tagging has lapsed; npm is ahead of tags) |

**Maintenance verdict: the repository is alive; the release train is not.** `master` has recent commits (CI additions, dependency bumps: `http_ece 1.2.1`, `https-proxy-agent ^9.1.0`, `jws ^4.0.1`) and — importantly — `master`'s `package.json` now declares `"type": "module"`, i.e. an **unreleased ESM migration**. The published 3.6.7 is still CJS. For a TypeScript ESM backend this matters: as of today you must import `web-push` through CJS interop (`import webpush from 'web-push'` with `esModuleInterop`), and you should expect a future major to change that. Pin the version and read the changelog before upgrading.

### The API, from source

`src/web-push-lib.js` (master) confirms the defaults:

```js
const DEFAULT_TTL = 2419200;                                   // four weeks
let contentEncoding = webPushConstants.supportedContentEncodings.AES_128_GCM;   // 'aes128gcm'
let urgency = webPushConstants.supportedUrgency.NORMAL;        // 'normal'
```

Accepted `sendNotification` options: `TTL`, `contentEncoding`, `urgency`, `topic`, `vapidDetails`, `headers`, `proxy`, `agent`, `timeout`. `topic` is validated as URL-safe base64 and rejected above 32 characters — matching RFC 8030. `urgency` is validated against the four RFC values. `Urgency` is always set on the request; `Topic` only when provided.

`src/vapid-helper.js`:

```js
const DEFAULT_EXPIRATION_SECONDS = 12 * 60 * 60;   // 12 hours
const MAX_EXPIRATION_SECONDS     = 24 * 60 * 60;   // RFC 8292 ceiling, enforced
// aes128gcm path:
Authorization: 'vapid t=' + jwt + ', k=' + publicKey
// legacy aesgcm path:
Authorization: 'WebPush ' + jwt
'Crypto-Key':  'p256ecdsa=' + publicKey
```

`src/web-push-error.js` — the exact error shape you must branch on:

```js
export class WebPushError extends Error {
  constructor(message, statusCode, headers, body, endpoint) {
    super(message);
    this.name = 'WebPushError';
    this.statusCode = statusCode;
    this.headers = headers;
    this.body = body;
    this.endpoint = endpoint;     // ← the endpoint is on the error; use it to prune
  }
}
```

`this.endpoint` on the error object is the single most useful field for the dispatcher: on 404/410 you can delete by endpoint without threading the subscription through your promise chain.

Top-level functions: `generateVAPIDKeys()` → `{ publicKey, privateKey }` as URL-safe base64 strings (README: *"You should create these keys once, store them and use them for all future messages."*), `setVapidDetails(subject, publicKey, privateKey)`, `sendNotification(subscription, payload, options)`, plus `setGCMAPIKey()` (legacy, do not use) and `generateRequestDetails()` (build the request without sending — useful in tests).

### Alternatives

| Package | Latest | Published | License | Notes |
|---|---|---|---|---|
| `webpush-webcrypto` | **1.0.5** | 2025-04-22 | MIT | *"A JS module for sending Web Push notifications, works in both browser and server environments"*; single dependency: the WebCrypto API; explicitly drops `web-push`'s legacy GCM support. In Node you call `setWebCrypto` with `node:crypto`'s `webcrypto`. |
| `@block65/webcrypto-web-push` | **1.0.2** | 2024-12-15 | MIT | *"Send notifications using Web Push Protocol and Web Crypto APIs (works with NodeJS, Cloudflare Workers, Bun and Deno)"*; zero dependency. |

**Recommendation for Fem-ho: use `web-push@3.6.7` + `@types/web-push@3.6.4`.** It is the reference implementation, it is what every self-hosted project uses, the encryption is battle-tested against all four push services, and it exposes `endpoint` on errors. The WebCrypto alternatives are attractive for edge runtimes Fem-ho does not target; keep `webpush-webcrypto` on the shortlist only if the ESM situation becomes painful.

## 1.8 Worked Node/TypeScript example

A complete, production-shaped dispatcher fragment. Assumes Postgres via a `db` object and the schema from §6.1.

```ts
// src/notify/webpush.ts
import webpush, { type PushSubscription, WebPushError } from 'web-push';
import { db } from '../db.js';
import { logger } from '../log.js';

export type PushKind = 'webpush' | 'unifiedpush';

let configured = false;

/** Called once at boot, after the VAPID key pair has been loaded or created. */
export function configureWebPush(opts: {
  subject: string;      // 'mailto:admin@example.org' or 'https://femho.example.org'
  publicKey: string;    // base64url
  privateKey: string;   // base64url
}) {
  webpush.setVapidDetails(opts.subject, opts.publicKey, opts.privateKey);
  configured = true;
}

/** Generate exactly once, then persist. Never regenerate on restart. */
export function generateKeys() {
  return webpush.generateVAPIDKeys(); // { publicKey, privateKey }
}

export interface PushEnvelope {
  v: 1;
  k: 'rem' | 'assign' | 'due' | 'comment' | 'ai';
  t: string;            // task or event ULID
  s?: string;           // scope slug
  ti: string;           // title (already localised, already truncated)
  b?: string;           // body
  u: string;            // relative deep link, e.g. '/t/01J8Z...'
  g: string;            // grouping/tag key, e.g. 'rem:01J8Z...'
}

export interface SendResult {
  ok: boolean;
  prune: boolean;       // delete the subscription row
  retryAfterMs: number | null;
  permanent: boolean;   // never retry this exact request
  statusCode?: number;
}

const MAX_PAYLOAD_BYTES = 3900; // stay under the 3993-octet plaintext ceiling

export async function sendPush(
  sub: { id: string; endpoint: string; p256dh: string; auth: string },
  envelope: PushEnvelope,
  opts: { ttlSeconds: number; urgency: 'very-low' | 'low' | 'normal' | 'high'; topic?: string },
): Promise<SendResult> {
  if (!configured) throw new Error('web-push not configured');

  const payload = JSON.stringify(envelope);
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    // Fail closed rather than eat a 413: truncate the title/body upstream instead.
    logger.error({ subId: sub.id, bytes: Buffer.byteLength(payload) }, 'push payload too large');
    return { ok: false, prune: false, retryAfterMs: null, permanent: true };
  }

  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  };

  try {
    await webpush.sendNotification(subscription, payload, {
      TTL: opts.ttlSeconds,
      urgency: opts.urgency,
      ...(opts.topic ? { topic: opts.topic } : {}),
      contentEncoding: 'aes128gcm',
    });
    return { ok: true, prune: false, retryAfterMs: null, permanent: false };
  } catch (err) {
    if (err instanceof WebPushError || (err as any)?.name === 'WebPushError') {
      const e = err as WebPushError;
      const status = e.statusCode;

      // Dead subscription — RFC 8030 §7.3 / §7.4
      if (status === 404 || status === 410) {
        return { ok: false, prune: true, retryAfterMs: null, permanent: true, statusCode: status };
      }
      // Our bug, or a stale VAPID key. Never retry; alert the operator.
      if (status === 400 || status === 401 || status === 403 || status === 413) {
        logger.error({ endpoint: redact(e.endpoint), status, body: e.body }, 'permanent push failure');
        return { ok: false, prune: false, retryAfterMs: null, permanent: true, statusCode: status };
      }
      // Rate limited — honour Retry-After (seconds or HTTP-date)
      if (status === 429) {
        return {
          ok: false, prune: false, permanent: false, statusCode: 429,
          retryAfterMs: parseRetryAfter(e.headers?.['retry-after']) ?? 60_000,
        };
      }
      // 5xx and anything else: transient
      return { ok: false, prune: false, permanent: false, retryAfterMs: null, statusCode: status };
    }
    // Socket/DNS/TLS error
    return { ok: false, prune: false, permanent: false, retryAfterMs: null };
  }
}

function parseRetryAfter(v?: string | string[]): number | null {
  if (!v) return null;
  const s = Array.isArray(v) ? v[0] : v;
  const n = Number(s);
  if (Number.isFinite(n)) return Math.max(0, n) * 1000;
  const d = Date.parse(s);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
}

/** Never log a full endpoint: it is a bearer capability. */
function redact(endpoint?: string): string {
  if (!endpoint) return '';
  try {
    const u = new URL(endpoint);
    return `${u.origin}/…${endpoint.slice(-6)}`;
  } catch { return '…'; }
}
```

Key-loading at boot, showing the persistence requirement:

```ts
// src/notify/vapid-store.ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import webpush from 'web-push';

const KEY_PATH = process.env.FEMHO_VAPID_FILE ?? '/data/vapid.json';

export async function loadOrCreateVapid(subject: string) {
  // 1. Explicit env wins — lets the operator move keys between hosts.
  if (process.env.FEMHO_VAPID_PUBLIC_KEY && process.env.FEMHO_VAPID_PRIVATE_KEY) {
    return {
      subject,
      publicKey: process.env.FEMHO_VAPID_PUBLIC_KEY,
      privateKey: process.env.FEMHO_VAPID_PRIVATE_KEY,
      source: 'env' as const,
    };
  }
  // 2. Persisted file on a mounted volume.
  try {
    const raw = JSON.parse(await readFile(KEY_PATH, 'utf8'));
    if (raw.publicKey && raw.privateKey) return { subject, ...raw, source: 'file' as const };
  } catch { /* not yet created */ }

  // 3. First boot only.
  const keys = webpush.generateVAPIDKeys();
  await mkdir(dirname(KEY_PATH), { recursive: true });
  await writeFile(KEY_PATH, JSON.stringify(keys, null, 2), { mode: 0o600 });
  return { subject, ...keys, source: 'generated' as const };
}
```

**And a startup guard the operator will thank you for:** if `source === 'generated'` *and* the `push_subscriptions` table is non-empty, log a `FATAL`-level warning — this is the "someone lost the volume" signature, and every existing subscription is now dead.

---

# PART 2 — Browser and platform reality, August 2026

## 2.1 The support matrix

Source: caniuse `push-api` and `notifications` feature JSON, plus MDN browser-compat-data, both fetched 2026-08-05. Dataset "current version" baselines: Chrome 150, Edge 150, Firefox 152, Safari 26.4, iOS Safari 26.4, Chrome Android 150, Samsung Internet 30.

| Platform | Push API | First supported | Critical caveat |
|---|---|---|---|
| **Chrome desktop** (Win/mac/Linux) | yes | 44 (partial), full later | caniuse note #2: **"Requires full browser to be running to receive messages"** |
| **Edge desktop** | yes | 17 | same note #2 |
| **Firefox desktop** | yes | 44 | note #2; also note #4: *"Disabled on Firefox ESR, but can be re-enabled with the `dom.serviceWorkers.enabled` and `dom.push.enabled` flags"* |
| **Chrome Android** | yes | — (row shows `y` at current) | works with browser closed (Android system push) |
| **Firefox Android** | yes | 152 | |
| **Samsung Internet** | yes | 4 | **`notifications` row is `n` with note #1: *"Supports notifications via the Push API but not the Web Notifications API."*** i.e. use `registration.showNotification()`, never `new Notification()` |
| **Opera Mobile** | yes | 80 | |
| **Safari macOS** | yes | 16.1 partial → **18.0 full** | note #5: *"Only available on macOS 13 Ventura or later"*; note #6: *"Supported in Safari, not WKWebView nor SFSafariViewController"* |
| **Safari iOS/iPadOS** | **partial at every version 16.4 → 26.5** | 16.4 | note #7: **"Requires website to first be added to the Home Screen."** |

Two further facts from the caniuse Safari row worth recording:

- Note #3 — *"Safari 7.0 - 26.3 supported Safari Push Notifications"* — and that note **disappears from Safari 26.4 onward**. The proprietary, APNs-certificate-based *Safari Push Notifications* API (the pre-standard `safari.pushNotification` mechanism that required an Apple Developer account and a signed push package) is gone as of Safari 26.4. Standard Web Push is now the only path on Apple platforms. Fem-ho never needed the legacy path; this simply removes a temptation.
- Note #6 persists: **Web Push does not work inside `WKWebView` or `SFSafariViewController`.** If anyone ever wraps the Fem-ho web app in a thin iOS shell, push will not work there. On iOS the only options are a Home Screen web app or a real native app.

### Service worker itself

`serviceworkers` is `y` everywhere current, including iOS Safari 26.x. But note #4 on that feature: **"Not supported in Private Browsing mode"** (Firefox bug 1320796). A family member browsing Fem-ho in a private window gets no service worker, hence no push, hence no offline shell.

## 2.2 iOS and iPadOS — the exact conditions

From WebKit's own announcement post *Web Push for Web Apps on iOS and iPadOS* and confirmed against caniuse:

| Condition | Status |
|---|---|
| Minimum OS | **iOS 16.4 / iPadOS 16.4** |
| Must the site be installed? | **Yes.** Web Push is available only for *"Home Screen web apps"* — a site added to the Home Screen *"with a manifest file setting `display` to `standalone` or `fullscreen`"* |
| Works in a Safari tab? | **No.** *"The feature applies exclusively to Home Screen-installed web apps, not browsing within Safari itself."* |
| User gesture for permission? | **Yes.** Permission requests must occur *"in response to direct user interaction — such as tapping on a 'subscribe' button."* |
| Badging | **Yes**, `setAppBadge`/`clearAppBadge` work *"while the app is in the foreground or handling push events in the background"* |
| Where notifications show | *"on the Lock Screen, in Notification Center, and on a paired Apple Watch"* |
| Per-app settings / Focus | **Yes** — users *"manage those permissions per web app in Notifications Settings"*, and they integrate with Focus modes |

### What silently fails, and how to detect it

This is the part an AI will get wrong. On iOS Safari **in a tab**:

- `'serviceWorker' in navigator` → **true**
- `'Notification' in window` → **true** (the constructor exists)
- `'PushManager' in window` → **false**
- `registration.pushManager` → **undefined**

So a feature-detect written as `if ('Notification' in window)` will pass and then throw or no-op. The correct detection ladder, in order:

```ts
export type PushCapability =
  | { kind: 'ok' }
  | { kind: 'insecure-context' }
  | { kind: 'no-service-worker' }
  | { kind: 'ios-needs-install' }        // ← the one everybody misses
  | { kind: 'unsupported' }
  | { kind: 'denied' };

export function detectPushCapability(): PushCapability {
  if (!window.isSecureContext) return { kind: 'insecure-context' };
  if (!('serviceWorker' in navigator)) return { kind: 'no-service-worker' };

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // Apple's non-standard flag, still the only reliable signal on iOS
    (navigator as any).standalone === true;

  if (!('PushManager' in window)) {
    // iOS Safari in a tab: SW yes, Notification yes, PushManager no.
    const isIOS = /iP(hone|ad|od)/.test(navigator.platform) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return isIOS && !isStandalone ? { kind: 'ios-needs-install' } : { kind: 'unsupported' };
  }
  if (Notification.permission === 'denied') return { kind: 'denied' };
  return { kind: 'ok' };
}
```

`ios-needs-install` must map to a **specific Catalan instruction sheet**, not a generic "your browser doesn't support notifications":

> **Per rebre recordatoris a l'iPhone**
> Safari a l'iPhone només envia notificacions si afegeixes Fem-ho a la pantalla d'inici.
> 1. Toca **Comparteix** (el quadre amb la fletxa) a la barra inferior.
> 2. Tria **Afegeix a la pantalla d'inici**.
> 3. Obre Fem-ho des de la icona nova i torna a activar els recordatoris.

There is **no** `beforeinstallprompt` on iOS and no programmatic install. The manifest must set `display: "standalone"` (or `fullscreen`) or the installed app will not qualify.

### Storage eviction

Apple's post does not state a limit on the number of installed web apps or an eviction policy. What matters operationally: if iOS evicts the web app's storage, the service worker registration and the push subscription go with it, and the user must re-grant. This is one more reason the **reconciliation-on-open** pattern (§1.6) is mandatory rather than optional.

## 2.3 Declarative Web Push — what it changes and what it does not

Shipped in **iOS 18.4 / iPadOS 18.4** (WebKit: *"now available on iOS and iPadOS 18.4 for web apps added to the Home Screen"*) and **macOS 15.5**. It is now in the W3C Push API specification proper, not a WebKit-only extension.

### The payload

Instead of an opaque encrypted blob your service worker must decode, you send a JSON document the user agent itself parses:

```json
{
  "web_push": 8030,
  "notification": {
    "title": "Ada emailed 'London'",
    "lang": "en-US",
    "dir": "ltr",
    "body": "Did you hear about the tube strikes?",
    "navigate": "https://email.example/message/12"
  }
}
```

Members, from the spec's *declarative push message parser*:

| Member | Required | Type |
|---|---|---|
| `web_push` | **required** | integer, **must be `8030`** — *"Used to disambiguate a declarative push message from other JSON documents"* |
| `notification` | **required** | object |
| `notification.title` | **required** | string |
| `notification.navigate` | **required** | string (URL) |
| `notification.dir` | | `"auto"` \| `"ltr"` \| `"rtl"` |
| `notification.lang` | | language tag |
| `notification.body` | | string |
| `notification.tag` | | string |
| `notification.image`, `.icon`, `.badge` | | URL strings |
| `notification.vibrate` | | array of 32-bit unsigned integers |
| `notification.timestamp` | | 64-bit unsigned integer |
| `notification.renotify`, `.silent`, `.requireInteraction` | | booleans (*"This is not named `require_interaction` for consistency with the `NotificationOptions` dictionary"*) |
| `notification.data` | | any JSON value |
| `notification.actions` | | array of `{ action (req), title (req), navigate (req), icon }` |
| `mutable` | | boolean — *"When true causes a push event to be dispatched to a service worker (if any) containing the `Notification` object described by the declarative push message"* |

The parser returns **failure** — and the message is treated as a normal opaque push — if `web_push` is absent or ≠ 8030, if `notification` is missing or not a map, or if `title` or `navigate` are missing or not strings.

### Why it exists and how it degrades

WebKit: it *"allows web developers to request a Web Push subscription and display user visible notifications **without requiring an installed service worker**"*, and it is *"more energy efficient … more private and easier for developers to implement."* If a service worker **is** installed, *"a push event is dispatched to it like before"* with the proposed notification, so you may replace or enrich it; and if your service worker fails to show a replacement, *"the fallback is used"* — the declarative notification displays anyway.

The spec adds the resilience argument: *"the declarative nature of the push message serves as a backup in case the service worker was evicted due to storage pressure."*

### What it does **not** change

- **It does not remove the Add-to-Home-Screen requirement on iOS.** The Safari 18.4 notes say it is available *"for web apps added to the Home Screen"*. caniuse still marks every iOS Safari version through 26.5 as partial with note #7.
- **It does not change the transport.** It is still RFC 8030 delivery of an RFC 8291-encrypted body with RFC 8292 VAPID. The encryption is identical; only the plaintext is now a structured JSON document the UA understands.
- **It is not universally supported.** Chrome and Firefox have not been confirmed shipping it in the sources fetched here.

### Recommendation for Fem-ho

**Send a payload that is simultaneously a valid declarative push message and a usable input to your own service worker handler.** This is free: put your compact fields inside `notification.data` and fill the declarative fields with the already-localised strings.

```ts
function buildPushBody(env: PushEnvelope, origin: string) {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: env.ti,                       // 'Comprar pa'
      body: env.b ?? '',                   // 'Venç a les 18:00 · Família'
      lang: 'ca',
      dir: 'ltr',
      navigate: `${origin}${env.u}`,       // absolute URL, required
      tag: env.g,                          // 'rem:01J8Z…'
      icon: `${origin}/icons/icon-192.png`,
      badge: `${origin}/icons/badge-96.png`,
      requireInteraction: env.k === 'rem',
      mutable: true,                       // let our SW enrich on browsers that run it
      data: env,                           // our compact envelope survives intact
    },
  });
}
```

On iOS with no live service worker: the OS renders it directly and tapping navigates to `navigate`. On Chrome/Firefox: your `push` handler reads `event.data.json().notification.data` and does the richer thing (merge counts, set the badge, add actions). One payload, both worlds. Watch the 3993-byte ceiling — absolute URLs and icon paths cost more than the compact form, so keep titles truncated server-side.

> **Caveat recorded honestly:** the WebKit blog describes an `app_badge` member on the notification object. The W3C Push API editor's draft fetched on 2026-08-05 lists `badge` (an *icon URL*, inherited from `NotificationOptions`) but contains **zero** occurrences of `app_badge`. Treat `app_badge` as WebKit-specific and possibly renamed; do not depend on it. Set the app badge from the service worker with `setAppBadge()` instead (§2.5).

## 2.4 Notification Triggers / scheduled local notifications — **never shipped, abandoned**

This is the single most important negative result in this dossier, because it is the API an AI would most plausibly invent.

The proposal was `showTrigger` on `NotificationOptions` with a `TimestampTrigger`, letting a page schedule a local notification for a future time that would fire *even offline*. From Chrome Platform Status feature 5133150283890688, fetched 2026-08-05:

- Summary: *"Adds the showTrigger property to the Notification interface to enable showing a notification at a specific time in the future, even if the device is offline. Websites can use this to schedule notifications without using push messages."*
- Status: **`"In developer trial (Behind a flag)"`**, `flag: true`, `origintrial: false`
- Standards maturity: *"Specification being incubated in a Community Group"*, `spec: null`
- Firefox signal: **"No signal"**. Safari signal: **"No signal"**.
- Last updated: **2022-09-13**

And Chrome's own documentation page carries a termination banner:

> *"The development of Notification Triggers API, part of Google's capabilities project, has ended. It wasn't clear that we could provide consistent and reliable experiences across platforms."*

The specification-draft and launch phases are marked "Not started"; only the explainer and origin trial were ever completed.

**Consequences for Fem-ho, stated bluntly:**

1. **There is no way to schedule a local notification from the web platform.** Not with `showTrigger`, not with the Notifications API, not with Alarms (that is an extension API, not a web API).
2. `setTimeout` in a page dies with the tab. `setTimeout` in a service worker dies when the worker is terminated — which the browser does aggressively, typically within seconds of idle.
3. **Periodic Background Sync** exists in Chromium only, requires the site to be installed, and the browser decides the interval — it can be hours. It is not a reminder mechanism.
4. **Therefore every web reminder in Fem-ho must be dispatched by the server.** The `reminder.dispatch` job in dossier 08 §8.3 is not an implementation choice; it is the only possible design. The offline-first Android client can and should schedule locally (`AlarmManager`/`WorkManager`, dossier 06), but the web cannot, and this asymmetry must be visible in the UI (§6.4).
5. Corollary: **if the server is down at the moment a reminder is due, the web user gets nothing, ever** — unless the dispatcher has catch-up logic (§6.3).

## 2.5 Badging API — the Inbox count on the installed icon

API surface (MDN):

```js
navigator.setAppBadge(12);   // numeric badge
navigator.setAppBadge();     // flag/dot, no number
navigator.clearAppBadge();   // clear
navigator.setAppBadge(0);    // also clears
```

Available in workers via `WorkerNavigator.setAppBadge()` / `WorkerNavigator.clearAppBadge()` — **so the service worker can update the badge from inside the `push` handler**, which is exactly what Fem-ho needs for an Inbox count. Secure context required. Large numbers may be rendered as "99+".

MDN marks the feature **"not Baseline … it does not work in some of the most widely-used browsers."** The compat data (MDN BCD, `api/Navigator.json`, fetched 2026-08-05):

| Browser | `setAppBadge` | `clearAppBadge` | Notes |
|---|---|---|---|
| Chrome desktop | **81** | 81 | *"Windows and macOS since Chrome 81. ChromeOS since Chrome 91. **Linux offers no universal badging API on the operating system level**."* |
| Edge | mirrors Chrome | mirrors Chrome | |
| **Chrome Android** | **false** | 81 | asymmetric in BCD — see below |
| Firefox / Firefox Android | **false** | **false** | |
| Opera | **false** | **false** | |
| **Safari macOS** | **17** | 17 | *"Badging is supported for installed web apps on macOS Sonoma and higher."* Passing `0` clears rather than showing a dot. |
| **Safari iOS/iPadOS** | **16.4** | 16.4 | *"Badging is supported for web apps saved to the home screen."* Passing `0` clears. |

So the honest picture:

- **iOS installed PWA: works, and is the single best delivery affordance Fem-ho has on iPhone** — a red count on the Home Screen icon is genuinely useful even when a push is missed.
- **macOS installed web app (Safari 17+ / Sonoma+): works.**
- **Desktop Chrome/Edge on Windows and macOS: works** (taskbar/dock). **Linux: no OS-level badging** — and a self-hosted family will often be on Linux desktops.
- **Firefox: nothing, anywhere.**
- **Chrome Android: BCD records `setAppBadge` as unsupported while `clearAppBadge` is `81`.** That asymmetry is almost certainly a data artefact, but the safe engineering read is: **do not rely on badging on Android Chrome.** The native Kotlin app owns Android anyway.

**Implementation rule: badging is decorative. Always guard it, never let it throw into your push handler.**

```js
async function updateBadge(count) {
  try {
    if ('setAppBadge' in self.navigator) {
      count > 0 ? await self.navigator.setAppBadge(count)
                : await self.navigator.clearAppBadge();
    }
  } catch { /* Linux, Firefox, permission quirks — badging must never break a reminder */ }
}
```

Where does the count come from? The push envelope should carry it so the service worker does not need a network round-trip while offline: add an optional `ic` (inbox count) field to `PushEnvelope`, computed by the dispatcher as "open items in this user's Inbox column across all scopes". On app open, the page recomputes and calls `setAppBadge` again to correct drift.

## 2.6 Notification option support — what actually renders

MDN BCD for `Notification` members, fetched 2026-08-05. This determines what your `showNotification()` call can rely on.

| Option | Chrome | Firefox | Safari (macOS) | Safari iOS |
|---|---|---|---|---|
| `tag` | 20 (Android 42) | 26 | **false** — *"The property can be set, but has no effect"* (WebKit bug 258922) | **false** |
| `actions` | 53 | **152** | **false** | **false** |
| `renotify` | 50 | false | false | false |
| `requireInteraction` | 47 | 117 **partial** — *"Only supported on Windows. Behind a flag on other operating systems."* | false | false |
| `image` | 56 | false | false | false |
| `vibrate` | 53 | false | false | false |
| `silent` | 43 | 132 | 16.6 | **false** |
| `data` | universal | universal | universal | universal |
| `body`, `icon`, `badge` | universal | universal | universal | universal |

**Read this table as a design brief:**

- **Action buttons ("Fet", "Ajorna 10 min") work on Chrome/Edge and now Firefox 152, and nowhere on Apple.** Design the notification so it is complete without buttons; treat actions as progressive enhancement. On Apple the tap target is the whole notification → `navigate`/`notificationclick` must land somewhere immediately useful.
- **`tag` coalescing does not work on Safari at all.** Sending three updates about the same task produces three notifications on macOS and iOS. Server-side `Topic` (§1.2) partially compensates by replacing *undelivered* messages, but once delivered, Safari will stack them. The mitigation is to send fewer, better messages to Apple endpoints — see the per-endpoint policy in §6.3.
- **`renotify`, `image`, `vibrate`, `requireInteraction` are effectively Chrome-only.** Use them, but never build meaning on them.
- Firefox 152 gaining `actions` is recent enough that you must feature-detect rather than assume: `if (Notification.prototype && 'actions' in Notification.prototype)` — or more robustly, read `Notification.maxActions` and only attach up to that many.

---

# PART 3 — Service worker handling

## 3.1 The `push` handler

Support (MDN BCD, `ServiceWorkerGlobalScope.push_event`): Chrome 40, Firefox 44, Safari macOS 16 (*"Notifications are supported on macOS Ventura and later"*), Safari iOS 16.4 (*"Notifications are supported in web apps saved to the home screen"*).

Two rules govern the handler:

1. **Everything asynchronous must be inside `event.waitUntil()`.** The browser terminates the service worker as soon as the event settles; a floating promise is a dropped notification.
2. **You must show a user-visible notification.** Chrome's documented fallback when you do not: it displays *"This site has been updated in the background"* itself. Combined with `userVisibleOnly: true` (which Chrome requires at subscribe time — the Push API spec rejects with `NotAllowedError` if the UA requires it and you pass `false`), there is no silent-push escape hatch.

A complete handler for Fem-ho, written to consume the dual-format payload from §2.3:

```js
// src/sw/push.js  — imported by the custom service worker
const DEFAULT_ICON  = '/icons/icon-192.png';
const DEFAULT_BADGE = '/icons/badge-96.png';

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  let msg = null;
  try {
    msg = event.data ? event.data.json() : null;
  } catch {
    msg = null;                      // malformed or non-JSON payload
  }

  // Accept both the declarative envelope and a bare envelope.
  const decl = msg && msg.web_push === 8030 ? msg.notification : null;
  const env  = decl?.data ?? msg ?? null;

  if (!env) {
    // A push with no usable payload still MUST produce a notification.
    await self.registration.showNotification('Fem-ho', {
      body: 'Tens novetats.',
      icon: DEFAULT_ICON,
      badge: DEFAULT_BADGE,
      tag: 'femho-generic',
      data: { url: '/' },
    });
    return;
  }

  const tag   = env.g ?? `femho:${env.k ?? 'x'}:${env.t ?? 'x'}`;
  const title = decl?.title ?? env.ti ?? 'Fem-ho';
  const body  = decl?.body  ?? env.b  ?? '';

  // --- coalescing: merge with an existing notification carrying the same tag
  const existing = await self.registration.getNotifications({ tag });
  const merged = existing.length > 0
    ? { title, body: `${body}\n(${existing.length + 1} actualitzacions)` }
    : { title, body };

  const options = {
    body: merged.body,
    icon: decl?.icon ?? DEFAULT_ICON,
    badge: decl?.badge ?? DEFAULT_BADGE,
    tag,
    lang: 'ca',
    dir: 'ltr',
    timestamp: Date.now(),
    data: {
      url: env.u ?? '/',
      taskId: env.t ?? null,
      kind: env.k ?? null,
      scope: env.s ?? null,
      // used by notificationclick to POST the action back
      actionToken: env.at ?? null,
    },
  };

  // renotify REQUIRES tag; MDN: TypeError if renotify:true and tag is ''
  if (existing.length > 0 && tag) options.renotify = true;

  // requireInteraction only makes sense for a due reminder, Chrome-only in practice
  if (env.k === 'rem') options.requireInteraction = true;

  // Action buttons: feature-detect. Absent on all Apple platforms.
  const maxActions = self.Notification?.maxActions ?? 0;
  if (maxActions > 0 && env.k === 'rem' && env.t) {
    options.actions = [
      { action: 'done',   title: 'Fet' },
      { action: 'snooze', title: 'Ajorna 10 min' },
    ].slice(0, maxActions);
  }

  await self.registration.showNotification(title, options);

  // Badge is decorative; never let it break delivery.
  if (typeof env.ic === 'number') {
    try {
      if ('setAppBadge' in self.navigator) {
        env.ic > 0 ? await self.navigator.setAppBadge(env.ic)
                   : await self.navigator.clearAppBadge();
      }
    } catch { /* Linux desktop, Firefox, etc. */ }
  }
}
```

Note the deliberate choices:

- `getNotifications({ tag })` is the documented merge primitive; web.dev's notification-patterns guidance uses `registration.getNotifications()` and then inspects `notifications[i].data` to find the one to update. Here the tag does the filtering.
- `renotify: true` is only set when `tag` is non-empty, because MDN documents that `showNotification` **throws `TypeError` when `renotify: true` but `tag` is an empty string**.
- `silent` and `vibrate` are never both set — MDN: `TypeError` if `silent: true` and `vibrate` are specified together.
- `lang: 'ca'` is set explicitly because the UI is Catalan and the OS may otherwise pick host language for TTS/VoiceOver.

## 3.2 The `notificationclick` handler

Support: Chrome 40, Firefox 44, Safari macOS 16. MDN BCD records **`safari_ios: false`** for `notificationclick_event`, `notificationclose_event` and `pushsubscriptionchange_event`. I flag this as a probable BCD gap rather than a confirmed platform limitation (see `## UNVERIFIED`) — but the engineering response is the same either way: **on Apple, make the `navigate` URL do the work**, so that a tap lands correctly even if your JS handler never runs. Declarative Web Push's required `navigate` member exists precisely for this.

```js
self.addEventListener('notificationclick', (event) => {
  const { url = '/', taskId, actionToken } = event.notification.data ?? {};
  event.notification.close();

  event.waitUntil((async () => {
    // Action buttons (Chrome/Edge/Firefox 152+)
    if (event.action === 'done' && taskId) {
      await fetch('/api/v1/notifications/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'complete', task_id: taskId, token: actionToken }),
      }).catch(() => queueForBackgroundSync({ action: 'complete', taskId, actionToken }));
      return;
    }
    if (event.action === 'snooze' && taskId) {
      await fetch('/api/v1/notifications/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'snooze', minutes: 10, task_id: taskId, token: actionToken }),
      }).catch(() => queueForBackgroundSync({ action: 'snooze', taskId, actionToken }));
      return;
    }

    // Body tap: focus an existing window if one is on the right page, else open.
    const target = new URL(url, self.location.origin);
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      const wUrl = new URL(w.url);
      if (wUrl.origin === target.origin) {
        await w.focus();
        if (wUrl.pathname !== target.pathname && 'navigate' in w) {
          await w.navigate(target.href).catch(() => {});
        }
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
```

This is the pattern web.dev documents: `clients.matchAll()` to check whether a page is already open, `focus()` it rather than creating duplicates, and `clients.openWindow()` otherwise. The refinement here — focus **then** `navigate()` — matters for Fem-ho because a family member usually has the app open on the Calendar view when a task reminder arrives; focusing without navigating drops them on the wrong screen.

**The `actionToken` is load-bearing for security.** The service worker has no access to the app's in-memory access token. Options, in order of preference:

1. **Cookie-based session** for the web app, `SameSite=Lax`, so `fetch` from the SW carries it. Simplest and correct for a first-party PWA.
2. **A single-use, short-TTL action token minted by the dispatcher** and embedded in the push payload, scoped to exactly one task and one verb. This is the belt-and-braces option and it composes with dossier 09's sharing/security model: the token is worthless for anything but "complete task X" and expires with the reminder window.

Do **not** put a long-lived API token in a push payload. It transits the push service (which cannot read it, thanks to RFC 8291) but it lands in the notification's `data`, which persists in the notification centre.

Also register `notificationclose` if you want dismissal analytics — but for a family app, do not; it is one more thing to audit.

## 3.3 Coalescing strategy: `Topic` vs `tag` vs merge

Three independent mechanisms, at three different layers. Fem-ho should use all three deliberately.

| Layer | Mechanism | Scope | Where it fails |
|---|---|---|---|
| Push service (server → device) | RFC 8030 **`Topic` header** | replaces *undelivered* messages queued at the push service | ≤32 chars, URL/filename-safe base64 alphabet only; no effect once delivered |
| OS notification centre | **`tag` option** | replaces an already-shown notification | **no effect on Safari macOS or iOS** (BCD: *"The property can be set, but has no effect"*) |
| Application | `getNotifications({tag})` + rewrite | full control of merged text/count | requires your SW to run — not guaranteed on iOS under Declarative Web Push |

**Topic key design.** The 32-character limit rules out raw ULIDs prefixed with a kind (`rem:01J8ZQ…` is 30 chars for a 26-char ULID + `rem:` = 30, which just fits, but add a scope and it does not). Use a short, stable hash:

```ts
import { createHash } from 'node:crypto';

/** RFC 8030 Topic: <=32 chars, URL and filename-safe Base64 alphabet. */
export function topicFor(kind: string, entityId: string): string {
  return createHash('sha256')
    .update(`${kind}:${entityId}`)
    .digest('base64url')          // URL/filename-safe alphabet, no padding
    .slice(0, 24);                // comfortably under 32
}
```

Deliberately *not* including the reminder occurrence in the topic: a second reminder for the same task should replace an undelivered first one.

## 3.4 Coexisting with Workbox / vite-plugin-pwa

Dossier 07 already specifies a service worker with a Workbox precache. The integration point is narrow and worth stating exactly, because using the wrong build strategy makes it impossible to add a `push` listener at all.

- **`generateSW` writes the whole service worker for you.** You cannot add arbitrary event listeners; you can only inject a list of extra scripts via `importScripts`. This is the strategy that quietly blocks push work.
- **`injectManifest` compiles *your* service worker and injects the precache manifest into it.** This is the strategy Fem-ho must use.

`vite-plugin-pwa` configuration (exact keys, from the plugin's documentation):

```ts
// vite.config.ts
VitePWA({
  strategies: 'injectManifest',
  srcDir: 'src/sw',
  filename: 'sw.ts',
  registerType: 'prompt',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
  },
  manifest: {
    name: 'Fem-ho',
    short_name: 'Fem-ho',
    lang: 'ca',
    start_url: '/',
    scope: '/',
    display: 'standalone',        // ← REQUIRED for iOS Web Push eligibility
    theme_color: '#…',
    background_color: '#…',
    icons: [/* 192, 512, maskable */],
  },
})
```

The documentation states the custom service worker *"should have at least this code"*:

```ts
import { precacheAndRoute } from 'workbox-precaching';
precacheAndRoute(self.__WB_MANIFEST);
```

So the Fem-ho service worker becomes:

```ts
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import './push';               // the push + notificationclick listeners from §3.1/§3.2

declare const self: ServiceWorkerGlobalScope;

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(/* app-shell handler */));

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
```

Three ordering/lifecycle notes that bite in practice:

1. **Register push listeners at top level, synchronously.** A listener added inside a promise callback is not registered when the browser wakes the worker for a `push` event, and the event is lost.
2. **`display: "standalone"` in the manifest is not cosmetic.** WebKit requires a manifest with `display` set to `standalone` or `fullscreen` for a Home Screen web app to be Web-Push-eligible. If the manifest says `browser`, iOS push silently never works.
3. **A precache update must not orphan the subscription.** Workbox's `skipWaiting`/`clientsClaim` swap the active worker; the push subscription is bound to the *registration*, not the worker, so it survives. But `cleanupOutdatedCaches()` plus any IndexedDB versioning you do must **not** clear the store where you keep the `applicationServerKey` copy used by `pushsubscriptionchange` (§1.6). Keep that in its own database with its own version.

## 3.5 The permission-request UX pattern — with citations

### The research

Mozilla published the numbers when it changed Firefox's policy (blog.mozilla.org/futurereleases, 2019-11-04). In **one month** of Firefox 63 Release:

- **1.45 billion** notification permission prompts were shown to users
- **23.66 million** were accepted
- approximately **48% were actively denied**
- in about **500 million** cases users clicked "Not Now"
- summary sentence: *"for each prompt that is accepted, sixty are denied or ignored"*

Mozilla's conclusion: *"unsolicited prompts are denied in over 99% of cases."*

### The policy that shipped

From Mozilla Hacks, *Upcoming notification permission changes in Firefox 72*:

> *"Firefox will require explicit user interaction on all notification permission prompts, starting in Firefox 72."*

And the exact failure mode when you ask without a gesture:

> *"Firefox will instantly reject the promise returned by `Notification.requestPermission()` and `PushManager.subscribe()`. However, the user will see a small notification permission icon in the address bar."*

Firefox 70 had already replaced "Not Now" with "Never" — meaning a badly-timed ask on Firefox can permanently poison the origin.

Apple's rule is the same in spirit: permission requests must occur *"in response to direct user interaction — such as tapping on a 'subscribe' button."*

### Google's recommended pattern

From web.dev's push-notification permissions UX guidance:

> *"The worst thing you can do is to show the permission dialog to users as soon as they land on your site."*

> *"Ask users to subscribe to push at a time when the benefit is obvious."*

The documented patterns are:

1. **Value proposition / in-context ask** — request at the moment the benefit is self-evident.
2. **Double permission (pre-prompt)** — *"First show a dialog that your website controls, explaining the value for your site's use case"*, then trigger the browser prompt only if the user says yes. Because a browser-level "deny" is often permanent while your own dialog's "no" is not, this converts a permanent loss into a recoverable one.
3. **Settings panel** — a dedicated place where users deliberately turn notifications on.
4. **Passive toggle** — a persistent, unobtrusive switch for returning visitors.

Plus the requirement people forget: *"please consider how a user should unsubscribe or opt out of push messaging."* Sites without an unsubscribe path push users toward permanently blocking the origin.

### The concrete rule for Fem-ho

**Never call `requestPermission()` or `subscribe()` on first load, on login, or from a banner.** The single legitimate trigger is: **the user has just set a reminder, or just toggled a notification preference, and the click that did so is the gesture.**

The flow, in Catalan, wired to the reminder editor:

```
User opens task → taps "Afegeix recordatori" → picks "1 hora abans" → taps "Desa"
        │
        ├─ permission already 'granted' and a live subscription exists → save, done, no dialog
        │
        ├─ permission 'default' → show OUR pre-prompt sheet (in-app, Plou components):
        │     "Vols que t'avisem?
        │      Per rebre aquest recordatori en aquest dispositiu, el navegador
        │      et demanarà permís per enviar notificacions.
        │      Fem-ho només t'enviarà els avisos que tu configuris.
        │      [Ara no]  [D'acord, activa-ho]"
        │        └─ on "D'acord" (this click is the user gesture) →
        │              Notification.requestPermission() → subscribe() → POST subscription
        │
        ├─ permission 'denied' → do NOT call requestPermission (it will not prompt).
        │     Show the recovery path + offer alternative channels:
        │     "Has bloquejat les notificacions per a aquest lloc.
        │      Pots desbloquejar-les a la configuració del navegador,
        │      o rebre aquest recordatori per correu."
        │     [Com desbloquejar-ho]  [Envia'm un correu]
        │
        └─ capability 'ios-needs-install' → the Add-to-Home-Screen sheet from §2.2,
              plus the same email fallback offer.
```

Two design consequences that follow directly from the research:

- **The reminder must be savable regardless of permission outcome.** The reminder is data; the delivery channel is a preference. If the user declines the browser prompt, the reminder is still stored and still fires — by email, by ntfy, or on their Android device. A UI that refuses to save a reminder without notification permission is the wrong shape.
- **The "Ara no" path must be re-offerable.** Because our own dialog's "no" is not the browser's permanent "Never", track a `push_prompt_declined_at` timestamp per user per device and allow re-asking after, say, 30 days or on the next explicit visit to Configuració → Notificacions. Never re-ask automatically on every reminder.

---

# PART 4 — Email from a self-hosted box

## 4.1 The blunt answer: what actually gets delivered in 2026

A self-hosted Fem-ho instance has exactly three postures, and only two of them work.

| Posture | Does mail arrive? | Verdict |
|---|---|---|
| **A. Nothing configured** | No mail at all | Must be a **supported, first-class state**, not a crash |
| **B. Relay through an authenticated smarthost** on 587/465 (the operator's own mailbox provider, Fastmail, Migadu, Mailgun, Postmark, SES, their ISP's smarthost, a Google Workspace SMTP relay…) | Yes, reliably | **The recommended and documented default** |
| **C. Direct-to-MX SMTP from the box itself** (a local Postfix speaking port 25 to the world) | Almost never, from a home connection | **Do not build for it, do not document it as supported** |

Why C fails, from primary sources:

- **Spamhaus PBL.** The PBL lists *"end-user IP address ranges from which email should never be sent directly to the final destination"* — residential and dynamic ISP space, and *"any IP space that should not be sending email directly to the Internet"*. Scale: roughly **1.4 billion IPv4 addresses, about 40% of routable IPv4 space**, plus IPv6 CIDR ranges. Spamhaus's own remedy is explicit: configure *"your ISP's outgoing mail relay as a smarthost"* with SMTP AUTH, or *"an inexpensive commercial smarthost provider."*
- **Port 25 is blocked at the network layer by major hosts.** Google Cloud: *"Due to the risk of abuse, connections to destination TCP Port 25 are blocked when the destination is external to your VPC network."* Ports **587 and 465** are explicitly unrestricted: *"Google Cloud does not place any restrictions on traffic sent to external destination IP addresses using destination TCP ports 587 or 465."* Google further recommends a third-party provider because *"having a trusted third-party email provider such as SendGrid, Mailgun, or Mailjet improves your IP reputation score."* Most residential ISPs block outbound 25 as well.
- **Even if you get through, you fail authentication.** A home IP has no PTR record you control, and Gmail's baseline requires *"valid forward and reverse DNS records"* (§4.3).

**Design conclusion for Fem-ho: the product ships an SMTP *client* with relay-shaped configuration and never an MTA.** `FEMHO_SMTP_HOST` / `FEMHO_SMTP_PORT` / `FEMHO_SMTP_USER` / `FEMHO_SMTP_PASS` / `FEMHO_SMTP_FROM` describe a smarthost, and the documentation should say so in one sentence at the top of the mail section.

This is exactly the posture ntfy takes for its own outbound mail: config keys `smtp-sender-addr` (e.g. `email-smtp.us-east-2.amazonaws.com:587`), `smtp-sender-user`, `smtp-sender-pass`, `smtp-sender-from`, `smtp-sender-verify` — and the documented constraint *"only SMTP servers with PLAIN auth and STARTTLS are supported."* A well-scoped self-hosted project deliberately supports one narrow, working path.

## 4.2 SPF / DKIM / DMARC minimums

The operative specification for whether mail lands is not an RFC; it is the receiving providers' sender requirements. Gmail's, which Yahoo and Microsoft broadly mirror, took effect **1 February 2024**:

### All senders

| Requirement | Exact wording |
|---|---|
| Authentication | *"Set up SPF **or** DKIM email authentication for your sending domains"* |
| DNS | *"Ensure that sending domains or IPs have valid forward and reverse DNS records"* |
| Transport | *"Use a TLS connection for transmitting email"* |
| Reputation | *"Keep spam rates reported in Postmaster Tools below 0.3%"* |
| Format | *"Format messages according to the Internet Message Format standard, RFC 5322"* |
| Impersonation | must not impersonate Gmail `From:` headers |

### Bulk senders (5,000+ messages/day)

| Requirement | Exact wording |
|---|---|
| Authentication | *"Set up SPF **and** DKIM email authentication for your domain"* (both) |
| DMARC | *"Set up DMARC email authentication for your sending domain"*; enforcement policy *"can be set to none"* |
| Alignment | *"The domain in the sender's From: header must be aligned with either the SPF domain or the DKIM domain"* |
| Unsubscribe | *"Marketing messages and subscribed messages must support one-click unsubscribe"* |
| Reputation | spam rate *"below 0.30%"* |

**A family Fem-ho instance is never a bulk sender.** Ten users × a handful of reminders a day is three orders of magnitude below 5,000/day. So the *mandatory* bar is the "all senders" row: SPF **or** DKIM, valid rDNS, TLS.

**But the practical bar is higher than the mandatory bar**, and this is where an operator gets burned: a message `From: femho@family.example` relayed through `smtp.provider.example` will fail SPF (the provider's IP is not in `family.example`'s SPF record) unless either (a) the operator adds the provider's `include:` to their SPF, or (b) the provider DKIM-signs on their behalf with an aligned `d=`, or (c) the `From:` is simply an address at the provider's own domain.

**Therefore Fem-ho's documentation must give the operator three concrete, ranked options:**

1. **Easiest, always works:** set `FEMHO_SMTP_FROM` to an address that belongs to the relay account itself (`your.name@fastmail.com`). No DNS work. Alignment is automatic. Downside: mail is "from" a personal address.
2. **Recommended for a real household domain:** own `family.example`, add the provider's SPF `include:`, publish the provider's DKIM CNAMEs, and set `From: femho@family.example`. Then add a DMARC record — start at `p=none`.
3. **Not supported:** run your own MTA on the home connection.

DMARC itself was re-standardised in 2026. **RFC 9989**, *"Domain-Based Message Authentication, Reporting, and Conformance (DMARC)"*, published **May 2026**, **Proposed Standard**, **obsoletes RFC 7489 and RFC 9091**. Companions: **RFC 9990** (aggregate feedback reports) and **RFC 9991** (per-message failure reports). This is the first time DMARC is on the IETF Standards Track — it was previously Informational via the Independent Submission Stream. Any documentation Fem-ho ships should cite RFC 9989, not RFC 7489.

A minimal, safe starting DNS set for `family.example` (operator-side, documented not automated):

```
family.example.            TXT  "v=spf1 include:<relay-provider-spf> -all"
<selector>._domainkey.family.example.  CNAME  <provider-supplied>
_dmarc.family.example.     TXT  "v=DMARC1; p=none; rua=mailto:dmarc@family.example"
```

## 4.3 Node mailer libraries — versions and status

Fetched from the npm registry on 2026-08-05.

| Package | Latest | Published | License | `engines` |
|---|---|---|---|---|
| **`nodemailer`** | **9.0.4** | **2026-08-04** | **MIT-0** (*"MIT No Attribution"*) | field says `>=6.0.0` (stale; see note) |
| `emailjs` | 5.0.2 | 2026-07-13 | MIT | `>=18` |
| `@types/web-push` | 3.6.4 | 2024-10-22 | MIT | — |

Nodemailer's GitHub repo was pushed **2026-08-04** with **1 open issue** — an unusually healthy signal. The README states the licence as *"MIT No Attribution licence"*, which is the MIT-0 variant (no attribution clause) — relevant to a self-hosted project that ships a licence bundle. The `engines` field claiming Node ≥ 6 is legacy metadata, not a real floor; Fem-ho's Node baseline (dossier 11) governs.

**Recommendation: `nodemailer@9`.** It is the only mailer with the breadth Fem-ho needs (SMTP pooling, STARTTLS/implicit TLS, DKIM signing, attachments, `List-Unsubscribe`, stream/JSON transports for tests) and it is demonstrably maintained. `emailjs` is a credible zero-dependency alternative but has a much smaller surface.

### Transport configuration shape

```ts
import nodemailer, { type Transporter } from 'nodemailer';

export function buildTransport(): Transporter | null {
  const host = process.env.FEMHO_SMTP_HOST;
  if (!host) return null;                       // ← the "nothing configured" state, §4.5

  const port = Number(process.env.FEMHO_SMTP_PORT ?? 587);
  return nodemailer.createTransport({
    host,
    port,
    // 465 = implicit TLS; 587/25 = plaintext connect then STARTTLS
    secure: port === 465,
    requireTLS: port !== 465,
    auth: process.env.FEMHO_SMTP_USER
      ? { user: process.env.FEMHO_SMTP_USER, pass: process.env.FEMHO_SMTP_PASS! }
      : undefined,
    pool: true,
    maxConnections: 2,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    // Optional: sign locally when the operator owns the domain and holds the key.
    ...(process.env.FEMHO_DKIM_PRIVATE_KEY
      ? {
          dkim: {
            domainName: process.env.FEMHO_DKIM_DOMAIN!,
            keySelector: process.env.FEMHO_DKIM_SELECTOR ?? 'femho',
            privateKey: process.env.FEMHO_DKIM_PRIVATE_KEY,
          },
        }
      : {}),
  });
}
```

**Call `transport.verify()` at boot** and surface the result on the admin/health page. An operator who mistyped a password should learn about it from Fem-ho's settings screen, not from a family member missing a reminder.

Nodemailer's DKIM options, exactly (from its documentation):

| Option | Type | Default | Purpose |
|---|---|---|---|
| `domainName` | string (required) | — | signing domain; the `d=` tag |
| `keySelector` | string (required) | — | DNS selector |
| `privateKey` | string \| Buffer (required) | — | PEM private key |
| `keys` | array of key objects | — | multiple keys, for rotation or subdomains |
| `hashAlgo` | `'sha256'` \| `'sha1'` | `'sha256'` | body hash |
| `headerFieldNames` | string | RFC 4871 defaults | colon-separated headers to sign |
| `skipFields` | string | — | colon-separated headers to exclude |
| `cacheDir` | string \| false | `false` | temp dir for large messages |
| `cacheTreshold` | number | `2097152` (2 MB) | memory threshold before disk caching (the misspelling is intentional, kept for backwards compatibility) |

DKIM can be set **transport-wide** (all messages signed) or **per-message** via a `dkim` object on the message, which takes precedence.

> Practical note: when relaying through a provider that already DKIM-signs (Fastmail, Migadu, SES, Postmark), **do not also sign locally** unless the `d=` aligns with your `From:` — a second, unaligned signature adds nothing and can confuse DMARC alignment reasoning. Local DKIM is for the operator who owns the domain and wants alignment while relaying through a provider that signs with its own domain.

### Headers Fem-ho must set on every transactional mail

```ts
await transport.sendMail({
  from: { name: 'Fem-ho', address: process.env.FEMHO_SMTP_FROM! },
  to: user.email,
  subject: subject,                 // localised, no emoji in the subject
  text: plainBody,                  // ALWAYS send a text/plain alternative
  html: htmlBody,
  headers: {
    'Auto-Submitted': 'auto-generated',       // RFC 3834 — stops vacation-responder loops
    'X-Auto-Response-Suppress': 'All',        // Outlook/Exchange equivalent
  },
  list: {
    unsubscribe: {
      url: `${baseUrl}/u/${unsubToken}`,
      comment: 'Deixa de rebre aquests avisos',
    },
  },
  messageId: `<${deliveryId}@${mailDomain}>`,  // stable, from your own dedupe key
  references: threadRefs,                       // groups a task's mails into one thread
});
```

`Auto-Submitted: auto-generated` is not optional for a reminder system — without it an out-of-office autoresponder can bounce mail back into a loop. `List-Unsubscribe` is a bulk-sender requirement Fem-ho does not formally meet, but including it is free and improves placement. Threading by task via `References` keeps a family's inbox tidy.

## 4.4 Templating and i18n for transactional mail

The catch with email HTML is that it is not web HTML: no external stylesheets, no `<style>` reliability in several clients, table-based layout for Outlook. Registry data, 2026-08-05:

| Package | Latest | Published | Node | Fit for Fem-ho |
|---|---|---|---|---|
| `mjml` | **5.4.0** | 2026-06-29 | — | Mature, maintained, compiles MJML → email-safe HTML. Good, but adds a template language separate from the app's React. |
| `react-email` | **6.9.1** | 2026-07-23 | `>=20` | Actively maintained; write emails as React components. |
| `@react-email/components` | **1.0.12** | 2026-04-09 | `>=20` | The component library for the above. |
| `maizzle` | 1.2.4 | 2026-08-01 | — | Tailwind-for-email framework; maintained. |
| `juice` | **12.1.2** | 2026-08-04 | `>=22.12` | Inlines CSS into HTML. The low-level primitive if you roll your own. |
| `html-to-text` | **10.0.0** | 2026-04-30 | `>=20.19` | Generates the `text/plain` alternative from your HTML. Essential. |
| `handlebars` | 4.7.9 | 2026-03-26 | — | Fine, but a second template language. |
| `nodemailer-express-handlebars` | 7.0.0 | 2024-09-11 | `>=20` | Only if you are already on Express + Handlebars. |
| `mjml-react` | 2.0.8 | **2022-05-20** | — | **Stale — do not use.** |
| `i18next` | **26.3.6** | 2026-07-09 | — | The i18n runtime; works server-side. |

**Recommendation for Fem-ho: `react-email` + `@react-email/components`, rendered server-side, with `html-to-text` producing the plain-text alternative.** The stack is already TypeScript + React; sharing the Plou design tokens (CSS custom properties become literal values at render time) keeps the mail visually consistent with the app without a second templating system. `mjml` is the defensible alternative if Outlook fidelity ever becomes a real requirement.

### i18n rules specific to mail

The UI is Catalan, but the household may be mixed, and email is the one channel where the recipient's locale is *not* the sender's browser locale.

1. **Locale is a property of the recipient user, stored server-side** (`users.locale`, default `ca`), not inferred from the request that triggered the mail. When @Anna assigns a task to @Marc, Marc's mail is rendered in Marc's locale.
2. **Time zone likewise.** Store `users.tz` (IANA name) and format every due date with `Intl.DateTimeFormat(locale, { timeZone })`. A reminder mail that says "18:00" in the wrong zone is worse than no mail. Catalan month/day names come from `Intl` for free — do not hand-roll them.
3. **Subject lines must be translatable whole strings, not concatenations.** `"Recordatori: {{title}}"` — never `t('reminder') + ': ' + title`, because Catalan and Spanish word order differ from English.
4. **Keep the message catalogue shared with the web app** so `push`, `email` and in-app copy for the same event stay in sync — one `notifications.ca.json` consumed by both `i18next` on the server (for mail and push payload text) and the React app.
5. **Render push payload text server-side too.** Since the push body is at most ~3993 bytes and iOS may render it declaratively without your JS, the server must produce the final Catalan strings. There is no client-side translation opportunity.

A shared catalogue shape:

```jsonc
// locales/ca/notifications.json
{
  "reminder.title": "{{taskTitle}}",
  "reminder.body": "Venç {{when}} · {{scope}}",
  "assigned.title": "{{actor}} t'ha assignat una tasca",
  "assigned.body": "{{taskTitle}} · {{scope}}",
  "due.title": "Avui: {{taskTitle}}",
  "email.subject.reminder": "Recordatori: {{taskTitle}}",
  "email.subject.assigned": "{{actor}} t'ha assignat «{{taskTitle}}»",
  "email.footer.manage": "Gestiona els teus avisos",
  "email.footer.unsubscribe": "Deixa de rebre aquests correus"
}
```

## 4.5 What fails if the operator configures nothing — and what to degrade to

**This is the section an AI most needs, because the default self-hosted install has no SMTP.**

### Symptom map

| Missing configuration | What breaks | What must NOT happen |
|---|---|---|
| No `FEMHO_SMTP_HOST` | all email: reminders, invitations, password reset, share-link notices | the app must not crash at boot; `reminder.dispatch` must not throw and stall the queue; users must not silently think reminders are on |
| SMTP host set but credentials wrong | every send fails at the transport | infinite retry loop hammering the relay and locking the account |
| SMTP works but `From:` is unaligned | mail is accepted by the relay and lands in spam | Fem-ho reporting "sent" as if delivered |
| No VAPID keys persisted | all web push, permanently | see §1.4 |
| Neither SMTP nor push nor ntfy | **no reminder can reach anyone except through the Android app** | this state must be *loudly visible*, not discovered at 07:00 |

### Required behaviour

1. **Boot: detect and classify, do not fail.** `buildTransport()` returns `null` when unconfigured. The mail service exposes `isConfigured: boolean` and `verify()` results. The app starts normally.
2. **Admin surface: a Notification Health panel.** One screen listing each channel with a status: `Web Push — actiu (clau VAPID persistida)`, `Correu — no configurat`, `ntfy — no configurat`. This is where an operator learns the truth once, rather than a family member learning it by missing a school pickup.
3. **User surface: never offer a channel that cannot work.** In the reminder editor's channel picker, an unconfigured channel is either hidden or shown disabled with a one-line reason (`El correu no està configurat en aquest servidor`). Do not let a user tick "correu" and believe it.
4. **Degrade in a defined order.** For each reminder, resolve the delivery set as: every *enabled and healthy* channel the user has. If that set is empty:
   - mark the reminder delivery row `state = 'undeliverable'` with `reason = 'no_channel'`;
   - **still mark the reminder `fired_at`** so the in-app badge and Inbox reflect it — the in-app surface is the last-resort channel and it always works;
   - raise a **once-per-user, once-per-week** in-app banner: *"No pots rebre recordatoris fora de l'app. Activa les notificacions del navegador o demana a l'administrador que configuri el correu."*
5. **The in-app channel is always available and always free.** A reminder that fires with no external channel should still: appear in the user's Inbox rail, increment the badge count the next time the app is opened, and show in a "Recordatoris recents" list. This is the floor below which Fem-ho never falls.
6. **Never retry forever.** A channel that fails permanently N times (see §6.3) is marked `unhealthy`, stops being attempted, and surfaces on the health panel.

### The password-reset trap

Email-and-password auth plus no SMTP means **there is no password reset**. This is a foreseeable, avoidable disaster in a family install. Two mitigations, both required:

- A **CLI/admin escape hatch**: `docker compose exec app femho user:set-password <email>` — documented in the ops dossier, working with zero mail configuration.
- The signup/settings UI must state, when SMTP is unconfigured: *"Aquest servidor no pot enviar correus. Si oblides la contrasenya, l'administrador l'haurà de restablir."*

---

# PART 5 — The no-SMTP, no-Google fallback: generic notification sinks

For a self-hosted household that refuses both a mail provider and Google, there is a well-established third path: a **generic notification sink** the user already has installed. Three projects dominate.

## 5.1 ntfy

Fem-ho already touches ntfy through the Android client (dossier 06, UnifiedPush). The same server is a first-class HTTP notification sink for **any** channel, including a family member who uses neither the web app nor Android.

### Publishing (exact API)

**POST or PUT to `https://ntfy.example/<topic>`; the request body is the message.**

Headers (all optional; aliases as documented):

| Header | Aliases | Values |
|---|---|---|
| `X-Title` | `Title`, `t` | string |
| `X-Priority` | `Priority`, `prio`, `p` | `1`–`5` / `min`, `low`, `default`, `high`, `max`/`urgent` |
| `X-Tags` | `Tags`, `tag`, `ta` | comma-separated; emoji short codes render as emoji |
| `X-Click` | `Click` | URL opened when the notification is tapped |
| `X-Actions` | `Actions`, `Action` | action buttons: `view`, `http`, `broadcast`, `copy` |
| `X-Attach` | `Attach`, `a` | URL to attach |
| `X-Markdown` | `Markdown`, `md` | `yes`/`1`/`true` |
| `X-Delay` | `Delay`, `At`, `In` | duration / timestamp / natural language — **minimum 10s, maximum 3 days** |
| `X-Email` | `Email` | forward the notification to an email address |
| `X-Icon` | `Icon` | JPEG/PNG URL |
| `X-Cache` | `Cache` | `no`/`false` to skip caching |
| `X-Firebase` | `Firebase` | `no`/`false` to skip Firebase delivery |
| `X-Filename` | `Filename`, `File`, `f` | attachment filename |

Auth: `Authorization: Bearer <token>`, HTTP basic, or `?auth=<token>`.

**JSON publishing** — POST to the server root with:

```json
{
  "topic": "femho-anna",
  "message": "Venç a les 18:00 · Família",
  "title": "Comprar pa",
  "priority": 4,
  "tags": ["bell"],
  "click": "https://femho.example/t/01J8Z…",
  "actions": [
    { "action": "http", "label": "Fet", "url": "https://femho.example/api/v1/notifications/action",
      "method": "POST", "headers": {"authorization": "Bearer …"}, "body": "{\"action\":\"complete\",\"task_id\":\"01J8Z…\"}" }
  ],
  "markdown": true,
  "icon": "https://femho.example/icons/icon-192.png"
}
```

Note `X-Delay` / `"delay"`: ntfy can hold a message for up to three days. **Do not use this to schedule reminders.** It moves scheduling state out of Fem-ho's database into an external service, breaks if the reminder is edited or the task completed, and caps at 3 days. Fem-ho's own `reminder.dispatch` remains the scheduler; ntfy is a sink.

Subscribing (for completeness, and useful for a web fallback): `/json` (NDJSON stream), `/sse` (EventSource), `/raw`, `/ws`; query parameters `poll=1` and `since=` (duration, timestamp, message id, or `all`). Message fields: `id`, `time`, `event` (`open`, `keepalive`, `message`, `message_delete`), `topic`, `message`, `title`, `priority`, `tags`, `click`, `actions`.

### Self-hosted ntfy as a Web Push server — the reference implementation to copy

ntfy's own server config is the best available worked example of exactly the problem in Part 1:

| Key | Purpose |
|---|---|
| `web-push-public-key` | VAPID public key |
| `web-push-private-key` | VAPID private key |
| `web-push-file` | **SQLite database path for browser subscriptions** (e.g. `/var/cache/ntfy/webpush.db`) |
| `web-push-email-address` | admin contact sent to push providers — i.e. the VAPID `sub` claim |
| `web-push-startup-queries` | startup DB queries |
| `web-push-expiry-warning-duration` | when to warn about unused subscriptions — **default 55 days** |
| `web-push-expiry-duration` | when to expire them — **default 60 days** |

Keys are generated with `ntfy webpush keys`. And the warning, quoted:

> *"Changing your public/private keypair is **not recommended**. Browsers only allow one server identity per origin, and changing them prevents clients from subscribing until users manually clear notification permissions."*

Plus: if the subscription file is lost, web push notifications will not reach clients that have not been reopened until permissions are re-granted.

**Two things Fem-ho should copy verbatim in spirit:**

1. **Keys and subscriptions are persisted state on a volume**, with a dedicated config key so the operator can see where they live.
2. **Subscriptions expire on a timer, not only on 404/410.** ntfy warns at 55 days and expires at 60. A subscription that has not been *used successfully* nor *re-confirmed by the app opening* in ~60 days is almost certainly dead even if the push service still returns 201. Fem-ho should implement the same: a `last_seen_at` refreshed on every app open, a warning push at ~55 days, and deletion at ~60.

### UnifiedPush on ntfy

From ntfy's config docs: UnifiedPush requires **anonymous write access to topics beginning with the `up*` prefix**, granted with:

```
ntfy access '*' 'up*' write-only
```

This is what makes the Android side of dossier 06 work, and it is why an ntfy instance is already likely present in a Fem-ho deployment.

## 5.2 Gotify

A smaller, simpler self-hosted push server (Go binary + Android app + web UI). From its OpenAPI spec (`docs/spec.json`, version 2.1.0):

**`POST /message`** with a `CreateMessage` body:

| Field | Type | Required | Notes |
|---|---|---|---|
| `message` | string | **yes** | *"Markdown (excluding html) is allowed."* |
| `title` | string | no | |
| `priority` | integer | no | *"If unset, then the default priority of the application will be used."* |
| `extras` | object | no | key-value; *"Only accepted in CreateMessage"* |
| `appid` | integer | no | set by the server on return |

Authentication (security definitions in the spec):

- `Authorization: Bearer A…` — **application token** (prefix `A`), used to *send*
- `X-Gotify-Key: A…` — same, as a header
- `?token=A…` — same, as a query parameter
- `Authorization: Bearer C…` — **client token** (prefix `C`), used to *receive*
- HTTP basic auth

The app/client token split is a genuine security advantage over ntfy's topic model: a leaked Fem-ho application token can only *send* to that Gotify application, not read the family's messages. If a household already runs Gotify, supporting it is ~40 lines.

Gotify's ceiling: no scheduling, no action buttons with HTTP callbacks, no email bridging, and a much smaller client ecosystem. It is a sink, nothing more.

## 5.3 Apprise

Apprise is not a server; it is a **notification abstraction layer** with a URL-scheme-per-service design. From its repository:

- **150+ services** behind one interface
- Every destination is a URL: `mailto://userid:password@domain.com`, `ntfy://topic/` and `ntfys://topic/`, `gotify://hostname/token` and `gotifys://hostname/token`, `discord://webhook_id/webhook_token`, and so on
- A **self-hostable HTTP API**, `apprise-api`, distributed as the `caronc/apprise` Docker image, which *"centralize[s] your configuration and notifications through a manageable webpage"*
- CLI and Python API (`Apprise()`, `AppriseConfig()`)

**How Fem-ho should relate to Apprise: as an optional outbound webhook target, not as a dependency.** Fem-ho is a TypeScript project; embedding a Python library is not on the table. But an operator who already runs `apprise-api` can be served by a single generic channel type:

```
POST http://apprise:8000/notify/femho
Content-Type: application/json

{ "title": "Comprar pa", "body": "Venç a les 18:00 · Família", "type": "info", "tag": "anna" }
```

This one channel type — "POST JSON to a URL the operator supplies" — simultaneously covers Apprise, n8n, Home Assistant webhooks, Matrix bridges, Discord/Slack webhooks and anything else. **It is the single highest-leverage escape hatch in the whole notification design**, and it costs one table row shape and one HTTP call. Call it `webhook`.

Guardrails for a user-supplied webhook URL, since this is an SSRF surface:

- Operator-level configuration only (admin), never per-user free-text in a shared household.
- Deny by default: private IP ranges, link-local, loopback, `.internal` — unless an explicit `FEMHO_WEBHOOK_ALLOW_PRIVATE=true` is set (which a homelab operator legitimately needs, since `http://apprise:8000` *is* private).
- Fixed short timeout, no redirects followed, response body discarded and never surfaced.
- Payload contains no secrets and no full task descriptions by default — same "pointer not document" rule as push.

## 5.4 Can one abstraction cover Web Push + UnifiedPush + ntfy + email?

**Partly — and the partition is not where you would guess.** The correct answer is **three transports, not four, and not one.**

### Transport A — RFC 8030 endpoints: Web Push **and** UnifiedPush are the same code path

This is the key finding of Part 5 and it simplifies Fem-ho materially. UnifiedPush's own specification says:

- the application server POSTs to the push server endpoint **using RFC 8030**
- *"Push notifications are encrypted following RFC8291"*
- **RFC 8292 VAPID** authentication is supported
- the `content-encoding` header *"must be `aes128gcm`"*
- and, explicitly: *"On the application server side, you should use a Web Push library. Most programming languages and frameworks should have such a library available."*

That is byte-for-byte the same protocol as browser Web Push. Therefore:

> **A single `push_subscriptions` table with `{endpoint, p256dh, auth}` and a single `web-push` call serves both the browser PWA and the native Android client via UnifiedPush.** The only difference is a `kind` discriminator used for policy (payload shaping, TTL, urgency), not for transport.

This also means the VAPID key pair is shared between web and Android, the 4096-byte ceiling applies identically, the 404/410 pruning logic is identical, and the retry policy is identical. One implementation, two clients.

*(One caveat recorded in `## UNVERIFIED`: some UnifiedPush distributors historically forwarded unencrypted payloads, and encryption became mandatory in a later spec revision. I did not confirm which UnifiedPush spec version introduced mandatory RFC 8291 encryption, nor the behaviour of every distributor. Fem-ho should always encrypt — that is spec-correct — and treat any distributor that cannot handle it as unsupported.)*

### Transport B — token-and-URL webhook sinks: ntfy (native), Gotify, Apprise, generic webhook

All are "POST a small JSON or text body to a URL with a bearer token". They differ only in field names and header names. One adapter interface with four implementations:

```ts
export interface SinkAdapter {
  readonly type: 'ntfy' | 'gotify' | 'webhook';
  send(cfg: unknown, msg: NormalisedMessage): Promise<SendResult>;
  validateConfig(cfg: unknown): { ok: true } | { ok: false; error: string };
}
```

### Transport C — SMTP

Genuinely different: different failure modes (soft bounce vs hard bounce), different latency, different retry horizon (hours, not minutes), different content shape (a full document rather than a pointer), different identity requirements (SPF/DKIM/DMARC).

### The unifying layer that *does* exist

What unifies all three is **not** the transport but the message model. Define once:

```ts
export interface NormalisedMessage {
  /** Stable identity used for dedupe and for the email Message-ID. */
  deliveryId: string;
  /** Semantic kind: drives urgency, TTL, template selection. */
  kind: 'reminder' | 'assigned' | 'due_today' | 'comment' | 'share_opened' | 'ai_change' | 'digest';
  /** Already localised in the RECIPIENT's locale and time zone. */
  title: string;
  body: string;
  /** Absolute deep link. */
  url: string;
  /** Coalescing key. Maps to RFC 8030 Topic (hashed), Notification tag, ntfy topic-suffix. */
  groupKey: string;
  /** 0..4, mapped per channel. */
  priority: 0 | 1 | 2 | 3 | 4;
  /** Optional inbox badge count. */
  inboxCount?: number;
  /** Optional per-message action affordances; dropped by channels that lack them. */
  actions?: Array<{ id: 'complete' | 'snooze'; label: string }>;
  /** Rich fields used only by email. */
  email?: { subjectKey: string; templateProps: Record<string, unknown>; threadRefs?: string[] };
}
```

with a per-channel priority mapping:

| `priority` | Web Push `Urgency` | ntfy priority | Gotify priority | Email |
|---|---|---|---|---|
| 0 (digest) | `very-low` | 1 `min` | 1 | batched |
| 1 (low) | `low` | 2 `low` | 3 | batched |
| 2 (normal) | `normal` | 3 `default` | 5 | immediate |
| 3 (reminder due) | `high` | 4 `high` | 7 | immediate |
| 4 (urgent/overdue) | `high` | 5 `max` | 8 | immediate |

**So: one message model, one dispatcher, one preference model, one retry engine — and three transport adapters, of which the first serves both web and Android.**

---

# PART 6 — Recommended architecture for Fem-ho

## 6.1 Schema

Postgres. Types written in the style of dossier 08. ULIDs as text/uuid per that dossier's convention.

### `vapid_keys` — the thing that must never be regenerated

```sql
CREATE TABLE vapid_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key   text        NOT NULL,          -- base64url, uncompressed P-256 point
  private_key  text        NOT NULL,          -- base64url; encrypted at rest if a KMS/key exists
  subject      text        NOT NULL,          -- 'mailto:…' or 'https://…'  (RFC 8292 `sub`)
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  retired_at   timestamptz
);
-- Exactly one active key pair, ever. Rotation is a migration event, not an operation.
CREATE UNIQUE INDEX vapid_keys_one_active ON vapid_keys (active) WHERE active;
```

Rationale for a table rather than only a file: the backup story for a self-hosted app is "back up the database volume". Putting the VAPID key only in a bind-mounted JSON file means a restored database has subscriptions whose key is gone. Store it in the DB, optionally seedable from env, and write the file only as a convenience mirror.

### `push_subscriptions` — Web Push *and* UnifiedPush

```sql
CREATE TYPE push_kind AS ENUM ('webpush', 'unifiedpush');

CREATE TABLE push_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              push_kind NOT NULL DEFAULT 'webpush',

  -- RFC 8030 push resource. Bearer capability: never log, never expose via API/MCP.
  endpoint          text NOT NULL,
  -- RFC 8291 key material, base64url as delivered by PushSubscription.toJSON()
  p256dh            text NOT NULL,
  auth              text NOT NULL,
  content_encoding  text NOT NULL DEFAULT 'aes128gcm',

  -- which VAPID key this subscription is restricted to (RFC 8292 subscription restriction)
  vapid_key_id      uuid NOT NULL REFERENCES vapid_keys(id),

  -- PushSubscription.expirationTime, ms epoch → timestamptz; usually NULL
  expires_at        timestamptz,

  -- presentation + routing
  device_label      text,               -- truncated UA or user-supplied name
  locale            text NOT NULL DEFAULT 'ca',
  tz                text NOT NULL DEFAULT 'Europe/Madrid',
  -- coarse platform for policy (Apple ignores `tag`, Chrome desktop needs the browser open)
  platform          text,               -- 'apple' | 'chromium' | 'gecko' | 'unifiedpush' | 'unknown'

  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),  -- refreshed when the app opens
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  failure_count     int NOT NULL DEFAULT 0,
  disabled_at       timestamptz,
  disabled_reason   text
);

-- The endpoint is globally unique; re-subscribing the same browser must UPSERT, not duplicate.
CREATE UNIQUE INDEX push_subscriptions_endpoint_uq ON push_subscriptions (endpoint);
CREATE INDEX push_subscriptions_user_live ON push_subscriptions (user_id) WHERE disabled_at IS NULL;
```

Deriving `platform` from the endpoint origin is cheap and drives real policy decisions:

```ts
export function platformFor(endpoint: string): string {
  try {
    const h = new URL(endpoint).host;
    if (h.endsWith('push.apple.com')) return 'apple';
    if (h.endsWith('googleapis.com')) return 'chromium';
    if (h.endsWith('mozilla.com') || h.includes('push.services.mozilla')) return 'gecko';
    return 'unknown';
  } catch { return 'unknown'; }
}
```

### `notification_channels` — every way a user can be reached

```sql
CREATE TYPE channel_type AS ENUM ('inapp', 'webpush', 'email', 'ntfy', 'gotify', 'webhook');

CREATE TABLE notification_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          channel_type NOT NULL,
  label         text,                       -- 'Correu personal', 'ntfy del mòbil'
  -- Shape depends on `type`:
  --   webpush : { subscription_id }
  --   email   : { address }
  --   ntfy    : { base_url, topic, token? }
  --   gotify  : { base_url, app_token }
  --   webhook : { url, headers? }
  config        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled       boolean NOT NULL DEFAULT true,
  verified_at   timestamptz,                -- email + webhook must be verified before use
  health        text NOT NULL DEFAULT 'unknown',   -- 'ok' | 'degraded' | 'unhealthy' | 'unconfigured'
  last_error    text,
  failure_count int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_channels_user ON notification_channels (user_id) WHERE enabled;
```

Note that `webpush` appears in **both** tables. `push_subscriptions` is the *transport record* (one row per browser/device); `notification_channels` is the *preference record*. A user with three browsers has three subscriptions and — by convention — one `webpush` channel meaning "all my live browsers". Keeping them separate is what lets the preference model in §6.4 stay small.

### `notification_prefs` — per user, per event kind, per channel

```sql
CREATE TYPE notification_kind AS ENUM
  ('reminder','assigned','due_today','comment','scope_invite','share_opened','ai_change','digest');

CREATE TABLE notification_prefs (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind      notification_kind NOT NULL,
  channel   channel_type NOT NULL,
  enabled   boolean NOT NULL,
  PRIMARY KEY (user_id, kind, channel)
);

-- Quiet hours and digest scheduling live on the user, not per kind.
ALTER TABLE users
  ADD COLUMN quiet_hours_start time,          -- e.g. 22:00 local
  ADD COLUMN quiet_hours_end   time,          -- e.g. 07:30 local
  ADD COLUMN quiet_hours_override_urgent boolean NOT NULL DEFAULT true,
  ADD COLUMN digest_at time,                  -- e.g. 08:00 local, NULL = no digest
  ADD COLUMN locale text NOT NULL DEFAULT 'ca',
  ADD COLUMN tz     text NOT NULL DEFAULT 'Europe/Madrid';
```

Absent rows fall back to a hard-coded default matrix, so a new user needs zero configuration:

| kind | inapp | webpush | email | sinks |
|---|---|---|---|---|
| `reminder` | on | on | **off** | off |
| `assigned` | on | on | **on** | off |
| `due_today` | on | on | off | off |
| `comment` | on | off | off | off |
| `scope_invite` | on | on | **on** | off |
| `share_opened` | on | off | off | off |
| `ai_change` | on | off | off | off |
| `digest` | off | off | **on** (if `digest_at` set) | off |

Email defaults to **off for reminders and on for assignments** deliberately: a reminder is time-critical and email is not; an assignment is asynchronous and email is the channel that survives a closed browser.

### `notification_deliveries` — the outbox, and the dedupe ledger

```sql
CREATE TYPE delivery_state AS ENUM
  ('pending','sending','sent','failed','undeliverable','skipped_quiet','superseded');

CREATE TABLE notification_deliveries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- THE dedupe key. Unique. See §6.3.
  dedupe_key     text NOT NULL,

  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           notification_kind NOT NULL,
  channel_id     uuid REFERENCES notification_channels(id) ON DELETE CASCADE,
  channel_type   channel_type NOT NULL,        -- denormalised: survives channel deletion
  subscription_id uuid REFERENCES push_subscriptions(id) ON DELETE SET NULL,

  -- source entity, for auditing and for cancellation
  entity_type    text,                          -- 'task' | 'event' | 'checklist' | 'share'
  entity_id      uuid,
  reminder_id    uuid,
  occurrence_at  timestamptz,                   -- recurring instance identity

  payload        jsonb NOT NULL,                -- the NormalisedMessage
  group_key      text NOT NULL,

  scheduled_for  timestamptz NOT NULL,
  state          delivery_state NOT NULL DEFAULT 'pending',
  attempts       int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error     text,
  last_status    int,
  created_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz
);

CREATE UNIQUE INDEX notification_deliveries_dedupe_uq ON notification_deliveries (dedupe_key);
CREATE INDEX notification_deliveries_due
  ON notification_deliveries (next_attempt_at)
  WHERE state IN ('pending','failed');
CREATE INDEX notification_deliveries_user_recent
  ON notification_deliveries (user_id, created_at DESC);
```

And the existing reminders table gains nothing new beyond what dossier 08 already has (`fired_at`); the outbox is the new artefact.

## 6.2 Where the dispatcher sits

Dossier 08 §8.3 already schedules `reminder.dispatch` every 30 s. Split the work into **two** jobs, because they fail differently:

1. **`reminder.materialise`** (every 30 s) — pure database work. Finds reminders whose computed fire time has passed and whose `fired_at IS NULL`; expands the user's channel set; inserts one `notification_deliveries` row per (reminder occurrence × channel) with `ON CONFLICT (dedupe_key) DO NOTHING`; sets `fired_at`. **Never makes a network call.** This job must be fast, transactional and idempotent.
2. **`notification.deliver`** (every 10 s, or a queue worker) — takes `pending`/`failed` rows whose `next_attempt_at <= now()`, claims them with `FOR UPDATE SKIP LOCKED`, and performs the actual transport call.

The separation is what makes "reminder fired" independent of "notification delivered". The in-app Inbox reflects `fired_at`; the badge and the notification centre reflect delivery. If SMTP is down for an hour, reminders still fire in-app on time.

Claiming pattern:

```sql
WITH claimed AS (
  SELECT id FROM notification_deliveries
  WHERE state IN ('pending','failed') AND next_attempt_at <= now()
  ORDER BY scheduled_for
  LIMIT 50
  FOR UPDATE SKIP LOCKED
)
UPDATE notification_deliveries d
   SET state = 'sending', attempts = d.attempts + 1
  FROM claimed c
 WHERE d.id = c.id
RETURNING d.*;
```

`FOR UPDATE SKIP LOCKED` means multiple app replicas are safe without a distributed lock — relevant because dossier 11's compose file may scale the app container.

Scheduling primitives (registry data, 2026-08-05): `node-cron` 4.6.0 (2026-07-05, ISC, Node ≥ 20, *"overlap prevention, distributed coordination"*), `croner` 10.0.1 (2026-02-01, MIT, Node ≥ 18, zero dependencies), `bullmq` 6.0.8 (2026-08-05, MIT) if a Redis-backed queue is already in the stack. For a family-scale install, **a plain interval + `SKIP LOCKED` beats introducing Redis**; use `croner` if cron expressions are wanted for the digest job.

## 6.3 Dedupe, retry and per-channel rules

### Dedupe key

```
dedupe_key = `${kind}:${entity_type}:${entity_id}:${reminder_id ?? '-'}:${occurrence_at_iso ?? '-'}:${channel_id}`
```

Every component is load-bearing:

- `occurrence_at` distinguishes Tuesday's instance of a weekly recurring task from Wednesday's — without it, a recurring reminder fires exactly once, ever.
- `channel_id` means "email and push both fire" is not a duplicate.
- `reminder_id` means a task with two reminders (`-P1D` and `-PT1H`) fires twice.

Guarantee: `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`. Combined with `fired_at`, a job that runs twice (restart, clock jump, two replicas) cannot double-notify.

### Supersede rules

When the underlying entity changes, pending deliveries must be cancelled or rewritten — otherwise Fem-ho reminds people about tasks they already finished:

| Event | Action on `pending` deliveries |
|---|---|
| Task moved to **Fet** | `UPDATE … SET state='superseded'` for that `entity_id` |
| Task deleted | same |
| Reminder edited or removed | supersede rows for that `reminder_id`, re-materialise |
| Due date changed | supersede, re-materialise with new `scheduled_for` |
| Task reassigned | supersede rows for the old assignee, materialise for the new one |

This must run **inside the same transaction** as the entity change, otherwise there is a race between "user completes task" and "dispatcher claims delivery".

### Catch-up policy

If the server was down when a reminder was due, `reminder.materialise` will find it late. Rule: **deliver if less than `FEMHO_REMINDER_CATCHUP_WINDOW` (default 60 minutes) late; otherwise mark `fired_at` and create in-app only.** Nobody wants nine push notifications at 09:00 for reminders that were due overnight. State it in the payload when late: `"(recordatori endarrerit)"`.

### Quiet hours

Evaluate in the **recipient's** time zone. If `now` is inside quiet hours and `priority < 4`, set `state='skipped_quiet'` and create a single coalesced delivery scheduled for `quiet_hours_end`. If `priority = 4` and `quiet_hours_override_urgent`, send anyway. In-app delivery is never suppressed by quiet hours.

### Retry matrix

| Channel | Success | Prune subscription/channel | Permanent fail (no retry) | Retry with backoff | Max attempts | Backoff |
|---|---|---|---|---|---|---|
| **webpush / unifiedpush** | 201, 202 | **404, 410** | 400, 401, 403, 413 | 429 (honour `Retry-After`), 5xx, network | 5 | 30 s, 2 m, 10 m, 30 m, 2 h — **capped by the message TTL** |
| **email (SMTP)** | 250 | — (mark channel unhealthy after 5 consecutive) | 5xx SMTP permanent (550, 553) | 4xx SMTP transient, connection errors | 6 | 1 m, 5 m, 15 m, 1 h, 4 h, 12 h |
| **ntfy** | 2xx | — | 400, 413 | 429, 5xx, network | 5 | 30 s, 2 m, 10 m, 30 m, 2 h |
| | | disable channel + alert on **401/403** | | | | |
| **gotify** | 2xx | disable channel + alert on **401/403** | 400 | 429, 5xx, network | 5 | as ntfy |
| **webhook** | 2xx | disable after 10 consecutive failures | 400, 404, 410 | 429, 5xx, network | 3 | 1 m, 5 m, 20 m |
| **inapp** | always | — | — | — | 1 | — |

Two rules that are easy to get wrong:

1. **Retrying a push past its TTL is pointless.** If you sent `TTL: 900` and the third attempt is 30 minutes later, the push service would discard it anyway. Compute `maxRetryUntil = scheduled_for + ttlSeconds` and stop there.
2. **404/410 prunes the *subscription*, not the *channel*.** A user with three browsers who wipes one must not lose web push entirely. Only when a user's last live subscription is pruned does the `webpush` channel go `unhealthy`.

### Per-message TTL, urgency and topic

```ts
export function transportPolicy(kind: NotificationKind, scheduledFor: Date) {
  switch (kind) {
    case 'reminder':
      // A reminder delivered tomorrow is noise. Short TTL, high urgency.
      return { ttlSeconds: 3600, urgency: 'high' as const };
    case 'due_today':
      return { ttlSeconds: 6 * 3600, urgency: 'normal' as const };
    case 'assigned':
    case 'scope_invite':
      // Worth waiting for a closed laptop to reopen.
      return { ttlSeconds: 3 * 86400, urgency: 'normal' as const };
    case 'comment':
    case 'ai_change':
      return { ttlSeconds: 86400, urgency: 'low' as const };
    case 'digest':
      return { ttlSeconds: 12 * 3600, urgency: 'very-low' as const };
    default:
      return { ttlSeconds: 86400, urgency: 'normal' as const };
  }
}
```

`web-push`'s default TTL is **2419200 seconds (four weeks)** — catastrophically wrong for a reminder. **Always pass `TTL` explicitly.** This is a concrete bug an AI will otherwise ship.

Topic: `topicFor(kind, entityId)` from §3.3, applied to `reminder`, `due_today` and `assigned`. Omitted for `comment` (each comment is distinct).

### Apple-specific policy

Because `tag` has no effect on Safari (§2.6), an Apple endpoint receiving three updates about one task shows three notifications. Mitigation in the dispatcher:

```ts
// Before sending to an 'apple' platform subscription, collapse any other pending
// delivery with the same group_key into this one and mark it superseded.
if (sub.platform === 'apple') {
  await collapsePendingByGroupKey(delivery.group_key, delivery.id);
}
```

## 6.4 "A reminder set on device A fires where" — the truth table

This is the table the product needs, and the one that must be reflected in the UI so nobody is surprised.

Assume Anna sets a reminder for 18:00 on the task *"Comprar pa"*. Her account has: the PWA installed on her iPhone, Chrome on a Linux desktop, the native Android app on a tablet, and an email address. The reminder is stored **server-side** in all cases — where it was created is irrelevant to where it fires.

| # | Where set | Delivery target | Fires at 18:00? | Mechanism | Conditions / failure mode |
|---|---|---|---|---|---|
| 1 | any | **In-app (Inbox rail + badge)** | **Always** | `fired_at` set by `reminder.materialise`; UI reads it | Visible next time the app is opened; badge only where the Badging API exists |
| 2 | any | **iPhone, PWA installed on Home Screen** | **Yes** | Web Push → APNs → declarative or SW notification | Requires iOS ≥ 16.4 **and** Add to Home Screen **and** permission granted. In a Safari tab: **never** |
| 3 | any | **iPhone, Safari tab only (not installed)** | **No** | — | `PushManager` absent. Must show the install instructions (§2.2) |
| 4 | any | **Android native app** | **Yes** | UnifiedPush endpoint (same RFC 8030 send) **or** a locally scheduled `AlarmManager` alarm (dossier 06) | Works with the app closed. If UnifiedPush distributor is absent, the local alarm still fires — **the only offline-capable path in the product** |
| 5 | any | **Chrome / Edge desktop** | **Only if the browser is running** | Web Push → FCM | caniuse note #2. Closed browser = no notification until reopened, and then only if within TTL |
| 6 | any | **Firefox desktop** | **Only if the browser is running** | Web Push → Mozilla autopush | Same note. Also nothing at all in Private Browsing (no SW) |
| 7 | any | **Safari on macOS (Ventura+)** | **Yes, even with Safari closed** | Web Push → APNs via `webpushd` | Requires macOS ≥ 13 and Safari ≥ 16.1; ≥ 18.0 for full support |
| 8 | any | **Email** | **Yes, if a relay is configured** | SMTP via smarthost | Latency seconds-to-minutes. Nothing at all if `FEMHO_SMTP_HOST` unset. Off by default for `reminder` |
| 9 | any | **ntfy / Gotify / webhook** | **Yes, if configured** | HTTP POST | Independent of browser state; the best fallback for a user with no working push |
| 10 | any | **A CalDAV-only external family member** | **No push from Fem-ho** | Their own client's VALARM handling | Fem-ho writes `VALARM` into the exported VTODO/VEVENT; delivery is entirely their client's business. Fem-ho must not claim to notify them |
| 11 | Android, **offline** at set time | server | reminder syncs on reconnect | dossier 06 sync | If the device is offline **past** 18:00, the local alarm still fires locally; the server-side fan-out happens on reconnect and must be suppressed by the catch-up window (§6.3) so the user is not notified twice |
| 12 | Web, **server down** at 18:00 | all | **No** at 18:00 | — | On restart, catch-up window ≤ 60 min → deliver late with "(recordatori endarrerit)"; beyond that, in-app only |

### The UI consequence

The reminder editor must show, per user, **where this reminder will actually arrive**, computed from live channel health — not a generic bell icon. Something like:

```
Recordatori: 1 hora abans
Arribarà a:  ✓ iPhone (app instal·lada)   ✓ Tauleta Android   ✓ Dins de Fem-ho
             ⚠ Chrome (escriptori) — només si el navegador és obert
             ✗ Correu — desactivat per als recordatoris   [Activa]
```

This single component removes almost every "my reminder didn't fire" support conversation, and it is only possible because the channel health data already exists in the schema above.

## 6.5 Environment variables to add

Extending dossier 11's set:

```bash
# --- Web Push (also serves UnifiedPush for the Android client) ---
FEMHO_VAPID_PUBLIC_KEY=            # base64url; if unset, generated once and persisted
FEMHO_VAPID_PRIVATE_KEY=           # base64url; NEVER regenerate — see §1.4
FEMHO_VAPID_SUBJECT=mailto:admin@example.org   # RFC 8292 `sub`
FEMHO_VAPID_FILE=/data/vapid.json  # mirror/fallback persistence path (must be on a volume)

# --- Reminder dispatch ---
FEMHO_REMINDER_CATCHUP_WINDOW=60m
FEMHO_PUSH_MAX_ATTEMPTS=5
FEMHO_SUBSCRIPTION_EXPIRY_DAYS=60      # mirrors ntfy's default
FEMHO_SUBSCRIPTION_WARN_DAYS=55

# --- Email (SMARTHOST/RELAY ONLY — Fem-ho is not an MTA) ---
FEMHO_SMTP_HOST=
FEMHO_SMTP_PORT=587                # 465 => implicit TLS; 587 => STARTTLS
FEMHO_SMTP_USER=
FEMHO_SMTP_PASS=
FEMHO_SMTP_FROM="Fem-ho <femho@example.org>"
FEMHO_SMTP_REPLY_TO=
FEMHO_DKIM_DOMAIN=                 # optional local signing
FEMHO_DKIM_SELECTOR=femho
FEMHO_DKIM_PRIVATE_KEY=

# --- Generic sinks ---
FEMHO_NTFY_DEFAULT_BASE_URL=       # pre-fills the per-user channel form
FEMHO_WEBHOOK_ALLOW_PRIVATE=true   # homelabs legitimately POST to private addresses
```

**Docker volume requirement, to be stated in bold in the ops docs:** `/data` (or wherever `FEMHO_VAPID_FILE` and the database live) **must be a named volume or bind mount**. A `docker compose down -v` destroys the VAPID key pair and every web subscription with it.

## 6.6 REST / OpenAPI additions

Consistent with dossier 05's conventions, and with dossier 05's human-vs-AI token scoping (dossier 10): **all of these require a human-scoped token. The MCP server and AI tokens must not be able to enumerate subscriptions, read email addresses, or send notifications.**

```
GET    /api/v1/push/vapid-public-key          → { "public_key": "BN…" }        (auth: any session)
POST   /api/v1/push/subscriptions             ← { subscription, device_label?, locale?, tz? }
                                              → 201 { id, expires_at }
POST   /api/v1/push/subscriptions/rotate      ← { old_endpoint, subscription }  (device secret)
DELETE /api/v1/push/subscriptions/{id}        → 204
POST   /api/v1/push/test                      ← { subscription_id? }  sends a test push
                                              → 202 { delivery_id }

GET    /api/v1/notifications/channels         → [ { id, type, label, enabled, health, verified_at } ]
POST   /api/v1/notifications/channels         ← { type, label, config }
PATCH  /api/v1/notifications/channels/{id}    ← { enabled?, label?, config? }
DELETE /api/v1/notifications/channels/{id}
POST   /api/v1/notifications/channels/{id}/verify   → sends a verification message

GET    /api/v1/notifications/prefs            → { defaults, overrides: [ {kind, channel, enabled} ] }
PUT    /api/v1/notifications/prefs            ← { overrides: [...] , quiet_hours?, digest_at? }

POST   /api/v1/notifications/action           ← { action, task_id, token? }   (from the SW / ntfy)
GET    /api/v1/notifications/health           → per-channel status  (admin: server-wide status)
```

Response shape for `/health`, which powers both the admin panel and the "arribarà a:" component:

```json
{
  "server": {
    "webpush": { "status": "ok", "vapid_source": "file", "subscriptions": 4 },
    "email":   { "status": "unconfigured", "detail": "FEMHO_SMTP_HOST no definit" },
    "ntfy":    { "status": "unconfigured" }
  },
  "me": {
    "channels": [
      { "id": "…", "type": "webpush", "label": "iPhone d'Anna", "health": "ok",
        "platform": "apple", "last_success_at": "2026-08-05T09:12:00Z" },
      { "id": "…", "type": "webpush", "label": "Chrome (Linux)", "health": "ok",
        "platform": "chromium", "caveat": "browser_must_be_running" },
      { "id": "…", "type": "email", "label": "anna@…", "health": "unconfigured" }
    ]
  }
}
```

The `caveat` field is deliberately part of the contract: it is how the UI knows to render *"només si el navegador és obert"* without hard-coding platform knowledge in the frontend.

## 6.7 Audit-log interaction

Dossier 10 requires that every change be auditable, especially AI-originated ones. Notifications intersect this in two places:

1. **A notification is not a change** — do not write an audit row per delivery. The `notification_deliveries` table *is* the delivery log; keep it, prune rows older than ~90 days.
2. **A notification *action* is a change.** `POST /api/v1/notifications/action` with `action: 'complete'` moves a task to Fet and **must** produce a normal audit entry with actor = the user and source = `notification`. The single-use action token must carry the user identity; never accept an unauthenticated action.
3. **AI-delegated tasks (`ai_change` kind)** should notify the human owner by the same pipeline, with the audit row already written by the AI path and the notification merely pointing at it. Never let the notification be the only record.

## 6.8 Catalan strings for the notification surface

Collected here so they are written once and reused by both the server (push/email rendering) and the web app.

| Key | Catalan |
|---|---|
| `notif.settings.title` | Notificacions i recordatoris |
| `notif.channel.inapp` | Dins de Fem-ho |
| `notif.channel.webpush` | Notificacions del navegador |
| `notif.channel.email` | Correu electrònic |
| `notif.channel.ntfy` | ntfy |
| `notif.channel.webhook` | Webhook |
| `notif.health.ok` | Actiu |
| `notif.health.unconfigured` | No configurat en aquest servidor |
| `notif.health.unhealthy` | Amb errors |
| `notif.caveat.browserOpen` | Només si el navegador és obert |
| `notif.prompt.title` | Vols que t'avisem? |
| `notif.prompt.body` | Per rebre aquest recordatori en aquest dispositiu, el navegador et demanarà permís per enviar notificacions. Fem-ho només t'enviarà els avisos que tu configuris. |
| `notif.prompt.accept` | D'acord, activa-ho |
| `notif.prompt.later` | Ara no |
| `notif.denied.title` | Les notificacions estan bloquejades |
| `notif.denied.body` | Has bloquejat les notificacions per a aquest lloc. Pots desbloquejar-les a la configuració del navegador, o rebre aquest recordatori per correu. |
| `notif.ios.title` | Per rebre recordatoris a l'iPhone |
| `notif.ios.step1` | Toca Comparteix a la barra inferior. |
| `notif.ios.step2` | Tria «Afegeix a la pantalla d'inici». |
| `notif.ios.step3` | Obre Fem-ho des de la icona nova i torna a activar els recordatoris. |
| `notif.action.done` | Fet |
| `notif.action.snooze` | Ajorna 10 min |
| `notif.late.suffix` | (recordatori endarrerit) |
| `notif.none.banner` | No pots rebre recordatoris fora de l'app. Activa les notificacions del navegador o demana a l'administrador que configuri el correu. |
| `notif.willArriveAt` | Arribarà a: |

---

## What Fem-ho should do

Concrete decisions, each traceable to a section above.

**Web Push transport**

1. **Use `web-push@3.6.7` with `@types/web-push@3.6.4`**, CJS interop, pinned. Revisit when the repo's unreleased ESM migration ships. (§1.7)
2. **Always send `contentEncoding: 'aes128gcm'`.** Never the legacy `aesgcm`/`Crypto-Key` path. (§1.3)
3. **Always pass `TTL` explicitly.** The library default is four weeks; reminders use 3600 s. (§6.3)
4. **Set `Urgency` per kind** (`high` for reminders, `very-low` for digests) and set `Topic` (a ≤24-char base64url hash) for reminder/due/assigned so undelivered messages collapse at the push service. (§3.3, §6.3)
5. **Keep push payloads under ~1500 bytes** and treat them as pointers, not documents. Hard ceiling is 3993 octets of plaintext. (§1.3)
6. **Send a payload that is simultaneously a valid Declarative Web Push document (`web_push: 8030`, `title`, `navigate`, `mutable: true`) and a carrier for the compact envelope in `notification.data`.** One payload serves iOS-without-a-service-worker and Chrome/Firefox-with-one. (§2.3)

**VAPID key lifecycle — the highest-risk item in this dossier**

7. **Generate the VAPID key pair exactly once and persist it in the database, mirrored to `FEMHO_VAPID_FILE` on a mounted volume.** Never regenerate on boot. (§1.4, §6.1)
8. **Log a FATAL-level warning if a key is generated while `push_subscriptions` is non-empty** — that is the "lost the volume" signature. (§1.8)
9. **The client must `unsubscribe()` before re-subscribing whenever `applicationServerKey` differs**, or it will get `InvalidStateError` forever. (§1.4)
10. **Reconcile the subscription on every app open** — compare `getSubscription().endpoint` with the server's record. Do not rely on `pushsubscriptionchange`: Firefox's is incomplete and iOS does not have it. (§1.6)
11. **Expire subscriptions on a timer** (warn at 55 days, delete at 60, refreshed by `last_seen_at`), copying ntfy's proven defaults, in addition to pruning on 404/410. (§5.1, §6.1)

**Pruning and retry**

12. **404 and 410 delete the subscription row. 400/401/403/413 never retry. 429 honours `Retry-After`. 5xx/network back off, capped by the message TTL.** Use `WebPushError.endpoint` to prune without extra plumbing. (§1.2, §1.7, §6.3)
13. **Treat the `endpoint` column as a bearer secret** — redact in logs, exclude from every REST/MCP response. (§1.2)

**Browser and platform**

14. **Ship the iOS install path as a designed feature, not an error state.** Detect `PushManager` absent + iOS + not standalone → the Catalan Add-to-Home-Screen sheet. Manifest must declare `display: "standalone"`. (§2.2, §3.4)
15. **Tell desktop Chrome/Edge/Firefox users the truth in the UI**: push arrives only while the browser is running. Surface it via the `caveat: "browser_must_be_running"` field. (§2.1, §6.6)
16. **Do not build on Notification Triggers.** It never shipped and its development has ended; there is no scheduled local notification on the web. Every web reminder is server-dispatched. (§2.4)
17. **Use the Badging API for the Inbox count, always guarded in a try/catch**, and expect nothing on Firefox, nothing on Linux desktop, and nothing reliable on Chrome Android. It is genuinely valuable on installed iOS and macOS web apps. (§2.5)
18. **Design notifications to be complete without action buttons and without `tag` coalescing**, because Apple supports neither. Use `Notification.maxActions` to feature-detect. (§2.6)
19. **Use `registration.showNotification()`, never `new Notification()`** — Samsung Internet supports the former only. (§2.1)

**Service worker**

20. **Use `vite-plugin-pwa` with `strategies: 'injectManifest'`.** `generateSW` makes it impossible to add push listeners. Register listeners at top level, synchronously. (§3.4)
21. **Always call `showNotification()` in the `push` handler**, wrapped in `event.waitUntil()`. There is no silent push. (§3.1)
22. **`notificationclick` focuses an existing window then navigates**, and posts actions with a single-use, task-scoped token — never a long-lived API token. (§3.2)

**Permission UX**

23. **Never request permission on load, on login, or from a banner.** The only trigger is the click that saves a reminder or flips a notification preference. Mozilla measured 1.45 billion prompts against 23.66 million acceptances in one month; Firefox 72+ rejects the promise outright without a user gesture. (§3.5)
24. **Use the double-permission pattern**: an in-app Plou dialog first, browser prompt only on acceptance, because a browser "Never" is unrecoverable while our "Ara no" is not. (§3.5)
25. **Always save the reminder regardless of permission outcome.** Reminders are data; channels are preferences. (§3.5)

**Email**

26. **Fem-ho ships an SMTP *client* configured for a smarthost, never an MTA.** Document ports 587/465, document that direct port-25 delivery from a home connection does not work (Spamhaus PBL, ~40% of IPv4 space; Google Cloud blocks 25 outbound). (§4.1)
27. **Use `nodemailer@9` (MIT-0), pooled, with `verify()` at boot surfaced on a health panel.** (§4.3)
28. **Default `From:` guidance: an address at the relay's own domain**, because that aligns SPF/DKIM with zero DNS work. Document the owned-domain path (SPF `include:`, DKIM CNAMEs, DMARC `p=none` citing **RFC 9989**) as the step-up. (§4.2)
29. **Set `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`, `List-Unsubscribe`, a stable `Message-ID` derived from the dedupe key, and `References` for task threading. Always send a `text/plain` alternative.** (§4.3)
30. **Render mail with `react-email` + `@react-email/components`, plain text via `html-to-text`, localised from the *recipient's* stored `locale` and `tz` via `Intl`, from a message catalogue shared with the web app.** (§4.4)
31. **Email defaults: off for `reminder`, on for `assigned` and `scope_invite`.** (§6.1)
32. **With nothing configured, the app must boot, reminders must still fire in-app, the channel picker must disable email with a reason, and a once-weekly banner must tell the user.** Provide a CLI password-reset escape hatch, because no SMTP means no password reset. (§4.5)

**Fallback sinks**

33. **Implement a `webhook` channel type (operator-configured POST JSON to a URL) with SSRF guards and a `FEMHO_WEBHOOK_ALLOW_PRIVATE` switch.** It covers Apprise, Home Assistant, n8n, Matrix and Discord in one adapter. (§5.3)
34. **Implement `ntfy` natively** (title/priority/tags/click/actions headers or JSON) since a Fem-ho deployment likely already runs ntfy for UnifiedPush. **Gotify is optional** and cheap. **Do not use ntfy's `X-Delay` for scheduling.** (§5.1, §5.2)

**The unifying architecture**

35. **One `push_subscriptions` table and one `web-push` call serve both the browser PWA and the native Android client**, because UnifiedPush is RFC 8030 + RFC 8291 + RFC 8292. Discriminate with `kind`/`platform` for policy only. (§5.4)
36. **Three transports (RFC 8030 push, HTTP sinks, SMTP), one `NormalisedMessage` model, one dispatcher, one preference model, one retry engine.** (§5.4)
37. **Split `reminder.materialise` (pure DB, every 30 s) from `notification.deliver` (network, every 10 s, `FOR UPDATE SKIP LOCKED`)** so that "fired" is independent of "delivered". (§6.2)
38. **Dedupe on `${kind}:${entity}:${id}:${reminder_id}:${occurrence_at}:${channel_id}` with a unique index and `ON CONFLICT DO NOTHING`.** Include `occurrence_at` or recurring reminders fire once ever. (§6.3)
39. **Supersede pending deliveries in the same transaction as the entity change** (task completed, reminder edited, task reassigned). (§6.3)
40. **Catch-up window of 60 minutes; beyond that, in-app only.** Quiet hours evaluated in the recipient's zone, overridden only by priority 4, never suppressing in-app. (§6.3)
41. **Ship the "Arribarà a:" component in the reminder editor**, driven by `GET /api/v1/notifications/health`. It is the single highest-value UI element in this whole feature. (§6.4)
42. **Never let AI-scoped tokens read subscriptions or email addresses, or trigger sends.** Notification endpoints are human-scope only; notification *actions* write normal audit rows. (§6.6, §6.7)

---

## Sources

Primary sources actually fetched on 2026-08-05.

**RFCs and specifications**

- RFC 8030, *Generic Event Delivery Using HTTP Push* — https://www.rfc-editor.org/rfc/rfc8030.txt
- RFC 8291, *Message Encryption for Web Push* — https://www.rfc-editor.org/rfc/rfc8291.txt
- RFC 8292, *Voluntary Application Server Identification (VAPID) for Web Push* — https://www.rfc-editor.org/rfc/rfc8292.txt
- W3C Push API editor's draft (IDL, declarative push message parser, `pushsubscriptionchange`, error conditions) — https://w3c.github.io/push-api/
- RFC 9989, *Domain-Based Message Authentication, Reporting, and Conformance (DMARC)* — https://datatracker.ietf.org/doc/rfc9989/

**MDN / compatibility data**

- MDN `PushSubscription` — https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription
- MDN `ServiceWorkerRegistration.showNotification()` (full options dictionary, `TypeError` conditions) — https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification
- MDN Badging API — https://developer.mozilla.org/en-US/docs/Web/API/Badging_API
- MDN `Notification.requestPermission()` — https://developer.mozilla.org/en-US/docs/Web/API/Notification/requestPermission_static
- MDN browser-compat-data, `api/Navigator.json` (setAppBadge / clearAppBadge) — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Navigator.json
- MDN browser-compat-data, `api/Notification.json` (actions, tag, renotify, silent, image, vibrate, requireInteraction) — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/Notification.json
- MDN browser-compat-data, `api/ServiceWorkerGlobalScope.json` (push, notificationclick, notificationclose, pushsubscriptionchange) — https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/ServiceWorkerGlobalScope.json
- caniuse feature data: `push-api`, `notifications`, `serviceworkers`, plus agent current versions — https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/push-api.json and https://raw.githubusercontent.com/Fyrd/caniuse/main/fulldata-json/data-2.0.json

**Apple / WebKit**

- *Meet Web Push* (macOS Ventura, `webpushd`, user gesture, `userVisibleOnly`) — https://webkit.org/blog/12945/meet-web-push/
- *Web Push for Web Apps on iOS and iPadOS* (16.4, Home Screen requirement, badging, Focus) — https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- *Meet Declarative Web Push* — https://webkit.org/blog/16535/meet-declarative-web-push/
- *WebKit Features in Safari 18.4* — https://webkit.org/blog/16687/webkit-features-in-safari-18-4/

**Google / Chrome**

- Chrome for Developers, *Notification Triggers API* (development ended) — https://developer.chrome.com/docs/web-platform/notification-triggers
- Chrome Platform Status feature 5133150283890688, *Notification Triggers* (API JSON) — https://chromestatus.com/api/v0/features/5133150283890688
- web.dev, *Push notifications permissions UX* — https://web.dev/articles/push-notifications-permissions-ux
- web.dev, *Common notification patterns* (tag/renotify, `getNotifications`, `clients.matchAll`, "This site has been updated in the background") — https://web.dev/articles/push-notifications-common-notification-patterns
- web.dev, *The Web Push protocol* (headers, status codes, legacy `aesgcm` form) — https://web.dev/articles/push-notifications-web-push-protocol
- Workbox, *workbox-precaching* — https://developer.chrome.com/docs/workbox/modules/workbox-precaching
- Gmail *Email sender guidelines* (all-sender and bulk-sender requirements, effective 2024-02-01) — https://support.google.com/a/answer/81126
- Google Cloud, *Sending email from an instance* (port 25 blocked; 587/465 unrestricted) — https://docs.cloud.google.com/compute/docs/tutorials/sending-mail

**Mozilla**

- Mozilla Future Releases, *Restricting Notification Permission Prompts in Firefox* (1.45 B prompts / 23.66 M accepted / 48% denied / ~500 M "Not Now") — https://blog.mozilla.org/futurereleases/2019/11/04/restricting-notification-permission-prompts-in-firefox/
- Mozilla Hacks, *Upcoming notification permission changes in Firefox 72* (user-interaction requirement; promise rejected; address-bar icon) — https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/

**Libraries and registries**

- `web-push` npm registry metadata (3.6.7, 2024-01-16, MPL-2.0, node ≥ 16) — https://registry.npmjs.org/web-push
- `web-push` repository metadata, commits and master `package.json` — https://api.github.com/repos/web-push-libs/web-push
- `web-push` source: `src/web-push-lib.js`, `src/vapid-helper.js`, `src/web-push-error.js` — https://raw.githubusercontent.com/web-push-libs/web-push/master/src/
- `web-push` README — https://github.com/web-push-libs/web-push
- `webpush-webcrypto` (1.0.5), `@block65/webcrypto-web-push` (1.0.2) — npm registry
- `nodemailer` registry metadata (9.0.4, 2026-08-04, MIT-0) and repository — https://registry.npmjs.org/nodemailer, https://github.com/nodemailer/nodemailer
- Nodemailer DKIM documentation — https://nodemailer.com/dkim
- npm registry metadata for `mjml` 5.4.0, `react-email` 6.9.1, `@react-email/components` 1.0.12, `maizzle` 1.2.4, `juice` 12.1.2, `html-to-text` 10.0.0, `handlebars` 4.7.9, `nodemailer-express-handlebars` 7.0.0, `emailjs` 5.0.2, `i18next` 26.3.6, `bullmq` 6.0.8, `node-cron` 4.6.0, `croner` 10.0.1, `@types/web-push` 3.6.4, `mjml-react` 2.0.8

**Self-hosted notification projects**

- ntfy publishing API — https://docs.ntfy.sh/publish/
- ntfy subscription API — https://docs.ntfy.sh/subscribe/api/
- ntfy server configuration (Web Push keys, expiry defaults, UnifiedPush ACL, SMTP sender keys, key-rotation warning) — https://docs.ntfy.sh/config/
- Gotify OpenAPI specification 2.1.0 (`POST /message`, `CreateMessage`, token security definitions) — https://raw.githubusercontent.com/gotify/server/master/docs/spec.json
- Apprise repository (URL schemes, apprise-api container) — https://github.com/caronc/apprise
- UnifiedPush developer introduction (RFC 8030/8291/8292, `aes128gcm`, "use a Web Push library") — https://unifiedpush.org/developers/intro/

**Deliverability**

- Spamhaus Policy Blocklist (PBL) — https://www.spamhaus.org/blocklists/policy-blocklist/

**Build tooling**

- vite-plugin-pwa, *injectManifest* strategy (`strategies`, `srcDir`, `filename`, `self.__WB_MANIFEST`) — https://vite-pwa-org.netlify.app/guide/inject-manifest.html

---

## UNVERIFIED

Items I could not confirm against a primary source in this pass. Do not treat any of these as established fact; verify before relying on them.

1. **`notificationclick` / `notificationclose` on iOS Safari.** MDN browser-compat-data records `safari_ios: false` for `ServiceWorkerGlobalScope.notificationclick_event`, `notificationclose_event` and `pushsubscriptionchange_event`, while recording `push_event: 16.4`. A push event that can never produce a click event is implausible; I judge this a BCD data gap rather than a platform limitation, but I did not find a WebKit source confirming either way. The recommended mitigation (rely on Declarative Web Push's `navigate` on Apple) is correct regardless.

2. **`app_badge` in Declarative Web Push.** The WebKit blog describes an `app_badge` member on the declarative `notification` object. The W3C Push API editor's draft fetched on 2026-08-05 contains zero occurrences of `app_badge`; it lists only `badge` (an icon URL from `NotificationOptions`). Whether `app_badge` is WebKit-only, renamed, or pending spec merge is unresolved.

3. **Content-Type for Declarative Web Push.** I could not confirm whether a specific `Content-Type` (e.g. `application/notification+json`) must be sent alongside the encrypted body, or whether the user agent simply attempts to parse every decrypted payload as JSON. The spec text describes the parser as opportunistic (*"A user agent opportunistically parses each incoming push message"*), which suggests no special content type is needed, but I did not find an explicit statement.

4. **Chrome and Firefox support for Declarative Web Push.** Only Apple shipping (iOS/iPadOS 18.4, macOS 15.5) was confirmed. No Chromium or Gecko shipping status was verified.

5. **Which UnifiedPush specification version made RFC 8291 encryption mandatory**, and whether every current distributor (ntfy, NextPush, Sunup, FCM-UP proxies) handles `aes128gcm` correctly. The UnifiedPush intro page states encryption follows RFC 8291 and that `content-encoding` must be `aes128gcm`, but not the version history or per-distributor conformance.

6. **Nodemailer SMTP transport option table.** `https://nodemailer.com/smtp/` returned HTTP 404 in this pass, so the exact option names, defaults for ports 465/587/25, `pool`/`maxConnections`/`rateDelta`/`rateLimit` semantics and `verify()` behaviour in §4.3 were assembled from the README and general practice rather than re-read from the option reference. Verify against the live docs before implementation. The DKIM option table **was** fetched and is verified.

7. **RFC numbers for SPF and DKIM.** I cite SPF as RFC 7208 and DKIM as RFC 6376 from prior knowledge; I did not re-fetch either in this pass. RFC 9989/9990/9991 for DMARC **were** verified against the IETF datatracker.

8. **Gmail's exact current bulk-sender threshold wording** was fetched and is verified as 5,000+/day effective 2024-02-01, but I did not verify whether the requirements have been tightened since (e.g. a lowered threshold or a mandated `p=quarantine`) between 2024 and August 2026.

9. **iOS installed-web-app limits and storage eviction.** Apple's post states no limit on the number of installed web apps and no eviction policy. Whether iOS 26.x evicts Home Screen web app storage (and therefore push subscriptions) under pressure, and on what schedule, is unverified. The reconciliation-on-open pattern is recommended precisely because of this uncertainty.

10. **Chrome Android Badging API.** MDN BCD records `setAppBadge: false` but `clearAppBadge: 81` for Chrome Android. This asymmetry is almost certainly a data error, but I could not determine which side is wrong. Treat badging on Chrome Android as unavailable.

11. **`web-push` v4 / ESM release timing.** `master` declares `"type": "module"` while the published 3.6.7 is CommonJS. No release announcement, milestone or changelog entry confirming a planned major version was found; the ESM migration is inferred from the `package.json` on `master`.

12. **Removal date of legacy Safari Push Notifications.** caniuse note #3 (*"Safari 7.0 - 26.3 supported Safari Push Notifications"*) implies removal in Safari 26.4, but I did not fetch an Apple source confirming the deprecation/removal announcement.

13. **Exact behaviour of `PushSubscription.expirationTime` in shipping browsers.** The spec defines it; in practice it is reported as `null` everywhere relevant. I did not verify per-browser behaviour, so the 55/60-day expiry heuristic is modelled on ntfy's defaults rather than on any browser guarantee.

14. **MDN's `PushSubscription.subscriptionId`.** MDN's page lists it; the spec IDL does not. Whether it is a stale MDN entry or a vendor extension is unresolved. Do not use it.

15. **`FEMHO_*` environment variable names.** The `FEMHO_SMTP_*` prefix comes from dossier 11; the new `FEMHO_VAPID_*`, `FEMHO_REMINDER_*`, `FEMHO_SUBSCRIPTION_*`, `FEMHO_NTFY_*` and `FEMHO_WEBHOOK_*` names are proposals in this dossier, not existing decisions, and should be reconciled with dossier 11's naming conventions.

16. **Whether the operator's chosen relay supports `List-Unsubscribe` one-click (RFC 8058) POST handling.** Recommended as good practice; not verified per provider, and not required at family scale.
