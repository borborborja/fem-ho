# 07 · CalDAV

Fem-ho fa les dues bandes:

- **Servidor** — publica col·leccions que qualsevol client CalDAV pot connectar, bidireccionals.
- **Client** — llegeix calendaris externs que l'usuari configura com a origen d'un àmbit o d'un projecte.

Aquesta era la peça que semblava més arriscada de l'stack. No ho és: el detall de per què és a [`14-decisions.md`](14-decisions.md) D1, i el dossier `research/13` en té la implementació.

---

## 1 · On viu

**La superfície DAV va sobre `node:http` pelat, en un port propi dins del mateix procés.**

Per què no sobre el framework de l'API:

- **Fastify** fa 404 silenciós als verbs DAV fins que els registres a mà, i llavors respon 415 a l'XML fins que hi afegeixes un parser de tipus de contingut.
- **Express 5** rebutja les rutes amb comodí de la forma antiga i **fa doble descodificació dels `href`**, que trenca els UID amb caràcters escapats.
- **Hono** fa passar tot per un `Request` de WHATWG, amb cost afegit i cap benefici aquí.

Node **ja accepta tots els verbs** sense configuració: `PROPFIND`, `PROPPATCH`, `REPORT`, `MKCALENDAR`, `MKCOL`, `COPY`, `MOVE`, `ACL`, `LOCK` i `UNLOCK` són a la seva taula de mètodes.

**Va al mateix procés, no en un contenidor a part.** El motiu és el `sync_seq`: ctag i sync-token surten del mateix comptador que s'incrementa dins de la transacció d'escriptura. Un segon escriptor hauria de compartir aquesta transacció, i llavors ja no és un servei a part.

### Dos paranys concrets de Node

- Registrar un listener de `'checkContinue'` **sense** cridar `res.writeContinue()` penja tots els `PUT` d'Apple. Si no el necessites, no el registris.
- `fetch` i el client HTTP de la plataforma només normalitzen els verbs estàndard. `method: 'propfind'` viatja en minúscules i el servidor remot respon 501. **Per a la banda client, el verb s'escriu en majúscules i cal un client HTTP que no el normalitzi.**

### XML

Es parseja amb una llibreria **namespace-aware**, i es despatxa **sempre** per `(namespaceURI, localName)`, mai pel prefix.

Els clients fan servir prefixos diferents per als mateixos espais de noms i redefineixen `xmlns` a mig document. Un despatx per prefix funciona amb el primer client que provis i falla amb el segon.

**`fast-xml-parser` i `xml2js` queden prohibits al camí DAV.** No són namespace-aware.

Els quatre espais de noms que cal registrar:

```
DAV:
urn:ietf:params:xml:ns:caldav
http://apple.com/ns/ical/
http://calendarserver.org/ns/
```

---

## 2 · URLs

```
/dav/
  .well-known/caldav                    → redirecció al principal
  principals/{user}/                    → current-user-principal
  calendars/{user}/                     → calendar-home-set
    {scope-slug}-events/                VEVENT de l'espai general
    {scope-slug}-todos/                 VTODO de l'espai general
    {scope-slug}-{project-slug}-events/
    {scope-slug}-{project-slug}-todos/
```

**Dues col·leccions per contenidor, sempre** (D9). RFC 4791 §5.2 prohibeix recursos de components mixtos; DAVx⁵ classifica una col·lecció només per `supported-calendar-component-set`; Apple ho imposa a nivell de sistema; i el CalDAV de Google no accepta VTODO.

`supported-calendar-component-set` és **protegit**: es fixa en crear la col·lecció i no es pot canviar després amb `PROPPATCH`.

Cada recurs és `{col·lecció}/{uid}.ics`.

---

## 3 · Descobriment

La cadena que segueixen tots els clients:

1. `PROPFIND /.well-known/caldav` → redirecció (301 o 302).
2. `PROPFIND` amb `Depth: 0` demanant `current-user-principal`.
3. `PROPFIND` sobre el principal demanant `calendar-home-set`.
4. `PROPFIND` amb `Depth: 1` sobre el home, que retorna les col·leccions.

`OPTIONS` ha d'anunciar:

```
DAV: 1, 2, 3, calendar-access, addressbook
Allow: OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE
```

Les propietats que s'han de saber respondre com a mínim: `resourcetype`, `displayname`, `getctag`, `getetag`, `sync-token`, `supported-calendar-component-set`, `calendar-color`, `calendar-description`, `calendar-timezone`, `current-user-privilege-set`, `supported-report-set`, `owner`.

---

## 4 · Sincronització

Tres mecanismes, i cal suportar-los tots perquè els clients no coincideixen:

| Mecanisme | Per a què |
| --- | --- |
| `getctag` | Canvia si **alguna cosa** de la col·lecció ha canviat. Consulta barata per saber si cal mirar-hi. |
| `sync-token` amb `REPORT sync-collection` | El delta de veritat. Retorna què ha canviat des del token. |
| `getetag` per recurs | Concurrència a nivell d'objecte. |

**Tots tres surten de `calendars.sync_seq`**, un comptador monòton que s'incrementa dins de la transacció d'escriptura. `getctag` i `sync-token` en són representacions; l'`etag` d'un recurs es calcula **un sol cop en escriure**, sobre els bytes emmagatzemats, i es guarda.

Calcular l'etag en cada lectura és un error clàssic: si el serialitzador canvia d'ordre les propietats, l'etag canvia sense que hagi canviat res i tots els clients es rebaixen sencers.

Un `sync-token` massa vell es respon amb **`507`** i el client fa una sincronització completa. Cal decidir la retenció i complir-la.

### Els REPORT

- **`calendar-query`** — filtre per component i rang de temps. RFC 4791 §9.9 defineix el solapament, i **les regles de VEVENT i VTODO són diferents**: un VTODO sense cap data hi encaixa sempre. Dues funcions, no una amb un `if`.
- **`calendar-multiget`** — llista d'`href` i retorna aquests recursos.
- **`sync-collection`** — el delta.

Per respondre un rang de temps sobre esdeveniments recurrents cal expandir. Es fa amb la finestra materialitzada `event_occurrences` (veure [`01-model-de-dades.md`](01-model-de-dades.md) §5), i s'expandeix al vol només fora de la finestra.

---

## 5 · Escriptura

`PUT` amb `If-None-Match: *` crea; `PUT` amb `If-Match: <etag>` actualitza. Sense coincidència, **`412`**.

En rebre un `PUT`:

1. Es parseja l'iCalendar. Si no és vàlid, `400`.
2. Es comprova que el tipus de component encaixi amb el `kind` de la col·lecció. Si no, **`403`** amb `supported-calendar-component`.
3. Es guarda el component **cru** a `raw_ical` i se'n desen els camps modelats.
4. S'incrementa `sync_seq` i es calcula el nou etag, **en la mateixa transacció**.
5. Es retorna `201` o `204` amb la capçalera `ETag`.

**Es guarda sempre el component original.** Un round-trip que perdi propietats que no modelem és una pèrdua de dades des del punt de vista de l'usuari.

---

## 6 · Mapatge VTODO

| iCalendar | Fem-ho | Notes |
| --- | --- | --- |
| `UID` | `caldav_uid` | |
| `SUMMARY` | `title` | |
| `DESCRIPTION` | `description` | |
| `DUE` | `due_date` + `due_time` | `VALUE=DATE` → només data |
| `DTSTART` | — | S'accepta i es preserva; Fem-ho no en fa res |
| `COMPLETED` | `completed_at` | |
| `STATUS` | `status` | Veure el mapatge de sota |
| `PRIORITY` | — | Es preserva a `raw_ical` |
| `CATEGORIES` | etiquetes | |
| `RELATED-TO;RELTYPE=PARENT` | `subtasks.task_id` | |
| `RRULE` | `rrule` | |
| `CREATED` `LAST-MODIFIED` `SEQUENCE` | metadades | |
| `VALARM` | `reminders` | |
| `ORGANIZER` `ATTENDEE` | assignats | Per correu |

**Estat.** iCalendar té quatre valors i el kanban en té quatre, però no són els mateixos:

| VTODO | Fem-ho | En sortir |
| --- | --- | --- |
| `NEEDS-ACTION` | `inbox` o `todo` | `todo` → `NEEDS-ACTION` |
| `IN-PROCESS` | `doing` | `doing` → `IN-PROCESS` |
| `COMPLETED` | `done` | `done` → `COMPLETED` |
| `CANCELLED` | esborrat suau | |

**`inbox` i `todo` col·lapsen tots dos a `NEEDS-ACTION` en sortir.** Per no perdre la distinció en un round-trip, la columna real viatja en una propietat pròpia (secció 7). En entrar des d'un client que no la porta, `NEEDS-ACTION` cau a `todo`.

### Les subtasques són fràgils

Les jerarquies amb `RELATED-TO` depenen de l'ordre en què el client processi els components. És una font de bugs documentada: hi ha implementacions on les subtasques acaben aplanades o abocades dins de la descripció.

Fem-ho ha d'exportar **sempre la tasca mare abans que les filles** dins d'un mateix recurs, i tolerar l'ordre invers en importar.

---

## 7 · Propietats pròpies

Coses que Fem-ho té i iCalendar no sap dir. Totes amb prefix `X-FEMHO-`:

| Propietat | Per a què |
| --- | --- |
| `X-FEMHO-STATUS` | La columna exacta, per distingir `inbox` de `todo` |
| `X-FEMHO-SCOPE` | Identificador d'àmbit |
| `X-FEMHO-PROJECT` | Identificador de projecte |
| `X-FEMHO-POSITION` | L'índex fraccional |
| `X-FEMHO-AI-MODE` | `manual`, `assisted` o `delegated` |
| `X-FEMHO-RECURRENCE-MODE` | `schedule` o `completion` — RRULE no ho sap expressar |
| `X-FEMHO-CHECKLIST` | Llista senzilla serialitzada |

> **Un avís honest.** Que un servidor CalDAV de tercers preservi propietats `X-` desconegudes en un round-trip **és una suposició, no un fet verificat**. Abans de confiar-hi amb un origen concret, cal provar-ho: escriure un objecte amb una `X-FEMHO-`, llegir-lo i comprovar que hi és.
>
> Per a les col·leccions que **publica** Fem-ho no hi ha problema: som nosaltres qui les guardem, i a més tenim `raw_ical`. El risc és només quan Fem-ho escriu a un servidor extern.

Les llistes senzilles tenen dues representacions possibles: com a `VTODO` fills amb `RELATED-TO`, o serialitzades en una propietat. **Es fan servir les dues**: fills per compatibilitat amb clients que els sàpiguen ensenyar, i la propietat per poder-les reconstruir exactament. En importar, mana la propietat si hi és.

---

## 8 · Clients

Objectius de compatibilitat, i què trenca a cadascun:

| Client | Compte amb |
| --- | --- |
| **DAVx⁵** (+ Tasks.org, jtx Board) | Classifica per `supported-calendar-component-set` i prou. Si no el respons bé, no veu res. |
| **Apple Recordatoris i Calendari** | Separa components a nivell de sistema. Sensible al `VTIMEZONE`. Fa servir `Expect: 100-continue` als `PUT` — vigila el parany del `checkContinue`. |
| **Thunderbird** | Escriu propietats `X-MOZ-*` que cal preservar. Les versions antigues no van bé amb VTODO. |
| **Evolution** | Correcte en general. |
| **Nextcloud Tasks** | Fa servir `X-OC-HIDESUBTASKS`. |

**Fusos horaris.** S'ha d'emetre **un `VTIMEZONE` per cada `TZID` diferent** que es referenciï al recurs, i el `DTSTART` de cada observança va en hora local nua, sense `Z`. Un `VTIMEZONE` absent o mal format és la primera causa d'error d'interoperabilitat.

**Tot el dia contra amb hora.** `VALUE=DATE` és tot el dia i **no té fus**. `DATE-TIME` amb `TZID` és hora local. Convertir un tot-el-dia a mitjanit UTC és l'error que fa que els aniversaris apareguin el dia abans a mig món.

---

## 9 · Fem-ho com a client

L'usuari pot posar un CalDAV o un `.ics` com a origen d'un àmbit o d'un projecte, i pot no posar-ne cap i fer servir Fem-ho com a font principal.

### Refresc

Per a subscripcions, l'interval surt de `REFRESH-INTERVAL` del propi calendari, si no de `X-PUBLISHED-TTL`, i si no del valor configurat. Mai per sota d'una cadència raonable: no s'ha de martellejar el servidor de ningú.

En cada refresc es comparen els `UID` i s'esborra el que ha desaparegut de l'origen.

De les subscripcions **s'eliminen les alarmes** per defecte: no es volen notificacions duplicades d'un calendari que l'usuari ja té al telèfon.

### Evitar bucles

1. Cada objecte importat guarda el `caldav_etag` amb què va arribar.
2. Abans d'escriure enfora, es compara; si el remot ha canviat pel seu compte, es resol el conflicte.
3. **Les escriptures originades per la sincronització s'etiqueten `source='caldav'`** i **no** disparen una sortida cap al mateix origen.

Sense el punt 3, dos servidors sincronitzats entre ells es fan rebotar canvis indefinidament.

### SSRF

**L'usuari dona una URL que el servidor anirà a buscar.** Això és una vulnerabilitat de falsificació de peticions del costat servidor, i és de les poques d'aquest projecte que es pot explotar sense credencials.

Les mitigacions són a [`10-compartits-i-seguretat.md`](10-compartits-i-seguretat.md) §6 i **no són opcionals**.

Les credencials dels orígens externs es guarden **xifrades en repòs** (`calendars.source_secret_enc`).

---

## 10 · Membres externs

Això és P3, i és el que fa possible un àmbit col·lectiu amb gent que no fa servir Fem-ho:

- **Només lectura** → subscripció a un `.ics` o a una col·lecció CalDAV. Es crea una fila a `calendars` amb `origin='subscription'`, i el membre s'enllaça a `scope_members.external_calendar_id`. La persona no és usuari.
- **Lectura i escriptura** → usuari de tipus `caldav_only`, l'única credencial del qual és una app password de CalDAV. Sense accés web ni app. Se li poden assignar tasques i queda al registre d'activitat com qualsevol altre.

Un àmbit col·lectiu pot barrejar tots dos tipus i usuaris normals, com demana el brief.

---

## 11 · Proves

CalDAV no es pot donar per bo amb tests unitaris.

- **Round-trip real** contra DAVx⁵, Apple Recordatoris, Thunderbird i Evolution. Manual, però es fa un cop per fita i es documenta el resultat.
- **Suite funcional automatitzada** apuntant a un servidor viu, amb una llista d'incompatibilitats conegudes que ha d'anar minvant.
- **Comparació amb implementacions de referència** (Radicale, Xandikos, Baïkal) aixecades amb Compose, llançant les mateixes peticions i comparant respostes. És la manera més ràpida de trobar què respons diferent.
- **Fixtures de cossos reals** de PROPFIND i REPORT capturats de clients de veritat, no escrits a mà.
- **Proves de fus** amb `Europe/Madrid` als dos diumenges de canvi d'hora.
