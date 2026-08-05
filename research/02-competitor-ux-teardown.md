# Fem-ho — Research Dossier 02: Competitive UX Teardown
## Tasks + Calendar fusion, quick-capture UX, kanban patterns, GTD inbox mechanics

> **⚠️ FILE LOCATION NOTE (read first).** The orchestrator asked for this file at
> `/private/tmp/claude-501/-Users-borja-Codi-fem-ho/4ee9f810-66f8-4e6f-86dc-06e906a11d09/scratchpad/research/02-competitor-ux-teardown.md`.
> This session was running under **plan mode**, whose harness constraint permits writing to exactly
> one file: this plan file. The dossier content is complete and unabridged here — copy it to the
> requested path verbatim. No content was dropped.

**Audience:** an AI writing production code for Fem-ho (self-hosted web + native Android task
manager, Catalan UI, scopes/àmbits → projects → tasks → subtasks → simple lists, 4-column kanban
Inbox / Per fer / Fent / Fet, calendar view with a shared Inbox side column, CalDAV + REST + MCP
interop, "Plou" design system).

**How to read:** every section ends with a `→ WHAT FEM-HO SHOULD DO` block. Those blocks are the
actionable output; the material above them is the evidence. Anything I could not confirm from a
primary source is tagged **UNVERIFIED**.

---

# PART 1 — TODOIST

Todoist is the reference implementation for *quick capture with inline parsing*. Fem-ho's
`@person` / `#Scope` / `#Scope/Project` syntax is a direct descendant, so getting the details right
matters more here than anywhere else in this dossier.

## 1.1 Quick Add — the complete symbol table

From the official help article *Use Task Quick Add in Todoist*:

| Symbol | Meaning | Example given by Todoist |
|---|---|---|
| `#` | Project | `#Work` |
| `/` | Section (typed **after** the project) | `#Work /Admin` |
| `@` | Label | `@email` |
| `+` | Assignee (person) | `+Lucile` |
| `!` | Reminder | `!14:00`, `!30 min before` |
| `p1` `p2` `p3` `p4` | Priority, p1 = highest | `p1` |
| `{ }` | Deadline (distinct from due date) | `{march 30}` |
| *(bare text)* | Natural-language due date | `tomorrow at 4 PM` |

Notes that matter for implementation:

- **Two different date concepts.** Todoist separates **due date** ("when you plan to do it",
  parsed from bare NL text) from **deadline** ("the latest day by which a task must be completed",
  typed in curly braces `{march 30}`). These are separate fields with separate UI treatment.
  Todoist's own glossary: due date = *"you can schedule when a task should happen"*;
  deadline = *"the latest day by which a task must be completed"*.
- **Priority is bare-token, not sigil-prefixed.** `p1` is matched as a whole word. This creates a
  real collision risk with ordinary text (a task literally about "p1") — Todoist accepts that risk.
- **False-positive handling is the killer feature.** Todoist's docs state: *"The smart Quick Add
  might recognize part of your task name as a date, like 'monthly' in 'Create monthly report.'
  Just click or tap the word to turn it into plain text."* So the parser is **optimistic + one-tap
  reversible**, not conservative. The recognized token is rendered as a chip inside the input; the
  chip is clickable to demote it back to literal text.
- **Locale gaps are documented explicitly:** Czech and Turkish date formats are not supported.
- **Keyboard:** `Q` opens Quick Add on web/macOS/Windows. `↓` (down arrow) inside Quick Add reveals
  the description field. Desktop apps expose a *customisable* system-global Quick Add shortcut at
  Settings → Desktop → "Quick Add global shortcut".
- Quick Add supports: dates, deadlines, labels, priority, reminders, assignees, projects, sections,
  descriptions, and file attachments.

## 1.2 The natural-language date grammar Todoist actually accepts

Verbatim examples from *Introduction to dates and time*:

**Day keywords + abbreviations**
```
today            tod
tomorrow         tom
next week        next month        next weekday        next year
later this week  this weekend      next weekend        next Friday
someday          no date           no due date
```

**Absolute dates (multiple orders + separators)**
```
jan 27        27 jan        27/1        01/27/2023        27th
```

**Fuzzy calendar anchors**
```
mid January       end of month
```

**Date + time**
```
today at 10       tomorrow at 16:00        Fri @ 7pm
```
Note the `@` here is a *time* separator inside a date phrase — while `@` at token start is a label.
Disambiguation is positional.

**Offsets**
```
in 5 days     +5 days     in 3 weeks     in 2 hours
```

**Time-of-day buckets** (map to a default hour, not an exact time)
```
in the morning     in the afternoon     in the evening
tom morning        tommorning           tom afternoon      tom evening      tom night
```
`tommorning` (no space) is accepted — the tokenizer is forgiving about the space.

**Relative-to-another-date arithmetic** (the most impressive part)
```
50 days before new year's eve
6 weeks before 21 Jul
28 days after 21 July
```

**"next <weekday>" semantics.** Todoist resolves `next Monday` relative to position in the week: if
the weekday hasn't happened yet this week, "next" means the *following* week; if it has already
passed, it schedules the next upcoming occurrence. (This is the classic ambiguity — write a test
for it.)

## 1.3 Recurrence grammar

Verbatim examples from *Introduction to recurring dates*:

```
every day / daily
every weekday / every workday
every week / weekly
every month / monthly
every year / yearly

every other day       every other week      every other month     every other year
every 3 workday
every 12 hours starting at 9pm

every Monday, Friday          every mon, fri
every last workday at 3pm
every 1st wed jan, 3rd thu jul

every hour
every fri at noon
every mon, fri at 20:00

everyday starting on aug 3
everyday ending aug 3
everyday for 3 weeks

every! 3 hours
every! 2 months
```

**The `every` vs `every!` distinction is the single most copy-worthy idea here:**

- `every X` — **fixed-schedule recurrence**. Next occurrence is computed from the *original due
  date*. Completing "every Friday" on Sunday still yields next Friday.
- `every! X` — **completion-based recurrence**. Next occurrence is computed from the *completion
  timestamp*. `every! 30 days` on "change the air filter" restarts the clock when you actually
  tick it.

This maps cleanly onto household chores (the Família scope), which is exactly Fem-ho's use case:
"buidar el rentavaixelles" is `every!`, "pagar el lloguer" is `every`.

RFC 5545 RRULE cannot express `every!` — completion-based recurrence is *not* representable in
iCalendar. See §5.7 for the round-trip consequence.

## 1.4 Inbox methodology

Todoist's glossary defines Inbox as: *"Default place for ideas or tasks until they're added to a
project."* The documented daily loop is:

1. Morning: open **Today**, prioritise.
2. Throughout the day: capture into **Inbox** with zero friction, no metadata required.
3. Evening: **process the Inbox** — assign each task a project, a date, and a label.

Key property: **the Inbox is the default target when no `#project` token is present.** Capture must
never require a routing decision.

## 1.5 Today / Upcoming / Calendar layout — and the "Plan sidebar"

**Today** — all tasks with dates scheduled for today, across all projects.

**Upcoming** — all dated tasks laid out chronologically, scrollable up to **two years** ahead.
- Web/desktop: arrow buttons page through weeks. Mobile: swipe the week picker or tap a date.
- Overdue tasks get a dedicated **Reschedule** button at top-right.
- Drag a task across the view to a new date to reschedule. Hover reveals a scheduler icon.
- Layouts available: **List** (all users), **Board** (all users), **Calendar** (Pro/Business only).

**Calendar layout** (shipped as part of Todoist's "Year of the Calendar" push, 2024):
- Applies to **projects, filters, labels, and Upcoming**. Chosen at project-creation time via the
  Layout selector, or later from the Display menu.
- **Week** or **Month** grid. Desktop week = 7 days. Mobile portrait = 3 days; landscape = 7 days.
  iOS/Android also offer an Agenda layout.
- **The "No date" sidebar** — a collapsible panel that expands to reveal undated tasks; drag them
  onto a calendar day to schedule, or use the ⋯ menu.
- In **Upcoming** specifically, the equivalent panel is called the **Plan sidebar** and it shows
  *"overdue, all-day, time-blocked, and unscheduled tasks with a deadline (up to 7 days ahead)"*.
- Click/tap a date cell to open the task creation form pre-filled with that date.
- Week start day is a global General setting and propagates to the calendar.
- **Limitations worth knowing:** no manual sort inside calendar layout (default sort order only);
  recurring tasks' *future* occurrences render only on desktop/web in Upcoming; the future-
  occurrences toggle doesn't exist on mobile.

> This is the closest existing precedent to Fem-ho's "dynamic Inbox side column shared between the
> tasks view and the calendar view." Todoist arrived at the same conclusion: **a calendar without an
> adjacent reservoir of undated work is useless, because the whole point of the calendar view is to
> move things *into* it.**

## 1.6 Structural model

- **Project** — *"A list of tasks organized together"*.
- **Section** — *"split projects into parts"*; logical groups by status, priority or phase. In Board
  layout, sections **are** the kanban columns.
- **Sub-task** — *"Tasks nested under a parent task"*. Indent/outdent with
  `Ctrl+Alt+→` / `Ctrl+Alt+←`.
- **Board layout** — *"View of projects in column form"*.
- **Priority** — p1..p4, p1 highest.
- Sub-task nesting depth limit: **UNVERIFIED** — the official help articles don't state a number.
  Third-party tooling (Todowing) notes that Todoist does not render sub-task hierarchy inside date
  and filter views, only inside the parent project — a real UX cost worth avoiding.

## 1.7 Filter query language (complete, from *Introduction to filters*)

**Operators**

| Token | Meaning | Example |
|---|---|---|
| `|` | OR | `today | overdue` |
| `&` | AND | `today & p1` |
| `!` | NOT | `!subtask` |
| `( )` | grouping | `(today | overdue) & #Work` |
| `,` | separate lists (renders as multiple sections) | `date: yesterday, today` |
| `\` | escape special chars / spaces | `#Shopping\ list` |
| `*` | wildcard | `@urgent*`, `#*Work`, `/\*Work\*` |

**Keyword vocabulary**

- Dates: `today`, `tomorrow`, `yesterday`, `overdue`, `date:`, `date before:`, `date after:`,
  `no date`, `no time`
- Deadlines: `deadline:`, `deadline before:`, `deadline after:`, `no deadline`
- Priority: `p1`, `p2`, `p3`, `p4`, `No priority`
- Labels: `@label_name`, `no labels`
- Projects/sections: `#Project`, `##Project` (project **including sub-projects**), `/#Section`
- Assignment: `assigned`, `assigned to:`, `assigned by:`, `shared`
- Metadata: `subtask`, `recurring`, `created:`, `created before:`, `created after:`, `added by:`,
  `search:`, `uncompletable`, `view all`
- Workspace: `workspace: Name`

**Canonical example queries** (these appear in Todoist's own material):
```
(today | overdue) & #ProjectName
(p1 | p2 | p3) & (overdue | today) & (!assigned to: others)
```

Doist also ships an LLM-backed *Filter Assist* that generates a query from a natural-language
description — an explicit admission that the query language has a real learning curve.

## 1.8 Karma (gamification)

Level thresholds (from *Introduction to Karma*):

| Level | Karma points |
|---|---|
| Beginner | 0 – 499 |
| Novice | 500 – 2,499 |
| Intermediate | 2,500 – 4,999 |
| Professional | 5,000 – 7,499 |
| Expert | 7,500 – 9,999 |
| Master | 10,000 – 19,999 |
| Grand Master | 20,000 – 49,999 |
| Enlightened | 50,000+ |

Mechanics:
- Points are earned by: adding tasks; completing tasks on time; **using advanced features** (labels,
  recurring dates, reminders); hitting self-set daily/weekly goals; maintaining streaks.
- Points are **lost** when tasks are **four or more days overdue**.
- Exact per-action point values are **not published** — **UNVERIFIED**. Do not invent them.
- Higher levels require progressively more points per level.
- Goals can be disabled by setting them to zero. **Vacation Mode** freezes streaks and suppresses
  point loss. Users can designate specific weekly days off.
- Support can restore a broken streak up to **3 times per account**, and only the most recent break.
- Reaching Enlightened unlocks a hidden theme.

## 1.9 Todoist keyboard shortcuts

**Quick Add context**

| Action | Key |
|---|---|
| Add a label | `@` |
| Pick a project | `#` |
| Add an assignee | `+` |
| Set priority | `p1` / `p2` / `p3` / `p4` |
| Add comment to newly created task | `Ctrl + M` |
| Save and go to comments (Win 10) | `Alt + Enter` |
| Open full task editor (Win 10) | `Tab` |

**General**

| Action | Key |
|---|---|
| Add task (Quick Add) | `Q` |
| Add task at bottom of list | `A` |
| Add task at top of list | `Shift + A` |
| Open search | `/` |
| Undo last action | `U` |
| Manual sync | `F5` |
| Multi-select | `Ctrl + Click` |
| Default page | `Home` |
| Back / Forward | `PgUp` / `PgDown` |

**Editing**

| Action | Key |
|---|---|
| Cancel changes | `Esc` |
| Save, create below | `Enter` |
| Save and create below | `Shift + Enter` |
| Save and create above | `Ctrl + Enter` |
| Move to task above / below | `Ctrl + ↑` / `Ctrl + ↓` |
| Indent sub-task | `Ctrl + Alt + →` |
| Outdent sub-task | `Ctrl + Alt + ←` |
| Complete and archive | `Shift + Click` |

**Sorting / navigation**

| Action | Key |
|---|---|
| Sort by date / priority / assignee | `S` / `P` / `R` |
| Inbox | `Ctrl + 1` |
| Team Inbox | `Ctrl + Shift + 1` |
| Today | `Ctrl + 2` |
| Next 7 days | `Ctrl + 3` |
| Projects / Labels / Filters | `Ctrl + 4` / `Ctrl + 5` / `Ctrl + 6` |
| Settings | `Ctrl + ,` |

### → WHAT FEM-HO SHOULD DO (Todoist)

1. **Ship the optimistic-parse + reversible-chip pattern, not a conservative parser.** Parse
   aggressively as the user types; render every recognised token as a **pill** (Plou already
   specifies pill shapes — reuse the component); a single tap on the pill demotes it back to
   literal text and re-runs the parse on the remainder. This is the mechanism that makes
   aggressive NL parsing safe. Without it, aggressive parsing is a bug factory.
2. **Adopt the sigil set, adapted:**
   - `#Àmbit` and `#Àmbit/Projecte` — routing (Fem-ho's spec already says this; note that Todoist
     uses `/` as a *separate token* `#Work /Admin`, whereas Fem-ho uses `#Scope/Project` as one
     token. Fem-ho's form is better for a two-level hierarchy — keep it, but **also accept the
     Todoist spaced form** as an alias, because muscle memory transfers).
   - `@persona` — assignee. **Deliberate divergence from Todoist**, which uses `@` for labels and
     `+` for people. Fem-ho's choice matches Slack/GitHub/Linear convention and is the right call
     for a family app; document the divergence for anyone migrating.
   - `!p1..!p4` or bare `p1..p4` — priority. Prefer **bare `p1`** for Todoist compatibility, but
     recognise `!1`/`!p1` as aliases.
   - `!` alone before a time → reminder (`!8:00`, `!30 min abans`).
   - `{ }` → deadline, kept distinct from due date. **Implement both fields from day one** —
     retrofitting a deadline field into an existing schema and CalDAV mapping is painful, and
     "quan ho vull fer" vs "quan venç" is genuinely two different things for family logistics
     (school forms, tax deadlines).
3. **Implement a Catalan NL date grammar with the same shape.** Minimum viable token list:
   `avui`, `demà`, `demà passat`, `dl dt dc dj dv ds dg`, `dilluns…diumenge`, `la setmana que ve`,
   `el mes que ve`, `aquest cap de setmana`, `el cap de setmana que ve`, `d'aquí a 3 dies`,
   `+3d`, `+2s`, `al matí`, `a la tarda`, `al vespre`, `a la nit`, `a finals de mes`,
   `mitjans de gener`, `27 gen`, `27/1`, `27-01-2026`, `a les 16:00`, `a les 4 de la tarda`.
   Also accept the **Spanish and English** equivalents unconditionally — this is a bilingual/
   trilingual household and forcing Catalan-only input will produce silent parse failures. Reuse
   an existing parser core if possible rather than hand-rolling (see dossier on libraries).
4. **Implement `cada` vs `cada!`** (Catalan rendering of `every` / `every!`). Completion-based
   recurrence is the correct default for the Família scope's chores. Store it as a Fem-ho-native
   field, because **RRULE cannot express it** — see §5.7.
5. **Take the filter query language, but make it optional.** Ship saved views with a query string
   using Todoist's operator set (`&`, `|`, `!`, `()`, `,`, `\`, `*`) so that power users and — more
   importantly — **the MCP server and REST API** have one shared, documented, textual query
   grammar. One grammar serving humans, the API, and the AI user is a large architectural win:
   the MCP tool `search_tasks(query: string)` becomes trivially specifiable.
6. **Reserve `##Àmbit` for "scope including its projects"**, mirroring Todoist's `##Project`.
   Fem-ho's multi-select scope chips make this less necessary in the UI but essential in the API.
7. **Skip Karma.** A shared family instance with a visible productivity score is a source of
   friction, not motivation, and self-hosters did not ask for it. If you want a motivational
   surface, use the *Done column* review (§7.5) instead — retrospective, not competitive.
   If a light version is ever wanted, make it **per-user, private by default, off by default**.
8. **Copy the keyboard model:** `Q` = quick add anywhere; `/` = search; `U` = undo (undo-on-complete
   is essential in a kanban); `Ctrl+1..6` = view switching. Do **not** copy `A` / `Shift+A`
   (add at bottom/top) — Fem-ho's columns make "top/bottom" ambiguous; use a per-column `+`.

---

# PART 2 — THINGS 3

Things is the reference for *hierarchy clarity* and for *checklists inside to-dos*, which is
exactly Fem-ho's "llistes simples".

## 2.1 The hierarchy, precisely

```
Area  (àmbit — an ongoing responsibility, never "completed")
 ├── To-do            (a to-do can live directly in an Area, with no Project)
 └── Project          (has an end; shows a completion ring)
      ├── Heading     (a section/divider inside a project — NOT a container object with its own
      │                metadata; purely an ordering/grouping device)
      └── To-do
           └── Checklist item   (max ~100 via URL scheme; flat, no nesting, no dates,
                                 no assignee, no notes)
```

Official definitions (Cultured Code's *Getting Productive with Things* guide, verbatim):

- **Areas** — *"For grouping all of your projects and to-dos that support an ongoing ambition."*
  Suggested examples: Family & Friends, Money, Health, School, Career.
- **Projects** — used when accomplishing something requires multiple steps rather than a single
  action.
- **Headings** — used to *"divide ambitious projects into smaller groups of related to-dos"*.
  You can *"drag whole groups of to-dos simply by dragging and dropping their heading"*.
- **Checklists** — multi-step breakdown *inside* a single to-do. Notably: *"paste in a bulleted
  list from another app and Things will convert it to a checklist."*

Visual encoding in the sidebar (this is the detail that makes the hierarchy legible): **areas are
bold; projects sit indented beneath their area in a lighter weight.** Areas can hold loose to-dos
directly, so the two are interchangeable in a pinch — but the type contrast is what teaches the
distinction without a tutorial.

**The critical structural insight: a checklist is not a sub-task.** In Things, a checklist item has
no date, no tag, no notes, no assignee, and cannot be scheduled or surfaced in Today. It exists
purely as internal structure for one to-do. Things deliberately refused to make checklists
first-class, which is why Things' Today list never fills up with noise.

## 2.2 The five time-lists — exact membership rules

From *An In-Depth Look at Today, Upcoming, Anytime, and Someday*:

- **Inbox** — *"Each and every thing that you want to accomplish needs to end up in one place, and
  that place is the Inbox."*
- **Today** — *"The list for to-dos that you want to start before the day ends. They're your
  priorities."* Membership rule: **start date, deadline, or repeating rule matches today**.
  Calendar events render inline with to-dos here.
- **This Evening** — an optional sub-section pinned to the **bottom** of Today, for work that only
  makes sense after hours. Stays visible but visually demoted.
- **Upcoming** — a timeline *"organized by when you'll start them, when they have deadlines, or
  when they'll repeat next."* The **next seven days appear individually at the top**, then it
  degrades to coarser grouping. *"Simply schedule the to-do for next Saturday, then forget about
  it. Come Saturday, it hops into Today."*
  **Projects with a start date go into "hibernation": they disappear from the sidebar entirely
  until their start date arrives.**
- **Anytime** — *"Home for all of the to-dos you could start at any time."* Membership rule: active
  to-dos **with no future start date**. Explicitly: *"those with deadlines will remain in Anytime
  as they are active and can be tackled at any time."* To-dos also in Today appear here with a
  yellow star.
- **Someday** — *"The place for to-dos that you might like to get to, but you're not sure when.
  Regularly review what you've added here to decide if it's time to act."* Someday items do **not**
  appear in Anytime or Upcoming — they are genuinely out of sight.
- **Logbook** — completed/cancelled archive. `⇧⌘Y` = "Move completed to Logbook" (an explicit,
  user-triggered sweep, not automatic).

**Start date ("When") vs Deadline** — the cleanest statement of the distinction in any app:
> Start dates control **when a task moves from Upcoming into Today**.
> Deadlines keep a task **active in Anytime** regardless of when it is due.

## 2.3 The Magic Plus button — a drag-target-based creation model

The `+` is a physical object you drag, and the *drop target* determines both what is created and
where:

| Drag target | Result |
|---|---|
| Drop between two to-dos in a list | New to-do inserted **at that exact position** |
| Drop on the Inbox sidebar item | New to-do in Inbox, regardless of current list |
| Drop on the Today sidebar item | New to-do scheduled for Today |
| Drag to far-left edge while inside a Project (iPhone/iPad/Vision) | New **Heading** created in place |
| Drop into an Area in the sidebar (iPad/Vision) | New **Project** inside that area |
| Simple tap | New to-do in the current list |

This is a genuinely good idea: **one affordance, N creation types, disambiguated spatially rather
than by a menu.**

## 2.4 Quick Find, Type Travel, Jump Start, Quick Entry

- **Quick Find** (`⌘F`) — *"The moment you hit a key, the results show up instantly"*; searches
  to-dos, projects, areas and tags app-wide. On iOS it's revealed by **pulling down** in any list.
- **Type Travel** — inside Quick Find, typing a *list or tag name* and hitting Return **navigates**
  there rather than filtering. Search and navigation are one input.
- **Jump Start** — the date picker accepts natural language with **prefix completion**:
  typing `Tom` completes to *Tomorrow*, `in fou` to *in four days*. On iOS it's revealed by pulling
  down inside the date picker.
- **Quick Entry** (`^Space`) — system-wide capture panel from any Mac app.
  **Quick Entry with Autofill** (`^⌥Space`) additionally *"can capture the link to a website, email,
  or file that you're currently viewing"* and pre-fills the title and notes from it.

## 2.5 The Things URL scheme — a concrete precedent for Fem-ho's REST/MCP surface

Form: `things:///commandName?parameter1=value1&parameter2=value2&...`

Commands: `add`, `add-project`, `update`, `update-project`, `show`, `search`, `json`
(plus deprecated `add-json`).

`add` parameters:

| Parameter | Notes |
|---|---|
| `title` | up to **4,000 characters** |
| `titles` | **multiple to-dos** separated by newlines (`%0a`) — batch create in one call |
| `notes` | up to **10,000 characters** |
| `when` | `today`, `tomorrow`, `evening`, `anytime`, `someday`, `yyyy-mm-dd`, `yyyy-mm-dd@HH:MM`, or natural language (`in 3 days`, `next tuesday`) |
| `deadline` | separate from `when` |
| `tags` | comma-separated tag **titles** |
| `checklist-items` | newline-separated, **max 100 items** |
| `list` / `list-id` | target project or area (by name or id) |
| `heading` / `heading-id` | target heading inside a project |
| `completed`, `canceled` | booleans |
| `show-quick-entry` | boolean — open the dialog pre-filled instead of committing silently |
| `reveal` | boolean — navigate to the created item |
| `creation-date`, `completion-date` | ISO8601, for importers |

Constraint: `when` and `deadline` **cannot be updated on repeating to-dos or repeating projects**.

Three design lessons here:
1. **Accept both name and id** for every reference (`list` / `list-id`). Names for humans and AI,
   ids for machines. Fem-ho's MCP server should do exactly this.
2. **`show-quick-entry`** is the "human-in-the-loop" flag: the integration composes a task but hands
   the final confirm to the user. Fem-ho's AI-delegated tasks need precisely this affordance.
3. **Batch create via newline-separated `titles`** — cheap, and enormously useful for AI callers.

## 2.6 Things gestures (relevant to Fem-ho's Android app)

| Gesture | Result |
|---|---|
| Swipe **right** on a to-do | Opens **When** (schedule it) |
| Swipe **left** on a to-do | **Selects** it (enters multi-select) |
| Swipe left on a project/area | Selects the list |
| Drag finger down the right edge of the screen | Batch-select a consecutive run of to-dos |
| Tap-and-hold a to-do → drag | Reorder, or reschedule when in Upcoming |
| Tap-and-hold a **heading** → drag | Move the whole group of to-dos under it |
| Drag to-dos onto sidebar lists (iPad) | Move between collections |
| Pull down in a list | Quick Find |
| Pull down in the date picker | Natural-language date entry |
| Tap-and-hold the checklist grip | Reorder checklist items |

Note: **swipe-right = schedule, not complete.** Things puts completion on the explicit circle
target and reserves the high-value swipe for the most frequent *decision*. Contrast with almost
every other app, where swipe-right = done.

## 2.7 Things for Mac — full keyboard shortcut table

**Create**

| Action | Key |
|---|---|
| New to-do | `⌘N` |
| New to-do below selection | `Space` |
| New to-dos from clipboard | `⌘V` |
| New checklist in open to-do | `⇧⌘C` |
| New project | `⌥⌘N` |
| New heading | `⇧⌘N` |
| New heading with selection | `⌥⇧⌘N` |
| Quick Entry | `^Space` |
| Quick Entry with Autofill | `^⌥Space` |

**Edit**

| Action | Key |
|---|---|
| Open selected item | `Return` |
| Save and close | `⌘Return` |
| Duplicate | `⌘D` |
| Complete | `⌘K` |
| Cancel (≠ complete) | `⌥⌘K` |
| Move completed to Logbook | `⇧⌘Y` |

**Move**

| Action | Key |
|---|---|
| Move item to another list | `⇧⌘M` |
| Move copied item to here | `⌥⌘V` |
| Move up / down | `⌘↑` / `⌘↓` |
| Move to top / bottom | `⌥⌘↑` / `⌥⌘↓` |

**Dates**

| Action | Key |
|---|---|
| Show When | `⌘S` |
| Start Today | `⌘T` |
| Start This Evening | `⌘E` |
| Start Anytime | `⌘R` |
| Start Someday | `⌘O` |
| Start date ±1 day | `^]` / `^[` |
| Start date ±1 week | `^⇧]` / `^⇧[` |
| Add a Deadline | `⇧⌘D` |
| Deadline ±1 day | `^.` / `^,` |
| Deadline ±1 week | `^⇧.` / `^⇧,` |
| Add repetition schedule | `⇧⌘R` |

**Navigate**

| Action | Key |
|---|---|
| Navigation popover | `⇧⌘O` |
| Inbox / Today / Upcoming / Anytime / Someday / Logbook | `⌘1` … `⌘6` |
| Show in parent list | `⌘L` |
| Enter project | `Return` or `⌘→` |
| Go back | `⌘←` |
| Show/hide sidebar | `⌘/` |
| Show/hide later items | `⇧⌘E` |

**Search / tags**

| Action | Key |
|---|---|
| Search the app (Quick Find) | `⌘F` |
| Find in text | `⇧⌘F` |
| Open tag window | `^⌘T` |
| Edit tags for selected item | `⇧⌘T` |
| Filter by tag | `^⌥ + <tag shortcut>` |
| Escape filtered state | `^Esc` |

**Markdown in notes**: `^⌘1` H1, `^⌘2` H2, `⌘I` italic, `⌘B` bold, `⇧⌘L` bullet list,
`⌥⌘L` numbered list, `^⌘L` task list, `⇧⌘K` link, `⇧⌘J` code, `⌘]`/`⌘[` indent/outdent.

### → WHAT FEM-HO SHOULD DO (Things 3)

1. **Model "llistes simples" exactly like Things checklists, not like sub-tasks.** A checklist item
   should have: `title`, `checked`, `position`. **No** date, **no** assignee, **no** scope, **no**
   nested children, **no** own kanban state. The moment a checklist item can be scheduled, your
   Inbox and Today views fill with noise and the four-column board becomes unreadable. If a user
   needs those fields, the correct answer is "promote it to a sub-task" — offer that as an explicit
   one-click action, and log it in the audit trail.
2. **But diverge on one point: Fem-ho's checklists are pinnable and shareable.** That is a real
   product differentiator (a shared shopping list pinned to the top bar; a public share link to
   "Coses per a l'excursió"). Keep the item model minimal *and* make the **list** object
   first-class enough to carry: `pinned`, `share_token`, `expiry`, `password_hash`,
   `require_guest_name`. Minimal items, rich container.
3. **Support "paste a bulleted list → becomes a checklist."** Detect `-`, `*`, `•`, `1.` prefixes
   and newlines on paste into the checklist area. Cheap to implement, disproportionately loved.
4. **Adopt "Areas are bold, Projects are lighter and indented" as the Plou sidebar/chip spec.**
   Fem-ho's scope chips should be visually *heavier* than the project dropdown entries. Type weight
   is doing the ontology teaching — no tooltip required.
5. **Adopt the start-date / deadline split verbatim**, including the rule *"a task with a deadline
   but no start date stays in the general pool, it does not jump to Today."* This is what stops
   the Today/Per fer column from being flooded by things that are merely *due* eventually.
6. **Copy "hibernation" for projects with a future start date** — hide them from the project
   dropdown until their start date. In a family instance with a dozen scopes, this is the only
   thing that keeps the dropdown short.
7. **Copy the Magic Plus drag model for the "+" button in the top bar.** Fem-ho's `+` is already
   specified as a top-bar button; make it draggable:
   - drop on a **column** → create directly in that column (Inbox / Per fer / Fent / Fet)
   - drop on a **scope chip** → create in that scope's general space
   - drop on a **calendar cell** (calendar view) → create a task scheduled at that datetime
   - plain click → open quick-add with the current scope/project context prefilled
   On Android, the FAB is the natural carrier of the same behaviour.
8. **Copy Quick Find + Type Travel.** One search box that both filters *and* navigates
   ("escriu `Família` + Enter → salta a l'àmbit"). Bind it to `/` and to `⌘K`/`Ctrl+K`.
9. **Copy Jump Start prefix completion in the date picker** — typing `dem` completes to `demà`,
   `d'aquí a t` to `d'aquí a tres dies`. Prefix completion makes an NL date field discoverable,
   which is otherwise its biggest weakness.
10. **On Android, put *schedule* on swipe-right and *select* on swipe-left**, following Things,
    and keep *complete* on the explicit checkbox. Rationale: in a 4-column kanban, "done" is a
    column move that the user can already do by drag; the scarce interaction is scheduling.
    **UNVERIFIED whether this beats the swipe-to-complete convention for Fem-ho's users** — worth
    making configurable, but pick this as the default.
11. **Copy the URL-scheme design into the REST API and MCP tools:** accept name-or-id for every
    reference; support batch create from a newline-separated list; expose a `confirm_with_user`
    flag equivalent to `show-quick-entry` for AI-delegated creation.

---

# PART 3 — CALENDAR ⇄ TASK FUSION APPS

The question Fem-ho actually needs answered: **where does the reservoir of un-timed work live
relative to the calendar grid, and how does work move between them?**

## 3.1 Comparison matrix

| App | Un-timed work rail | Side | Drag task → calendar | Guided daily ritual | Auto-schedule |
|---|---|---|---|---|---|
| **Todoist** (Calendar layout) | "No date" sidebar / "Plan sidebar" | **Left**, collapsible | Yes, drop on a day cell | No | No |
| **TickTick** | Task bar / "Arrange Tasks" panel | **Right** (swipe from right edge) | Yes, drop on a time point | No | No |
| **Sunsama** | Backlog + integration channels | **Left** (day columns are the main surface) | Yes, timebox during planning | **Yes — the defining feature** | No (manual by design) |
| **Akiflow** | Universal Inbox | **Left** | Yes | Light ("Plan" flow, `P`) | No |
| **Morgen** | Task panel, folders/lists | **Left** sidebar | Yes, drag edges to set duration | Planning mode | Yes (AI Planner, *suggestions pulsate*) |
| **Motion** | (mostly hidden — tasks are auto-placed) | Left task list | Yes, but fights the scheduler | No | **Yes, fully automatic** |
| **Amie** | Unscheduled todos column | **Left** | Yes | No | No |
| **Amazing Marvin** | Master List sidebar | **Right**, opens on "Plan day" | Yes (drag into day / time block sections) | **Yes — "Plan day" strategy** | Partial |

**Every single one of these puts the un-timed reservoir on a vertical rail immediately adjacent to
the calendar grid, and every single one makes drag the primary scheduling verb.** There is no
dissent in the market on this point. Fem-ho's "dynamic Inbox side column shared with the tasks
view" is the industry-consensus solution.

## 3.2 Sunsama — the canonical "daily planning ritual"

Documented ritual steps (help.sunsama.com):

1. **Reflect on yesterday** — review incomplete tasks from the prior day.
2. **Add tasks to your day** — pull from integrated tools (Jira, Asana, Trello…), the backlog,
   weekly objectives, or create new; calendar events prompt for import.
3. **Check predicted workload** — Sunsama *"sums up the planned times for all your work-related
   tasks"* and compares against a user-set threshold.
4. **Finalise the plan** — order tasks, **optionally timebox them onto the calendar**, adjust the
   shutdown time.
5. **Share the plan** — post to Slack/Teams, then start work.

**Task rollover** (this is the precise mechanic Fem-ho needs for carry-over):
- *"All tasks automatically roll over to the next day's task list if they are left incomplete at
  midnight."*
- Setting controls whether rollover is automatic or **prompts you to select which tasks roll over**.
- A setting controls whether rolled-over tasks land at **top or bottom** of the next day's list.
- **Recurring-task exception:** *"If a recurring task has not been edited and rolls over to a day
  when the next instance occurs, it will be removed to prevent duplicates."* Actions that count as
  "edited" (and therefore preserve the rolled-over instance): editing the task name, notes,
  subtasks; logging actual time; editing planned time; editing channel. **This exception is subtle
  and correct — implement it.**
- Imported calendar events are also subject to rollover; controlled by
  Settings → Calendar → Meeting Import → *"Auto-complete imported calendar events"*.
- **Auto-archive** of the day's completed items: crescent-moon icon or `Shift A`; threshold
  configurable.

**Shutdown ritual:** at end of day, review what you finished and what you didn't, and give each
unfinished item an explicit disposition — carry to tomorrow, schedule for a specific future date,
or drop it.

**Keyboard shortcuts** (a full third table):

| Context | Key | Action |
|---|---|---|
| Global | `?` | searchable shortcut list |
| Global | `A` | open add-task modal |
| Global | `Cmd/Ctrl Shift A` | global add task (desktop) |
| Global | `Cmd/Ctrl K` | Command Bar |
| Add-task modal | `~` | set planned time (duration) |
| Add-task modal | `#` | assign channel |
| Add-task modal | `!` | set priority |
| Add-task modal | `>` | **merge as subtask of another task** |
| Add-task modal | `Enter` / `Cmd Enter` | create / create-and-open |
| Task list | `Space` | start timer |
| Task list | `C` | complete |
| Task list | `F` | focus mode |
| Task list | `X` | auto-schedule |
| Task list | `D` | snooze one day |
| Task list | `Z` | move to backlog |
| Task list | `Cmd/Ctrl Delete` | delete |
| Task list | `G` | open in integrated tool |
| Navigation | `H` / `T` / `P` / `F` | Home / daily Tasks / daily **P**lanning / Focus |
| Focus bar | `Cmd/Ctrl Shift Space` | start/stop timer |
| Notes | `/` | markdown menu |

Command Bar (`Cmd/Ctrl K`) accepts `#` to filter by channel, free text to find tasks and notes, and
command names (`focus`, `dark`, `settings`, `sort`). When you hover a task and then open the command
bar, **task-scoped** actions become available — a nice contextual-palette trick.

## 3.3 Akiflow — the command bar as the whole UI

Open: `Cmd/Ctrl + E` **system-wide** (default, remappable in Settings → Shortcuts);
`Cmd/Ctrl + K` **inside** the app. Requires the desktop app for global capture.

Token syntax inside the command bar:

| Token | Meaning |
|---|---|
| `>` | assign to a time slot |
| `=` | set duration |
| `#` | assign project |
| `*` | add tags |
| `<` | set deadline |
| `!` | set priority |
| `\|` | select calendar |
| `@` | add event guests |
| `//` | add description |
| `ESC` | clear recognition (demote parsed tokens back to text) |

Natural language accepted: `6/6`, `June 6`, `Monday`, `Tomorrow`, `Every Week`.

Creation modes: type a name + `ENTER` → task straight to Inbox. Type a name +
`Ctrl/Cmd + 2` → **New Event** instead of a task. Typing "Zoom" triggers meeting creation.
`P` = plan/reschedule a task or time slot.

**Capture flow:** copy text anywhere (`Cmd C`) → open command bar → a **Capture** option appears
pre-filled → `ENTER` sends it to Inbox → `O` returns you to the source. Clipboard-aware capture is
the highest-leverage trick in this entire dossier for a self-hosted app: zero integrations needed.

Note `ESC = clear recognition` — the same "demote the parse" escape hatch as Todoist's clickable
chip. Two independent apps converged on it. **Build it.**

## 3.4 Morgen

- Sidebar is *"the control center"* — tasks by folder and list, filterable.
- Drag a task from the sidebar onto any open calendar slot; **drag the edges to set duration**;
  copy an instance to create multiple work sessions for one large task; set recurrence after the
  initial scheduling.
- **AI Planner suggestions *pulsate* on the calendar to signal "proposed, not committed."**
  Dragging a task manually overrides the suggestion and hard-commits it. Morgen states the planner
  *"will never make changes to your calendar without your approval."* Its "Priority Factor" weighs
  importance, due date, duration, capacity, recency.
- Gotcha worth copying the *fix* for, not the bug: **tasks with a due date are treated as scheduled
  and hidden from the sidebar** until you enable "Show scheduled tasks" — users report the sidebar
  looking empty while the calendar is full.
- Integrations: Todoist, Notion, Linear, ClickUp, Apple Reminders, Google Tasks, Obsidian,
  Microsoft To Do, Outlook Email, plus a built-in task manager. **CalDAV VTODO task sync is not
  listed in the FAQ — UNVERIFIED / likely absent.** (Morgen does sync calendars bidirectionally in
  real time.)
- Platforms: Windows, macOS, Linux, iOS, Android, web.

## 3.5 Motion — full auto-scheduling (and why Fem-ho should not do this)

Scheduling inputs: **priority** (`ASAP`, `High`, `Medium`, `Low`), **deadline type**
(`Hard` / `Soft`), **duration**, **chunking** (min chunk size — *"a 2-hour task can be worked on in
30-minute chunks"*), **start date** (*"prevents tasks from being scheduled before they are
actionable"*), **recurrence**.

Resolution order:
1. `ASAP` tasks — override everything else (the deadline field literally greys out).
2. Hard deadlines — will schedule **outside normal working hours** if needed.
3. Soft deadlines — ordered by due date.
4. Priority (High > Medium > Low).
5. Duration / chunking efficiency.
6. Start dates.
7. Recurring tasks prioritised over one-offs to protect cadence.

Behaviour: tasks land in *"the first best open block"*; Motion *"reshuffles automatically"* on
conflict; when nothing fits, lower-priority work slides later in the week.
UI: ⏰ clock icon for Flexible Hours; **diagonal grey shading for blocked time**.

## 3.6 Amie

- **Unscheduled todos live in a left-hand column beside the calendar**; drag onto the grid to fix a
  date and time.
- Team members' avatars sit on the leftmost edge of the sidebar; availability is read off how they
  have plotted their own time. (Relevant to Fem-ho's family/collective scopes.)
- Switches between a daily timeline and a gridded week view to trade information density.

## 3.7 TickTick

- **Calendar view** timeline covers the whole day, but **00:00–07:00 and 21:00–00:00 are collapsed
  by default**; click to expand, or drag the timeline bar to change the hidden ranges. Excellent
  default — a 24-hour grid wastes most of its pixels.
- Un-timed tasks live in a **task bar**; **"Arrange Tasks"** opens the panel (swipe from the right
  screen edge, or ⋯ → *Arrange Tasks* at top-right of the calendar view), then drag tasks onto time
  points.
- **Timeline (Gantt) view**: drag a task into the timeline; start and end times are set from the
  drop position.
- **Smart Recognition** — auto-parses date/time from typed *or voice* input and sets the reminder.
  Ambiguous dates resolve to *the nearest valid future date/time*. Toggle at
  Settings → General → Smart Recognition → Smart Date Parsing.
- Quick-add tokens (third-party documented; **treat as UNVERIFIED against official docs**, which are
  JS-rendered and were not fetchable): `^list`, `#tag`, `*duedate`, `!priority`, `@user`.
  Note TickTick's `#` = **tag** and `^` = **list**, the reverse of Todoist. Sigil semantics are
  *not* standardised across the market — which means Fem-ho is free to pick, but must document.
- Desktop shortcuts (subset, from a cheat-sheet compilation — **UNVERIFIED against official docs**;
  note the `Ctrl+0..3` overload appears in two different contexts, which is itself a warning):

| Key | Action |
|---|---|
| `Ctrl Shift A` | display quick-add bar (global) |
| `Ctrl N` | new task |
| `Ctrl S` | sync |
| `Ctrl F` | search |
| `Ctrl Shift M` | mark complete |
| `Ctrl D` | open date picker |
| `Ctrl 0/1/2/3` | remove date / today / tomorrow / next week |
| `Ctrl Shift P` | start/stop pomodoro |
| `Ctrl Shift L` | toggle mini window |
| `Ctrl Alt T` | Today |
| `Ctrl Alt N` | Next 7 days |
| `Ctrl Alt 1` | Inbox |
| `?` | show shortcut list |

## 3.8 Amazing Marvin — "strategies" as opt-in features

Marvin's core idea: **every behaviour is a toggleable "strategy"**, so the app is a kit rather than
an opinion. Documented feature/strategy names:

- *Planning*: Day Planner, Week Planning, Calendar, Calendar Sync, Due Dates, **Do Dates**,
  Start/Defer Dates, Duration Estimates, Time Targets, Long-term Planning, Agenda/Timeline
- *Organisation*: Nested Categories & Projects, Labels & Tags, Smart Lists, Recurring Tasks,
  Sequential & Parallel Projects, **Backburner**, Custom Sidebar, and attribute strategies:
  **Dread ("Frogs")**, Urgency, Importance, Focus Required, Energy Level, Positive Feelings
- *Focus*: Super Focus Mode, Built-in Timers, Pomodoro Counter, Time Tracking, Top of Mind,
  Focus Music
- *Motivation*: Gamification, Habit Tracking, Goals, Check-off Behavior, Marvin Kudos
- *ADHD*: **Procrastination Wizard**, Task Breakdown, **Capacity Estimator**, Mood Tracker,
  **Truncated List Strategy**, Accountability Pledge
- *Integrations*: Chrome Extension, **Email to Marvin**, API, Zapier, Import
- *Customisation*: Themes, Keyboard Shortcuts, Strategy Settings

**Day Planning** specifics: a daily alert prompts you to *"plan one day at a time"*; the "Plan day"
button opens the **Master List** sidebar for drag-and-drop scheduling. The planning header shows
**Tasks** (count scheduled + 30-day completion average), **Projects**, **Duration** (sum of
estimates; default estimate **20 min for tasks, 45 min for projects**), and **Events** (total
duration of calendar events within working hours). Capacity is signalled with emoji:
🙂 average, 🤩 40+ min above average, 😅 / 😓 approaching research-backed sustainable limits,
😱 total available hours. Recovery hatch: type `_planDay` in Quick Add and restart.

**Time Block Sections** strategy: takes your defined time blocks and creates one **section in the
daily to-do list per time block**, so you schedule tasks *into* blocks without touching a calendar
grid. A time block can be bound to a category, project, label or Smart List.

Tasks can be grouped in the day plan by morning/afternoon/evening, Essential/Bonus, categories, or
custom sections.

### → WHAT FEM-HO SHOULD DO (calendar fusion)

1. **Put the Inbox column on the LEFT and make it persistent across both views.** Todoist, Sunsama,
   Akiflow, Morgen and Amie all put the reservoir on the left; TickTick's right-side panel is
   swipe-summoned and therefore less discoverable. Left, always visible, collapsible with a
   remembered per-user state.
2. **Make the Inbox column literally the same component in the tasks view and the calendar view.**
   Fem-ho's spec already says "shared". Implement it as one component with one data source, so a
   task dragged out of it in either view disappears from both. Fem-ho's differentiator over
   Todoist is that in the tasks view the same column is *column 1 of the kanban* — a genuinely
   novel and coherent unification. Lean into it: the Inbox is not a sidebar that happens to look
   like a column, it **is** the column.
3. **Drag semantics — define these four explicitly:**
   - **Inbox → calendar day cell (month view)** = set due date, no time. Task stays in Inbox
     column? **No** — move it to *Per fer*. Rationale: scheduling is a triage decision, and Inbox
     must trend to zero (§7).
   - **Inbox → calendar time slot (week/day view)** = set due datetime + duration from the drop
     height. Move to *Per fer*.
   - **Drag the bottom edge of a scheduled task** = change duration (Morgen precedent).
   - **Calendar → Inbox** = unschedule (clear date), return to Inbox. This reverse drag is missing
     from most competitors and is the natural undo.
4. **Collapse dead hours by default** (TickTick precedent): hide 00:00–07:00 and 22:00–00:00 in
   week/day views, expandable by click. For a family app, also consider a "school hours" band.
5. **Use diagonal grey shading for unavailable time** (Motion precedent) rather than hiding it.
6. **Ship a lightweight "planificació del dia" ritual, but make it optional and non-blocking.**
   Sunsama's ritual is its whole product; for Fem-ho it should be a dismissible card at the top of
   the Inbox column, once per day: *"Tens 6 tasques d'ahir sense fer. Les passes a avui?"* with
   [Totes] [Triar] [Ara no]. Precedent: Sunsama's configurable "automatic rollover vs prompt".
7. **Implement carry-over exactly like Sunsama:**
   - Unfinished tasks in *Per fer* / *Fent* roll to the next day at local midnight.
   - Setting: automatic vs prompt.
   - Setting: rolled-over tasks go to **top** of the column (default) or bottom.
   - **Implement the recurring-task de-duplication exception verbatim**: if an *unedited* recurring
     instance would roll into a day where the next instance already fires, delete the rolled
     instance. "Edited" = title, notes, checklist, logged time, estimate, or scope changed.
     Without this rule you get 14 copies of "treure les escombraries" by week three.
8. **Do NOT build auto-scheduling (Motion-style).** Three reasons: (a) it requires an optimiser you
   would have to maintain; (b) Fem-ho explicitly *has no AI engine of its own* — auto-scheduling
   is precisely the kind of thing to expose via MCP and let an external model propose; (c) in a
   family context, an algorithm silently moving someone else's task is a trust disaster.
   **Instead: copy Morgen's *pulsating suggestion* affordance.** When the AI user (via MCP/API)
   proposes a schedule, render those blocks in a distinct **proposed** state — Plou can express
   this as a dashed-outline pill with reduced opacity and a subtle pulse — with per-block
   Accept/Reject, plus "accept all". Never let an API caller hard-commit a schedule change
   without either explicit user acceptance or a scope-level "AI may schedule directly" permission.
   Every accept/reject goes in the audit trail.
9. **Copy Akiflow's clipboard capture.** On web: when the quick-add opens and the clipboard holds
   text/a URL, offer a one-key "Enganxa com a tasca" chip. On Android: register an
   `ACTION_SEND` / `ACTION_PROCESS_TEXT` intent filter so *any* app's share sheet can push into
   Fem-ho's Inbox. For a self-hosted app with no Slack/Gmail integrations, share-sheet + clipboard
   **is** the universal inbox.
10. **Copy duration estimates with sane defaults** (Marvin: 20 min task / 45 min project) and show
    a **capacity readout** on the day: "3 h 20 min planificat · 2 esdeveniments · 1 h 15 lliure".
    Avoid Marvin's emoji-shaming; a neutral bar in the Plou gradient is enough.
11. **Copy Sunsama's add-modal enrichment tokens for a second, richer capture path**: `~duration`,
    `!priority`, `>merge as subtask of`. `>` in particular ("crea això com a subtasca de X") is a
    capture affordance nobody else has and it fits Fem-ho's task→subtask→checklist depth.
12. **Copy the "hidden because it's scheduled" bug fix, not the bug.** Fem-ho's Inbox column should
    show *undated* tasks by default with an explicit toggle for "mostra també les programades",
    and the toggle state must be visible (a chip, not a buried setting), or users will think the
    app lost their tasks.

---

# PART 4 — OPEN-SOURCE, CalDAV-NATIVE TASK UIs

## 4.1 Nextcloud Tasks

- Web app inside Nextcloud. Supported operations per its README: add/delete tasks; edit **title,
  description, start date, due date, priority, status**; **subtasks**; drag-and-drop between
  calendars (and drag a task onto another to make it a subtask).
- **Smart collections**: important / current / upcoming (the README wording is *"smart collections
  showing you your important, current and upcoming tasks"*). Commonly surfaced as
  Important / Today / Week / All / Current / Completed — **UNVERIFIED as to the exact set**.
- Syncs via CalDAV with Apple Reminders, 2Do, DAVx⁵, Outlook, Thunderbird, and others.
- Subtasks are modelled with iCalendar **`RELATED-TO`** (this is the interop-relevant fact).
- Exact frontend versions (Vue major, `cdav-library`, `ical.js`) — **UNVERIFIED**, not stated in the
  README excerpt; read `package.json` directly before depending on it.
- Known rough edge from the issue tracker: *"Task Does Not Remember Percent Complete or Priority On
  Status Change"* (nextcloud/tasks#2335) and *"Missing support of a task's privacy setting"*
  (#243, i.e. `CLASS`). Both are worth having tests for in Fem-ho's own CalDAV layer.

## 4.2 Nextcloud Deck (kanban — the closest self-hosted precedent for Fem-ho's board)

Model: **Board → Stack (column) → Card**. Labels, attachments, assigned users, due date, done flag,
archived flag.

REST API base path:
```
https://<host>/index.php/apps/deck/api/v1.0
```
Required headers: `OCS-APIRequest: true`, `Content-Type: application/json`.

Endpoints:
```
GET    /boards
POST   /boards
GET    /boards/{boardId}
PUT    /boards/{boardId}
DELETE /boards/{boardId}

GET    /boards/{boardId}/stacks
POST   /boards/{boardId}/stacks
PUT    /boards/{boardId}/stacks/{stackId}
DELETE /boards/{boardId}/stacks/{stackId}

GET    /boards/{boardId}/stacks/{stackId}/cards/{cardId}
POST   /boards/{boardId}/stacks/{stackId}/cards
PUT    /boards/{boardId}/stacks/{stackId}/cards/{cardId}
DELETE /boards/{boardId}/stacks/{stackId}/cards/{cardId}

POST   /boards/{boardId}/labels
PUT    /boards/{boardId}/labels/{labelId}
DELETE /boards/{boardId}/labels/{labelId}

POST   /boards/{boardId}/stacks/{stackId}/cards/{cardId}/attachments
DELETE /boards/{boardId}/stacks/{stackId}/cards/{cardId}/attachments/{attachmentId}
```

Card JSON fields: `title`, `description`, `stackId`, `type`, `order`, `duedate`, `done`,
`archived`, `assignedUsers`, `labels`, `owner`, `createdAt`, `lastModified`.

**The reorder endpoint** — the single most copy-worthy API shape in this dossier, because
"move card to column X at position N" is *the* kanban write:
```
PUT /boards/{boardId}/stacks/{stackId}/cards/{cardId}/reorder
{
  "order":   <int>,
  "stackId": <int>
}
```
One call carries both the column change and the position change. Do not split these into two calls;
you will create a visible intermediate state and an ordering race under offline sync.

Deck has **no swimlanes** — long-standing open requests (nextcloud/deck#32, #5539). The community
regularly conflates "list/column" with "swimlane", which is a naming trap to avoid.

## 4.3 Tasks.org (Android)

- Fork/descendant of Astrid. Fully usable **offline**, or synced with **Google Tasks, CalDAV, or
  EteSync**. F-Droid + Play Store.
- Features: filters, tags, lists, **infinite-depth subtasks**, manual (drag) sorting, list icons and
  colours, powerful repeat rules, **location-based arrival/departure notifications**, and
  "automatically add tasks to your calendar".
- **The interop war story you must learn from:** issue
  [tasks/tasks#3023](https://github.com/tasks/tasks/issues/3023) — *"Tasks.org is breaking the
  subtask hierarchical relationships when tasks are synced from a CalDAV server. Tasks are always
  imported jumbled up."* Earlier: #932 *"Subtasks disappear when Sync activated."* The root cause
  pattern is that **`RELATED-TO` resolution is order-dependent**: if a child VTODO is ingested
  before its parent exists locally, the parent pointer dangles and the child renders as a
  top-level task. Some clients resolve lazily and recover; some flatten permanently.

## 4.4 OpenTasks (dmfs)

- Android task app built on a **task ContentProvider** (`TaskContract`), which other apps can read
  and write — an important Android-ecosystem pattern.
- **Its subtask model is NOT `RELATED-TO`.** From
  [dmfs/opentasks#341](https://github.com/dmfs/opentasks/issues/341): OpenTasks implements subtasks
  as an internal list feature, so:
  - Subtasks created in the Nextcloud/ownCloud web UI show up in OpenTasks as **separate top-level
    tasks**.
  - Subtasks created in OpenTasks show up in Nextcloud **inside the description field only**.
- This is the canonical example of what happens when you invent a private hierarchy model instead of
  using the standard one. Cost: total loss of structure at every sync boundary.

## 4.5 jtx Board

- Android app that stores **VJOURNAL** (journals + notes) and **VTODO** (tasks) as first-class
  components, explicitly *"compliant to the definition of the VJOURNAL component"* / VTODO
  respectively, and *"fully complies with the international iCal specification (RFC 5545)"*.
- Syncs through **DAVx⁵** to any CalDAV server.
- Has a **Kanban board view** with drag-and-drop (the manifest requests `VIBRATE` specifically
  *"when moving an entry on the Kanban-Board"* — haptics on column drop, a nice detail).
- Supports linking a task to a journal entry (meeting minutes → action items), alarms
  (`POST_NOTIFICATIONS`), audio notes and speech-to-text (`RECORD_AUDIO`), location/geofencing.
- Field-level support for categories, classification, attachments, recurrence, comments,
  `RELATED-TO` — implied by RFC 5545 compliance but **not enumerated in the README: UNVERIFIED**.
- DAVx⁵ note: creating a collection advertising **VJOURNAL + VTODO together fails on some servers
  when VEVENT is also present** (bitfireAT/davx5-ose discussion #968). Relevant if Fem-ho ever
  advertises multi-component collections.

## 4.6 Vikunja (the closest all-round self-hosted competitor)

- Single binary or Docker container; SQLite by default, PostgreSQL/MySQL optional.
- **Speaks CalDAV** so tasks appear in native phone calendar/todo apps.
- Kanban view uses **buckets** (columns), freely created and reordered, drag between buckets.
- **Bucket task counts are shown even when no WIP limit is set**; WIP limits are configurable per
  bucket via the API.
- A **"done bucket"** concept exists: dropping a task into the designated bucket marks it done.
  (Exact field names — **UNVERIFIED**; the docs URL I tried 404'd.)
- **API versioning fact worth recording:** *"Starting with Vikunja 2.4.0 there is a second API
  version with standard REST verbs and an OpenAPI 3.1 spec"*; v1 stays supported but new endpoints
  land only on v2; **Vikunja 3.0 will deprecate v1 and 4.0 will remove it.** Auth is a bearer token
  in the `Authorization` header.

## 4.7 VTODO round-tripping — the consolidated rules

What the ecosystem actually agrees on:

| Concept | iCalendar representation | Notes / risk |
|---|---|---|
| Task | `VTODO` component | one per `.ics` resource |
| Identity | `UID` | must be stable across edits; never regenerate |
| Title | `SUMMARY` | |
| Notes | `DESCRIPTION` | OpenTasks dumps subtasks here — a lossy anti-pattern |
| Start | `DTSTART` | Things' "when" ≈ this |
| Due | `DUE` | |
| Completion | `COMPLETED` (timestamp) + `STATUS:COMPLETED` + `PERCENT-COMPLETE:100` | **all three, or clients disagree** |
| Status | `STATUS` = `NEEDS-ACTION` / `IN-PROCESS` / `COMPLETED` / `CANCELLED` | only 4 values exist |
| Progress | `PERCENT-COMPLETE` 0–100 | Nextcloud has a known bug losing this on status change |
| Priority | `PRIORITY` 0–9 (1 = highest, 0 = undefined) | ≠ Todoist's p1–p4; needs a mapping |
| Hierarchy | `RELATED-TO;RELTYPE=PARENT` (or default `PARENT`) | **the only portable subtask mechanism** |
| Tags | `CATEGORIES` (comma-separated) | |
| Privacy | `CLASS` = `PUBLIC` / `PRIVATE` / `CONFIDENTIAL` | Nextcloud Tasks lacked UI for this (#243) |
| Recurrence | `RRULE` | **cannot express completion-based recurrence** |
| Alarms | `VALARM` | |
| Change tracking | `SEQUENCE`, `LAST-MODIFIED`, `DTSTAMP` | |

**The four failure modes, each with a named victim:**

1. **Order-dependent `RELATED-TO`** → flattened subtasks (tasks/tasks#3023).
   *Fix:* on ingest, do two passes — create/update all VTODOs first with parent pointers stored as
   raw UIDs, then resolve pointers. Keep unresolved pointers rather than dropping them, and
   re-resolve on every sync.
2. **Private hierarchy model** → structure invisible to every other client (dmfs/opentasks#341).
   *Fix:* `RELATED-TO` is the model, not an export format.
3. **Non-standard state stuffed into `DESCRIPTION`** → other clients show garbage in the notes.
   *Fix:* use `X-` properties, which are legal and ignorable, never `DESCRIPTION`.
4. **Partial completion tuples** → a task shows done in one client, not in another.
   *Fix:* always write `STATUS`, `COMPLETED` and `PERCENT-COMPLETE` together.

### → WHAT FEM-HO SHOULD DO (CalDAV-native model)

1. **Make VTODO the storage-truth for tasks, and make Fem-ho-only concepts `X-` properties.**
   Concretely, the extensions Fem-ho needs:
   ```
   X-FEMHO-COLUMN:INBOX|TODO|DOING|DONE
   X-FEMHO-SCOPE:<scope-uid>
   X-FEMHO-PROJECT:<project-uid>
   X-FEMHO-POSITION:<lexorank string>
   X-FEMHO-AI-MODE:SELF|ASSISTED|DELEGATED
   X-FEMHO-RECUR-FROM-COMPLETION:TRUE      ← the `cada!` semantics RRULE can't express
   X-FEMHO-CHECKLIST-ID:<uid>
   ```
   Any CalDAV client will ignore these and round-trip them untouched (well-behaved ones preserve
   unknown properties). **Verify preservation against your target servers** — this is the single
   highest-risk assumption in Fem-ho's interop story and deserves an integration test per server
   (Radicale, Baïkal, Nextcloud, Xandikos).
2. **Never invent a hierarchy model.** `RELATED-TO;RELTYPE=PARENT` for task→subtask. Two-pass
   resolution on ingest. Retain dangling parent UIDs.
3. **Checklists ("llistes simples") must NOT be VTODOs.** They are not tasks — they have no dates,
   no status vocabulary, no assignee. If you emit them as VTODOs, every family member's phone
   Reminders app fills with 40 shopping-list items. Options, best first:
   - **(a)** Store them as Fem-ho-native rows; serialise into the parent VTODO's `DESCRIPTION` as a
     markdown task list **only if** a per-scope setting "exposa les llistes al CalDAV" is on;
     default off. (This is exactly what OpenTasks did wrong — but here it is *opt-in and
     lossy-by-design*, with the authoritative copy in Fem-ho's DB.)
   - **(b)** Expose each checklist as its **own** CalDAV collection when the user explicitly shares
     it. Cleaner but heavier.
   Recommend (a) with the toggle, plus REST/MCP as the real access path.
4. **Map priority explicitly and document it.** Suggested: Fem-ho p1→`PRIORITY:1`,
   p2→`5`, p3→`7`, p4/none→`0`. Round-trip: 1–4→p1, 5→p2, 6–9→p3, 0→none.
5. **Column ⇄ status mapping — decide once, write it down:**
   | Fem-ho column | `STATUS` | `PERCENT-COMPLETE` |
   |---|---|---|
   | Inbox | `NEEDS-ACTION` | 0 |
   | Per fer | `NEEDS-ACTION` | 0 |
   | Fent | `IN-PROCESS` | (preserve user value, else 50) |
   | Fet | `COMPLETED` + `COMPLETED:<utc>` | 100 |
   Inbox and Per fer are indistinguishable in VTODO — that is *why* you need
   `X-FEMHO-COLUMN`. On ingest of a foreign `NEEDS-ACTION` VTODO with no `X-FEMHO-COLUMN`,
   **route it to Inbox**. That is the correct and delightful default: anything a family member
   creates in Apple Reminders lands in Fem-ho's Inbox for triage.
6. **Copy Nextcloud Deck's single-call reorder endpoint shape** for Fem-ho's REST API:
   ```
   PUT /api/v1/tasks/{id}/move
   { "column": "DOING", "scope_id": "...", "project_id": "...", "position": "0|hzzzzz" }
   ```
   Use a **fractional/LexoRank-style string position**, not integers — integer `order` forces a
   rewrite of every sibling on insert, which is intolerable for an offline-first Android client
   that must merge concurrent reorders.
7. **Copy Vikunja's API-versioning discipline**: ship `/api/v1` with an **OpenAPI 3.1** document
   from day one, and state the deprecation policy in the docs. An MCP server generated from (or
   validated against) the OpenAPI spec is far cheaper to maintain than a hand-written one.
8. **Follow Tasks.org's "works fully offline, sync is optional" framing in copy but not in
   architecture** — Fem-ho's Android app is explicitly always-paired-to-a-server. Still, the local
   store must be authoritative for reads and optimistic for writes, with a conflict policy
   (recommend: last-writer-wins per field, plus `SEQUENCE`/`LAST-MODIFIED` guards, plus an audit
   entry on every server-side overwrite so the AI audit trail doubles as a sync forensics log).
9. **Steal jtx Board's haptic detail**: vibrate on successful column drop on Android. It converts a
   risky drag into a confirmed one without a toast.

---

# PART 5 — OPEN-SOURCE KANBAN PATTERNS

## 5.1 Wekan — the most complete data model to copy

Collections (`models/*.js`): **Boards, Lists, Swimlanes, Cards**.

| Entity | Key fields |
|---|---|
| Board | `title`, `slug`, `permission`, `members`, `labels`, `color`, `type`, and capability flags `allowsSubtasks`, `allowsAttachments`, `allowsChecklists` |
| List | `title`, `boardId`, `swimlaneId`, `sort`, `color`, `type`, `collapsed`, **`wipLimit { value, enabled, soft }`** |
| Swimlane | `title`, `boardId`, `sort`, `color`, `type`, `collapsed` |
| Card | `listId`, `swimlaneId`, `sort` (+ the usual title/desc/members/labels/dates) |

View modes: **Swimlanes** (matrix of horizontal swimlanes × vertical lists), **Lists** (lists only,
no swimlanes), **Calendar**, **Table**. **View preference is stored on the user profile**, with
`localStorage` fallback for anonymous users.

WIP limit UX: the list header shows *current card count / limit*; when a **soft** limit is exceeded
the count is highlighted rather than the drop being refused. Per-swimlane WIP limits are a separate
long-standing request (wekan#2380).

The `wipLimit { value, enabled, soft }` triple is the right shape — **copy it verbatim.**
`enabled` separate from `value` lets a user park a limit without losing it; `soft` is the
difference between a nag and a wall.

## 5.2 Kanboard

- Views per project: **Board, Calendar, List, Gantt**; *"each view shows the result of the filter
  box at the top"* — i.e. **one filter query drives every view**. (Directly applicable: Fem-ho's
  scope chips + project dropdown should filter the tasks view and the calendar view identically.)
- **WIP feedback: "When the task limit is reached for a column, the background becomes red."**
  Whole-column background, not a badge. Loud, unmissable, zero chrome.
- Columns can be **hidden/shown** from a dropdown; a `+` icon restores hidden ones.
- **Compact mode** shows all columns at once when horizontal space is tight; toggle with `c`.
  Collapsed cards show **assignee initials + task number**, with the full title on hover.
- Tasks changed recently render with a **shadow** — a cheap recency cue.
- Keyboard shortcuts (a fourth full table):

| Context | Key | Action |
|---|---|---|
| Project views | `v o` | project overview |
| Project views | `v b` | board |
| Project views | `v c` | calendar |
| Project views | `v l` | list |
| Project views | `v g` | Gantt |
| Board | `n` | new task |
| Board | `s` | expand/collapse tasks |
| Board | `c` | compact / wide view |
| Task | `e` | edit task |
| Task | `s` | new subtask |
| Task | `c` | new comment |
| Task | `l` | new internal link |
| Global | `?` | show shortcut list |
| Global | `b` | board switcher |
| Global | `f` | focus search box |
| Global | `r` | reset search box |
| Global | `Esc` | close dialog |
| Global | `Ctrl/⌘ + Enter` | submit form |

Note the **`v` + letter chord** for view switching and the reuse of single letters scoped by
context. This is a very cheap, very learnable model.

## 5.3 Focalboard

- Backend: **Go 1.21**, Gorilla Mux (HTTP), Gorilla WebSocket (realtime), **Squirrel** (SQL builder),
  **Morph** (migrations), SQLite (`mattn/go-sqlite3`) by default, PostgreSQL (`lib/pq`) for
  production, Prometheus metrics endpoint.
- Frontend: **React 17 + TypeScript**, webpack, **Redux Toolkit**, **Draft.js** (card rich text),
  **FullCalendar** (calendar view), **react-beautiful-dnd** (card drag/order), react-intl for i18n.
- Desktop shells: WPF (Windows), Xcode (macOS), WebKitGTK (Linux).
- Model: a board is a **collection of cards with typed properties**; the kanban is a *grouping* of
  those cards by a chosen property — i.e. columns are **derived**, not stored on the card.

## 5.4 Planka

- **React** frontend, **Node.js** backend, JavaScript, Docker/docker-compose deployment, Swagger API.
- Hierarchy: **projects → boards → lists → cards**.
- Features named on the repo page: drag-and-drop, real-time syncing, markdown card descriptions,
  notifications via 100+ providers, OpenID Connect auth, multilingual.
- Licensing: **fair-code** (Community License + commercial Pro/Enterprise) — *not* OSI-open. Worth
  knowing before borrowing code. Specific drag-drop library — **UNVERIFIED** from the repo page.

## 5.5 AppFlowy

- Flutter + Rust; the kanban is a separate reusable widget package, **`appflowy-board`**
  (github.com/AppFlowy-IO/appflowy-board): *"a board-style widget that consists of multi-groups
  … supports drag and drop between different groups."*
- **Grouping model:** the board is generated from a chosen `grouping_field` on a database. For every
  supported field type **except checkbox**, there is a special, **non-removable "No Status" group**
  holding cards whose grouping cell is empty.
- New groups can be created only when the grouping field is single-select or multi-select — via a
  `+` at the right end of the board.

**The "No Status" group is exactly Fem-ho's Inbox column**, arrived at independently: when you
group by a state field, you *must* have a home for the un-stated. AppFlowy makes it non-removable.
So should Fem-ho.

## 5.6 Super Productivity

- Board View: columns are **saved filters over the same tasks**, not containers. Membership is
  *"calculated dynamically"* — a task can appear on several boards at once.
- A panel is defined by: **filters** (tags, done/undone, scheduled/unscheduled, project, backlog
  status) + **ordering** (drag-and-drop) + **automatic updates** (moving a card into a panel
  *writes* the panel's defining properties onto the task: adds/removes tags, sets done, sets
  project, sets scheduling).
- Ships two presets: **Eisenhower Matrix** (4 quadrants) and **Kanban** (To Do / In Progress / Done).
- Also has timeboxing + a daily planner where tasks are dragged onto a schedule; recurring-task
  settings live inside the planner's schedule dialog.

**"Dropping a card into a column writes that column's predicate onto the task"** is the cleanest
formulation of kanban semantics I found anywhere. It generalises perfectly: a column is a
*predicate*; a drop is an *assignment that makes the predicate true*.

## 5.7 Drag-and-drop library landscape (for the web app)

- **`react-beautiful-dnd`** — used by Focalboard. Rich (multi-drag, virtual lists, SSR) but
  **no longer maintained; the authors state there are no plans for future development.** Do not
  start new work on it.
- **`@dnd-kit`** — the current recommended successor for React: flexible, accessible, no HTML5
  drag-and-drop dependency, works with pointer/keyboard/touch sensors. Lacks some rbd niceties
  out of the box.
- **`react-dnd`** — older, HTML5-backend-centric.
- For **Svelte/Vue/vanilla**, `sortablejs` remains the workhorse. Exact current version numbers —
  **UNVERIFIED**; check the registry at implementation time rather than trusting this document.

Accessibility note: whichever library, the board must be operable **without a pointer**. Kanboard
and Todoist both prove a keyboard path is achievable; `@dnd-kit` ships a `KeyboardSensor`.

### → WHAT FEM-HO SHOULD DO (kanban)

1. **Fix the four columns; do not make them user-configurable.** Inbox / Per fer / Fent / Fet is a
   deliberate, opinionated product decision and it is Fem-ho's identity. Configurable columns turn
   it into Wekan and destroy the ability to give Inbox and Fet special behaviour (§6). Precedent
   for opinionated fixed states: Super Productivity's Kanban preset; Things' five fixed lists.
2. **Treat a column as a predicate, not a container** (Super Productivity precedent). Dropping a
   task in *Fet* sets `status=COMPLETED, completed_at=now, percent=100`. Dropping in *Fent* sets
   `IN-PROCESS`. Dropping in *Inbox* clears scope/project routing? **No** — clears nothing, only
   sets `column=INBOX`; Fem-ho's Inbox is per-user triage, not an unrouting operation.
3. **Make Inbox non-removable and always leftmost** (AppFlowy "No Status" precedent). Any task
   arriving from CalDAV, REST, MCP, share-sheet, or email with no explicit column lands here.
4. **Adopt Wekan's `wipLimit { value, enabled, soft }` on the *Fent* column only.** WIP limits on
   Inbox/Per fer/Fet are meaningless; on *Fent* they are the entire point of kanban. Default:
   `enabled: false`. When a user enables it, use **Kanboard's whole-column red background** rather
   than a badge — it is the loudest possible signal for the least chrome, and it fits Plou's
   "one brand gradient per view" better than a competing accent colour would (desaturate the
   gradient and overlay the warning tint).
5. **Adopt Kanboard's compact mode and collapsed cards.** Four columns on a phone-width viewport is
   impossible; the Android app must degrade to a **single column with a segmented control** (or a
   swipeable pager) rather than horizontally scrolling four columns. On tablet/desktop, offer
   compact mode (`c`) showing all four without horizontal scroll, with collapsed cards showing
   assignee avatar + title only.
6. **Adopt Kanboard's "recently changed cards get a shadow."** In a multi-user household this is
   the cheapest possible awareness cue — "algú ha tocat això". Plou already specifies soft
   shadows; use an intensified shadow + short highlight animation for cards changed since the
   user's last visit. Tie it to the audit trail you are already writing.
7. **Do not build swimlanes.** Fem-ho's scope chips are multi-select and already provide horizontal
   segmentation; adding swimlanes on top produces a 4×N grid nobody can read on a phone. Deck
   has survived years without them. **If** grouping is ever wanted, do it as
   "agrupa per: àmbit / persona / projecte / cap" *inside* a column, collapsible, à la Wekan's
   collapsed swimlanes — not as a second axis.
8. **Position field: fractional string ranks, single-call moves** (see §4.7 rec. 6). This is
   non-negotiable for offline-first Android.
9. **Drag library: `@dnd-kit`** if the web app is React. Explicitly avoid `react-beautiful-dnd`
   (unmaintained). Verify current versions at build time. Ensure a full keyboard path:
   select card → `Ctrl+→` / `Ctrl+←` moves between columns, `Ctrl+↑` / `Ctrl+↓` reorders —
   mirroring Things' `⌘↑/⌘↓` and Todoist's `Ctrl+↑/↓`.
10. **Store the user's view preference on the user profile, not localStorage** (Wekan precedent),
    because Fem-ho is multi-device by definition (web + Android) and the preference must follow the
    person. Keep localStorage as the pre-auth fallback only.

---

# PART 6 — GTD / INBOX-ZERO MECHANICS

## 6.1 The five steps (David Allen, as universally documented)

1. **Capture** — record anything that has your attention, into an inbox. Zero friction, zero
   categorisation.
2. **Clarify** — decide what each item is and what, if anything, to do about it.
3. **Organize** — put it in the right list.
4. **Reflect** — review, keep the system current.
5. **Engage** — do the work.

**The Two-Minute Rule:** if an item is actionable and doable in under two minutes, **do it now**;
otherwise defer it onto the correct list.

The load-bearing insight for UI: **Capture and Clarify are different modes, and mixing them is what
kills task apps.** Every app that requires you to pick a project at capture time is forcing a
Clarify decision during Capture, and users respond by not capturing.

## 6.2 What makes an Inbox column *feel* right

Synthesising Todoist's methodology, Things' Inbox definition, Akiflow's Universal Inbox, and
AppFlowy's non-removable "No Status" group:

1. **It is the default.** No routing token → Inbox. Never a modal asking "which project?".
2. **It accepts a bare string.** Title only is a valid, complete task.
3. **It is a queue that should trend to zero**, and the UI should say so — a count, and ideally a
   gentle state change when it hits zero (an empty state that *congratulates*, §8).
4. **It is not a project.** It must not be selectable as a destination in the project dropdown; it
   is a stage, not a place.
5. **Processing out of it must be one gesture.** Drag right into *Per fer* (which is the Clarify
   action) or drag onto a calendar day. Never "open the task, find the field, pick, save".
6. **It is shared across views** — the same items, whether you are looking at the board or the
   calendar. This is what turns "Inbox" from a list into a *workspace-wide staging area*.
7. **It must be per-user in a multi-user instance.** A family Inbox that everyone sees is not an
   inbox, it is a wall. (Exception: an explicitly collective scope may have a shared inbox — but
   the default view must be *my* inbox.)

## 6.3 Carry-over of unfinished tasks

Sunsama is the only app with fully documented mechanics, and they are the right ones — see §3.2.
Summary of the rules worth copying:

- Roll over at **local midnight**.
- **Configurable: automatic vs prompt.** Prompt is the GTD-purist option (it forces a Clarify
  decision); automatic is the low-friction option. Ship automatic as default, prompt as a setting,
  because a family app must survive being ignored for a week.
- Configurable **top vs bottom** placement of rolled items.
- **Recurring de-duplication exception** (see §3.2) — mandatory.
- Sunsama's **shutdown ritual** gives every unfinished item an explicit disposition: tomorrow /
  specific future date / drop.
- Sunsama has `D` = snooze one day and `Z` = move to backlog as one-key dispositions. Fem-ho should
  bind equivalents.

## 6.4 The "done column resets daily" pattern

Named source: **Personal Kanban** (Benson & Barry), *DONE COLUMN: Daily / Weekly Review* design
pattern. (The page itself 403'd to my fetcher — **the pattern name and framing are attested via
its own site's page title and indexed summary, but I could not read the full text: UNVERIFIED in
detail.**) What is well-attested across sources:

- **"Your Done Column Is Not a Graveyard."** The Done column's function is *motivational and
  diagnostic*, not archival. Its value is that you can see the actual output of your week.
- The documented ritual is a **weekly** walk-through (Sunday evening or Monday morning): clear
  Done, pull new cards into the current week, and **challenge any card that has been in Doing for
  more than three days**. That last rule is a genuinely good, cheap heuristic.
- **Throughput** — the number of cards completed per day — is the metric the Done column exists to
  make visible; knowing it stops you over-committing.
- Clearing cadence varies (daily / weekly / at milestones); **weekly is the documented default**,
  not daily.

Contrast with the apps: Things has an explicit user-triggered `⇧⌘Y` "Move completed to Logbook"
(never automatic). Sunsama has **auto-archive with a configurable threshold** (`Shift A`).
Kanboard/Wekan/Deck use manual archive. **Nobody auto-clears Done on a timer without telling you** —
and that is the correct instinct: silently removing evidence of work is demotivating and reads as
data loss.

### → WHAT FEM-HO SHOULD DO (GTD / inbox / done column)

1. **Capture must never require a Clarify decision.** Quick-add with a bare string must be a
   complete, valid operation. All sigils optional. This is the single most important rule in this
   document.
2. **Implement the two-minute rule as an affordance, not a lecture:** in the Inbox column, a card's
   hover/long-press menu offers **"Fet"** as the *first* action, next to "Per fer". Completing
   straight out of the Inbox is the digital two-minute rule.
3. **Inbox count as a badge on the column header**, and per-scope in the chip when filtered.
4. **`Fet` column: show today's completions by default, with a "mostra la setmana" toggle and an
   explicit `Arxiva els fets` action.** Rules:
   - Cards in *Fet* older than the current day are **collapsed under a divider**
     ("Ahir · 4", "Aquesta setmana · 11"), not hidden. Precedent: Things' Logbook is a separate
     place, but Fem-ho's four-column layout means Fet needs in-place compression.
   - **Auto-archive is opt-in with a configurable threshold** (Sunsama precedent: `Shift A`,
     adjustable). Never on by default.
   - Offer a **weekly review card** at the top of *Fet* on the configured review day:
     "Aquesta setmana: 14 fetes · 3 encara a Fent des de fa més de 3 dies." That "more than three
     days in Doing" flag is straight from the Personal Kanban pattern and costs one query.
5. **Do not auto-clear Fet daily.** Instead, make the *daily* signal a count ("Avui: 5 fetes") and
   the *weekly* signal the review. This matches the documented Personal Kanban cadence and avoids
   the "where did my work go" reaction.
6. **Stale-card flagging:** any card in *Fent* for > 3 days gets a subtle marker. This is the one
   piece of automated nagging worth having, because it is diagnostic rather than judgemental.
7. **Bind one-key dispositions on a focused card** (Sunsama precedent): `d` = demà,
   `s` = la setmana que ve, `z` = torna a l'Inbox, `c` = completa, `e` = edita.
8. **Per-user Inbox by default**, with collective scopes able to opt into a shared inbox.
   The top-bar scope chips already give you the filter mechanism.

---

# PART 7 — CONSOLIDATED KEYBOARD-SHORTCUT REFERENCE

Four complete tables are given above:
- **Things for Mac** — §2.7 (the most complete; note the `⌘1..⌘6` list navigation and the
  `^[ ^] ^⇧[ ^⇧]` date-nudging cluster)
- **Todoist** — §1.9 (note `Q` quick add, `/` search, `U` undo)
- **Kanboard** — §5.2 (note `v`+letter view chords and `?` for help)
- **Sunsama** — §3.2 (note the `~ # ! >` in-modal enrichment tokens and `D`/`Z` dispositions)
- **TickTick** — §3.7 (partial, **UNVERIFIED source**)

**Cross-app conventions that are effectively standard — adopt them:**

| Key | Meaning | Attested in |
|---|---|---|
| `?` | show keyboard shortcut list | Kanboard, Sunsama, TickTick |
| `/` | focus search | Todoist |
| `Cmd/Ctrl + K` | command palette | Akiflow, Sunsama |
| `Cmd/Ctrl + E` (or `Shift+Alt+A`) | **global/system-wide** quick capture | Akiflow, Sunsama, TickTick |
| `Esc` | close dialog / **clear parse recognition** | Kanboard, Akiflow |
| `Cmd/Ctrl + Enter` | submit form / save-and-open | Kanboard, Things, Sunsama |
| `Ctrl/⌘ + ↑ / ↓` | move item up/down | Things, Todoist |
| `1..6` with modifier | jump to view N | Things, Todoist |
| `n` or `Q` or `A` | new item | Kanboard / Todoist / Sunsama |

### → WHAT FEM-HO SHOULD DO (shortcuts)

Proposed Fem-ho map (Catalan labels, conventional keys):

| Key | Action (Catalan label) |
|---|---|
| `Q` / `Ctrl+E` (global) | Afegeix ràpid |
| `Ctrl/⌘ + K` | Paleta d'ordres / cerca-i-navega (Quick Find + Type Travel) |
| `/` | Cerca |
| `?` | Mostra les dreceres |
| `Esc` | Tanca / **descarta el reconeixement** del quick-add |
| `T` | Vista Tasques |
| `C` | Vista Calendari |
| `1` `2` `3` `4` | Enfoca columna Inbox / Per fer / Fent / Fet |
| `Ctrl/⌘ + ←/→` | Mou la targeta seleccionada de columna |
| `Ctrl/⌘ + ↑/↓` | Reordena la targeta dins la columna |
| `e` | Edita |
| `c` | Completa (→ Fet) |
| `d` | Ajorna a demà |
| `s` | Ajorna a la setmana que ve |
| `z` | Torna a l'Inbox |
| `u` | Desfés |
| `p` | Fixa / desfixa (pin) la llista |
| `Shift + A` | Arxiva els fets |

Rule: **every destructive or state-changing shortcut must be undoable with `u`**, and the undo
toast must name the action in Catalan ("S'ha mogut a Fet · Desfés").

---

# PART 8 — EMPTY STATES, ONBOARDING, FIRST RUN

## 8.1 NN/g's three guidelines (from *Designing Empty States in Complex Applications*)

1. **Communicate system status.** Distinguish "there is genuinely nothing" from "we are still
   loading". NN/g's example of a good message: *"There are no records to display for the selected
   date range"* — it names the *reason* (the date range), not just the absence.
   Anti-pattern they call out: showing "No records" while the system is still processing.
2. **Provide learning cues.** Explain what *could* populate the area and how. Their cited examples:
   DataDog's *"Star your favorites to list them here"*; Power BI explaining how content gets added.
3. **Provide direct pathways for key tasks.** *"brief yet explicit instructions or, better yet,
   link directly to the steps that need to be taken to complete tasks associated with populating
   the empty state."* Their example: Loggly offers **two** pathways — add real log sources, **or
   explore with demo data**.

Implied taxonomy: pre-configuration states, no-results states, loading states.

## 8.2 Widely-agreed empty-state rules (cross-source)

- Empty states in onboarding are *"a blank canvas with instructions to get started"* and
  **must contain a primary call-to-action button**. *"A new user shouldn't have to guess what the
  first step is, they should see it, front and center."*
- **Write the title as a positive statement.** "Start by adding data assets" beats
  "You don't have any data assets."
- Anatomy: context (why it's empty) + guidance (what to do) + visual.
- Distinguish **first-use** empty states from **user-cleared** empty states — the latter is a
  *success*, and should read as one.

## 8.3 First-run patterns worth copying from the apps

- **Things** ships a *"Getting Productive with Things"* guide whose whole structure is one-sentence
  definitions of each list (quoted in §2.2). Every one of those sentences is short enough to be an
  empty-state subtitle. That is not an accident.
- **Things' "hibernation"** (projects hidden until their start date) is an anti-clutter first-run
  behaviour: a new user's sidebar stays short.
- **Loggly's dual pathway** (real data *or* demo data) generalises to: *"Comença de zero"* vs
  *"Carrega un exemple"*.
- **Amazing Marvin's `_planDay` escape hatch** — a documented way to restore a dismissed onboarding
  affordance. Every dismissible onboarding element needs a documented way back.
- **Sunsama's ritual is itself the onboarding** — the daily planning flow teaches the product every
  morning, so there is no separate tutorial.

### → WHAT FEM-HO SHOULD DO (empty states / onboarding)

1. **Write one empty state per column, positive-framed, with a CTA.** Suggested Catalan copy:
   - **Inbox (first use):** "Aquí hi arriba tot el que capturés." · CTA "Afegeix la primera tasca"
     · secondary "Com funciona l'Inbox?"
   - **Inbox (cleared — a success state, different art):** "Inbox a zero. 🎉 Tot triat."
     Do **not** reuse the first-use art. Precedent: the first-use/user-cleared distinction.
   - **Per fer:** "Encara no has triat res per fer. Arrossega tasques des de l'Inbox."
   - **Fent:** "Res en marxa. Comença per una sola cosa." (This doubles as WIP-limit pedagogy.)
   - **Fet:** "Encara res fet avui. Ja arribarà."
   - **Calendar with empty Inbox column:** "No tens tasques sense data." (states the *reason*,
     per NN/g guideline 1)
   - **Filtered to zero results:** "Cap tasca a #Família amb aquests filtres." + "Esborra els
     filtres" link. Name the filter — never a bare "No results".
2. **Two first-run pathways** (Loggly precedent): "Comença de zero" and "Crea els àmbits d'exemple"
   which seeds Personal / Feina / Família each with 2–3 illustrative tasks, one project, and one
   pinned checklist — plus a single obvious "Esborra els exemples" action.
3. **Onboarding = seeding scopes, not a slideshow.** The first screen after account creation should
   be "Quins àmbits vols?" with Personal / Feina / Família pre-checked and a free-text row.
   That single question teaches the app's central concept by making the user perform it.
4. **Teach quick-add syntax at the point of use, not up front.** Show a one-line hint under the
   quick-add field that rotates: "Prova: Comprar pa #Família demà", "Prova: @marta revisa
   l'informe #Feina/Q3 p1". Dismissible, restorable from Settings (Marvin `_planDay` precedent).
5. **Never show a loading skeleton that reads as empty** (NN/g guideline 1) — the offline-first
   Android client will have real latency on first sync; the first-sync screen must say
   "Sincronitzant amb el servidor…" with progress, not "Cap tasca".
6. **The login screen's server-URL field needs its own empty-state guidance.** This is Fem-ho's
   riskiest first-run moment. Show a placeholder (`https://femho.casa.meva`), inline validation,
   a "Prova la connexió" button that reports a specific error (DNS / TLS / 404 / wrong version),
   and a link to the self-hosting docs. Precedent: DAVx⁵/Tasks.org server-setup flows, which the
   self-hosted ecosystem has converged on.

---

# PART 9 — EXPLICIT UX DECISIONS FEM-HO SHOULD MAKE (each with a named precedent)

| # | Decision | Precedent |
|---|---|---|
| 1 | Quick-add parses optimistically and renders each recognised token as a **tappable pill that demotes back to plain text**; `Esc` clears all recognition. | Todoist ("click the word to turn it into plain text"); Akiflow (`ESC` = clear recognition) |
| 2 | A bare title is always a valid capture; **no field is ever required**; no `#scope` → Inbox. | Todoist Inbox methodology; Things Inbox; GTD Capture ≠ Clarify |
| 3 | `#Àmbit` / `#Àmbit/Projecte` for routing; also accept the spaced form `#Àmbit /Projecte`. | Todoist `#Work /Admin` |
| 4 | `@persona` = assignee (deliberate divergence from Todoist's `+person`). | Slack/Linear/GitHub convention; TickTick `@user` |
| 5 | Ship **due date** and **deadline** as separate fields from v1; deadline typed as `{...}`. | Todoist `{march 30}`; Things "When" vs "Deadline" |
| 6 | Deadline alone does **not** move a task into Per fer/Today; only a start/due date does. | Things: *"those with deadlines will remain in Anytime"* |
| 7 | `cada` vs `cada!` — schedule-based vs completion-based recurrence, stored as an `X-` property because RRULE can't express it. | Todoist `every` / `every!` |
| 8 | Inbox column lives on the **left**, is **non-removable**, is the **same component** in tasks and calendar views. | Todoist "No date"/"Plan sidebar"; Amie; Akiflow; Morgen; AppFlowy non-removable "No Status" group |
| 9 | Drag Inbox→calendar sets the date **and** promotes the task to *Per fer*; drag calendar→Inbox unschedules. | Todoist calendar layout drag; Sunsama timeboxing |
| 10 | Drag the bottom edge of a scheduled block to set duration. | Morgen |
| 11 | Collapse 00:00–07:00 and 22:00–24:00 in day/week views by default, click to expand. | TickTick calendar timeline |
| 12 | Unavailable/blocked time rendered as **diagonal grey shading**, not hidden. | Motion |
| 13 | A column is a **predicate**; dropping a card writes the predicate onto the task. | Super Productivity Board View |
| 14 | Fixed four columns, not user-configurable. | Super Productivity Kanban preset; Things' fixed lists |
| 15 | WIP limit on **Fent only**, modelled as `{ value, enabled, soft }`, signalled by turning the whole column background red. | Wekan `wipLimit{value,enabled,soft}`; Kanboard red column background |
| 16 | No swimlanes. Scope chips are the horizontal axis. | Nextcloud Deck has shipped for years without them (#32, #5539) |
| 17 | Checklists ("llistes simples") have **only** title/checked/position — no dates, no assignees, no nesting. Promote-to-subtask is an explicit action. | Things 3 checklists |
| 18 | Pasting a bulleted list into a checklist converts it to items. | Things ("paste in a bulleted list … Things will convert it") |
| 19 | The `+` button is **draggable**: drop target determines what gets created and where. | Things Magic Plus |
| 20 | One search box that both filters and **navigates** (type a scope name + Enter → go there). | Things Quick Find + Type Travel |
| 21 | Date picker does **prefix completion** on natural language (`dem` → `demà`). | Things Jump Start |
| 22 | Carry-over at local midnight; automatic by default, prompt-mode as a setting; top/bottom placement configurable. | Sunsama task rollover |
| 23 | Recurring-instance de-duplication on rollover, with an explicit "was it edited?" test. | Sunsama (*"will be removed to prevent duplicates"*) |
| 24 | *Fet* compresses older completions under dividers; auto-archive is opt-in with a threshold; **never** silent daily clearing. | Sunsama auto-archive (`Shift A`); Things' manual `⇧⌘Y` Logbook sweep |
| 25 | Weekly review card in *Fet*, including a "in Fent > 3 days" flag. | Personal Kanban DONE-column daily/weekly review pattern |
| 26 | Recently-changed cards get an intensified shadow (multi-user awareness). | Kanboard "tasks indicating recent changes display with a shadow" |
| 27 | Haptic feedback on Android when a card lands in a new column. | jtx Board (`VIBRATE` permission, declared for exactly this) |
| 28 | Subtasks via `RELATED-TO;RELTYPE=PARENT`, two-pass resolution on ingest, dangling pointers retained. | tasks/tasks#3023 failure; dmfs/opentasks#341 failure; Nextcloud Tasks success |
| 29 | Fem-ho-specific state goes in `X-FEMHO-*` properties, **never** in `DESCRIPTION`. | OpenTasks' `DESCRIPTION` anti-pattern |
| 30 | Foreign `NEEDS-ACTION` VTODOs with no `X-FEMHO-COLUMN` land in **Inbox**. | AppFlowy's non-removable "No Status" group; GTD capture |
| 31 | Always write `STATUS` + `COMPLETED` + `PERCENT-COMPLETE` as a tuple. | Nextcloud Tasks #2335 (percent lost on status change) |
| 32 | Single-call move endpoint carrying column + position together. | Nextcloud Deck `PUT …/reorder {order, stackId}` |
| 33 | Fractional/LexoRank string positions, not integers. | Required by offline-first merge; Deck's integer `order` is the counter-example |
| 34 | Ship an **OpenAPI 3.1** spec from v1 and state a deprecation policy; generate/validate the MCP server against it. | Vikunja 2.4.0 API v2 + OpenAPI 3.1, with v1 removal scheduled for 4.0 |
| 35 | Accept **name or id** for every reference in the REST/MCP surface. | Things URL scheme (`list` / `list-id`) |
| 36 | Support batch create from a newline-separated title list. | Things URL scheme `titles` param |
| 37 | Expose a `confirm_with_user` flag so an AI caller can compose a task and hand the commit to the human. | Things `show-quick-entry` |
| 38 | AI-proposed schedule blocks render in a distinct **proposed** state with per-block accept/reject; never silently committed. | Morgen AI Planner (*suggestions pulsate*; *"will never make changes … without your approval"*) |
| 39 | Clipboard-aware capture on web; `ACTION_SEND` / `ACTION_PROCESS_TEXT` share-target on Android. | Akiflow Capture (copy → command bar → Enter → `O` to return) |
| 40 | Android: swipe-right = schedule, swipe-left = select, checkbox = complete. | Things gestures |
| 41 | `?` shows shortcuts; `Cmd/Ctrl+K` is the palette; `Esc` clears parse; `u` undoes everything. | Kanboard/Sunsama/TickTick (`?`), Akiflow/Sunsama (`⌘K`), Todoist (`U`) |
| 42 | Compact mode + collapsed cards on narrow viewports; Android degrades to one column + segmented control, never a 4-wide horizontal scroll. | Kanboard compact mode (`c`) and collapsed cards |
| 43 | View preferences stored on the **user profile**, not localStorage. | Wekan (profile-stored view, localStorage only for anonymous) |
| 44 | Empty states are positive-framed, name the *reason* for emptiness, and carry a primary CTA; first-use and user-cleared states use different copy and art. | NN/g three guidelines; Loggly dual pathway |
| 45 | First run asks "which scopes?" instead of showing a tour; offers "start empty" or "seed examples". | Loggly (real data vs demo data); Things' guide structure |
| 46 | Every dismissible onboarding element has a documented way to bring it back. | Amazing Marvin `_planDay` |
| 47 | Duration estimates with sane defaults (~20 min task) and a neutral daily capacity readout — no emoji shaming. | Amazing Marvin (20 min / 45 min defaults, capacity emoji — copy the numbers, not the emoji) |
| 48 | One filter expression drives **both** the tasks view and the calendar view identically. | Kanboard: *"each view shows the result of the filter box at the top"* |
| 49 | Optional, dismissible "planificació del dia" card — never a blocking modal. | Sunsama ritual (adopted), Motion auto-schedule (rejected) |
| 50 | Frontend drag library: `@dnd-kit`, with a full keyboard path; do **not** start on `react-beautiful-dnd`. | Focalboard uses rbd; rbd is unmaintained by its authors' own statement |

---

# SOURCES

All of the following were fetched or returned as search results during this research.

**Todoist**
- https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz
- https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO
- https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV
- https://www.todoist.com/help/articles/introduction-to-filters-V98wIH
- https://www.todoist.com/help/articles/todoist-glossary-cA60laWMH
- https://www.todoist.com/help/articles/introduction-to-karma-OgWkWy
- https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o
- https://www.todoist.com/help/articles/plan-your-week-with-the-upcoming-view-OKOg1mR8
- https://usethekeyboard.com/todoist/ (shortcut compilation)
- https://www.doist.dev/filter-assist/ (Filter Assist, LLM query generation)
- https://alternativeto.net/news/2024/1/todoist-launches-year-of-the-calendar-update-with-native-calendar-view-for-projects

**Things 3 (Cultured Code)**
- https://culturedcode.com/things/guide/
- https://culturedcode.com/things/support/articles/4001304/ (Today / Upcoming / Anytime / Someday)
- https://culturedcode.com/things/support/articles/2785159/ (Mac keyboard shortcuts)
- https://culturedcode.com/things/support/articles/2803582/ (gestures)
- https://culturedcode.com/things/support/articles/2803573/ (URL scheme)
- https://culturedcode.com/things/support/articles/2249437/ (Quick Entry / Autofill)
- https://culturedcode.com/things/features/

**Calendar-fusion apps**
- https://help.sunsama.com/docs/daily-planning
- https://help.sunsama.com/docs/task-rollover-and-recurring-tasks-the-basics
- https://help.sunsama.com/docs/keyboard-shortcuts
- https://help.sunsama.com/docs/command-palette
- https://product.akiflow.com/en/help/articles/6483573-command-bar
- https://akiflow.com/features/shortcuts
- https://www.morgen.so/faq
- https://www.morgen.so/blog-posts/drag-and-drop-calendar
- https://www.usemotion.com/help/time-management/auto-scheduling
- https://help.amazingmarvin.com/en/articles/5066364-day-planning
- https://help.amazingmarvin.com/en/articles/1950243-time-block-sections
- https://amazingmarvin.com/features/all/
- https://help.ticktick.com/articles/7055782085826445312 (calendar view options; JS-rendered)
- https://help.ticktick.com/articles/7081924556310446080 (smart recognition; JS-rendered)
- https://help.ticktick.com/articles/7055780449171275776 (desktop shortcuts; JS-rendered)
- https://quickref.me/ticktick.html (shortcut compilation)
- https://curtismchale.ca/2020/08/10/ticktick-quick-add-syntax/
- https://screensdesign.com/showcase/amie-todos-calendar
- https://techcrunch.com/2022/11/28/amie-grabbed-7-million-for-its-opinionated-calendar-and-todo-app/

**Open-source CalDAV task apps**
- https://github.com/nextcloud/tasks
- https://github.com/nextcloud/tasks/issues/2335 (percent-complete/priority lost on status change)
- https://github.com/nextcloud/tasks/issues/243 (missing CLASS support)
- https://github.com/nextcloud/deck
- https://github.com/nextcloud/deck/blob/main/docs/API.md
- https://github.com/nextcloud/deck/issues/32 and /5539 (swimlanes)
- https://tasks.org/docs/caldav_intro.html
- https://tasks.org/docs/sync.html
- https://github.com/tasks/tasks/issues/3023 (subtask hierarchy broken on CalDAV import)
- https://github.com/tasks/tasks/issues/932
- https://f-droid.org/packages/org.tasks/
- https://github.com/dmfs/opentasks/issues/341 (RELATED-TO vs private subtask model)
- https://github.com/TechbeeAT/jtxBoard/blob/develop/README.md
- https://jtx.techbee.at/sync-with-davx5
- https://manual.davx5.com/tasks_notes.html
- https://github.com/bitfireAT/davx5-ose/discussions/968
- https://vikunja.io/docs/api-documentation/
- https://vikunja.io/features/

**Open-source kanban**
- https://deepwiki.com/wekan/wekan/2.1-boards-lists-and-swimlanes
- https://github.com/wekan/wekan/wiki/Swimlanes
- https://github.com/wekan/wekan/issues/2380 (per-swimlane WIP limits)
- https://docs.kanboard.org/v1/user/keyboard-shortcuts/
- https://docs.kanboard.org/v1/user/boards/
- https://github.com/kanboard/kanboard/issues/861 (task limits across swimlanes)
- https://github.com/plankanban/planka
- https://github.com/AppFlowy-IO/appflowy-board
- https://docs.appflowy.io/docs/documentation/software-contributions/architecture/frontend/database-view/kanban-board
- https://github.com/super-productivity/super-productivity/blob/master/docs/wiki/4.05-Board-View.md
- https://super-productivity.com/blog/gtd-inbox-capture-system/
- https://blog.logrocket.com/build-kanban-board-dnd-kit-react/

**GTD / Personal Kanban / empty states**
- https://www.personalkanban.com/pk/designpatterns/done-column-daily-weekly-review (403 to fetcher)
- https://personalkanban.com/pk/ariely-done-column-motivation-progress/
- https://www.nngroup.com/articles/empty-state-interface-design/
- https://carbondesignsystem.com/patterns/empty-states-pattern/
- https://mobbin.com/glossary/empty-state
- https://www.useronboard.com/onboarding-ux-patterns/empty-states/

---

# UNVERIFIED — do not treat as fact without re-checking

1. **Todoist per-action Karma point values.** Levels and thresholds are published; the points
   awarded per action are not. Do not invent numbers.
2. **Todoist sub-task nesting depth limit.** Not stated in official help.
3. **TickTick quick-add sigils** (`^list`, `#tag`, `*duedate`, `!priority`, `@user`) come from a
   third-party write-up. TickTick's help pages are JS-rendered and returned empty to my fetcher.
4. **TickTick desktop shortcut table** — from a community cheat sheet, not official docs; the
   `Ctrl+0..3` overload across two contexts looks like a transcription artefact.
5. **Personal Kanban "DONE column daily/weekly review" full text** — the canonical page returned
   HTTP 403. The pattern name, the "not a graveyard" framing, the weekly cadence and the
   "challenge cards in Doing > 3 days" heuristic are attested through indexed summaries of that
   site, not read directly.
6. **Nextcloud Tasks frontend stack versions** (Vue major, `cdav-library`, `ical.js`) and the exact
   set of smart-collection names — read `package.json` and the source before depending on them.
7. **jtx Board's exact per-field VTODO support** (attachments, comments, recurrence, RELATED-TO) —
   implied by its RFC 5545 compliance claim, not enumerated in the README.
8. **Vikunja "done bucket" field names and bucket-limit field names** — the docs URL I tried 404'd;
   read the OpenAPI 3.1 spec on a live instance.
9. **Planka's drag-and-drop library** — not stated on the repo landing page.
10. **Morgen CalDAV VTODO task support** — not listed among its task integrations in the FAQ;
    likely absent, but I did not find a negative statement.
11. **Current version numbers for `@dnd-kit`, `sortablejs`, and any other library named here.**
    I did not read a registry page. Check at implementation time.
12. **Whether arbitrary CalDAV servers preserve unknown `X-FEMHO-*` properties on round-trip.**
    This is a *requirement* of the design in §4.7, not a verified fact. Write an integration test
    per target server (Radicale, Baïkal, sabre/dav, Xandikos, Nextcloud) before committing.
13. **Amazing Marvin's "Master List" / "Kanban" / "Time Blocking" as officially-named features** —
    "Master List" and "Time Block Sections" appear in help articles, but the consolidated feature
    page does not list "Time Blocking", "Master List" or "Kanban" as distinct named features.
14. **Whether swipe-right-to-schedule beats swipe-right-to-complete for Fem-ho's users.** This is my
    recommendation based on the Things precedent, not a researched user-preference finding.
