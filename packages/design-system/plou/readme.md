# Plou — Design System

**Plou** (Catalan, *"it's raining"*) is a precipitation-radar and rain-alarm app for Catalonia and the wider Spanish market. Its single job: tell you whether rain is about to reach a place you care about, and warn you before it does. It watches named locations, streams animated radar echoes from RainViewer, forecasts from Open-Meteo, and fires a full-screen warning when precipitation above a chosen intensity is heading your way.

The product exists on two surfaces, both rebuilt in this system:

| Surface | What it is |
| --- | --- |
| **Plou App** (Android) | Four tabs — Radar · Previsión · Alarmas · Ajustes — with a floating glass bottom switcher. Radar is a full-bleed map with all UI floating on top. |
| **Plou Web** (desktop) | The same four views in a sticky-sidebar shell; the radar becomes an edge-to-edge panel and its status cards move into the sidebar. |

Interface language is **Spanish (Castellano)**, with Català and English offered in settings. Place names stay in their native Catalan spelling (Navata, Cornellà del Terri, Figueres, Banyoles).

---

## Sources this system was built from

Everything here was read from source code, not screenshots:

- **Claude design project** `9c810319-a6e3-4ee0-ac38-e5fabf122db7` — <https://claude.ai/design/p/9c810319-a6e3-4ee0-ac38-e5fabf122db7>
  - `Plou Design System.dc.html` — the author's own written design spec (colour, type, shape, component rules, layout patterns, and a set of "rules for an AI generating new screens"). This is the primary ground truth; every token below is copied verbatim from it.
  - `Plou App.dc.html` — the full Android recreation, all four tabs plus alert and edit dialog.
  - `Plou Web.dc.html` / `Plou Web (standalone).html` — the desktop recreation.
  - `uploads/*.png` — screenshots of the **original, pre-redesign** Plou app (dark UI, cyan `#4DB8FF` accent, emoji tab icons, Google-Material style). Kept in `assets/reference-original-app-*.png` for product context only. **The redesign in the `.dc.html` files supersedes them** — do not copy the cyan/emoji look.
  - `assets/radar-map-tile.png` is the map band cropped out of one of those screenshots, reused as the radar tile image (`assets/radar-map-dark.png` keeps the uncropped original).

No Figma file, no production codebase, and **no logo file** were provided.

---

## No logo mark

Plou has no logotype or symbol in any source. The brand *is* the word **Plou** set in Roboto 900 — gradient-clipped on themed surfaces, flat white over the radar map. `Wordmark` implements exactly this. Do not draw, generate or approximate a mark. If a real logo exists, drop the SVG into `assets/logo.svg` and update `Wordmark.jsx`.

---

## Visual foundations

**Colour.** One gradient is the entire brand: `linear-gradient(135deg, #6EA8FF 0%, #FF9D4D 55%, #FF6FA0 100%)` — dawn blue → low sun → dusk pink. It appears **exactly once per view**, on the primary action or the active state (one primary button, or the active tab, or the temperature bubble — never two). Everything else is neutral surface bound to theme variables. There is no secondary palette, no brand-tinted greys, and no third accent. The only non-gradient semantic colour in the system is the destructive pair `--danger-bg` / `--danger-text` (`rgba(230,70,70,.1)` on `#c94040`); Plou deliberately does **not** use generic alert red/amber/green — a rain warning gets the four-stop dusk gradient at full bleed instead.

**Accent variants.** The accent is orthogonal to the theme — set both on the root: `<div data-theme="light" data-accent="soft">`. Three scopes ship, defined in `tokens/accents.css`, and each overrides *only* the brand tokens, so the flow is byte-for-byte identical across them (one gradient per view, warm kicker, coloured glow under the gradient, gradient-clipped wordmark):

| `data-accent` | What changes |
| --- | --- |
| *(unset)* — **sunset** | The signature `#6EA8FF → #FF9D4D → #FF6FA0`. White text on the brand. |
| **soft** | The same 135° sweep in pastel (`#A9C9FF → #FFC79A → #FFB1C8`). Pastel can't carry white, so `--on-brand` flips to `#14151a` and the glow softens to a warm cream. The alert gradient stays deep enough for white text. |
| **mono-warm** | One continuous warm hue — a short orange → pink sweep (`#FF9C4F → #FF8C6D → #FF7B8B`). Far less chromatic than the default, which crosses blue all the way to pink, but the same 135° flow, white text and a softer coral glow. Stays in the warm family, so the per-theme kicker is unchanged. |
| **mono-cool** | One cool hue — Plou blue, three stops (`#8FC0FF → #5A93F0 → #3B6FD6`). White text, blue glow, blue radar ring, blue kicker. Identical geometry, no warm shift at all. |

Two tokens exist for this: **`--on-brand`** (text/icon colour sitting on the brand gradient) and **`--ring-radar`** (the dashed watch-radius ring). Never hardcode `#fff` on a gradient or `rgba(255,159,122,.6)` on the ring — use these, or the accent variants break. Both templates expose the accent as a tweak.

One ordering rule makes this work, and breaking it silently kills the variants: `accents.css` is the **last** token import, because accent scopes and `:root` share specificity, so source order decides — with it earlier, `elevation.css` re-won every shadow. `soft` and `mono-warm` leave `--kicker` alone — both stay in the warm family, so the per-theme kicker from `theme.css` (`#e0793a` light / `#FF9D4D` dark) already reads correctly. `mono-cool` is the one exception and needs a two-attribute rule: `[data-theme="dark"][data-accent="mono-cool"]` lifts the ink blue to `#8FC0FF` so it passes contrast on a dark card.

**Themes.** Light and dark are equal citizens, both defined in `tokens/theme.css`; every surface, border, divider and control colour is a variable. Always set `data-theme="light|dark"` on the root of a screen. Light theme pages sit on a very pale three-stop wash (`#eef3ff → #fdf3ee → #fdeef4`); dark theme pages use a radial `#141826 → #05060a`. **The radar map stays dark in both themes** — that is intentional.

**Type.** Roboto only, at four weights (400 / 500 / 700 / 900). No serif, no mono, no display face. Numbers are the system's showpiece: temperature at 46–52px and the alert clock at 58–64px, always weight 900 with `-0.02em` tracking. Card titles are 800 at 15–19px, body is 400 at 13–14px in `--ink-soft`, and metadata drops to `--ink-faint`. Uppercase is reserved for two things: warm kickers (10.5px / 700 / `+0.06em`) and section eyebrows (12px / 700 / `--ink-soft`).

**Shape.** Nothing has a square corner. Cards 22–28px, stat tiles 18px, text inputs and sidebar nav rows 14px, and every control — buttons, tags, segmented tracks, the bottom switcher, the search box — is a full 100px capsule. Icon buttons, dots and feature glyph bubbles are perfect circles.

**Backgrounds and imagery.** No illustrations, no photography, no patterns, no textures, no grain. The only image in the entire product is the radar map itself, and it is treated as data: dark gradient substrate, tiles at `opacity: 0.55` with `mix-blend-mode: screen`, a dashed `rgba(255,159,122,.6)` watch-radius ring and a glowing gradient pin. Backgrounds otherwise are two-or-three-stop pale/deep washes, never a hard flat colour and never more than two base backgrounds on one screen.

**Cards.** Themed fill, 1px hairline border at 7% ink, `0 6px 20px rgba(30,30,50,.06)` shadow (in dark: `0 6px 20px rgba(0,0,0,.4)`), 22px padding on desktop / 18px on mobile. A border alone is never the only separation — the soft shadow always carries it. At most one card per view gets a 10–16% gradient wash (`--gradient-wash-cool` / `--gradient-wash-warm`) to mark it as the thing to read first.

**Elevation & shadows.** Two families. Neutral, wide and soft for surfaces (`--card-shadow`, `--shadow-dialog`, `--switcher-shadow`, `--shadow-map`). Warm and coloured for anything wearing the gradient — `0 6px 18px rgba(255,140,90,.3)` under a primary button, `.35` under an active tab. Never a hard black flat shadow, never an inner shadow. The only inset-like effect is the 4px ring around the slider thumb.

**Transparency & blur.** Blur is used in exactly three places, always as *blur + translucent fill + hairline border*: the mobile bottom switcher (`blur(16px)`, 85% white / 75% near-black), the desktop sidebar (`blur(14px)`, 70%), and anything floating over the radar map (`blur(10px)`, 50% near-black with white text and a 15%-white border). Glass over the map is identical in both themes — white text on dark glass regardless. The one exception is the radar status sheet on mobile, a 92%-white glass card with dark text.

**Protection.** The radar header uses a top-down protection gradient (`rgba(10,10,16,.55) → transparent`, ~58px) rather than a solid bar, so the map reads through. Elsewhere, floating UI protects itself with a capsule of dark glass — Plou prefers capsules to scrims.

**Motion.** Short and unshowy. 120ms for press, 180ms for colour, 240ms for toggles and tab changes, all on `cubic-bezier(0.2, 0, 0, 1)` (Material 3 emphasised-decelerate). Tab and theme changes cross-fade colour; nothing slides in, nothing bounces, nothing springs, no skeleton shimmer. `prefers-reduced-motion` zeroes every duration.

**States.** Hover: `filter: brightness(1.04)` — never a colour swap, never a border appearing. Press: `transform: scale(0.97)`. Disabled: `opacity: 0.45` with the shadow removed. Selected/active: the gradient plus its warm glow, and the label jumps from weight 500 to 700. Focus is the browser default outline — the source defines none, so add one if you ship this for real.

**Layout.** Mobile: fixed 20px-padded header, one scrolling column with 18px stacks, and 104px of bottom padding to clear the floating switcher (64px tall, 22px side inset, 18px from the bottom). Desktop: 28px page padding, 1360px max width, a 248px sticky sidebar and a 28px gutter; content grids are 2 columns (Ajustes), 3 columns (Alarmas, stat tiles) or a 1.3fr/1fr split (Previsión).

**Spacing.** A 4/6/8/10/12/14/16/18/20/22/26/32/40 ladder. Sibling gaps are 8px in dense grids, 18px between stacked cards, 22px between desktop sections. Component paddings are exact source values (22 / 18 / 16 / 12), not snapped to a grid.

---

## Content fundamentals

**Language.** Spanish, `usted`-free and pronoun-light — the UI addresses the user with implicit *tú* and bare imperatives ("Toca el mapa para analizar otro punto", "Buscar lugar…"). There is no "we", no product voice in the first person, and no personality copy. Catalan place names are never castellanised.

**Casing.** Sentence case everywhere: buttons ("Ver ejemplo de alerta", "Añadir ubicación"), titles ("Editar alarma"), labels ("Radio de vigilancia"). UPPERCASE appears only in kickers ("SIN PRECIPITACIÓN CERCA", "PRÓXIMA VENTANA") and stat-tile labels ("ÍNDICE UV").

**Tone.** Plainly factual and reassuringly specific. Copy states the fact, then the practical consequence: *"Sin lluvia hasta las 19:40 · Franja despejada estable durante las próximas 6 horas. Buen momento para salir sin paraguas."* Nothing is hedged into vagueness and nothing is dramatised — even the alert is a flat statement of fact ("Lluvia moderada en 12 min · Procedente del suroeste, hacia tu ubicación").

**Numbers and units.** Always concrete, always with the unit: `31°`, `32 %` (space before the percent sign, Spanish convention), `6 km/h SE`, `1018 hPa`, `20 km`, `−120 min` (true minus sign), `0–90 min` (en dash for ranges). Compound values use a middot: `7.0 · Alto`. Times are 24-hour: `19:40`.

**Empty states are complete sentences, never dashes.** "Todavía no se ha emitido ningún aviso." · "Sin avisos todavía" · "No se espera precipitación en la ventana analizada." · "Sin ecos de precipitación".

**Punctuation.** The middot `·` is the system's workhorse separator — between condition and place ("Despejado · Navata"), status and radius ("Alarma activa · 20 km"), data sources. Em dashes name a role before a place ("Casa — Navata", "Trabajo — Figueres"). Placeholders end in an ellipsis character ("Buscar lugar…"). Buttons that add something are prefixed with a literal `+` ("+ Vigilar este punto", "+ Añadir").

**No emoji.** The original app used emoji as tab and list icons (🔔 ☁️ ⚙️); the redesign removed them entirely in favour of the line-icon set. Never reintroduce them.

**Vibe.** A calm instrument, not a weather brand. Big honest numbers, one warm gradient, and a map you trust.

---

## Iconography

Ten hand-drawn 24×24 line glyphs, and nothing else: **radar · forecast · bell · settings · crosshair · search · sun · layers · play · pause**. They are authored inline in `components/core/Icon.jsx` — `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="1.8"` (1.6 at 30px and above), round caps and joins.

- **No icon font, no sprite sheet, no npm icon package, no CDN.** The set is defined once in `Icon.jsx` and imported. This is deliberate — the source project inlines the same paths in every file.
- **No PNG icons.** No `.svg` asset files either; the glyphs live in JSX.
- Sizes: **20px** in controls and nav, **14px** for the layers glyph in a map pill, **19px** in sidebar rows, **16–17px** inside 38px icon buttons, **12–13px** for play/pause inside the playback bubble, **30–42px** for feature glyphs inside a gradient circle (always `#fff`).
- **Only play and pause are filled**; every other glyph is stroke-only. Never fill a stroked glyph, and never put a stroked glyph on a gradient without a circular bubble behind it.
- **No emoji, no Unicode characters as icons.** The `·`, `—`, `+` and `−` characters are typography, not iconography.

The glyphs are hand-drawn but sit close to Lucide/Feather conventions (24px grid, 1.8 stroke, round caps) — if you need a glyph the set doesn't cover, take it from **Lucide** and match the stroke width, then add it to `PLOU_ICONS` rather than inlining it locally.

---

## Fonts — substitution flag

⚠️ **No font binaries were provided.** The source loads **Roboto** from Google Fonts, and `tokens/fonts.css` does the same. Roboto is the genuine specified typeface (not a substitution), but it is CDN-loaded rather than self-hosted, so this system ships **no webfont files**. If you want offline/self-hosted rendering, send the Roboto `.woff2` files (400/500/700/900) and I'll swap the `@import` for `@font-face` rules.

---

## Index

### Root
| Path | What it is |
| --- | --- |
| `readme.md` | This file — brand, content and visual guide. |
| `SKILL.md` | Agent-Skill wrapper so this folder works as a Claude Code skill. |
| `styles.css` | The one file consumers link. `@import` list only. |
| `thumbnail.html` | Homepage tile for the design system. |

### `tokens/` — the CSS custom-property layer
`fonts.css` (Roboto) · `colors.css` (brand triad, gradients, glass, danger, dots, `--on-brand`, `--ring-radar`) · `theme.css` (light + dark surface tokens) · `accents.css` (the soft + mono accent scopes) · `typography.css` · `shape.css` (radii, icon stroke) · `spacing.css` (scale, component padding, fixed chrome) · `elevation.css` (shadows, blur) · `motion.css` (durations, easing, state transforms) · `utilities.css` (the `.plou-*` classes for plain-HTML use).

### `components/` — 23 components in 5 groups
| Group | Components |
| --- | --- |
| `core/` | **Button**, **IconButton**, **Card**, **Tag**, **Wordmark**, **Icon** (+ `PLOU_ICONS`) |
| `forms/` | **SegmentedControl**, **ChoiceChips**, **SettingsGroup** (+ **SettingsRow**), **Slider**, **Switch**, **TextField** |
| `navigation/` | **NavItem**, **TabBar** |
| `weather/` | **TempReadout**, **StatTile**, **PrecipChart**, **ChartLegend**, **HourlyList**, **LocationCard**, **RadarViewport**, **MapControls** (+ **ZoomControl**) |
| `feedback/` | **Dialog**, **AlertScreen**, **GlassBar** |

Each has a `.d.ts` props contract and a `.prompt.md` usage note; each directory has a `@dsCard` HTML showing its states.

**Intentional additions** — components the source screens use as repeated inline patterns rather than named components, promoted here so consumers don't re-implement them: `Wordmark` (the brand lockup), `Icon` (wrapper over the nine inlined glyphs), `GlassBar` (the floating glass capsule), `RadarViewport` (map substrate + ring + pin), `LocationCard`, `StatTile`, `HourlyList`, `PrecipChart`, `TempReadout`, `AlertScreen`, `ChartLegend`.

`ChoiceChips`, `SettingsGroup`/`SettingsRow`, `MapControls` and `ZoomControl` come from the **original app** screenshots (`assets/reference-original-app-settings.png`, `-04.png`), whose settings screens use wrapping pill groups for any choice with more than four options (Escala de color, Mapa base, Viento, Presión, Historia), hairline-divided settings cards, and the Leyenda / ≡ Capas / zoom affordances on the map. Their visuals here follow the redesign's tokens, not the original cyan styling. Nothing was invented that has no counterpart on a Plou screen — there is no Toast, Avatar, Tabs, Accordion, Breadcrumb or Table here, because Plou has none.

### `ui_kits/`
- `plou_app/` — interactive Android recreation. See its `README.md`.
- `plou_web/` — interactive desktop recreation. See its `README.md`.

### `templates/` — starting folders for new work
| Template | Entry | What it gives you |
| --- | --- | --- |
| **Plou App screen** | `templates/plou-app-screen/PlouAppScreen.dc.html` | Phone-sized screen scaffold: header + wordmark, scrolling 18px content stack, floating glass tab switcher. Light/dark tweak. |
| **Plou Web screen** | `templates/plou-web-screen/PlouWebScreen.dc.html` | Desktop shell: sticky glass sidebar with the four nav rows and theme control, section title, 1.3fr/1fr content grid. |

Each template loads the system through a sibling `ds-base.js` — one `base` line to repoint in a consuming project.

### `guidelines/`
29 specimen cards feeding the Design System tab, grouped **Colors** (10) · **Type** (5) · **Shape** (2) · **Spacing** (3) · **Elevation** (2) · **Motion** (1) · **Brand** (6 — wordmark, iconography and one card per accent variant).

### `assets/`
`radar-map-tile.png` (cropped radar tile used by `RadarViewport`), `radar-map-dark.png` (the uncropped screenshot) and five `reference-original-app-*.png` screenshots of the pre-redesign app, for product context only.

---

## Quick rules for generating a new Plou screen

1. Link `styles.css` and set `data-theme="light|dark"` (and optionally `data-accent="soft|mono"`) on the root container.
2. **One** gradient element per view — the primary action *or* the active state. Everything else neutral. Text on it is `var(--on-brand)`, never a literal `#fff`.
3. Everything rounded: cards 22–28px, controls 100px capsules, icons circular.
4. Cards always carry `--card-shadow`; a border is never the only separation.
5. On the Radar view the map is the background — UI floats over it in dark glass with white text.
6. Max two base backgrounds per screen. No generic alert red/green — urgency is the dusk gradient at full bleed.
7. Spanish, sentence case, middot separators, concrete numbers with units, no emoji.
