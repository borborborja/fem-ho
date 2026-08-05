# Dossier 12 — Repository Structure & AI Build Workflow for **Fem-ho**

> **Audience:** the AI agent that will build Fem-ho (self-hosted personal+family task manager: Docker web app + native Android, multi-user, scopes/àmbits + projects, kanban + calendar, quick-add parsing, CalDAV, REST API, MCP server, share links, AI-delegation mode, Catalan UI, "Plou" design system).
>
> **Purpose:** make the repository and the specification *machine-buildable*: incrementally, verifiably, and without the agent inventing structure.
>
> **Status legend:** facts below are drawn from primary docs fetched on 2026-08-05. Anything I could not confirm from a primary source is tagged **`UNVERIFIED`**.

---

## Table of contents

1. [Monorepo vs polyrepo — the decision](#1-monorepo-vs-polyrepo--the-decision)
2. [Monorepo tooling: pnpm workspaces + Turborepo + Gradle](#2-monorepo-tooling-pnpm-workspaces--turborepo--gradle)
3. [Where the Android app lives](#3-where-the-android-app-lives)
4. [Contract-first development with OpenAPI 3.1](#4-contract-first-development-with-openapi-31)
5. [Code generation: TypeScript side](#5-code-generation-typescript-side)
6. [Code generation: Kotlin/Android side](#6-code-generation-kotlinandroid-side)
7. [Spec linting and contract tests](#7-spec-linting-and-contract-tests)
8. [AGENTS.md / CLAUDE.md: the agent-instructions convention](#8-agentsmd--claudemd-the-agent-instructions-convention)
9. [Writing specs FOR an AI](#9-writing-specs-for-an-ai)
10. [The 14-milestone build plan](#10-the-14-milestone-build-plan)
11. [Testing strategy the agent can actually satisfy](#11-testing-strategy-the-agent-can-actually-satisfy)
12. [CI: GitHub Actions for a 3-target monorepo](#12-ci-github-actions-for-a-3-target-monorepo)
13. [Keeping the Plou design system from drifting](#13-keeping-the-plou-design-system-from-drifting)
14. [The exact recommended repository tree](#14-the-exact-recommended-repository-tree)
15. [The exact documentation file list](#15-the-exact-documentation-file-list)
16. [Sources](#16-sources)
17. [UNVERIFIED items](#17-unverified-items)

---

## 1. Monorepo vs polyrepo — the decision

### 1.1 Recommendation: **single monorepo, no exceptions**

Fem-ho must ship: a backend, a web SPA, an Android app, a CalDAV surface, a REST API, an MCP server, a design system, and docs. Every one of those shares the *same* domain vocabulary (`scope`, `project`, `task`, `subtask`, `checklist`, `column ∈ {inbox, todo, doing, done}`, `assignment_mode ∈ {self, ai_assisted, ai_delegated}`). Splitting them across repos means the agent must keep N copies of that vocabulary in sync across N PR streams with no atomic commit — which is precisely the failure mode LLM agents are worst at.

**The decisive argument for an AI builder is atomicity of the contract change.** In a monorepo, "add `pinned: boolean` to Checklist" is one commit that touches `openapi.yaml`, the migration, the backend handler, the regenerated TS types, the regenerated Kotlin models, the E2E test and the docs — and CI either passes or fails as a unit. In a polyrepo it is five PRs with a partial-deploy window, which the agent will get wrong.

### 1.2 What the monorepo buys, concretely

| Benefit | Why it matters for an AI builder |
| --- | --- |
| One `openapi.yaml` is the single source of truth | Generators run in-repo; drift is a CI failure, not a runtime surprise |
| Atomic cross-target commits | The agent can never ship a half-migrated contract |
| One `AGENTS.md` tree with nested overrides | Per-package instructions are discovered automatically (see §8) |
| One CI graph | `turbo run build test lint` is the single "did I break it" command |
| Shared fixtures | The same `fixtures/tasks.seed.json` feeds unit tests, E2E, CalDAV round-trip and MCP smoke tests |
| Design tokens vendored once | Web CSS vars and Android XML/Compose objects are generated from one token file (see §13) |

### 1.3 The one real cost, and how to pay it

The cost is that Gradle (Android) and pnpm/Turbo (JS) are two independent build systems in one tree. **Do not try to make Turborepo drive Gradle.** Turborepo is a task-graph runner for `package.json` scripts; the Android app is not a JS package. Instead:

- Keep Android under `apps/android/` with its own `settings.gradle.kts` and Gradle wrapper.
- Give Android a **thin `package.json`** only if you want Turbo to see it — otherwise (recommended) drive Android from a separate CI job that is gated on the same `dorny/paths-filter` change detection.
- The **only** shared artifact between the two build systems is `packages/contracts/openapi.yaml` and `packages/design-tokens/tokens/*.json`. Both are plain files. Both are consumed by Gradle tasks (`openApiGenerate`, Style Dictionary output committed or generated) and by pnpm scripts.

> Nx has first-class polyglot/Gradle support and could unify both graphs. **Do not use it for Fem-ho.** The added conceptual surface (project graph, executors, generators, plugin config) is more for the agent to get wrong than the coordination it saves for a repo with exactly 3 build targets. Reconsider only if the repo grows past ~15 packages.

### 1.4 What Fem-ho should do

- **One repository**, named `fem-ho`.
- Layout `apps/*` (deployables) + `packages/*` (libraries) + `docs/*` + `infra/*`. Full tree in §14.
- **`packages/contracts/` is sacred**: it holds `openapi.yaml`, the JSON Schemas for the quick-add grammar, the CalDAV property map, and the MCP tool manifest. Nothing else in the repo may define a wire-format type by hand.
- Android lives at `apps/android/`, driven by Gradle, gated on the same change-detection filters.
- **Anti-goal:** no git submodules, no vendored forks, no publishing internal packages to npm. Everything is `workspace:*`.

---

## 2. Monorepo tooling: pnpm workspaces + Turborepo + Gradle

### 2.1 pnpm workspaces (dependency graph)

pnpm requires a `pnpm-workspace.yaml` at the workspace root. Internal deps use the `workspace:` protocol, which pnpm rewrites at publish time.

Verified behaviour of the `workspace:` protocol (pnpm docs): with packages at version `1.5.0`,

```
"foo": "workspace:*"   →  "foo": "1.5.0"
"bar": "workspace:~"   →  "bar": "~1.5.0"
"qar": "workspace:^"   →  "qar": "^1.5.0"
```

Aliases are supported (`"bar": "workspace:foo@*"`) and relative paths (`"foo": "workspace:../foo"`). Recursive commands use `pnpm -r` and `--filter`; `failIfNoMatch` makes the CLI exit non-zero when a filter matches nothing — **turn that on in CI** so a renamed package fails loudly instead of silently skipping tests.

`pnpm-workspace.yaml` for Fem-ho:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "!apps/android"        # Gradle-only, not a JS package
  - "!**/dist/**"
```

> `UNVERIFIED`: I did not retrieve the verbatim `packages:` glob/exclusion grammar or the `catalogs:` field schema from pnpm's docs page (the fetched excerpt omitted them). The `packages:` list-of-globs form above is the conventional shape; the agent should confirm against `https://pnpm.io/settings` before relying on `!` exclusions. pnpm **catalogs** (a `catalog:` protocol for pinning one version of a dep across all workspace packages) exist and are referenced by the workspaces page, but I could not capture the exact YAML shape — treat as `UNVERIFIED` and verify before use.

### 2.2 Turborepo (task graph + caching)

Turborepo config lives in `turbo.json`. Verified schema keys:

- Root: `$schema` (`https://turborepo.dev/schema.json`), `globalDependencies` (globs added to *all* task hashes), `globalEnv`, `globalPassThroughEnv`, `ui` (`"tui"` | `"stream"`, default `"stream"`), `concurrency` (default `"10"`, accepts percentages), `cacheDir` (default `".turbo/cache"`), `cacheMaxAge`, `cacheMaxSize`, `envMode` (`"strict"` | `"loose"`), `tasks`, `remoteCache`, `tags`, `boundaries`.
- `dependsOn` syntax: `"^build"` = topological (build in *dependencies* first); `"lint"` = same-package task; `"utils#build"` = a specific `package#task`.
- Task keys: `inputs` (with sentinels `"$TURBO_DEFAULT$"` and `"$TURBO_ROOT$"`), `outputs`, `cache` (default `true`), `persistent`, `interactive` (requires `persistent: true`), `env`, `passThroughEnv`, `outputLogs` (`full` | `hash-only` | `new-only` | `errors-only` | `none`).
- `remoteCache`: `{ enabled, signature, apiUrl, teamId, teamSlug }`.
- `boundaries` + `tags`: per-tag `dependencies.allow` / `dependencies.deny` lists — an architectural-fitness rule the agent cannot talk its way around.

**Recommended `turbo.json` for Fem-ho** (copy-adaptable):

```jsonc
{
  "$schema": "https://turborepo.dev/schema.json",
  "globalDependencies": ["tsconfig.base.json", "packages/contracts/openapi.yaml"],
  "globalEnv": ["NODE_ENV"],
  "ui": "stream",
  "envMode": "strict",
  "tasks": {
    "codegen": {
      "inputs": ["$TURBO_ROOT$/packages/contracts/openapi.yaml"],
      "outputs": ["src/generated/**"]
    },
    "build": {
      "dependsOn": ["^build", "codegen"],
      "inputs": ["$TURBO_DEFAULT$", "!**/*.md"],
      "outputs": ["dist/**", "build/**"]
    },
    "typecheck": { "dependsOn": ["^build", "codegen"] },
    "lint":      { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["^build", "codegen"], "outputs": ["coverage/**"], "outputLogs": "errors-only" },
    "test:e2e":  { "dependsOn": ["build"], "cache": false },
    "dev":       { "cache": false, "persistent": true, "interactive": true }
  },
  "boundaries": {
    "domain": { "dependencies": { "deny": ["web", "server"] } },
    "contracts": { "dependencies": { "deny": ["web", "server", "domain"] } }
  }
}
```

Two rules that matter enormously for an agent:

1. `globalDependencies` includes `packages/contracts/openapi.yaml`. **Any spec edit busts every cache in the repo.** That is the point: the agent cannot get a green cached `test` after changing the contract.
2. `boundaries` encode the layering (`contracts` depends on nothing; `domain` depends on `contracts` only). An agent that "helpfully" imports a React component into the domain package gets a hard failure.

### 2.3 What Fem-ho should do

- **pnpm workspaces + Turborepo. Not Nx, not Bazel, not Lerna.** Plain pnpm alone is not enough — you want the task graph and the cache so `turbo run test` is a single trustworthy verification command.
- Root `package.json` scripts must expose exactly these verbs, and `AGENTS.md` must list them: `dev`, `build`, `test`, `test:e2e`, `lint`, `typecheck`, `codegen`, `db:migrate`, `db:reset`, `spec:lint`, `spec:check`.
- Pin the pnpm version with `packageManager` in root `package.json` and Corepack, so the agent and CI cannot disagree.
- Add `--filter` recipes to `AGENTS.md` (e.g. `pnpm --filter @fem-ho/server test`) — the agent will otherwise run the whole suite for a one-file change.

---

## 3. Where the Android app lives

### 3.1 Placement

```
apps/android/
├── settings.gradle.kts        # rootProject.name = "fem-ho-android"
├── gradle/libs.versions.toml  # version catalog — the single place versions live
├── gradlew / gradlew.bat / gradle/wrapper/
├── app/                       # :app  — Compose UI, DI wiring, Activity
├── core-data/                 # :core-data — Room DB, sync engine, repositories
├── core-network/              # :core-network — generated API client lives here
├── core-designsystem/         # :core-designsystem — Plou tokens → Compose theme
└── build.gradle.kts
```

Key point: **`apps/android/` is a self-contained Gradle build.** It does not `include` anything outside its own directory except by *reading files*:

- `../../packages/contracts/openapi.yaml` → consumed by the `openApiGenerate` Gradle task (§6).
- `../../packages/design-tokens/build/android/` → consumed by `:core-designsystem` (§13).

Use a Gradle **version catalog** (`gradle/libs.versions.toml`) so the agent has exactly one file to edit for dependency versions — the Kotlin analogue of pnpm catalogs.

### 3.2 Why not put Android inside a pnpm package

Because Turborepo would then need to shell out to Gradle, losing Gradle's own incremental build and configuration cache while gaining nothing. Change-detection parity is achieved instead at the CI layer with `dorny/paths-filter` (§12), which is the same mechanism Turbo uses conceptually but works across build systems.

### 3.3 What Fem-ho should do

- `apps/android/` with its own wrapper, catalog, and 4 modules as above.
- **Never** commit generated API client sources for Android; generate into `build/generated/` and add that to `.gitignore`. Generated code in git is the #1 source of silent contract drift.
- Do commit `apps/android/AGENTS.md` describing: JDK version, `./gradlew` invocations, module boundaries, and the fact that offline-first sync lives in `:core-data` and nowhere else.

---

## 4. Contract-first development with OpenAPI 3.1

### 4.1 Verified OpenAPI 3.1.1 facts the agent must internalise

From the OpenAPI Specification v3.1.1:

- **JSON Schema dialect is Draft 2020-12.** OAS 3.1 schemas *are* JSON Schema; there is no separate subset.
- **`nullable` no longer exists.** Use type arrays: `type: ["string", "null"]`. An agent trained on 3.0 will emit `nullable: true` — forbid it explicitly in `AGENTS.md` and enforce it with a lint rule.
- Top-level **`webhooks`** field: `Map[string, Path Item Object]`, describing incoming webhooks the consumer may implement.
- **`jsonSchemaDialect`**: optional string (URI) that sets the default `$schema` for Schema Objects in the document.
- **`openapi`**: required string, the spec version the document uses; tooling keys off it.
- **Components Object keys**: `schemas`, `responses`, `parameters`, `examples`, `requestBodies`, `headers`, `securitySchemes`, `links`, `callbacks`, `pathItems`. Component keys must match `^[a-zA-Z0-9\.\-_]+$`.

`pathItems` under `components` is new in 3.1 and is exactly what Fem-ho wants for reusing the "share link" path shape across `/share/{token}` variants.

### 4.2 Contract-first vs code-first — pick contract-first, with one caveat

Two viable directions:

| Direction | How | Verdict for Fem-ho |
| --- | --- | --- |
| **Contract-first**: hand-author `openapi.yaml`, generate server stubs + both clients | `openapi.yaml` → TS types (openapi-typescript), Kotlin client (openapi-generator), server route validation | ✅ **Choose this** |
| **Code-first**: define routes with a schema-carrying framework, emit `openapi.yaml` | e.g. Zod/TypeBox route schemas → generated document | ⚠️ Acceptable *only* if the emitted document is committed and diffed in CI |

Contract-first wins for an AI builder because the spec is the *prompt-visible artifact*. The agent reads `openapi.yaml`, and everything downstream is mechanical. In code-first, the agent must infer the contract from handler code, which is exactly the ambiguity we are trying to eliminate.

**Caveat / hybrid that actually works best:** author the spec by hand, but *also* validate every response at runtime in dev/test against the spec (Prism proxy, §7.3) so implementation drift is caught immediately rather than at the next codegen.

### 4.3 Structuring `openapi.yaml` so an agent can edit it

A 4000-line single YAML file is a context-window hazard. Split it and use `$ref`:

```
packages/contracts/
├── openapi.yaml                 # root: info, servers, security, tags, $ref'd paths
├── paths/
│   ├── auth.yaml
│   ├── scopes.yaml
│   ├── projects.yaml
│   ├── tasks.yaml
│   ├── checklists.yaml
│   ├── shares.yaml
│   ├── tokens.yaml
│   └── audit.yaml
├── components/
│   ├── schemas/
│   │   ├── Task.yaml
│   │   ├── Scope.yaml
│   │   ├── Checklist.yaml
│   │   └── ...
│   ├── responses/
│   ├── parameters/
│   └── securitySchemes.yaml
├── redocly.yaml                 # lint config + bundle config + x-openapi-ts outputs
├── quickadd.grammar.md          # the quick-add parser spec (see §9.5)
├── caldav-mapping.md            # Task ↔ VTODO property map
└── mcp-tools.json               # MCP tool manifest, generated from openapi.yaml
```

Bundle to a single file for generators that dislike multi-file refs:

```bash
npx @redocly/cli bundle packages/contracts/openapi.yaml -o packages/contracts/dist/openapi.bundled.yaml
```

### 4.4 What Fem-ho should do

- **OpenAPI 3.1.1**, `openapi: 3.1.1` at the top, `jsonSchemaDialect: https://json-schema.org/draft/2020-12/schema`.
- Split as above; bundle in `codegen`.
- Model the enums explicitly and name them, so both generators produce named types:
  `TaskColumn = inbox | todo | doing | done`, `AssignmentMode = self | ai_assisted | ai_delegated`, `ScopeKind = individual | collective`, `TokenAudience = human | ai`.
- **Ban `nullable:`** in the lint ruleset. **Ban inline anonymous object schemas** in request/response bodies — every body must `$ref` a named component, otherwise generated Kotlin/TS type names become `InlineObject7` and the agent loses the thread.
- Every operation MUST have an `operationId` in `camelCase` (`listTasks`, `moveTask`, `createShareLink`). Generators name methods from it; without it names are derived from paths and change unpredictably.

---

## 5. Code generation: TypeScript side

### 5.1 `openapi-typescript` (types) + `openapi-fetch` (runtime) — recommended

**Maturity: high.** Current major is **7.x**. Supports OpenAPI 3.0 and 3.1. Zero runtime cost for types.

Install (verbatim from docs):

```bash
npm i openapi-fetch
npm i -D openapi-typescript typescript
```

Generate:

```bash
npx openapi-typescript ./path/to/api/v1.yaml -o ./src/lib/api/v1.d.ts
```

Use:

```ts
import createClient from "openapi-fetch";
import type { paths } from "./my-openapi-3-schema";

const client = createClient<paths>({ baseUrl: "https://myapi.dev/v1/" });

const { data, error } = await client.GET("/blogposts/{post_id}", {
  params: {
    path: { post_id: "my-post" },
    query: { version: 2 },
  },
});

await client.PUT("/blogposts", {
  body: { title: "My New Post" },
});
```

Response shape is `{ data, error, response }`: `data` present only on 2xx, `error` present on 4xx/5xx, `response` is the raw `Response`. **`openapi-fetch` is ~6 kb and benchmarks ~300k ops/sec on GET** — the fastest of the comparable clients per its docs.

**Verified CLI flags** (`openapi-typescript`):

| Flag | Alias | Default | Purpose |
| --- | --- | --- | --- |
| `--output` | `-o` | stdout | output file |
| `--redocly` | | | path to `redocly.yaml` |
| `--check` | | false | **verify generated types are current** |
| `--enum` | | false | emit TS enums |
| `--enum-values` | | false | export enum values as arrays |
| `--conditional-enums` | | false | enums only where `x-enum` metadata present |
| `--dedupe-enums` | | false | dedupe enum types |
| `--alphabetize` | | false | sort types |
| `--array-length` | | false | tuples from `minItems`/`maxItems` |
| `--default-non-nullable` | | true | defaults imply non-null |
| `--properties-required-by-default` | | false | |
| `--empty-objects-unknown` | | false | |
| `--additional-properties` | | false | |
| `--exclude-deprecated` | | false | |
| `--export-type` | `-t` | false | `type` instead of `interface` |
| `--immutable` | | false | readonly props |
| `--path-params-as-types` | | false | dynamic path lookups |
| `--root-types` | | false | export component schemas as root aliases |
| `--root-types-no-schema-prefix` | | false | |
| `--root-types-keep-casing` | | false | |
| `--make-paths-enum` | | false | generate `ApiPaths` enum |
| `--generate-path-params` | | false | |
| `--read-write-markers` | | false | `$Read`/`$Write` markers |

**`--check` is the drift gate.** In CI: `npx openapi-typescript packages/contracts/dist/openapi.bundled.yaml -o packages/api-client/src/generated/schema.d.ts --check` — non-zero exit if the committed types don't match the spec.

Multi-schema config via `redocly.yaml` (verbatim shape from docs):

```yaml
apis:
  core@v2:
    root: ./openapi/openapi.yaml
    x-openapi-ts:
      output: ./openapi/openapi.ts
  external@v1:
    root: ./openapi/external.yaml
    x-openapi-ts:
      output: ./openapi/external.ts
      additional-properties: true
```

### 5.2 Alternatives, and when they'd be right

| Tool | Maturity | Use when | Fem-ho verdict |
| --- | --- | --- | --- |
| **openapi-typescript + openapi-fetch** | High, 7.x, OAS 3.0/3.1 | You want types + a tiny type-safe fetch wrapper | ✅ **Use** |
| **openapi-react-query** | Companion package to openapi-fetch | You want TanStack Query hooks keyed off the same `paths` type | ✅ Use in `apps/web` |
| **Orval** | Mature, "batteries included": React Query/SWR/Axios clients, MSW mocks, Zod validators from one config | You want generated hooks + mocks + runtime validation with no glue | ⚠️ Viable alternative; heavier. **Orval 8+ requires Node ≥ 22.18** (`UNVERIFIED` — from a secondary comparison article, confirm in Orval's own docs before pinning) |
| **Kubb** | Plugin-based generator | Highly custom pipelines | ❌ Overkill |
| **Microsoft Kiota** | Multi-language generator | You need C#/Go/Java too | ❌ Not needed |

`swr-openapi` also exists as a sibling for SWR users. `UNVERIFIED`: I did not confirm `swr-openapi`'s current version from a primary page.

### 5.3 What Fem-ho should do

- `packages/api-client/` exports:
  - `schema.d.ts` — generated, gitignored, produced by `codegen`.
  - `client.ts` — `createClient<paths>({ baseUrl })` plus auth middleware (bearer token, refresh).
  - Hand-written **domain helpers** that must stay thin (`moveTask(id, toColumn, position)`), so the web and any Node consumers share the same call sites.
- `apps/web` consumes `@fem-ho/api-client` only. **No `fetch(` calls anywhere in `apps/web`** — make that an ESLint `no-restricted-globals`/`no-restricted-syntax` rule so the agent physically cannot bypass the contract.
- Add `openapi-react-query` for the kanban/calendar data layer: query keys derive from the path + params, which removes an entire class of cache-key bugs the agent would otherwise hand-roll.
- CI gate: `--check` must pass.

---

## 6. Code generation: Kotlin/Android side

### 6.1 OpenAPI Generator — the `kotlin` generator

**Maturity: high for the JVM libraries, mediocre for multiplatform.** Verified config options from `docs/generators/kotlin.md`:

**`library` values** (default in bold):

| value | Platform / HTTP client (verbatim from docs) |
| --- | --- |
| **`jvm-okhttp4`** | **[DEFAULT] Platform: Java Virtual Machine. HTTP client: OkHttp 4.2.0** |
| `jvm-retrofit2` | Platform: JVM. HTTP client: Retrofit 2.6.2. |
| `jvm-ktor` | Platform: JVM. HTTP client: Ktor 1.6.7. |
| `multiplatform` | Platform: Kotlin multiplatform. HTTP client: Ktor 1.6.7. |
| `jvm-spring-webclient` | Platform: JVM. HTTP: Spring 5 (or 6 with `useSpringBoot3`). |
| `jvm-spring-restclient` | Platform: JVM. HTTP: Spring 6 RestClient. |
| `jvm-volley` | Platform: JVM for Android. HTTP client: Volley 1.2.1. **(Deprecated)** |
| `jvm-vertx` | Platform: JVM. HTTP client: Vert.x Web Client. |

**`serializationLibrary`** (default `moshi`): `moshi`, `gson`, `jackson`, `kotlinx_serialization`.
**`dateLibrary`** (default `java8`): `java8` (native JSR310), `threetenbp` (JSR310 backport), `kotlinx-datetime`, `string`.

⚠️ **Important maturity caveat, verified:** the official docs pin `jvm-ktor` and `multiplatform` at **Ktor 1.6.7** — a dated major. If Fem-ho's Android app wants Ktor 3.x, the generated client will need template overrides or a different generator. **For a JVM-only Android app, `jvm-okhttp4` or `jvm-retrofit2` is the low-risk choice.**

Third-party alternatives exist (`openapi2ktor`, `openapi-kmp-gen`, `kotlin-openapi-generator`) targeting modern Ktor/KMP. `UNVERIFIED`: I did not evaluate their production readiness; treat them as experimental.

### 6.2 Gradle plugin wiring (verbatim shapes)

```gradle
plugins {
  id "org.openapi.generator" version "7.24.0"
}
```

Tasks provided (verbatim descriptions):
- `openApiGenerate` — "Generate code via Open API Tools Generator for Open API 2.0 or 3.x specification documents"
- `openApiValidate` — "Validates an Open API 2.0 or 3.x specification document"
- `openApiMeta` — "Generates a new generator to be consumed via Open API Generator"
- `openApiGenerators` — "Lists generators available via Open API Generators"

Standard extension config:

```gradle
openApiGenerate {
    generatorName.set("kotlin")
    inputSpec.set("$rootDir/specs/petstore-v3.0.yaml")
    outputDir.set(layout.buildDirectory.dir("generated").get().asFile.path)
    apiPackage.set("org.openapi.example.api")
    invokerPackage.set("org.openapi.example.invoker")
    modelPackage.set("org.openapi.example.model")
    configOptions.put("dateLibrary", "java8")
}
```

Custom task registration (for multiple outputs):

```gradle
task buildGoClient(type: org.openapitools.generator.gradle.plugin.tasks.GenerateTask) {
    generatorName.set("go")
    inputSpec.set("$rootDir/petstore-v3.0.yaml")
    outputDir.set(layout.buildDirectory.dir("go").get().asFile.path)
    configOptions.set([dateLibrary: "threetenp"])
}
```

For Gradle 7+, `tasks.register('taskName', org.openapitools.generator.gradle.plugin.tasks.GenerateTask)` is the modern registration form.

### 6.3 Fem-ho's `apps/android/core-network/build.gradle.kts`

```kotlin
plugins {
    id("com.android.library")
    kotlin("android")
    kotlin("plugin.serialization")
    id("org.openapi.generator") version "7.24.0"
}

val specFile = rootProject.file("../../packages/contracts/dist/openapi.bundled.yaml")

openApiGenerate {
    generatorName.set("kotlin")
    inputSpec.set(specFile.absolutePath)
    outputDir.set(layout.buildDirectory.dir("generated/openapi").get().asFile.path)
    apiPackage.set("cat.femho.api")
    modelPackage.set("cat.femho.api.model")
    invokerPackage.set("cat.femho.api.invoker")
    configOptions.set(
        mapOf(
            "library" to "jvm-okhttp4",
            "serializationLibrary" to "kotlinx_serialization",
            "dateLibrary" to "kotlinx-datetime",
            "enumPropertyNaming" to "UPPERCASE"
        )
    )
}

// Make compilation depend on generation, and add the sources.
tasks.named("preBuild") { dependsOn("openApiGenerate") }
android {
    sourceSets["main"].java.srcDir(layout.buildDirectory.dir("generated/openapi/src/main/kotlin"))
}

tasks.register("verifySpecUnchanged") {
    // fails if generation would produce a different tree than last commit
    dependsOn("openApiGenerate")
}
```

`UNVERIFIED`: `enumPropertyNaming` is a real Kotlin-generator option name in my recollection but I did not see it in the fetched table; confirm against `openApiGenerators` output or the generator doc before using.

### 6.4 What Fem-ho should do

- Kotlin generator: `library=jvm-okhttp4`, `serializationLibrary=kotlinx_serialization`, `dateLibrary=kotlinx-datetime`. Avoid `jvm-ktor`/`multiplatform` until the Ktor 1.6.7 pin is resolved.
- **Do not** use the generated client as the app's repository layer. Wrap it: `:core-data` owns `TaskRepository`, which talks to the generated API *and* to Room, and owns the offline-first reconciliation. The generated code is a transport detail.
- Add `openApiValidate` to the Android `check` task so a malformed spec fails the Android build too — cheap redundancy that catches a spec edit that only broke the Kotlin side.
- Because Android is offline-first: the contract must expose **server-authoritative `updated_at` + an opaque `sync_cursor`** on list endpoints, and a **conflict field** on writes (`If-Match`/ETag or a `version` integer). Specify this in `openapi.yaml`, not in Kotlin code, so the web client obeys the same rules.

---

## 7. Spec linting and contract tests

### 7.1 Linting: Redocly CLI

Redocly CLI ships rulesets you `--extends`:
- `spec` — follows the OpenAPI specification
- `recommended` — good basic set for a consistent, user-friendly API
- `recommended-strict` — **elevates all warnings to errors so you don't miss warnings in a CI pipeline**
- `minimal` — few errors

Migration from Spectral: replace `spectral lint` with the Redocly command; `--ruleset` becomes `--extends`.

`packages/contracts/redocly.yaml`:

```yaml
extends:
  - recommended-strict
rules:
  operation-operationId: error
  operation-operationId-unique: error
  operation-summary: error
  no-invalid-schema-examples: error
  no-unresolved-refs: error
  spec-components-invalid-map-name: error
  # Fem-ho house rules
  operation-4xx-response: error
  no-ambiguous-paths: error
apis:
  femho@v1:
    root: ./openapi.yaml
    x-openapi-ts:
      output: ../api-client/src/generated/schema.d.ts
      enum: true
      root-types: true
```

CI step: `npx @redocly/cli lint packages/contracts/openapi.yaml`.

> Spectral remains a valid alternative with a custom ruleset; Redocly is faster on large documents and gives you bundling + docs in the same binary, so it's one fewer tool for the agent to learn.

### 7.2 Property-based contract testing: Schemathesis

Schemathesis generates test cases from an OpenAPI/GraphQL schema using property-based testing (Hypothesis under the hood), understanding types, formats, required fields, enums, and min/max, and producing both valid and intentionally invalid inputs. It is **MIT-licensed** and "plugs into existing setups: CLI, `pytest`, GitHub Actions, plus Allure, JUnit XML, and HAR output."

Verified invocation form:

```bash
uvx schemathesis run https://example.schemathesis.io/openapi.json
```

`UNVERIFIED`: the exact flag names (`--url`, `--checks`, `--max-examples`, `--report`) and the built-in check identifiers (`not_a_server_error`, `status_code_conformance`, `content_type_conformance`, `response_schema_conformance`, `negative_data_rejection`) were **not** confirmed on the pages I fetched. The agent must run `schemathesis run --help` once and record the real flags in `docs/TESTING.md` before wiring CI.

Practical policy: **gate PRs with a modest per-PR example count; schedule a heavier nightly run.** This is the documented pattern and it matters — property-based tests are slow and flaky-feeling when over-budgeted.

### 7.3 Runtime conformance: Stoplight Prism

Prism turns any OpenAPI v2/v3 (or Postman collection) into a mock/proxy server. Two modes matter:

- **`prism mock <spec>`** — serve the contract before the backend exists. Perfect for building `apps/web` against Milestone-2 contracts while the server is still stubs.
- **`prism proxy <spec> <upstream> --errors`** — a *validation proxy*: it "looks at both requests and responses to determine whether they match the operation and schema descriptions from the OpenAPI file." `--errors` makes Prism alert on mismatch.

Verbatim command shapes:

```bash
prism proxy reference/backend/openapi.yaml http://localhost:3000 --errors

prism proxy reference/api-a/openapi.yaml api-a-test.example.com --errors -p 5000
prism proxy reference/api-b/openapi.yaml api-b-test.example.com --errors -p 5001
```

`UNVERIFIED`: the Docker image name for Prism and the exact violation-reporting header (I looked for `sl-violations`; the page did not confirm it).

### 7.4 Pact vs OpenAPI schema testing — do NOT use Pact

Verified positioning: Pact is consumer-driven — the contract is generated from what consumers actually need, and the provider must satisfy the union of all consumer expectations. That is right when you have **two or more internal consumer teams whose expectations diverge from the published spec**, many independently released services, and hard deployment gating.

Fem-ho has one provider and two first-party consumers built from the same spec in the same commit. **Pact's setup and maintenance cost buys nothing here.** Use provider-driven OpenAPI schema testing (Schemathesis + Prism proxy) instead — the documented guidance is that teams already maintaining an OpenAPI spec can stand up schema-first contract tests in under an hour.

### 7.5 What Fem-ho should do

Three CI gates, in this order (cheapest first):

1. `redocly lint --extends recommended-strict` — the spec is well-formed and house rules hold.
2. `openapi-typescript --check` + Gradle `openApiValidate` — generated artifacts are in sync.
3. `schemathesis run` against a running server (Testcontainers-backed) with a small example budget on PRs, larger nightly.

Plus a dev-loop convenience: an `infra/prism/` compose service that runs `prism proxy` in front of the dev API so the agent sees contract violations *while coding*, not in CI.

---

## 8. AGENTS.md / CLAUDE.md: the agent-instructions convention

### 8.1 Current state of the AGENTS.md convention — verified

- AGENTS.md is "a simple, open format for guiding coding agents," positioned as **"a README for agents."** It complements `README.md` by holding the detailed technical context that would clutter human docs.
- Exact filename **`AGENTS.md`**, at the repository root.
- **Monorepo rule:** place additional `AGENTS.md` files inside subpackages. "Agents automatically read the nearest file in the directory tree, so the closest one takes precedence." The OpenAI repository has **88** `AGENTS.md` files.
- **Precedence:** the closest `AGENTS.md` wins; **"Explicit user chat prompts override everything."**
- **Adoption:** over 60,000 projects; tools include OpenAI Codex, Google Jules, Cursor, Factory, Aider, VS Code, Devin, Zed, GitHub Copilot, and 20+ others.
- **Governance:** "stewarded by the Agentic AI Foundation under the Linux Foundation." (Formalised as an open spec in Aug 2025 led by OpenAI with Google, Cursor, Factory; donated to the Linux Foundation's Agentic AI Foundation in Dec 2025 — this provenance detail comes from a secondary summary, so treat the dates as `UNVERIFIED` while the *stewardship* statement is verified from agents.md itself.)

The canonical minimal example from agents.md:

```markdown
# AGENTS.md
## Setup commands
- Install deps: `pnpm install`
- Start dev server: `pnpm dev`
- Run tests: `pnpm test`
## Code style
- TypeScript strict mode
- Single quotes, no semicolons
- Use functional patterns where possible
```

### 8.2 Claude Code specifically — verified, and it differs

**Claude Code reads `CLAUDE.md`, not `AGENTS.md`.** The documented bridge:

```markdown
@AGENTS.md

## Claude Code

Use plan mode for changes under `src/billing/`.
```

Or a symlink (`ln -s AGENTS.md CLAUDE.md`), which does not work on Windows without Administrator/Developer Mode — prefer the `@AGENTS.md` import.

Verified loading semantics:

| Scope | Location |
| --- | --- |
| Managed policy | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL `/etc/claude-code/CLAUDE.md`; Windows `C:\Program Files\ClaudeCode\CLAUDE.md` |
| User | `~/.claude/CLAUDE.md` |
| Project | `./CLAUDE.md` **or** `./.claude/CLAUDE.md` |
| Local (gitignored) | `./CLAUDE.local.md` |

- Files **above** the working directory load in full at launch; files in **subdirectories** load on demand when Claude reads files there.
- All discovered files are **concatenated**, not overridden; ordering is filesystem-root → cwd, so the closest file is read last. Within a directory, `CLAUDE.local.md` is appended after `CLAUDE.md`.
- **`@path/to/import` syntax**, relative or absolute, resolved relative to the *importing file*. Imports may recurse to a **maximum depth of four hops**. Import parsing skips code spans/fences, so `` `@README` `` stays literal.
- **Size guidance: target under 200 lines per CLAUDE.md file.** "Longer files consume more context and reduce adherence." Splitting into imports helps organisation but **does not reduce context** — imported files still load at launch.
- **`.claude/rules/`**: topic files, discovered recursively. Rules with YAML frontmatter `paths:` load only when Claude touches matching files. This is the real context saver.
- **`claudeMdExcludes`** (glob list, any settings layer) skips other teams' ancestor CLAUDE.md files in a monorepo.
- Block-level HTML comments in CLAUDE.md are stripped before injection — free maintainer notes.
- Project-root CLAUDE.md **survives `/compact`** (re-read from disk); nested ones do not until re-triggered.

### 8.3 AGENTS.md vs the spec — the line to draw

This is the single most-confused distinction, so state it plainly in the repo:

| | `AGENTS.md` / `CLAUDE.md` | `docs/specs/*.md` |
| --- | --- | --- |
| **Answers** | "How do I operate in this repo?" | "What must the software do?" |
| **Lifetime** | Changes when tooling changes | Changes when the product changes |
| **Loaded** | Every session, automatically | On demand, when working the feature |
| **Contains** | Commands, conventions, layout, gotchas, "always/never" rules | Requirements, state machines, acceptance criteria, edge cases, worked examples |
| **Size** | < 200 lines | As long as necessary |
| **Test** | "Would removing this line cause a mistake?" | "Could two engineers build different things from this?" |
| **Fem-ho example** | "Run `pnpm spec:check` after touching `packages/contracts`" | "Quick-add: `#Feina/Q3` routes to scope Feina, project Q3; if the project does not exist, do NOT create it — surface an inline error" |

**Corollary the agent must be told:** never put product requirements in AGENTS.md. Requirements grow, AGENTS.md must not.

### 8.4 Concrete root `AGENTS.md` for Fem-ho

```markdown
# Fem-ho — agent instructions

Self-hosted personal + family task manager. Web (Docker) + native Android.
UI language is **Catalan**. Read `docs/ARCHITECTURE.md` before structural work.

## Commands
- Install:        `pnpm install`            (never `npm`/`yarn`; pnpm is pinned via Corepack)
- Dev (all):      `pnpm dev`
- Build:          `pnpm build`
- Unit tests:     `pnpm test`
- Single package: `pnpm --filter @fem-ho/server test`
- Typecheck:      `pnpm typecheck`
- Lint:           `pnpm lint`
- E2E:            `pnpm test:e2e`            (Playwright; starts its own web server)
- Codegen:        `pnpm codegen`             (REQUIRED after any change under packages/contracts/)
- Spec gates:     `pnpm spec:lint && pnpm spec:check`
- DB:             `pnpm db:migrate`, `pnpm db:reset`
- Android:        `cd apps/android && ./gradlew assembleDebug`
- Android tests:  `cd apps/android && ./gradlew pixel6api34DebugAndroidTest`

## Hard rules
- `packages/contracts/openapi.yaml` is the ONLY place wire types are defined.
  Never hand-write a request/response type anywhere else.
- OpenAPI is 3.1.1. NEVER use `nullable:`. Use `type: [T, "null"]`.
- Every operation needs a camelCase `operationId`. Every body must `$ref` a named schema.
- Never edit files under any `generated/` directory. Run `pnpm codegen`.
- Never call `fetch()` in `apps/web`. Use `@fem-ho/api-client`.
- Never hardcode a colour, radius, spacing or font. Use Plou tokens
  (`var(--plou-*)` on web, `PlouTokens.*` on Android). See `docs/DESIGN.md`.
- All user-facing strings are Catalan and live in `apps/web/src/i18n/ca.json` /
  `apps/android/app/src/main/res/values/strings.xml`. No literals in components.
- Column ids are exactly: `inbox`, `todo`, `doing`, `done`. The Catalan labels
  are Inbox / Per fer / Fent / Fet — labels are display-only, never identifiers.
- Migrations are append-only. Never edit a committed migration; add a new one.
- Do not add a dependency without an ADR in `docs/decisions/`.

## Definition of done for any change
1. `pnpm lint && pnpm typecheck && pnpm test` pass.
2. If `packages/contracts/` changed: `pnpm spec:lint && pnpm spec:check` pass.
3. If user-visible: a Playwright spec covers it.
4. If schema changed: a migration exists AND a migration test asserts up+down.
5. `docs/` updated if behaviour or deployment changed.

## Where things live
See `docs/ARCHITECTURE.md`. One line each:
- `apps/server`   — API, CalDAV, MCP, auth, jobs
- `apps/web`      — React SPA (kanban + calendar)
- `apps/android`  — Gradle build, offline-first client
- `packages/contracts`     — openapi.yaml + grammars + mappings  ← source of truth
- `packages/domain`        — pure TS domain logic, zero I/O
- `packages/api-client`    — generated TS client + thin helpers
- `packages/design-system` — Plou: tokens + React components
- `packages/quickadd`      — the quick-add parser (shared by web and server)
```

And `CLAUDE.md` at the root is exactly:

```markdown
@AGENTS.md

## Claude Code specifics
- Use plan mode for anything touching `packages/contracts/` or `apps/server/src/caldav/`.
- Prefer `pnpm --filter` over full-repo test runs while iterating.
```

### 8.5 Nested AGENTS.md files Fem-ho should ship

| Path | Contains |
| --- | --- |
| `packages/contracts/AGENTS.md` | OAS 3.1 rules, file-splitting convention, `operationId` naming, how to regenerate, the ban on `nullable` |
| `apps/server/AGENTS.md` | Layering (route → service → repo), error envelope shape, auth middleware, how CalDAV routes differ, transaction rules |
| `apps/web/AGENTS.md` | Component conventions, Plou usage, query-key rules, Catalan i18n, no raw `fetch` |
| `apps/android/AGENTS.md` | JDK version, Gradle invocations, module boundaries, offline-first invariants, where generated code goes |
| `packages/design-system/AGENTS.md` | Token authoring rules, how to add a component, why Android is generated not hand-written |
| `e2e/AGENTS.md` | Selector policy (`data-testid` only), fixtures, how to run one spec, flake policy |

### 8.6 `.claude/rules/` for the heavy, path-scoped material

Because CLAUDE.md should stay under 200 lines but Fem-ho has a lot of domain rules, push the bulk into path-scoped rules:

```markdown
---
paths:
  - "apps/server/src/caldav/**/*.ts"
  - "packages/contracts/caldav-mapping.md"
---

# CalDAV rules
- Every Task maps to exactly one VTODO. UID is the task's UUID, never regenerated.
- A scope calendar and a project calendar are separate collections; a task appears
  in exactly one, determined by `project_id ?? scope_id`.
- Moving a task between scopes = DELETE from old collection + PUT to new, in one
  transaction, and both must appear in the audit log as a single `task.moved` event.
- Never emit a VTODO without DTSTAMP. Never emit floating times; always UTC or TZID.
```

### 8.7 What Fem-ho should do

- Ship **`AGENTS.md` as the real file** (portable across Codex/Cursor/Copilot/Zed/Aider) and **`CLAUDE.md` as a 5-line file that `@AGENTS.md`-imports it**. Never maintain two copies.
- Root `AGENTS.md` ≤ 200 lines. Nested ones ≤ 60 lines each.
- Everything longer goes to `.claude/rules/*.md` with `paths:` frontmatter, or to `docs/specs/`.
- Put the **verification commands** at the top of AGENTS.md. Per Claude Code's own best-practices doc: *"Give Claude a check it can run: tests, a build, a screenshot to compare. It's the difference between a session you watch and one you walk away from."*
- Add a `Stop` hook in `.claude/settings.json` that runs `pnpm lint && pnpm typecheck && pnpm test --run` so a turn cannot end on a red tree. (Documented behaviour: Claude Code overrides the hook after 8 consecutive blocks — so it's a strong gate, not an infinite loop.)

---

## 9. Writing specs FOR an AI

### 9.1 What makes a spec unambiguous

Six properties, each with a concrete technique:

1. **Enumerated, not adjectival.** Not "tasks are ordered sensibly." Instead: "Within a column, tasks are ordered by `position` ASC, then `created_at` ASC, then `id` ASC. `position` is a float64. New tasks get `position = max(position) + 1024`."
2. **State machines written out.** Every allowed transition, every forbidden one, and what happens on the forbidden one.
3. **"When X, do exactly Y"** — EARS notation (see §9.2).
4. **Worked examples of parsing/formatting**, input → output, including the failures.
5. **Explicit anti-goals.** The list of things the agent must NOT build.
6. **A machine-checkable acceptance criterion per requirement**, named after the test that proves it.

### 9.2 EARS notation — verified form

Kiro's requirements-first docs use EARS for acceptance criteria, with this verbatim pattern and example:

```
WHEN a user submits valid registration data
THE SYSTEM SHALL create a new user account

WHEN a user submits an email that already exists
THE SYSTEM SHALL display "Email already registered" error

WHEN a user submits invalid email format
THE SYSTEM SHALL display email validation error
```

Kiro states requirements in this form are "Unambiguous and testable," "Easy to translate into test cases," "Traceable through implementation," and "Clear for both technical and non-technical stakeholders."

`UNVERIFIED`: the fetched Kiro pages only demonstrated the `WHEN … THE SYSTEM SHALL …` variant. The wider EARS family (ubiquitous `THE SYSTEM SHALL`; event-driven `WHEN`; state-driven `WHILE`; optional-feature `WHERE`; unwanted-behaviour `IF … THEN`) is standard EARS but I did not confirm those exact forms from a primary source in this session. Use `WHEN`/`IF…THEN`/`WHILE` and note the provenance.

### 9.3 The two public spec-for-AI toolkits worth citing

**GitHub Spec Kit** (`github/spec-kit`) — verified structure:

- Install: `uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@vX.Y.Z` (also on PyPI: `uv tool install specify-cli`).
- Slash commands: `/speckit.constitution`, `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.taskstoissues`, `/speckit.implement`, `/speckit.converge`, `/speckit.clarify`, `/speckit.analyze`, `/speckit.checklist`.
- Directories: `.specify/{templates/overrides,presets/templates,extensions/templates,memory}` and `specs/{constitution.md,specification.md,implementation-plan.md,tasks.md}`.
- Supports "30+ AI coding agents"; `specify integration list` enumerates them.
- Core principle: *"Define what to build before building it."*
- Notably, `/speckit.clarify` ("resolve underspecified areas") and `/speckit.analyze` ("cross-artifact consistency checks") are the two commands that specifically target spec ambiguity — the failure mode this whole dossier exists to prevent.

**Kiro specs** — verified structure: `.kiro/specs/{feature-name}/` containing
- `requirements.md` — user stories + acceptance criteria in EARS notation
- `design.md` — technical architecture, sequence diagrams, data flow
- `tasks.md` — discrete, trackable implementation tasks

Enforced order: **spec → design → tasks → implementation.**

**Fem-ho should borrow the shape, not the tooling.** Adopt `docs/specs/NN-feature/{requirements,design,tasks}.md` as a convention; don't take a dependency on either CLI.

### 9.4 A worked spec template for Fem-ho

`docs/specs/06-quick-add/requirements.md`:

```markdown
# 06 — Quick-add with inline parsing

## Anti-goals
- NOT natural-language date parsing ("demà a les 5"). Dates come from the date picker only. [v2]
- NOT creating scopes or projects implicitly. Unknown targets are an inline error.
- NOT multi-assignee. Exactly zero or one `@person` per task in v1.

## Glossary
- **token**: a `@`- or `#`-prefixed run in the raw input.
- **residue**: the raw input with all recognised tokens removed and whitespace collapsed.

## R1 — Assignment token
User story: As a household member, I want to type `@marta` so the task is assigned
to Marta without leaving the keyboard.

### Acceptance criteria
- AC1.1 WHEN the input contains `@<slug>` and exactly one member of the current
  scope has `username == <slug>` THE SYSTEM SHALL set `assignee_id` to that member
  and remove the token from the title.
- AC1.2 WHEN `<slug>` matches no member THE SYSTEM SHALL leave the literal text in
  the title, set `assignee_id = null`, and show the inline hint
  "No s'ha trobat cap membre «@<slug>»".
- AC1.3 WHEN the input contains more than one `@` token THE SYSTEM SHALL use the
  FIRST and treat the rest as literal text.
- AC1.4 Matching is case-insensitive and diacritic-insensitive (NFD + strip marks).

  Test: `packages/quickadd/src/__tests__/assignment.test.ts`

## R2 — Scope and project routing
- AC2.1 WHEN the input contains `#<scope>` and a scope with that slug is visible to
  the user THE SYSTEM SHALL set `scope_id` and clear `project_id`.
- AC2.2 WHEN the input contains `#<scope>/<project>` and both exist THE SYSTEM SHALL
  set both `scope_id` and `project_id`.
- AC2.3 WHEN `<scope>` exists but `<project>` does not THE SYSTEM SHALL set `scope_id`,
  leave `project_id` null, and show "El projecte «<project>» no existeix a «<scope>»".
- AC2.4 IF no `#` token is present THEN the target is the currently selected scope
  chip; IF exactly one chip is selected THEN use it; IF zero or more than one chip
  is selected THEN the task goes to the user's Personal scope Inbox.
- AC2.5 Slugs may contain letters (incl. àèéíòóúïüç), digits, `-` and `_`. A `/`
  terminates the scope slug. Whitespace terminates the token.

  Test: `packages/quickadd/src/__tests__/routing.test.ts`

## R3 — Title residue
- AC3.1 THE SYSTEM SHALL set `title` to the residue, trimmed, with internal runs of
  whitespace collapsed to one space.
- AC3.2 IF the residue is empty THEN the create button is disabled and the field
  shows "Escriu un títol".

## Worked examples (these are the test table, verbatim)

| input | title | scope | project | assignee | hint |
|---|---|---|---|---|---|
| `Comprar pa` | `Comprar pa` | (selected chip) | null | null | — |
| `Comprar pa #Família` | `Comprar pa` | `familia` | null | null | — |
| `Revisar Q3 #Feina/Q3` | `Revisar Q3` | `feina` | `q3` | null | — |
| `@marta Treure les escombraries #Família` | `Treure les escombraries` | `familia` | null | `marta` | — |
| `Trucar @Marta a les 5` | `Trucar a les 5` | (chip) | null | `marta` | — |
| `Cafè amb @joan i @pere` | `Cafè amb i @pere` | (chip) | null | `joan` | — |
| `Fer #NoExisteix` | `Fer` | (chip) | null | null | scope not found |
| `Fer #Feina/NoExisteix` | `Fer` | `feina` | null | null | project not found |
| `@ningu` | `@ningu` | (chip) | null | null | member not found |
| `   #Feina   ` | *(empty)* | `feina` | null | null | title required |
| `Correu a@b.com` | `Correu a@b.com` | (chip) | null | null | — (no leading boundary) |

AC: token recognition requires a word boundary before `@`/`#` (start of input or
whitespace). `a@b.com` is therefore NOT an assignment token.
```

That table is not decoration. It is a test fixture — commit it as `packages/quickadd/src/__tests__/fixtures/cases.json` and have the test iterate it. **The spec and the test are then literally the same artifact.**

### 9.5 State machines, written out

`docs/specs/03-kanban/design.md` must contain, verbatim, a transition table — not prose:

```markdown
## Task column state machine

States: `inbox`, `todo`, `doing`, `done`

| from \ to | inbox | todo | doing | done |
|---|---|---|---|---|
| inbox  | reorder | ✅ | ✅ | ✅ |
| todo   | ✅ | reorder | ✅ | ✅ |
| doing  | ✅ | ✅ | reorder | ✅ |
| done   | ✅ | ✅ | ✅ | reorder |

All transitions are allowed. Side effects, exactly:

- ANY → `done`:  set `completed_at = now()`; set `status = COMPLETED` in CalDAV;
                 append audit event `task.completed`.
- `done` → ANY:  set `completed_at = null`; CalDAV `status = NEEDS-ACTION`;
                 audit event `task.reopened`.
- ANY → `doing`: if `started_at` is null, set `started_at = now()`. CalDAV
                 `status = IN-PROCESS`. Never clear `started_at` on leaving.
- inbox → ANY:   no extra side effect. (`inbox` is a column, not a status.)

Subtask rule: WHEN every subtask of a task is `done` THE SYSTEM SHALL NOT move the
parent automatically. (Anti-goal: no auto-completion cascade.)
Reverse rule: WHEN a parent moves to `done` THE SYSTEM SHALL mark all its subtasks
`done` in the same transaction and emit one audit event `task.completed` with
`cascade: [subtask ids]`.
```

Note how the asymmetry (down-cascade yes, up-cascade no) is stated explicitly with an anti-goal. An agent given only "completing a task completes its subtasks" will invent the reverse rule 50% of the time.

### 9.6 Anti-goals — write them or the agent will build them

Ship `docs/specs/00-anti-goals.md`. Fem-ho's list should include at minimum:

- No built-in AI engine. The app **exposes** work via API/MCP and records an audit trail; it never calls a model itself.
- No real-time collaborative editing (no CRDT/OT). Last-write-wins with a version field.
- No email sending in v1 (no invite emails, no notifications by mail).
- No mobile web app beyond responsive layout — the mobile experience is the Android app.
- No iOS app.
- No public sign-up. Users are created by an admin.
- No sub-sub-tasks. Exactly two levels: task → subtask.
- No recurring tasks in v1 (RRULE is read-only pass-through in CalDAV).
- No file attachments in v1.
- No timezone-per-user; the server has one timezone, set by env var.

### 9.7 What Fem-ho should do

- `docs/specs/NN-feature/{requirements,design,tasks}.md` per feature, numbered to match the milestones in §10.
- Every acceptance criterion is `WHEN … THE SYSTEM SHALL …` or `IF … THEN …`, is numbered `ACn.m`, and names the test file that proves it.
- Every parsing/formatting spec ends with a **worked-examples table that is committed as a JSON fixture**.
- Every stateful feature has a transition table with side effects listed per transition.
- `docs/specs/00-anti-goals.md` is read by the agent before any feature work — reference it from `AGENTS.md`.
- Borrow Spec Kit's `clarify` discipline: before implementing, the agent must list every ambiguity it found and either resolve it from the spec or ask. Encode that as a `.claude/skills/spec-clarify/SKILL.md`.

---

## 10. The 14-milestone build plan

Design principles for the phasing:

- **Every milestone ends with a green automated check that did not exist before.** No milestone is "done" by inspection.
- **Vertical slices, not layers.** M3 delivers a working kanban end-to-end, not "all the repositories."
- **The contract leads.** Each milestone that adds endpoints edits `packages/contracts/` first.
- **Android comes late (M12) but its constraints are designed in from M2** (sync cursor, ETags, soft deletes).

| # | Milestone | Scope | Definition of done | Automated check (the exact command) |
|---|---|---|---|---|
| **M0** | Repo skeleton & CI spine | pnpm workspace, turbo.json, tsconfig.base, ESLint/Prettier, empty `apps/*` + `packages/*`, `AGENTS.md`, `CLAUDE.md`, docs stubs, Dockerfile that builds an empty server, GH Actions running lint+typecheck+test | `pnpm install && pnpm build && pnpm test` succeeds on a clean clone; CI green; `docker build -f infra/docker/Dockerfile .` succeeds | `pnpm turbo run lint typecheck test build` + `docker build` in CI |
| **M1** | Auth: email + password, sessions | User table + migration, argon2id hashing, `POST /auth/login`, `POST /auth/logout`, `POST /auth/refresh`, `GET /auth/me`, session cookie for web + bearer for API, admin-created users, rate limiting on login | A user seeded by `pnpm db:seed` can log in via the API and via a Playwright-driven login page; wrong password returns 401 with the standard error envelope; 6 failed attempts in 60s returns 429 | `pnpm --filter @fem-ho/server test` (unit+integration on Testcontainers Postgres) **and** `pnpm test:e2e -- auth.spec.ts` |
| **M2** | Data model + migrations + contract v1 | Full schema: `users, scopes, scope_members, projects, tasks, subtasks, checklists, checklist_items, audit_events`; soft deletes; `updated_at`; `version` int for optimistic concurrency; sync cursor endpoint shape; `openapi.yaml` covering scopes/projects/tasks CRUD | Migrations apply up and down cleanly on an empty DB and on a seeded DB; `redocly lint --extends recommended-strict` passes; `openapi-typescript --check` passes; generated Kotlin models compile | `pnpm db:migrate:test` (up→down→up on Testcontainers) + `pnpm spec:lint && pnpm spec:check` + `cd apps/android && ./gradlew :core-network:compileDebugKotlin` |
| **M3** | Tasks view — 4-column kanban | Board UI (Inbox / Per fer / Fent / Fet), fractional `position` ordering, drag & drop, optimistic update + rollback, `PATCH /tasks/{id}` with `column` + `position`, subtasks inline | A task can be dragged between all 4 columns and the order persists across reload; concurrent moves resolve by `version` and the loser gets a 409 with the current state | `pnpm test:e2e -- kanban.spec.ts` (spec in §11.4) |
| **M4** | Scopes & projects: chips + dropdown | Scope CRUD, individual vs collective, membership, project CRUD nested under scope, multi-select scope chips in the top bar, project dropdown filtered by selected chips, per-scope permissions enforced server-side | Selecting 2 chips shows the union of both scopes' tasks; a user who is not a member of a collective scope gets 403 on every task in it; the project dropdown never shows a project from an unselected scope | `pnpm --filter @fem-ho/server test -- authz` + `pnpm test:e2e -- scopes.spec.ts` |
| **M5** | Calendar view + shared Inbox column | Month/week/day views, tasks with `due_at` rendered, drag from Inbox column onto a day sets `due_at`, the Inbox side column is the *same component instance state* as the tasks view Inbox | Switching Tasks↔Calendar preserves scope chip selection and Inbox scroll position; dropping a task on 12 March sets `due_at` to that date at the configured default time | `pnpm test:e2e -- calendar.spec.ts` |
| **M6** | Quick-add with inline parsing | `packages/quickadd` parser (pure, no I/O), `@person` / `#Scope` / `#Scope/Project`, inline hints, used by both the web "+" button and `POST /tasks` server-side `raw` field | Every row of the worked-examples table in `docs/specs/06-quick-add` passes; the same input produces the same result through the UI and through `POST /tasks {raw: "..."}` | `pnpm --filter @fem-ho/quickadd test` (table-driven from the committed fixture) + `pnpm test:e2e -- quickadd.spec.ts` |
| **M7** | Checklists (llistes simples) + settings | Checklist attached to task or subtask, pinnable, reorderable items, check/uncheck; profile settings (name, password change, theme light/dark, accent variant); household admin settings (create users, create scopes) | A pinned checklist appears in the pinned rail across both views; unpinning removes it; a non-admin gets 403 on admin settings endpoints | `pnpm test:e2e -- checklists.spec.ts settings.spec.ts` |
| **M8** | CalDAV — bidirectional | Per-scope and per-project collections, VTODO mapping per `packages/contracts/caldav-mapping.md`, `PROPFIND`/`REPORT`/`PUT`/`DELETE`, ctag/etag, sync-token, `.well-known/caldav` | A round-trip test creates a task via REST, reads it via CalDAV, edits it via CalDAV, and the REST representation reflects the edit with a new `version` and an audit event; the same works in reverse | `pnpm --filter @fem-ho/server test -- caldav` + `pnpm test:caldav` (round-trip harness, §11.6) |
| **M9** | API tokens & scoped keys | Token table, `audience ∈ {human, ai}`, per-scope and per-project grants, `POST /tokens`, revoke, last-used tracking, token shown once, `Authorization: Bearer` middleware, separate rate limits per audience | An `ai`-audience token scoped to `#Feina` can read/write tasks in Feina and gets 403 everywhere else; a revoked token gets 401 within one request | `pnpm --filter @fem-ho/server test -- tokens` + `schemathesis run` with an auth hook |
| **M10** | MCP server | MCP server exposing tools over the same domain layer (`list_tasks`, `create_task`, `move_task`, `add_subtask`, `list_scopes`, `complete_task`, `append_note`), authenticated by an `ai`-audience token, every mutation writes an audit event with `actor_type = ai` | `mcp-inspector --cli … --method tools/list` lists exactly the tools in `packages/contracts/mcp-tools.json`; each tool's happy path returns without `isError`; an unauthorised tool call exits 3 | `pnpm test:mcp` (script in §11.7) |
| **M11** | Public share links | `share_links` table: target (task+subtasks OR checklist), `expires_at`, optional `password_hash`, `require_guest_name`, read-only public renderer, guest name recorded in the audit trail on interaction | An expired link returns 410; a password-protected link returns the gate, then the content; a link with `require_guest_name` blocks interaction until a name is entered and stores it | `pnpm test:e2e -- shares.spec.ts` |
| **M12** | AI mode + audit trail UI | `assignment_mode ∈ {self, ai_assisted, ai_delegated}` on tasks, the "AI user" as a first-class assignee, audit timeline per task showing actor (human/ai/token name), diff of each change | Setting a task to `ai_delegated` makes it visible to the AI token's MCP `list_tasks` with `mode=delegated`; every MCP mutation appears in the task's timeline with the token name | `pnpm --filter @fem-ho/server test -- audit` + `pnpm test:mcp -- delegation` |
| **M13** | Android app | Login screen with **server URL field**, Room DB, offline-first sync engine against the sync-cursor endpoints, kanban + calendar in Compose, quick-add, Plou theme generated from tokens | Airplane-mode: create/edit/move tasks, re-enable network, all changes reconcile with no duplicates and conflicts resolved by `version` with a user-visible conflict banner | `cd apps/android && ./gradlew pixel6api34DebugAndroidTest` (instrumented tests incl. an offline→online reconciliation test) |
| **M14** | Hardening & release | Docker Compose (server+Postgres), healthchecks, backup/restore script, structured logging, error envelope audit, a11y pass, Catalan copy review, `docs/DEPLOY.md`, signed release APK, GHCR image | A fresh `docker compose up` on a clean machine reaches a working login within 60s; the release APK installs and connects to that server; all docs commands are executed by a CI smoke job | `pnpm test:e2e -- --project=smoke` against the composed stack in CI + `./gradlew assembleRelease` |

### 10.1 Why this ordering

- **M1 before M2** looks backwards but isn't: auth forces the `users` table, the error envelope, the middleware stack and the Testcontainers harness into existence. Everything after inherits them.
- **M3 (kanban) before M5 (calendar)** because the calendar reuses the Inbox column component and the task card. Building calendar first means building those twice.
- **M6 (quick-add) after M4 (scopes)** because `#Scope/Project` resolution requires scopes and projects to exist and be permission-checked.
- **M8 (CalDAV) after M7** because CalDAV mapping needs the final task shape including checklists (which map to VTODO `DESCRIPTION` or related VTODOs — decide in an ADR).
- **M10 (MCP) after M9 (tokens)** because MCP auth *is* the token system.
- **M13 (Android) after M12** because the Android app should implement the final contract once, not chase it.

### 10.2 Per-milestone ritual the agent must follow

Encode this in `.claude/skills/milestone/SKILL.md`:

1. Read `docs/specs/NN-*/requirements.md` and `docs/specs/00-anti-goals.md`.
2. List every ambiguity found; resolve from the spec or stop and ask.
3. If the milestone touches the API: edit `packages/contracts/` **first**, run `pnpm codegen`, commit that alone.
4. Write the failing test named in the acceptance criteria.
5. Implement.
6. Run the milestone's automated check verbatim from the table above.
7. Run an adversarial review subagent against the diff and the requirements file.
8. Update `docs/` and add an ADR if a non-obvious choice was made.
9. Tag `m<NN>-done`.

Anthropic's own guidance supports 4 and 7 directly: *"Always provide verification (tests, scripts, screenshots). If you can't verify it, don't ship it."* and *"Use a subagent to review the … diff against PLAN.md. Check that every requirement is implemented, the listed edge cases have tests, and nothing outside the task's scope changed. Report gaps, not style preferences."*

---

## 11. Testing strategy the agent can actually satisfy

### 11.1 The shape

| Layer | Tool | Runs in | Budget |
| --- | --- | --- | --- |
| Pure domain unit tests | Vitest (`packages/domain`, `packages/quickadd`) | ms, no I/O | Thousands, table-driven |
| Server integration | Vitest + Testcontainers Postgres | seconds | Per endpoint, happy + 2 sad paths |
| DB migration tests | Testcontainers + migration runner | seconds | Every migration, up→down→up |
| API contract | `redocly lint`, `openapi-typescript --check`, Schemathesis | seconds–minutes | Every PR (small budget), nightly (large) |
| Web E2E | Playwright | minutes | One spec per milestone's user journey |
| CalDAV interop | custom round-trip harness (+ optional CalDAVTester) | minutes | Per-collection CRUD + sync-token |
| MCP | MCP Inspector CLI | seconds | `tools/list` shape + one call per tool |
| Android | JVM unit + Gradle Managed Device instrumented | minutes | Sync reconciliation + 3 UI journeys |

### 11.2 Unit tests: make them table-driven from committed fixtures

For `packages/quickadd`, the fixture *is* the spec table (§9.4):

```ts
// packages/quickadd/src/__tests__/parse.test.ts
import { describe, it, expect } from "vitest";
import cases from "./fixtures/cases.json";
import { parseQuickAdd } from "../index.js";

const ctx = {
  selectedScopeIds: ["personal"],
  scopes: [
    { id: "familia", slug: "familia", label: "Família" },
    { id: "feina", slug: "feina", label: "Feina" },
  ],
  projects: [{ id: "q3", slug: "q3", scopeId: "feina" }],
  members: [
    { id: "u_marta", username: "marta" },
    { id: "u_joan", username: "joan" },
  ],
};

describe("quick-add parser", () => {
  for (const c of cases) {
    it(`${JSON.stringify(c.input)} → ${JSON.stringify(c.title)}`, () => {
      const r = parseQuickAdd(c.input, ctx);
      expect(r.title).toBe(c.title);
      expect(r.scopeId).toBe(c.scopeId);
      expect(r.projectId).toBe(c.projectId);
      expect(r.assigneeId).toBe(c.assigneeId);
      expect(r.hint?.code ?? null).toBe(c.hint ?? null);
    });
  }
});
```

**Rule for the agent:** to add a parsing behaviour, add a row to `cases.json` first. Never add a test that isn't in the fixture.

### 11.3 DB migration tests with Testcontainers

Verified approach for Node: install `@testcontainers/postgresql`, start with `new PostgreSqlContainer().start()`, read connection details with `getConnectionUri()`, `getHost()`, `getPort()`, and wire into `pg`, Prisma, or Drizzle. Testcontainers' **Ryuk** companion container cleans up leaked containers — leave it enabled in CI so failed runs don't orphan containers. Docker is available on GitHub Actions `ubuntu` runners, so no extra setup is needed.

```ts
// apps/server/test/migrations.test.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { beforeAll, afterAll, it, expect } from "vitest";
import { migrateUp, migrateDown, listApplied, tableExists } from "../src/db/migrate.js";

let pg: StartedPostgreSqlContainer;
beforeAll(async () => { pg = await new PostgreSqlContainer("postgres:16-alpine").start(); }, 120_000);
afterAll(async () => { await pg.stop(); });

it("applies every migration, rolls each back, and reapplies", async () => {
  const url = pg.getConnectionUri();
  await migrateUp(url);
  const applied = await listApplied(url);
  expect(applied.length).toBeGreaterThan(0);

  // Down to zero, one at a time — catches non-reversible migrations.
  for (let i = applied.length - 1; i >= 0; i--) await migrateDown(url, 1);
  expect(await tableExists(url, "tasks")).toBe(false);

  // Up again — catches migrations that only work on a virgin DB.
  await migrateUp(url);
  expect(await tableExists(url, "tasks")).toBe(true);
});

it("is idempotent: a second up is a no-op", async () => {
  const url = pg.getConnectionUri();
  const before = await listApplied(url);
  await migrateUp(url);
  expect(await listApplied(url)).toEqual(before);
});
```

Add a **data-preserving** migration test for any migration that transforms rows: seed the old shape, migrate, assert the new shape. That is the class of bug an agent produces most often.

### 11.4 Playwright: config and the two specs that matter

Verified base config shape:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

Fem-ho's `e2e/playwright.config.ts` should extend that with: `testIdAttribute: 'data-testid'` in `use`, a `smoke` project for the M14 compose check, `video: 'retain-on-failure'`, and a `webServer` that runs the built Docker image in CI and `pnpm dev` locally.

#### 11.4.1 Kanban drag-and-drop spec

Playwright's documented drag API:

```ts
await page.locator('#item-to-be-dragged').dragTo(page.locator('#item-to-drop-at'));
```

and the manual form:

```ts
await page.locator('#item-to-be-dragged').hover();
await page.mouse.down();
await page.locator('#item-to-drop-at').hover();
await page.mouse.up();
```

with this **critical documented caveat**: *"If your page relies on the `dragover` event being dispatched, you need at least two mouse moves to trigger it in all browsers."* — hence the recommended sequence hovers the drop target **twice**.

Most React kanban libraries (dnd-kit, react-beautiful-dnd successors) are pointer/keyboard driven rather than HTML5-DnD driven, so `dragTo` alone is often unreliable. Write the helper once:

```ts
// e2e/helpers/drag.ts
import type { Page, Locator } from '@playwright/test';

/** Pointer-based drag that satisfies both HTML5 DnD and pointer-sensor libraries. */
export async function dragCardTo(page: Page, card: Locator, target: Locator) {
  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag: element not visible');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Small first move: activates distance-based drag sensors (dnd-kit default 8px).
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 5 });
  // Two moves over the target: required for `dragover` in all browsers.
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 1, { steps: 2 });
  await page.mouse.up();
}
```

```ts
// e2e/tests/kanban.spec.ts
import { test, expect } from '@playwright/test';
import { dragCardTo } from '../helpers/drag';
import { loginAs, seedTask } from '../helpers/fixtures';

test.describe('Kanban — 4 columns', () => {
  test.beforeEach(async ({ page }) => { await loginAs(page, 'borja'); });

  test('renders exactly the four columns in order', async ({ page }) => {
    const cols = page.getByTestId('kanban-column');
    await expect(cols).toHaveCount(4);
    await expect(cols).toHaveAttribute('data-column-id', /.*/);
    await expect(cols.nth(0)).toHaveAttribute('data-column-id', 'inbox');
    await expect(cols.nth(1)).toHaveAttribute('data-column-id', 'todo');
    await expect(cols.nth(2)).toHaveAttribute('data-column-id', 'doing');
    await expect(cols.nth(3)).toHaveAttribute('data-column-id', 'done');
    // Catalan labels are display-only.
    await expect(cols.nth(1)).toContainText('Per fer');
    await expect(cols.nth(2)).toContainText('Fent');
    await expect(cols.nth(3)).toContainText('Fet');
  });

  test('drags a card from Inbox to Fent and persists across reload', async ({ page }) => {
    const id = await seedTask(page, { title: 'Comprar pa', column: 'inbox' });
    const card = page.getByTestId(`task-card-${id}`);
    const doing = page.getByTestId('kanban-column').filter({ has: page.locator('[data-column-id="doing"]') });

    await expect(card).toBeVisible();
    await dragCardTo(page, card, page.locator('[data-column-id="doing"] [data-testid="column-dropzone"]'));

    // Optimistic UI: card is in `doing` before the network settles.
    await expect(page.locator('[data-column-id="doing"]').getByTestId(`task-card-${id}`)).toBeVisible();
    // Server-confirmed: reload and re-assert.
    await page.reload();
    await expect(page.locator('[data-column-id="doing"]').getByTestId(`task-card-${id}`)).toBeVisible();
    await expect(page.locator('[data-column-id="inbox"]').getByTestId(`task-card-${id}`)).toHaveCount(0);
  });

  test('moving to Fet sets completed_at and shows the completed style', async ({ page }) => {
    const id = await seedTask(page, { title: 'Treure escombraries', column: 'todo' });
    await dragCardTo(page,
      page.getByTestId(`task-card-${id}`),
      page.locator('[data-column-id="done"] [data-testid="column-dropzone"]'));
    await expect(page.getByTestId(`task-card-${id}`)).toHaveAttribute('data-completed', 'true');
  });

  test('reorders within a column and the order survives reload', async ({ page }) => {
    const a = await seedTask(page, { title: 'A', column: 'todo' });
    const b = await seedTask(page, { title: 'B', column: 'todo' });
    await dragCardTo(page, page.getByTestId(`task-card-${b}`), page.getByTestId(`task-card-${a}`));
    await page.reload();
    const titles = await page.locator('[data-column-id="todo"] [data-testid^="task-card-"]')
      .evaluateAll(els => els.map(e => e.getAttribute('data-title')));
    expect(titles.slice(0, 2)).toEqual(['B', 'A']);
  });

  test('rolls back the optimistic move when the server returns 409', async ({ page }) => {
    const id = await seedTask(page, { title: 'Conflicte', column: 'todo' });
    await page.route('**/api/v1/tasks/*', route =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 409, contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'version_conflict' } }) })
        : route.continue());
    await dragCardTo(page,
      page.getByTestId(`task-card-${id}`),
      page.locator('[data-column-id="done"] [data-testid="column-dropzone"]'));
    await expect(page.locator('[data-column-id="todo"]').getByTestId(`task-card-${id}`)).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('conflicte');
  });
});
```

**Keyboard drag is also required** (a11y + it is far more stable than pointer drag). Specify it: `Space` picks up, arrows move, `Space` drops, `Escape` cancels. Then add:

```ts
test('moves a card with the keyboard', async ({ page }) => {
  const id = await seedTask(page, { title: 'Teclat', column: 'inbox' });
  await page.getByTestId(`task-card-${id}`).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Space');
  await expect(page.locator('[data-column-id="doing"]').getByTestId(`task-card-${id}`)).toBeVisible();
});
```

#### 11.4.2 Quick-add parsing spec

```ts
// e2e/tests/quickadd.spec.ts
import { test, expect } from '@playwright/test';
import cases from '../../packages/quickadd/src/__tests__/fixtures/cases.json' assert { type: 'json' };
import { loginAs, selectScopeChips } from '../helpers/fixtures';

test.describe('Quick-add inline parsing', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, 'borja');
    await selectScopeChips(page, ['personal']);
  });

  test('live preview matches the parser for every spec case', async ({ page }) => {
    await page.getByTestId('create-button').click();
    const input = page.getByTestId('quickadd-input');
    for (const c of cases) {
      await input.fill(c.input);
      await expect(page.getByTestId('quickadd-preview-title')).toHaveText(c.title ?? '');
      await expect(page.getByTestId('quickadd-preview-scope'))
        .toHaveAttribute('data-scope-id', c.scopeId ?? 'personal');
      if (c.projectId) {
        await expect(page.getByTestId('quickadd-preview-project'))
          .toHaveAttribute('data-project-id', c.projectId);
      } else {
        await expect(page.getByTestId('quickadd-preview-project')).toHaveCount(0);
      }
      if (c.assigneeId) {
        await expect(page.getByTestId('quickadd-preview-assignee'))
          .toHaveAttribute('data-user-id', c.assigneeId);
      }
      if (c.hint) {
        await expect(page.getByTestId('quickadd-hint')).toHaveAttribute('data-code', c.hint);
      } else {
        await expect(page.getByTestId('quickadd-hint')).toHaveCount(0);
      }
    }
  });

  test('creates the task in the routed scope and project', async ({ page }) => {
    await page.getByTestId('create-button').click();
    await page.getByTestId('quickadd-input').fill('Revisar Q3 #Feina/Q3 @marta');
    await page.keyboard.press('Enter');
    await selectScopeChips(page, ['feina']);
    await page.getByTestId('project-dropdown').selectOption({ label: 'Q3' });
    const card = page.getByTestId('kanban-column')
      .filter({ has: page.locator('[data-column-id="inbox"]') })
      .getByText('Revisar Q3');
    await expect(card).toBeVisible();
    await expect(card.locator('..')).toHaveAttribute('data-assignee', 'marta');
  });

  test('disables submit when the residue is empty', async ({ page }) => {
    await page.getByTestId('create-button').click();
    await page.getByTestId('quickadd-input').fill('   #Feina   ');
    await expect(page.getByTestId('quickadd-submit')).toBeDisabled();
    await expect(page.getByTestId('quickadd-hint')).toHaveAttribute('data-code', 'title_required');
  });

  test('unknown scope leaves the token literal and warns', async ({ page }) => {
    await page.getByTestId('create-button').click();
    await page.getByTestId('quickadd-input').fill('Fer #NoExisteix');
    await expect(page.getByTestId('quickadd-hint')).toHaveAttribute('data-code', 'scope_not_found');
    await expect(page.getByTestId('quickadd-preview-title')).toHaveText('Fer');
  });
});
```

Note the design win: **the E2E spec imports the same fixture as the unit test.** A behaviour change fails in exactly one place.

**Selector policy (put it in `e2e/AGENTS.md`):** `data-testid` only for structural hooks; `getByRole`/`getByLabel` for anything a user perceives. Never CSS class selectors — the Plou design system will change classes.

### 11.5 API contract tests in CI

```yaml
- name: Lint the contract
  run: pnpm exec redocly lint packages/contracts/openapi.yaml --extends recommended-strict

- name: Fail if generated types drift
  run: |
    pnpm exec redocly bundle packages/contracts/openapi.yaml -o /tmp/openapi.yaml
    pnpm exec openapi-typescript /tmp/openapi.yaml \
      -o packages/api-client/src/generated/schema.d.ts --check

- name: Property-based conformance (small budget on PRs)
  run: uvx schemathesis run http://localhost:8080/api/v1/openapi.json
```

`UNVERIFIED`: the exact Schemathesis flags for example budget, check selection and report output. Run `schemathesis run --help` once, record the real flags in `docs/TESTING.md`, and then pin them.

Add a **validation-proxy job** for the E2E run: start the server on `:3000`, start `prism proxy packages/contracts/dist/openapi.bundled.yaml http://localhost:3000 --errors -p 4010`, and point Playwright's `baseURL` at `:4010`. Every E2E request is then also a contract assertion, for free.

### 11.6 CalDAV interop testing

Three tiers, use all three:

**Tier 1 — in-repo round-trip harness (must have).** A Vitest suite that speaks raw HTTP against the running server using a small WebDAV helper. This is the one the agent can iterate on.

```ts
// apps/server/test/caldav/roundtrip.test.ts
it('REST create → CalDAV read → CalDAV edit → REST reflects', async () => {
  const task = await api.post('/tasks', { title: 'Comprar pa', scopeId: 'familia' });

  const href = `/caldav/calendars/borja/scope-familia/${task.id}.ics`;
  const got = await dav.get(href);
  expect(got.status).toBe(200);
  expect(got.body).toMatch(/BEGIN:VTODO/);
  expect(got.body).toMatch(new RegExp(`UID:${task.id}`));
  expect(got.body).toMatch(/SUMMARY:Comprar pa/);
  expect(got.body).toMatch(/DTSTAMP:/);
  const etag = got.headers['etag'];

  const edited = got.body.replace('SUMMARY:Comprar pa', 'SUMMARY:Comprar pa i llet');
  const put = await dav.put(href, edited, { 'If-Match': etag });
  expect(put.status).toBe(204);

  const after = await api.get(`/tasks/${task.id}`);
  expect(after.title).toBe('Comprar pa i llet');
  expect(after.version).toBe(task.version + 1);

  const audit = await api.get(`/tasks/${task.id}/audit`);
  expect(audit.at(-1)).toMatchObject({ action: 'task.updated', actorType: 'caldav' });
});

it('rejects a stale If-Match with 412', async () => { /* ... */ });
it('PROPFIND Depth:1 lists every task in the collection', async () => { /* ... */ });
it('sync-collection REPORT returns only changes since the token', async () => { /* ... */ });
it('DELETE removes the task (soft) and the next PROPFIND omits it', async () => { /* ... */ });
```

**Tier 2 — CalDAVTester (should have).** Verified: CalDAVTester is "a test and performance application designed to work with CalDAV and / or CardDAV servers and tests various aspects of their protocol handling as well as performance."

```bash
git clone https://github.com/apple/ccs-caldavtester.git
# Server details / accounts go in scripts/servers (serverinfo XML)
# Test definitions live in scripts/tests, structured as <start>, <test-suites>, <end>
./testcaldav.py                          # run everything
./testcaldav.py CalDAV/well-known.xml    # run one script
```

Ship `infra/caldavtester/serverinfo-femho.xml` and a curated subset of scripts (well-known, propfind, put, delete, sync-report). Run it in a nightly CI job, not on every PR — it is slow and requires a seeded server.

`UNVERIFIED`: the Python version CalDAVTester requires (the Apple repo is long-standing and may be Python 2). If it will not run, fall back to Tier 1 + Tier 3 and record that in an ADR.

**Tier 3 — real client round-trip (must have, manual, once per release).** Add `docs/CALDAV.md` § "Manual interop checklist" with a table to tick: Thunderbird, Apple Calendar/Reminders, DAVx⁵ (Android), Tasks.org, Evolution. For each: subscribe, create a task in the client, verify it appears in Fem-ho; edit in Fem-ho, verify it appears in the client. This is the only way to catch the property quirks each client has.

**Do NOT rely on litmus.** Verified: litmus "is a WebDAV server test suite, which aims to test whether a server is compliant with the WebDAV protocol as specified in RFC2518. However, Cal- and CardDAV and other extensions are not part of this test." It is still worth running once for base WebDAV compliance, but it proves nothing about CalDAV.

### 11.7 MCP server tests — the MCP Inspector

Verified: the MCP Inspector "is the reference developer tool for testing and debugging MCP servers." It ships as a single package, **`@modelcontextprotocol/inspector`**, providing **three clients behind one binary**:

| Client | Invocation | Purpose |
| --- | --- | --- |
| Web | `npx @modelcontextprotocol/inspector` | full graphical inspector; the default |
| CLI | `npx @modelcontextprotocol/inspector --cli` | scriptable, machine-readable, for CI and coding agents |
| TUI | `npx @modelcontextprotocol/inspector --tui` | interactive terminal UI |

Requires **Node 22.19.0 or newer**. Mode flags are recognised **only at the front of the command line**; the first non-mode token ends launcher parsing and everything after is forwarded to the client.

Server selection forms:

```bash
# stdio: everything positional is the command to spawn
mcp-inspector --cli node build/index.js --method tools/list

# HTTP
mcp-inspector --cli https://api.example.com/mcp --transport http --method tools/list

# From a file
mcp-inspector --cli --config ./mcp.json --server myserver --method tools/list
```

Verified `--method` reference:

| `--method` | Required companions |
| --- | --- |
| `initialize` | none — returns `{serverInfo, protocolVersion, capabilities, instructions}` |
| `tools/list` | none |
| `tools/call` | `--tool-name`, plus `--tool-arg` / `--tool-args-json` |
| `resources/list` | none |
| `resources/read` | `--uri` |
| `resources/templates/list` | none |
| `prompts/list` | none |
| `prompts/get` | `--prompt-name`, `--prompt-args` |
| `logging/setLevel` | `--log-level` (legacy era only) |
| `servers/list`, `servers/show` | none — read the catalog **without connecting** |

Argument passing: `--tool-arg` takes `key=value` and **coerces** by JSON-parsing (`count=1` → number, `"012"` → `12`); `--tool-args-json` passes the whole object **verbatim** with no coercion. They are mutually exclusive.

```bash
mcp-inspector --cli <server> --method tools/call --tool-name mytool \
  --tool-arg key=value --tool-arg count=1 --tool-arg 'options={"format":"json"}'

mcp-inspector --cli <server> --method tools/call --tool-name mytool \
  --tool-args-json '{"zip":"10001"}'
```

Output: `--format text` (default) pretty-prints; `--format json` emits a single JSON object on stdout with no banners:

```bash
mcp-inspector --cli <server> --method tools/list --format json | jq '.result.tools[].name'
```

Verified exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Usage or unexpected error (catch-all) |
| `2` | No MCP App found on the tool (`--app-info` probe) |
| `3` | Server requires authentication (401/403, `WWW-Authenticate`, OAuth) |
| `4` | Server unreachable (DNS, connection refused, timeout, `fetch failed`) |
| `5` | Tool error: `tools/call` returned `isError: true`, or the tool wasn't found |

On any non-zero exit the CLI writes a single JSON line to stderr: `{"error":{"code":"auth_required","message":"Unauthorized","status":401,"url":"..."}}` — parseable with `2>&1 | tail -1 | jq .error`.

**For CI, `--stored-auth-only` is the flag you want**: never start interactive OAuth, never auto-open a browser, use stored tokens or fail immediately with `auth_required`.

The documented CI recipe:

```bash
set -euo pipefail

mcp-inspector --cli --config ./ci-servers.json --server my-server \
  --stored-auth-only --method tools/list --format json \
  | jq -e '.result.tools | map(.name) | index("get_weather")' > /dev/null
```

**Fem-ho's `scripts/test-mcp.sh`:**

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVER_URL="${FEMHO_MCP_URL:-http://localhost:8080/mcp}"
TOKEN="${FEMHO_AI_TOKEN:?set FEMHO_AI_TOKEN}"
INSPECT=(npx -y @modelcontextprotocol/inspector --cli "$SERVER_URL"
         --transport http --header "Authorization: Bearer $TOKEN" --stored-auth-only)

echo "== initialize =="
"${INSPECT[@]}" --method initialize --format json | jq -e '.result.serverInfo.name == "fem-ho"'

echo "== tools/list matches the committed manifest =="
"${INSPECT[@]}" --method tools/list --format json \
  | jq -S '[.result.tools[].name] | sort' > /tmp/actual-tools.json
jq -S '[.tools[].name] | sort' packages/contracts/mcp-tools.json > /tmp/expected-tools.json
diff -u /tmp/expected-tools.json /tmp/actual-tools.json

echo "== every tool has a description and an inputSchema =="
"${INSPECT[@]}" --method tools/list --format json \
  | jq -e '.result.tools | all(.description != null and (.description|length) > 20 and .inputSchema != null)'

echo "== list_scopes happy path =="
"${INSPECT[@]}" --method tools/call --tool-name list_scopes --format json \
  | jq -e '.result.isError != true'

echo "== create_task round-trip =="
NEW=$("${INSPECT[@]}" --method tools/call --tool-name create_task \
        --tool-args-json '{"title":"Prova MCP","scope":"personal","column":"inbox"}' \
        --format json | jq -r '.result.structuredContent.id')
test -n "$NEW"

echo "== move_task =="
"${INSPECT[@]}" --method tools/call --tool-name move_task \
  --tool-args-json "{\"id\":\"$NEW\",\"column\":\"doing\"}" --format json \
  | jq -e '.result.isError != true'

echo "== unauthorised scope is rejected (expect exit 5) =="
set +e
"${INSPECT[@]}" --method tools/call --tool-name create_task \
  --tool-args-json '{"title":"nope","scope":"feina"}' --format json >/dev/null 2>/tmp/err.json
code=$?
set -e
test "$code" -eq 5 || { echo "expected exit 5, got $code"; cat /tmp/err.json; exit 1; }

echo "== audit trail recorded the AI actor =="
curl -sf -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/tasks/$NEW/audit" \
  | jq -e '[.events[].actorType] | index("ai")'

echo "ALL MCP CHECKS PASSED"
```

`UNVERIFIED`: whether the CLI accepts `--header` alongside `--transport http` for a positional URL server (the docs mention `--header` overriding a config file's headers). If not, use a `--config ./ci-servers.json` file with the header baked in — that path *is* documented.

### 11.8 Android instrumented tests

Verified: **build-managed / Gradle Managed Devices** let you declare test devices in Gradle and AGP "fully manages—creates, deploys, and tears down—those devices."

```kotlin
android {
  testOptions {
    managedDevices {
      localDevices {
        create("pixel2api30") {
          device = "Pixel 2"
          apiLevel = 30
          systemImageSource = "aosp"
        }
      }
    }
  }
}
```

Task naming: `./gradlew device-nameBuildVariantAndroidTest`, e.g. `./gradlew pixel2api30DebugAndroidTest`. Device groups:

```kotlin
testOptions {
  managedDevices {
    localDevices {
      create("pixel2api29") { /* ... */ }
      create("nexus9api30") { /* ... */ }
    }
    groups {
      create("phoneAndTablet") {
        targetDevices.add(devices["pixel2api29"])
        targetDevices.add(devices["nexus9api30"])
      }
    }
  }
}
```
→ `./gradlew phoneAndTabletGroupDebugAndroidTest`

**ATD (Automated Test Devices)** strip Google apps, Settings, SystemUI and AOSP apps to cut CPU/memory. `systemImageSource = "aosp-atd"` or `"google-atd"`. Documented constraint: **ATDs currently support only API level 30**, and **screenshot tests depending on hardware rendering aren't supported**.

Sharding, in `gradle.properties`:

```properties
android.experimental.androidTest.numManagedDeviceShards=4
```

**Fem-ho's Android test plan:**

- **JVM unit tests** (`test/`) for the sync reconciliation state machine, the quick-add parser port, and the Room DAO queries via Robolectric-free in-memory Room.
- **Instrumented** (`androidTest/`) with Compose testing for three journeys: login-with-server-URL, kanban drag, offline→online reconciliation.
- The **offline reconciliation test** is the crown jewel and must exist:

```kotlin
@Test fun offlineEditsReconcileWithoutDuplicates() = runTest {
    server.enqueueOfflineMode()                 // MockWebServer returns connection errors
    repo.createTask(title = "Sense xarxa", scope = "familia")
    repo.moveTask(existingId, Column.DOING)
    assertThat(repo.pendingOps()).hasSize(2)

    server.enqueueOnlineMode()
    syncEngine.syncNow()

    assertThat(repo.pendingOps()).isEmpty()
    val remote = server.tasksFor("familia")
    assertThat(remote.count { it.title == "Sense xarxa" }).isEqualTo(1)   // no duplicate
    assertThat(remote.first { it.id == existingId }.column).isEqualTo("doing")
}
```

- CI uses `aosp-atd` at API 30 for speed, plus one `google` image at the current target SDK for a nightly job.

`UNVERIFIED`: whether newer AGP versions have lifted the "ATD only at API 30" restriction — the doc page I read states it as current. Confirm against the AGP release notes for the version you pin.

### 11.9 What Fem-ho should do

- One command per layer, all listed in `AGENTS.md`, all runnable by the agent without arguments.
- Fixtures shared between unit and E2E. Never duplicate expected values.
- Contract validation *inside* the E2E run via Prism proxy — free, catches drift the type-checker can't.
- CalDAV: Tier 1 always, Tier 2 nightly, Tier 3 per release, documented in `docs/CALDAV.md`.
- MCP: `scripts/test-mcp.sh` compares `tools/list` against the committed manifest — the manifest is the contract.
- Android: Gradle Managed Devices so CI needs no emulator setup.

---

## 12. CI: GitHub Actions for a 3-target monorepo

### 12.1 Verified action versions (as fetched, Aug 2026)

| Action | Version seen in official docs |
| --- | --- |
| `actions/checkout` | `@v6` |
| `actions/setup-java` | `@v5` |
| `gradle/actions/setup-gradle` | `@v6` — "This replaces the previous `gradle/gradle-build-action`, which now delegates to this implementation." |
| `dorny/paths-filter` | `@v4` (Node 24) |
| `docker/login-action` | `@v4` |
| `docker/setup-qemu-action` | `@v4` |
| `docker/setup-buildx-action` | `@v4` |
| `docker/build-push-action` | `@v7` |
| `docker/metadata-action` | `@v6` |

`UNVERIFIED`: `actions/setup-node` and `pnpm/action-setup` versions — I did not fetch those pages. Verify before pinning; the shapes below use `@v4`/`@v4` as placeholders and are marked.

### 12.2 Change detection

Verified `dorny/paths-filter` usage:

```yaml
- uses: dorny/paths-filter@v4
  id: filter
  with:
    filters: |
      backend:
        - 'backend/**'
      frontend:
        - 'frontend/**'
    base: 'develop'
    list-files: 'shell'
```

Outputs: `steps.filter.outputs.<name>` → `'true'`/`'false'`; `steps.filter.outputs.changes` → "JSON array with names of all filters matching any of the changed files"; `steps.filter.outputs.<name>_files` → matched paths (format per `list-files`: `'none' | 'csv' | 'json' | 'shell' | 'escape'`). Feed `changes` into a matrix:

```yaml
strategy:
  matrix:
    package: ${{ fromJSON(needs.changes.outputs.packages) }}
```

Documented gotcha: **the paths filter doesn't work on the default branch's first push.** Guard with `if: github.event_name == 'pull_request'` or fall back to "run everything" when the filter output is empty.

### 12.3 The main workflow

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  changes:
    runs-on: ubuntu-latest
    outputs:
      contracts: ${{ steps.filter.outputs.contracts }}
      server:    ${{ steps.filter.outputs.server }}
      web:       ${{ steps.filter.outputs.web }}
      android:   ${{ steps.filter.outputs.android }}
      ds:        ${{ steps.filter.outputs.ds }}
      any:       ${{ steps.filter.outputs.changes }}
    steps:
      - uses: actions/checkout@v6
      - uses: dorny/paths-filter@v4
        id: filter
        with:
          filters: |
            contracts:
              - 'packages/contracts/**'
            ds:
              - 'packages/design-system/**'
              - 'packages/design-tokens/**'
            server:
              - 'apps/server/**'
              - 'packages/domain/**'
              - 'packages/quickadd/**'
              - 'packages/contracts/**'
            web:
              - 'apps/web/**'
              - 'packages/api-client/**'
              - 'packages/design-system/**'
              - 'packages/quickadd/**'
              - 'packages/contracts/**'
            android:
              - 'apps/android/**'
              - 'packages/contracts/**'
              - 'packages/design-tokens/**'

  # ---------------------------------------------------------------- JS/TS
  js:
    needs: changes
    if: needs.changes.outputs.server == 'true' || needs.changes.outputs.web == 'true' || needs.changes.outputs.contracts == 'true' || needs.changes.outputs.ds == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }          # Turbo needs history for --filter=...[HEAD^1]
      - uses: pnpm/action-setup@v4         # UNVERIFIED version
      - uses: actions/setup-node@v4        # UNVERIFIED version
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Turbo cache
        uses: actions/cache@v4             # UNVERIFIED version
        with:
          path: .turbo/cache
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-
      - run: pnpm turbo run codegen
      - name: Fail on generated drift
        run: git diff --exit-code -- ':!pnpm-lock.yaml'
      - run: pnpm turbo run lint typecheck build
      - run: pnpm turbo run test          # Testcontainers: Docker is present on ubuntu runners

  # ---------------------------------------------------------------- Contract
  contract:
    needs: [changes, js]
    if: needs.changes.outputs.contracts == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec redocly lint packages/contracts/openapi.yaml --extends recommended-strict
      - run: pnpm exec redocly bundle packages/contracts/openapi.yaml -o /tmp/openapi.yaml
      - run: pnpm exec openapi-typescript /tmp/openapi.yaml -o packages/api-client/src/generated/schema.d.ts --check
      - name: Breaking-change check vs main
        run: |
          git fetch origin main --depth=1
          git show origin/main:packages/contracts/openapi.yaml > /tmp/base.yaml || exit 0
          npx -y oasdiff breaking /tmp/base.yaml packages/contracts/openapi.yaml || true
        # UNVERIFIED: `oasdiff` invocation/flags not confirmed from a primary source.

  # ---------------------------------------------------------------- E2E
  e2e:
    needs: [changes, js]
    if: needs.changes.outputs.web == 'true' || needs.changes.outputs.server == 'true'
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: femho_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm db:migrate && pnpm db:seed
        env: { DATABASE_URL: postgres://postgres:postgres@localhost:5432/femho_test }
      - run: pnpm build
      - name: Start Prism validation proxy
        run: |
          pnpm exec redocly bundle packages/contracts/openapi.yaml -o /tmp/openapi.yaml
          npx -y @stoplight/prism-cli proxy /tmp/openapi.yaml http://localhost:3000 --errors -p 4010 &
          npx -y wait-on http://localhost:4010
        # UNVERIFIED: exact npm package name `@stoplight/prism-cli` not confirmed on the page fetched.
      - run: pnpm test:e2e -- --shard=${{ matrix.shard }}/4
        env: { DATABASE_URL: postgres://postgres:postgres@localhost:5432/femho_test }
      - uses: actions/upload-artifact@v4    # UNVERIFIED version
        if: failure()
        with:
          name: playwright-report-${{ matrix.shard }}
          path: e2e/playwright-report/
          retention-days: 7

  # ---------------------------------------------------------------- Android
  android:
    needs: changes
    if: needs.changes.outputs.android == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: 21
      - uses: gradle/actions/setup-gradle@v6
        with:
          cache-read-only: ${{ github.ref != 'refs/heads/main' }}
      - name: Generate design tokens for Android
        run: |
          corepack enable
          pnpm install --frozen-lockfile --filter @fem-ho/design-tokens...
          pnpm --filter @fem-ho/design-tokens build
      - name: Enable KVM for the emulator
        run: |
          echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' \
            | sudo tee /etc/udev/rules.d/99-kvm4all.rules
          sudo udevadm control --reload-rules && sudo udevadm trigger --name-match=kvm
      - name: Unit tests + lint
        working-directory: apps/android
        run: ./gradlew testDebugUnitTest lintDebug
      - name: Instrumented tests on a managed device
        working-directory: apps/android
        run: ./gradlew pixel6api34DebugAndroidTest
        env:
          GRADLE_OPTS: -Dorg.gradle.jvmargs=-Xmx4g
      - name: Assemble debug APK
        working-directory: apps/android
        run: ./gradlew assembleDebug
      - uses: actions/upload-artifact@v4
        with:
          name: femho-debug-apk
          path: apps/android/app/build/outputs/apk/debug/*.apk
```

Notes the agent must not miss:

- **`git diff --exit-code` after `codegen`** is the single most valuable line in this file. It makes "I forgot to regenerate" impossible.
- `gradle/actions/setup-gradle@v6` with `cache-read-only` on non-default branches is the documented pattern: PRs read the cache, `main` writes it.
- Playwright sharding via `--shard=i/n` plus `fail-fast: false` keeps E2E under ~5 minutes.
- The KVM udev rule is required for hardware-accelerated emulators on GitHub-hosted runners. `UNVERIFIED`: whether current `ubuntu-latest` images still need it — check the runner image notes.

### 12.4 Release workflow (Docker image + APK)

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write
  packages: write

jobs:
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6

      - name: Docker meta
        id: meta
        uses: docker/metadata-action@v6
        with:
          images: |
            ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha

      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/setup-qemu-action@v4
      - uses: docker/setup-buildx-action@v4

      - name: Build and push
        uses: docker/build-push-action@v7
        with:
          context: .
          file: infra/docker/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          annotations: ${{ steps.meta.outputs.annotations }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  apk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-java@v5
        with: { distribution: temurin, java-version: 21 }
      - uses: gradle/actions/setup-gradle@v6

      - name: Decode keystore
        run: |
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 --decode > /tmp/release.jks
      - name: Assemble signed release
        working-directory: apps/android
        run: ./gradlew assembleRelease bundleRelease
        env:
          FEMHO_KEYSTORE_PATH: /tmp/release.jks
          FEMHO_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          FEMHO_KEY_ALIAS: ${{ secrets.ANDROID_KEY_ALIAS }}
          FEMHO_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
      - run: rm -f /tmp/release.jks
        if: always()

      - uses: softprops/action-gh-release@v2      # UNVERIFIED version
        with:
          files: |
            apps/android/app/build/outputs/apk/release/*.apk
            apps/android/app/build/outputs/bundle/release/*.aab
```

Signing pattern (documented practice): **encode the keystore as Base64 into a secret, decode at runtime, pass credentials as env vars to `assembleRelease`.** Read them in `apps/android/app/build.gradle.kts`:

```kotlin
signingConfigs {
    create("release") {
        val ksPath = System.getenv("FEMHO_KEYSTORE_PATH")
        if (ksPath != null) {
            storeFile = file(ksPath)
            storePassword = System.getenv("FEMHO_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("FEMHO_KEY_ALIAS")
            keyPassword = System.getenv("FEMHO_KEY_PASSWORD")
        }
    }
}
```

Always `rm` the decoded keystore with `if: always()`.

### 12.5 Nightly workflow

`.github/workflows/nightly.yml` — schedule `cron: "0 3 * * *"`:
- Heavy Schemathesis run (large example budget).
- CalDAVTester subset against a seeded server.
- Android instrumented tests on a `google` (non-ATD) image at the target SDK.
- `docker compose up` smoke test of the published image + Playwright `--project=smoke`.
- Dependency audit.

### 12.6 What Fem-ho should do

- One `ci.yml` with `changes` + 4 dependent jobs; one `release.yml`; one `nightly.yml`. No more.
- `concurrency: cancel-in-progress: true` on `ci.yml`, **not** on `release.yml`.
- `permissions:` least-privilege at workflow level, elevated per job.
- Pin every action to a major tag now; move to SHA pinning before the repo goes public.
- Make `git diff --exit-code` after codegen a required status check.

---

## 13. Keeping the Plou design system from drifting

### 13.1 The architecture: tokens are generated, components are not

Split Plou into **two packages**:

```
packages/design-tokens/     ← the source of truth for VALUES
├── tokens/
│   ├── core/{color,space,radius,typography,shadow}.json   (DTCG format)
│   ├── theme/{light,dark}.json
│   ├── accent/{a,b,c,d}.json          # the 4 accent variants
│   └── gradient/{tasks,calendar,settings,share}.json      # one brand gradient per view
├── config.json                        # Style Dictionary config
└── build/                             # generated, gitignored
    ├── css/plou-tokens.css            → consumed by apps/web
    ├── ts/plou-tokens.ts              → typed token names for TS
    ├── android/res/values/*.xml       → consumed by apps/android
    └── android/kotlin/PlouTokens.kt   → Compose object

packages/design-system/     ← the source of truth for BEHAVIOUR (web only)
├── src/components/{Button,Chip,Card,Column,Dialog,Sheet,Toast,...}.tsx
├── src/index.ts
└── stories/                           # Storybook, doubles as visual reference
```

**Rule: components are NOT shared with Android.** Compose is a different rendering model; a "translated" React component is a lie that rots. What *is* shared is the token layer plus a written contract in `docs/DESIGN.md` for each component's anatomy, states and measurements. Android implements those in Compose against `PlouTokens`.

### 13.2 Style Dictionary — verified facts

- Current major is **v5**. It "reads DTCG (or its own legacy format), resolves aliases, and emits CSS, SCSS, JS/TS, iOS, Android, and custom formats."
- Style Dictionary v5 uses the **DTCG 2025.10** spec version.
- **DTCG token shape:** each token is an object with `$value`, `$type`, optional `$description` and `$extensions`; groups nest tokens; aliases reference other tokens as `"{color.brand.500}"`.
- Built-in transform groups include: `css`, `scss`, `js`, `android`, `compose`, `ios-swift`.
- Config schema: `source: string[]` (globs), `platforms: Record<string, Platform>`, `tokens` (inline), `expand`, `hooks`. Platform: `transformGroup`, `transforms`, `buildPath` (**trailing slash required**), `files`, `prefix`, `actions`. File: `destination`, `format`, `filter`, `options` (incl. `showFileHeader`, `outputReferences`).

Verified relevant formats:

| format | description (verbatim) | options |
| --- | --- | --- |
| `css/variables` | "Creates a CSS file with variable definitions based on the style dictionary" | `showFileHeader`, `outputReferences`, `outputReferenceFallbacks`, `selector`, `sort`, `formatting` |
| `scss/variables` | "Creates a SCSS file with variable definitions based on the style dictionary" | + `themeable` |
| `javascript/es6` | "Creates a ES6 module of the style dictionary" | — |
| `typescript/es6-declarations` | TS declarations for ES6 modules | `outputStringLiterals` |
| `json/nested` | "Creates a JSON nested file of the style dictionary" | — |
| `android/resources` | "Creates a resource xml file. It is recommended to use a filter with this format" | `showFileHeader`, `outputReferences` |
| `android/colors` | color resource xml with all colors | |
| `android/dimens` | dimen resource xml with all sizes | |
| `compose/object` | "Creates a Kotlin file for Compose containing an object with a `val` for each property" | `import`, `showFileHeader`, `outputReferences`, `className`, `packageName`, `accessControl`, `objectType` |

Example outputs (verbatim from docs):

```css
:root {
  --color-background-base: #f0f0f0;
  --color-background-alt: #eeeeee;
}
```

```kotlin
package com.example.tokens;

import androidx.compose.ui.graphics.Color

object StyleDictionary {
  val colorBaseRed5 = Color(0xFFFAF3F2)
}
```

Config skeleton (verbatim structure from docs, adapted):

```json
{
  "source": ["tokens/**/*.json"],
  "platforms": {
    "css": {
      "transformGroup": "css",
      "prefix": "plou",
      "buildPath": "build/css/",
      "files": [
        { "destination": "plou-tokens.css", "format": "css/variables",
          "options": { "outputReferences": true, "selector": ":root" } },
        { "destination": "plou-dark.css", "format": "css/variables",
          "filter": { "$extensions": { "cat.femho": { "theme": "dark" } } },
          "options": { "selector": "[data-theme='dark']" } }
      ]
    },
    "ts": {
      "transformGroup": "js",
      "buildPath": "build/ts/",
      "files": [
        { "destination": "plou-tokens.ts", "format": "javascript/es6" },
        { "destination": "plou-tokens.d.ts", "format": "typescript/es6-declarations" }
      ]
    },
    "android": {
      "transformGroup": "android",
      "prefix": "plou",
      "buildPath": "build/android/res/values/",
      "files": [
        { "destination": "colors.xml", "format": "android/colors",
          "filter": { "$type": "color" } },
        { "destination": "dimens.xml", "format": "android/dimens",
          "filter": { "$type": "dimension" } }
      ]
    },
    "compose": {
      "transformGroup": "compose",
      "buildPath": "build/android/kotlin/",
      "files": [
        { "destination": "PlouTokens.kt", "format": "compose/object",
          "options": { "className": "PlouTokens", "packageName": "cat.femho.designsystem",
                       "outputReferences": true } }
      ]
    }
  }
}
```

A DTCG token file for Plou:

```json
{
  "color": {
    "$type": "color",
    "brand": {
      "500": { "$value": "#3B6FE0", "$description": "Plou primary" },
      "600": { "$value": "#2E58B8" }
    },
    "surface": {
      "base":  { "$value": "{color.neutral.0}" },
      "raised":{ "$value": "{color.neutral.50}" }
    }
  },
  "radius": {
    "$type": "dimension",
    "pill": { "$value": "999px", "$description": "Plou pill shape — chips, buttons" },
    "card": { "$value": "16px" }
  },
  "shadow": {
    "$type": "shadow",
    "soft": { "$value": { "offsetX": "0", "offsetY": "2px", "blur": "8px", "spread": "0", "color": "#0000001f" } }
  }
}
```

`UNVERIFIED`: the exact `filter` object syntax for matching `$extensions` sub-keys in Style Dictionary v5 (the docs confirm `filter` accepts `string | function | Object` but I did not verify deep-object matching semantics). Use a filter **function** in a JS config if the object form fails.

### 13.3 Six mechanisms that stop drift

1. **Generated, never committed.** `packages/design-tokens/build/` is gitignored; `pnpm --filter @fem-ho/design-tokens build` runs in `codegen`, which is a Turbo dependency of every `build`. CI does `git diff --exit-code` after codegen.
2. **No raw values, enforced by lint.** Stylelint rules on `apps/web` and `packages/design-system`:
   ```json
   {
     "rules": {
       "color-no-hex": true,
       "declaration-property-value-disallowed-list": {
         "/^(border-)?radius$/": ["/^\\d/"],
         "box-shadow": ["/^(?!var\\(--plou-shadow)/"],
         "font-family": ["/^(?!var\\(--plou-font)/"]
       }
     }
   }
   ```
   Android side: a Gradle `check` task that greps `app/src/**/*.kt` for `Color(0x` and `\.dp` literals outside `:core-designsystem` and fails.
3. **A token-parity test.** A Vitest test in `packages/design-tokens` that loads `build/css/plou-tokens.css` and `build/android/kotlin/PlouTokens.kt`, extracts the token names from each, normalises casing, and asserts the sets are identical. Any token that fails to cross the boundary is a build failure, not a visual surprise found three months later.
   ```ts
   it('every token exists on both web and Android', () => {
     const css = new Set([...readFileSync(CSS,'utf8').matchAll(/--plou-([a-z0-9-]+):/g)]
       .map(m => m[1].replace(/-/g, '')));
     const kt  = new Set([...readFileSync(KT,'utf8').matchAll(/val\s+plou([A-Za-z0-9]+)\s*=/g)]
       .map(m => m[1].toLowerCase()));
     expect([...css].filter(t => !kt.has(t))).toEqual([]);
     expect([...kt].filter(t => !css.has(t))).toEqual([]);
   });
   ```
4. **`docs/DESIGN.md` is a contract, not a gallery.** For each component: anatomy (named parts), all states (`default | hover | focus-visible | active | disabled | loading | error`), the exact tokens each part uses, min tap target (48dp), and the Catalan label conventions. Android implements against that document; the doc is what the two platforms agree on.
5. **Storybook as the web reference + visual regression.** Add a Playwright visual-comparison project over Storybook stories (`toHaveScreenshot`) so a token change that silently alters a component is caught. Run on `ubuntu-latest` only, so baselines are stable.
6. **An ADR gate on new tokens.** Adding a token requires an entry in `docs/decisions/`. This sounds bureaucratic; in practice it stops the agent inventing `--plou-color-blue-ish` at 2am.

### 13.4 The gradient-per-view rule, specified

Fem-ho has "one brand gradient per view". Specify it as tokens, not as CSS in components:

```json
{
  "gradient": {
    "$type": "gradient",
    "tasks":    { "$value": [ { "color": "{color.brand.400}", "position": 0 },
                              { "color": "{color.brand.600}", "position": 1 } ] },
    "calendar": { "$value": [ { "color": "{color.accent.teal.400}", "position": 0 },
                              { "color": "{color.accent.teal.600}", "position": 1 } ] }
  }
}
```

and a rule in `docs/DESIGN.md`: *"A view sets `--plou-gradient-current` once, on its root element. No component may reference a named gradient directly."* That single rule is what makes adding a fifth view a one-line change rather than a hunt.

### 13.5 What Fem-ho should do

- Two packages: `design-tokens` (generated, cross-platform) and `design-system` (React only).
- Style Dictionary v5, DTCG format, `css`+`ts`+`android`+`compose` platforms.
- Token-parity test in CI. Stylelint/Gradle lint bans on raw values.
- `docs/DESIGN.md` as the cross-platform component contract.
- Storybook + visual regression on the web; manual screenshot parity check per release for Android.

---

## 14. The exact recommended repository tree

```
fem-ho/
├── AGENTS.md                          # agent operating instructions (portable)
├── CLAUDE.md                          # 5 lines: @AGENTS.md + Claude-specific notes
├── README.md
├── LICENSE
├── .gitignore
├── .editorconfig
├── .nvmrc
├── package.json                       # root scripts + packageManager pin
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc
├── .stylelintrc.json
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                     # changes → js → contract → e2e → android
│   │   ├── release.yml                # GHCR multi-arch image + signed APK/AAB
│   │   ├── nightly.yml                # heavy schemathesis, caldavtester, compose smoke
│   │   └── codeql.yml
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── .claude/
│   ├── settings.json                  # hooks (Stop → lint+typecheck+test), permissions
│   ├── rules/
│   │   ├── contracts.md               # paths: packages/contracts/**
│   │   ├── caldav.md                  # paths: apps/server/src/caldav/**
│   │   ├── mcp.md                     # paths: apps/server/src/mcp/**
│   │   ├── web-components.md          # paths: apps/web/**, packages/design-system/**
│   │   ├── android.md                 # paths: apps/android/**
│   │   └── testing.md                 # paths: **/*.test.ts, e2e/**
│   ├── skills/
│   │   ├── milestone/SKILL.md         # the per-milestone ritual (§10.2)
│   │   ├── spec-clarify/SKILL.md      # list ambiguities before implementing
│   │   ├── add-endpoint/SKILL.md      # contract → codegen → handler → test → docs
│   │   └── add-migration/SKILL.md     # migration + up/down test + data-preserving test
│   └── agents/
│       └── spec-reviewer.md           # adversarial diff-vs-requirements reviewer
│
├── apps/
│   ├── server/
│   │   ├── AGENTS.md
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts              # env parsing, fail-fast
│   │   │   ├── http/                  # router, middleware, error envelope
│   │   │   ├── auth/                  # password hashing, sessions, tokens
│   │   │   ├── modules/               # scopes, projects, tasks, checklists, shares, audit
│   │   │   ├── caldav/                # PROPFIND/REPORT/PUT/DELETE, VTODO mapping
│   │   │   ├── mcp/                   # MCP server over the domain layer
│   │   │   ├── db/                    # client, repositories, migrate.ts
│   │   │   └── jobs/                  # expiry sweeps, audit compaction
│   │   ├── migrations/                # NNNN_name.up.sql / .down.sql — APPEND ONLY
│   │   ├── seeds/
│   │   └── test/
│   │       ├── integration/
│   │       ├── migrations.test.ts
│   │       └── caldav/roundtrip.test.ts
│   │
│   ├── web/
│   │   ├── AGENTS.md
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── app/                   # routing, providers, layout (top bar)
│   │       ├── features/
│   │       │   ├── tasks/             # 4-column kanban
│   │       │   ├── calendar/          # month/week/day + shared Inbox column
│   │       │   ├── quickadd/          # the "+" flow
│   │       │   ├── scopes/            # chips + project dropdown
│   │       │   ├── checklists/
│   │       │   ├── shares/            # public renderer
│   │       │   ├── settings/          # profile, tokens, CalDAV, AI mode
│   │       │   └── audit/
│   │       ├── i18n/ca.json           # ALL Catalan strings
│   │       └── styles/
│   │
│   └── android/
│       ├── AGENTS.md
│       ├── settings.gradle.kts
│       ├── build.gradle.kts
│       ├── gradle.properties
│       ├── gradle/libs.versions.toml
│       ├── gradlew, gradlew.bat, gradle/wrapper/
│       ├── app/                       # Compose UI, DI, MainActivity, strings.xml (ca)
│       ├── core-data/                 # Room, sync engine, repositories, conflict rules
│       ├── core-network/              # generated OpenAPI client (build/, gitignored)
│       └── core-designsystem/         # PlouTokens.kt + Compose theme + components
│
├── packages/
│   ├── contracts/                     # ← SINGLE SOURCE OF TRUTH
│   │   ├── AGENTS.md
│   │   ├── openapi.yaml
│   │   ├── paths/*.yaml
│   │   ├── components/{schemas,responses,parameters}/*.yaml
│   │   ├── redocly.yaml
│   │   ├── mcp-tools.json             # MCP tool manifest (name, description, schema)
│   │   ├── caldav-mapping.md          # Task ↔ VTODO property table
│   │   ├── quickadd.grammar.md        # the parser grammar + worked examples
│   │   └── dist/                      # bundled output, gitignored
│   │
│   ├── domain/                        # pure TS domain logic, ZERO I/O
│   │   └── src/{task,scope,share,permissions,ordering}.ts
│   │
│   ├── quickadd/                      # the parser, shared by web + server
│   │   └── src/__tests__/fixtures/cases.json   # spec table == test fixture
│   │
│   ├── api-client/                    # generated TS client + thin helpers
│   │   └── src/generated/             # gitignored
│   │
│   ├── design-tokens/                 # DTCG tokens → css/ts/android/compose
│   │   ├── tokens/
│   │   ├── config.json
│   │   └── build/                     # gitignored
│   │
│   ├── design-system/                 # Plou React components + Storybook
│   │   ├── AGENTS.md
│   │   ├── src/components/
│   │   └── stories/
│   │
│   └── config/                        # shared eslint/tsconfig/vitest presets
│
├── e2e/
│   ├── AGENTS.md
│   ├── playwright.config.ts
│   ├── helpers/{drag.ts,fixtures.ts,auth.ts}
│   └── tests/
│       ├── auth.spec.ts
│       ├── kanban.spec.ts
│       ├── calendar.spec.ts
│       ├── quickadd.spec.ts
│       ├── scopes.spec.ts
│       ├── checklists.spec.ts
│       ├── settings.spec.ts
│       ├── shares.spec.ts
│       └── smoke.spec.ts
│
├── infra/
│   ├── docker/
│   │   ├── Dockerfile                 # multi-stage: build web + server → one image
│   │   └── entrypoint.sh              # migrate, then serve
│   ├── compose/
│   │   ├── docker-compose.yml         # server + postgres (the shipped artifact)
│   │   └── docker-compose.dev.yml     # + prism proxy, + mailpit if ever needed
│   ├── caldavtester/
│   │   ├── serverinfo-femho.xml
│   │   └── scripts/
│   └── prism/
│
├── scripts/
│   ├── test-mcp.sh                    # MCP Inspector CLI suite (§11.7)
│   ├── test-caldav.sh                 # CalDAVTester driver
│   ├── check-token-parity.mjs
│   ├── seed.ts
│   └── backup.sh / restore.sh
│
└── docs/
    ├── README.md                      # index of the docs set
    ├── ARCHITECTURE.md
    ├── DATA-MODEL.md
    ├── API.md
    ├── CALDAV.md
    ├── MCP.md
    ├── AUTH.md
    ├── SHARING.md
    ├── AI-MODE.md
    ├── ANDROID.md
    ├── DESIGN.md
    ├── I18N.md
    ├── DEPLOY.md
    ├── OPERATIONS.md
    ├── SECURITY.md
    ├── TESTING.md
    ├── CONTRIBUTING.md
    ├── ROADMAP.md
    ├── CHANGELOG.md
    ├── GLOSSARY.md
    ├── decisions/
    │   ├── README.md
    │   ├── adr-template.md            # MADR 4.0.0
    │   ├── 0001-use-madr.md
    │   ├── 0002-monorepo-pnpm-turborepo.md
    │   ├── 0003-openapi-31-contract-first.md
    │   ├── 0004-postgres-and-migration-strategy.md
    │   ├── 0005-fractional-ordering-for-kanban.md
    │   ├── 0006-caldav-vtodo-mapping.md
    │   ├── 0007-token-model-human-vs-ai.md
    │   ├── 0008-offline-first-sync-and-conflicts.md
    │   ├── 0009-design-tokens-via-style-dictionary.md
    │   └── 0010-catalan-as-source-language.md
    └── specs/
        ├── 00-anti-goals.md
        ├── 01-auth/{requirements,design,tasks}.md
        ├── 02-data-model/{requirements,design,tasks}.md
        ├── 03-kanban/{requirements,design,tasks}.md
        ├── 04-scopes-projects/{requirements,design,tasks}.md
        ├── 05-calendar/{requirements,design,tasks}.md
        ├── 06-quick-add/{requirements,design,tasks}.md
        ├── 07-checklists-settings/{requirements,design,tasks}.md
        ├── 08-caldav/{requirements,design,tasks}.md
        ├── 09-api-tokens/{requirements,design,tasks}.md
        ├── 10-mcp/{requirements,design,tasks}.md
        ├── 11-share-links/{requirements,design,tasks}.md
        ├── 12-ai-mode-audit/{requirements,design,tasks}.md
        ├── 13-android/{requirements,design,tasks}.md
        └── 14-release/{requirements,design,tasks}.md
```

### 14.1 ADR format — use MADR 4.0.0

Verified: current version is **MADR 4.0.0** (released 2024-09-17). File naming `NNNN-title-with-dashes.md` (`NNNN` supports up to 9,999 ADRs). Optional YAML frontmatter fields: `parent`, `nav_order`, `title`, `status`, `date`, `decision-makers`, `consulted`, `informed`. Section headings, verbatim order:

1. Context and Problem Statement
2. Decision Drivers *(optional)*
3. Considered Options
4. Decision Outcome
5. Consequences *(optional)*
6. Confirmation *(optional)*
7. Pros and Cons of the Options *(optional)*
8. More Information *(optional)*

Pros/cons are evaluated with "Good", "Bad", or "Neutral" arguments. MADR ships four template variants: `adr-template.md` (all sections + explanations), `adr-template-minimal.md`, `adr-template-bare.md`, `adr-template-bare-minimal.md`.

Copy `adr-template-bare.md` into `docs/decisions/adr-template.md` and require **Confirmation** to be filled in — that section is where the agent states *how the decision is enforced* (a lint rule, a CI check, a boundary rule), which turns an ADR from prose into a gate.

---

## 15. The exact documentation file list

One line each, as required.

### Root

| File | Purpose |
| --- | --- |
| `README.md` | What Fem-ho is, a screenshot, the 3-command quickstart, and links into `docs/`. |
| `AGENTS.md` | The operating manual for any coding agent: commands, hard rules, definition of done, layout. |
| `CLAUDE.md` | Five lines: `@AGENTS.md` plus Claude-Code-specific notes (plan mode zones, `--filter` preference). |
| `LICENSE` | The licence. |

### `docs/`

| File | Purpose |
| --- | --- |
| `docs/README.md` | Index of the documentation set with one line per document — the map the agent reads first. |
| `docs/ARCHITECTURE.md` | Runtime topology, package boundaries, request lifecycle, and why each boundary exists. |
| `docs/DATA-MODEL.md` | Every table, column, type, index, constraint, and the invariants the DB enforces vs. the app enforces. |
| `docs/API.md` | How to consume the REST API: auth, pagination, filtering, the error envelope, versioning policy, rate limits. |
| `docs/CALDAV.md` | The Task↔VTODO property map, collection URL layout, sync-token semantics, and the manual client interop checklist. |
| `docs/MCP.md` | The MCP tool catalogue with schemas, auth model, safety limits, and how to run the Inspector against it. |
| `docs/AUTH.md` | Password policy, session vs bearer tokens, token scoping (human vs AI audience), revocation, and threat notes. |
| `docs/SHARING.md` | Public share-link semantics: targets, expiry, password gate, required guest name, and what a guest can and cannot do. |
| `docs/AI-MODE.md` | The three assignment modes, what the "AI user" is, what the app does and explicitly never does, and the audit contract. |
| `docs/ANDROID.md` | Build, offline-first sync design, conflict resolution rules, server-URL pairing, and release/signing. |
| `docs/DESIGN.md` | Plou usage contract: tokens, themes, the 4 accents, gradient-per-view rule, and every component's anatomy and states. |
| `docs/I18N.md` | Catalan as the source language, string-key conventions, plural/gender rules, date/number formatting. |
| `docs/DEPLOY.md` | Self-hosting: docker-compose, every env var, reverse proxy and TLS, first-run admin creation, upgrade path. |
| `docs/OPERATIONS.md` | Backup/restore, log format, health endpoints, common failure modes and their fixes. |
| `docs/SECURITY.md` | Threat model, secret handling, dependency policy, and how to report a vulnerability. |
| `docs/TESTING.md` | Every test layer, the exact command for each, how to add a test of each kind, and the flake policy. |
| `docs/CONTRIBUTING.md` | Branching, commit format, PR checklist, how to run everything locally, and the code-review bar. |
| `docs/ROADMAP.md` | The 14 milestones with current status — the agent's "where am I" file. |
| `docs/CHANGELOG.md` | Keep-a-Changelog format, one entry per release, human-readable. |
| `docs/GLOSSARY.md` | Catalan↔English domain terms (àmbit/scope, Per fer/To do, Fent/Doing, Fet/Done) — prevents the agent inventing synonyms. |
| `docs/decisions/README.md` | What an ADR is here, when one is required, and the index of all ADRs. |
| `docs/decisions/adr-template.md` | The MADR 4.0.0 bare template to copy for each new decision. |
| `docs/decisions/NNNN-*.md` | One irreversible-or-expensive decision each, with a filled-in **Confirmation** section naming the check that enforces it. |
| `docs/specs/00-anti-goals.md` | The explicit list of things Fem-ho will not do — read before every feature. |
| `docs/specs/NN-feature/requirements.md` | User stories + numbered EARS acceptance criteria, each naming the test that proves it. |
| `docs/specs/NN-feature/design.md` | Technical design: state machines as tables, sequence diagrams, data flow, chosen structures. |
| `docs/specs/NN-feature/tasks.md` | The ordered, checkable implementation task list for that milestone. |

### Per-package `AGENTS.md`

| File | Purpose |
| --- | --- |
| `packages/contracts/AGENTS.md` | OAS 3.1 house rules, file splitting, `operationId` naming, regeneration commands. |
| `apps/server/AGENTS.md` | Layering, error envelope, transactions, auth middleware, where CalDAV/MCP hook in. |
| `apps/web/AGENTS.md` | Component conventions, Plou token usage, query keys, Catalan i18n, no raw `fetch`. |
| `apps/android/AGENTS.md` | JDK, Gradle commands, module boundaries, offline-first invariants, generated-code location. |
| `packages/design-system/AGENTS.md` | Token authoring rules, adding a component, why Android is generated not ported. |
| `e2e/AGENTS.md` | Selector policy, fixtures, running one spec, sharding, flake policy. |

---

## 16. Sources

Primary sources actually fetched on 2026-08-05:

- AGENTS.md convention — https://agents.md/
- GitHub Spec Kit — https://github.com/github/spec-kit
- Claude Code memory (CLAUDE.md, imports, `.claude/rules/`, AGENTS.md bridging) — https://code.claude.com/docs/en/memory
- Claude Code best practices (verification loops, explore/plan/code/commit, CLAUDE.md guidance, adversarial review) — https://code.claude.com/docs/en/best-practices
- OpenAPI Specification v3.1.1 — https://spec.openapis.org/oas/v3.1.1.html
- openapi-typescript — https://openapi-ts.dev/
- openapi-typescript CLI flags — https://openapi-ts.dev/cli
- openapi-fetch — https://openapi-ts.dev/openapi-fetch/
- OpenAPI Generator, Kotlin generator config options — https://github.com/OpenAPITools/openapi-generator/blob/master/docs/generators/kotlin.md
- OpenAPI Generator Gradle plugin README — https://github.com/OpenAPITools/openapi-generator/blob/master/modules/openapi-generator-gradle-plugin/README.adoc
- Turborepo configuration reference — https://turborepo.dev/docs/reference/configuration
- pnpm workspaces — https://pnpm.io/workspaces
- MCP Inspector overview — https://modelcontextprotocol.io/legacy/tools/inspector
- MCP Inspector CLI client (methods, exit codes, CI recipes) — https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli
- Playwright — actions/drag-and-drop — https://playwright.dev/docs/input
- Playwright — test configuration — https://playwright.dev/docs/test-configuration
- CalDAVTester — https://www.calendarserver.org/CalDAVTester.html
- ccs-caldavtester repository — https://github.com/apple/ccs-caldavtester
- litmus WebDAV test suite — http://www.webdav.org/neon/litmus/
- Stoplight Prism validation proxy guide — https://github.com/stoplightio/prism/blob/master/docs/guides/03-validation-proxy.md
- Schemathesis — https://schemathesis.io/ and https://schemathesis.readthedocs.io/en/stable/
- Redocly CLI configuration & rules — https://redocly.com/docs/cli/configuration
- MADR (Markdown ADRs) — https://adr.github.io/madr/ and https://github.com/adr/madr
- Style Dictionary — configuration — https://styledictionary.com/reference/config/
- Style Dictionary — predefined formats — https://styledictionary.com/reference/hooks/formats/predefined/
- Style Dictionary — DTCG support — https://styledictionary.com/info/dtcg/
- Gradle setup-gradle action — https://github.com/gradle/actions/blob/main/setup-gradle/README.md
- Android build-managed (Gradle Managed) devices — https://developer.android.com/studio/test/gradle-managed-devices
- docker/metadata-action — https://github.com/docker/metadata-action
- Docker multi-platform builds in GitHub Actions — https://docs.docker.com/build/ci/github-actions/multi-platform/
- dorny/paths-filter — https://github.com/dorny/paths-filter
- Kiro specs — https://kiro.dev/docs/specs/ and https://kiro.dev/docs/specs/feature-specs/requirements-first/

Secondary sources consulted (used only where flagged):

- Turborepo vs Nx vs pnpm workspaces 2026 comparisons (daily.dev, pkgpulse, digitalapplied) — used only for the "start with pnpm + Turborepo" positioning.
- Pact vs OpenAPI schema-testing positioning (speakeasy.com, totalshiftleft.ai, qaskills.sh) — used for the "don't use Pact here" argument.
- Orval / openapi-typescript / Kubb comparison (pkgpulse) — source of the "Orval 8+ requires Node 22.18" claim, flagged UNVERIFIED.
- Testcontainers Postgres in Node guide (qaskills.sh) — source of the `@testcontainers/postgresql` API names and the Ryuk-in-CI advice.
- AGENTS.md history/adoption summaries (codersera, asdlc.io, prpm.dev) — source of the Aug 2025 / Dec 2025 provenance dates, flagged UNVERIFIED.
- Android APK signing in GitHub Actions guides (proandroiddev/droidcon, dev.to) — source of the Base64-keystore-secret pattern.

---

## 17. UNVERIFIED items

Everything in this list must be confirmed by the building agent before it is relied on. Each is stated with what specifically is unconfirmed.

1. **pnpm `pnpm-workspace.yaml` `packages:` glob grammar and `!` exclusions** — the fetched page did not show the verbatim schema. Confirm at https://pnpm.io/settings.
2. **pnpm `catalogs:` / `catalog:` protocol shape** — referenced but not captured verbatim. Confirm before using for version pinning.
3. **Turborepo current major version number** — the config reference did not state one.
4. **Orval 8+ requiring Node ≥ 22.18** — from a comparison article, not Orval's docs.
5. **`swr-openapi` current version and API** — not fetched.
6. **Schemathesis CLI flags** (`--url`, `--checks`, `--max-examples`, `--report`) **and the built-in check identifiers** (`not_a_server_error`, `status_code_conformance`, `content_type_conformance`, `response_schema_conformance`, `negative_data_rejection`) — not confirmed on the pages fetched. Run `schemathesis run --help` and record the truth in `docs/TESTING.md`.
7. **Prism's npm package name** (`@stoplight/prism-cli`) **and Docker image name** — the fetched guide did not state either. Also unconfirmed: whether violations are surfaced in an `sl-violations` response header.
8. **CalDAVTester's Python version requirement** — the Apple repo is long-standing; it may require Python 2. If it will not run under a modern Python, record that in an ADR and rely on the Tier-1 harness plus real-client checks.
9. **MCP Inspector `--header` with a positional/URL server** — the docs describe `--header` as overriding a *config file's* headers. If it is rejected for a bare `--server-url`, use a `--config ci-servers.json` file, which is the documented path.
10. **`enumPropertyNaming` as a Kotlin generator config option** — not present in the fetched options table. Verify with `./gradlew openApiGenerators` / the generator doc.
11. **`actions/setup-node`, `pnpm/action-setup`, `actions/cache`, `actions/upload-artifact`, `softprops/action-gh-release` versions** — used as `@v4`/`@v2` placeholders; not fetched.
12. **`oasdiff` invocation and flags** for the breaking-change job — named from memory, not verified.
13. **KVM udev workaround still being required on current `ubuntu-latest` runner images** — verify against the runner image release notes.
14. **ATD "API level 30 only" restriction still current** in the AGP version you pin — the doc page states it, but AGP moves.
15. **Style Dictionary `filter` object syntax for matching nested `$extensions` keys** — `filter` accepts `string | function | Object`, but deep-object matching semantics were not verified. Prefer a filter *function* in a JS config.
16. **EARS variants beyond `WHEN … THE SYSTEM SHALL …`** (`IF … THEN`, `WHILE`, `WHERE`, ubiquitous) — standard EARS, but only the `WHEN` form was confirmed from a primary source in this session.
17. **AGENTS.md provenance dates** (formalised Aug 2025 by OpenAI with Google/Cursor/Factory; donated to the Linux Foundation's Agentic AI Foundation Dec 2025) — from secondary summaries. The *stewardship by the Agentic AI Foundation under the Linux Foundation* is confirmed on agents.md itself.
18. **Spec Kit's exact current directory layout** — the fetched README described `.specify/` and `specs/` with `constitution.md`, `specification.md`, `implementation-plan.md`, `tasks.md`; the project is fast-moving, so confirm before copying literally. (Fem-ho is advised to borrow the shape, not the tooling, which makes this moot.)
