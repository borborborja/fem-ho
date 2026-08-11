# Fem-ho — instruccions de construcció

> Document mestre. Si programes Fem-ho, comença aquí i no te'l saltis.

## Què és Fem-ho

Un gestor de tasques personal i familiar, **autoallotjat**, amb dues superfícies:

- una **app web** que es desplega amb Docker i és responsive,
- una **app Android nativa**, offline-first, sempre aparellada a un servidor (a la pantalla de login s'escriu la URL del servidor).

Les dues han de sentir-se **la mateixa cosa**. La web en mòbil ha de ser gairebé idèntica a l'app Android.

El que el distingeix d'un gestor de tasques qualsevol són tres coses, i cap és opcional:

1. **Àmbits.** Les tasques viuen sempre dins d'un àmbit (Personal, Feina, Família, i els que l'usuari creï). Un àmbit pot ser individual o col·lectiu, i un de col·lectiu pot tenir membres que ni tan sols són usuaris de l'eina, connectats només per CalDAV.
2. **Interoperabilitat de primera classe.** CalDAV bidireccional, API REST i servidor MCP, amb tokens d'abast limitat que permeten dir "això només pot llegir i escriure l'àmbit Feina".
3. **Un usuari IA opcional.** Fem-ho **no té cap motor d'IA**. És el sistema de registre que una IA externa llegeix i escriu, amb traçabilitat de cada canvi.

## Ordre de lectura

| Ordre | Document                                                         | Per què                                                                                                                    |
| ----- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1     | [`docs/00-visio-i-glossari.md`](docs/00-visio-i-glossari.md)     | El vocabulari. Cada nom d'entitat i de camp surt d'aquí. Sense això escriuràs quatre noms diferents per a la mateixa cosa. |
| 2     | [`docs/14-decisions.md`](docs/14-decisions.md)                   | Les decisions ja preses i per què. Evita que reobris debats tancats.                                                       |
| 3     | [`docs/01-model-de-dades.md`](docs/01-model-de-dades.md)         | Entitats i DDL complet.                                                                                                    |
| 4     | [`docs/05-api-rest.md`](docs/05-api-rest.md)                     | El contracte. Tot el que fan les dues apps hi passa pel mig.                                                               |
| 5     | [`docs/13-fites-i-acceptacio.md`](docs/13-fites-i-acceptacio.md) | L'ordre de construcció i què compta com a fet.                                                                             |
| 6     | La resta, quan toqui la fita                                     | UI, sync, CalDAV, MCP, IA, compartits, notificacions, desplegament.                                                        |

`research/` és context, no norma. Llegeix [`research/README.md`](research/README.md) abans de fer-lo servir.

## Regles no negociables

Aquestes onze regles valen més que qualsevol preferència teva o de la resta de documents.

### 1. `instruccions.txt` és història, no especificació

`instruccions.txt` és el brief original de l'autor. Es conserva perquè explica la intenció i el to. **No el modifiquis mai.** Quan divergeixi dels `docs/`, manen els `docs/` — la divergència ja està analitzada i justificada a `docs/14-decisions.md`, amb una taula que mapeja cada frase del brief al document que la implementa.

### 2. Cap versió de dependència surt de `research/`

Els dossiers porten versions que es van obtenir amb cerques web i **diverses són sospitoses o inventades**. Cap `docs/` en fixa cap. Resol les versions en crear l'scaffold, comprova-les contra el registre real, i congela-les al lockfile. Si un dossier diu `typescript 6.0.3`, tracta-ho com un rumor.

### 3. El vocabulari és únic

Un concepte, un nom, arreu: base de dades, API, MCP, clients i tests. Els noms canònics són a `docs/00-visio-i-glossari.md`. Els cinc que històricament s'han escrit de quatre maneres diferents:

| Concepte                 | Nom canònic               | Valors                              |
| ------------------------ | ------------------------- | ----------------------------------- |
| Columna del kanban       | `status`                  | `inbox` · `todo` · `doing` · `done` |
| Ordre dins d'una columna | `position`                | índex fraccional en `TEXT`          |
| Identificador d'entitat  | `id`                      | UUIDv7 nu, sense prefix             |
| Agent d'IA               | `ai_agents`               | delegació, no assignació            |
| Tools MCP                | sense prefix, verb primer | `list_tasks`, no `femho_list_tasks` |

El català és **només** per a la interfície, i sempre en fitxers de traducció. Cap identificador, cap camp, cap valor d'enum, cap nom de taula en català.

### 4. Tota escriptura deixa rastre

Cada canvi d'estat escriu una entrada a `activity_log` dins de **la mateixa transacció** que el canvi. L'entrada diu qui (usuari, agent d'IA, convidat d'un enllaç compartit, sincronització CalDAV), per quin canal (`web` · `android` · `api` · `mcp` · `caldav` · `share`), què va canviar i quin era el valor anterior. Si un camí d'escriptura no pot escriure el log, no és un camí d'escriptura vàlid.

### 5. Res entra a l'API sense contracte

`packages/contracts/openapi.yaml` és la font de veritat. Els tipus de TypeScript i el client de Kotlin **es generen** des d'ell. Un endpoint que no hi és no existeix. Cap client escriu tipus a mà.

### 6. Offline-first no és una capa que s'afegeix després

Els identificadors els genera el client. Les posicions les calcula el client. Cada mutació passa per una cua de sortida abans de tocar la xarxa. Això es dissenya a la fita del model de dades, no a la d'Android. Si arribes a Android i has de reescriure l'API, has fallat abans.

### 7. Els esdeveniments no són tasques

Un esdeveniment de calendari és una entitat pròpia. No és una tasca amb hora d'inici i de fi. Els seus `STATUS` són `TENTATIVE` / `CONFIRMED` / `CANCELLED`, no els d'una tasca; té `TRANSP` i assistents amb `PARTSTAT`, que una tasca no té; i un calendari extern subscrit només en pot produir d'aquests.

**Un esdeveniment no té mai estat de kanban ni s'arrossega entre columnes. A la bústia hi pot sortir com a font, mai com a targeta de tasca.**

Aquesta frase deia abans «els esdeveniments no surten mai al kanban», i es va acotar l'11 d'agost del 2026 en fer que les fonts subscrites conformessin la bústia diària —que és la primera columna del kanban—. El que protegia es manté sencer i ara es pot **comprovar** en comptes de discutir: un esdeveniment no té `status`, no té `position`, no és un `Task` en cap tipus, no s'arrossega, no té casella de fet, i cap identificador seu pot arribar a `POST /tasks/{id}/move`. Les tres columnes de treball vénen de `/board` i allà no hi entra cap esdeveniment. El raonament sencer és a [`docs/14`](docs/14-decisions.md) P9.

### 8. Una sola capa de política

El brief ho demana explícitament: no dupliquis la lògica entre l'API d'usuari i la d'IA. Hi ha **un** motor de decisió. Cada petició es resol a un principal (usuari, agent, convidat) amb un conjunt de capacitats, i la comprovació es fa a la capa de servei, mai al handler. Un token d'IA i un d'usuari es diferencien només en el principal i les capacitats, no en el codi que travessen.

### 9. Els tokens tenen abast

Un token ha de poder dir "lectura i escriptura de tasques, només a l'àmbit Feina". Això limita el radi d'un error d'una IA, que és tota la raó per la qual existeix. Els permisos per àmbit **no** van a les scopes d'OAuth: van al registre del token.

### 10. El text de les tasques és entrada no fiable

Qualsevol IA que llegeixi Fem-ho llegirà text escrit per persones i fitxers adjunts per persones. El producte no pot evitar la injecció de prompts, però sí que ha de: etiquetar la provinença, exigir confirmació per a les operacions destructives, mantenir els tokens estrets, i ensenyar a l'usuari exactament què pot tocar cada token.

### 11. Una fita no s'acaba fins que la seva comprovació passa

Cada fita de `docs/13-fites-i-acceptacio.md` porta una comprovació automàtica. No comencis la següent sense haver-la passat. "Funciona a la meva màquina" no és una comprovació.

## Stack

Fixat. No el reobris.

| Peça              | Tecnologia                                           |
| ----------------- | ---------------------------------------------------- |
| Backend           | Node + TypeScript                                    |
| Superfície CalDAV | `node:http` en un port propi, dins del mateix procés |
| Base de dades     | SQLite per defecte, PostgreSQL suportat              |
| Web               | React + Vite, PWA                                    |
| Design system     | Plou, consumit tal com ve (React + variables CSS)    |
| Android           | Kotlin + Jetpack Compose, Room, WorkManager          |
| Contractes        | OpenAPI 3.1 → tipus TS i client Kotlin generats      |
| Desplegament      | Docker + Docker Compose                              |

Dues coses que semblen detalls i no ho són:

- **La superfície CalDAV no va sobre Fastify ni Express.** Fastify fa 404 silenciós als verbs DAV fins que els registres a mà, i Express rebutja les rutes amb comodí i fa doble descodificació dels `href`. Va sobre `node:http` pelat. El detall és a `research/13`.
- **L'XML del camí DAV no es toca amb `fast-xml-parser` ni `xml2js`.** No són namespace-aware i els clients CalDAV fan servir prefixos diferents i redefineixen `xmlns` a mig document. Es parseja despatxant sempre per `(namespaceURI, localName)`.

## Estructura del repositori

```
apps/
  server/       backend, API REST, CalDAV, MCP, SSE, jobs
  web/          React + Vite (PWA)
  android/      Gradle, Kotlin, Compose
packages/
  contracts/    openapi.yaml + esquemes compartits + fixtures del parser
  design-system/ Plou vendoritzat + les extensions de Fem-ho
docs/           l'especificació (aquests documents)
research/       els dossiers (context, no norma)
```

## Idioma

- Interfície: **català**, sempre via fitxers de traducció, mai literals al codi.
- Codi, identificadors, camps, enums, taules, endpoints, commits: **anglès**.
- Aquests documents: **català**. Els dossiers de `research/`: anglès.

Detalls de format català (dies `dl dt dc dj dv ds dg`, mesos en minúscula, separador `·`, hores en 24 h) a `docs/00-visio-i-glossari.md`.
