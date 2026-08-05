# Fem-ho — Web Frontend Architecture Dossier

**Scope:** the self-hosted web client (Docker) that must be responsive desktop→mobile, and whose mobile-web layout must feel identical to the native Android app.
**Audience:** an AI writing production code. Every version number below was read from `registry.npmjs.org` on **2026-08-05**. Every licence claim was read from the vendor's own licence page or the npm `license` field.
**Convention in this document:** `RECOMMENDATION` blocks close each major section and are binding decisions, not options.

---

## 0. Decision summary (read this first)

| Concern | Decision | Hard reason |
|---|---|---|
| UI framework | **React 19.2.8** | The Plou design system ships `.jsx` React components (20 of them, `_ds_manifest.json`). Anything else means a rewrite of the DS. |
| Language | **TypeScript 6.0.3** (not 7.x yet) | TS 7.0.2 is `latest` but has no stable programmatic API → `typescript-eslint` cannot run on it. See §2.2. |
| Bundler | **Vite 8.2.0** + `@vitejs/plugin-react 6.0.5` | |
| Router | **TanStack Router 1.170.19** | Typed search params are the app's state model (scope multi-select, project, date, view). React Router explicitly does not do this. |
| Server state | **TanStack Query 5.101.4** + `@tanstack/react-query-persist-client` | Optimistic + rollback is a documented first-class pattern; the persist plugin gives offline reads for free. |
| Client state | **Zustand 5.0.14** (single small store) | |
| Offline | **PWA (vite-plugin-pwa 1.3.0) + IndexedDB outbox via Dexie 4.4.4**. **NOT** a local-first sync engine. | §5.6 — honest cost/benefit. |
| Drag & drop | **`@atlaskit/pragmatic-drag-and-drop` 2.0.2** (Apache-2.0) + custom keyboard move menu | dnd-kit's next-gen `@dnd-kit/react` is still `0.5.0`; the stable `@dnd-kit/core@6.3.1` line is the old architecture. Pragmatic explicitly claims full iOS+Android support. |
| Calendar | **FullCalendar 7.0.2** — `daygrid`, `timegrid`, `list`, `multimonth`, `interaction` are **MIT** | Month/week/day + external drag-to-schedule + iCalendar feeds are all in the free tier. Schedule-X puts drag-and-drop behind a €479/yr licence. |
| Styling | **Plain CSS + CSS Modules over the Plou custom properties. NO Tailwind.** | The DS is inline-styled JSX bound to `var(--…)`; Tailwind would create a second, conflicting token system. |
| Responsive | **Container queries for components, media queries for the shell**, one codebase, mobile shell = Android shell | |
| i18n | **Lingui 6.6.0** (ICU MessageFormat, `.po` catalogs) + native `Intl` for dates/numbers | Catalan `Intl` output verified to already match the spec (`dl/dt/dc/dj/dv/ds/dg`, lowercase months). |

---

## 1. Framework choice

### 1.1 The decisive constraint: Plou ships React

This is not a preference argument. Read from `Plou Design System.zip`:

`_ds_manifest.json` → `components[]` lists **20 exported components**, every one with a `.jsx` `sourcePath`:

```json
[{"name":"Button","sourcePath":"components/core/Button.jsx"},
 {"name":"Card","sourcePath":"components/core/Card.jsx"},
 {"name":"PLOU_ICONS","sourcePath":"components/core/Icon.jsx"},
 {"name":"Icon","sourcePath":"components/core/Icon.jsx"},
 {"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},
 {"name":"Tag","sourcePath":"components/core/Tag.jsx"},
 {"name":"Wordmark","sourcePath":"components/core/Wordmark.jsx"},
 {"name":"AlertScreen","sourcePath":"components/feedback/AlertScreen.jsx"},
 {"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},
 {"name":"GlassBar","sourcePath":"components/feedback/GlassBar.jsx"},
 {"name":"ChoiceChips","sourcePath":"components/forms/ChoiceChips.jsx"},
 {"name":"SegmentedControl","sourcePath":"components/forms/SegmentedControl.jsx"},
 {"name":"SettingsGroup","sourcePath":"components/forms/SettingsGroup.jsx"},
 {"name":"SettingsRow","sourcePath":"components/forms/SettingsGroup.jsx"},
 {"name":"Slider","sourcePath":"components/forms/Slider.jsx"},
 {"name":"Switch","sourcePath":"components/forms/Switch.jsx"},
 {"name":"TextField","sourcePath":"components/forms/TextField.jsx"},
 {"name":"NavItem","sourcePath":"components/navigation/NavItem.jsx"},
 {"name":"TabBar","sourcePath":"components/navigation/TabBar.jsx"}, …]
```

And the source is literally React with hooks — `components/core/Button.jsx`, verbatim:

```jsx
import React from 'react';

const BASE = {
  borderRadius: 'var(--radius-pill)',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontWeight: 'var(--weight-bold)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-2)',
  whiteSpace: 'nowrap',
  transition: 'transform var(--dur-instant) var(--ease-standard), filter var(--dur-fast) var(--ease-standard), opacity var(--dur-fast) var(--ease-standard)',
};

const VARIANTS = {
  primary: { background: 'var(--gradient-brand)', color: 'var(--on-brand)', boxShadow: 'var(--shadow-primary)' },
  ghost:   { background: 'var(--ghost-bg)',       color: 'var(--ghost-text)' },
  danger:  { background: 'var(--danger-bg)',      color: 'var(--danger-text)' },
  glass:   { background: 'var(--glass-fill)',     color: 'var(--glass-text)' },
  onAlert: { background: '#fff',                  color: '#1a2a5c' },
};

export function Button({ variant='primary', size='lg', icon, iconPosition='left', block, disabled, children, style, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  return (<button …/>);
}
```

`Button.d.ts` / `Card.d.ts` etc. exist alongside each `.jsx`, i.e. the DS is **untyped JS with hand-written ambient types**.

**Consequence:** choosing Vue 3, SvelteKit or SolidJS means reimplementing all 20 components plus `PLOU_ICONS` before writing a single line of Fem-ho. That is weeks of work whose only output is parity with something already in the box, and it permanently forks Fem-ho from the DS — future Plou updates would have to be ported twice. **React is chosen by the design system, and the design system is a given.**

### 1.2 Secondary criteria, scored honestly

| Criterion | React 19 | Vue 3 | SvelteKit | SolidJS |
|---|---|---|---|---|
| Plou DS reuse | **native, zero work** | rewrite 20 components | rewrite 20 components | rewrite 20 components (JSX syntax is close but hooks/`useState` semantics differ fundamentally) |
| DnD ecosystem | `pragmatic-drag-and-drop` (framework-agnostic, Atlassian, Apache-2.0), `@dnd-kit/*`, `react-aria` DnD | `vuedraggable` (SortableJS wrapper), pragmatic works too | `svelte-dnd-action`, pragmatic works too | thin; pragmatic works |
| Calendar ecosystem | `@fullcalendar/react@7.0.2` (official, peer `react: "^17 \|\| ^18 \|\| ^19"`), `react-big-calendar@1.20.0`, `@schedule-x/react@4.1.0` | `@fullcalendar/vue3`, `@schedule-x/vue` | `@fullcalendar/…` via web component, Schedule-X svelte | essentially FullCalendar's `@fullcalendar/web-component` only |
| PWA offline | Workbox/vite-plugin-pwa is framework-agnostic; TanStack Query persistence is React-first (`@tanstack/react-query-persist-client`) | equivalent via `@tanstack/vue-query` | equivalent | `@tanstack/solid-query` exists but persistence adapters lag |
| AI writes the code | **largest training corpus by a wide margin**; React 19 + TanStack Query + dnd patterns are extremely well represented | good | good but Svelte 5 runes are recent and models still emit Svelte 4 store syntax | poor — models routinely emit React idioms that silently break Solid's fine-grained reactivity (e.g. destructuring props) |

The "AI writes most of the code" criterion deserves weight and points the same way. Solid in particular is a trap for LLM-authored code: destructuring props breaks reactivity with no error, and models do it constantly.

### 1.3 React 19 specifics worth using

React latest is **19.2.8** (`react`, `react-dom`; `@types/react` 19.2.18).

Relevant 19.x APIs:

- **`useOptimistic`** — signature from react.dev, verbatim:
  ```js
  const [optimisticState, setOptimistic] = useOptimistic(value, reducer?);
  ```
  Caveat from the docs: *"The `set` function must be called inside an Action. If you call the setter outside an Action, React will show a warning and the optimistic state will briefly render."*
  → Only usable inside `startTransition`/form Actions. For Fem-ho the kanban's optimistic layer lives in TanStack Query's cache instead (§4.3); `useOptimistic` is useful for *local, single-component* optimism such as the checklist item toggle inside a share-link page.
- **`<Activity />`** (19.2) — *"lets you break your app into 'activities' that can be controlled and prioritized"*, with `visible` / `hidden` modes that pre-render and defer updates. **This is exactly right for the Tasks ⇄ Calendar switch**: keep the non-active view mounted as `<Activity mode="hidden">` so switching is instant and scroll position in the kanban survives.
- **`useEffectEvent`** (19.2) — split the non-reactive part out of an Effect. Use for the SSE/WebSocket subscription effect so that changing `theme`/`accent` does not tear down the realtime connection.
- **Performance Tracks** (19.2) — Scheduler + Components tracks in Chrome DevTools profiles. Use these when the 4-column board with hundreds of cards drops frames.
- **Batching Suspense boundary reveals for SSR** — irrelevant, Fem-ho is a client-rendered SPA served by the Docker container.

### RECOMMENDATION — Framework

- **React 19.2.8**, SPA, client-rendered. No Next.js, no SSR: the app is behind a login on a self-hosted box, SEO is meaningless, and SSR would force a Node process into the Docker image next to the API. Ship **static files served by the same container/nginx that fronts the API**, which also makes the "type your server URL" story trivial (the web build talks to same-origin `/api`, the Android build talks to whatever host the user typed).
- Vendor the Plou `.jsx` components into `src/ds/` **unmodified**, add `// @ts-nocheck`-free ambient types by keeping the shipped `.d.ts` files next to them, and never edit them; wrap them in `src/components/` when Fem-ho needs different behaviour.
- Use `<Activity>` for the Tasks/Calendar switch and for the Inbox side column shared between views.

---

## 2. Build & tooling

### 2.1 Vite

`vite@8.2.0`, `@vitejs/plugin-react@6.0.5` (Babel-based, needed if Lingui macros are used — see §14) or `@vitejs/plugin-react-swc@4.3.3` (faster, but Lingui macros then need `@lingui/swc-plugin`).

Baseline `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { lingui } from '@lingui/vite-plugin';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
    lingui(),
    VitePWA({ /* §5 */ }),
  ],
  server: {
    proxy: { '/api': 'http://localhost:8080' },   // dev only; prod is same-origin
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          calendar: ['@fullcalendar/core', '@fullcalendar/daygrid', '@fullcalendar/timegrid', '@fullcalendar/list', '@fullcalendar/interaction', '@fullcalendar/react'],
        },
      },
    },
  },
});
```

The `manualChunks` split matters: FullCalendar is the single largest dependency and the Tasks view must not pay for it. Combined with TanStack Router's `autoCodeSplitting`, the calendar bundle only loads when `/calendari` is first visited.

### 2.2 TypeScript — do **not** take `latest`

npm `dist-tags` for `typescript` on 2026-08-05:

```json
{"dev":"3.9.4","tag-for-publishing-older-releases":"4.1.6","insiders":"4.6.2-insiders.20220225",
 "beta":"6.0.0-beta","rc":"7.0.1-rc","latest":"7.0.2","next":"7.1.0-dev.20260805.1"}
```

TypeScript **7.0** is the Go-native port ("Corsa"), shipped 2026-07-08, ~8–12× faster type-checking. **But it has no stable programmatic API**, which means `typescript-eslint`, `ts-jest`, `ts-morph` and the template checkers for Vue/Svelte/Astro cannot run on it; that API is targeted for **7.1**, described as several months out. (Source: InfoQ + multiple ecosystem write-ups; see Sources. Treat the exact 7.1 date as **UNVERIFIED**.)

Fem-ho's lint story depends on `typescript-eslint` (and on `oxlint` for the Plou adherence rules — the DS ships `_adherence.oxlintrc.json`, 24 KB of rules).

**Pin `typescript@6.0.3`.** Revisit when `typescript@7.1.x` is `latest` and `typescript-eslint` announces support. Add a CI job that *additionally* runs `tsgo --noEmit` from the 7.x line for the speed win without making it the source of truth — **UNVERIFIED** that the 7.x binary is invocable as `tsgo` from the released `typescript` package (the reporting says the `tsgo` name now applies only to the nightly channel and that the native build became the standard `tsc` in 7.0 RC).

`tsconfig.json` essentials:

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "allowJs": true,          // required: the Plou DS is .jsx
    "checkJs": false,         // do NOT type-check the vendored DS
    "noEmit": true,
    "paths": { "@/*": ["./src/*"], "@ds/*": ["./src/ds/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

`allowJs: true` + `checkJs: false` is the exact combination that lets the untyped Plou `.jsx` live inside a `strict` project.

### 2.3 Routing — TanStack Router

`@tanstack/react-router@1.170.19` (MIT), `@tanstack/router-plugin@1.168.24`, `@tanstack/react-router-devtools@1.167.1`.
Alternative considered: `react-router@8.3.0`.

TanStack's own comparison table (fetched) reports:

| Feature | TanStack Router | React Router DOM | Next.js |
|---|---|---|---|
| Typesafe routes | ✅ | 🟡 partial | 🟡 partial |
| File-based routing | ✅ | ✅ | ✅ |
| Loaders | ✅ | ✅ | ✅ |
| **Typesafe search params / search-param schema validation** | ✅ | 🛑 | 🛑 |
| SWR loader caching | ✅ | 🛑 | ✅ |
| Devtools | ✅ built-in | 🟠 addon | 🛑 |

**Why search params decide it for Fem-ho.** The entire top bar is URL state:

- multi-select scope chips → `scopes: string[]`
- project dropdown → `project: string | 'all'`
- Tasks/Calendar switch → route segment
- calendar sub-view → `view: 'month' | 'week' | 'day'`
- calendar cursor date + Inbox date → `date`, `inboxDate`
- "show previous days' unfinished tasks" toggle → `carryOver: boolean`
- Done-column date navigation → `doneDate`

All of that must be shareable, back-button-correct and survive a reload. TanStack Router validates and types it:

```ts
// src/routes/app/tasques.tsx
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const searchSchema = z.object({
  scopes:    z.array(z.string()).default([]),          // scope slugs: personal, feina, familia, techie…
  project:   z.string().optional(),                     // undefined = "tots"
  inboxDate: z.string().date().optional(),              // YYYY-MM-DD
  carryOver: z.boolean().default(true),
  doneDate:  z.string().date().optional(),
  q:         z.string().optional(),
});

export const Route = createFileRoute('/app/tasques')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ scopes: search.scopes, project: search.project }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(boardQueryOptions(deps)),
  component: TasksBoard,
});
```

and reading it is fully typed:

```ts
const { scopes, project, carryOver } = Route.useSearch();
const navigate = Route.useNavigate();
navigate({ search: (prev) => ({ ...prev, scopes: toggle(prev.scopes, 'feina') }) });
```

### 2.4 Client state — Zustand

`zustand@5.0.14` (MIT) vs `jotai@2.20.2` (MIT).

Almost all of Fem-ho's state is either (a) server state → TanStack Query, or (b) URL state → TanStack Router search params. What is left is genuinely small and app-global:

- theme (`system|light|dark`) and accent (`default|soft|mono-warm|mono-cool`)
- inbox placement preference (`left|right|bottom`) — the settings say this is user-configurable
- collapsed/expanded state of the per-scope epigraph groups inside kanban columns
- the currently open modal + which task it edits
- the offline outbox length badge
- session/auth (token, current user, server base URL)

That is one flat store, not an atom graph. **Zustand.** Jotai's model (fine-grained atoms) pays off when many independent components each own a slice; here a single store with selectors is less machinery and much easier for an AI to write correctly.

```ts
// src/store/ui.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'system' | 'light' | 'dark';
type Accent = 'default' | 'soft' | 'mono-warm' | 'mono-cool';
type InboxSide = 'left' | 'right' | 'bottom';

interface UiState {
  theme: Theme; accent: Accent; inboxSide: InboxSide;
  collapsedScopes: Record<string, boolean>;
  setTheme(t: Theme): void; setAccent(a: Accent): void;
  toggleScopeGroup(columnId: string, scopeId: string): void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system', accent: 'default', inboxSide: 'left',
      collapsedScopes: {},
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      toggleScopeGroup: (col, scope) =>
        set((s) => ({ collapsedScopes: { ...s.collapsedScopes, [`${col}:${scope}`]: !s.collapsedScopes[`${col}:${scope}`] } })),
    }),
    { name: 'femho.ui' },
  ),
);
```

### RECOMMENDATION — Build & tooling

- Vite 8, `@vitejs/plugin-react` (Babel variant, so Lingui macros work with zero extra plugins).
- **Pin TypeScript to `6.0.3`.** Do not upgrade to 7.x until `typescript-eslint` supports it.
- TanStack Router with `validateSearch` + Zod for every screen-level filter. Treat the top bar as a URL editor.
- Zustand, one `useUi` store persisted to `localStorage`, plus a separate non-persisted `useSession` store (the auth token goes in memory + an `httpOnly` cookie if the backend can set one; if not, `localStorage` with the server URL — the Android app has the same pairing model).
- `vite-plugin-checker@0.14.5` to surface `tsc` errors in the dev overlay.
- Run `oxlint` with the shipped `_adherence.oxlintrc.json` from the Plou zip as a **separate lint pass** — it is the DS's own conformance ruleset and it is free correctness for "does this look like Plou".

---

## 3. Design system integration (Plou)

### 3.1 What the DS actually is

Read from the zip, not inferred:

- **Tokens** are plain CSS custom properties in `tokens/*.css`: `theme.css`, `accents.css`, `colors.css`, `elevation.css`, `fonts.css`, `motion.css`, `shape.css`, `spacing.css`, `typography.css`, `utilities.css`.
- **Components** are React `.jsx` with **inline `style={{}}` objects whose values are `var(--token)` strings**. There is no CSS-in-JS runtime, no class names, no Tailwind.
- **Utilities** (`tokens/utilities.css`) provide `.plou-card`, `.plou-btn`, `.plou-tag`, `.plou-fab`, `.plou-seg`, `.plou-navitem`, `.plou-input`, `.plou-range`, `.plou-kicker`, `.plou-eyebrow`, `.plou-wordmark`, `.plou-glass` — explicitly *"so plain HTML / prototypes can reach the same visuals with one class name."*

### 3.2 Theming contract

Two orthogonal attributes on a root element:

```html
<div data-theme="light" data-accent="soft"> … </div>
```

`tokens/theme.css` header, verbatim: *"Every surface colour is theme-scoped. Always set `data-theme` on the root container of a Plou screen."*
`tokens/accents.css` header, verbatim: *"The accent is orthogonal to the theme: set both on the root of a screen. … Each scope overrides ONLY the brand tokens — surfaces, ink and shape are untouched."*

Accent scopes shipped: *(unset)* = **sunset**, `soft`, `mono-warm`, `mono-cool`.

**Critical import-order rule, from the DS readme, verbatim:** *"`accents.css` is the **last** token import, because accent scopes and `:root` share specificity, so source order decides — with it earlier, `elevation.css` re-won every shadow."*

So the single global stylesheet must be:

```css
/* src/styles/tokens.css — ORDER IS LOad-BEARING */
@import './ds/tokens/fonts.css';
@import './ds/tokens/colors.css';
@import './ds/tokens/typography.css';
@import './ds/tokens/spacing.css';
@import './ds/tokens/shape.css';
@import './ds/tokens/motion.css';
@import './ds/tokens/theme.css';
@import './ds/tokens/elevation.css';
@import './ds/tokens/utilities.css';
@import './ds/tokens/accents.css';   /* LAST. Do not move. */
```

`mono-cool` needs the documented two-attribute exception: `[data-theme="dark"][data-accent="mono-cool"]` lifts the ink blue to `#8FC0FF`. That rule ships inside `accents.css` — do not duplicate it.

### 3.3 Applying theme + accent at runtime

```tsx
// src/app/ThemeProvider.tsx
import { useEffect } from 'react';
import { useUi } from '@/store/ui';

export function ThemeApplier() {
  const theme = useUi((s) => s.theme);
  const accent = useUi((s) => s.accent);

  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      root.dataset.theme = resolved;
      // color-scheme drives form controls + scrollbars, which the DS does not style
      root.style.colorScheme = resolved;
      // keep the PWA status bar in sync (see §11.4)
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'dark' ? '#0e0f16' : '#f8f9fd');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === 'default') delete root.dataset.accent;
    else root.dataset.accent = accent;
  }, [accent]);

  return null;
}
```

The two `#0e0f16` / `#f8f9fd` values are the first stops of `--app-bg` in dark/light from `theme.css`.

### 3.4 Tailwind: **no**

Adding Tailwind on top of Plou would be actively harmful here:

1. The DS components are inline-styled. Tailwind classes cannot override an inline `style` without `!important`, so any Tailwind utility applied to a `<Button>` silently loses.
2. Tailwind 4 (`tailwindcss@4.3.3`) introduces `@theme` and its own custom-property namespace (`--color-*`, `--spacing-*`). Fem-ho would then have two token systems whose names collide conceptually (`--space-4` = 10px in Plou; Tailwind's `--spacing` scale is 0.25rem-based). AI-written code would mix them.
3. The DS's own scale is non-linear and deliberately odd (`--space-1:4px; --space-2:6px; --space-3:8px; --space-4:10px; --space-5:12px; --space-6:14px; --space-7:16px; --space-8:18px; --space-9:20px; --space-10:22px; --space-12:26px; --space-14:32px; --space-16:40px`). Tailwind's arbitrary-value escape hatch (`p-[10px]`) throws away every benefit of Tailwind.

**Use CSS Modules** (`*.module.css`) for Fem-ho-specific layout — Vite supports them natively, no plugin. Every value inside them must be a Plou `var(--…)`. Keep a single `src/styles/` for globals.

```css
/* src/features/board/Board.module.css */
.board {
  display: grid;
  grid-template-columns: minmax(280px, 340px) repeat(3, minmax(260px, 1fr));
  gap: var(--gap-grid);
  padding: var(--space-7);
  max-width: var(--content-max);
  margin-inline: auto;
}
.column {
  background: var(--card-bg);
  border: var(--border-hairline) solid var(--card-border);
  border-radius: var(--radius-card);
  box-shadow: var(--card-shadow);
  padding: var(--pad-card-tight);
  display: flex; flex-direction: column; min-height: 0;
}
/* the Inbox must read as a different object from the 3 kanban lists (explicit product note) */
.inbox {
  composes: column;
  border-radius: var(--radius-panel);
  background: var(--panel-bg);
  border-style: dashed;
}
```

### 3.5 Missing pieces Fem-ho must add to the DS

Plou is a weather app. It has **no** kanban, no calendar, no combobox, no avatar, no checkbox. Build these in `src/components/` strictly from tokens:

| New component | Built from |
|---|---|
| `TaskCard` | `.plou-card` geometry at `--radius-card-sm`, `--pad-tile-lg`, `--card-shadow` |
| `ScopeChip` (multi-select, top bar) | `ChoiceChips.jsx` is the closest DS primitive — extend it, don't fork it |
| `BoardColumn` | `Card` + a sticky header using `--text-h3` |
| `Checkbox` | derive from `Switch.jsx`'s track/thumb tokens; radius `--radius-circle` for the tick |
| `Avatar` | `--radius-circle`, `--gradient-brand` fallback for initials, `--on-brand` text |
| `Combobox` / `MentionPopup` | new; see §12 |
| `Calendar` chrome | FullCalendar shell restyled with tokens; see §9 |
| `BottomNav` (mobile) | **`TabBar.jsx` already is this** — floating, pill, `--switcher-bg`, `backdrop-filter: var(--blur-switcher)`, `position:absolute; left:22; right:22; bottom: var(--switcher-inset)` |

`TabBar.jsx` is worth quoting because it is the mobile bottom nav for free, and it already sets `aria-current="page"`:

```jsx
export function TabBar({ tabs = [], value, onChange, floating = true, style, ...rest }) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-around',
      height:'var(--switcher-height)', padding:'var(--space-2)',
      borderRadius:'var(--radius-pill)',
      background:'var(--switcher-bg)',
      backdropFilter:'var(--blur-switcher)', WebkitBackdropFilter:'var(--blur-switcher)',
      border:'1px solid var(--switcher-border)',
      boxShadow:'var(--switcher-shadow)',
      ...(floating ? { position:'absolute', left:22, right:22, bottom:'var(--switcher-inset)', zIndex:5 } : {}),
      ...style,
    }} {...rest}>
      {tabs.map(t => { const active = t.value === value; return (
        <button key={t.value} title={t.label} aria-label={t.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => onChange && onChange(t.value)}
                style={{ flex:1, height:'var(--tab-hit)', borderRadius:'var(--radius-pill)', …,
                         background: active ? 'var(--gradient-brand)' : 'transparent',
                         color: active ? 'var(--on-brand)' : 'var(--ink-soft)',
                         boxShadow: active ? 'var(--shadow-tab-active)' : 'none' }}>
          {t.icon}
        </button>); })}
    </div>
  );
}
```

Note `--tab-hit: 52px` — the DS already ships a 52px touch target, comfortably above the 44/48px minimum.

### 3.6 The "one gradient per view" rule

DS readme, verbatim: *"One gradient is the entire brand … It appears **exactly once per view**, on the primary action or the active state (one primary button, or the active tab, or the temperature bubble — never two)."*

For Fem-ho this is a real design constraint, and it conflicts with the obvious kanban instinct (gradient column headers, gradient chips, gradient FAB, all at once). Allocation per view:

| View | The one gradient goes on |
|---|---|
| Tasks board (desktop) | the **`+` create button** in the top bar |
| Tasks board (mobile) | the **active tab in the bottom `TabBar`** |
| Calendar | the **active view segment** (`Mes / Setmana / Dia`) in `SegmentedControl` |
| Task edit modal | the **"Desa"** primary button |
| Share-link page | the **"Marca com a fet"** primary button |
| Dashboard | the **quick-add submit** |

Everything else — scope chips, priority tags, AI-mode badges — uses `--tag-bg` / `--gradient-wash-tag` / `--ghost-bg`, never `--gradient-brand`.

Per-scope dot indicators (calendar + card meta) should use the DS's `--dot-1 / --dot-2 / --dot-3` tokens, which every accent scope redefines. With more than three user-created scopes, generate additional dots by hue-rotating within the accent's family rather than introducing new hex values — **UNVERIFIED** that the DS anticipates >3 dots; it defines exactly three.

### RECOMMENDATION — Design system

- Vendor `tokens/` and `components/` verbatim into `src/ds/`. Import order as in §3.2, `accents.css` last, enforced by a lint rule or a comment the AI must not reorder.
- Roboto: `tokens/fonts.css` currently does `@import url("https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap")`. **A self-hosted app must not depend on Google Fonts** — it breaks offline, breaks air-gapped installs, and leaks the user's IP. Replace with self-hosted `@font-face` from `@fontsource/roboto` (weights 400/500/700/900, `font-display: swap`, `latin` + `latin-ext` subsets — `latin-ext` is required for Catalan `ŀl`/`ç`/`í`/`ï`/`à`/`è`/`ò`/`ú`/`ü`). The DS file itself says: *"Swap this `@import` for `@font-face` rules if self-hosted files become available."*
- CSS Modules only. **No Tailwind, no styled-components, no Emotion.**
- Never write a raw hex or px in Fem-ho code. Every value is a `var(--…)`. Add an ESLint/oxlint rule to fail on `#[0-9a-f]{3,8}` in `src/features/**`.

---

## 4. Server state, optimistic UI and rollback

### 4.1 TanStack Query setup

`@tanstack/react-query@5.101.4` (MIT), `@tanstack/react-query-devtools@5.101.4`, `@tanstack/react-query-persist-client@5.101.4`, `@tanstack/query-sync-storage-persister@5.101.4`, `@tanstack/query-async-storage-persister@5.101.4`.

```ts
// src/api/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24 * 7,   // must be >= persister maxAge
      retry: (failureCount, err: any) => (err?.status >= 400 && err?.status < 500 ? false : failureCount < 3),
      refetchOnWindowFocus: true,
      networkMode: 'offlineFirst',        // serve cache when offline instead of erroring
    },
    mutations: {
      networkMode: 'offlineFirst',        // queue instead of failing; paired with the outbox in §5
      retry: 3,
    },
  },
});
```

`networkMode: 'offlineFirst'` is the single most important line for Fem-ho: with it, mutations fired while offline are **paused** rather than rejected, and resume when the browser reports connectivity.

### 4.2 Query key factory

A flat, greppable key factory keeps optimistic updates and invalidations honest. AI-written code goes wrong here more than anywhere else.

```ts
// src/api/keys.ts
export const qk = {
  me:            () => ['me'] as const,
  users:         () => ['users'] as const,
  scopes:        () => ['scopes'] as const,
  projects:      (scopeId?: string) => ['projects', scopeId ?? 'all'] as const,

  board:         (f: BoardFilter) => ['board', f.scopes.join(','), f.project ?? 'all'] as const,
  inbox:         (f: InboxFilter) => ['inbox', f.date, f.project ?? 'all', f.carryOver] as const,
  doneColumn:    (f: DoneFilter)  => ['done', f.date, f.scopes.join(',')] as const,

  task:          (id: string) => ['task', id] as const,
  taskHistory:   (id: string) => ['task', id, 'history'] as const,
  checklist:     (id: string) => ['checklist', id] as const,
  pinnedLists:   () => ['checklists', 'pinned'] as const,

  events:        (r: { from: string; to: string; scopes: string[] }) =>
                   ['events', r.from, r.to, r.scopes.join(',')] as const,
  shareLinks:    () => ['shares'] as const,
};
```

### 4.3 Optimistic move across kanban columns, with rollback

TanStack's documented cache approach (v5 signature, with `context.client` — this changed in recent 5.x; the `onMutate(variables, context)` / `onError(err, vars, onMutateResult, context)` shape below is verbatim from the current docs):

```ts
useMutation({
  mutationFn: updateTodo,
  onMutate: async (newTodo, context) => {
    await context.client.cancelQueries({ queryKey: ['todos'] })
    const previousTodos = context.client.getQueryData(['todos'])
    context.client.setQueryData(['todos'], (old) => [...old, newTodo])
    return { previousTodos }
  },
  onError: (err, newTodo, onMutateResult, context) => {
    context.client.setQueryData(['todos'], onMutateResult.previousTodos)
  },
  onSettled: (data, error, variables, onMutateResult, context) =>
    context.client.invalidateQueries({ queryKey: ['todos'] }),
})
```

Fem-ho's concrete version. The board query returns columns keyed by status; a move changes `status` **and** `position`.

```ts
// src/features/board/useMoveTask.ts
import { useMutation } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import { qk } from '@/api/keys';
import { api } from '@/api/client';

type Status = 'inbox' | 'todo' | 'doing' | 'done';
interface MoveVars { taskId: string; toStatus: Status; beforeId?: string; afterId?: string; }

export function useMoveTask(filter: BoardFilter) {
  return useMutation({
    mutationKey: ['moveTask'],
    mutationFn: ({ taskId, toStatus, position }: MoveVars & { position: string }) =>
      api.patch(`/api/v1/tasks/${taskId}`, { status: toStatus, position }),

    onMutate: async (vars, context) => {
      const key = qk.board(filter);
      await context.client.cancelQueries({ queryKey: key });
      const previous = context.client.getQueryData<Board>(key);

      context.client.setQueryData<Board>(key, (old) => {
        if (!old) return old;
        const task = findTask(old, vars.taskId);
        if (!task) return old;
        const position = generateKeyBetween(
          vars.afterId  ? positionOf(old, vars.afterId)  : null,
          vars.beforeId ? positionOf(old, vars.beforeId) : null,
        );
        return moveTaskInBoard(old, vars.taskId, vars.toStatus, position);
      });

      // the Inbox is a separate query and shares the same tasks — keep it consistent
      await context.client.cancelQueries({ queryKey: ['inbox'] });
      const previousInbox = context.client.getQueriesData({ queryKey: ['inbox'] });
      context.client.setQueriesData({ queryKey: ['inbox'] }, (old: Inbox | undefined) =>
        old ? removeTask(old, vars.taskId) : old);

      return { previous, previousInbox, key };
    },

    onError: (_err, _vars, ctx, context) => {
      if (!ctx) return;
      context.client.setQueryData(ctx.key, ctx.previous);
      ctx.previousInbox.forEach(([k, data]) => context.client.setQueryData(k, data));
      toast.error(t`No s'ha pogut moure la tasca`);
    },

    onSettled: (_d, _e, _v, _ctx, context) => {
      context.client.invalidateQueries({ queryKey: ['board'] });
      context.client.invalidateQueries({ queryKey: ['inbox'] });
    },
  });
}
```

**Position persistence — use fractional indexing, not integers.** `fractional-indexing@4.0.0` (CC0-1.0, i.e. public domain, no attribution burden) exposes:

```ts
generateKeyBetween(a: string | null, b: string | null): string
generateNKeysBetween(a: string | null, b: string | null, n: number): string[]
```

Keys are short lexicographically-ordered strings (`a0`, `a1`, `a0V`, …). A move is a **single-row `PATCH`** — no renumbering of siblings, no write amplification, and two concurrent moves by two family members never fight over the same integers. This matters enormously for Fem-ho because the Android client makes the same edits offline and merges later. Store `position TEXT` in Postgres, index `(scope_id, project_id, status, position)`.

### 4.4 Quick-add optimism

Quick-add must feel instantaneous — the product spec says explicitly *"sense obrir cap modal ni res"* (no modal, nothing). Use the **variables** approach documented by TanStack (simpler, no cache surgery) for the transient row, because the parsed result may relocate the task to a different column/scope:

```tsx
const add = useMutation({
  mutationKey: ['addTask'],
  mutationFn: (input: QuickAddInput) => api.post('/api/v1/tasks', input),
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['board'] }),
});

// in the target column:
{add.isPending && add.variables?.status === column.status && (
  <TaskCard task={previewFromInput(add.variables)} style={{ opacity: 0.5 }} pending />
)}
```

If several quick-adds are in flight across columns, read them with `useMutationState`:

```ts
const pending = useMutationState<QuickAddInput>({
  filters: { mutationKey: ['addTask'], status: 'pending' },
  select: (m) => m.state.variables as QuickAddInput,
});
```

**Client-generated IDs.** Generate a UUIDv7 (or ULID) on the client and send it as the task `id`. This makes the create idempotent (safe to retry from the outbox), lets the optimistic card carry its real identity, and lets a subsequent offline "move" reference a task the server has never seen. The Android client must use the same scheme.

### 4.5 Rollback UX

Rollback that silently reverts a card is confusing. On `onError`:

1. Restore the cache snapshot (above).
2. Show a Plou `Dialog`-free toast (build a `Toast` on `.plou-card` + `--card-shadow`) with the Catalan message and a **"Torna-ho a provar"** action that re-fires the same mutation.
3. If the failure is `409 Conflict` (someone else moved it), do **not** rollback — invalidate and refetch, then flash the card with a 1-frame `outline: 2px solid var(--plou-orange)` so the user sees it changed under them.

### RECOMMENDATION — Server state

- TanStack Query 5.101.4 with `networkMode: 'offlineFirst'` on both queries and mutations.
- One key factory (`src/api/keys.ts`), never inline arrays.
- Cache-based optimism for **moves** (multiple views must agree: board + inbox + calendar), variables-based optimism for **creates**.
- **Fractional indexing (`fractional-indexing@4.0.0`) for kanban ordering.** This is a schema decision, coordinate it with the backend dossier.
- Client-generated UUIDv7 ids for every created entity, shared convention with Android.
- `mutationKey` on every mutation so `useMutationState` and the offline outbox can find them.

---

## 5. Offline, PWA and the local-first question

### 5.1 The honest framing

Fem-ho has **three** clients against one self-hosted server:

1. web (desktop) — online 99% of the time
2. web (mobile browser / installed PWA) — intermittently offline
3. **native Android — offline-first by requirement**

Any local-first sync engine adopted for the web must either (a) also be adopted on Android, or (b) create a second, divergent sync protocol. That asymmetry is the crux of the whole decision.

### 5.2 The service worker

`vite-plugin-pwa@1.3.0` (MIT), Workbox 7.4.1 family.

```ts
VitePWA({
  registerType: 'prompt',          // NOT autoUpdate — see below
  strategies: 'injectManifest',    // we need custom SW code for the outbox
  srcDir: 'src',
  filename: 'sw.ts',
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
    maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,   // FullCalendar chunk is large
  },
  manifest: {
    name: 'Fem-ho',
    short_name: 'Fem-ho',
    description: 'Gestor de tasques personal i familiar',
    lang: 'ca',
    dir: 'ltr',
    start_url: '/app/tasques',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
    orientation: 'any',
    background_color: '#f8f9fd',
    theme_color: '#f8f9fd',
    icons: [
      { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Nova tasca', url: '/app/tasques?quickadd=1' },
      { name: 'Calendari',  url: '/app/calendari' },
    ],
    share_target: {                     // Android share sheet → Fem-ho quick-add
      action: '/app/comparteix',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
  },
  devOptions: { enabled: true, type: 'module' },
})
```

**`registerType: 'prompt'`, not `'autoUpdate'`.** With `autoUpdate` the SW calls `skipWaiting()` and a user mid-drag can have the page reload under them. Prompt, and render a Plou toast: *"Hi ha una versió nova de Fem-ho. Recarrega"*.

```ts
// src/pwa.ts
import { registerSW } from 'virtual:pwa-register';

export const updateSW = registerSW({
  onNeedRefresh() { showUpdateToast(() => updateSW(true)); },
  onOfflineReady() { showToast(t`Fem-ho ja funciona sense connexió`); },
});
```

Runtime caching for the API (the documented `generateSW` option shape carries over to `injectManifest` via direct Workbox calls):

```ts
// src/sw.ts  (injectManifest entry)
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// SPA shell for every in-app navigation, except API + share links (which must hit the server)
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), {
  denylist: [/^\/api\//, /^\/s\//, /^\/\.well-known\//, /^\/caldav\//],
}));

// read-only API GETs: fresh when possible, cached when not
registerRoute(
  ({ url, request }) => url.pathname.startsWith('/api/v1/') && request.method === 'GET',
  new NetworkFirst({
    cacheName: 'femho-api',
    networkTimeoutSeconds: 4,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  }),
);

// user avatars / task attachments
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/v1/files/'),
  new CacheFirst({
    cacheName: 'femho-files',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
);
```

Note the navigation denylist must exclude `/s/` — the **public share links**. Those pages are for guests who have no service worker and must always be server-fresh.

### 5.3 TanStack Query persistence

```tsx
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'femho.query',
  throttleTime: 1000,
});

<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{
    persister,
    maxAge: 1000 * 60 * 60 * 24 * 7,           // gcTime must be >= this
    buster: __APP_VERSION__,                    // bump on schema change
    dehydrateOptions: {
      shouldDehydrateQuery: (q) => q.state.status === 'success' && !q.queryKey.includes('history'),
      shouldDehydrateMutation: (m) => m.state.status === 'paused',   // keep the offline queue
    },
  }}
>
  <App />
</PersistQueryClientProvider>
```

Docs quote worth internalising: *"it should be set as the same value or higher than persistQueryClient's `maxAge`"* — about `gcTime`. Getting this wrong silently empties the offline cache.

Use `useIsRestoring()` to avoid rendering an empty board for one frame on cold start.

**Do NOT use `localStorage`** via `createSyncStoragePersister`: the board + a month of events + checklists will exceed the ~5 MB quota and the write is synchronous on the main thread. IndexedDB via `idb-keyval@6.3.0` is the right store.

### 5.4 The outbox (mutation queue)

TanStack Query can persist paused mutations, but for Fem-ho the outbox deserves its own Dexie table because (a) the Android app has one and the two should be conceptually identical, (b) the audit-trail requirement means every mutation needs a durable local record, and (c) `dehydrate`/`hydrate` of mutations requires a `defaultMutationOptions` registration that AI-written code gets wrong.

`dexie@4.4.4` (Apache-2.0), `dexie-react-hooks@4.4.0`.

```ts
// src/offline/db.ts
import Dexie, { type EntityTable } from 'dexie';

export interface OutboxEntry {
  id: string;                 // UUIDv7, also the Idempotency-Key
  createdAt: number;
  method: 'POST' | 'PATCH' | 'DELETE';
  path: string;               // '/api/v1/tasks/018f…'
  body?: unknown;
  entity: 'task' | 'checklist' | 'event' | 'project' | 'scope';
  entityId: string;
  attempts: number;
  lastError?: string;
  state: 'pending' | 'sending' | 'failed';
}

export const db = new Dexie('femho') as Dexie & {
  outbox: EntityTable<OutboxEntry, 'id'>;
};

db.version(1).stores({
  outbox: 'id, createdAt, state, entity, entityId',
});
```

Flush loop:

```ts
export async function flushOutbox(): Promise<void> {
  const batch = await db.outbox.where('state').anyOf('pending', 'failed').sortBy('createdAt');
  for (const e of batch) {
    await db.outbox.update(e.id, { state: 'sending' });
    try {
      await api.request(e.method, e.path, e.body, { headers: { 'Idempotency-Key': e.id } });
      await db.outbox.delete(e.id);
    } catch (err: any) {
      if (err.status >= 400 && err.status < 500 && err.status !== 409 && err.status !== 429) {
        // permanent: surface to the user, do not retry forever
        await db.outbox.update(e.id, { state: 'failed', lastError: String(err), attempts: e.attempts + 1 });
        continue;
      }
      await db.outbox.update(e.id, { state: 'pending', attempts: e.attempts + 1 });
      return;   // stop the batch, preserve ordering
    }
  }
}
```

Ordering matters: a `PATCH` on a task created offline must not overtake its `POST`. Draining strictly by `createdAt` and stopping on the first transient failure preserves causality.

Badge the outbox length in the UI with `useLiveQuery` — Dexie's `liveQuery` is cross-tab: *"Mutated rangesets are also broadcast across browsing contexts to wake up liveQueries in other tabs or workers."*

```tsx
import { useLiveQuery } from 'dexie-react-hooks';
const pendingCount = useLiveQuery(() => db.outbox.count(), [], 0);
```

`liveQuery` signature: `export function liveQuery<T>(querier: () => T | Promise<T>): Observable<T>;`

### 5.5 Background Sync — nice to have, never load-bearing

```js
// register
async function syncLater() {
  const registration = await navigator.serviceWorker.ready;
  try { await registration.sync.register('femho-outbox'); }
  catch { /* not supported */ }
}

// service worker
self.addEventListener('sync', (event) => {
  if (event.tag === 'femho-outbox') event.waitUntil(flushOutboxInSW());
});
```

MDN classifies the Background Synchronization API as **"Limited availability … not Baseline and does not work in some of the most widely-used browsers"**, secure-context only. In practice that means Chromium yes, Safari no, Firefox no.

**Therefore:** register a background sync *opportunistically*, but the real flush trigger must be the belt-and-braces set that works everywhere:

```ts
window.addEventListener('online', flushOutbox);
document.addEventListener('visibilitychange', () => { if (!document.hidden) flushOutbox(); });
setInterval(() => { if (navigator.onLine) flushOutbox(); }, 30_000);
// plus: on successful SSE reconnect (§11)
```

### 5.6 Local-first sync engines — the serious evaluation

All eight named options, with what was actually verified:

| Option | npm / version | Licence | Server requirement | Android story | Verdict for Fem-ho |
|---|---|---|---|---|---|
| **ElectricSQL** | `@electric-sql/client` **1.5.25** | Apache-2.0 | Postgres with **logical replication** + a separate **Electric HTTP service** | TypeScript client only; no Kotlin SDK | **Read-path only.** Docs: *"a read-path sync engine for Postgres. It syncs data out of Postgres into local clients over HTTP using a primitive called a Shape."* Writes go through *your own* API. |
| **PowerSync** | `@powersync/web` **2.1.1** | Apache-2.0 | `journeyapps/powersync-service` Docker image + Postgres (logical replication) | **Kotlin/Android SDK exists**, plus JS Web, Dart/Flutter, RN, Swift, Node | The only option with first-class web **and** Kotlin. See below. |
| **Zero (Rocicorp)** | `@rocicorp/zero` **1.8.0** | Apache-2.0 | `zero-cache` + Postgres | Web-only | Genuinely impressive query model, but web-only and young. |
| **Triplit** | `@triplit/client` **1.0.50** | **AGPL-3.0-only** | Triplit server | Web/JS | AGPL is a hard blocker for a self-hosted product others will run and modify. |
| **RxDB** | `rxdb` **17.4.0** | Apache-2.0 (core; **premium plugins are paid**) | replication protocol you implement | Web/JS + RN | Sane, but you write the replication endpoints yourself — that's most of the work with none of the guarantees. |
| **TinyBase** | `tinybase` **9.3.0** | MIT | none (BYO persister/synchronizer) | Web/JS | A reactive store, not a sync engine. Would still need the whole protocol. |
| **Yjs** | `yjs` **13.6.32** | MIT | y-websocket / y-sweet | `y-crdt` Rust bindings exist; Kotlin path is not first-class (**UNVERIFIED**) | CRDT for *collaborative text*. Task boards are not text. |
| **Automerge** | `@automerge/automerge-repo` **2.5.6** | MIT | automerge-repo sync server | Rust core, Kotlin bindings **UNVERIFIED** | Same as Yjs; heavier docs model, large history growth. |

**Why not PowerSync, despite it being the best fit on paper.** It is genuinely tempting: Docker-deployable (`journeyapps/powersync-service`), Postgres source, sync rules for per-user partitioning (which maps well to scopes and collective/individual membership), an upload queue to your own backend for writes, and — uniquely — both a JS Web SDK and a Kotlin/Android SDK, so web and Android could share one sync model.

The costs, stated plainly:

1. **A third container.** Fem-ho's whole value proposition is `docker compose up` on a home server. Adding PowerSync means Postgres + API + PowerSync Service + a sync-rules YAML the user must never touch but that must be versioned with the schema.
2. **Logical replication.** The Postgres container needs `wal_level=logical` and a replication slot. A replication slot that stops being consumed (container down for a week — very plausible on a home NAS) **retains WAL indefinitely and can fill the disk**. That is a nasty failure mode to hand a self-hoster.
3. **Two sources of truth for authorisation.** Fem-ho has a rich permission model (scopes individual/collective, per-scope CalDAV, per-scope API/MCP tokens, human vs AI tokens, guest share links). With PowerSync, read permissions are expressed *again* in sync rules, separately from the API's authorisation. Two places to get wrong, and share-link guests can't use the sync engine at all.
4. **Self-hosted dashboard is unavailable** (documented limitation), so debugging sync rules is log-diving.
5. **It solves a problem the web client doesn't have.** Desktop web is online. Mobile web needs "the last board I looked at, plus queue my edits" — which is 200 lines of Dexie outbox, already written above.
6. Full-schema local mirroring is the wrong shape for a family task manager with unbounded history: the audit trail ("s'ha de registrar qualsevol moviment") grows forever and must **not** be synced to every device.

**Why not ElectricSQL.** It is read-path only by its own description, so you write the entire write path anyway. It would give beautifully cheap live reads over HTTP — and its API is pleasantly simple:

```
GET /v1/shape?table=tasks&offset=-1
GET /v1/shape?table=tasks&live=true&handle=3833821-1721812114261&offset=0_0
```
Params: `table`, `offset` (`-1` initial, `now` skip history, or a log offset), `handle`, `live`, `live_sse`, `log` (`full` | `changes_only`), `replica`.
Response header: `electric-offset` (and `electric-handle`).
Message shape: `{"headers":{"operation":"insert|update|delete"},"key":…,"value":{…}}`, control messages `{"headers":{"control":"up-to-date|must-refetch|snapshot-end"}}`.

But it still needs the Electric service container + logical replication, and gives Android nothing.

**What Fem-ho should build instead.** The Electric *idea* — a monotonic change log consumed with an offset — is exactly right, and Fem-ho's own API can expose it in ~150 lines of backend:

```
GET /api/v1/sync?since=<cursor>&scopes=personal,familia
→ { changes: [{op:'upsert'|'delete', entity:'task', id, data, updatedAt}], cursor: '…', hasMore: false }

GET /api/v1/stream               (SSE, Last-Event-ID header)
→ event: change
   data: {"entity":"task","id":"018f…","op":"upsert","actor":"user:3","rev":1841}
```

Both clients (web + Kotlin) consume the same two endpoints. Same protocol, no extra container, permissions enforced once in the API, share-link guests unaffected.

### RECOMMENDATION — Offline

- **PWA with Workbox (`injectManifest`), a Dexie outbox, TanStack Query persisted to IndexedDB.** No local-first sync engine.
- Offline capability tiers, be explicit in the UI (a Plou `Tag` in the top bar):
  - **Read**: last-seen board, inbox, current month's events, pinned checklists — always available offline.
  - **Write**: create task, edit task fields, move between columns, tick checklist items, complete tasks — queued.
  - **Blocked offline**: creating/rotating share links, changing CalDAV config, MCP token management, admin/user management, file uploads > threshold. Grey these out with `opacity: 0.45` (the DS's own disabled value from `Button.jsx`) and a "Cal connexió" tag.
- Implement `/api/v1/sync?since=` + SSE `/api/v1/stream` as the shared protocol with Android. Design them **now**, before either client is written.
- Revisit PowerSync only if a second, harder requirement appears — e.g. multi-day fully-offline field use, or a desktop Electron client. Write that trigger condition down.

---

## 6. Drag and drop

### 6.1 The three candidates, current status

| | version | licence | notes |
|---|---|---|---|
| `@dnd-kit/core` | **6.3.1** | MIT | the stable, widely-deployed generation; with `@dnd-kit/sortable@10.0.0`, `@dnd-kit/modifiers@9.0.0`, `@dnd-kit/utilities@3.2.2`, `@dnd-kit/accessibility@3.1.1` |
| `@dnd-kit/react` | **0.5.0** | MIT | the *next* generation (`@dnd-kit/dom@0.5.0`, `@dnd-kit/abstract@0.5.0`, `@dnd-kit/state@0.5.0`, `@dnd-kit/geometry@0.5.0`, `@dnd-kit/helpers@0.5.0`) — **still pre-1.0**. `next.dndkit.com` now 301s to `dndkit.com`, i.e. the new docs are the main docs, but the packages are 0.x. |
| `@atlaskit/pragmatic-drag-and-drop` | **2.0.2** | **Apache-2.0** | + `-hitbox@2.0.0`, `-auto-scroll@3.0.0`, `-react-drop-indicator@4.1.1` |
| `sortablejs` | **1.15.7** | MIT | imperative, mutates the DOM, fights React's reconciliation |

Pragmatic's README, verbatim on the two points that matter most:

- *"Works everywhere: Full feature support in Firefox, Safari, and Chrome, iOS and Android"*
- *"Pragmatic drag and drop can be used with any view layer (react, svelte, vue, angular and so on)"*
- Core package ≈ **4.7 kB**.

This directly refutes the common assumption that Atlassian's library (built on the HTML5 DnD API) is desktop-only.

### 6.2 Accessibility — the real differentiator, in both directions

- **dnd-kit** ships keyboard DnD out of the box: a `KeyboardSensor`, `screenReaderInstructions` and `announcements` via `@dnd-kit/accessibility`. You get a working keyboard board with ~10 lines of config.
- **Pragmatic** deliberately does not: it gives you accessibility *utilities* to compose, and expects you to implement keyboard interaction yourself.

Atlassian's own guidance (and Jira/Trello's shipped behaviour) is that the accessible path for a board is **not** "keyboard-emulated dragging" but an **explicit move action**: focus a card, press a key or open its menu, choose *"Mou a → Fent"* / *"Mou amunt / avall"*. This is measurably better for screen-reader users than simulated drag, because it is a discrete, announced state change instead of a spatial operation.

**Fem-ho needs the explicit-move menu regardless of library**, because the product spec already says every card carries per-fer/fent buttons: *"està guai que cada targeta tingui el botó per fer i fent, però en la versió web s'haurien de poder arrossegar"* — buttons on every card, dragging additionally on web. So the accessible path is a product requirement, not an a11y tax. That removes dnd-kit's main advantage.

### 6.3 Touch behaviour

The mobile-web board must scroll horizontally between the four columns **and** allow long-press-to-drag a card. These conflict. Rules:

- Cards get `touch-action: manipulation` (not `none`) so vertical page scroll still works; Pragmatic's element adapter starts the drag from the native long-press.
- The column strip gets `overflow-x: auto; scroll-snap-type: x mandatory;` and each column `scroll-snap-align: start;`.
- Use `@atlaskit/pragmatic-drag-and-drop-auto-scroll` so dragging a card to the edge scrolls the strip.
- On mobile, **prefer the explicit move buttons**. Long-press drag on a horizontally-snapping strip is fiddly on any library; the Android app will use the same button-first interaction, which is exactly the "feels identical" goal.

### 6.4 Core wiring (Pragmatic, cross-column kanban)

```tsx
// src/features/board/TaskCard.tsx
import { useEffect, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview';
import { pointerOutsideOfPreview } from '@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview';

export function TaskCard({ task }: { task: Task }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = ref.current!;
    return draggable({
      element: el,
      getInitialData: () => ({ type: 'task', taskId: task.id, fromStatus: task.status }),
      onGenerateDragPreview({ nativeSetDragImage }) {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: pointerOutsideOfPreview({ x: '8px', y: '8px' }),
          render({ container }) {
            container.style.cssText =
              'border-radius:var(--radius-card-sm);background:var(--card-bg);' +
              'box-shadow:var(--card-shadow);padding:var(--pad-tile-lg);' +
              'font:600 var(--text-body)/1.2 var(--font-sans);color:var(--ink);max-width:260px';
            container.textContent = task.title;
          },
        });
      },
      onDragStart: () => setDragging(true),
      onDrop:      () => setDragging(false),
    });
  }, [task.id, task.status, task.title]);

  return (
    <div ref={ref}
         data-task-id={task.id}
         style={{ opacity: dragging ? 0.4 : 1, cursor: 'grab' }}>
      …
    </div>
  );
}
```

Note the `getOffset: pointerOutsideOfPreview({x:'8px',y:'8px'})` — Atlassian documents a Windows-specific constraint that *"Previews wider or taller than 280px receive significantly reduced opacity on Windows across all browsers"*, hence `max-width:260px` on the custom preview.

```tsx
// src/features/board/BoardColumn.tsx
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { autoScrollForElements } from '@atlaskit/pragmatic-drag-and-drop-auto-scroll/element';

useEffect(() => {
  const el = listRef.current!;
  return combine(
    dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data.type === 'task',
      getData: () => ({ type: 'column', status }),
      onDragEnter: () => setOver(true),
      onDragLeave: () => setOver(false),
      onDrop:      () => setOver(false),
    }),
    autoScrollForElements({ element: el }),
  );
}, [status]);
```

Per-card drop targets carry the edge so you know *where* in the column:

```tsx
dropTargetForElements({
  element: cardEl,
  getData: ({ input, element }) =>
    attachClosestEdge({ type: 'card', taskId: task.id, status: task.status }, {
      input, element, allowedEdges: ['top', 'bottom'],
    }),
});
```

Board-level monitor turns a drop into the mutation:

```tsx
// src/features/board/Board.tsx
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

useEffect(() => monitorForElements({
  canMonitor: ({ source }) => source.data.type === 'task',
  onDrop({ source, location }) {
    const target = location.current.dropTargets[0];
    if (!target) return;

    const taskId = source.data.taskId as string;

    if (target.data.type === 'column') {
      move.mutate({ taskId, toStatus: target.data.status as Status });   // append to end
      return;
    }
    const edge = extractClosestEdge(target.data);       // 'top' | 'bottom'
    const overId = target.data.taskId as string;
    move.mutate({
      taskId,
      toStatus: target.data.status as Status,
      ...(edge === 'top' ? { beforeId: overId } : { afterId: overId }),
    });
  },
}), [move]);
```

`beforeId`/`afterId` feed `generateKeyBetween` in §4.3 — the drop resolves to a fractional position with no sibling rewrites.

### 6.5 Keyboard move (the accessible path)

```tsx
function useCardKeyboardMove(task: Task) {
  const move = useMoveTask(filter);
  const order: Status[] = ['inbox', 'todo', 'doing', 'done'];
  return (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const i = order.indexOf(task.status);
    if (e.key === 'ArrowRight' && i < 3) { e.preventDefault(); move.mutate({ taskId: task.id, toStatus: order[i+1] }); announce(t`Moguda a ${label(order[i+1])}`); }
    if (e.key === 'ArrowLeft'  && i > 0) { e.preventDefault(); move.mutate({ taskId: task.id, toStatus: order[i-1] }); announce(t`Moguda a ${label(order[i-1])}`); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); move.mutate({ taskId: task.id, toStatus: task.status, beforeId: prevSiblingId }); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move.mutate({ taskId: task.id, toStatus: task.status, afterId:  nextSiblingId }); }
  };
}
```

`announce()` writes to a single shared `aria-live="assertive"` region — see §13.

### RECOMMENDATION — Drag & drop

- **`@atlaskit/pragmatic-drag-and-drop@2.0.2`** + `-hitbox@2.0.0` + `-auto-scroll@3.0.0`. Apache-2.0, ~4.7 kB, explicit iOS/Android support, framework-agnostic (so the same mental model survives if the DS ever moves).
- Do **not** adopt `@dnd-kit/react@0.5.0` — pre-1.0 for the app's most load-bearing interaction.
- Do **not** use SortableJS — it mutates the DOM under React.
- Build the **explicit move affordance first** (per-card buttons + `Ctrl/Cmd+Arrow`), then layer drag on top for pointer users. This is both the product spec and the accessible design.
- Persist order with fractional indexing; one `PATCH` per drop.
- On mobile-web, drag is a bonus; buttons are the primary path — matching Android.

---

## 7. Calendar

### 7.1 Requirements restated

Month / week / day; multi-source events (Fem-ho tasks with a date, Fem-ho events, and read-only events pulled from external CalDAV per scope); **drag a task from the Inbox column onto a day**; per-scope dot indicators; Catalan i18n; dark theme driven by CSS variables; a dynamic Inbox side column that is the *same* Inbox as the tasks view.

### 7.2 Candidates

| Library | version | licence reality |
|---|---|---|
| **FullCalendar** | `@fullcalendar/core` **7.0.2**, `@fullcalendar/react` **7.0.2** | Standard bundle + non-premium plugins are **MIT**. Verified plugin split below. |
| **Schedule-X** | `@schedule-x/calendar` **4.6.1**, `@schedule-x/react` **4.1.0** | Core MIT, **but drag-and-drop is premium** |
| **react-big-calendar** | **1.20.0** | MIT, healthy release cadence |
| **Toast UI Calendar** | `@toast-ui/calendar` **2.1.3** | MIT but **last published ~4 years ago** — effectively unmaintained |
| Hand-rolled | — | month grid is a weekend; week/day time grid with overlap resolution + DST is not |

**FullCalendar licence, precisely.** From `fullcalendar.io/license`: the non-premium plugins and main bundle are **MIT**, which *"permits a wide range of use, including free use in commercial projects"* with copyright headers preserved. Premium (`fullcalendar-scheduler`) requires a commercial licence for for-profit entities; AGPLv3-compliant open-source projects may use premium free (AGPLv3 replaced GPLv3 as of v7); other OSS projects may use premium if they avoid vendoring premium code and leave `schedulerLicenseKey` undefined.

Plugin split (verified from the plugin index):

| MIT / free | Premium (`fullcalendar-scheduler`) |
|---|---|
| `@fullcalendar/daygrid` (month + dayGrid views) | `@fullcalendar/scrollgrid` |
| `@fullcalendar/timegrid` (week/day time grid) | `@fullcalendar/timeline` |
| `@fullcalendar/list` | `@fullcalendar/adaptive` (print) |
| `@fullcalendar/multimonth` | `@fullcalendar/resource-daygrid` |
| `@fullcalendar/interaction` (dateClick, select, event drag-n-drop, external drag) | `@fullcalendar/resource-timegrid` |
| `@fullcalendar/rrule` | `@fullcalendar/resource-timeline` |
| `@fullcalendar/icalendar` | |
| `@fullcalendar/google-calendar` | |
| `@fullcalendar/react`, `/vue3`, `/angular`, `/preact`, `/web-component` | |

**Everything Fem-ho needs is MIT.** Month/week/day = daygrid + timegrid. Drag-to-schedule = interaction. Recurring events = rrule. External CalDAV feeds = icalendar. Fem-ho has no "resources", so it never touches premium. State this in the repo's `LICENSES.md` so nobody accidentally imports `@fullcalendar/resource-timegrid`.

**Schedule-X is disqualified on licence economics for this app.** Its premium list (verified from its own pricing page) is:
`@schedule-x/drag-and-drop` ⭐, `@schedule-x/resize` ⭐, `@schedule-x/interactive-event-modal` ⭐, `@schedule-x/sidebar` ⭐, `@schedule-x/drag-to-create` ⭐, `@schedule-x/draw` ⭐, `@schedule-x/scheduling-assistant` ⭐, `@schedule-x/resource-scheduler` ⭐, `@schedule-x/time-grid-resource-view` ⭐ — at **€479/year** or **€999 lifetime** (+VAT, 2–3 developers).
Drag-to-schedule is a core Fem-ho interaction (drag a task from the Inbox onto a day). Paying €479/yr for a self-hosted family task manager is not sensible, and shipping the app *without* drag would break the product. Schedule-X is otherwise excellent — Preact-based (`preact@^10.19.2` + `@preact/signals@^2.0.2` peers), Temporal-native, clean config — and would be the pick if drag were free.

react-big-calendar is maintained and MIT, but has no external-drag primitive as polished as FullCalendar's `Draggable`, and its date-localizer story (moment/date-fns/luxon adapters) is more surface area than v7 FullCalendar's built-in Temporal handling.

### 7.3 FullCalendar v7 specifics that change the code

Verified from the v6→v7 changelog:

- **`temporal-polyfill` is a peer dependency across all FullCalendar packages.** `temporal-polyfill@1.0.3`. Named time zones (`timeZone: 'Europe/Madrid'`) now work **without** a connector plugin.
- `@fullcalendar/luxon`, `/luxon2`, `/luxon3`, `/moment`, `/moment-timezone` are removed/deprecated; formatting-only equivalents are `@fullcalendar/format-luxon3` and `@fullcalendar/format-moment`.
- Bootstrap 4/5 theme packages discontinued.
- The React connector is *"fully implemented in React, including working SSR and StrictMode"* (v6 rendered Preact internally). `@fullcalendar/react@7.0.2` peers: `react: "^17 || ^18 || ^19"`, `react-dom` likewise. Depends on `@fullcalendar/core@7.0.2` and `@full-ui/headless-calendar@7.0.2`.
- **Theming was overhauled.** The old `--fc-*` custom properties were refactored/renamed and *"developers can no longer style `fc-*` class names directly"*; there is now a formal theme system plus `className` and content-injection render hooks. Four stock themes ship: **Monarch** (Material 3-ish), **Forma** (Fluent-ish), **Breezy** (Tailwind Plus-ish), **Pulse** (Apple-ish), all with dark mode.
  **UNVERIFIED:** the exact list of v7 CSS custom property names. The v7 `css-customization` docs page 404'd during research. **Action for the implementer: read `https://fullcalendar.io/docs` → CSS/theming section before writing the theme layer, and do not assume any `--fc-*` name from v6.**
- Locale data shape changed; `weekText` → `weekTextShort`.
- `timeZone` accepts a named zone directly.

### 7.4 Wiring

```tsx
// src/features/calendar/CalendarView.tsx
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import caLocale from '@fullcalendar/core/locales/ca';

export function CalendarView() {
  const { scopes, view, date } = Route.useSearch();
  const navigate = Route.useNavigate();
  const scheduleTask = useScheduleTask();

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      initialView={{ month: 'dayGridMonth', week: 'timeGridWeek', day: 'timeGridDay' }[view]}
      initialDate={date}
      locale={caLocale}
      firstDay={1}                     // dilluns
      timeZone="Europe/Madrid"         // v7: named zone, no connector plugin
      headerToolbar={false}            // Fem-ho renders its own Plou SegmentedControl
      height="100%"
      expandRows
      dayMaxEventRows={3}
      nowIndicator
      editable                         // drag existing events
      droppable                        // accept external drags (tasks from the Inbox)
      eventSources={eventSources}      // one source per selected scope, see below
      eventClassNames={(arg) => [`scope-${arg.event.extendedProps.scopeId}`]}
      eventDidMount={(arg) => {
        // per-scope dot: colour comes from a CSS var set on the wrapper, never inline hex
        arg.el.style.setProperty('--event-dot', `var(--scope-${arg.event.extendedProps.scopeId})`);
      }}
      datesSet={(arg) => navigate({ search: (p) => ({ ...p, date: fmt(arg.start) }) })}
      dateClick={(arg) => setInboxDate(arg.dateStr)}   // clicking a day drives the Inbox column
      drop={(info) => {
        const taskId = info.draggedEl.dataset.taskId!;
        scheduleTask.mutate({ taskId, date: info.dateStr, allDay: info.allDay });
      }}
      eventDrop={(info) => rescheduleEvent(info.event.id, info.event.startStr)}
      eventReceive={(info) => info.revert()}   // we own the row; never let FC create it
    />
  );
}
```

**Multi-source events, one source per scope**, which is exactly how per-scope colouring and toggling should work:

```ts
const eventSources = scopes.map((scopeId) => ({
  id: scopeId,
  events: (info, success, failure) =>
    api.get(`/api/v1/events?scope=${scopeId}&from=${info.startStr}&to=${info.endStr}`)
       .then((r) => success(r.events)).catch(failure),
  className: `fc-scope-${scopeId}`,
  extendedProps: { scopeId },
}));
```

Read-only external CalDAV feeds can be added as `@fullcalendar/icalendar` sources when the server proxies them, or (preferred) normalised server-side into the same `/api/v1/events` response with a `readOnly: true` flag so the client never has to know.

**Drag a task from the Inbox onto a day** uses `Draggable` from `@fullcalendar/interaction`:

```ts
import { Draggable } from '@fullcalendar/interaction';

useEffect(() => {
  const el = inboxListRef.current!;
  const d = new Draggable(el, {
    itemSelector: '[data-task-id]',
    eventData: (taskEl) => ({
      title: taskEl.dataset.taskTitle!,
      create: false,            // do NOT let FullCalendar create the event
    }),
  });
  return () => d.destroy();
}, []);
```

`create: false` means the `drop` callback fires but `eventReceive` does not create a row — Fem-ho's mutation is the single source of truth, and the optimistic update comes from TanStack Query. Other `Draggable` options available: `longPressDelay`, `minDistance`, `appendTo`.

**Conflict with Pragmatic DnD.** The Inbox column is a drop target for the kanban (Pragmatic, HTML5 DnD) *and* a drag source for the calendar (FullCalendar's `Draggable`, its own pointer-based system). These two can both attach to the same elements, but the safe design is: **only instantiate FullCalendar's `Draggable` when the Calendar view is active** (`view === 'calendar'`), and only instantiate Pragmatic's `draggable()` when the Tasks view is active. With `<Activity mode="hidden">` keeping both mounted, gate on the visible flag.

### 7.5 Theming FullCalendar into Plou

Because v7 forbids styling `fc-*` classes directly, do this:

1. Pick the stock theme closest to Plou — **Pulse** (Apple-like minimal) is the nearest to Plou's pill-and-soft-shadow language; **Monarch** (Material 3) also plausible since Plou's easings are Material 3 (`--ease-standard: cubic-bezier(0.2,0,0,1)` is annotated *"Material 3 emphasised-decelerate"* in `motion.css`).
2. Override the theme's CSS custom properties (names **UNVERIFIED** — read the v7 theming docs) by mapping them to Plou tokens in one file:

```css
/* src/features/calendar/fc-theme.css  — the ONLY place FullCalendar internals are touched */
.femho-calendar {
  /* map FullCalendar v7 theme vars → Plou tokens. Names must be checked against v7 docs. */
  --fc-page-bg-color:        transparent;
  --fc-border-color:         var(--divider);
  --fc-neutral-text-color:   var(--ink-soft);
  --fc-today-bg-color:       var(--gradient-wash-cool);
  --fc-now-indicator-color:  var(--kicker);
  font-family: var(--font-sans);
  color: var(--ink);
}
```

3. Everything else via `eventContent` / `dayCellContent` render hooks that return **your own Plou-styled React nodes**, so almost no FullCalendar chrome remains visible:

```tsx
eventContent={(arg) => (
  <div className={styles.event}>
    <span className={styles.dot} data-scope={arg.event.extendedProps.scopeId} />
    <span className={styles.time}>{arg.timeText}</span>
    <span className={styles.title}>{arg.event.title}</span>
    {arg.event.extendedProps.aiMode !== 'self' && <AiBadge mode={arg.event.extendedProps.aiMode} />}
  </div>
)}
```

Dark mode is automatic: `data-theme="dark"` on `<html>` changes `--divider`, `--ink`, etc., which the mapping file forwards.

### RECOMMENDATION — Calendar

- **FullCalendar 7.0.2**, MIT plugins only: `@fullcalendar/react`, `/core`, `/daygrid`, `/timegrid`, `/list`, `/interaction`, `/rrule` (+ `/icalendar` only if the client fetches feeds directly). Install `temporal-polyfill@1.0.3` as the required peer.
- **Never install `fullcalendar-scheduler` or any `@fullcalendar/resource-*`, `/timeline`, `/scrollgrid`, `/adaptive`.** Add these to a dependency-deny list in CI. Record in `LICENSES.md`: *"Fem-ho uses only MIT FullCalendar plugins; no scheduler licence key is required or configured."*
- Render Fem-ho's own header (Plou `SegmentedControl` for Mes/Setmana/Dia + Plou `IconButton` arrows), `headerToolbar={false}`.
- One `eventSource` per selected scope → per-scope dots and instant toggling when chips change.
- External drag via `Draggable` with `eventData: { create: false }`; the mutation owns the write.
- Gate FullCalendar `Draggable` and Pragmatic `draggable()` on which view is visible.
- Read the v7 theming docs before writing `fc-theme.css`; do not port v6 `--fc-*` names.
- Confirm `@fullcalendar/core/locales/ca` exists and check what it yields for `weekTextShort` — **UNVERIFIED** for v7 (v6 shipped a `ca` locale; the v7 locale data shape changed).

---

## 8. Responsive strategy — one codebase, two shells

### 8.1 The requirement, from the spec

*"la UI web ha de ser responsive i la versió web mòbil ha de ser gairebé igual o igual a la mobile app"* — the mobile web version must be nearly identical or identical to the mobile app.

So: **mobile-web is not a shrunken desktop. It is a web reimplementation of the Android layout.**

### 8.2 Two shells, shared features

```
AppShell
├── DesktopShell   (≥ 900px)   top bar (switch + chips + project + "+" + profile)
│                              4-column grid, Inbox as a distinct panel
└── MobileShell    (< 900px)   compact top bar (title + chips row, horizontally scrollable)
                               horizontally snapped column strip
                               floating Plou TabBar at the bottom (safe-area aware)
                               FAB "+" above the TabBar
```

Both render the **same** `<BoardColumn>`, `<TaskCard>`, `<InboxPanel>`, `<QuickAdd>` components. Only the shell differs. Choose the shell with a **media query, not JS**, so there is no hydration flash:

```tsx
// src/app/AppShell.tsx  — both rendered, CSS decides. Avoids layout thrash on resize.
<>
  <div className={styles.desktopOnly}><DesktopShell>{children}</DesktopShell></div>
  <div className={styles.mobileOnly}><MobileShell>{children}</MobileShell></div>
</>
```

…is wrong (double-mounts every feature). Instead use a single JS breakpoint hook driven by `matchMedia`, memoised, with the shell chosen once:

```ts
// src/hooks/useShell.ts
import { useSyncExternalStore } from 'react';

const mq = window.matchMedia('(min-width: 900px)');
const subscribe = (cb: () => void) => { mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb); };
export const useIsDesktop = () => useSyncExternalStore(subscribe, () => mq.matches, () => true);
```

`useSyncExternalStore` is the correct primitive (no effect-driven flash, tear-free with concurrent rendering).

### 8.3 Container queries vs media queries — use both, for different jobs

| Use | Mechanism |
|---|---|
| Which **shell** (desktop chrome vs mobile chrome) | **media query** — it's a viewport-level decision |
| How a **`TaskCard`** lays out (does the assignee avatar sit inline or wrap? do the scope + project tags both fit?) | **container query** — the same card appears in a 280px kanban column, a 340px Inbox panel, a full-width mobile column and a narrow calendar day cell |
| How the **Inbox panel** arranges itself (left/right column vs bottom drawer) | media query + the user's `inboxSide` setting |

Container query syntax (verified from MDN):

```css
/* the column establishes the containment context */
.column { container: taskcol / inline-size; }

.card { display: grid; grid-template-columns: 1fr; gap: var(--space-2); }

@container taskcol (width > 300px) {
  .card { grid-template-columns: 1fr auto; align-items: start; }
  .card .meta { flex-direction: row; }
}
@container taskcol (width < 220px) {
  .card .projectTag { display: none; }   /* keep only the scope dot */
}
```

Shorthand `container: <name> / <type>`; types are `size`, `inline-size`, `normal`. Units available: `cqw`, `cqh`, `cqi`, `cqb`, `cqmin`, `cqmax`.

This is the correct tool precisely because a `TaskCard`'s available width has **no fixed relationship to the viewport** in Fem-ho — the Inbox width is user-configurable and the number of visible kanban columns changes with the scope selection.

### 8.4 The mobile column strip (mirrors Android)

```css
/* src/app/MobileShell.module.css */
.strip {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: calc(100vw - var(--space-14));   /* one column + a peek of the next */
  gap: var(--gap-grid);
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x mandatory;
  scroll-padding-inline: var(--space-7);
  padding-inline: var(--space-7);
  /* space for the floating TabBar + the device gesture bar */
  padding-bottom: calc(var(--switcher-height) + var(--switcher-inset) * 2 + env(safe-area-inset-bottom));
  scrollbar-width: none;
}
.strip > * { scroll-snap-align: start; }
.strip::-webkit-scrollbar { display: none; }
```

The "peek of the next column" (`calc(100vw - var(--space-14))` = viewport minus 32px) is what makes it read as a swipeable board rather than four separate screens — the same affordance the Android `ViewPager`/`HorizontalPager` gives.

### 8.5 Viewport units and safe areas

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

`viewport-fit=cover` is **required** for `env(safe-area-inset-*)` to ever be non-zero.

Verified `env()` variables: `safe-area-inset-top|right|bottom|left`, and the newer static counterparts `safe-area-max-inset-top|right|bottom|left`. Also available: `keyboard-inset-top|right|bottom|left|width|height` (Virtual Keyboard API), `titlebar-area-x|y|width|height` (desktop PWA `window-controls-overlay`), `viewport-segment-*` (foldables), `preferred-text-scale`. **Names are case-sensitive** — `SAFE-AREA-INSET-LEFT` silently falls back.

Height units, in order of preference for the app shell:

```css
.appShell {
  height: 100dvh;                /* dynamic viewport: shrinks when the URL bar shows */
  min-height: 100svh;            /* small viewport as a floor */
  display: grid;
  grid-template-rows: auto 1fr;
  padding-top: env(safe-area-inset-top);
}
```

`100vh` is wrong on mobile Safari and on Android Chrome with a collapsing URL bar. Use `dvh` for the shell; use `svh`/`lvh` only when you specifically need the collapsed/expanded extreme.

The floating `TabBar` from the DS already positions itself at `bottom: var(--switcher-inset)` (18px). Wrap it so it clears the gesture bar:

```css
.tabbarHost { position: fixed; inset-inline: 0; bottom: env(safe-area-inset-bottom, 0px); z-index: 40; }
```

The Virtual Keyboard inset matters for quick-add: when the Catalan keyboard opens on a phone, the composer must sit above it.

```css
.quickAddBar {
  position: fixed;
  bottom: calc(env(keyboard-inset-height, 0px) + env(safe-area-inset-bottom));
}
```
plus, in JS: `if ('virtualKeyboard' in navigator) navigator.virtualKeyboard.overlaysContent = true;`
(**UNVERIFIED** browser coverage for `keyboard-inset-*` outside Chromium; fall back to `visualViewport.resize` listeners.)

### 8.6 Touch targets

- Minimum **44×44 px** (WCAG 2.2 SC 2.5.8 Target Size (Minimum) is 24×24 CSS px; Apple HIG says 44pt; Android says 48dp). Take **48px** as the house minimum for anything on the mobile shell.
- The DS already helps: `--tab-hit: 52px`, `--icon-btn: 38px`. **`--icon-btn` at 38px is below the bar for touch.** Wrap DS `IconButton`s in a 48px hit area on mobile rather than editing the DS:
  ```css
  @media (pointer: coarse) {
    .iconBtnHost { display: grid; place-items: center; min-width: 48px; min-height: 48px; }
  }
  ```
- Use `@media (pointer: coarse)` / `(hover: hover)` rather than width to decide hover affordances — a touchscreen laptop is wide *and* coarse.
- `-webkit-tap-highlight-color: transparent` on interactive elements, replaced by the DS's `--press-scale: 0.97` press transform which `Button.jsx` already implements.

### RECOMMENDATION — Responsive

- Single breakpoint at **900px** choosing between `DesktopShell` and `MobileShell`, resolved with `useSyncExternalStore` + `matchMedia`. All feature components shared.
- **Container queries** for `TaskCard`, `EventChip`, `ChecklistRow`, `InboxItem`. Media queries only for the shell and the Inbox placement.
- `viewport-fit=cover`, `100dvh`, `env(safe-area-inset-*)` on the top bar and the TabBar host.
- Mobile column strip: `grid-auto-flow: column`, `scroll-snap-type: x mandatory`, one-column-plus-peek width — this is the visual signature that makes mobile-web read as the Android app.
- 48px minimum touch targets, enforced with a `@media (pointer: coarse)` wrapper class rather than by forking DS components.
- Build the mobile shell **first**, then widen. Doing it the other way round always produces a squashed desktop.

---

## 9. Realtime updates

### 9.1 Transport: SSE, not WebSocket

For a self-hosted family app, **Server-Sent Events** is the right transport:

- One-way is all Fem-ho needs (writes go over normal `fetch`).
- It rides plain HTTP/1.1 or HTTP/2 — no proxy special-casing, which matters when the user fronts the container with nginx/Caddy/Cloudflare Tunnel.
- Automatic reconnection with `Last-Event-ID` is built into the protocol and maps exactly onto the `/api/v1/sync?since=` cursor.
- Trivial to implement in any backend, and trivially inspectable with `curl`.

Native `EventSource` cannot send an `Authorization` header. Two options:
1. Auth via cookie (works with native `EventSource`).
2. Use `@microsoft/fetch-event-source@2.0.1` (MIT) which is `fetch`-based and supports headers, POST bodies, and page-visibility-aware retry.

```ts
// src/api/stream.ts
import { fetchEventSource } from '@microsoft/fetch-event-source';

export function startStream(queryClient: QueryClient, token: string, signal: AbortSignal) {
  let lastId: string | null = localStorage.getItem('femho.lastEventId');

  return fetchEventSource('/api/v1/stream', {
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(lastId ? { 'Last-Event-ID': lastId } : {}),
    },
    openWhenHidden: false,               // pause in background tabs, resume on focus
    async onopen(res) {
      if (res.ok) { void flushOutbox(); return; }   // reconnection is a good moment to drain
      if (res.status === 401) throw new FatalError('unauthorised');
      throw new Error(`stream ${res.status}`);
    },
    onmessage(ev) {
      if (ev.id) { lastId = ev.id; localStorage.setItem('femho.lastEventId', ev.id); }
      const change = JSON.parse(ev.data) as ChangeEvent;
      applyChange(queryClient, change);
    },
    onerror(err) {
      if (err instanceof FatalError) throw err;     // stop retrying
      return 5000;                                  // retry after 5s
    },
  });
}
```

### 9.2 Applying a change without clobbering optimistic state

```ts
function applyChange(qc: QueryClient, c: ChangeEvent) {
  // ignore echoes of our own mutations (the server stamps actorSessionId)
  if (c.actorSessionId === SESSION_ID) return;

  switch (c.entity) {
    case 'task':
      qc.setQueryData(qk.task(c.id), c.op === 'delete' ? undefined : c.data);
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['inbox'] });
      break;
    case 'event':
      qc.invalidateQueries({ queryKey: ['events'] });
      break;
    case 'checklist':
      qc.invalidateQueries({ queryKey: qk.checklist(c.id) });
      break;
  }
}
```

Critical: **do not `setQueryData` on the board directly from a stream event while a mutation is in flight.** `invalidateQueries` respects TanStack Query's own in-flight/optimistic bookkeeping; a raw `setQueryData` can overwrite an optimistic move and make the card jump back and forth. If invalidation is too chatty, debounce it (e.g. `throttle(invalidate, 400)`), which is also correct when the AI user makes a burst of changes.

### 9.3 AI-user changes need visible provenance

The spec requires an audit trail and visible indication of autonomous changes. When a stream event has `actorType: 'ai'`:

- flash the affected card with a 600ms `outline` in `--gradient-brand`'s mid stop (respecting `prefers-reduced-motion`, see §13.5),
- increment a "canvis recents" counter in the top bar,
- append to a `useRecentChanges` Zustand slice so the change-history drawer can show it without a refetch.

### RECOMMENDATION — Realtime

- **SSE at `GET /api/v1/stream`**, `Last-Event-ID` honoured, event ids monotonic and identical to the `/api/v1/sync?since=` cursor. Same endpoint consumed by Android.
- `@microsoft/fetch-event-source@2.0.1` on web (header auth + `openWhenHidden: false`).
- Server stamps every change with `actorType` (`user` | `ai` | `guest` | `caldav`), `actorId`, `actorSessionId`. The client drops its own echoes by `actorSessionId`.
- Reconnect → drain the outbox → invalidate. That triple is the whole offline→online recovery.
- Never `setQueryData` the board from the stream; always `invalidateQueries`.

---

## 10. Quick-add with inline `@` and `#` autocomplete

### 10.1 The interaction

Typing in a single-line composer:
- `@` opens a person picker → assigns
- `#` opens a scope/project picker; `#Feina` routes to the scope's general space, `#Feina/Salt` routes to a project
- everything else is the title
- Enter submits; the parsed tokens are stripped or rendered as chips

This is the **combobox with list autocomplete** pattern anchored to the caret, not to the input.

### 10.2 ARIA contract (verbatim from the W3C ARIA APG)

Textbox (the `<input>`):
- `role="combobox"`
- `aria-autocomplete="list"` — *"indicates that the autocomplete behavior of the text input is to suggest a list of possible values in a popup"*
- `aria-controls="ID_REF"` — identifies the popup
- `aria-expanded="true|false"`
- `aria-activedescendant="ID_REF"` — the focused option while keyboard-navigating

Popup:
- `role="listbox"` with `aria-label`
- options: `role="option"`, `aria-selected="true"` on the highlighted one

Keyboard: Down/Up arrows navigate (with wrapping), Enter selects and closes, Escape closes (or clears), Home/End/Left/Right return focus to the textbox, printable characters filter.

**Focus never leaves the input.** That is the whole point of `aria-activedescendant`.

### 10.3 Implementation

```tsx
// src/features/quickadd/QuickAdd.tsx
import { useFloating, offset, flip, shift, autoUpdate } from '@floating-ui/react';

type Trigger = { char: '@' | '#'; start: number; query: string };

export function QuickAdd({ defaultStatus }: { defaultStatus: Status }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const listboxId = useId();

  const items = useAutocompleteItems(trigger);          // people or scopes/projects
  const open = trigger !== null && items.length > 0;

  // caret-anchored positioning via a zero-size virtual element
  const { refs, floatingStyles } = useFloating({
    open,
    placement: 'bottom-start',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  useEffect(() => {
    if (!open || !inputRef.current) return;
    const rect = caretRect(inputRef.current);           // see §10.4
    refs.setPositionReference({ getBoundingClientRect: () => rect });
  }, [open, value, refs]);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    setTrigger(detectTrigger(v, e.target.selectionStart ?? v.length));
    setActive(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(items[active]); return; }
      if (e.key === 'Escape')    { e.preventDefault(); setTrigger(null); return; }
    }
    if (e.key === 'Enter') submit();
  }

  return (
    <>
      <input
        ref={(n) => { inputRef.current = n; refs.setReference(n); }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${listboxId}-opt-${active}` : undefined}
        aria-label={t`Afegeix una tasca ràpidament`}
        placeholder={t`Nova tasca…  @persona  #Àmbit/Projecte`}
        className="plou-input"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        autoComplete="off"
        enterKeyHint="done"
      />
      {open && (
        <ul id={listboxId} role="listbox"
            aria-label={trigger!.char === '@' ? t`Persones` : t`Àmbits i projectes`}
            ref={refs.setFloating} style={floatingStyles} className={styles.popup}>
          {items.map((it, i) => (
            <li key={it.id} id={`${listboxId}-opt-${i}`} role="option"
                aria-selected={i === active}
                className={i === active ? styles.optActive : styles.opt}
                onMouseDown={(e) => { e.preventDefault(); accept(it); }}>
              {it.icon}<span>{it.label}</span>{it.hint && <em>{it.hint}</em>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

`onMouseDown` with `preventDefault` (not `onClick`) — otherwise the input blurs before the selection registers.

`@floating-ui/react@0.27.20` (MIT) handles flip/shift so the popup never leaves the viewport — essential on a phone where the composer sits just above the keyboard.

### 10.4 Caret position in a plain `<input>`

`<input>` exposes no caret rect. The mirror-div technique:

```ts
// src/features/quickadd/caretRect.ts
const MIRROR_PROPS = ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing',
  'textTransform','wordSpacing','textIndent','paddingLeft','paddingRight',
  'paddingTop','paddingBottom','borderLeftWidth','borderRightWidth',
  'borderTopWidth','borderBottomWidth','boxSizing'] as const;

export function caretRect(input: HTMLInputElement): DOMRect {
  const pos = input.selectionStart ?? input.value.length;
  const cs = getComputedStyle(input);
  const mirror = document.createElement('div');
  for (const p of MIRROR_PROPS) mirror.style[p as any] = cs[p as any];
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
    left: '0', top: '0', width: `${input.clientWidth}px`,
  });
  mirror.textContent = input.value.slice(0, pos);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const inputRect = input.getBoundingClientRect();
  const m = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const x = inputRect.left + (m.left - mirrorRect.left) - input.scrollLeft;
  const y = inputRect.top;
  document.body.removeChild(mirror);

  return new DOMRect(x, y, 0, inputRect.height);
}
```

If this proves fragile, the alternative is a `contenteditable` composer where the caret rect comes free from `window.getSelection().getRangeAt(0).getBoundingClientRect()` — at the cost of handling paste sanitisation and IME. **Start with `<input>` + mirror**; escalate only if needed.

### 10.5 The parser

The parser must be **shared with the Android client** in behaviour, so specify it precisely and test it as a pure function:

```ts
// src/features/quickadd/parse.ts
export interface Parsed {
  title: string;
  assignees: string[];        // user ids
  scopeSlug?: string;
  projectSlug?: string;
  dueDate?: string;           // ISO date, from "demà", "dl", "5/9"
  unresolved: string[];       // tokens that matched nothing → keep in the title
}

const TOKEN = /(^|\s)([@#])([\p{L}\p{N}_\-·ŀ]+(?:\/[\p{L}\p{N}_\-·ŀ]+)?)/gu;
```

`\p{L}` with the `u` flag is required for Catalan (`à è é í ï ò ó ú ü ç` and the geminated `ŀl`). An ASCII-only `\w` regex silently breaks `#Família`.

Rules:
- `#Scope` → scope general space; `#Scope/Project` → project. Match case-insensitively and accent-insensitively (`familia` matches `Família`) using `localeCompare(a, b, 'ca', { sensitivity: 'base' })`.
- If a `#` token resolves to nothing, **leave it in the title** and show it as an unresolved chip with a "crear àmbit?" affordance — never silently drop user text.
- **Scope is mandatory, project is optional** (product rule: *"pot ser que un àmbit tingui una tasca sense projecte definit, però mai sense àmbit"*). If no `#` token and more than one scope chip is selected, the submit must open a tiny scope picker rather than guessing.
- In the Personal scope, `@` is disabled (all tasks belong to the logged-in user).

### RECOMMENDATION — Quick-add

- Single `<input role="combobox">` per column header, plus one in the top bar and one on the dashboard. Same component, different `defaultStatus`.
- Full APG combobox semantics; focus stays in the input; `aria-activedescendant` drives the highlight.
- `@floating-ui/react@0.27.20` anchored to a **caret virtual element**.
- Unicode-aware token regex; accent-insensitive Catalan matching.
- Parser is a pure, unit-tested function; publish its test fixtures so the Kotlin implementation can consume the same cases.
- Optimistic insert via the `variables` pattern (§4.4); client-generated UUIDv7.

---

## 11. Accessibility

### 11.1 Board semantics

There is no "kanban" ARIA role. The defensible mapping:

```tsx
<div className={styles.board} role="region" aria-label={t`Tauler de tasques`}>
  {columns.map((col) => (
    <section key={col.id} aria-labelledby={`col-${col.id}`} className={styles.column}>
      <h2 id={`col-${col.id}`} className={styles.colTitle}>
        {col.title} <span aria-hidden="true">·</span>
        <span className={styles.count}>{col.tasks.length}</span>
        <span className="sr-only">{t`${col.tasks.length} tasques`}</span>
      </h2>
      <ul className={styles.list}>
        {col.tasks.map((task) => (
          <li key={task.id}>
            <article
              tabIndex={0}
              aria-roledescription={t`targeta de tasca`}
              aria-label={`${task.title}, ${scopeName(task)}${task.project ? ', ' + task.project : ''}`}
              onKeyDown={onCardKeyDown}
            >…</article>
          </li>
        ))}
      </ul>
    </section>
  ))}
</div>
```

Do **not** use `role="list"`/`role="listitem"` on `<div>`s when `<ul>`/`<li>` are available. Do not put `role="application"` anywhere — it disables screen-reader browse mode and makes the board *less* usable.

### 11.2 Keyboard-first board

| Key | Action |
|---|---|
| `Tab` | move between columns' first focusable element |
| `↑` / `↓` | move focus between cards within a column (roving tabindex) |
| `←` / `→` | move focus between columns, preserving row index where possible |
| `Ctrl/Cmd + ←/→` | **move the focused card** to the previous/next column |
| `Ctrl/Cmd + ↑/↓` | reorder the focused card within its column |
| `Enter` | open the full edit modal |
| `Space` | toggle done |
| `n` | focus the quick-add of the current column |
| `/` | focus the global search |
| `Escape` | close modal / clear the autocomplete popup |

Implement a **roving tabindex** inside each column (exactly one card has `tabIndex={0}`, the rest `-1`), not `tabIndex={0}` on every card — otherwise tabbing through a 40-card column is punishing.

Announce every move through one shared live region:

```tsx
// src/a11y/Announcer.tsx
export function Announcer() {
  const msg = useAnnouncement();
  return <div aria-live="assertive" aria-atomic="true" className="sr-only">{msg}</div>;
}
```
```css
.sr-only {
  position:absolute; width:1px; height:1px; padding:0; margin:-1px;
  overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0;
}
```

Messages in Catalan: *"«Comprar pa» moguda de Per fer a Fent, posició 2 de 5."*

### 11.3 Modals

The task edit modal, share-link modal and settings dialogs must:
- use `<dialog>` with `showModal()` **or** a focus trap; `<dialog>` gives the top layer, inert background and `Escape` for free, and is now broadly supported. The DS's `Dialog.jsx` is a plain `div` — wrap it, don't rewrite it:
  ```tsx
  <dialog ref={dlgRef} className={styles.dlg} onClose={onClose} aria-labelledby={titleId}>
    <PlouDialog … />
  </dialog>
  ```
  ```css
  .dlg { border:none; padding:0; background:transparent; max-width:min(560px, calc(100vw - var(--space-14))); }
  .dlg::backdrop { background: var(--dialog-backdrop); }
  ```
  `--dialog-backdrop` is `rgba(20,20,30,0.45)` light / `rgba(0,0,0,0.55)` dark — already in `theme.css`.
- move focus to the dialog (its heading or first field) on open, and **return focus to the trigger** on close. Store the trigger element in a ref before opening.
- label with `aria-labelledby` pointing at the visible title, never a redundant `aria-label`.
- On mobile, render as a bottom sheet (`--radius-dialog: 28px` on the top corners only) — same component, container-query-driven.

### 11.4 Colour contrast — a real problem the DS has

Computed WCAG contrast ratios for the Plou accent stops (sRGB, WCAG 2.x formula):

| Accent | Stop | vs `#ffffff` | vs ink `#14151a` |
|---|---|---|---|
| **sunset** (default) | `#6EA8FF` | **2.41** | 7.56 |
| | `#FF9D4D` | **2.06** | 8.84 |
| | `#FF6FA0` | **2.61** | 6.97 |
| **soft** | `#A9C9FF` | 1.68 | 10.84 |
| | `#FFC79A` | 1.51 | 12.06 |
| | `#FFB1C8` | 1.70 | 10.74 |
| **mono-warm** | `#FF9C4F` | **2.08** | 8.79 |
| | `#FF8C6D` | **2.28** | 8.01 |
| | `#FF7B8B` | **2.48** | 7.34 |
| **mono-cool** | `#8FC0FF` | 1.88 | 9.68 |
| | `#5A93F0` | **3.06** | 5.96 |
| | `#3B6FD6` | **4.74** | 3.85 |

Reference values: ink `#14151a` on white = **18.23**; `--kicker` `#e0793a` on white = **3.01** (fails AA for normal text, passes only as large/bold ≥18.66px bold or ≥24px); dark ink `#f5f6fa` on `#12131a` = **17.15**; dark kicker `#FF9D4D` on `#12131a` = **8.98**.

**Findings:**

1. The DS sets `--on-brand: #fff` for the *sunset* and *mono-warm* accents. **White text on those gradients fails WCAG AA everywhere** — 2.06–2.61:1, below even the 3:1 large-text threshold. The `soft` accent already flips `--on-brand` to `#14151a` (the DS comment says *"Pastel can't carry white text — the brand fill flips to ink here."*) and reaches 10.7–12.1:1.
2. `mono-cool` is the only accent whose darkest stop (`#3B6FD6`, 4.74:1) passes AA for normal text against white.
3. `--kicker` `#e0793a` at 3.01:1 on white must only ever be used at the DS's intended size — `--text-kicker: 10.5px` uppercase, which is **normal-size text** and therefore fails. This is a genuine defect in light theme.

**What Fem-ho must do about it** (without forking Plou):

- Add a settings toggle **"Contrast alt"** that sets `data-contrast="high"` on the root, and ship one Fem-ho-owned stylesheet that overrides only the failing pairs:
  ```css
  [data-contrast="high"] {
    --on-brand: #14151a;                     /* ink on every gradient, all accents */
    --kicker: #a8501d;                       /* 5.4:1 on white — recompute if changed */
    --ink-soft: rgba(20,22,30,0.72);
  }
  [data-contrast="high"][data-theme="dark"] {
    --on-brand: #14151a;
    --kicker: #FFB877;
    --ink-soft: rgba(245,246,250,0.78);
  }
  ```
- **Never** put small text on `--gradient-brand`. The gradient is for a *single* large, bold primary action per view (§3.6) whose label is `--text-body-sm` 13.5px bold — still failing at 2.06:1. For that one button, add a text shadow or, better, default `--on-brand` to ink for Fem-ho:
  ```css
  /* src/styles/femho-overrides.css — loaded AFTER accents.css */
  :root, [data-accent="mono-warm"] { --on-brand: #14151a; }
  ```
  Verify visually against the Plou reference screens before committing; this is a deliberate, documented deviation from Plou, and it should be recorded in the repo.
- The per-scope dots (`--dot-1/2/3`) are decorative colour. **Never encode scope by colour alone** — every scope indicator must carry a text label or an initial. This is WCAG 1.4.1 Use of Colour, and it also fixes the >3-scopes problem from §3.6.
- Same for AI mode (self / assisted / delegated): use a distinct **icon shape** per mode plus a `title`/`aria-label`, not just a colour.

### 11.5 `prefers-reduced-motion` — already handled, don't break it

`tokens/motion.css`, verbatim:

```css
:root{
  --dur-instant:120ms; --dur-fast:180ms; --dur-base:240ms; --dur-slow:320ms;
  --ease-standard:cubic-bezier(0.2,0,0,1);   /* Material 3 emphasised-decelerate */
  --ease-out:cubic-bezier(0.05,0.7,0.1,1);
  --ease-in-out:cubic-bezier(0.4,0,0.2,1);
  --press-scale:0.97;
  --hover-lift:translateY(-1px);
}
@media (prefers-reduced-motion:reduce){
  :root{--dur-instant:0ms; --dur-fast:0ms; --dur-base:0ms; --dur-slow:0ms}
}
```

So **every duration in Fem-ho must be `var(--dur-*)`**. A hardcoded `transition: 200ms` bypasses the DS's reduced-motion handling. Note the DS zeroes *durations*, not transforms — `--press-scale` still applies, which is correct (a scale with 0ms duration is instantaneous, not animated).

Additionally guard anything the DS can't reach:

```ts
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// FullCalendar view transitions, card flash-on-remote-change, auto-scroll easing
```

Pragmatic DnD's auto-scroll and drop animations should be attenuated when reduced motion is on.

### 11.6 Other

- **Zoom/reflow:** WCAG 2.1 SC 1.4.10 requires no horizontal scrolling at 320px width / 400% zoom for content. The kanban's horizontal strip is *intentional* horizontal scroll, which the SC exempts for content requiring 2D layout — but the **top bar, modals and settings must reflow**. Test at 320×256 CSS px.
- **Focus visibility:** the DS defines no focus ring. Add one globally, from tokens:
  ```css
  :where(a, button, [tabindex], input, select, textarea):focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
    border-radius: inherit;
  }
  ```
  Using `--ink` (18.23:1 on white, 17.15:1 on dark panel) guarantees the 3:1 focus-indicator contrast in both themes; a brand-gradient ring would not.
- **`lang`:** `<html lang="ca">`, and `lang="es"`/`lang="en"` on any user content known to be otherwise. Screen readers need this to pronounce Catalan.
- **Share-link pages** are used by non-technical guests. They get the strictest treatment: single column, 48px targets, no drag, plain checkboxes, visible labels.

### RECOMMENDATION — Accessibility

- Semantic `<section>`/`<h2>`/`<ul>`/`<li>` board, roving tabindex, `Ctrl/Cmd+Arrow` moves, one assertive live region announcing every move in Catalan.
- Native `<dialog>` + `showModal()` wrapping the DS `Dialog`; restore focus to the trigger.
- **Ship a `data-contrast="high"` mode**, and seriously consider defaulting `--on-brand` to ink app-wide — white on the Plou gradient is a documented 2.06:1 failure.
- Never encode scope or AI-mode by colour alone.
- Every duration is `var(--dur-*)`; never hardcode ms.
- Add a global `:focus-visible` ring using `--ink`.
- Add `@axe-core/playwright` to the E2E suite and fail CI on serious/critical violations for: board, calendar, modal, quick-add popup, share page.

---

## 12. i18n

### 12.1 Library choice

Candidates and current versions:

| | version | licence | format |
|---|---|---|---|
| `@lingui/core` / `@lingui/react` | **6.6.0** | MIT | ICU MessageFormat, `.po` catalogs, compile step |
| `i18next` / `react-i18next` | **26.3.6** / **17.0.11** | MIT | own interpolation; ICU only via `i18next-icu` plugin |
| `@formatjs/intl` (react-intl) | **4.1.18** | MIT (BSD-3 for react-intl) | ICU MessageFormat, JSON |

**Choose Lingui 6.6.0.** Reasons specific to Fem-ho:

1. **ICU MessageFormat natively**, no plugin. Catalan plural rules (`one`/`other`, verified via `Intl.PluralRules('ca')`) and gendered `select` are needed: *"{count, plural, one {# tasca} other {# tasques}}"*, and assignee sentences differ by gender in Catalan.
2. **Macros mean the source text IS the message.** For an AI writing most of the code, this is decisive — there is no separate key namespace to invent and get wrong:
   ```tsx
   import { Trans, Plural, useLingui } from '@lingui/react/macro';

   <Trans>Cap tasca per avui</Trans>
   <Plural value={n} one="# tasca pendent" other="# tasques pendents" />
   ```
   With i18next the AI must invent `t('board.empty.today')` **and** remember to add it to the JSON. It routinely does one and not the other. Lingui's extraction is mechanical: `lingui extract`.
3. **`.po` catalogs** — *"standard PO file, which is supported by almost all translation tools"*. Weblate/Poedit work out of the box, which matters if the community translates Fem-ho to es/en.
4. Compile step produces optimised JS modules, so runtime parsing cost is near zero.

Lingui packages needed: `@lingui/core@6.6.0`, `@lingui/react@6.6.0`, `@lingui/cli@6.6.0`, `@lingui/vite-plugin@6.6.0`, `@lingui/babel-plugin-lingui-macro@6.6.0`.

```js
// lingui.config.js
export default {
  locales: ['ca', 'es', 'en'],
  sourceLocale: 'ca',
  fallbackLocales: { default: 'ca' },
  catalogs: [{ path: '<rootDir>/src/locales/{locale}/messages', include: ['src'] }],
  format: 'po',
};
```

```ts
// src/i18n.ts
import { i18n } from '@lingui/core';

export async function activateLocale(locale: 'ca' | 'es' | 'en') {
  const { messages } = await import(`./locales/${locale}/messages.po`);
  i18n.loadAndActivate({ locale, messages });
  document.documentElement.lang = locale;
}
```

**Catalan is the source locale.** Write the UI strings in Catalan directly in the JSX; `es` and `en` are translations. This is the right call because the product owner writes Catalan, and it means the app is fully usable with zero catalogs loaded.

### 12.2 Dates and numbers — native `Intl`, not a date library

`Intl` already produces exactly what the spec asks for. **Verified by running Node with the `ca` locale on 2026-08-05:**

```
new Intl.DateTimeFormat('ca',{weekday:'short'}) over Sun..Sat
  → dg. dl. dt. dc. dj. dv. ds.

new Intl.DateTimeFormat('ca',{month:'long'}) over Jan..Dec
  → gener febrer març abril maig juny juliol agost setembre octubre novembre desembre

dateStyle:'full'                 → dimecres, 5 d'agost del 2026
dateStyle:'medium', timeStyle:'short' → 5 d'ag. 2026, 15:30
timeStyle:'short'                → 15:30
Intl.RelativeTimeFormat('ca',{numeric:'auto'})
  -1 day → ahir       +1 day → demà       +2 day → demà passat
Intl.ListFormat('ca')            → Personal, Feina i Família
Intl.NumberFormat('ca')          → 1.234.567,89
Intl.PluralRules('ca').select(1|2) → one | other
```

Every requirement in the brief is satisfied by the platform:
- weekday abbreviations **dg. dl. dt. dc. dj. dv. ds.** — note the **trailing period**, which the CLDR data includes. If the design calls for `dl` without the dot, strip it explicitly: `fmt.format(d).replace(/\.$/, '')`. Do not hand-roll the array.
- month names are **lowercase** — correct Catalan orthography, and it comes for free.
- `d'agost` correctly elides `de` before a vowel; `de gener`, `de febrer` do not. A hand-rolled formatter will get this wrong.
- `demà passat` for +2 days is a genuinely nice touch for the Inbox header.

**Recommendation: do not install `date-fns` or `luxon` for formatting.** Do install a small helper module:

```ts
// src/i18n/dates.ts
const CA = 'ca-ES';
const TZ = 'Europe/Madrid';   // per-user setting; default from Intl.DateTimeFormat().resolvedOptions().timeZone

const cache = new Map<string, Intl.DateTimeFormat>();
const fmt = (opts: Intl.DateTimeFormatOptions) => {
  const k = JSON.stringify(opts);
  let f = cache.get(k);
  if (!f) { f = new Intl.DateTimeFormat(CA, { timeZone: TZ, ...opts }); cache.set(k, f); }
  return f;
};

export const weekdayShort = (d: Date) => fmt({ weekday: 'short' }).format(d).replace(/\.$/, '');
export const monthLong    = (d: Date) => fmt({ month: 'long' }).format(d);
export const dayFull      = (d: Date) => fmt({ dateStyle: 'full' }).format(d);       // dimecres, 5 d'agost del 2026
export const dayMedium    = (d: Date) => fmt({ day: 'numeric', month: 'short' }).format(d);
export const timeShort    = (d: Date) => fmt({ timeStyle: 'short' }).format(d);      // 15:30, 24h

const rtf = new Intl.RelativeTimeFormat(CA, { numeric: 'auto' });
export function relativeDay(target: Date, now = new Date()): string {
  const days = Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000);
  if (Math.abs(days) <= 2) return rtf.format(days, 'day');   // ahir / avui / demà / demà passat
  return dayMedium(target);
}
```

**Caching `Intl.DateTimeFormat` instances matters.** Constructing one per cell in a month grid with ~200 event chips is a measurable cost.

**Date arithmetic**, as opposed to formatting: use **Temporal** via `temporal-polyfill@1.0.3`, which FullCalendar 7 already requires as a peer dependency. One polyfill, two consumers, no `date-fns`.

```ts
import { Temporal } from 'temporal-polyfill';
const today = Temporal.Now.plainDateISO('Europe/Madrid');
const nextWeek = today.add({ weeks: 1 });
const isoDate = today.toString();                 // '2026-08-05'
```

`Temporal.PlainDate` is exactly right for Fem-ho's date-only tasks (*"Les tasques en principi no tenen hora"*) — it eliminates the classic "task due on the 5th shows on the 4th in a different timezone" bug that `Date` guarantees.

**First day of week:** `firstDay: 1` (dilluns) for Catalonia. `new Intl.Locale('ca').getWeekInfo()` returned **not available** in the Node runtime tested — treat `getWeekInfo`/`weekInfo` as **UNVERIFIED / not universally available** and hardcode `firstDay: 1` with a user setting.

### 12.3 Catalan-specific text handling

- **Sorting**: `arr.sort((a,b) => a.localeCompare(b, 'ca'))` — Catalan collation puts `ç` after `c` and handles `ŀl`. Never `arr.sort()`.
- **Search / autocomplete matching**: accent- and case-insensitive:
  ```ts
  const matches = (haystack: string, needle: string) =>
    haystack.localeCompare(needle, 'ca', { sensitivity: 'base', usage: 'search' }) === 0;
  // for substring search, normalise instead:
  const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  ```
  So typing `familia` finds `Família`, and `feina` finds `Feina`.
- **Fonts**: the `latin-ext` subset is mandatory (see §3, `@fontsource/roboto`) for `à è é í ï ò ó ú ü ç` and `ŀ`.
- **Fixed UI strings** (Catalan, to be used verbatim so both clients match):
  `Safata d'entrada` (Inbox) · `Per fer` · `Fent` · `Fet` · `Àmbits` · `Projectes` · `Llistes senzilles` · `Tasques` · `Calendari` · `Mes` / `Setmana` / `Dia` · `Avui` · `Ajustos` · `Perfil` · `Comparteix` · `Historial de canvis` · `Sense data` · `Nova tasca` · `Desa` · `Cancel·la` (note the `ŀ`) · `Elimina`.
  `Cancel·la` is the standard trap: it needs U+0140 `ŀ` (or `l·l`); the correct Catalan spelling is `Cancel·la` with a middot. Verify the font subset renders it.

### RECOMMENDATION — i18n

- **Lingui 6.6.0**, `sourceLocale: 'ca'`, ICU MessageFormat, `.po` catalogs, macros (`Trans`, `Plural`, `t`) so the AI writes Catalan text inline and extraction is mechanical.
- Ship `ca` only at v1; wire `es` and `en` catalogs but leave them untranslated. Locale is a per-user setting, defaulting to `navigator.language` narrowed to the supported set, falling back to `ca`.
- **All dates/numbers via native `Intl`, with cached formatter instances.** No `date-fns`, no `luxon`, no `moment`.
- **All date arithmetic via `Temporal`** (`temporal-polyfill@1.0.3`, already a FullCalendar peer). Tasks use `Temporal.PlainDate`; events use `Temporal.ZonedDateTime`.
- `firstDay: 1`, 24-hour clock, `Europe/Madrid` default timezone, all user-overridable.
- Every list sort and every autocomplete match goes through the Catalan collator / the `fold()` helper.

---

## 13. Folder structure

```
fem-ho-web/
├── Dockerfile                       # multi-stage: node build → nginx/caddy static serve
├── nginx.conf                       # SPA fallback + /api proxy + no-cache on index.html & sw.js
├── index.html
├── vite.config.ts
├── tsconfig.json
├── lingui.config.js
├── .oxlintrc.json                   # extends the Plou _adherence.oxlintrc.json
├── eslint.config.js
├── LICENSES.md                      # states: MIT FullCalendar plugins only, no scheduler key
├── public/
│   ├── icons/{192,512,maskable-512}.png
│   └── robots.txt                   # Disallow: /  (self-hosted, private)
└── src/
    ├── main.tsx
    ├── sw.ts                        # injectManifest service worker
    ├── pwa.ts                       # registerSW + update toast
    │
    ├── ds/                          # ⚠️ VENDORED PLOU — DO NOT EDIT
    │   ├── tokens/*.css             #    accents.css imported LAST
    │   ├── components/**/*.jsx
    │   ├── components/**/*.d.ts
    │   ├── _adherence.oxlintrc.json
    │   └── README-VENDORED.md       #    provenance + "regenerate, never patch"
    │
    ├── styles/
    │   ├── tokens.css               # the ordered @import list (§3.2)
    │   ├── femho-overrides.css      # documented deviations: --on-brand, high-contrast mode
    │   ├── reset.css
    │   └── globals.css              # :focus-visible, .sr-only, scrollbar, ::selection
    │
    ├── app/
    │   ├── router.tsx               # createRouter + queryClient in context
    │   ├── AppShell.tsx             # picks Desktop/Mobile shell via useIsDesktop()
    │   ├── DesktopShell.tsx
    │   ├── MobileShell.tsx
    │   ├── TopBar.tsx               # switch + scope chips + project dropdown + "+" + profile
    │   ├── BottomNav.tsx            # wraps DS TabBar, safe-area host
    │   ├── ThemeApplier.tsx         # data-theme / data-accent / data-contrast
    │   └── Providers.tsx            # PersistQueryClientProvider + I18nProvider + Announcer
    │
    ├── routes/                      # TanStack Router file-based
    │   ├── __root.tsx
    │   ├── login.tsx                # includes the server-URL field (parity with Android)
    │   ├── app.tsx                  # authed layout
    │   ├── app.index.tsx            # dashboard (global view, reached via the "Fem-ho" title)
    │   ├── app.tasques.tsx
    │   ├── app.calendari.tsx
    │   ├── app.llistes.$listId.tsx  # pinned simple checklist view
    │   ├── app.ajustos.tsx
    │   ├── app.ajustos.general.tsx
    │   ├── app.ajustos.calendaris.tsx
    │   ├── app.ajustos.mcp.tsx
    │   ├── app.ajustos.ia.tsx
    │   ├── app.ajustos.perfil.tsx
    │   ├── app.ajustos.ambits.tsx
    │   ├── app.ajustos.compartits.tsx
    │   ├── app.ajustos.admin.tsx
    │   └── s.$token.tsx             # PUBLIC share link — no auth, no SW nav caching
    │
    ├── api/
    │   ├── client.ts                # fetch wrapper: base URL, bearer, Idempotency-Key, errors
    │   ├── keys.ts                  # query key factory
    │   ├── queryClient.ts
    │   ├── stream.ts                # SSE
    │   ├── schemas.ts               # zod schemas = the API contract
    │   └── endpoints/{tasks,events,scopes,projects,checklists,shares,users,settings}.ts
    │
    ├── offline/
    │   ├── db.ts                    # Dexie: outbox
    │   ├── outbox.ts                # enqueue / flush / retry policy
    │   ├── persister.ts             # idb-keyval async persister
    │   └── useOnline.ts
    │
    ├── features/
    │   ├── board/
    │   │   ├── Board.tsx            # monitorForElements, columns layout
    │   │   ├── BoardColumn.tsx      # dropTargetForElements + autoScroll
    │   │   ├── TaskCard.tsx         # draggable + custom preview
    │   │   ├── ScopeGroup.tsx       # collapsible per-scope epigraph
    │   │   ├── useMoveTask.ts       # optimistic + rollback + fractional index
    │   │   ├── useBoardKeyboard.ts  # roving tabindex + Ctrl+Arrow moves
    │   │   └── Board.module.css
    │   ├── inbox/
    │   │   ├── InboxPanel.tsx       # shared between tasks & calendar views
    │   │   ├── InboxDateNav.tsx
    │   │   └── useInbox.ts
    │   ├── calendar/
    │   │   ├── CalendarView.tsx     # FullCalendar wrapper
    │   │   ├── fc-theme.css         # ONLY place FullCalendar internals are touched
    │   │   ├── eventSources.ts      # one source per scope
    │   │   ├── useExternalDrag.ts   # FullCalendar Draggable on the Inbox
    │   │   └── EventChip.tsx
    │   ├── quickadd/
    │   │   ├── QuickAdd.tsx         # role=combobox
    │   │   ├── MentionPopup.tsx     # role=listbox
    │   │   ├── caretRect.ts
    │   │   ├── parse.ts             # @ / # parser — pure, shared spec with Android
    │   │   └── parse.test.ts        # fixtures also consumed by the Kotlin tests
    │   ├── task/
    │   │   ├── TaskModal.tsx        # full edit: scope, project, people, deadline, AI mode, files
    │   │   ├── SubtaskList.tsx
    │   │   ├── AiModeSelector.tsx   # self / assisted / delegated
    │   │   └── HistoryDrawer.tsx    # audit trail
    │   ├── checklists/
    │   │   ├── SimpleListView.tsx   # pinned list, not a kanban
    │   │   └── PinnedListsMenu.tsx  # the button right of the tasks/calendar switch
    │   ├── share/
    │   │   ├── SharePage.tsx        # public, guest-name prompt, password gate
    │   │   └── ShareLinkDialog.tsx  # expiry, password, require-name
    │   ├── settings/…
    │   └── auth/
    │       ├── LoginForm.tsx        # email + password + SERVER URL
    │       └── useSession.ts
    │
    ├── components/                  # Fem-ho primitives built from Plou tokens
    │   ├── Toast.tsx  Avatar.tsx  Checkbox.tsx  Combobox.tsx
    │   ├── Modal.tsx (native <dialog>)  BottomSheet.tsx  EmptyState.tsx
    │   ├── ScopeChip.tsx  ScopeDot.tsx  ProjectDropdown.tsx  DatePicker.tsx
    │   └── *.module.css
    │
    ├── i18n/
    │   ├── index.ts                 # activateLocale
    │   ├── dates.ts                 # cached Intl formatters + Temporal helpers
    │   └── collate.ts               # localeCompare('ca') + fold()
    │
    ├── store/
    │   ├── ui.ts                    # theme, accent, contrast, inboxSide, collapsed groups
    │   └── session.ts
    │
    ├── a11y/
    │   ├── Announcer.tsx
    │   └── useAnnouncement.ts
    │
    ├── hooks/
    │   ├── useShell.ts              # useSyncExternalStore + matchMedia
    │   ├── useReducedMotion.ts
    │   └── useFocusReturn.ts
    │
    └── locales/{ca,es,en}/messages.po
```

**Two hard rules for the AI that will write this:**
1. **`src/ds/` is read-only.** Every deviation from Plou goes in `src/styles/femho-overrides.css` with a comment explaining why.
2. **`src/features/calendar/fc-theme.css` is the only file allowed to reference `fc-` or `--fc-`.** Everything else touches FullCalendar through props and render hooks.

---

## 14. Dependency list with verified versions

All versions read from `registry.npmjs.org` on **2026-08-05**.

### Runtime

```jsonc
{
  "dependencies": {
    "react": "19.2.8",
    "react-dom": "19.2.8",

    "@tanstack/react-router": "1.170.19",
    "@tanstack/react-query": "5.101.4",
    "@tanstack/react-query-persist-client": "5.101.4",
    "@tanstack/query-async-storage-persister": "5.101.4",
    "@tanstack/react-virtual": "3.14.9",          // only if a column exceeds ~200 cards

    "zustand": "5.0.14",
    "zod": "4.4.3",

    "dexie": "4.4.4",                              // Apache-2.0
    "dexie-react-hooks": "4.4.0",                  // Apache-2.0
    "idb-keyval": "6.3.0",                         // Apache-2.0

    "@atlaskit/pragmatic-drag-and-drop": "2.0.2",              // Apache-2.0
    "@atlaskit/pragmatic-drag-and-drop-hitbox": "2.0.0",       // Apache-2.0
    "@atlaskit/pragmatic-drag-and-drop-auto-scroll": "3.0.0",  // Apache-2.0
    "fractional-indexing": "4.0.0",                            // CC0-1.0

    "@fullcalendar/core": "7.0.2",
    "@fullcalendar/react": "7.0.2",
    "@fullcalendar/daygrid": "7.0.2",
    "@fullcalendar/timegrid": "7.0.2",
    "@fullcalendar/list": "7.0.2",
    "@fullcalendar/interaction": "7.0.2",
    "@fullcalendar/rrule": "7.0.2",
    "temporal-polyfill": "1.0.3",                  // REQUIRED peer of FullCalendar 7

    "@floating-ui/react": "0.27.20",

    "@lingui/core": "6.6.0",
    "@lingui/react": "6.6.0",

    "@microsoft/fetch-event-source": "2.0.1",

    "lucide-react": "1.28.0",                      // ISC — only if PLOU_ICONS lacks a needed glyph
    "@fontsource/roboto": "^5"                     // UNVERIFIED exact version; self-hosted Roboto 400/500/700/900, latin + latin-ext
  }
}
```

**Note on `@fullcalendar/*` sub-packages:** only `@fullcalendar/core@7.0.2` and `@fullcalendar/react@7.0.2` were version-verified directly against the registry. The sibling plugins are published in lockstep with `core`, so `7.0.2` is the expected version — **verify each at install time** (`npm view @fullcalendar/daygrid version`).

### Dev

```jsonc
{
  "devDependencies": {
    "typescript": "6.0.3",                         // NOT 7.x — see §2.2
    "vite": "8.2.0",
    "@vitejs/plugin-react": "6.0.5",
    "vite-plugin-pwa": "1.3.0",
    "vite-plugin-checker": "0.14.5",
    "@tanstack/router-plugin": "1.168.24",
    "@tanstack/react-router-devtools": "1.167.1",
    "@tanstack/react-query-devtools": "5.101.4",

    "@lingui/cli": "6.6.0",
    "@lingui/vite-plugin": "6.6.0",
    "@lingui/babel-plugin-lingui-macro": "6.6.0",

    "workbox-window": "7.4.1",
    "workbox-precaching": "7.4.1",
    "workbox-routing": "7.4.1",
    "workbox-strategies": "7.4.1",
    "workbox-expiration": "7.4.1",
    "workbox-cacheable-response": "7.4.1",
    "workbox-background-sync": "7.4.1",

    "@types/react": "19.2.18",
    "@types/react-dom": "^19",                     // UNVERIFIED exact patch

    "vitest": "4.1.10",
    "@playwright/test": "1.62.1",
    "@axe-core/playwright": "^4",                  // UNVERIFIED exact version

    "eslint": "10.8.0",
    "prettier": "3.9.6",
    "oxlint": "latest"                             // UNVERIFIED version; runs the Plou adherence config
  }
}
```

### Explicitly NOT installed, and why

| Package | Why not |
|---|---|
| `tailwindcss` | Second token system; cannot override the DS's inline styles. §3.4 |
| `date-fns`, `luxon`, `moment`, `dayjs` | Native `Intl` + `Temporal` cover everything, and Temporal is already a FullCalendar peer. §12.2 |
| `fullcalendar-scheduler`, `@fullcalendar/resource-*`, `/timeline`, `/scrollgrid`, `/adaptive` | Commercial licence required; Fem-ho needs none of them. §7.2 |
| `@schedule-x/drag-and-drop` and other ⭐ Schedule-X packages | €479/yr or €999 lifetime |
| `@triplit/client` | **AGPL-3.0-only** — unacceptable for a self-hosted product others will run and fork |
| `@dnd-kit/react` | Pre-1.0 (`0.5.0`) for the most load-bearing interaction |
| `sortablejs`, `react-beautiful-dnd` | DOM-mutating / deprecated |
| `@toast-ui/calendar` | `2.1.3`, last published ~4 years ago |
| `@electric-sql/client`, `@powersync/web`, `@rocicorp/zero`, `rxdb`, `tinybase`, `yjs`, `@automerge/*` | §5.6 — complexity outweighs benefit for this deployment shape |
| `axios` | Native `fetch` + a 60-line wrapper; smaller and works identically in the SW |

---

## 15. Implementation order (so the AI builds in a sane sequence)

1. Vite + TS 6 + Lingui + vendored `src/ds/` with the correct token import order. Render one Plou `Button` in both themes and all four accents. **Verify `accents.css`-last is actually working** (change accent, confirm shadows change).
2. `src/i18n/dates.ts` + `collate.ts` with unit tests asserting `dl/dt/dc/dj/dv/ds/dg` and lowercase months.
3. Auth: login with email + password + **server URL field** (parity with Android), session store, `api/client.ts` with `Idempotency-Key`.
4. TanStack Router shell + typed search params for scopes/project/date. Top bar with scope chips and project dropdown driving the URL.
5. **`MobileShell` first.** Column strip with scroll-snap, `TabBar`, safe areas. Then `DesktopShell`.
6. Board read-only from `/api/v1/board`, with `ScopeGroup` collapsibles and container-query `TaskCard`.
7. Quick-add + `@`/`#` parser + combobox popup. Optimistic create.
8. Card move: buttons + `Ctrl+Arrow` keyboard first, **then** Pragmatic drag. Fractional indexing. Rollback + toast.
9. Offline: Dexie outbox, `networkMode: 'offlineFirst'`, query persistence, SW with `registerType: 'prompt'`.
10. SSE stream + reconnect-drains-outbox.
11. Calendar view: FullCalendar with per-scope sources, own header, `fc-theme.css`. Then external drag from the Inbox.
12. Task edit modal, subtasks, simple checklists, pinning.
13. Share links (public route, outside the SW nav cache).
14. Settings (general/calendars/MCP/AI/profile/scopes/shares/admin).
15. A11y pass with `@axe-core/playwright`; high-contrast mode; reduced-motion audit.

---

## 16. Open questions for other dossiers

- **Backend must confirm**: `position TEXT` fractional index column, client-supplied UUIDv7 ids, `Idempotency-Key` header handling, `GET /api/v1/sync?since=` + `GET /api/v1/stream` (SSE with `Last-Event-ID`), and `actorType`/`actorSessionId` stamping on every change.
- **Android dossier must agree on**: the quick-add parser test fixtures, the outbox ordering semantics, `Temporal.PlainDate` for date-only tasks, and the exact Catalan UI strings.
- **Design must rule on**: whether `--on-brand` becomes ink app-wide (fixes a 2.06:1 contrast failure but changes the look of the one gradient button per view), and how per-scope dots extend beyond `--dot-1/2/3`.

---

## 17. UNVERIFIED items (do not treat as fact)

1. Exact date/scope of TypeScript 7.1's stable programmatic API, and whether `tsgo` remains invocable from the released `typescript` package. Sourced from ecosystem reporting, not from Microsoft's own release notes.
2. The exact list of FullCalendar **v7** CSS custom property names / the new theming API surface. The v7 `css-customization` docs URL returned 404 during research. **Read the live v7 theming docs before writing `fc-theme.css`.**
3. Whether `@fullcalendar/core/locales/ca` exists in v7 and what it produces for `weekTextShort` (the v7 changelog says locale data shape changed).
4. Exact published versions of `@fullcalendar/daygrid|timegrid|list|interaction|rrule` (assumed `7.0.2`, lockstep with `core`, but only `core` and `react` were queried).
5. `@fontsource/roboto`, `@types/react-dom`, `@axe-core/playwright`, `oxlint` exact versions.
6. Browser coverage for `env(keyboard-inset-*)` and `navigator.virtualKeyboard` outside Chromium.
7. `Intl.Locale.prototype.getWeekInfo()` availability — returned unavailable in the Node runtime tested; do not rely on it.
8. Kotlin/Android bindings maturity for Yjs (`y-crdt`) and Automerge.
9. Zero (Rocicorp) production-readiness statements and self-hosting details — the intro page did not cover licensing, self-hosting or non-web clients; npm reports `@rocicorp/zero@1.8.0`, Apache-2.0.
10. PowerSync Open Edition's precise licence text and feature limits beyond "the PowerSync Dashboard is currently not available when self-hosting".
11. Whether the Plou DS anticipates more than three scope dots (`--dot-1/2/3` are the only ones defined).
12. Schedule-X premium pricing was read as €479/yr and €999 lifetime (+VAT, 2–3 devs) — verify before citing commercially.

---

## 18. Sources

Fetched during this research (2026-08-05):

**Local (read from the provided archives, not the web)**
- `/Users/borja/Codi/fem-ho/Plou Design System.zip` → `SKILL.md`, `_ds_manifest.json`, `tokens/theme.css`, `tokens/accents.css`, `tokens/shape.css`, `tokens/motion.css`, `tokens/fonts.css`, `tokens/spacing.css`, `tokens/typography.css`, `tokens/utilities.css`, `components/core/Button.jsx`, `components/navigation/TabBar.jsx`
- `/Users/borja/Codi/fem-ho/Fem-ho app webmobile.zip` → file listing (`Fem-ho Mobile.dc.html`, `Fem-ho Web.dc.html`, `_ds/…`)
- `/Users/borja/Codi/fem-ho/instruccions.txt` (product spec, Catalan)
- Plou DS readme (scratchpad copy)

**npm registry** — `https://registry.npmjs.org/<pkg>/latest` and `https://registry.npmjs.org/-/v1/search?text=@dnd-kit`, for every version/licence figure in §14.

**Web**
- https://fullcalendar.io/license
- https://fullcalendar.io/docs/plugin-index
- https://fullcalendar.io/docs/external-dragging
- https://fullcalendar.io/docs/upgrading-from-v6
- https://schedule-x.dev/docs/frameworks/react
- https://schedule-x.dev/docs/calendar/configuration
- https://schedule-x.dev/premium
- https://dndkit.com/react/quickstart
- https://atlassian.design/components/pragmatic-drag-and-drop/about
- https://atlassian.design/components/pragmatic-drag-and-drop/web-platform-design-constraints
- https://github.com/atlassian/pragmatic-drag-and-drop
- https://tanstack.com/query/latest/docs/framework/react/plugins/persistQueryClient
- https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates
- https://tanstack.com/router/latest/docs/framework/react/comparison
- https://dexie.org/docs/liveQuery()
- https://vite-pwa-org.netlify.app/guide/
- https://vite-pwa-org.netlify.app/workbox/generate-sw.html
- https://electric.ax/docs/intro  (redirected from https://electric-sql.com/docs/intro)
- https://electric.ax/docs/api/http
- https://docs.powersync.com/intro/powersync-overview
- https://docs.powersync.com/self-hosting/getting-started
- https://zero.rocicorp.dev/docs/introduction
- https://lingui.dev/introduction
- https://react.dev/reference/react/useOptimistic
- https://react.dev/blog/2025/10/01/react-19-2
- https://developer.mozilla.org/en-US/docs/Web/CSS/env
- https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries
- https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-autocomplete-list/
- https://www.infoq.com/news/2026/08/typescript-7-released/  (TypeScript 7.0 / Go port; ecosystem-API caveat)

**Computed locally, not fetched**
- Catalan `Intl` output (weekday/month/date/relative/list/number/plural) — produced by running Node's `Intl` with locale `ca` on 2026-08-05.
- WCAG contrast ratios for the Plou accent stops — computed with the WCAG 2.x relative-luminance formula from the hex values in `tokens/accents.css` and `tokens/theme.css`.
