# 05 · API REST

`packages/contracts/openapi.yaml` és la font de veritat. **Els tipus de TypeScript i el client de Kotlin es generen des d'ell.** Un endpoint que no hi és no existeix; cap client escriu tipus a mà.

Base: `/api/v1`. Tot JSON és `application/json; charset=utf-8`.

---

## 1 · Autenticació

Dos mecanismes, un sol motor de decisió.

**Sessions** (web i Android). `POST /auth/login` amb correu i contrasenya retorna un token d'accés de vida curta i un de refresc de vida llarga. A la web els tokens van en galetes `HttpOnly`, `Secure`, `SameSite=Lax`; a Android, com a `Authorization: Bearer`.

Els tokens de refresc **roten**: cada refresc n'emet un de nou i invalida l'anterior. Si arriba un token de refresc ja gastat, es revoca tota la família de sessions — és senyal de robatori.

Les contrasenyes es guarden amb **argon2id**. Els paràmetres es fixen en fer l'scaffold contra la guia vigent, no des de `research/`.

**Tokens d'API** (integracions, MCP, IA). Cadena amb prefix llegible:

```
femho_pat_<cos aleatori>
```

Del token només se'n guarda el hash. Es mostra **un sol cop** en crear-lo. El prefix es guarda a part per poder llistar-los a la UI sense revelar-los.

### La capa de política

Regla 8 d'`instruccions.md`: **no es dupliquen lògiques entre l'API d'usuari i la d'IA.**

Cada petició es resol a un **principal**:

```
Principal {
  kind:        'user' | 'agent' | 'guest'
  userId       identitat efectiva
  agentId      si kind = 'agent'
  shareId      si kind = 'guest'
  capabilities conjunt de capacitats
  scopeIds     àmbits accessibles, o null per a tots
  source       'web' | 'android' | 'api' | 'mcp' | 'caldav' | 'share'
}
```

La comprovació de permisos es fa **a la capa de servei**, no al handler. Un token d'IA i un d'usuari travessen exactament el mateix codi: només difereix el principal amb què hi entren.

`source` es propaga fins a `activity_log` sense que cap servei l'hagi de passar a mà.

---

## 2 · Capacitats i abast

Una capacitat és `recurs:acció`:

```
tasks:read      tasks:write     tasks:delete
events:read     events:write    events:delete
checklists:read checklists:write
comments:read   comments:write
attachments:read attachments:write
projects:read   projects:write
scopes:read     scopes:write
shares:read     shares:write
tokens:manage   users:manage    instance:manage
```

Un token porta capacitats **i** una llista d'àmbits:

```json
{
  "name": "Claude · només feina",
  "capabilities": ["tasks:read", "tasks:write", "comments:write"],
  "scope_ids": ["0192f3a1-..."],
  "expires_at": "2027-01-01T00:00:00Z"
}
```

Això és el que el brief demana literalment: *"hem de poder crear un token/apikey per exemple només per a tasques de feina, així delimitem l'abast d'un error"*.

`scope_ids` a `null` vol dir tots els àmbits **del propietari**, no de la instància. Un token mai supera els permisos de qui el va crear.

**Els permisos per àmbit no van a les scopes d'OAuth.** Les scopes d'OAuth són un conjunt petit i estàtic; els àmbits són dades que l'usuari crea i esborra. Van al registre del token.

Quan una petició es rebutja per abast, l'error ha de **dir-ho**: *"Aquest token només té accés a l'àmbit Feina"*. Un 403 mut fa que un agent reintenti en bucle.

---

## 3 · Convencions

**Paginació** per cursor, no per desplaçament: amb dades que canvien, el desplaçament es salta i repeteix files.

```
GET /tasks?limit=50&cursor=<opac>
→ { "data": [...], "next_cursor": "...", "has_more": true }
```

**Filtres** com a paràmetres, combinables amb AND: `scope_id`, `project_id`, `status`, `assignee_id`, `due_before`, `due_after`, `updated_since`, `q`. Els valors múltiples se separen per comes.

**Ordenació**: `sort=position` per defecte al tauler, `sort=-completed_at` per al Fet.

**Modificacions parcials** amb `PATCH` i semàntica de fusió: els camps absents no es toquen, un `null` explícit esborra.

**Concurrència optimista**. Tota entitat sincronitzable porta `version`. Un `PATCH` amb `If-Match: <version>` que no coincideixi retorna **409** amb l'estat actual sencer al cos, perquè el client pugui fusionar sense una altra petició.

**Idempotència**. Els `POST` que creen accepten `Idempotency-Key`. Amb identificadors generats pel client, el mateix `id` reenviat retorna el recurs existent amb `200` en comptes de duplicar-lo.

**Errors** en `application/problem+json`:

```json
{
  "type": "https://femho.app/errors/scope-forbidden",
  "title": "Àmbit no accessible",
  "status": 403,
  "detail": "Aquest token només té accés a l'àmbit Feina.",
  "instance": "/api/v1/tasks/0192f3a1-..."
}
```

`detail` va en l'idioma de l'`Accept-Language`; `type` i `title` són estables i en anglès per poder-hi programar.

---

## 4 · Endpoints

### Autenticació i compte

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `POST` | `/auth/login` | Correu i contrasenya |
| `POST` | `/auth/refresh` | Rota el token de refresc |
| `POST` | `/auth/logout` | Revoca la sessió |
| `GET` | `/auth/me` | Usuari, capacitats efectives i àmbits |
| `PATCH` | `/auth/me` | Nom, fus, idioma, tema, accent |
| `POST` | `/auth/password` | Canvi de contrasenya |

`GET /info` és **públic i sense autenticar**: nom de la instància, versió, i si accepta registres. És el que fa servir Android per validar la URL del servidor abans de demanar credencials.

### Àmbits, projectes, membres

| Mètode | Ruta |
| --- | --- |
| `GET` `POST` | `/scopes` |
| `GET` `PATCH` `DELETE` | `/scopes/{id}` |
| `GET` `POST` | `/scopes/{id}/members` |
| `PATCH` `DELETE` | `/scopes/{id}/members/{memberId}` |
| `GET` `POST` | `/projects` |
| `GET` `PATCH` `DELETE` | `/projects/{id}` |

### Tasques

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `GET` | `/tasks` | Amb filtres |
| `POST` | `/tasks` | `id` el pot posar el client |
| `GET` `PATCH` `DELETE` | `/tasks/{id}` | |
| `POST` | `/tasks/{id}/move` | `{status, position}` o `{status, before_id, after_id}` |
| `POST` | `/tasks/{id}/complete` | Aplica la cascada i genera la següent si es repeteix |
| `GET` | `/tasks/{id}/activity` | Historial |
| `GET` `POST` | `/tasks/{id}/subtasks` |
| `GET` `POST` | `/tasks/{id}/checklists` |
| `GET` `POST` | `/tasks/{id}/comments` |
| `GET` `POST` | `/tasks/{id}/attachments` |
| `POST` `DELETE` | `/tasks/{id}/assignees/{userId}` |

`/move` existeix a part de `PATCH` perquè moure és l'operació més freqüent del producte, la que més s'ha de fusionar offline, i la que necessita la seva pròpia semàntica de conflicte.

### Llistes senzilles

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `GET` `PATCH` `DELETE` | `/checklists/{id}` | |
| `POST` | `/checklists/{id}/pin` | Pinejat **per usuari** |
| `DELETE` | `/checklists/{id}/pin` | |
| `GET` `POST` | `/checklists/{id}/items` | |
| `PATCH` `DELETE` | `/checklist-items/{id}` | Marcar-lo pot disparar la cascada |
| `GET` | `/pinned-checklists` | Les de qui pregunta |

### Esdeveniments i calendaris

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `GET` | `/events` | **Requereix `from` i `to`**: sense finestra no es poden expandir repeticions |
| `POST` | `/events` | |
| `GET` `PATCH` `DELETE` | `/events/{id}` | Amb `series_mode=single\|future\|all` |
| `GET` `POST` | `/calendars` | |
| `GET` `PATCH` `DELETE` | `/calendars/{id}` | |
| `POST` | `/calendars/{id}/refresh` | Refresca una subscripció ara |

`series_mode` és el que resol "aquest esdeveniment, aquest i els següents, o tota la sèrie". `future` **parteix la sèrie** (posa `UNTIL` al mestre i en crea un de nou); no emet mai `RANGE=THISANDFUTURE` (D8).

### Vista del tauler

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `GET` | `/board` | Les quatre columnes en una crida |
| `GET` | `/inbox` | Amb `date` i `include_overdue` |
| `GET` | `/dashboard` | El dashboard global |

`/board` existeix perquè pintar el tauler amb quatre peticions paral·lelitzades dona quatre estats de càrrega i quatre punts de fallada per a una sola pantalla.

### Compartits

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `GET` `POST` | `/shares` | |
| `GET` `PATCH` `DELETE` | `/shares/{id}` | |
| `GET` | `/shares/{id}/accesses` | Qui hi ha entrat |
| `POST` | `/public/{token}/auth` | **Sense autenticar.** Contrasenya i nom si calen |
| `GET` | `/public/{token}` | Amb la sessió de convidat |
| `PATCH` | `/public/{token}/items/{itemId}` | Marcar un ítem, si el permís ho deixa |

### Tokens, IA, administració

| Mètode | Ruta |
| --- | --- |
| `GET` `POST` `DELETE` | `/tokens`, `/tokens/{id}` |
| `GET` `POST` | `/ai/agents` |
| `GET` `PATCH` `DELETE` | `/ai/agents/{id}` |
| `GET` | `/ai/next-task` |
| `POST` | `/ai/tasks/{id}/claim` |
| `POST` | `/ai/tasks/{id}/release` |
| `GET` `POST` | `/admin/users` |
| `POST` | `/admin/users/{id}/invite` |
| `PATCH` `DELETE` | `/admin/users/{id}` |
| `POST` | `/admin/wipe` |
| `GET` | `/export` |
| `GET` | `/admin/diagnostics` |

`GET /export` retorna tot el que és de qui pregunta —àmbits, tasques, esdeveniments, llistes, comentaris, historial— en JSON, més els adjunts. **No demana permís a ningú**: són les seves dades ([`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md) §9).

`GET /admin/diagnostics` és el paquet de diagnòstic de [`12-desplegament.md`](12-desplegament.md) §8, **amb tots els secrets ocultats**.

Els de `/ai/*` són a [`09-mode-ia.md`](09-mode-ia.md).

### Sincronització i temps real

| Mètode | Ruta | Notes |
| --- | --- | --- |
| `GET` | `/sync` | Delta des d'un cursor. Veure [`06-sync.md`](06-sync.md) |
| `POST` | `/sync/batch` | Buidat de la cua de sortida |
| `GET` | `/stream` | SSE |

> **`/stream`, no `/events/stream`.** `/events` és el CRUD d'esdeveniments; posar-hi l'SSE a sota fa que qui llegeixi l'API el confongui amb un subrecurs. Aquest xoc de noms és real i ve marcat al research.

### Cerca i utilitats

| Mètode | Ruta |
| --- | --- |
| `GET` | `/search?q=` |
| `GET` | `/labels` |
| `POST` | `/parse` |

`POST /parse` rep una cadena d'afegida ràpida i retorna els components reconeguts. A la v1 només sigils; el parseig de dates en català arriba a la v1.1 (D12) sense canviar la forma de l'endpoint.

---

## 5 · Temps real

**SSE, no WebSocket.** El trànsit és gairebé tot d'servidor a client, l'SSE reconnecta sol, travessa proxies sense negociació d'actualització, i és molt més simple d'operar.

```
GET /api/v1/stream
Accept: text/event-stream
```

Cada esdeveniment porta l'entitat, l'operació i el `seq` de `change_log`:

```
id: 48213
event: change
data: {"entity":"task","id":"0192f3a1-...","operation":"upsert","seq":48213}
```

El client hi posa `Last-Event-ID` en reconnectar, i el servidor reprèn des d'aquell `seq`. **És el mateix cursor que el sync**, cosa que fa que reconnectar i sincronitzar siguin la mateixa operació.

El proxy invers no ha de fer memòria intermèdia d'aquesta ruta ([`12-desplegament.md`](12-desplegament.md)).

---

## 6 · Webhooks

Perquè Fem-ho pugui avisar n8n o el que sigui.

```json
{
  "url": "https://n8n.example.com/webhook/femho",
  "events": ["task.created", "task.completed", "task.ai_changed"],
  "scope_ids": ["0192f3a1-..."],
  "secret": "..."
}
```

El cos es signa amb HMAC-SHA256 sobre el cos cru, a la capçalera `X-Femho-Signature`, amb una marca de temps per evitar reenviaments.

**Amb reintents**: espera exponencial, 5 intents, i desactivació automàtica després de 24 h fallant, amb avís a l'usuari. Vikunja els fa sense reintents i és una limitació coneguda seva.

---

## 7 · Límits de ritme

Per principal, no per IP: darrere d'un proxy invers casolà totes les peticions poden compartir IP.

| Què | Límit |
| --- | --- |
| Login | 10 per 15 min, i bloqueig progressiu |
| Contrasenya d'un compartit | 5 per 15 min, i `locked_until` |
| API amb token | 600 per minut |
| MCP | 120 per minut |
| Pujada d'adjunts | 20 per minut |

Es responen amb `429` i capçalera `Retry-After`.

---

## 8 · OpenAPI

Un sol `openapi.yaml` en 3.1, que és la versió que fa servir esquemes JSON de veritat.

A CI:

1. Es valida l'especificació.
2. Es generen els tipus de TypeScript i el client de Kotlin.
3. **Es comprova que el codi generat no tingui canvis sense confirmar.** Si algú toca un handler sense actualitzar el contracte, CI falla.
4. Proves de contracte que llancen peticions reals contra el servidor i validen les respostes contra l'esquema.

Els generadors es trien en fer l'scaffold, comprovant-ne l'estat real. **No agafis els noms de `research/` sense verificar-los.**
