# 13 · Fites i acceptació

Tretze fites en ordre. Cadascuna té criteris verificables i una **comprovació automàtica**.

Regla 11 d'`instruccions.md`: **no comencis una fita sense haver passat la comprovació de l'anterior.**

---

## M1 · Esquelet i contractes

Monorepo amb `apps/server`, `apps/web`, `packages/contracts`, `packages/design-system`. TypeScript, linter, formatador, CI.

Plou vendoritzat a `packages/design-system/plou/`, amb Roboto **autoallotjada** i el token `--column-bg` afegit ([`04-design-system.md`](04-design-system.md) §2).

`openapi.yaml` amb `GET /info` i `GET /healthz`, i generació de tipus.

**Acceptació** — CI construeix; el linter passa; els tipus generats no tenen canvis pendents; `/info` respon amb nom i versió; una pàgina de prova pinta un `Button` de Plou amb el gradient correcte als quatre accents i als dos temes.

**Comprovació** — `ci: build + lint + typecheck + openapi-diff`.

> **Aquí és on es fixen les versions de dependències.** Resol-les contra els registres reals i congela-les. **No copiïs cap versió de `research/`** (regla 2).

---

## M2 · Esquema i migracions

L'esquema sencer de [`01-model-de-dades.md`](01-model-de-dades.md), amb SQLite i PostgreSQL. Migracions amb còpia prèvia.

Inclou **des del primer dia**: `events`, `calendars`, `change_log`, `activity_log`, `ai_agents`, `shares`. Afegir-los després obliga a reescriure el sync i l'API.

`localDayBounds` implementada i provada.

**Acceptació** — Les migracions van endavant i enrere en els dos motors; `localDayBounds` és correcta a `Europe/Madrid` als dos diumenges de canvi d'hora i en un fus amb desplaçament no sencer; l'esquema té totes les taules del document.

**Comprovació** — `test: migrations up/down/up` als dos motors + proves de fus.

---

## M3 · Autenticació i política

Registre, login, refresc rotatiu, argon2id. El resolutor de principals i el motor de política. Tokens d'API amb capacitats i àmbits. `activity_log` escrivint dins de la transacció.

**Acceptació** — Login i refresc funcionen; reutilitzar un token de refresc gastat revoca la família; un token limitat a un àmbit no en veu cap altre; **cada escriptura deixa una entrada a `activity_log` amb l'actor i el canal correctes**; el bloqueig per intents funciona.

**Comprovació** — `test: auth + policy + audit`. Inclou una prova que recorre tots els endpoints d'escriptura i verifica que cadascun ha escrit al log.

---

## M4 · Àmbits, projectes i tasques

CRUD complet. `POST /tasks/{id}/move` amb índexs fraccionals. `POST /tasks/{id}/complete` amb cascada. `GET /board`.

**Acceptació** — Es poden crear àmbits individuals i col·lectius; una tasca sense àmbit es rebutja; moure entre columnes conserva l'ordre; mil moviments consecutius no degeneren les claus de posició; `/board` retorna les quatre columnes agrupades per àmbit.

**Comprovació** — `test: tasks + positions`. Inclou una prova de mil moviments aleatoris que verifica que l'ordre és sempre el correcte.

---

## M5 · El kanban a la web

El tauler amb les quatre columnes, targetes, agrupació per àmbit plegable, drag & drop amb ratolí i amb teclat, i la columna Fet amb mini-calendari i botó de netejar.

L'Inbox **visualment diferent** de les altres tres, com a component reutilitzable.

**Acceptació** — Arrossegar entre columnes persisteix; arrossegar amb teclat també; la columna Fet ensenya avui més "Ahir" i "Aquesta setmana" plegats; netejar no esborra res i "veure tot el fet d'avui" ho recupera; tema fosc correcte **incloent-hi el fons de les columnes**.

**Comprovació** — `e2e: kanban.spec` — arrossegar amb ratolí, moure amb teclat, netejar i recuperar, captura dels dos temes.

---

## M6 · Afegida ràpida

`QuickAddInput` amb parseig de `@` i `#`, autocompletat accessible i xips reversibles. Els fixtures compartits a `packages/contracts`.

**Acceptació** — `#Feina/Client Salt Enviar proposta @Alba` crea la tasca a l'àmbit, projecte i persona correctes amb el títol net; amb més d'un àmbit actiu i sense `#` es mostra l'error i no es crea res; **el xip es pot tornar a text pla**; l'autocompletat funciona amb teclat.

**Comprovació** — `test: quickadd-parser` amb els fixtures compartits + `e2e: quickadd.spec`.

---

## M7 · Calendari i esdeveniments

Entitat `event` amb mestre i excepcions. Vistes mensual, setmanal i diària. El rail d'Inbox, que **és la mateixa instància de component** que la columna del kanban. Arrossegar del rail a un dia.

**Acceptació** — Es poden crear esdeveniments i tasques des del calendari; una sèrie recurrent es pot editar en mode instància, futures o tota; editar "aquest i els següents" parteix la sèrie i **no emet `RANGE=THISANDFUTURE`**; els esdeveniments **no surten mai al kanban**; el rail és configurable a esquerra, dreta o a sota.

**Comprovació** — `test: recurrence` + `e2e: calendar.spec`.

---

## M8 · Llistes senzilles

`checklist` i `checklist_item`, la vista simple, el pinejat per usuari, el rail de llistes pinejades i la cascada amunt.

**Acceptació** — Es pot crear una llista dins d'una tasca i ancorar-la a una subtasca; **marcar l'últim ítem marca la subtasca i, si tot està fet, la tasca**, i queda registrat com a cascada; pinejar-la la posa al rail i és personal; en completar-se es proposa despinejar; el commutador d'inline contra secció funciona.

**Comprovació** — `test: checklist-cascade` + `e2e: checklists.spec`.

---

## M9 · Sync i offline a la web

`GET /sync`, `POST /sync/batch`, `GET /stream`. La PWA amb magatzem local i cua de sortida.

**Acceptació** — Amb la xarxa desconnectada es pot crear, editar, moure i completar; en recuperar-la tot puja i el servidor queda idèntic; dos clients editant camps diferents de la mateixa tasca conserven els dos canvis; **dos clients reordenant la mateixa columna acaben amb el mateix ordre i sense perdre targetes**; un cursor caducat provoca resincronització completa; reenviar un lot no duplica res.

**Comprovació** — `test: sync-contract` amb els vuit casos de [`06-sync.md`](06-sync.md) §10 + `e2e: offline.spec`.

---

## M10 · CalDAV

Servidor sobre `node:http` en port propi. Descobriment, `PROPFIND`, els tres `REPORT`, `PUT` amb etags, ctag i sync-token des de `sync_seq`. Client per a orígens externs, amb les mitigacions d'SSRF.

**Acceptació** — **DAVx⁵ connecta i veu les col·leccions d'esdeveniments i de tasques per separat**; els canvis viatgen en les dues direccions; Apple Recordatoris connecta i pot completar una tasca; un `PUT` amb etag desfasat dona `412`; un sync-token vell dona `507`; **les proves d'SSRF fallen totes** ([`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md) §10); un canvi entrant per CalDAV **no** rebota cap a l'origen.

**Comprovació** — `test: caldav-conformance` contra el servidor viu, comparació amb implementacions de referència amb Compose, i `test: ssrf`. La prova amb clients reals és manual i es documenta.

---

## M11 · Tokens, MCP i mode IA

Gestió de tokens a la UI. Servidor MCP amb les 16 tools. Mode IA complet: els tres modes, els distintius, les reserves, l'historial amb desfer.

**Acceptació** — L'inspector d'MCP llista les 16 tools en ordre estable i les pot cridar; **sense token la resposta és `401` amb `WWW-Authenticate`**, no `200` amb un error dins; un token d'un sol àmbit no en veu d'altres i l'error ho explica; dos `next_task` simultanis donen tasques diferents; un agent no pot completar una tasca `assisted`; l'historial distingeix humà, IA i extern, i "Desfés" funciona.

**Comprovació** — `test: mcp` amb l'inspector + `test: ai-leasing` + `e2e: ai-mode.spec`.

---

## M12 · Compartits i notificacions

Enllaços públics amb caducitat, contrasenya i nom. Pestanya de Compartits. Push, email i webhook.

**Acceptació** — Un enllaç amb contrasenya i nom demanat funciona i registra "Extern · Marta"; sense nom demanat, "Extern · a4f2"; **un token inexistent i un de revocat responen igual**; 6 intents fan saltar el bloqueig; un recordatori arriba per push i per correu; **reiniciar el contenidor no trenca les subscripcions de push**.

**Comprovació** — `test: shares-security` + `test: notifications` incloent-hi la prova de persistència de VAPID.

---

## M13 · Android

L'app completa: login amb servidor, kanban paginat, calendari, ajustos, offline amb la mateixa cua de sortida, i notificacions sense dependre de Google.

**Acceptació** — Es pot connectar a una instància escrivint la URL, i es valida abans de demanar credencials; funciona amb un certificat propi després de confirmar-lo explícitament; **tot el que es pot fer connectat es pot fer en mode avió**, i en recuperar la xarxa tot puja; els fixtures del parser donen el mateix resultat que a la web; la interfície és **indistingible de la web mòbil**.

**Comprovació** — `test: android-parser-parity` amb els fixtures compartits + `androidTest: airplane-mode-reconciliation` + comparació de captures entre web mòbil i app.

---

## M14 · Empaquetat i publicació

Dockerfile multi-arquitectura, els dos `compose.yaml`, els exemples de proxy, `/setup`, migracions amb còpia, diagnòstic, i la publicació a CI.

**Acceptació** — `docker compose up` amb un `compose.yaml` net arrenca i porta a `/setup`; crear el primer administrador crea els tres àmbits; **CalDAV funciona darrere de cada un dels tres proxies d'exemple**; l'SSE no es talla darrere del proxy; el paquet de diagnòstic no conté cap secret; la restauració d'una còpia funciona.

**Comprovació** — `e2e: fresh-install.spec` que aixeca la pila amb Compose des de zero, i `test: proxy-matrix` que llança PROPFIND i SSE a través dels tres proxies.

---

## Comprovacions permanents

A cada canvi proposat, no només a la seva fita:

| Comprovació | Què impedeix |
| --- | --- |
| `openapi-diff` | Un endpoint sense contracte |
| `audit-coverage` | Una escriptura sense entrada a `activity_log` |
| `vocab-lint` | `column` en comptes de `status`, valors catalans en enums, `femho_` en tools d'MCP |
| `no-hardcoded-colors` | Literals de color fora dels tokens |
| `i18n-lint` | Cadenes catalanes al codi en comptes del catàleg |
| `no-pinned-from-research` | Versions copiades dels dossiers |
| `parser-parity` | Divergència entre el parser de TypeScript i el de Kotlin |
| `contrast-check` | Contrast insuficient als 8 temes (2 modes × 4 accents) |

Les tres primeres són les que sostenen les regles no negociables. Sense automatitzar-les, es trenquen a la tercera setmana.
