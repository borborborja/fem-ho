<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/img/portada-fosc.svg">
  <img src="docs/img/portada-clar.svg" alt="Fem-ho">
</picture>

<p align="right">
  <a href="README.md">Català</a> ·
  <strong>English</strong> ·
  <a href="README.es.md">Castellano</a>
</p>

# Fem-ho

A task and calendar manager **for a household**, built to be self-hosted. A web app, an
Android app, and a server that speaks CalDAV and MCP.

Available in Catalan, English and Spanish.

> The name is Catalan for _"let's do it"_.

---

## Who it is for, and who it isn't

For **a home**: one or more adults who already run a server and want to keep work,
personal life and family in the same place, **without work finding out about family or
the other way round**.

It is not a product for company teams. There are no sprints, no estimates, no velocity
reports, no per-field permissions. There are people who share a house and, some of them,
also a job.

## The five ideas behind it

**1 · At a glance.** The main screen has to answer "what do I have to do" without a
single click. If finding out what's due today means navigating, the design has failed.

**2 · Adding has to be instant.** Writing a task opens no dialog: you type in a field and
press Enter. The richness — due dates, attachments, AI instructions — comes later, by
editing.

**3 · The data is yours.** Two-way CalDAV, an open API, full export. Fem-ho can be your
main source or a client of a calendar you already have. You choose, and **you can leave
whenever you want**.

**4 · AI is a collaborator on a leash.** It can read what you let it read and write what
you let it write, everything it does is logged and can be undone, and it is **never
responsible for a task**: there is always a person behind it.

**5 · One app in two shapes.** Web and Android are the same thing, adapted. Moving from
phone to desktop should require relearning nothing.

## What sets it apart

- **Scopes, not loose projects.** Personal, work and family live on the same board and
  filter with one click. A task always belongs to a scope; it may have no project.
- **The inbox is the whole day.** Not just your tasks: subscribed calendars and RSS feeds
  sit alongside them, and you move through it day by day. An event can become a task, and
  while that task lives the event stops claiming your attention.
- **Real CalDAV**, both ways. Your phone's calendar and your desktop's see the same
  thing, and an external `.ics` or RSS feed can be added as a source.
- **Everything leaves a trace.** No write reaches the database without an activity-log
  entry inside the same transaction. It isn't a feature: it's an invariant enforced by a
  permanent check.

## Getting it running

```bash
curl -O https://raw.githubusercontent.com/borborborja/fem-ho/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/borborborja/fem-ho/main/.env.example
# Put your domain in FEMHO_BASE_URL
docker compose up -d
```

Then `http://localhost:8080` has `/setup`, which creates the first administrator and
closes that door for good. For Postgres instead of SQLite, use `compose.postgres.yaml`.

The image is multi-architecture (`amd64` and `arm64`), so it runs the same on a server
and on a Raspberry Pi:

```
ghcr.io/borborborja/fem-ho:latest        # or :0.6.0 to pin the version
```

### One container, one volume

**The volume is everything there is to keep**: the database, the instance secret, the
attachments, and a backup taken before every migration. A copy of the volume is a
complete backup.

### The options

In the `.env` next to it, which Compose reads on its own. The ones people touch most:

| Variable                   | Default                   | What it does                                                                    |
| -------------------------- | ------------------------- | ------------------------------------------------------------------------------- |
| `FEMHO_BASE_URL`           | —                         | **Required in production.** Without it, CalDAV and share links build wrong URLs |
| `FEMHO_INSTANCE_NAME`      | `Fem-ho`                  | The name people see when they connect                                           |
| `FEMHO_DATABASE_URL`       | `sqlite:///data/femho.db` | SQLite or `postgres://…`                                                        |
| `FEMHO_ALLOW_REGISTRATION` | `false`                   | Anyone can create an account. **The first one becomes administrator**           |
| `FEMHO_GRAVATAR`           | `false`                   | Profile pictures come from Gravatar                                             |
| `FEMHO_UPDATE_CHECK`       | `true`                    | Ask GitHub whether there is a newer version                                     |
| `FEMHO_SECRET`             | generated                 | The pepper for every token. It belongs in your backup                           |

**[The full list is in `docs/DEPLOY.md`](docs/DEPLOY.md)** — with what each one costs you
— and there are no others: a permanent check compares what the code reads against what
the docs say, and fails in both directions. If you see one in a tutorial and it isn't
there, it doesn't exist.

## Developing

```bash
npm ci
npm run build
npm test                 # unit tests, SQLite
npm run test:postgres    # the same ones, against Postgres
npm run check            # the fifteen permanent checks
npx playwright test      # browser, against a real server
npm run test:android     # pure Kotlin, no emulator
```

### The fifteen permanent checks

They are not formatting linters: each one prevents **one specific way of breaking the
product without anything failing**. They all self-test, because a check that reports
green without checking anything is worse than no check at all.

|                           | What it prevents                                                    |
| ------------------------- | ------------------------------------------------------------------- |
| `openapi-diff`            | Touching a handler without updating the contract                    |
| `vocab-lint`              | The prototype's vocabulary leaking into the code (`column: 'fet'`)  |
| `no-hardcoded-colors`     | A hand-written colour that follows neither theme nor accent         |
| `i18n-lint`               | Text written in the code instead of the catalogue                   |
| `i18n-parity`             | A key or an `{x}` placeholder missing in one language               |
| `i18n-keys-exist`         | A typo in `t('...')`, which compiles and is shown raw to the user   |
| `no-pinned-from-research` | A dependency version with no recorded provenance                    |
| `no-ignored-sources`      | Source code swallowed by `.gitignore` that a fresh clone won't have |
| `env-documented`          | A documented option the code never reads, or the other way round    |
| `scope-predicate`         | A second copy of "who belongs to a scope", which would diverge      |
| `contrast-check`          | Contrast below AA in any of the eight themes                        |
| `audit-coverage`          | A write path that leaves no trace in the history                    |
| `parser-parity`           | The web parser and the Android one drifting apart                   |
| `tokens-parity`           | Compose colours falling behind the CSS                              |
| `css-classes`             | A class that doesn't exist — it renders unstyled and nothing fails  |

## How it's built

An npm-workspaces monorepo:

```
apps/server      Fastify (/api/v1) · node:http (CalDAV) · MCP · SSE · scheduled jobs
apps/web         React + Vite, PWA with an outbox queue
apps/android     Kotlin + Compose, Room and UnifiedPush
packages/contracts       openapi.yaml, language catalogues, parser and fractional index
packages/design-system   vendored Plou + Fem-ho's own components
tools/checks     the fifteen checks
docs/            fifteen normative documents
```

**Whatever the web and Android must agree on lives in `packages/contracts`** and is
compared against fixtures: the fractional index, the quick-add parser, the catalogues and
the first day of the week. If each side computed them independently they would diverge
one day, and neither would raise an error.

The honest state of the product — what is tested, what needs a device, and what isn't
there yet — is in [`docs/ESTAT.md`](docs/ESTAT.md) (in Catalan).

## Licence

**GNU AGPL-3.0-or-later.** See [`LICENSE`](LICENSE).

You may use, study, modify and redistribute it, under two conditions:

- **Credit the origin.** Copyright and licence notices stay, and changes are marked as
  changes.
- **What comes out has to be equally open.** A derivative ships under the same licence,
  not a more closed one.

And a third, which is the reason for choosing the **A**GPL over plain GPL: Fem-ho is
built **to be served over a network**. If you publish a modified version and people reach
it over the network, you have to offer them the source of that version, even though you
never hand them a copy. Without that, anyone could offer it as a paid service and never
give anything back — exactly what "equally open" is meant to prevent.

What it does **not** cover: the **Plou** design system
(`packages/design-system/plou/`) comes from a separate project and carries its own terms,
and the Roboto typeface is Google's under Apache 2.0. All of it is in [`NOTICE`](NOTICE).

> If you ever want to publish the APK on Google Play, it's worth reading up first: Play's
> terms have had well-known friction with GPL-family licences. F-Droid has none.
