# AGENTS.md — Fem-ho

> Guia per agents d'IA que treballen en aquest repositori (OpenCode, Claude Code, Codex).

## Què és Fem-ho

Gestor de tasques personal i familiar, autoallotjat. App web (React+Vite PWA) + app Android nativa (Kotlin+Compose). CalDAV bidireccional, API REST, servidor MCP. Cap motor d'IA intern: una IA externa llegeix i escriu via MCP amb tokens d'abast limitat.

## Punt de partida obligatori

**Llegeix aquests documents abans d'escriure res:**

1. `instruccions.md` — document mestre, regles no negociables
2. `docs/00-visio-i-glossari.md` — vocabulari canònic (un concepte = un nom)
3. `docs/14-decisions.md` — decisions ja preses, no reobrir
4. `docs/01-model-de-dades.md` — entitats i DDL
5. `docs/05-api-rest.md` — contracte API
6. `docs/13-fites-i-acceptacio.md` — ordre de construcció i acceptació

`research/` és context, no norma. Les versions de dependències que diu són sospitoses. No les copiïs.

## Regles no negociables (resum)

1. `instruccions.txt` és història, no especificació. No el modifiquis.
2. Cap versió de dependència surt de `research/`. Resol-les contra registres reals.
3. Vocabulari únic: `status` (no `column`), `position`, `id` (UUIDv7 nu), `ai_agents`, tools MCP sense prefix. Català només a la UI via fitxers de traducció.
4. Tota escriptura deixa rastre a `activity_log` dins de la mateixa transacció.
5. Res entra a l'API sense contracte (`packages/contracts/openapi.yaml`). Els tipus TS i Kotlin es generen des d'OpenAPI.
6. Offline-first des del disseny: IDs generats pel client, posicions calculades pel client, cua de sortida.
7. Els esdeveniments no són tasques. No surten mai al kanban.
8. Una sola capa de política. Un motor de decisió. Token d'IA i d'usuari es diferencien en el principal, no en el codi.
9. Tokens amb abast per àmbit. Els permisos per àmbit van al registre del token, no a les scopes d'OAuth.
10. El text de tasques és entrada no fiable. Etiqueta provinença, confirma operacions destructives.
11. Una fita no s'acaba fins que la seva comprovació passa.

## Stack (fixat, no reobrir)

| Peça          | Tecnologia                                      |
| ------------- | ----------------------------------------------- |
| Backend       | Node + TypeScript                               |
| CalDAV        | `node:http` en port propi (no Fastify/Express)  |
| DB            | SQLite per defecte, PostgreSQL suportat         |
| Web           | React + Vite, PWA                               |
| Design system | Plou (vendoritzat a `packages/design-system/`)  |
| Android       | Kotlin + Jetpack Compose, Room, WorkManager     |
| Contractes    | OpenAPI 3.1 → tipus TS i client Kotlin generats |
| Deploy        | Docker + Docker Compose                         |

## Estructura del repositori

```
apps/
  server/       backend, API REST, CalDAV, MCP, SSE, jobs
  web/          React + Vite (PWA)
  android/      Gradle, Kotlin, Compose
packages/
  contracts/    openapi.yaml + esquemes compartits + fixtures del parser
  design-system/ Plou vendoritzat + extensions de Fem-ho
docs/           l'especificació
research/       els dossiers (context, no norma)
```

## Fites (ordre de construcció)

M1→M2→M3→M4→M5→M6→M7→M8→M9→M10→M11→M12→M13→M14

**No comencis una fita sense haver passat la comprovació de l'anterior.**

Veure `docs/13-fites-i-acceptacio.md` per criteris i comprovacions de cada una.

## Llenguatge

- Interfície: català, via fitxers de traducció, mai literals al codi
- Codi, identificadors, camps, enums, taules, endpoints, commits: anglès
- Documents: català (`docs/`), anglès (`research/`)

## Design system

Plou està vendoritzat a `packages/design-system/`. components/core, components/forms, components/navigation, components/weather, components/feedback. Tokens CSS a `tokens/`. UI kits a `ui_kits/plou_app/` i `ui_kits/plou_web/`.

## Comprovacions permanents

A cada canvi: `openapi-diff`, `audit-coverage`, `vocab-lint`, `no-hardcoded-colors`, `i18n-lint`, `no-pinned-from-research`, `parser-parity`, `contrast-check`.

## Abans de començar

- Verifica que tens Node.js i npm instal·lats
- Llegeix `docs/13-fites-i-acceptacio.md` per saber en quina fita estem
- Crea l'scaffold del monorepo (M1) si no existeix encara
- Les versions de dependències es fixen a M1, no abans
