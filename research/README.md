# research/ — dossiers de recerca

15 dossiers, ~36.000 línies, en **anglès** (com les fonts). Es van produir abans d'escriure `docs/`, i són la base d'evidència de cada decisió normativa.

## Com fer-los servir

**Aquests fitxers no són normatius.** Manen els `docs/`. Un dossier és context: explica *per què* una decisió és la que és, i dona el detall d'implementació (noms de camps, capçaleres, números d'RFC, snippets) que `docs/` resumeix.

Regles per a qui programi:

1. Si `docs/` i un dossier es contradiuen, **mana `docs/`**. Les contradiccions conegudes ja estan resoltes a [`docs/14-decisions.md`](../docs/14-decisions.md).
2. Els dossiers **es contradiuen entre ells** en 12 punts. No en triïs un a l'atzar: mira la taula de `docs/14-decisions.md`.
3. **Cap versió de dependència d'aquests fitxers és fiable.** Es van escriure amb cerques web i diverses estan per davant del que es pot documentar. Resol les versions en crear l'scaffold i congela-les al lockfile.
4. Cada dossier acaba amb una llista `UNVERIFIED`. Llegeix-la abans de confiar en un detall d'aquell dossier.
5. El dossier **08 està parcialment anul·lat**: recomana Go i porta pins de llibreries Go, un Dockerfile de Go i codi Go. L'stack és TypeScript. Del 08 val **només** l'esquema, la semàntica i el raonament de modelatge. El dossier **13** desmenteix la premissa amb què el 08 justificava Go.

## Índex

| # | Fitxer | Què hi trobaràs | Llegeix-lo per escriure |
| --- | --- | --- | --- |
| 01 | `01-vikunja-deep-dive.md` | Teardown de Vikunja des del codi font: `project_views`, `task_positions`, DSL de filtres, Quick Add Magic, tokens d'API, usuaris bot, CalDAV, link shares, bus d'esdeveniments, i les queixes reals dels usuaris amb recompte de reaccions | 01, 05, 08, 09 |
| 02 | `02-competitor-ux-teardown.md` | Todoist, Things 3, TickTick, Marvin, Sunsama, Morgen, Motion, Amie, Akiflow, Nextcloud Tasks/Deck, Tasks.org, OpenTasks, jtx, Wekan, Kanboard, Focalboard, Planka, AppFlowy, Super Productivity. Taules de dreceres, mecànica GTD, rollover | 02, 03, 04 |
| 03 | `03-caldav-vtodo-spec.md` | CalDAV a nivell d'RFC: 4791, 5545, 6578, 4918, 6764, 7986. PROPFIND/REPORT/PUT amb XML real, ctag vs sync-token vs etag, VTODO camp a camp, `RELATED-TO`, manies de cada client | 07 |
| 04 | `04-mcp-server-design.md` | MCP: revisions de l'spec (i el gir de `2026-07-28`), transports, autorització OAuth 2.1 + RFC 9728, SDKs, disseny de tools, annotations, seguretat | 08 |
| 05 | `05-rest-api-and-token-scoping.md` | Disseny REST, paginació, PATCH, RFC 9457, argon2id, PAT amb prefix i hash, gramàtiques de scopes (GitHub, Stripe, GitLab), capa de política única, log d'auditoria, webhooks | 05, 09 |
| 06 | `06-android-offline-first.md` | Kotlin/Compose, Room com a font de veritat, WorkManager, outbox, resolució de conflictes, índexs fraccionals, emmagatzematge de credencials, UnifiedPush, DnD a Compose | 03, 06 |
| 07 | `07-web-frontend-architecture.md` | React, TanStack Query, PWA i Dexie, dnd-kit, llibreries de calendari amb llicències, consum del design system Plou, i18n català, accessibilitat | 02, 04 |
| 08 | `08-backend-stack-and-data-model.md` | ⚠️ Parcialment anul·lat (recomana Go). Val l'esquema complet, les decisions dures de modelatge, fusos i "avui", jobs, cerca amb text català | 01 |
| 09 | `09-public-sharing-and-security.md` | Enllaços públics de Nextcloud/Vikunja/Trello/Notion, disseny de tokens, gates amb contrasenya, identitat de convidat, SSRF al client CalDAV, CSP amb estils inline | 10 |
| 10 | `10-ai-agent-integration-patterns.md` | Linear, Copilot coding agent, Rovo, Asana, Notion. Delegació vs assignació, contracte de traspàs, leasing, human-in-the-loop, provinença, injecció de prompts | 09 |
| 11 | `11-selfhosting-docker-ops.md` | Vikunja, Nextcloud, Immich, Paperless, Actual, Baikal, Radicale. Dockerfile multi-stage, compose, config, proxies (i els verbs DAV que nginx bloqueja), backup, actualitzacions | 12 |
| 12 | `12-repo-structure-and-ai-build-workflow.md` | Monorepo, contract-first amb OpenAPI, AGENTS.md, fites verificables, estratègia de tests, CI, com escriure specs per a una IA | 13, i l'estructura del repo |
| 13 | `13-caldav-server-in-node.md` | **Tanca el forat que el 08 donava per insalvable.** Node accepta tots els verbs DAV; `caldav-adapter` com a referència; stack XML; paranys de Fastify/Express/Hono; sidecar descartat amb el mecanisme; conformance testing | 07 |
| 14 | `14-calendar-events-vevent.md` | VEVENT com a entitat separada, recurrència amb `RECURRENCE-ID`, estratègies d'expansió, subscripcions `.ics`, JSCalendar (RFC 8984) com a forma REST | 01, 07 |
| 15 | `15-notification-delivery.md` | Web Push (RFC 8030/8291/8292), VAPID com a infraestructura permanent, matriu de suport real, UnifiedPush, SMTP via smarthost, canal webhook genèric | 11 |

## Procedència

Els 12 primers es van produir en paral·lel amb el mateix encàrrec: fonts primàries, res inventat, marcar `UNVERIFIED` el que no es pogués confirmar.

Després un crític va llegir els 12 sencers i va emetre: veredicte de cobertura, 3 forats tancables amb recerca, 12 contradiccions amb recomanació, i 7 fets sospitosos. Els 3 forats són els dossiers 13, 14 i 15. Les 12 contradiccions i els 7 fets sospitosos són a [`docs/14-decisions.md`](../docs/14-decisions.md).
