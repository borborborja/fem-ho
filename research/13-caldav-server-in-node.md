# Fem-ho — Gap Dossier 1: How to actually build a conformant CalDAV server in Node/TypeScript

> **Path note.** The requested output path was
> `/Users/borja/.claude/plans/elabora-unes-instruccions-md-per-witty-snowflake-gap1.md`.
> The harness is in plan mode and permits writing to exactly one file, so this dossier lives at
> `/Users/borja/.claude/plans/elabora-unes-instruccions-md-per-witty-snowflake-agent-a70a63def6996f52a.md`.
> Rename/copy it to the `-gap1.md` name when plan mode is lifted.

**The question this dossier closes.** Dossier 03 §11.2 asserted "There is no production-grade CalDAV *server* library for Node. You will hand-roll the XML… budget accordingly, or put the DAV layer in Go/Python", and dossier 08 §1.2 turned that into the decisive argument for Go ("2–4x the CalDAV effort"). The user has since fixed the stack as TypeScript/Node + Kotlin. That leaves milestone M8 (bidirectional CalDAV per scope and per project) as the single largest feature in Fem-ho with an excellent protocol spec and **zero** researched implementation path in the mandated runtime. This dossier answers, from primary sources: does Node's HTTP stack even accept `PROPFIND`/`REPORT`/`MKCALENDAR`; which framework you can safely put underneath a DAV router and which ones silently swallow those verbs; which XML library survives contact with DAVx⁵ and Apple; whether any Node CalDAV *server* code exists worth reusing (**it does, and dossier 03's finding is now wrong**); how to consume external calendars in the reverse direction; whether an in-process DAV layer or a sidecar is defensible; and how to test conformance in CI. It ends with a pinned package list, a skeleton `PROPFIND`/`REPORT`/`PUT` handler in TypeScript, and a table of the DAVx⁵/Apple quirks that the *Node* stack specifically makes harder.

---

## 0. Executive verdict (read this if you read nothing else)

1. **Node's HTTP parser accepts every CalDAV verb.** llhttp — the parser vendored into Node — has a fixed method table that already contains `COPY(8)`, `LOCK(9)`, `MKCOL(10)`, `MOVE(11)`, `PROPFIND(12)`, `PROPPATCH(13)`, `SEARCH(14)`, `UNLOCK(15)`, `ACL(19)`, `REPORT(20)`, `MKACTIVITY(21)`, `MKCALENDAR(30)`. Nothing to configure, no allow-list, no flag. This risk is **zero**. (Verified against `deps/llhttp/include/llhttp.h` on `nodejs/node@main`, LLHTTP 9.4.3.)
2. **Dossier 03 §11.2 is factually out of date.** `caldav-adapter@9.3.12` (MIT, maintained by Forward Email, Node ≥18) is a working Node CalDAV *server* that implements `calendar-query`, `calendar-multiget`, **`sync-collection` (RFC 6578)** and `expand-property`, plus `PROPFIND`/`PROPPATCH`/`MKCALENDAR`/`PUT`/`GET`/`DELETE` and scheduling, and it runs in production against Apple clients. It is Koa middleware and its data-store contract is undocumented, so it is better used as a **reference implementation and fixture source** than as a dependency — but its existence collapses the "2–4x vs Go" estimate.
3. **The XML stack that works is already known**: `@xmldom/xmldom` (namespace-aware DOM) + `xpath` (with `useNamespaces`) for *parsing*, `xmlbuilder2` for *serialising*. That is exactly what caldav-adapter uses and it is validated against iOS/macOS. Do **not** use `fast-xml-parser` or `xml2js` for the DAV request side — they are not namespace-aware and will make you match on prefixes, which is the actual DAVx⁵-vs-Apple footgun.
4. **The "namespace prefix preservation" fear is aimed at the wrong half.** Serialisation is easy (any prefix works; clients compare namespace URI + local name). The danger is on *parse*: DAVx⁵, Apple, Thunderbird and Evolution all use different prefixes and some use a default `xmlns="DAV:"`. A prefix-keyed parser breaks on the second client you test.
5. **Framework verdict**: raw `node:http` (or a ~120-line router over it) is the lowest-risk host for the DAV surface. Fastify 5 works but **silently 404s** unknown verbs until you call `addHttpMethod`, and then **415s** XML bodies until you register a content-type parser. Express 5 exposes `app.propfind()`/`app.report()` because the `methods` package derives from `http.METHODS` at runtime — but Express 5 also switched to path-to-regexp 8 (`*` is no longer a valid wildcard). Hono works via `app.on('PROPFIND', …)` but the Node adapter round-trips through a WHATWG `Request`, which adds body/duplex caveats.
6. **In-process TypeScript is defensible; a sidecar is not.** The sidecar's hard problem is not XML, it is that `ctag`, `sync-token` and `ETag` must be produced by a single transactional writer. Radicale/Xandikos would each need a custom storage plugin written in Python that reimplements Fem-ho's task↔VTODO mapping — you'd write the mapping twice, in two languages, with two transaction boundaries. Strictly worse than writing the DAV layer in TS.
7. **Budget ≈ 40–60 developer-days** for a v1 that satisfies DAVx⁵ + Apple Reminders + Thunderbird + Evolution + Nextcloud Tasks, of which the *XML* is maybe 5 days and the `calendar-query` time-range/recurrence expansion plus real-client debugging is more than half.
8. **Test in CI with python-caldav's functional suite pointed at your server**, plus golden-transcript snapshot tests built from real captured DAVx⁵/Apple request bodies, plus a Docker Compose "diff harness" running Radicale + Xandikos + Baïkal so you can compare your responses against three independent implementations. Apple's `ccs-caldavtester` is **archived** and Python 2 — mine it for XML fixtures, do not depend on it.

---

## 1. The HTTP layer — does Node accept the verbs?

### 1.1 llhttp's method table (authoritative)

Node does not implement its own HTTP parser; it vendors **llhttp**. The method table is a compile-time enum in `deps/llhttp/include/llhttp.h`. On `nodejs/node@main` the version constants are:

```
LLHTTP_VERSION_MAJOR  9
LLHTTP_VERSION_MINOR  4
LLHTTP_VERSION_PATCH  3
```

and the WebDAV/CalDAV-relevant entries of `HTTP_ALL_METHOD_MAP` are:

| Method | llhttp value | Needed by Fem-ho |
|---|---|---|
| `DELETE` | 0 | yes |
| `GET` | 1 | yes |
| `HEAD` | 2 | yes |
| `POST` | 3 | (scheduling outbox only) |
| `PUT` | 4 | yes |
| `OPTIONS` | 6 | yes |
| `COPY` | 8 | optional (RFC 4918) |
| `LOCK` | 9 | optional |
| `MKCOL` | 10 | yes (extended MKCOL, RFC 5689) |
| `MOVE` | 11 | optional |
| `PROPFIND` | 12 | **yes** |
| `PROPPATCH` | 13 | **yes** |
| `SEARCH` | 14 | no |
| `UNLOCK` | 15 | optional |
| `ACL` | 19 | optional (RFC 3744) |
| `REPORT` | 20 | **yes** |
| `MKACTIVITY` | 21 | no |
| `PATCH` | 28 | no |
| `MKCALENDAR` | 30 | **yes** |

**Consequence:** there is no allow-list to configure, no `insecureHTTPParser` needed, no custom parser. A `PROPFIND` request reaches your `requestListener` with `req.method === 'PROPFIND'` on stock Node.

### 1.2 What happens for a method *not* in the table

llhttp raises `HPE_INVALID_METHOD` **before any JavaScript runs**. Node's `http.Server` surfaces this on the `'clientError'` event, whose documented default behaviour is:

> "Default behavior is to try close the socket with an HTTP '400 Bad Request', or an HTTP '431 Request Header Fields Too Large' in the case of an `HPE_HEADER_OVERFLOW` error."

So an unknown verb yields **400 Bad Request from the socket layer**, not a 501 from your app, and you cannot intercept it to return the RFC-correct `501 Not Implemented`. This matters only for RFC 3253 versioning verbs (`VERSION-CONTROL`, `CHECKIN`, `UNCHECKOUT`, `LABEL`, `MKWORKSPACE`, `MKREDIRECTREF`, `UPDATEREDIRECTREF`, `ORDERPATCH`, `BASELINE-CONTROL`) which nodejs/node#33699 documents as absent from the HTTP/1 side. **Fem-ho needs none of them.** CalDAV requires no verb outside the table above.

If you ever *do* need a verb outside the table, the only escapes are: (a) tunnel it via `X-HTTP-Method-Override` on `POST` (non-conformant, clients won't use it), or (b) terminate the connection in a non-llhttp server. Neither is required here.

### 1.3 `http.METHODS` and the derived ecosystem

Node exposes the parser's list as `require('node:http').METHODS`. Several ecosystem packages derive from it at runtime — most importantly `jshttp/methods`, whose entire logic is:

```js
module.exports = getCurrentNodeMethods() || getBasicNodeMethods()

function getCurrentNodeMethods () {
  return http.METHODS && http.METHODS.map(function lowerCaseMethod (method) {
    return method.toLowerCase()
  })
}
```

`methods` is what gives Express its `app.propfind()` / `app.report()` / `app.mkcol()` shorthands. Because it is derived dynamically, whatever llhttp supports, Express supports.

**Verification one-liner to run before writing any code (do this first):**

```bash
node -p "const m=require('node:http').METHODS; \
  ['PROPFIND','PROPPATCH','REPORT','MKCALENDAR','MKCOL','COPY','MOVE','LOCK','UNLOCK','ACL'] \
    .map(v=>v+'='+m.includes(v)).join(' ')"
```

Expected on Node 22/24: all `true`. (The exact printed contents of `http.METHODS` are marked UNVERIFIED below — the llhttp header is the primary source and it is unambiguous, but I did not capture the doc's literal array.)

### 1.4 HTTP/2 and `node:http2`

In HTTP/2 the method is just the `:method` pseudo-header, an arbitrary token, so there is no method table to pass. nodejs/node#33699 (filed 2020, Node 14) reported an *asymmetry* between the two stacks — HTTP/1 lacking `BASELINE-CONTROL, CHECKIN, LABEL, MKREDIRECTREF, MKWORKSPACE, ORDERPATCH, PRI, UNCHECKOUT, UPDATE, UPDATEREDIRECTREF, VERSION-CONTROL`, and HTTP/2 lacking `M-SEARCH, NOTIFY, PURGE, SOURCE, SUBSCRIBE, UNSUBSCRIBE`. Both lists are stale (llhttp now has `SOURCE(33)` and `PRI(34)`), and none of the listed verbs is used by CalDAV.

**Recommendation for Fem-ho:** serve the DAV surface over **HTTP/1.1** at the origin. Let the reverse proxy speak h2/h3 to the client and downgrade to HTTP/1.1 upstream. Reasons: (a) `Expect: 100-continue`, `Depth`, chunked 207 bodies and `If-Match` semantics are all better exercised on h1 by every DAV client; (b) Node's `http2` compat layer (`Http2ServerRequest`/`Http2ServerResponse`) is a shim, and DAV edge cases there are untested territory; (c) DAVx⁵ (OkHttp) and Apple's CalendarAgent negotiate h2 only over TLS and fall back cleanly.

### 1.5 Reverse-proxy and infrastructure caveats

Fem-ho is self-hosted behind whatever the household runs. Things that break DAV verbs at the edge (flag these in the deployment docs):

- **nginx** passes arbitrary methods through `proxy_pass` by default. It breaks if someone adds `limit_except GET POST { deny all; }`. Also set `client_max_body_size` above your `PUT` limit and `proxy_request_buffering off` is *not* needed.
- **Traefik / Caddy** pass arbitrary methods by default.
- **Cloudflare and most WAFs block `PROPFIND` by default** as a scanner signature. If the household proxies Fem-ho through Cloudflare, CalDAV will fail with 403 before reaching Node. Document a WAF exception rule or recommend a direct tunnel. *(Marked UNVERIFIED — widely reported, not fetched from Cloudflare docs in this pass.)*
- **Any CDN or cache in front must not cache `PROPFIND`/`REPORT`.** They are POST-like reads with bodies.

### 1.6 Framework matrix

| | registers arbitrary verbs? | failure mode if you don't | raw body | 207 streaming |
|---|---|---|---|---|
| raw `node:http` | n/a — `req.method` is a string you `switch` on | none | native stream | native `res.write()` |
| **Fastify 5.11.2** | yes, via `fastify.addHttpMethod(...)` | **silently 404s** (`Route PROPFIND:/dav not found`) | needs `addContentTypeParser` or **415** | `reply.raw` or a `Readable` payload |
| **Hono 4.13.0** + `@hono/node-server` 2.1.0 | yes, `app.on('PROPFIND', path, h)` | 404 from Hono's not-found handler | `c.req.text()` / `c.req.raw.body` | return `new Response(stream, {status:207})` |
| **Express 5** | yes, `app.propfind()` via `methods`; or `app.all()` | 404 from the final handler | must avoid global `express.json()` | `res.writeHead(207,…)` + `res.write()` |

Nobody emits `501 Not Implemented` for free; **all four silently 404** unless you add a catch-all that maps unhandled DAV verbs to 501. That matters because RFC 4918 clients probe with `OPTIONS` and then assume; a 404 on `PROPFIND` of a collection is a *legal* answer and will send clients down a confusing "collection does not exist" path instead of "server doesn't do DAV".

#### 1.6.1 Raw `node:http` — recommended

```ts
// packages/caldav/src/http/server.ts
import http, { IncomingMessage, ServerResponse } from 'node:http';

const DAV_METHODS = new Set([
  'OPTIONS', 'GET', 'HEAD', 'PUT', 'DELETE',
  'PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR', 'MKCOL',
  'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'ACL',
]);

const server = http.createServer(
  {
    // Keep the parser strict. Never enable insecureHTTPParser for a DAV server.
    maxHeaderSize: 32 * 1024,          // Apple sends long If: / Destination headers
    requestTimeout: 120_000,           // large calendar-multiget bodies
    keepAliveTimeout: 65_000,
    joinDuplicateHeaders: true,        // Destination/Overwrite must not be arrays
  },
  async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url?.startsWith('/dav/')) return notFound(res);
    if (!DAV_METHODS.has(req.method ?? '')) {
      res.writeHead(501, { Allow: [...DAV_METHODS].join(', ') });
      return res.end();
    }
    await davRouter(req, res);
  },
);

// llhttp rejects unknown verbs before we get here; log them so you can see scanners.
server.on('clientError', (err: NodeJS.ErrnoException, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

// If you ever attach checkContinue you MUST answer it, or Apple's PUT will hang.
server.on('checkContinue', (req, res) => {
  res.writeContinue();
  server.emit('request', req, res);
});

server.listen(3001);
```

Raw body, with a hard cap, no framework in the way:

```ts
// packages/caldav/src/http/body.ts
import type { IncomingMessage } from 'node:http';

export const MAX_DAV_BODY = 10 * 1024 * 1024; // caldav-adapter uses the same 10 MiB

export async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_DAV_BODY) {
      req.destroy();
      throw Object.assign(new Error('entity too large'), { status: 413 });
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readXmlBody(req: IncomingMessage): Promise<string | null> {
  const ct = (req.headers['content-type'] ?? '').toLowerCase();
  // Apple sends `text/xml; charset="utf-8"`, DAVx5 sends `application/xml; charset=utf-8`.
  if (!ct.includes('xml')) return null;
  const buf = await readRawBody(req);
  const text = buf.toString('utf8').trim();
  return text.length > 0 ? text : null;
}
```

Streamed 207:

```ts
// packages/caldav/src/http/multistatus.ts
import type { ServerResponse } from 'node:http';

export const DAV_COMPLIANCE = '1, 2, 3, access-control, calendar-access, extended-mkcol';

export function beginMultistatus(res: ServerResponse): void {
  res.writeHead(207, {
    // The charset parameter is required in practice; Evolution is picky without it.
    'Content-Type': 'application/xml; charset=utf-8',
    DAV: DAV_COMPLIANCE,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Vary: 'Brief, Prefer',
    // NO Content-Length -> Node uses chunked transfer-encoding, which is what we want
    // so we can stream thousands of <D:response> without buffering.
  });
  res.write('<?xml version="1.0" encoding="utf-8"?>\n');
  res.write(
    '<D:multistatus xmlns:D="DAV:" ' +
      'xmlns:C="urn:ietf:params:xml:ns:caldav" ' +
      'xmlns:CS="http://calendarserver.org/ns/" ' +
      'xmlns:IC="http://apple.com/ns/ical/">\n',
  );
}

export function writeResponseNode(res: ServerResponse, xml: string): boolean {
  // honour backpressure — a 5000-task calendar-query will otherwise blow up RSS
  return res.write(xml);
}

export function endMultistatus(res: ServerResponse, syncToken?: string): void {
  if (syncToken) res.write(`  <D:sync-token>${syncToken}</D:sync-token>\n`);
  res.write('</D:multistatus>\n');
  res.end();
}
```

Backpressure-correct streaming loop:

```ts
async function streamResponses(res: ServerResponse, source: AsyncIterable<string>) {
  for await (const chunk of source) {
    if (!res.write(chunk)) {
      await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  }
}
```

#### 1.6.2 Fastify 5.11.2

Fastify's default verb set is documented as `GET, HEAD, TRACE, DELETE, OPTIONS, PATCH, PUT, POST` **and `QUERY`**. Everything else must be declared:

```ts
import Fastify from 'fastify';
const fastify = Fastify({ bodyLimit: 10 * 1024 * 1024 });

// Verbatim from the Fastify docs (Reference/Server.md):
//   fastify.addHttpMethod('COPY')
//   fastify.addHttpMethod('MKCOL', { hasBody: true })
//   fastify.mkcol('/', (req, reply) => { /* Handle the 'MKCOL' request */ })
// Options: { hasBody?: boolean (default false), overrideExisting?: boolean (default false) }

for (const m of ['PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR', 'MKCOL', 'LOCK'] as const) {
  fastify.addHttpMethod(m, { hasBody: true });
}
for (const m of ['COPY', 'MOVE', 'UNLOCK'] as const) {
  fastify.addHttpMethod(m); // hasBody defaults to false
}

// Without this, any XML body on a hasBody:true method yields 415 Unsupported Media Type.
fastify.addContentTypeParser(
  ['application/xml', 'text/xml', 'application/xml; charset=utf-8'],
  { parseAs: 'buffer' },
  (_req, body, done) => done(null, body),          // hand back the raw Buffer, do not parse here
);
// Belt and braces: DAVx5 occasionally omits Content-Type on empty PROPFIND bodies.
fastify.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

fastify.propfind('/dav/*', async (req, reply) => {
  const xml = (req.body as Buffer | undefined)?.toString('utf8') ?? '';
  reply.raw.writeHead(207, {
    'Content-Type': 'application/xml; charset=utf-8',
    DAV: '1, 2, 3, access-control, calendar-access',
  });
  reply.raw.write('<?xml version="1.0" encoding="utf-8"?>\n<D:multistatus xmlns:D="DAV:">…');
  reply.raw.end('</D:multistatus>');
  reply.hijack();          // tell Fastify we own the socket now
});
```

Notes and traps:
- `fastify.addHttpMethod` **overrides existing methods** unless you understand `overrideExisting`; the docs carry an explicit warning.
- Fastify's router is `find-my-way`. Before `addHttpMethod`, a `PROPFIND` request produces Fastify's standard not-found payload — a **JSON 404**, which is doubly confusing to a DAV client expecting XML.
- Use `reply.hijack()` + `reply.raw` for streamed 207s, otherwise Fastify's serialiser and `Content-Length` logic fight you.
- Fastify normalises and validates bodies for `POST, PUT, PATCH, TRACE, SEARCH, PROPFIND, PROPPATCH, LOCK` — i.e. it already knows some DAV verbs carry bodies. `REPORT` and `MKCALENDAR` are not in that list; that's why you pass `hasBody: true`.

#### 1.6.3 Hono 4.13.0 + `@hono/node-server` 2.1.0

Hono's documented API for non-standard verbs (verbatim from the routing docs):

```ts
app.on('PURGE', '/cache', (c) => c.text('PURGE Method /cache'))

app.on(['PUT', 'DELETE'], '/post', (c) =>
  c.text('PUT or DELETE /post')
)

app.all('/hello', (c) => c.text('Any Method /hello'))
```

For Fem-ho:

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();

app.on(
  ['PROPFIND', 'PROPPATCH', 'REPORT', 'MKCALENDAR', 'MKCOL', 'COPY', 'MOVE'],
  '/dav/*',
  async (c) => {
    const xml = await c.req.text();                 // raw body, no JSON interference
    const body = new ReadableStream<Uint8Array>({ /* … */ });
    return new Response(body, {
      status: 207,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        DAV: '1, 2, 3, access-control, calendar-access',
      },
    });
  },
);

serve({ fetch: app.fetch, port: 3001 });
```

Caveats specific to the Node adapter (`@hono/node-server` 2.1.0, engines `node >= 20`, peer `hono ^4`):
- It converts the Node `IncomingMessage` into a WHATWG `Request`. Constructing a `Request` with a body requires `duplex: 'half'` in Node's undici, and the spec forbids a body on `GET`/`HEAD`. **Verify that your pinned adapter version forwards bodies for `PROPFIND`/`REPORT`** — historically adapters key off `method !== 'GET' && method !== 'HEAD'`, which is correct, but confirm with a test. *(UNVERIFIED — not read from the adapter source in this pass.)*
- The `Request` path also means `c.req.raw.headers` is a `Headers` object: header names are case-insensitive there, which is fine, but `Depth` arrives as `depth`.
- If Fem-ho's REST API and the DAV surface share one Hono app, ensure no global body-parsing middleware runs before `/dav/*`.

#### 1.6.4 Express 5

```ts
import express from 'express';
const app = express();

// Express derives verb shorthands from `methods`, which is `http.METHODS` lowercased,
// so these exist at runtime on any Node that has the llhttp table above:
app.propfind('/dav/{*splat}', davPropfind);
app.report('/dav/{*splat}', davReport);
app.proppatch('/dav/{*splat}', davProppatch);
app.mkcol('/dav/{*splat}', davMkcol);

// `mkcalendar` is NOT in the Express docs' enumerated verb list. Check at boot:
if (typeof (app as any).mkcalendar !== 'function') {
  throw new Error('Express has no mkcalendar shorthand; use app.all() dispatch');
}

// Safest pattern overall — one catch-all, dispatch on req.method yourself:
app.all('/dav/{*splat}', (req, res, next) => {
  switch (req.method) {
    case 'PROPFIND':   return davPropfind(req, res, next);
    case 'REPORT':     return davReport(req, res, next);
    case 'MKCALENDAR': return davMkcalendar(req, res, next);
    default:           return res.status(501).set('Allow', ALLOW).end();
  }
});
```

Express 5 traps:
- **path-to-regexp 8**: the bare `*` wildcard is gone. Use `'/dav/{*splat}'` or `'/dav/*splat'`. A literal `'/dav/*'` throws at mount time. This bites every Express 4→5 migration.
- **Never mount `express.json()` / `express.urlencoded()` above the DAV router.** They consume the stream and you will get an empty `PROPFIND` body with no error. Mount body parsers *inside* the REST router only.
- Express decodes route params with `decodeURIComponent`. Calendar object hrefs contain percent-encoded UIDs (`%2F`, `%40`, `%3A`). Double-decoding turns `foo%2Fbar.ics` into a path traversal. Read `req.url` raw and decode exactly once, yourself.
- `router.all()` matches all verbs — including the ones you did not intend to answer. Always terminate with an explicit 501.
- The docs note `router.query()` is "gated by the runtime and requires Node.js >= 20.19.3 <21 || >= 22.2.0" — evidence that Express 5's verb list is runtime-derived, which is what makes `propfind`/`report` available.

### 1.7 Response mechanics you must get right in Node

| Concern | Node specifics |
|---|---|
| **Status 207** | `res.writeHead(207, …)`. Node has no special-casing; the reason phrase defaults to `Multi-Status`. Do not send a body-less 207. |
| **Content-Type** | `application/xml; charset=utf-8`. `text/xml` also works. **Always include `charset`** — Evolution and some Thunderbird builds mis-decode non-ASCII display names (Catalan `Família`, `Feina`) without it. |
| **Content-Length vs chunked** | Omit `Content-Length` and Node switches to `Transfer-Encoding: chunked` automatically. All five target clients handle chunked 207s. This is what makes streaming possible. |
| **`DAV:` header** | Node will not generate it. Send on **every** response including `OPTIONS`, `PROPFIND` and errors: `DAV: 1, 2, 3, access-control, calendar-access`. RFC 4791 requires `calendar-access`; RFC 6578 support is signalled via `sync-collection` in `DAV:supported-report-set`, not the header. |
| **`Allow:` header** | Node does not auto-generate it for `OPTIONS`. You must enumerate every verb the resource accepts, per-resource (a calendar collection allows `MKCALENDAR`? no — its *parent* does). |
| **Header case** | `req.headers` keys are always lowercased by Node: `depth`, `if-match`, `if-none-match`, `destination`, `overwrite`, `prefer`, `brief`. |
| **Duplicate headers** | Node joins duplicates with `, ` (except `set-cookie`). Set `joinDuplicateHeaders: true` explicitly so `Destination` can never surprise you as an array. |
| **`Expect: 100-continue`** | Apple clients send this on `PUT`. If **no** `'checkContinue'` listener is attached, Node auto-replies `100 Continue` and emits `'request'` — fine. The moment you attach one (e.g. to auth before accepting a 1 MB body) you **must** call `res.writeContinue()` or the client hangs until timeout. This is the single most Node-specific DAV footgun. |
| **204 / 304** | Node refuses to send a body on 204/304. `DELETE` → `204 No Content` with no `ETag`. |
| **`ETag` quoting** | Node passes the string through verbatim. Emit strong quoted etags (`"a1b2…"`). Accept `W/"…"` on `If-Match` by stripping the `W/` prefix before comparing. |
| **HEAD** | Node will suppress the body for you if you `res.end(body)` on a HEAD request, but it will **not** compute `Content-Length` — set it explicitly so clients can size the GET. |

---

## 2. XML — parse and serialise

### 2.1 The four namespaces

| Prefix (conventional) | URI | Used for |
|---|---|---|
| `D` / `d` / `DAV` | `DAV:` | RFC 4918 core: `multistatus`, `response`, `propstat`, `prop`, `href`, `status`, `resourcetype`, `displayname`, `getetag`, `getcontenttype`, `current-user-principal`, `supported-report-set`, `sync-collection`, `sync-token`, `sync-level` |
| `C` / `cal` / `CAL` | `urn:ietf:params:xml:ns:caldav` | RFC 4791: `calendar`, `calendar-home-set`, `calendar-query`, `calendar-multiget`, `calendar-data`, `filter`, `comp-filter`, `prop-filter`, `param-filter`, `time-range`, `text-match`, `supported-calendar-component-set`, `supported-calendar-data`, `calendar-description`, `max-resource-size`, `calendar-user-address-set`, `schedule-inbox-URL`, `schedule-outbox-URL` |
| `CS` | `http://calendarserver.org/ns/` | `getctag`, `calendar-proxy-read-for`, `calendar-proxy-write-for`, `push-transports`, `pushkey`, `subscribed-strip-alarms` |
| `IC` / `A` | `http://apple.com/ns/ical/` | `calendar-color`, `calendar-order`, `refreshrate` |

DAVx⁵, Apple Calendar/Reminders, Thunderbird, Evolution and Nextcloud Tasks all read and write across all four. `IC:calendar-color` in particular is how Fem-ho's per-scope accent colour (Plou's 4 accents) reaches DAVx⁵'s collection list.

### 2.2 Library comparison

| Library | Version | Licence | Model | Namespace-aware **parse** | Namespace-aware **serialise** | Streaming | Verdict for Fem-ho |
|---|---|---|---|---|---|---|---|
| `@xmldom/xmldom` | **0.9.10** | MIT | DOM Level 2 Core (`DOMParser`, `XMLSerializer`) | **Yes** — `element.namespaceURI`, `.localName`, `.prefix`, `getElementsByTagNameNS()` | Yes via `createElementNS` | No (DOM) | **Use for parse.** Zero deps, `engines: node >= 14.6`. This is what caldav-adapter uses. |
| `xpath` | **0.0.34** (pin exact) | MIT | XPath 1.0 over a DOM | **Yes** — `xpath.useNamespaces({ D: 'DAV:', … })` | n/a | No | **Use with xmldom.** Pin exactly — caldav-adapter pins `"xpath": "0.0.34"` with no caret, which is a strong signal that minor bumps have broken it. |
| `xmlbuilder2` | **4.0.3** | MIT | DOM-backed fluent builder + serialiser | Yes (can parse too) | **Yes** — `.ele(ns, name)` overload, correct `xmlns` emission | Not truly streaming, but you can build one `<D:response>` at a time and `.end()` each | **Use for serialise.** caldav-adapter uses `^3.1.1`; 4.x is current. Deps: `@oozcitak/dom`, `@oozcitak/util`, `@oozcitak/infra`, `js-yaml`. |
| `saxes` | **6.0.0** | ISC | Streaming SAX | **Yes** with `{ xmlns: true }` — events carry `uri`, `local`, `prefix` | n/a (parser only) | **Yes** | Optional. Reach for it only if a `calendar-multiget` with thousands of `<D:href>` blows memory. Single dep (`xmlchars`), `engines: node >= 12.22.7`. |
| `fast-xml-parser` | **5.10.1** | MIT | JS-object parse/build | **No.** Only `removeNSPrefix: true` (destructive) or prefix-keyed objects | Prefix is just part of the key string | Partial | **Avoid on the DAV request path.** Forces prefix matching or destroys namespace info. Fine elsewhere in Fem-ho. |
| `xml2js` | 0.6.x | MIT | JS-object parse | No (prefix-keyed; `xmlns` option is awkward) | n/a | No | **Avoid.** This is what `nephele` uses and part of why extending nephele to CalDAV is unattractive. |
| `libxmljs2` | **0.37.0** | MIT | native libxml2 bindings | Yes, full XPath + namespace registration + XSD/RelaxNG validation | Yes | No | **Avoid.** `engines: node >= 22`, deps `nan`, `bindings`, `node-gyp`, `prebuild-install`. Native compilation in a multi-arch self-hosted Docker image (amd64 + arm64 for a Pi/NAS) is a support burden Fem-ho does not need. |
| `libxml2-wasm` | **0.7.1** | MIT | libxml2 compiled to WASM | Yes (libxml2 semantics) | Yes | No | Interesting escape hatch: real libxml2 XPath and schema validation with **no native build**, `engines: node >= 18`, zero runtime deps. Newer/less battle-tested for DAV. Keep as plan B if xmldom's XPath proves limiting. *(XPath namespace-registration and XSD APIs UNVERIFIED — not fetched.)* |

### 2.3 The prefix problem, correctly stated

XML Namespaces make prefixes **local aliases**; two documents that bind `DAV:` to `d` and to `A` are identical. Every serious client (DAVx⁵ via `dav4jvm`'s namespace-aware pull parser; Apple via libxml2; Thunderbird via `DOMParser`; Evolution via libxml2) compares `(namespaceURI, localName)`.

**So on serialise, any prefix works.** Two real rules:

1. **Declare all four namespaces once on `<D:multistatus>` and prefix everything.** Do not use a default namespace (`xmlns="DAV:"`) for the response. It is legal, but `DAV:` is a legacy scheme-only URI that some XML tooling mangles, and prefixed output is what every reference server emits — so it is the best-tested path.
2. **Never emit a prefix you have not declared in scope.** The classic bug is building `<D:prop>` with `xmlbuilder2` and inserting a pre-rendered `<C:calendar-data>` string fragment whose `C` was declared on a different root. Either declare `C` on the root, or re-declare it on the element itself.

**On parse the rule is absolute: never key on the prefix.** Observed reality:

- DAVx⁵ / `dav4jvm` writes a default `xmlns="DAV:"` with prefixed CalDAV/CardDAV namespaces. *(exact prefix letters UNVERIFIED — do not depend on them.)*
- Apple emits `<A:propfind xmlns:A="DAV:" xmlns:B="urn:ietf:params:xml:ns:caldav">` with single-letter sequential prefixes.
- Thunderbird/`caldav.js` and Evolution use `<D:…>` / `<C:…>`.
- Nextcloud Tasks (via the Nextcloud client stack) uses `<d:…>` / `<c:…>` lowercase.

A parser that hands you `"d:propfind"` as a key breaks on client #2. `@xmldom/xmldom` + `xpath.useNamespaces` makes this a non-issue because *you* pick the prefixes used in your XPath expressions and they are resolved against URIs.

### 2.4 `xmlns` redefinition mid-document

Legal and it happens: a client may redeclare `xmlns:C` on an inner element, or bind the same prefix to a different URI inside a subtree.

- `@xmldom/xmldom` handles this correctly — scoping is done at parse time and each node reports its own `namespaceURI`.
- `xpath.useNamespaces` is unaffected: your expressions name URIs, not document prefixes.
- `saxes` with `{ xmlns: true }` maintains the prefix→URI scope stack for you.
- `fast-xml-parser` / `xml2js` have **no concept of scope** — mid-document redefinition silently corrupts your interpretation. Another reason they are off the table.

### 2.5 CDATA, entities and safety

- **XXE / billion laughs.** Reject any body containing a DOCTYPE before parsing. `@xmldom/xmldom` does not resolve external entities, but internal entity expansion and DTD handling are still an attack surface for an untrusted-ish endpoint on a home network.
  ```ts
  const DOCTYPE_RE = /<!\s*(DOCTYPE|ENTITY)/i;
  if (DOCTYPE_RE.test(xmlText)) throw httpError(400, 'DTD not allowed');
  ```
- **Body cap.** 10 MiB, matching caldav-adapter's `raw(ctx.req, { encoding: true, limit: '10mb' })`. Enforce before parsing, not after.
- **`<C:calendar-data>` must be escaped text, not CDATA.** RFC 4791's examples put the iCalendar stream in as character data with `&`, `<`, `>` escaped. `xmlbuilder2`'s `.txt()` does this correctly. Do not "optimise" with CDATA — Evolution and older Thunderbird builds have historically mishandled it. *(client-specific CDATA breakage UNVERIFIED; the RFC-conformant path is escaped text, so just do that.)*
- **Control characters.** iCalendar bodies can contain `\r\n` (required) but must not contain raw control chars other than tab/CR/LF, which are invalid in XML 1.0. Strip/reject on `PUT` ingest so you can never fail to serialise later.
- **Round-trip fidelity.** Store the exact ICS bytes a client PUT, and echo those bytes in `calendar-data`. Re-serialising from your relational model on every read produces byte drift → ETag churn → infinite client resync. (See §5.3.)

### 2.6 Worked example A — parsing a DAVx⁵-style `PROPFIND`

Two shapes you must both handle. `allprop`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:">
  <allprop/>
</propfind>
```

and the far more common named-prop form (this is what DAVx⁵ sends during collection detection, with `Depth: 1`):

```xml
<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav"
          xmlns:CARD="urn:ietf:params:xml:ns:carddav"
          xmlns:CS="http://calendarserver.org/ns/"
          xmlns:IC="http://apple.com/ns/ical/">
  <prop>
    <resourcetype/>
    <displayname/>
    <current-user-privilege-set/>
    <sync-token/>
    <supported-report-set/>
    <CAL:calendar-description/>
    <CAL:calendar-timezone/>
    <CAL:supported-calendar-component-set/>
    <CS:getctag/>
    <IC:calendar-color/>
  </prop>
</propfind>
```

Parser:

```ts
// packages/caldav/src/xml/parse.ts
import { DOMParser } from '@xmldom/xmldom';
import xpath from 'xpath';

export const NS = {
  D:  'DAV:',
  C:  'urn:ietf:params:xml:ns:caldav',
  CS: 'http://calendarserver.org/ns/',
  IC: 'http://apple.com/ns/ical/',
  CARD: 'urn:ietf:params:xml:ns:carddav',
} as const;

export const select = xpath.useNamespaces(NS as unknown as Record<string, string>);

export function parseDavXml(text: string): Document {
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(text)) {
    throw Object.assign(new Error('DTD not allowed'), { status: 400 });
  }
  const doc = new DOMParser({
    // xmldom 0.9 signals problems through this handler rather than throwing
    onError: (level, msg) => { if (level === 'error' || level === 'fatalError') throw Object.assign(new Error(msg), { status: 400 }); },
  }).parseFromString(text, 'text/xml');
  if (!doc?.documentElement) {
    throw Object.assign(new Error('malformed XML'), { status: 400 });
  }
  return doc;
}

/** A property name as (namespaceURI, localName) — never a prefix. */
export interface PropName { ns: string; name: string }

export type PropfindRequest =
  | { kind: 'allprop'; include: PropName[] }
  | { kind: 'propname' }
  | { kind: 'prop'; props: PropName[] };

export function parsePropfind(text: string | null): PropfindRequest {
  // RFC 4918 §9.1: an empty body MUST be treated as `allprop`.
  // DAVx5 and Apple both rely on this for the /.well-known and principal probes.
  if (!text) return { kind: 'allprop', include: [] };

  const doc = parseDavXml(text);
  const root = doc.documentElement;
  if (root.namespaceURI !== NS.D || root.localName !== 'propfind') {
    throw Object.assign(new Error('expected DAV:propfind'), { status: 400 });
  }

  if ((select('/D:propfind/D:propname', doc) as Node[]).length) return { kind: 'propname' };

  if ((select('/D:propfind/D:allprop', doc) as Node[]).length) {
    const include = (select('/D:propfind/D:include/*', doc) as Element[]).map(toPropName);
    return { kind: 'allprop', include };
  }

  const props = (select('/D:propfind/D:prop/*', doc) as Element[]).map(toPropName);
  if (props.length === 0) return { kind: 'allprop', include: [] };
  return { kind: 'prop', props };
}

function toPropName(el: Element): PropName {
  return { ns: el.namespaceURI ?? '', name: el.localName ?? el.nodeName };
}

/** Depth handling — RFC 4918 §10.2. Node lowercases the header name. */
export function parseDepth(h: string | string[] | undefined, dflt: '0' | '1' | 'infinity'): '0' | '1' | 'infinity' {
  const v = (Array.isArray(h) ? h[0] : h)?.trim().toLowerCase();
  if (v === '0' || v === '1') return v;
  if (v === 'infinity') return 'infinity';
  return dflt;
}
```

`Depth: infinity` on a calendar collection must be refused, not silently downgraded:

```ts
if (depth === 'infinity') {
  // 403 with the RFC 4918 precondition element
  return errorResponse(res, 403, '<D:propfind-finite-depth/>');
}
```

### 2.7 Worked example B — parsing a real `calendar-query` REPORT

This is the exact body DAVx⁵, Nextcloud Tasks and Apple Reminders send to enumerate *incomplete* tasks (RFC 4791 §7.8.9). Fem-ho's kanban `Inbox / Per fer / Fent` columns are all "not done", so this query is the hot path:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VTODO">
        <C:prop-filter name="COMPLETED">
          <C:is-not-defined/>
        </C:prop-filter>
        <C:prop-filter name="STATUS">
          <C:text-match negate-condition="yes">CANCELLED</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>
```

and the time-ranged event variant Apple Calendar sends per visible month:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data>
      <C:comp name="VCALENDAR">
        <C:prop name="VERSION"/>
        <C:comp name="VEVENT">
          <C:prop name="SUMMARY"/><C:prop name="UID"/><C:prop name="DTSTART"/>
          <C:prop name="DTEND"/><C:prop name="RRULE"/>
        </C:comp>
      </C:comp>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20260801T000000Z" end="20260901T000000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>
```

Recursive filter parser:

```ts
// packages/caldav/src/xml/calendar-query.ts
import { NS, parseDavXml, select } from './parse.js';

export interface TimeRange { start?: Date; end?: Date }
export interface TextMatch { value: string; collation: string; negate: boolean }
export interface ParamFilter { name: string; isNotDefined: boolean; textMatch?: TextMatch }
export interface PropFilter {
  name: string;
  isNotDefined: boolean;
  timeRange?: TimeRange;
  textMatch?: TextMatch;
  paramFilters: ParamFilter[];
}
export interface CompFilter {
  name: string;                    // VCALENDAR | VEVENT | VTODO | VJOURNAL | VFREEBUSY | VALARM
  isNotDefined: boolean;
  timeRange?: TimeRange;
  propFilters: PropFilter[];
  compFilters: CompFilter[];
}

export interface CalendarQuery {
  props: { ns: string; name: string }[];
  calendarData?: CalendarDataSpec;   // the <C:calendar-data> sub-selection, if any
  filter: CompFilter;
  timezone?: string;                 // <C:timezone> body, an iCalendar VTIMEZONE
}

export interface CalendarDataSpec {
  comps?: Record<string, { props?: string[]; comps?: string[] }>;
  expand?: TimeRange;
  limitRecurrenceSet?: TimeRange;
  limitFreebusySet?: TimeRange;
}

export function parseCalendarQuery(text: string): CalendarQuery {
  const doc = parseDavXml(text);
  const root = doc.documentElement;
  if (root.namespaceURI !== NS.C || root.localName !== 'calendar-query') {
    throw Object.assign(new Error('expected CALDAV:calendar-query'), { status: 400 });
  }

  const props = (select('/C:calendar-query/D:prop/*', doc) as Element[])
    .map((el) => ({ ns: el.namespaceURI ?? '', name: el.localName ?? el.nodeName }));

  const cdEl = (select('/C:calendar-query/D:prop/C:calendar-data', doc) as Element[])[0];
  const calendarData = cdEl ? parseCalendarDataSpec(cdEl) : undefined;

  const topEl = (select('/C:calendar-query/C:filter/C:comp-filter', doc) as Element[])[0];
  if (!topEl) throw Object.assign(new Error('missing CALDAV:filter'), { status: 400 });

  const tzEl = (select('/C:calendar-query/C:timezone', doc) as Element[])[0];

  return {
    props,
    calendarData,
    filter: parseCompFilter(topEl),
    timezone: tzEl?.textContent ?? undefined,
  };
}

function children(el: Element, ns: string, local: string): Element[] {
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) {
      const e = n as Element;
      if (e.namespaceURI === ns && e.localName === local) out.push(e);
    }
  }
  return out;
}

function has(el: Element, ns: string, local: string): boolean {
  return children(el, ns, local).length > 0;
}

function parseCompFilter(el: Element): CompFilter {
  return {
    name: el.getAttribute('name') ?? '',
    isNotDefined: has(el, NS.C, 'is-not-defined'),
    timeRange: parseTimeRange(children(el, NS.C, 'time-range')[0]),
    propFilters: children(el, NS.C, 'prop-filter').map(parsePropFilter),
    compFilters: children(el, NS.C, 'comp-filter').map(parseCompFilter),
  };
}

function parsePropFilter(el: Element): PropFilter {
  return {
    name: el.getAttribute('name') ?? '',
    isNotDefined: has(el, NS.C, 'is-not-defined'),
    timeRange: parseTimeRange(children(el, NS.C, 'time-range')[0]),
    textMatch: parseTextMatch(children(el, NS.C, 'text-match')[0]),
    paramFilters: children(el, NS.C, 'param-filter').map((p) => ({
      name: p.getAttribute('name') ?? '',
      isNotDefined: has(p, NS.C, 'is-not-defined'),
      textMatch: parseTextMatch(children(p, NS.C, 'text-match')[0]),
    })),
  };
}

function parseTextMatch(el?: Element): TextMatch | undefined {
  if (!el) return undefined;
  return {
    value: el.textContent ?? '',
    // RFC 4791 §7.5: default collation is i;ascii-casemap.
    // Fem-ho's UI is Catalan -> also support i;unicode-casemap for accents.
    collation: el.getAttribute('collation') ?? 'i;ascii-casemap',
    negate: (el.getAttribute('negate-condition') ?? 'no') === 'yes',
  };
}

/** RFC 4791 time-range attrs are iCalendar UTC DATE-TIME: 20260801T000000Z */
function parseTimeRange(el?: Element): TimeRange | undefined {
  if (!el) return undefined;
  const p = (v: string | null) => {
    if (!v) return undefined;
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
    if (!m) throw Object.assign(new Error('bad time-range'), { status: 400 });
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  };
  const tr: TimeRange = { start: p(el.getAttribute('start')), end: p(el.getAttribute('end')) };
  if (!tr.start && !tr.end) throw Object.assign(new Error('time-range needs start or end'), { status: 400 });
  return tr;
}

function parseCalendarDataSpec(el: Element): CalendarDataSpec {
  const spec: CalendarDataSpec = {};
  const expand = children(el, NS.C, 'expand')[0];
  if (expand) spec.expand = parseTimeRange(expand);
  const lrs = children(el, NS.C, 'limit-recurrence-set')[0];
  if (lrs) spec.limitRecurrenceSet = parseTimeRange(lrs);
  const lfs = children(el, NS.C, 'limit-freebusy-set')[0];
  if (lfs) spec.limitFreebusySet = parseTimeRange(lfs);

  const comps: CalendarDataSpec['comps'] = {};
  const walk = (parent: Element) => {
    for (const c of children(parent, NS.C, 'comp')) {
      const name = c.getAttribute('name') ?? '';
      comps[name] = {
        props: children(c, NS.C, 'prop').map((p) => p.getAttribute('name') ?? ''),
        comps: children(c, NS.C, 'comp').map((x) => x.getAttribute('name') ?? ''),
      };
      walk(c);
    }
  };
  walk(el);
  if (Object.keys(comps).length) spec.comps = comps;
  return spec;
}
```

And `calendar-multiget` (trivial by comparison — it is a list of hrefs):

```ts
export function parseCalendarMultiget(text: string): { props: PropName[]; hrefs: string[] } {
  const doc = parseDavXml(text);
  return {
    props: (select('/C:calendar-multiget/D:prop/*', doc) as Element[])
      .map((el) => ({ ns: el.namespaceURI ?? '', name: el.localName! })),
    hrefs: (select('/C:calendar-multiget/D:href/text()', doc) as Text[])
      .map((t) => t.nodeValue!.trim())
      .filter(Boolean),
  };
}
```

`sync-collection` (RFC 6578):

```ts
export function parseSyncCollection(text: string) {
  const doc = parseDavXml(text);
  const tokenNode = (select('/D:sync-collection/D:sync-token/text()', doc) as Text[])[0];
  const levelNode = (select('/D:sync-collection/D:sync-level/text()', doc) as Text[])[0];
  const limitNode = (select('/D:sync-collection/D:limit/D:nresults/text()', doc) as Text[])[0];
  return {
    // Empty or absent sync-token = initial sync, send everything.
    syncToken: tokenNode?.nodeValue?.trim() || null,
    syncLevel: (levelNode?.nodeValue?.trim() ?? '1') as '1' | 'infinite',
    limit: limitNode ? Number(limitNode.nodeValue) : undefined,
    props: (select('/D:sync-collection/D:prop/*', doc) as Element[])
      .map((el) => ({ ns: el.namespaceURI ?? '', name: el.localName! })),
  };
}
```

### 2.8 Worked example C — serialising a multistatus with mixed 200/404 propstats

The rule most implementations get wrong: **every requested property must appear in the response**, grouped into one `<D:propstat>` per status. Found properties go in a `200 OK` propstat; unknown ones go in a `404 Not Found` propstat with *empty* elements. DAVx⁵ tolerates omissions; Apple's CalendarAgent has historically been stricter, and Evolution logs warnings.

```ts
// packages/caldav/src/xml/serialize.ts
import { create, fragment } from 'xmlbuilder2';
import { NS } from './parse.js';

export type PropValue =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'href'; href: string }
  | { kind: 'hrefs'; hrefs: string[] }
  | { kind: 'raw'; xml: string }          // pre-rendered fragment, namespaces already declared
  | { kind: 'resourcetype'; types: { ns: string; name: string }[] };

export interface PropResult { ns: string; name: string; value?: PropValue }

export interface ResponseNode {
  href: string;
  found: PropResult[];       // -> 200
  notFound: PropResult[];    // -> 404
  forbidden?: PropResult[];  // -> 403 (e.g. protected property in PROPPATCH)
  status?: number;           // for a bare <D:response><D:href/><D:status/> (deletions)
  error?: string;            // pre-rendered <D:error> child
  responseDescription?: string;
}

const NS_ATTRS = {
  'xmlns:D': NS.D,
  'xmlns:C': NS.C,
  'xmlns:CS': NS.CS,
  'xmlns:IC': NS.IC,
};

const REASON: Record<number, string> = {
  200: 'OK', 201: 'Created', 204: 'No Content', 207: 'Multi-Status',
  400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict',
  412: 'Precondition Failed', 415: 'Unsupported Media Type', 424: 'Failed Dependency',
  423: 'Locked', 507: 'Insufficient Storage',
};
const statusLine = (code: number) => `HTTP/1.1 ${code} ${REASON[code] ?? 'Unknown'}`;

/** Serialise exactly one <D:response>. Namespaces are declared on the element itself so the
 *  fragment is valid standalone — this is what lets us stream without a DOM for the whole doc. */
export function renderResponse(r: ResponseNode): string {
  const el = fragment({ defaultNamespace: { ele: null } })
    .ele(NS.D, 'D:response');
  for (const [k, v] of Object.entries(NS_ATTRS)) el.att(k, v);

  // href MUST be percent-encoded exactly as the client will request it back
  el.ele(NS.D, 'D:href').txt(r.href).up();

  if (r.status !== undefined) {
    el.ele(NS.D, 'D:status').txt(statusLine(r.status)).up();
  } else {
    if (r.found.length)    appendPropstat(el, r.found, 200);
    if (r.notFound.length) appendPropstat(el, r.notFound, 404);
    if (r.forbidden?.length) appendPropstat(el, r.forbidden, 403);
  }

  if (r.error) el.import(fragment(r.error));
  if (r.responseDescription) el.ele(NS.D, 'D:responsedescription').txt(r.responseDescription).up();

  return el.end({ prettyPrint: true, headless: true });
}

function appendPropstat(parent: any, props: PropResult[], code: number) {
  const ps = parent.ele(NS.D, 'D:propstat');
  const prop = ps.ele(NS.D, 'D:prop');
  for (const p of props) appendProp(prop, p);
  ps.ele(NS.D, 'D:status').txt(statusLine(code)).up();
}

const PREFIX: Record<string, string> = {
  [NS.D]: 'D', [NS.C]: 'C', [NS.CS]: 'CS', [NS.IC]: 'IC',
};

function qname(ns: string, name: string): string {
  const p = PREFIX[ns];
  return p ? `${p}:${name}` : name;
}

function appendProp(parent: any, p: PropResult) {
  const q = qname(p.ns, p.name);
  const v = p.value ?? { kind: 'empty' as const };
  switch (v.kind) {
    case 'empty':
      parent.ele(p.ns, q).up();
      break;
    case 'text':
      // xmlbuilder2 escapes &, <, > for us. This is the path <C:calendar-data> takes.
      parent.ele(p.ns, q).txt(v.text).up();
      break;
    case 'href': {
      const e = parent.ele(p.ns, q);
      e.ele(NS.D, 'D:href').txt(v.href).up();
      e.up();
      break;
    }
    case 'hrefs': {
      const e = parent.ele(p.ns, q);
      for (const h of v.hrefs) e.ele(NS.D, 'D:href').txt(h).up();
      e.up();
      break;
    }
    case 'resourcetype': {
      const e = parent.ele(p.ns, q);
      for (const t of v.types) e.ele(t.ns, qname(t.ns, t.name)).up();
      e.up();
      break;
    }
    case 'raw':
      parent.import(fragment(v.xml));
      break;
  }
}
```

Output for a calendar collection where the client asked for `getctag`, `calendar-color` and a bogus `D:owner-nickname`:

```xml
<D:response xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"
            xmlns:CS="http://calendarserver.org/ns/" xmlns:IC="http://apple.com/ns/ical/">
  <D:href>/dav/cal/u/marta/familia/</D:href>
  <D:propstat>
    <D:prop>
      <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
      <D:displayname>Família</D:displayname>
      <CS:getctag>"1742"</CS:getctag>
      <IC:calendar-color>#E4572EFF</IC:calendar-color>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/><C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
    <D:status>HTTP/1.1 200 OK</D:status>
  </D:propstat>
  <D:propstat>
    <D:prop>
      <D:owner-nickname/>
    </D:prop>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:propstat>
</D:response>
```

Two details worth burning in:
- `IC:calendar-color` is `#RRGGBBAA` (8 hex digits) for Apple; DAVx⁵ accepts 6 or 8. Emit 8.
- `CS:getctag` is an **opaque quoted string**. Change it on *every* mutation to the collection (see §5.3).

---

## 3. Existing Node WebDAV/CalDAV server code

### 3.1 `caldav-adapter` — the finding that changes the estimate

| | |
|---|---|
| **npm** | `caldav-adapter@9.3.12` (also published as `@forwardemail/caldav-adapter`) |
| **Repo** | `github.com/forwardemail/caldav-adapter` (fork/modernisation of `sedenardi/node-caldav-adapter`) |
| **Licence** | MIT |
| **Engines** | `node >= 18` |
| **Host framework** | **Koa** middleware |
| **Deps** | `xpath 0.0.34`, `@xmldom/xmldom ^0.8.10`, `xmlbuilder2 ^3.1.1`, `raw-body ^2.5.2`, `basic-auth ^2.0.1`, `path-to-regexp ^6.2.1`, `lodash`, `moment`, `winston`, `validator` |
| **In production at** | Forward Email (`github.com/forwardemail/forwardemail.net`) |

Repository layout (from the GitHub tree API):

```
index.js
common/
  parse-body.js        raw-body(10mb) + @xmldom/xmldom DOMParser -> ctx.request.xml
  xml.js               xpath.useNamespaces({ DAV, CAL, CS, ICAL })
  tags.js              ~23 KB of property handlers across all four namespaces
routes/
  principal/
    propfind.js  proppatch.js  mkcalendar.js
  calendar/
    scheduling.js
    calendar/
      propfind.js  proppatch.js  report.js
      calendar-query.js  calendar-multiget.js
      get.js  put.js  delete.js  event-response.js
```

**REPORT completeness** (from `routes/calendar/calendar/report.js`): it builds a `rootActions` map and dispatches on `ctx.request.xml.documentElement.localName` — i.e. **namespace-agnostic on the root local name**, which is the right instinct. Supported:

| REPORT | Spec | In caldav-adapter |
|---|---|---|
| `calendar-query` | RFC 4791 §7.8 | **yes** |
| `calendar-multiget` | RFC 4791 §7.9 | **yes** |
| `sync-collection` | RFC 6578 §3.2 | **yes** |
| `expand-property` | RFC 3253 §3.8 | **yes** |
| `free-busy-query` | RFC 4791 §7.10 | **no** |

Unknown report → `403`; unparseable/empty XML → `400`. That matches the RFCs.

Also present: `MKCALENDAR`, `PROPPATCH` on both principal and calendar, `supported-calendar-component-set` and `getctag` handling live in `common/tags.js`, Apple push (`pushTopicProvider`, `pushSubscriptionURL`, `pushEnv`, `pushRefreshInterval` options) and scheduling.

**Options object** (from `index.js`):

```
caldavRoot        default '/'
calendarRoot      default 'cal'
principalRoot     default 'p'
logEnabled        default false
authRealm         Basic-auth realm string
authenticate()    async credential validation callback
disableWellKnown  disables the /.well-known/caldav redirect
pushTopicProvider, pushSubscriptionURL, pushEnv, pushRefreshInterval
```

It is *middleware*, not a router: it matches paths with regexes built from `caldavRoot`/`calendarRoot`/`principalRoot` and delegates to `calendarRoutes` / `principalRoutes`, handling root `PROPFIND` itself via `handleRootPropfind()`.

**How Fem-ho should use it.** Not as a dependency:
- Koa is a fifth framework in a stack that is already TS/React/Fastify-or-Hono/Kotlin.
- Its data-store contract is undocumented — the README says outright *"Please refer to the Forward Email implementation at github.com/forwardemail/forwardemail.net for usage insight."* You would be reverse-engineering an interface either way.
- `moment` and `lodash` are dead weight in 2026.

Use it as **the reference implementation**: read `common/tags.js` for the exhaustive property list every client actually asks for, `routes/calendar/calendar/report.js` for the dispatch shape, `common/parse-body.js` for the body/XML contract, and `event-response.js` for how `calendar-data` is assembled. It is the single highest-value artefact found in this research pass, and its existence is the direct refutation of dossier 03 §11.2.

### 3.2 `nephele`

| | |
|---|---|
| **npm** | `nephele@1.0.0-alpha.67` |
| **Licence** | Apache-2.0 |
| **Engines** | `node >= 18` |
| **Host** | Express (`express ^5.1.0` is a direct dependency) |
| **XML** | `xml2js ^0.6.2` (**not namespace-aware**) |
| **Keywords** | `webdav, carddav, caldav, dav, server, …` — aspirational, see below |

Status from the repository README: **WebDAV (RFC 4918) fully implemented**; ACL (RFC 3744) *in progress*; Current Principal Extension and Extended MKCOL *planned*; **CardDAV "definitely" planned but not implemented**; **CalDAV "maybe" — not implemented**; WebDAV SEARCH "probably not". Described as "already production ready" for plain WebDAV, developed by SciActive for Port87. ~367 commits on master.

**Completeness for Fem-ho's needs:**

| Feature | nephele |
|---|---|
| `PROPFIND` / `PROPPATCH` / `MKCOL` / `COPY` / `MOVE` / `LOCK` | yes (plain WebDAV) |
| `REPORT` (`calendar-query`) | **no** |
| `calendar-multiget` | **no** |
| `sync-collection` (RFC 6578) | **no** |
| `supported-calendar-component-set` | **no** |
| `getctag` | **no** |
| `MKCALENDAR` | **no** |

**Verdict:** a well-built *file* WebDAV server. Adopting it would mean writing all of CalDAV on top of an adapter API designed around file resources, through a non-namespace-aware XML layer. Worth reading its `@nephele/*` adapter split for architectural ideas (`nephele-serve`, S3 adapter, Nymph/MySQL adapter) — the adapter/authenticator plugin boundary is a good model for Fem-ho's `CalDavStore` port. Do not build on it.

### 3.3 `webdav-server` (OpenMarshal)

| | |
|---|---|
| **npm** | `webdav-server@2.6.3` |
| **Licence** | Unlicense |
| **Engines** | `node >= 4` (!) |
| **Deps** | `mime-types ^2.1.18`, `xml-js-builder ^1.0.3` |
| **Repo** | `github.com/OpenMarshal/npm-WebDAV-Server` |

Plain WebDAV file server. No `REPORT`, no CalDAV, no `sync-collection`, no ctag. The `node >= 4` engines field and the 2.x line's age make it effectively unmaintained for a 2026 project. **Do not use.**

### 3.4 `jsDAV` / `jsDAVlib`

`jsDAV` was Ajax.org's port of SabreDAV to Node (`mikedeboer/jsDAV`). It is a decade dormant — pre-`async/await`, callback-style, Node 0.x idioms. It did contain CalDAV plugin *scaffolding* inherited from SabreDAV's design, which makes its **architecture** (Tree / Node / Plugin / Property) worth a read, but the code is unusable. `jsDAVlib` is a thin repackaging in the same state. **Do not use.** *(Exact npm versions and last-publish dates UNVERIFIED — not fetched this pass.)*

### 3.5 Other things on npm today

| Package | What it is | Server or client | CalDAV completeness |
|---|---|---|---|
| `caldav-adapter@9.3.12` | Koa CalDAV **server** | server | query + multiget + sync-collection + expand-property + MKCALENDAR + ctag |
| `nephele@1.0.0-alpha.67` | Express WebDAV server | server | none |
| `webdav-server@2.6.3` | WebDAV file server | server | none |
| `tsdav@2.3.1` | WebDAV/CalDAV/CardDAV **client** | client | see §4.1 |
| `ts-caldav` | lightweight TS CalDAV **client**, no HTTP dep | client | client-side only |
| `simple-caldav-client` | TS client for ownCloud/Nextcloud | client | client-side only |
| `n8n-nodes-tscaldav` | n8n node wrapping `ts-caldav` | client | n/a |
| `webdav` (perry-mitchell) | WebDAV **client** | client | no CalDAV |

**There is exactly one Node CalDAV server implementation worth reading, and it is `caldav-adapter`.** That is a much better position than "zero", and it is enough to de-risk the estimate — but it is not a drop-in library. Fem-ho writes its own DAV layer, informed by that code.

### 3.6 Non-Node reference implementations to read alongside

Even writing TS, keep these open — they are where the client quirks are documented in code:

- **sabre/dav** (PHP, Baïkal ships 4.7.0) — the most complete open CalDAV server; `Sabre\CalDAV\CalendarQueryValidator` is the canonical `comp-filter`/`time-range` semantics.
- **Radicale** (Python, v3.7.5 per release listings) — smallest readable full implementation; `radicale/app/report.py` and `radicale/storage/__init__.py`.
- **Xandikos** (Python, GPLv3, git-backed, 0.3.3) — clean separation of "DAV protocol" from "store", explicitly documents *no multi-user support* and *no scheduling*.
- **Nextcloud/sabre** — what Nextcloud Tasks talks to; its VTODO quirks are the ones Nextcloud Tasks assumes.

---

## 4. The reverse direction — Fem-ho as a CalDAV *client* of external source calendars

Fem-ho subscribes to external calendars (school menus, work calendars, shared family iCloud calendars) and surfaces them in the Calendar view. That is a separate, much easier problem.

### 4.1 `tsdav@2.3.1`

| | |
|---|---|
| **Licence** | MIT |
| **Engines** | `node >= 18` |
| **Deps** | `debug@4.4.3`, `xml-js@1.6.11` (only two) |
| **Repo** | `github.com/natelindev/tsdav` |
| **Builds** | CJS (`dist/tsdav.cjs.js`), ESM (`dist/tsdav.mjs`), types (`dist/tsdav.d.ts`); conditional exports for browser/worker/deno/bun/node |

Documented client construction (verbatim from the README):

```ts
const client = await createDAVClient({
  serverUrl: '...',
  credentials: {...},
  authMethod: 'Oauth',
  defaultAccountType: 'caldav',
});
```

```ts
const client = new DAVClient({
  serverUrl: '...',
  credentials: {...},
  authMethod: 'Oauth',
  defaultAccountType: 'caldav',
});
await client.login();
```

`authMethod` is one of `'Basic'` (username/password), `'Oauth'` (`tokenUrl`, `refreshToken`, `clientId`, `clientSecret`) or `'Bearer'` (OIDC). Documented calls include `client.fetchCalendars()` and `client.fetchCalendarObjects({ calendar: calendars[0] })`; the CardDAV side has `fetchAddressBooks()` / `fetchVCards()`.

**The full CalDAV function list** — `calendarQuery`, `calendarMultiGet`, `makeCalendar`, `createCalendarObject`, `updateCalendarObject`, `deleteCalendarObject`, `syncCollection`, `smartCollectionSync`, `fetchCalendarUserAddresses`, `freeBusyQuery` — is **UNVERIFIED** in exact signature here: `tsdav.vercel.app/docs/caldav` returned an empty shell to the fetcher and the docs markdown path I guessed 404'd. Read `dist/tsdav.d.ts` after install and generate the wrapper types from that. `smartCollectionSync` is the one to look for: it uses `sync-collection` when the server advertises it and falls back to ctag+multiget otherwise, which is exactly the behaviour Fem-ho wants against unknown third-party servers.

**Node-specific client gotchas (these are the undici/fetch ones):**

- **The Fetch standard normalises only `DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`** — verbatim: *"To normalize a method, if it is a byte-case-insensitive match for `DELETE`, `GET`, `HEAD`, `OPTIONS`, `POST`, or `PUT`, byte-uppercase it."* So `fetch(url, { method: 'propfind' })` sends the literal lowercase token and most servers answer `501`. **Always uppercase `PROPFIND` / `REPORT` / `MKCALENDAR` yourself.**
- **Forbidden methods** are `CONNECT`, `TRACE`, `TRACK` only — every DAV verb is a legal fetch method.
- **A body on `fetch` in Node requires `duplex: 'half'`** when the body is a stream. For `PROPFIND`/`REPORT` just pass a string.
- **Redirects**: `/.well-known/caldav` returns 301/302/307/308. `fetch` follows by default but a 301/302 on a `PROPFIND` *may* be rewritten to `GET` by spec redirect rules. Use `redirect: 'manual'` and re-issue the DAV verb against the `Location` yourself.
- **Self-signed certs** on the household's own server: `undici` does not read `NODE_EXTRA_CA_CERTS` for `fetch` in all versions — configure an `undici.Agent` with `connect: { ca }` and pass it via `dispatcher`. *(UNVERIFIED for the exact pinned undici version.)*

### 4.2 `ical.js@2.2.1`

| | |
|---|---|
| **Licence** | **MPL-2.0** |
| **Repo** | `github.com/kewisch/ical.js` |
| **Engines** | `node >= 10` |
| **Description** | "Javascript parser for ics (rfc5545) and vcard (rfc6350) data" |
| **Builds** | ESM + CJS, TypeScript definitions bundled |

This is Mozilla's parser — the one Thunderbird itself uses. It is the correct choice for both directions:

- **Parse:** `ICAL.parse(text)` → jCal array; `new ICAL.Component(jcal)` → tree; `component.getAllSubcomponents('vtodo')`; `new ICAL.Event(vevent)`.
- **Recurrence:** `ICAL.RecurExpansion` and `event.iterator()` implement RFC 5545 recurrence *including* `RDATE`, `EXDATE` and `RECURRENCE-ID` overrides — which `rrule` does **not** do on its own.
- **Timezones:** `ICAL.Timezone` / `ICAL.TimezoneService` consume the `VTIMEZONE` blocks that arrive in the ICS, rather than trusting the server's tz database. This matters for imported work calendars.
- **Serialise:** `component.toString()` produces RFC 5545 folded output.

**Licence note for Fem-ho:** MPL-2.0 is file-level copyleft. Linking from a differently-licensed application is fine; you only owe source for modifications *to ical.js files themselves*. Do not vendor-and-patch it — depend on it.

### 4.3 Recurrence expansion: `rrule` vs `rschedule` vs `ical.js`

| | `rrule` | `@rschedule/core` | `ical.js` |
|---|---|---|---|
| Version | **2.8.1** | **1.5.0** | **2.2.1** |
| Licence | BSD-3-Clause | Unlicense | MPL-2.0 |
| Deps | `tslib ^2.4.0` | none | none |
| Last publish | current | **2 March 2023** (by `jcarroll`, built with lerna 3.22.1 / Node 16) | current |
| Scope | RRULE / RRULESET only | full scheduling algebra | full iCalendar incl. RRULE + RDATE + EXDATE + RECURRENCE-ID overrides |
| Timezones | via `luxon`/`moment` plugins or UTC-only | pluggable date adapters | native `VTIMEZONE` |

**Verdict: use `ical.js` for recurrence, not `rrule`.** The thing that actually breaks CalDAV interop is not RRULE arithmetic — it is *modified instances*: a client PUTs a second `VEVENT` with the same `UID` and a `RECURRENCE-ID` to move one occurrence. Only `ical.js` models that natively. Keep `rrule@2.8.1` as an optional helper if you need `RRule.fromString()` → human-readable Catalan text for the UI (`toText()` with a custom language object). **`@rschedule` is effectively unmaintained (last publish 2023) — do not adopt it.**

### 4.4 Architecture for "source calendars"

```
                          ┌────────────────────────────────────────┐
 external CalDAV ────────►│  SourceCalendarSyncer  (Node worker)    │
 (iCloud, Google,         │  tsdav 2.3.1 -> smartCollectionSync     │
  Nextcloud, school ics)  │  ical.js 2.2.1 -> parse + expand        │
                          │  writes read-only `external_event` rows │
                          └────────────────────────────────────────┘
 plain .ics URL ─────────► fetch + ical.js (no DAV at all)
```

Rules:
- Store `sync_token` **and** `ctag` **and** per-object `etag` per source. Try `sync-collection` first; fall back to ctag-changed → `PROPFIND Depth:1` for etags → `calendar-multiget` for changed hrefs.
- Store the raw ICS per object. Expansion is a *view* concern, recomputed on read for the visible window — never materialise infinite recurrences.
- External source calendars are **read-only** in Fem-ho. Writing back is a separate feature with its own conflict model; do not conflate it with M8.
- Poll interval: honour `IC:refreshrate` if the server advertises it, else 15 min, else on user pull-to-refresh.

---

## 5. Effort and architecture verdict

### 5.1 Where the effort actually is

Broken down for a v1 that satisfies DAVx⁵ + Apple Reminders/Calendar + Thunderbird + Evolution + Nextcloud Tasks:

| Work item | Days | Notes |
|---|---|---|
| `OPTIONS`, `DAV:`/`Allow` headers, `/.well-known/caldav` + `/.well-known/carddav` redirects | 0.5 | trivial |
| Principal resource + `current-user-principal` + `calendar-home-set` + `calendar-user-address-set` | 2 | the discovery chain every client walks |
| `PROPFIND` engine: Depth 0/1, `allprop`/`propname`/`prop`, mixed propstats | 3 | §7 skeleton |
| Property registry across `DAV:` / CalDAV / `CS:` / `IC:` (~35 properties) | 3 | read `caldav-adapter/common/tags.js` first |
| `PROPPATCH` (`displayname`, `IC:calendar-color`, `IC:calendar-order`, `C:calendar-description`, `C:calendar-timezone`) + protected-property 403s | 1.5 | |
| `MKCALENDAR` + extended `MKCOL` (RFC 5689) | 1 | Apple uses MKCALENDAR, DAVx⁵ uses extended MKCOL |
| `GET`/`PUT`/`DELETE` with strong ETags, `If-Match`, `If-None-Match: *` | 2 | plus RFC 4791 §5.3.2 preconditions |
| `calendar-multiget` | 1 | easy once PROPFIND exists |
| **`calendar-query`** — `comp-filter`, `prop-filter`, `param-filter`, `time-range`, `text-match`, collations | **5–8** | the `time-range` × recurrence intersection is the genuinely hard part |
| `sync-collection` + sync-token + tombstones + `412` on invalid token | 3 | §5.3 |
| ctag | 0.5 | falls out of the same counter |
| **Task/Event ↔ VTODO/VEVENT mapping**: status↔kanban column, `RELATED-TO` subtasks, `ATTENDEE` ↔ `@person`, `CATEGORIES` ↔ scope/project, `VALARM`, `RRULE`, X-props round-trip | **5–8** | Fem-ho-specific; nobody else has solved your model |
| Auth: Basic over TLS, per-device app passwords, token scoping (humans vs AI) | 1 | reuse dossier 05's token model |
| Source-calendar client direction (§4) | 4 | tsdav + ical.js |
| **Conformance testing + real-client debugging** | **8–15** | see §6; this is where "2–4x" estimates come from and it is *runtime-independent* |
| **Total** | **≈ 40–60 dev-days** | |

The XML is ~5 days of that. The runtime choice moves maybe 3–5 days, not 2–4×. Dossier 08's estimate was based on the premise that no Node CalDAV code existed to read; `caldav-adapter` invalidates the premise.

### 5.2 In-process TypeScript vs sidecar

**Argument for the sidecar** (Radicale/Xandikos/Baïkal or a small Go service): the DAV protocol is done for you, tested against every client.

**Why it collapses for Fem-ho:**

1. **The storage plugin is the whole job anyway.** Radicale's plugin contract is "a module containing a class `Storage` that extends `radicale.storage.BaseStorage`" (older docs phrase it as a `Collection` extending `BaseCollection`). To make Fem-ho's tasks appear, you implement discovery, `get_multi`, `upload`, `delete`, `get_meta`, `set_meta`, `sync`, and locking — in **Python**, against Fem-ho's Postgres, reimplementing the task↔VTODO mapping that already exists in TypeScript. Two languages, two mappings, guaranteed divergence.
2. **Xandikos is a non-starter**: GPLv3+, git-backed storage, and its own site states **no multi-user support** and no scheduling extensions. Fem-ho is explicitly a multi-user household.
3. **Baïkal/sabre-dav** is a full PHP application with its own user/auth model and MySQL schema. Bridging Fem-ho's users, scopes and projects into it means either syncing two databases or writing a sabre-dav backend in PHP. Third language.
4. **A Go sidecar** means writing the CalDAV layer anyway (Go has `emersion/go-webdav` with CalDAV server scaffolding, but the same query/filter/sync work remains), plus a cross-process contract, plus a second toolchain in the Docker image, plus the consistency problem below. It buys nothing that TypeScript does not have, now that we know the XML stack.
5. **The user has fixed the stack.** A Go sidecar re-opens a settled decision and adds a build target to a self-hosted multi-arch image.

**Verdict: in-process TypeScript, isolated behind a port.** Structure it so that moving it later costs one package:

```
packages/
  caldav/                     # zero knowledge of Fastify/Hono/Prisma/Drizzle
    src/http/                 # verb router, body, multistatus streaming
    src/xml/                  # parse.ts, serialize.ts, calendar-query.ts
    src/props/                # property registry (ns, name) -> resolver
    src/reports/              # calendar-query.ts, multiget.ts, sync-collection.ts
    src/ical/                 # VTODO/VEVENT <-> domain mapping (ical.js)
    src/port.ts               # >>> CalDavStore interface — the only seam <<<
  server/                     # mounts packages/caldav at /dav, implements CalDavStore
```

```ts
// packages/caldav/src/port.ts
export interface CalDavCollection {
  id: string;
  href: string;                 // '/dav/cal/u/{user}/{scope}[/{project}]/'
  displayName: string;
  description?: string;
  color?: string;               // #RRGGBBAA
  order?: number;
  components: ('VEVENT' | 'VTODO')[];
  ctag: string;                 // quoted, changes on ANY mutation
  syncToken: string;            // opaque URI
  privileges: ('read' | 'write' | 'write-content' | 'bind' | 'unbind')[];
}

export interface CalDavObject {
  href: string;                 // '/dav/.../{uid}.ics'
  etag: string;                 // strong, quoted, STORED not recomputed
  componentType: 'VEVENT' | 'VTODO';
  ics: string;                  // canonical stored bytes
  uid: string;
  // denormalised for filter pushdown into SQL:
  dtstart?: Date; dtend?: Date; due?: Date; completed?: Date;
  status?: string; summary?: string; hasRrule: boolean;
}

export interface SyncChange {
  href: string;
  type: 'created' | 'modified' | 'deleted';
  etag?: string;
}

export interface CalDavStore {
  resolvePrincipal(userId: string): Promise<{ href: string; displayName: string; addresses: string[] }>;
  listCollections(userId: string): Promise<CalDavCollection[]>;
  getCollection(userId: string, href: string): Promise<CalDavCollection | null>;
  createCollection(userId: string, href: string, props: Partial<CalDavCollection>): Promise<CalDavCollection>;
  patchCollection(userId: string, href: string, props: Partial<CalDavCollection>): Promise<void>;

  /** Streaming — a family calendar can hold 10k objects. */
  queryObjects(userId: string, collectionId: string, f: StoreFilter): AsyncIterable<CalDavObject>;
  getObjects(userId: string, collectionId: string, hrefs: string[]): AsyncIterable<CalDavObject | { href: string; missing: true }>;

  putObject(userId: string, collectionId: string, href: string, ics: string,
            precond: { ifMatch?: string; ifNoneMatch?: '*' }): Promise<{ etag: string; created: boolean }>;
  deleteObject(userId: string, collectionId: string, href: string, ifMatch?: string): Promise<void>;

  /** null token = initial sync. Throws InvalidSyncToken -> 403 <D:valid-sync-token/>. */
  changesSince(userId: string, collectionId: string, token: string | null, limit?: number):
    Promise<{ changes: SyncChange[]; newToken: string; truncated: boolean }>;
}
```

### 5.3 If you *did* go sidecar: how ctag / sync-token / ETag stay consistent across two writers

Answering the question as asked, because it is also the design you need for the in-process case with two *logical* writers (the web/Android app and DAV clients).

The three tokens have different contracts:

| Token | Contract | Granularity |
|---|---|---|
| `CS:getctag` | opaque; **MUST change if anything in the collection changed**. Clients poll it cheaply and only then do a full `PROPFIND Depth:1`. | collection |
| `D:sync-token` (RFC 6578) | opaque; server must be able to answer *"what changed since T"* **including deletions**, or reject T with `403` + `<D:valid-sync-token/>`. | collection, monotonic |
| `D:getetag` | strong validator over the resource's serialised bytes; drives `If-Match` optimistic concurrency. | object |

**The invariant: exactly one monotonic counter per collection, bumped inside the same database transaction as every mutation — no matter which process performed it.**

```sql
-- one counter drives both ctag and sync-token
ALTER TABLE dav_collection ADD COLUMN sync_seq bigint NOT NULL DEFAULT 0;

-- every object row records the seq of its last change
ALTER TABLE calendar_object ADD COLUMN sync_seq bigint NOT NULL;
ALTER TABLE calendar_object ADD COLUMN etag text NOT NULL;
ALTER TABLE calendar_object ADD COLUMN ics text NOT NULL;   -- canonical stored bytes

-- deletions need tombstones or sync-collection cannot report them
CREATE TABLE dav_tombstone (
  collection_id uuid NOT NULL,
  href          text NOT NULL,
  sync_seq      bigint NOT NULL,
  deleted_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, href, sync_seq)
);
CREATE INDEX ON dav_tombstone (collection_id, sync_seq);
CREATE INDEX ON calendar_object (collection_id, sync_seq);
```

```sql
-- the ONLY way anything mutates a collection, from any writer
CREATE OR REPLACE FUNCTION dav_bump(p_collection uuid) RETURNS bigint AS $$
  UPDATE dav_collection SET sync_seq = sync_seq + 1
   WHERE id = p_collection
  RETURNING sync_seq;
$$ LANGUAGE sql;
```

Then:

- `ctag = '"' || sync_seq || '"'`
- `sync-token = 'https://fem-ho.local/ns/sync/' || collection_id || '/' || sync_seq`
- `changesSince(T)`:
  - parse `T` → `(collection_id, seq)`; if the collection id mismatches or `seq` is below your retention floor → `403` + `<D:valid-sync-token/>` (clients then do a full resync; this is normal and expected).
  - `SELECT href, etag FROM calendar_object WHERE collection_id = $1 AND sync_seq > $2`
  - `UNION` `SELECT href, NULL FROM dav_tombstone WHERE collection_id = $1 AND sync_seq > $2`
  - new token = current `sync_seq`.
- Retention: prune tombstones older than e.g. 90 days and record the pruned high-water mark as the retention floor. Any token below it gets the `403`.

**ETag stability is the rule that breaks naive implementations.** If you re-serialise from the relational model on every read and the output is not byte-identical (property ordering, `DTSTAMP: now()`, line folding at column 75, `PRODID` version string), the ETag changes on every read and **DAVx⁵ will resync forever**. Therefore:

```ts
// etag is computed ONCE, at write time, over the exact bytes we will serve back
import { createHash } from 'node:crypto';
export const etagOf = (ics: string) => `"${createHash('sha256').update(ics, 'utf8').digest('hex').slice(0, 32)}"`;
```

- On `PUT` from a DAV client: store the client's bytes verbatim (after validation), plus the parsed denormalised columns. Serve those bytes back.
- On a write from the web/Android app: regenerate the ICS **deterministically** (fixed property order, fixed `PRODID`, `DTSTAMP` = the row's `updated_at`, never `now()`), store it, compute the etag, bump `sync_seq`. Merge back any X-properties/`ATTACH`/unknown properties preserved from the last client-authored version.
- Never compute an etag lazily in the `PROPFIND` handler.

**Now the sidecar answer specifically.** For any second process (Radicale plugin, Go service) to participate, it must:
1. write through the **same** `dav_bump()` inside the same transaction as its object write — meaning it must talk to the same Postgres with the same schema, not its own store;
2. use the **same** ETag function over the **same** canonical bytes;
3. never cache the collection state across requests (Radicale's `multifilesystem` locking assumptions do not hold when a second writer exists — you would need `multifilesystem_nolock` plus your own advisory locks);
4. keep its own `sync-token` format identical, because clients persist tokens across which process answers them.

Meeting all four means the sidecar is no longer "Radicale with a plugin" — it is a bespoke Python service reimplementing your invariants. That is the concrete reason the sidecar is rejected.

*(One legitimate sidecar-lite pattern, if you ever want it: Radicale's `[storage] hook` runs a command after storage changes with `%(user)s`, `%(cwd)s`, `%(path)s`, `%(to_path)s`, `%(request)s` placeholders. That is a one-way notification, not a shared-transaction mechanism — useful for "Radicale changed, go reimport", never for ctag consistency.)*

### 5.4 Recommended architecture

```
┌───────────────────────────────────────────────────────────────┐
│ Node 22 LTS process                                           │
│                                                               │
│  ┌──────────────┐   ┌──────────────────────────────────────┐  │
│  │ /api  (REST) │   │ /dav  (packages/caldav)              │  │
│  │ Fastify|Hono │   │ raw node:http router, no body parser │  │
│  │ JSON parsers │   │ Basic auth (app passwords)           │  │
│  └──────┬───────┘   └───────────────┬──────────────────────┘  │
│         │                            │                        │
│         └────────► CalDavStore ◄─────┘                        │
│                    (one impl, one tx boundary, dav_bump())    │
└──────────────────────────────┬────────────────────────────────┘
                               │
                        Postgres (single writer of sync_seq)
```

- Mount `/dav` **before** any body-parsing middleware, or on a second `http.Server` on a separate port behind the same proxy. The second-port option is cleaner and lets you keep raw `node:http` for DAV while the API uses whatever framework the rest of the app uses.
- Per-scope collection: `/dav/cal/u/{userId}/{scopeSlug}/`
- Per-project collection: `/dav/cal/u/{userId}/{scopeSlug}/{projectSlug}/`
- `supported-calendar-component-set` = `VTODO` for task-only collections, `VEVENT,VTODO` for scope general spaces that hold events too. **Declare it honestly** — Apple Reminders only shows collections advertising `VTODO`, Apple Calendar only shows collections advertising `VEVENT`, and a collection advertising both appears in *both* apps (which is what Fem-ho wants for a scope's general space).
- Checklists ("simple task lists") should **not** be CalDAV collections. They are not calendar data. Expose them only via REST/MCP and share links.

---

## 6. Conformance testing that runs in CI on Node

### 6.1 python-caldav's functional suite pointed at Fem-ho — the highest-value harness

`python-caldav/caldav` is dual-licensed **GPLv3 or Apache-2.0** and ships a `tests/` directory whose functional tests run against **any** live CalDAV server, not just a mock. That makes it the single best conformance signal available, because it is the same library that half the CalDAV ecosystem's integration tests use.

Mechanism (shape is well-established; **exact field names UNVERIFIED** — read `tests/conf.py` in the repo before wiring it up): `tests/conf.py` imports an optional `tests/conf_private.py` which defines a `caldav_servers` list of dicts with at minimum `url`, `username`, `password`, plus a set of *incompatibility* flags naming behaviours the server is known not to support (so the suite skips rather than fails). Environment variables (`CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD`) are also honoured in recent versions.

CI job:

```yaml
# .github/workflows/caldav-conformance.yml
name: caldav-conformance
on: [push, pull_request]
jobs:
  python-caldav:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci && npm run build
      - run: node dist/server.js &                 # or docker compose up -d femho
      - run: npx wait-on http://127.0.0.1:3001/.well-known/caldav
      - uses: actions/checkout@v4
        with: { repository: python-caldav/caldav, path: pycaldav, ref: master }
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -e ./pycaldav[test]
      - name: write conf_private.py
        run: |
          cat > pycaldav/tests/conf_private.py <<'PY'
          caldav_servers = [{
              "url": "http://127.0.0.1:3001/dav/",
              "username": "ci@fem-ho.local",
              "password": "ci-app-password",
              "incompatibilities": [
                  # start permissive, delete entries as you implement them
                  "no_freebusy_rfc4791",
                  "no_scheduling",
                  "no_recurring_expandation",
              ],
          }]
          PY
      - run: cd pycaldav && python -m pytest tests/ -q -k "not compatibility"
```

Treat the incompatibility list as a **burn-down chart**: every entry you delete is a conformance milestone. Start with everything Fem-ho does not implement, and gate merges on the list never growing.

### 6.2 CalDAVTester — mine it, do not depend on it

- `apple/ccs-caldavtester` is **archived** ("we have moved on to other things; fork it if you wish"). It is Python 2 and drives tests from XML scripts under `Resource/CalDAV/`.
- Active-ish forks exist: `CalConnect/caldavtester` and `evert/caldavtester` (Evert Pot, the sabre/dav author) — the latter ships a `serverinfo.xml` you can adapt.
- **Best use:** the `Resource/CalDAV/**` XML files are hundreds of real, spec-exercising request bodies. Copy them into `packages/caldav/test/fixtures/` and drive them from Vitest. You get the coverage without the Python 2 runtime.

### 6.3 Docker Compose diff harness — compare against three implementations

Run three reference servers next to Fem-ho and execute the *same* script against all four, diffing normalised responses. Divergence from all three ≈ a bug in Fem-ho; divergence from one ≈ a genuine spec ambiguity worth reading the RFC over.

```yaml
# docker-compose.conformance.yml
services:
  femho:
    build: .
    environment: { FEMHO_DAV_BASIC_AUTH: "1" }
    ports: ["3001:3001"]

  radicale:                       # Python, smallest readable full implementation
    image: tomsquest/docker-radicale:3.2.3.0     # pin; 3.7.x tags also published
    ports: ["5232:5232"]
    volumes: ["./ci/radicale:/config:ro"]

  xandikos:                       # git-backed, strict, single-user
    image: ghcr.io/jelmer/xandikos:latest        # pin to a release digest in CI
    command: ["--defaults", "-d", "/data", "--port", "8000", "--listen-address", "0.0.0.0"]
    ports: ["8000:8000"]

  baikal:                         # sabre/dav 4.7.0 — the most complete reference
    image: ckulka/baikal:nginx
    ports: ["8080:80"]
    volumes: ["./ci/baikal:/var/www/baikal/config"]
```

Driver (TypeScript, so it lives in the repo and reuses your own types):

```ts
// test/conformance/diff.ts
const TARGETS = [
  { name: 'femho',    base: 'http://localhost:3001/dav/', auth: '…' },
  { name: 'radicale', base: 'http://localhost:5232/',     auth: '…' },
  { name: 'xandikos', base: 'http://localhost:8000/',     auth: '…' },
  { name: 'baikal',   base: 'http://localhost:8080/dav.php/', auth: '…' },
];

const PROBES = [
  { verb: 'OPTIONS',  path: '',            body: null },
  { verb: 'PROPFIND', path: '',            depth: '0', body: FIXTURES.currentUserPrincipal },
  { verb: 'PROPFIND', path: 'calendars/x/',depth: '1', body: FIXTURES.davx5CollectionProps },
  { verb: 'REPORT',   path: 'calendars/x/',depth: '1', body: FIXTURES.incompleteVtodoQuery },
  { verb: 'REPORT',   path: 'calendars/x/',depth: '1', body: FIXTURES.syncCollectionInitial },
];
// normalise: strip etags/ctags/sync-tokens/hrefs/timestamps, sort elements by (ns, localName),
// then structurally diff. Report per-probe agreement.
```

Normalisation is what makes this usable: canonicalise the XML (sort attributes and sibling elements by `(namespaceURI, localName)`, replace every etag/ctag/sync-token/href-prefix/timestamp with a placeholder) before diffing.

### 6.4 Golden-transcript tests — the ones that actually catch client regressions

The highest-signal, cheapest tests in the whole plan:

1. Put a logging reverse proxy (`mitmproxy`, or 30 lines of `node:http` writing `.http` files) in front of a dev instance.
2. Pair a real DAVx⁵, a real iPhone Reminders account, Thunderbird, Evolution and Nextcloud Tasks against it. Do a full lifecycle each: discover → create task → complete task → edit on server → delete → recurring event → move one occurrence.
3. Commit the captured request bodies as fixtures, one directory per client.
4. Vitest replays each fixture against an in-process server with a seeded store and snapshots the normalised response.

```ts
// packages/caldav/test/golden.test.ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

for (const client of ['davx5', 'apple-reminders', 'apple-calendar', 'thunderbird', 'evolution', 'nextcloud-tasks']) {
  describe(client, () => {
    for (const f of readdirSync(`test/fixtures/${client}`)) {
      it(f, async () => {
        const { method, path, headers, body } = parseHttpFixture(readFileSync(`test/fixtures/${client}/${f}`, 'utf8'));
        const res = await inject(server, { method, path, headers, body });
        expect(res.statusCode).toMatchSnapshot('status');
        expect(canonicalizeXml(res.body)).toMatchSnapshot('body');
      });
    }
  });
}
```

This is the mechanism that turns "we broke Apple Reminders" from a three-day bisect into a red CI check.

### 6.5 Smoke tests you can run from a shell

Keep these in the repo as `scripts/dav-smoke.sh`; they are what you will actually type at 1am.

```bash
BASE=http://localhost:3001/dav
AUTH='-u ci@fem-ho.local:ci-app-password'

# 1. Does the verb even arrive? (proves llhttp + router + proxy)
curl -sv $AUTH -X OPTIONS "$BASE/" 2>&1 | grep -Ei '^< (HTTP|DAV|Allow)'
# expect: DAV: 1, 2, 3, access-control, calendar-access

# 2. Discovery chain
curl -s $AUTH -X PROPFIND -H 'Depth: 0' -H 'Content-Type: application/xml' \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>' \
  "$BASE/" | xmllint --format -

# 3. Collections with the props DAVx5 asks for
curl -s $AUTH -X PROPFIND -H 'Depth: 1' -H 'Content-Type: application/xml' \
  --data @test/fixtures/davx5/collection-props.xml "$BASE/cal/u/ci/" | xmllint --format -

# 4. The incomplete-VTODO query (Nextcloud Tasks / DAVx5 hot path)
curl -s $AUTH -X REPORT -H 'Depth: 1' -H 'Content-Type: application/xml' \
  --data @test/fixtures/reports/incomplete-vtodo.xml "$BASE/cal/u/ci/familia/" | xmllint --format -

# 5. sync-collection round trip
curl -s $AUTH -X REPORT -H 'Depth: 1' -H 'Content-Type: application/xml' \
  --data '<?xml version="1.0"?><d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>' \
  "$BASE/cal/u/ci/familia/" | xmllint --format -

# 6. ETag / If-Match concurrency
ETAG=$(curl -s -D- $AUTH "$BASE/cal/u/ci/familia/abc.ics" -o /dev/null | tr -d '\r' | awk -F': ' '/^ETag/{print $2}')
curl -s -o /dev/null -w '%{http_code}\n' $AUTH -X PUT -H "If-Match: $ETAG" \
  -H 'Content-Type: text/calendar; charset=utf-8' --data-binary @task.ics "$BASE/cal/u/ci/familia/abc.ics"
curl -s -o /dev/null -w '%{http_code}\n' $AUTH -X PUT -H 'If-Match: "stale"' \
  -H 'Content-Type: text/calendar; charset=utf-8' --data-binary @task.ics "$BASE/cal/u/ci/familia/abc.ics"
# expect 204 then 412
```

Also worth adding: **`litmus`**, the classic WebDAV conformance tool (packaged in Debian/Ubuntu as `litmus`). It is WebDAV-only — no CalDAV — but its `basic`, `props` and `http` suites catch Depth handling, 207 shape, `If:` header and PROPPATCH bugs cheaply. *(Current packaging/version UNVERIFIED.)*

---

## 7. Skeleton: `PROPFIND` + `REPORT` + `PUT` in TypeScript

Depends only on `@xmldom/xmldom`, `xpath`, `xmlbuilder2`, `ical.js` and `node:http`. Uses the `CalDavStore` port from §5.2 and the helpers from §1.6.1 / §2.

### 7.1 Router

```ts
// packages/caldav/src/router.ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readXmlBody, readRawBody } from './http/body.js';
import { DAV_COMPLIANCE } from './http/multistatus.js';
import type { CalDavStore } from './port.js';
import { handlePropfind }   from './methods/propfind.js';
import { handleReport }     from './methods/report.js';
import { handlePut }        from './methods/put.js';
import { handleProppatch }  from './methods/proppatch.js';
import { handleMkcalendar } from './methods/mkcalendar.js';
import { handleGet, handleDelete } from './methods/simple.js';

export interface DavCtx {
  req: IncomingMessage;
  res: ServerResponse;
  store: CalDavStore;
  userId: string;
  /** decoded exactly once; never re-decoded downstream */
  path: string;
  /** the raw, still-encoded path — this is what goes into <D:href> */
  rawPath: string;
  xml: string | null;
}

const ALLOW =
  'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE';

export async function davRouter(req: IncomingMessage, res: ServerResponse, store: CalDavStore) {
  const userId = await authenticate(req, res);      // Basic; challenges with 401 + WWW-Authenticate
  if (!userId) return;

  const rawPath = (req.url ?? '/').split('?')[0];
  const path = safeDecodePath(rawPath);
  if (path === null) return send(res, 400, 'bad path');

  const ctx: DavCtx = { req, res, store, userId, path, rawPath, xml: null };

  try {
    switch (req.method) {
      case 'OPTIONS':
        res.writeHead(200, { DAV: DAV_COMPLIANCE, Allow: ALLOW, 'Content-Length': '0' });
        return res.end();

      case 'PROPFIND':
        ctx.xml = await readXmlBody(req);
        return await handlePropfind(ctx);

      case 'PROPPATCH':
        ctx.xml = await readXmlBody(req);
        return await handleProppatch(ctx);

      case 'REPORT':
        ctx.xml = await readXmlBody(req);
        if (!ctx.xml) return send(res, 400, 'REPORT requires a body');
        return await handleReport(ctx);

      case 'MKCALENDAR':
      case 'MKCOL':
        ctx.xml = await readXmlBody(req);
        return await handleMkcalendar(ctx);

      case 'PUT':    return await handlePut(ctx, await readRawBody(req));
      case 'GET':
      case 'HEAD':   return await handleGet(ctx);
      case 'DELETE': return await handleDelete(ctx);

      default:
        res.writeHead(501, { Allow: ALLOW, 'Content-Length': '0' });
        return res.end();
    }
  } catch (err) {
    return sendDavError(res, err);
  }
}

/** Decode ONCE. Reject traversal and encoded separators that survive decoding. */
function safeDecodePath(raw: string): string | null {
  let d: string;
  try { d = decodeURIComponent(raw); } catch { return null; }
  if (d.includes('\0') || d.includes('/../') || d.endsWith('/..')) return null;
  return d;
}
```

### 7.2 `PROPFIND`

```ts
// packages/caldav/src/methods/propfind.ts
import { parsePropfind, parseDepth, type PropName } from '../xml/parse.js';
import { beginMultistatus, endMultistatus, renderResponse } from '../xml/serialize.js';
import { resolveCollectionProps, resolveObjectProps, ALL_COLLECTION_PROPS, ALL_OBJECT_PROPS } from '../props/registry.js';
import type { DavCtx } from '../router.js';

export async function handlePropfind(ctx: DavCtx) {
  const { req, res, store, userId, path } = ctx;

  const depth = parseDepth(req.headers['depth'], '0');
  if (depth === 'infinity') {
    // RFC 4918 §9.1: servers MAY refuse; refuse loudly with the right precondition element.
    return sendPreconditionError(res, 403, '<D:propfind-finite-depth/>');
  }

  const request = parsePropfind(ctx.xml);
  const target = await resolveResource(store, userId, path);   // principal | home | collection | object
  if (!target) return send(res, 404, 'not found');

  beginMultistatus(res);

  // --- the target itself -------------------------------------------------
  res.write(renderResponse(await buildResponse(ctx, target, request)));

  // --- Depth: 1 children --------------------------------------------------
  if (depth === '1') {
    if (target.kind === 'home' || target.kind === 'principal') {
      for (const col of await store.listCollections(userId)) {
        res.write(renderResponse(await buildResponse(ctx, { kind: 'collection', col }, request)));
      }
    } else if (target.kind === 'collection') {
      // stream — never materialise a 10k-object array
      for await (const obj of store.queryObjects(userId, target.col.id, { all: true })) {
        const r = await buildResponse(ctx, { kind: 'object', col: target.col, obj }, request);
        if (!res.write(renderResponse(r))) {
          await new Promise<void>((ok) => res.once('drain', ok));
        }
      }
    }
  }

  endMultistatus(res);
}

async function buildResponse(ctx: DavCtx, target: Resource, request: ReturnType<typeof parsePropfind>) {
  const available = target.kind === 'object' ? ALL_OBJECT_PROPS : ALL_COLLECTION_PROPS;

  // propname: names only, no values. Apple uses this during account setup.
  if (request.kind === 'propname') {
    return { href: hrefOf(target), found: available.map((p) => ({ ...p })), notFound: [] };
  }

  const wanted: PropName[] =
    request.kind === 'allprop'
      ? [...available, ...request.include]           // allprop + <D:include> extras
      : request.props;

  const found: PropResult[] = [];
  const notFound: PropResult[] = [];

  for (const p of wanted) {
    const value =
      target.kind === 'object'
        ? await resolveObjectProps(ctx, target, p)
        : await resolveCollectionProps(ctx, target, p);
    // undefined => the property does not exist here => it MUST still appear, under 404
    if (value === undefined) notFound.push({ ns: p.ns, name: p.name });
    else found.push({ ns: p.ns, name: p.name, value });
  }

  return { href: hrefOf(target), found, notFound };
}
```

Property registry sketch — this is where `caldav-adapter/common/tags.js` is worth reading in full:

```ts
// packages/caldav/src/props/registry.ts
import { NS } from '../xml/parse.js';
import type { PropValue } from '../xml/serialize.js';

export const ALL_COLLECTION_PROPS = [
  { ns: NS.D,  name: 'resourcetype' },
  { ns: NS.D,  name: 'displayname' },
  { ns: NS.D,  name: 'getetag' },              // present on some servers, absent on others
  { ns: NS.D,  name: 'getcontenttype' },
  { ns: NS.D,  name: 'owner' },
  { ns: NS.D,  name: 'current-user-principal' },
  { ns: NS.D,  name: 'current-user-privilege-set' },
  { ns: NS.D,  name: 'supported-report-set' },
  { ns: NS.D,  name: 'sync-token' },
  { ns: NS.C,  name: 'calendar-description' },
  { ns: NS.C,  name: 'calendar-timezone' },
  { ns: NS.C,  name: 'supported-calendar-component-set' },
  { ns: NS.C,  name: 'supported-calendar-data' },
  { ns: NS.C,  name: 'max-resource-size' },
  { ns: NS.CS, name: 'getctag' },
  { ns: NS.IC, name: 'calendar-color' },
  { ns: NS.IC, name: 'calendar-order' },
] as const;

export async function resolveCollectionProps(ctx, t, p): Promise<PropValue | undefined> {
  const c = t.col;
  const k = `${p.ns}|${p.name}`;
  switch (k) {
    case `${NS.D}|resourcetype`:
      return { kind: 'resourcetype', types: [
        { ns: NS.D, name: 'collection' },
        { ns: NS.C, name: 'calendar' },
      ]};
    case `${NS.D}|displayname`:            return { kind: 'text', text: c.displayName };
    case `${NS.D}|current-user-principal`: return { kind: 'href', href: principalHref(ctx.userId) };
    case `${NS.D}|owner`:                  return { kind: 'href', href: principalHref(ctx.userId) };
    case `${NS.D}|sync-token`:             return { kind: 'text', text: c.syncToken };
    case `${NS.D}|supported-report-set`:
      return { kind: 'raw', xml:
        `<D:supported-report-set xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
           <D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report>
           <D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report>
           <D:supported-report><D:report><D:sync-collection/></D:report></D:supported-report>
           <D:supported-report><D:report><D:expand-property/></D:report></D:supported-report>
         </D:supported-report-set>` };
    case `${NS.D}|current-user-privilege-set`:
      return { kind: 'raw', xml:
        `<D:current-user-privilege-set xmlns:D="DAV:">` +
        c.privileges.map((p) => `<D:privilege><D:${p}/></D:privilege>`).join('') +
        `</D:current-user-privilege-set>` };
    case `${NS.C}|supported-calendar-component-set`:
      return { kind: 'raw', xml:
        `<C:supported-calendar-component-set xmlns:C="urn:ietf:params:xml:ns:caldav">` +
        c.components.map((n) => `<C:comp name="${n}"/>`).join('') +
        `</C:supported-calendar-component-set>` };
    case `${NS.C}|supported-calendar-data`:
      return { kind: 'raw', xml:
        `<C:supported-calendar-data xmlns:C="urn:ietf:params:xml:ns:caldav">` +
        `<C:calendar-data content-type="text/calendar" version="2.0"/></C:supported-calendar-data>` };
    case `${NS.C}|calendar-description`:   return c.description ? { kind: 'text', text: c.description } : undefined;
    case `${NS.C}|max-resource-size`:      return { kind: 'text', text: String(10 * 1024 * 1024) };
    case `${NS.CS}|getctag`:               return { kind: 'text', text: c.ctag };
    case `${NS.IC}|calendar-color`:        return c.color ? { kind: 'text', text: c.color } : undefined;
    case `${NS.IC}|calendar-order`:        return c.order != null ? { kind: 'text', text: String(c.order) } : undefined;
    default:                               return undefined;   // -> 404 propstat
  }
}
```

### 7.3 `REPORT`

```ts
// packages/caldav/src/methods/report.ts
import { parseDavXml, NS } from '../xml/parse.js';
import { parseCalendarQuery, parseCalendarMultiget, parseSyncCollection } from '../xml/calendar-query.js';
import { beginMultistatus, endMultistatus, renderResponse } from '../xml/serialize.js';
import type { DavCtx } from '../router.js';

export async function handleReport(ctx: DavCtx) {
  const doc = parseDavXml(ctx.xml!);
  const root = doc.documentElement;

  // Dispatch on (namespaceURI, localName). NEVER on the prefix.
  const key = `${root.namespaceURI}|${root.localName}`;
  switch (key) {
    case `${NS.C}|calendar-query`:    return calendarQuery(ctx);
    case `${NS.C}|calendar-multiget`: return calendarMultiget(ctx);
    case `${NS.D}|sync-collection`:   return syncCollection(ctx);
    case `${NS.D}|expand-property`:   return expandProperty(ctx);
    case `${NS.C}|free-busy-query`:   return sendPreconditionError(ctx.res, 403, '<C:supported-report xmlns:C="urn:ietf:params:xml:ns:caldav"/>');
    default:
      // RFC 3253 §3.6: unsupported REPORT -> 403 with DAV:supported-report
      return sendPreconditionError(ctx.res, 403, '<D:supported-report xmlns:D="DAV:"/>');
  }
}

async function calendarQuery(ctx: DavCtx) {
  const q = parseCalendarQuery(ctx.xml!);
  const col = await requireCollection(ctx);

  // Push what you can into SQL; do the rest in JS.
  const filter = compileFilter(q.filter);        // -> { componentType, statusIn, completedIsNull, timeRange, ... }

  beginMultistatus(ctx.res);
  for await (const obj of ctx.store.queryObjects(ctx.userId, col.id, filter.sql)) {
    // Second pass: anything SQL could not express (text-match collations, param-filter,
    // and time-range against RRULE-expanded instances) is evaluated here with ical.js.
    if (!filter.js(obj)) continue;
    ctx.res.write(renderResponse({
      href: obj.href,
      found: q.props.map((p) => materialiseObjectProp(p, obj, q.calendarData)),
      notFound: [],
    }));
  }
  endMultistatus(ctx.res);
}

async function calendarMultiget(ctx: DavCtx) {
  const { props, hrefs } = parseCalendarMultiget(ctx.xml!);
  const col = await requireCollection(ctx);

  beginMultistatus(ctx.res);
  for await (const r of ctx.store.getObjects(ctx.userId, col.id, hrefs)) {
    if ('missing' in r) {
      // Missing hrefs MUST come back as a bare response with a status, not be silently dropped.
      ctx.res.write(renderResponse({ href: r.href, found: [], notFound: [], status: 404 }));
    } else {
      ctx.res.write(renderResponse({
        href: r.href,
        found: props.map((p) => materialiseObjectProp(p, r)),
        notFound: [],
      }));
    }
  }
  endMultistatus(ctx.res);
}

async function syncCollection(ctx: DavCtx) {
  const q = parseSyncCollection(ctx.xml!);
  const col = await requireCollection(ctx);

  let result;
  try {
    result = await ctx.store.changesSince(ctx.userId, col.id, q.syncToken, q.limit);
  } catch (e) {
    if (isInvalidSyncToken(e)) {
      // RFC 6578 §3.2: 403 + DAV:valid-sync-token makes the client do a full resync.
      return sendPreconditionError(ctx.res, 403, '<D:valid-sync-token xmlns:D="DAV:"/>');
    }
    throw e;
  }

  beginMultistatus(ctx.res);
  for (const ch of result.changes) {
    if (ch.type === 'deleted') {
      ctx.res.write(renderResponse({ href: ch.href, found: [], notFound: [], status: 404 }));
    } else {
      const obj = await loadOne(ctx, col.id, ch.href);
      ctx.res.write(renderResponse({
        href: ch.href,
        found: q.props.map((p) => materialiseObjectProp(p, obj)),
        notFound: [],
      }));
    }
  }
  if (result.truncated) {
    // RFC 6578 §3.6: signal truncation so the client immediately asks again
    ctx.res.write(
      '  <D:response><D:href>' + collectionHref(col) + '</D:href>' +
      '<D:status>HTTP/1.1 507 Insufficient Storage</D:status>' +
      '<D:error><D:number-of-matches-within-limits/></D:error></D:response>\n',
    );
  }
  // <D:sync-token> is a child of <D:multistatus>, AFTER all <D:response> elements.
  endMultistatus(ctx.res, result.newToken);
}
```

### 7.4 `PUT`

```ts
// packages/caldav/src/methods/put.ts
import ICAL from 'ical.js';
import { etagOf } from '../etag.js';
import type { DavCtx } from '../router.js';

const CAL_PRECOND = (el: string) =>
  `<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${el}</D:error>`;

export async function handlePut(ctx: DavCtx, raw: Buffer) {
  const { req, res, store, userId, path } = ctx;

  // --- 1. media type ------------------------------------------------------
  // Apple sends: text/calendar; charset=utf-8; component=VTODO  -> substring match, never equality
  const ct = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.includes('text/calendar')) {
    return sendError(res, 415, CAL_PRECOND('<C:supported-calendar-data/>'));
  }

  const col = await requireCollection(ctx);
  const href = path;

  // --- 2. conditional headers --------------------------------------------
  const ifMatch = normaliseEtag(req.headers['if-match']);          // strips W/ and whitespace
  const ifNoneMatch = String(req.headers['if-none-match'] ?? '').trim();
  if (ifNoneMatch && ifNoneMatch !== '*') {
    return sendError(res, 400, 'only If-None-Match: * is supported');
  }

  // --- 3. parse and validate iCalendar ------------------------------------
  const text = raw.toString('utf8');
  let comp: ICAL.Component;
  try {
    comp = new ICAL.Component(ICAL.parse(text));
  } catch {
    return sendError(res, 415, CAL_PRECOND('<C:valid-calendar-data/>'));
  }
  if (comp.name !== 'vcalendar') {
    return sendError(res, 415, CAL_PRECOND('<C:valid-calendar-data/>'));
  }

  // RFC 4791 §4.1: exactly one component *type*, one UID, overrides share the UID.
  const subs = comp.getAllSubcomponents().filter((c) => c.name !== 'vtimezone');
  if (subs.length === 0) {
    return sendError(res, 403, CAL_PRECOND('<C:valid-calendar-object-resource/>'));
  }
  const types = new Set(subs.map((c) => c.name.toUpperCase()));
  if (types.size !== 1) {
    return sendError(res, 403, CAL_PRECOND('<C:valid-calendar-object-resource/>'));
  }
  const componentType = [...types][0] as 'VEVENT' | 'VTODO';

  if (!col.components.includes(componentType)) {
    return sendError(res, 403, CAL_PRECOND('<C:supported-calendar-component/>'));
  }

  const uids = new Set(subs.map((c) => c.getFirstPropertyValue('uid') as string));
  if (uids.size !== 1 || !uids.has) {
    return sendError(res, 403, CAL_PRECOND('<C:valid-calendar-object-resource/>'));
  }
  const uid = [...uids][0];
  if (!uid) return sendError(res, 403, CAL_PRECOND('<C:valid-calendar-object-resource/>'));

  // --- 4. size ------------------------------------------------------------
  if (raw.length > 10 * 1024 * 1024) {
    return sendError(res, 403, CAL_PRECOND('<C:max-resource-size>10485760</C:max-resource-size>'));
  }

  // --- 5. UID uniqueness within the collection ----------------------------
  const existingByUid = await store.findByUid(userId, col.id, uid);
  if (existingByUid && existingByUid.href !== href) {
    // C:no-uid-conflict carries the href of the conflicting resource
    return sendError(res, 403, CAL_PRECOND(
      `<C:no-uid-conflict><D:href>${existingByUid.href}</D:href></C:no-uid-conflict>`,
    ));
  }

  // --- 6. write; the store bumps sync_seq in the SAME transaction ---------
  const etag = etagOf(text);
  let result;
  try {
    result = await store.putObject(userId, col.id, href, text, {
      ifMatch: ifMatch ?? undefined,
      ifNoneMatch: ifNoneMatch === '*' ? '*' : undefined,
    });
  } catch (e) {
    if (isPreconditionFailed(e)) return sendError(res, 412, '');
    throw e;
  }

  // --- 7. respond ---------------------------------------------------------
  // ALWAYS return the ETag on PUT. Without it DAVx5 and Apple immediately re-GET
  // every object they just wrote, which turns one sync into two.
  res.writeHead(result.created ? 201 : 204, {
    ETag: result.etag ?? etag,
    'Content-Length': '0',
    DAV: '1, 2, 3, access-control, calendar-access',
  });
  res.end();
}

function normaliseEtag(h: string | string[] | undefined): string | null {
  const v = (Array.isArray(h) ? h[0] : h)?.trim();
  if (!v || v === '*') return v ?? null;
  return v.startsWith('W/') ? v.slice(2) : v;
}
```

RFC 4791 §5.3.2 preconditions used above, for reference — send these as the `<D:error>` child so clients can render something useful:

| Precondition element | Status | When |
|---|---|---|
| `CALDAV:supported-calendar-data` | 415 | body is not `text/calendar` |
| `CALDAV:valid-calendar-data` | 415 | not parseable as iCalendar |
| `CALDAV:valid-calendar-object-resource` | 403 | multiple component types, no UID, mismatched UIDs, or a `METHOD` property present |
| `CALDAV:supported-calendar-component` | 403 | component type not in `supported-calendar-component-set` |
| `CALDAV:no-uid-conflict` | 403 | UID already exists at another href in this collection |
| `CALDAV:max-resource-size` | 403 | body exceeds the advertised limit |
| `CALDAV:min-date-time` / `CALDAV:max-date-time` | 403 | dates outside the server's supported range |
| `CALDAV:max-instances` / `CALDAV:max-attendees-per-instance` | 403 | recurrence/attendee limits |

`MKCALENDAR` (RFC 4791 §5.3.1) status codes: **201 Created** on success, **207 Multi-Status** if some properties in the request body failed, **403 Forbidden** if a calendar cannot be created there, **409 Conflict** if intermediate collections are missing, **415 Unsupported Media Type**, **507 Insufficient Storage**. A resource MUST NOT already exist at the Request-URI.

`OPTIONS` must advertise, per RFC 4791: `DAV: 1, 2, access-control, calendar-access` (Fem-ho adds `3` and `extended-mkcol`).

---

## 8. DAVx⁵ / Apple quirks that the **Node** stack specifically makes harder

Protocol-level quirks are covered in dossier 03. This table is only the ones where Node/JS/npm is the aggravating factor.

| # | Quirk | Why Node makes it harder | Fix |
|---|---|---|---|
| 1 | Unknown verb → **400 from llhttp**, never reaches JS, cannot be turned into 501 | The method table is compiled into the vendored parser; no config knob | Irrelevant for CalDAV (all verbs present). Do not attempt RFC 3253 versioning verbs on `node:http`. |
| 2 | **Global JSON body parser silently eats the XML** | Express/Fastify/Hono all encourage app-wide body parsing; the stream is consumed and `PROPFIND` sees an empty body — with **no error** | Mount `/dav` on a separate `http.Server`/port, or strictly before any parser. Assert `typeof body === 'string' \|\| Buffer.isBuffer(body)` in dev. |
| 3 | **Fastify 404s DAV verbs** and then **415s XML bodies** | Default verb set is `GET/HEAD/TRACE/DELETE/OPTIONS/PATCH/PUT/POST/QUERY`; content-type parsers are opt-in | `addHttpMethod(m, { hasBody: true })` for each, plus `addContentTypeParser(['application/xml','text/xml'], {parseAs:'buffer'}, …)` and a `'*'` fallback |
| 4 | **Express 5 rejects `'/dav/*'`** at mount time | path-to-regexp 8 removed the bare `*` wildcard | Use `'/dav/{*splat}'` |
| 5 | **Express decodes route params**, hrefs are percent-encoded | `%2F` inside a UID becomes `/` → wrong collection or traversal | Read `req.url` raw, `decodeURIComponent` exactly once, re-encode for `<D:href>` |
| 6 | **`Expect: 100-continue` hangs Apple's `PUT`** | Node auto-answers only when *no* `'checkContinue'` listener exists; adding one for pre-auth silently breaks it | If you attach the listener, call `res.writeContinue()` then `server.emit('request', req, res)` |
| 7 | **`fetch`/undici sends lowercase custom methods** | Fetch normalises only `DELETE/GET/HEAD/OPTIONS/POST/PUT`; `method:'propfind'` goes out literally | Uppercase every DAV verb in the *client* code (§4.1) |
| 8 | **`fetch` rewrites `PROPFIND` to `GET` across a 301/302** | Spec redirect rules; `/.well-known/caldav` is a redirect | `redirect: 'manual'` and re-issue; serve **308** (not 301) for non-GET-safe redirects |
| 9 | **Prefix-keyed XML parsers break on the second client** | The npm default (`fast-xml-parser`, `xml2js`) is not namespace-aware; DAVx⁵/Apple/Thunderbird/Nextcloud use different prefixes and default namespaces | `@xmldom/xmldom` + `xpath.useNamespaces`; dispatch on `(namespaceURI, localName)` |
| 10 | **Re-serialised ICS ⇒ unstable ETag ⇒ infinite DAVx⁵ resync** | JS object key order, `Date` formatting and line folding are not stable across versions; easy to compute the etag lazily | Store the exact bytes and the etag at write time; deterministic generator with `DTSTAMP = updated_at` |
| 11 | **`Content-Type: text/calendar; charset=utf-8; component=VTODO`** fails equality checks | JS devs reach for `=== 'text/calendar'` | Substring match, or parse with `content-type` |
| 12 | **`If-Match: W/"…"` fails strict comparison** | Some proxies weaken etags; JS `===` on the raw header | Strip `W/` before comparing |
| 13 | **Catalan display names mojibake in Evolution/Thunderbird** | Node happily emits UTF-8 but omitting `charset` in `Content-Type` lets the client guess Latin-1 | Always `application/xml; charset=utf-8` |
| 14 | **Large `calendar-query` responses blow RSS** | Building the whole multistatus with a DOM/`xmlbuilder2` root before writing | Stream `<D:response>` fragments; honour `res.write()` backpressure (§1.6.1) |
| 15 | **Apple/DAVx⁵ never authenticate until challenged** | Frameworks default to 403/404 on missing auth | Return **401** with `WWW-Authenticate: Basic realm="Fem-ho"`, never 403, for unauthenticated DAV requests |
| 16 | **Hono's WHATWG `Request` conversion** | Bodies on non-GET/HEAD need `duplex:'half'`; adapter versions differ | Pin `@hono/node-server`, add a test that a `PROPFIND` body arrives intact |
| 17 | **HTTP/2 compat layer is untested for DAV** | `Http2ServerRequest` is a shim over a different stack | Serve DAV over HTTP/1.1 at the origin; let the proxy do h2 |
| 18 | **Cloudflare/WAF blocks `PROPFIND`** in front of the self-hosted deployment | Nothing to do with Node, but Node devs test on localhost and ship | Document the WAF exception; add the `OPTIONS`/`PROPFIND` smoke test to the install checklist |
| 19 | **`Depth` header arrives as `depth`** | Node lowercases all header names | Only read lowercase keys; never `req.headers['Depth']` |
| 20 | **Duplicate `Destination`/`Overwrite` become an array** | Node's default header joining | `joinDuplicateHeaders: true` on `createServer` |

---

## 9. Recommended package list, pinned

```jsonc
// packages/caldav/package.json
{
  "engines": { "node": ">=22.0.0" },
  "dependencies": {
    // --- XML: parse ---------------------------------------------------
    "@xmldom/xmldom": "0.9.10",   // MIT, zero deps, namespace-aware DOM
    "xpath":          "0.0.34",   // MIT, EXACT pin (caldav-adapter pins it exactly too)

    // --- XML: serialise -----------------------------------------------
    "xmlbuilder2":    "4.0.3",    // MIT, correct xmlns emission via .ele(ns, name)

    // --- iCalendar ----------------------------------------------------
    "ical.js":        "2.2.1",    // MPL-2.0, RFC 5545 + RecurExpansion + VTIMEZONE

    // --- HTTP plumbing ------------------------------------------------
    "raw-body":       "^2.5.2",   // as used by caldav-adapter (3.x exists; UNVERIFIED)
    "basic-auth":     "^2.0.1"    // as used by caldav-adapter
  },
  "optionalDependencies": {
    "saxes": "6.0.0",             // ISC — only if DOM parsing of huge multigets becomes a problem
    "rrule": "2.8.1"              // BSD-3-Clause — only for human-readable RRULE text in the UI
  },
  "devDependencies": {
    "vitest": "^3",               // UNVERIFIED exact major
    "typescript": "^5"            // UNVERIFIED exact minor
  }
}
```

Client side (source calendars):

```jsonc
{
  "dependencies": {
    "tsdav":   "2.3.1",   // MIT, node>=18, deps: debug + xml-js only
    "ical.js": "2.2.1"
  }
}
```

If the DAV surface is hosted inside an existing framework rather than raw `node:http`:

```jsonc
{ "fastify": "5.11.2" }                                  // + addHttpMethod + addContentTypeParser
{ "hono": "4.13.0", "@hono/node-server": "2.1.0" }       // node>=20, peer hono ^4
{ "express": "^5.1.0" }                                  // path-to-regexp 8 wildcard syntax
```

**Explicitly rejected:**

| Package | Reason |
|---|---|
| `fast-xml-parser@5.10.1` | not namespace-aware; `removeNSPrefix` is destructive; no xmlns scoping |
| `xml2js@0.6.x` | same, plus it is what nephele uses and part of why nephele is not extensible to CalDAV |
| `libxmljs2@0.37.0` | native build (`nan`, `node-gyp`, `prebuild-install`), `node>=22`, multi-arch Docker pain for a self-hosted product |
| `@rschedule/core@1.5.0` | last published 2 March 2023; unmaintained |
| `webdav-server@2.6.3` | `engines: node>=4`, Unlicense, WebDAV files only |
| `nephele@1.0.0-alpha.67` | no CalDAV, and CalDAV is only "maybe" on its roadmap |
| `caldav-adapter@9.3.12` **as a dependency** | Koa, `moment`, `lodash`, undocumented store contract — but **read it**, it is the reference |

Reference containers for the CI diff harness (pin by digest in CI):

```
tomsquest/docker-radicale:3.2.3.0     # Radicale 3.x (3.7.5 is the current upstream release)
ghcr.io/jelmer/xandikos:latest        # Xandikos 0.3.3
ckulka/baikal:nginx                   # Baïkal 0.11.1 / sabre-dav 4.7.0
```

---

## 10. Suggested build order for M8

Each step ends with a client that visibly works, so you never spend a week without feedback.

| Step | Deliverable | "Done" test |
|---|---|---|
| **M8.0** | `packages/caldav` scaffold, `CalDavStore` port, raw `node:http` router, `OPTIONS` + `DAV:`/`Allow`, `/.well-known/caldav` **308** redirect | `curl -X OPTIONS` shows `DAV: 1, 2, 3, access-control, calendar-access` |
| **M8.1** | Basic auth with per-device app passwords, 401 challenge; principal resource; `current-user-principal`, `calendar-home-set`, `calendar-user-address-set` | DAVx⁵ "Login" completes and shows an empty account |
| **M8.2** | `PROPFIND` engine + property registry; collections for each scope and project with `resourcetype`, `displayname`, `supported-calendar-component-set`, `getctag`, `IC:calendar-color` | DAVx⁵ lists Personal / Feina / Família and every project, in the right Plou accent colour |
| **M8.3** | `GET` + `PUT` + `DELETE` with stored ETags, `If-Match`, RFC 4791 preconditions; VTODO ↔ task mapping (status ↔ kanban column, `DUE`, `PRIORITY`, `PERCENT-COMPLETE`, `RELATED-TO` for subtasks) | Create a task in Fem-ho → it appears in Nextcloud Tasks; complete it there → the kanban card moves to **Fet** |
| **M8.4** | `calendar-multiget` + `calendar-query` (comp-filter, prop-filter, `is-not-defined`, text-match) | The incomplete-VTODO query returns exactly the Inbox/Per fer/Fent cards |
| **M8.5** | `sync_seq` counter, tombstones, `sync-collection` + `sync-token` + `403 valid-sync-token`, `supported-report-set` advertising it | DAVx⁵ incremental sync transfers only deltas; delete on phone propagates |
| **M8.6** | VEVENT support in scope general spaces; `time-range` filter with `ical.js` recurrence expansion; `RECURRENCE-ID` overrides | Apple Calendar shows the month; moving one occurrence of a weekly event round-trips |
| **M8.7** | `MKCALENDAR` + extended `MKCOL` + `PROPPATCH` (`displayname`, `calendar-color`, `calendar-order`, `calendar-description`) | Creating a calendar in Apple Calendar creates a Fem-ho scope; renaming it renames the scope |
| **M8.8** | Client direction: source calendars via `tsdav` + `ical.js`, read-only `external_event` rows | A school-menu ICS and an iCloud family calendar render in the Calendar view |
| **M8.9** | CI: python-caldav suite, golden transcripts for 6 clients, Docker Compose diff harness | Green on push; incompatibility list shrinking |

Non-goals for M8, explicitly: CalDAV **scheduling** (RFC 6638 inbox/outbox — Fem-ho's `@person` assignment is an app concept, not iTIP), `free-busy-query`, WebDAV `LOCK` (advertise `DAV: 2` only if you actually implement it — if not, drop the `2`), CardDAV, and CalDAV for the checklist feature.

---

## What Fem-ho should do

1. **Build the CalDAV server in-process, in TypeScript. Do not add a Go or Python sidecar.** The premise of dossier 08 §1.2 (no Node CalDAV code exists to learn from) is false: `caldav-adapter@9.3.12` (MIT, Forward Email, Node ≥18) implements `calendar-query`, `calendar-multiget`, `sync-collection`, `expand-property`, `MKCALENDAR`, `PROPPATCH` and ctag in ~4k lines of readable JS on the exact XML stack recommended here. Revise dossiers 03 §11.2 and 08 §1.2.
2. **Host the DAV surface on raw `node:http`**, on its own port, in `packages/caldav`, with a single `CalDavStore` port as the only seam to the rest of the app. No framework, no body-parsing middleware, no JSON. If you must share the main server, mount before every parser and use Fastify's `addHttpMethod` + `addContentTypeParser`, or Hono's `app.on([...verbs], '/dav/*', …)`.
3. **XML stack, pinned: `@xmldom/xmldom@0.9.10` + `xpath@0.0.34` (exact) for parse, `xmlbuilder2@4.0.3` for serialise.** Ban `fast-xml-parser` and `xml2js` from the DAV path by lint rule. Dispatch every element decision on `(namespaceURI, localName)` — never on a prefix. Serialise with `D:`/`C:`/`CS:`/`IC:` declared once on `<D:multistatus>`.
4. **Stream every 207.** `res.writeHead(207, {'Content-Type':'application/xml; charset=utf-8', DAV: …})`, no `Content-Length`, write one `<D:response>` at a time, honour `drain`. A household calendar will exceed a comfortable in-memory DOM sooner than you think.
5. **One monotonic `sync_seq` per collection, bumped inside the same transaction as every mutation, drives both `ctag` and `sync-token`.** Add a `dav_tombstone` table. Compute ETags **once at write time** over the exact bytes you will serve back, and store them. This single rule prevents the classic infinite-resync failure and is the reason a sidecar is rejected.
6. **Store the raw ICS bytes a client PUT and echo them verbatim.** When the web/Android app writes, regenerate deterministically (fixed property order, fixed `PRODID`, `DTSTAMP = updated_at`) and merge back preserved X-properties. Never re-serialise on read.
7. **Use `ical.js@2.2.1` for all iCalendar work including recurrence** — it is the only option that models `RDATE`/`EXDATE`/`RECURRENCE-ID` overrides, which is what actually breaks interop. Keep `rrule@2.8.1` only for Catalan human-readable RRULE text in the UI. Do not adopt `@rschedule` (last published 2023).
8. **Use `tsdav@2.3.1` + `ical.js` for the client direction**, with `smartCollectionSync`; uppercase every DAV verb because `fetch` will not; use `redirect: 'manual'` and re-issue the verb after `/.well-known` redirects; treat external source calendars as read-only.
9. **Advertise `supported-calendar-component-set` honestly per collection**: `VTODO` for project collections, `VEVENT,VTODO` for a scope's general space. That is what makes a scope appear in both Apple Reminders and Apple Calendar. Serve **308** (not 301/302) for `/.well-known/caldav` so non-GET verbs survive the redirect. Always answer unauthenticated DAV requests with **401 + `WWW-Authenticate: Basic`**, never 403.
10. **Do not expose checklists ("simple task lists") over CalDAV.** They are not calendar data; REST + MCP + share links only. Likewise defer RFC 6638 scheduling — `@person` assignment is an app concept, not iTIP.
11. **Wire the CI harness in M8.0, not M8.9**: python-caldav's functional suite pointed at a live Fem-ho with a shrinking `incompatibilities` list, golden-transcript snapshots captured from real DAVx⁵/Apple/Thunderbird/Evolution/Nextcloud Tasks sessions, and a Docker Compose diff harness against Radicale + Xandikos + Baïkal. Mine `apple/ccs-caldavtester`'s `Resource/CalDAV/**` XML for fixtures but do not depend on it (archived, Python 2).
12. **Budget ≈ 40–60 developer-days for M8**, weighted toward `calendar-query`'s time-range×recurrence semantics, the task↔VTODO mapping, and real-client debugging — not toward XML. Serve DAV over HTTP/1.1 at the origin and document the Cloudflare/WAF `PROPFIND` exception in the self-hosting guide.

---

## Sources

Fetched during this research pass:

**Node / HTTP layer**
- https://nodejs.org/api/http.html — `http` module, streaming request bodies, `clientError` semantics
- https://raw.githubusercontent.com/nodejs/node/main/deps/llhttp/include/llhttp.h — LLHTTP 9.4.3, `HTTP_ALL_METHOD_MAP` numeric values for `COPY/LOCK/MKCOL/MOVE/PROPFIND/PROPPATCH/SEARCH/UNLOCK/ACL/REPORT/MKACTIVITY/MKCALENDAR`
- https://raw.githubusercontent.com/nodejs/node/main/doc/api/http.md — `'clientError'` default 400 / 431 behaviour
- https://github.com/nodejs/node/issues/33699 — HTTP/1 vs HTTP/2 method-set asymmetry
- https://raw.githubusercontent.com/jshttp/methods/master/index.js — `methods` derives from `http.METHODS` at runtime
- https://fetch.spec.whatwg.org/ — "forbidden method" (`CONNECT`/`TRACE`/`TRACK`) and "normalize a method" (only `DELETE/GET/HEAD/OPTIONS/POST/PUT` are uppercased)

**Frameworks**
- https://raw.githubusercontent.com/fastify/fastify/main/docs/Reference/Server.md — `addHttpMethod` signature, `hasBody` / `overrideExisting`, default verb set incl. `QUERY`, `bodyLimit`
- https://registry.npmjs.org/fastify/latest — 5.11.2
- https://hono.dev/docs/api/routing — `app.on(method, path, handler)`, array form, `app.all`
- https://registry.npmjs.org/hono/latest — 4.13.0
- https://registry.npmjs.org/@hono/node-server/latest — 2.1.0, `node>=20`, peer `hono ^4`
- https://expressjs.com/en/5x/api/router/ — `router.METHOD`, `router.all`, `router.query()` runtime gating

**XML libraries**
- https://registry.npmjs.org/@xmldom/xmldom/latest — 0.9.10, MIT, `node>=14.6`, zero deps
- https://registry.npmjs.org/xmlbuilder2/latest — 4.0.3, MIT
- https://registry.npmjs.org/fast-xml-parser/latest — 5.10.1, MIT
- https://registry.npmjs.org/saxes/latest — 6.0.0, ISC, dep `xmlchars`
- https://registry.npmjs.org/libxmljs2/latest — 0.37.0, MIT, `node>=22`, native deps
- https://registry.npmjs.org/libxml2-wasm/latest — 0.7.1, MIT, `node>=18`

**Node CalDAV/WebDAV server code**
- https://registry.npmjs.org/caldav-adapter/latest — 9.3.12, MIT, `node>=18`, dependency list
- https://api.github.com/repos/forwardemail/caldav-adapter/git/trees/master?recursive=1 — full file tree
- https://raw.githubusercontent.com/forwardemail/caldav-adapter/master/routes/calendar/calendar/report.js — REPORT dispatch: `calendar-query`, `calendar-multiget`, `expand-property`, `sync-collection`; 403/400 handling
- https://raw.githubusercontent.com/forwardemail/caldav-adapter/master/common/xml.js — `xpath.useNamespaces({DAV, CAL, CS, ICAL})`
- https://raw.githubusercontent.com/forwardemail/caldav-adapter/master/common/parse-body.js — `raw-body` 10 MiB + `@xmldom/xmldom` DOMParser, `type.includes('xml')`
- https://raw.githubusercontent.com/forwardemail/caldav-adapter/master/index.js — options object, middleware structure
- https://raw.githubusercontent.com/sedenardi/node-caldav-adapter/master/README.md — upstream project, MIT
- https://registry.npmjs.org/nephele/latest — 1.0.0-alpha.67, Apache-2.0, deps incl. `xml2js`, `express ^5.1.0`
- https://github.com/sciactive/nephele — WebDAV done, CardDAV planned, **CalDAV "maybe"**, ACL in progress
- https://registry.npmjs.org/webdav-server/latest — 2.6.3, Unlicense, `node>=4`

**Client-side libraries**
- https://registry.npmjs.org/tsdav/latest — 2.3.1, MIT, `node>=18`, deps `debug` + `xml-js`
- https://raw.githubusercontent.com/natelindev/tsdav/master/README.md — `createDAVClient` / `DAVClient`, `authMethod` values, `fetchCalendars`, `fetchCalendarObjects`
- https://registry.npmjs.org/ical.js/latest — 2.2.1, MPL-2.0
- https://registry.npmjs.org/rrule/latest — 2.8.1, BSD-3-Clause
- https://registry.npmjs.org/@rschedule/core/latest — 1.5.0, Unlicense, last published 2 March 2023

**Specs and reference servers**
- https://www.rfc-editor.org/rfc/rfc4791.txt — MKCALENDAR status codes and preconditions, PUT preconditions §5.3.2, `calendar-query`/`calendar-multiget` structure, `supported-calendar-component-set`, `calendar-home-set`, `supported-calendar-data`, `DAV: 1, 2, access-control, calendar-access`
- https://radicale.org/master.html — Radicale v3 storage plugin (`Storage` extends `radicale.storage.BaseStorage`), `multifilesystem` vs `multifilesystem_nolock`, `[storage] hook` placeholders
- https://www.xandikos.org/ — GPLv3+, Python, Git-backed, **no multi-user support**, no scheduling extensions
- https://www.davx5.com/tested-with/ — 60+ tested services; explicitly "merely informative"

Search-derived (not individually fetched, treat version numbers as indicative): Radicale 3.7.5 (2026-06-14) and `tomsquest/docker-radicale:3.2.3.0`; Xandikos 0.3.3 (2026-01-22) and `ghcr.io/jelmer/xandikos`; Baïkal 0.11.1 shipping sabre/dav 4.7.0; `apple/ccs-caldavtester` archived with forks at `CalConnect/caldavtester` and `evert/caldavtester`; python-caldav dual-licensed GPLv3/Apache-2.0.

---

## UNVERIFIED

Everything below was inferred, is search-derived rather than fetched, or was not confirmable in this pass. Verify before relying on it.

1. **The literal contents of `http.METHODS`.** The llhttp header is authoritative for the parser and unambiguous, but I never captured the doc's printed array. Run `node -p "require('node:http').METHODS.join(' ')"` on the pinned Node version before writing code.
2. **Whether Express 5's `router` package still routes through `jshttp/methods`,** and therefore whether `app.mkcalendar()` exists. The Express 5 docs' enumerated verb list omits `mkcalendar`. Check `typeof app.mkcalendar === 'function'` at boot; the `app.all()` + `switch` pattern is immune either way.
3. **Express 5's exact latest version.** `^5.1.0` is confirmed only as nephele's declared dependency range.
4. **`@hono/node-server` body forwarding for `PROPFIND`/`REPORT`.** The adapter converts to a WHATWG `Request`; verify it attaches the body for non-GET/HEAD verbs and handles `duplex: 'half'` in your pinned version.
5. **Node `http2` behaviour for arbitrary `:method` tokens.** nodejs/node#33699's method lists date from 2020 and are stale. The recommendation to serve DAV over HTTP/1.1 sidesteps this entirely.
6. **`@xmldom/xmldom` 0.9.x DTD/entity handling specifics** and the exact `DOMParser` error-callback API shape (`onError` vs the older `locator`/`errorHandler` options). Read `index.d.ts` after install. The pre-parse DOCTYPE rejection makes this moot for safety, not for API correctness.
7. **`libxml2-wasm@0.7.1`'s XPath namespace-registration and XSD/RelaxNG APIs.** Only the package metadata was fetched.
8. **`raw-body@3.x`.** Only `^2.5.2` is confirmed (via caldav-adapter's dependency list). A 3.x line may exist.
9. **`basic-auth` latest version.** `^2.0.1` confirmed only as caldav-adapter's declared range.
10. **`tsdav`'s exact exported CalDAV function signatures** (`calendarQuery`, `calendarMultiGet`, `syncCollection`, `smartCollectionSync`, `makeCalendar`, `freeBusyQuery`, `fetchCalendarUserAddresses`). The docs site returned an empty shell and the guessed docs path 404'd. Read `dist/tsdav.d.ts`.
11. **python-caldav's `tests/conf.py` / `conf_private.py` schema** — the `caldav_servers` dict field names and the exact spelling of the incompatibility flags used in the CI snippet in §6.1 are illustrative, not verified. Read the file in the repo before wiring CI.
12. **python-caldav's current release version.**
13. **`jsDAV` / `jsDAVlib` npm versions and last publish dates.** Assessed from general knowledge of the projects' dormancy, not fetched.
14. **Exact prefixes emitted by DAVx⁵'s `dav4jvm`, Apple's CalendarAgent, Thunderbird and Evolution.** The examples in §2.6 are representative shapes. The whole point of the recommendation is that you must never depend on them, so this is safe to leave unverified — but do not quote the examples as facts about a specific client.
15. **Client-specific CDATA mishandling in `<C:calendar-data>`.** Reported behaviour; the RFC-conformant path (escaped text, not CDATA) is what the code does regardless.
16. **Cloudflare/WAF default blocking of `PROPFIND`.** Widely reported; not fetched from Cloudflare documentation.
17. **`litmus`'s current packaging and version** in Debian/Ubuntu.
18. **Docker image tags and upstream versions** for Radicale (3.7.5 / `tomsquest/docker-radicale:3.2.3.0`), Xandikos (0.3.3), Baïkal (0.11.1 with sabre/dav 4.7.0). All search-derived; pin by digest after verifying in CI.
19. **The 40–60 developer-day estimate.** An engineering judgement built from the task breakdown in §5.1, not measured. The relative claim — that runtime choice moves it by days, not by a factor of 2–4× — is the load-bearing part and follows from `caldav-adapter`'s existence.
20. **Vitest and TypeScript major versions** in the devDependencies snippet.
21. **undici's `NODE_EXTRA_CA_CERTS` handling for `fetch`** when talking to a household server with a self-signed certificate.
