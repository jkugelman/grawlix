# Design

The shape of Grawlix's UI and the architectural choices behind it. The *what* (user-visible behavior) lives in [`manual.md`](manual.md); this doc covers the *why* — what alternatives were rejected, what constraints shape things — plus architectural surfaces a contributor needs to orient.

This is the singular home for distilled design content. As plans ship, the `distill-design-doc` skill folds them into this file (and `manual.md` for user-facing surface).

## Workspace and sidekick

Constructors use Grawlix on desktop in two modes that share one UI:

- **Workspace** — typical during theme generation. The user lives in Grawlix: plays with tools, searches and filters the wordlist, grooms My Edits. Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire, Ingrid, Crossword Compiler, Crosserville). The user pops over to look something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary. The workspace-leaning design accommodates sidekick mode for free as long as load is fast and chrome isn't loud — sidekick is just "brief use, leave."

Lookup features (definitions, NYT crossword history, semantic search; see [`plans/lookup.md`](plans/lookup.md)) are differentially valuable to constructors using grid software without built-in lookup. Crossfire and Crossword Compiler are the populations that benefit most; Ingrid has Google integration and Crosserville has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord) — and gets its own design; see [`plans/mobile.md`](plans/mobile.md).

## The shell

**Header** is brand chrome only. No per-wordlist navigation, sync state, or wordlist picker; the rail handles those.

**Left rail** has two *labelled* sections — **Wordlist** at the top (the picker + sync indicator, the two doors into setup) and **Tools** below (owned by [`plans/tools.md`](plans/tools.md)). Labels because the two sections answer unrelated questions ("what am I looking at" vs. "what can I do with it"); a divider alone would suggest they're variants of the same thing. Not collapsible.

**Wordlist dropdown** is a *pure picker*. Each entry is icon + name only — no entry counts. No drag handles, enable toggles, or add-wordlist affordance; those live one click deeper in the Wordlists dialog. The dialog is opened by the icon-only **wordlist settings** button to the right of the dropdown — pulled out of the dropdown's footer so the manage entry point is always visible without expanding the picker.

**Sync indicator** is hidden until there's a backup to report. Today that's always — Sync & backup is a stub (see [`plans/sync.md`](plans/sync.md) for the design that will eventually populate it).

**Stats bar always renders, even for empty wordlists** — zero entries, dashes for min/max/etc., flat histogram baseline. Uniformity over an "empty placeholder" treatment.

**Score ranges come from data, never from code.** Wordlist scoring conventions vary widely — 0–100, 0–60, 1–10, 200–2000, even negative numbers. Anything that depends on a min or max — histogram bins, score colors, filter ranges — derives them from the rescored entries actually present in the merged set. This applies to the empty-data path too: when nothing has loaded, the range is *unknown*, not a hardcoded default. Stamping in `0–100` or `0–60` as a fallback is a recurring source of the same bug — it works in testing and quietly misrepresents anyone whose scores sit elsewhere.

**Table is always visible**, even at idle with no search active. The idle and search views are *the same view, just filtered*; live keystroke-to-result feedback depends on continuity. Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat). Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Default landing on `All`.** Including first run. The four publisher wordlists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about wordlist management.

Between the scoring legend and the search bar sits the **tool stack** when populated — see *Tool gallery & stack* below. The stack is hidden when empty so pre-tool-use Grawlix looks unchanged.

## Wordlists & setup

Two dialogs cover all setup. They answer different questions and stay distinct:

- **Wordlists** — what wordlists do I have, in what order, with what rules.
- **Sync & backup** — how is my data being preserved across time and devices.

### Wordlists

Two-pane layout (rail + action row + stats + rule editor).

The right pane has no name/icon header — the focused wordlist is identified by the highlighted card in the rail. Action buttons always justify right; the date label sits next to the primary action.

Every wordlist has a rule editor for parity:
- Regular wordlists get **rescoring** rules (their dialect → unified scale).
- My Edits gets **scoring** rules (the user's tier labels for the unified scale).

The action row is also unified — date slot, primary action, Download, more menu. Only the contents differ per wordlist type.

**Renaming** happens on the rail card via F2 with the card focused. Configure wordlist (in a wordlist's ⋮ menu) is the secondary path. No Rename in the kebab menu — the F2 affordance is enough.

**Rescoring lives entirely inside the Wordlists dialog**; it doesn't appear on the main screen. Rules are detail config, typically set once when adding a wordlist and rarely revisited; they don't earn persistent real estate next to the wordlist view.

**Scoring rules** (My Edits' tier labels) are the user's single notion of what each score range means — there is no separate "output" tier system. Every wordlist view shows them as a read-only legend above its table — score-badges paired with tier labels — so users always have the meaning of a score in front of them. Editing happens only in the Wordlists dialog (My Edits' right pane), keeping the main view a steady reference rather than a config surface.

**Onboarding banner** lives only inside the Wordlists dialog — there's no auto-popup on the main view. Users who never open the dialog never see it; the defaults are sensible enough that this is fine.

The banner is a 3-page sequence (welcome, personal-wordlist import into My Edits, XWI subscriber import) that exists to *surface features users might not know are there*, not to provide parallel import paths — pages 2 and 3 route through the same `ingestFile` plumbing as the canonical import flows. Page 3 is gated on the XWI wordlist still being present and unpopulated, so it drops out when irrelevant rather than asking a question that has no answer.

### Sync & backup

Today this is a stub. Full design lives in [`plans/sync.md`](plans/sync.md): prominent "Download All" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

### Two paths to "give me a file"

- **All** or **My Edits** → Sync & backup dialog (it's a backup, not just a save — clicking the download will bump the "Last backup" timestamp once Tier 1 lands).
- **Any individual wordlist** → Wordlists dialog → that wordlist's Download button (it's an export of one rescored wordlist). Rare; doesn't warrant header chrome.

## Tool gallery & stack

Tools live in two places: a persistent gallery in the left rail's **Tools** section, and a **tool stack** in the main pane between the scoring legend and the search bar. The gallery is browseable; the stack is the user's current pipeline. Today the chrome is shipped — gallery cards click and chain, the stack renders rows with parameter inputs, hover previews and animations work — but tools don't yet transform anything. The full tool list and chaining policies are still planned in [`plans/tools.md`](plans/tools.md). The word-list display where tool output will eventually render shipped already (see § Word list).

**Single catalog drives every surface.** Each tool is one record in `TOOLS` (`name`, `icon`, `category`, `desc`, `example`, `params`, `output`); section ordering for the gallery comes from a parallel `TOOL_CATEGORIES` list. Gallery cards, stack-row labels, and the search bar's `Search` label all render the inline icon-and-name pair through the shared `buildToolLabelHTML` helper. Adding a tool means adding one entry — every surface that names tools picks it up — and the helper guarantees the icon-and-name pair looks identical wherever it appears.

**Two click targets per gallery card.** The card body replaces the stack with that tool — the 98%-case gesture. The `+` badge on the right edge appends the tool to the end of the stack — the 2%-case "chain" gesture. The `+` is hover-revealed (no visual presence at rest) and hidden entirely when the stack is empty: chain has no referent without existing tools, so the unfamiliar affordance shouldn't appear before there's something to chain to.

**Stack hidden when empty.** No user-added tools = no `#tool-stack` element in the DOM. The functional search bar below sits in its usual position. The stack appears only when the user adds the first tool.

**Search bar styled as the bottom row of the stack.** Same row layout (icon + bold name + params), same background, abuts the stack with no gap. An earlier mockup had a chrome "permanent Search" row inside the stack itself; that produced two visible search inputs (one chrome, one functional). Dropping the chrome row and restyling the functional bar to match the stack gives a single search input with visual continuity. The whole-word toggle, score-range filter, and the word-list sort control all live in the same row — filter on the left, view-config (sort) on the right; see § Word list for the sort cluster's shape.

**Hover previews show what the click will do — but only when the click is visually surprising.** The rules:

- *Chain hover (`+` button)*: a ghost row appended at the end of the stack. Always shown; the `+` is unfamiliar and the ghost teaches what it does.
- *Replace hover (card body), 2+ tools in stack*: doomed rows collapse to zero height; ghost slides in. Communicates "this click will destroy multiple rows."
- *Replace hover, 0 or 1 tools in stack*: no preview. The click is simple enough to leave bare; previewing would add clutter.

Ghost rows carry an accent tint and a subtle shimmer (sweeping accent gradient via an `::after` pseudo-element). `prefers-reduced-motion` disables the shimmer.

**One animation primitive: `animateHeight(mutate)`.** Capture the stack's current rendered height, run the mutation, measure the new natural height, transition between them via an explicit `height` style. Per-row `max-height` transitions were tried first and produced jiggle when multiple rows animated in opposite directions (one collapsing, one growing); container-level animation is one coherent move regardless of how many rows changed underneath.

**Doomed rows collapse rather than fade in place.** An earlier version held doomed rows at full height (opacity 0) with the ghost as an absolute-positioned overlay — no height changes during preview, no jiggle, but the fixed-height stack with the ghost floating in it left an empty gap that looked bad. Collapsing doomed rows lets the table move up smoothly into the freed space; `animateHeight` ensures the move is one continuous direction.

**Ghost-promote in place on commit.** When a click commits a hovered ghost, the *same* DOM element loses its `.ghost` class and gains real-row content (via `innerHTML` swap of the inner body). CSS transitions on opacity/color/background handle the visual shift naturally. Replacing the node with a fresh element would lose the in-progress transition state and produce a flash. A 24×24 placeholder div in the ghost's right slot matches the X button's footprint so the row's height is identical between ghost and real states.

**`+`-button camouflage gotcha.** The global `button:hover:not(:disabled)` rule (specificity 0,2,1) overrides naive `.gallery-card-add:hover` (0,2,0), giving the add button the card's hovered background and making it visually invisible against the card. The hover rule is scoped as `.gallery-card .gallery-card-add:hover` (specificity 0,3,0) to win on specificity without `!important`.

## Word list

The at-rest results display below the search bar. Renders the active wordlist (or merged `All` view) as one row per entry — same view whether idle or filtered. Replaces the earlier spreadsheet-style table (sticky resizable headers, per-cell inline edit, hover info popover); the list reads at lower density and routes editing through one explicit gesture.

**Single column of word atoms, no table.** Each row carries the same shape: a numbered position, the word, its length, and a score badge. Pseudo-column alignment via CSS Grid puts each piece in a fixed sub-slot so the eye reads down them as if they were columns. No header row, no resizable columns, no per-row chrome at rest. The list is calm content; controls live in the search bar above.

This is the pattern modern productivity apps (Linear, Notion, Things, virtually every mobile app) have settled on. Two real losses vs. a table, judged worth it:
- **2D reading.** A table lets you sort by one axis and visually scan another (sort by Min, eyeball Max). The list can't — switching axes is a sort-control click. In practice users sort by their primary axis and scroll; switching is rare.
- **Click-to-sort headers.** A spreadsheet convention; widely learned but not universal. The separate sort control is fast to learn.

What's gained: visual calm at rest, narrow widths come nearly for free (lists scale; tables don't), bigger friendlier fonts become natural, and the at-rest UI stays one column wide. Nothing is in the chrome just to tabulate.

**Word atom: `1. CARE 4 50`** — count, word, length, score-badge. Length is to the right of word ([Wordlisted](https://aaronson.org/wordlisted/)'s layout), freeing the leftmost column for the count. The count makes scanning a long list legible and lets a user keep their place when slowly reading through. Count and length use the sans-serif font; word and score-badge use monospace so columns of letters and digits visually align.

**Pseudo-column alignment, fixed widths from data.** Each row is its own grid container with `grid-template-columns: var(--count-w) var(--word-w) var(--len-w) var(--score-w)`. The four CSS variables are computed once per filter/sort pass from the entire result set: count digits, max word length (capped at 20 chars; longer words truncate with ellipsis + tooltip), max length-number digits, max score digits. They stay fixed across scroll. Picking widths from the visible rows would jitter under virtual scrolling; one outlier row would also blow out the layout for everyone else. Each row is independently grid-laid-out (because rows are absolute-positioned for virtual scrolling), so the variables must be uniform — `max-content` tracks would size per-row and break cross-row alignment.

**Score badges right-aligned within their column.** `justify-self: end` on the score atom pushes each badge to the right edge of the (uniform) score track; numbers' right digits line up across rows. The score column width is `calc(maxScoreDigits ch + 12px)` — the 12px covers the badge's 5px-each-side padding plus a small safety margin.

**No hover state, no row separators.** The pseudo-column alignment carries the row structure on its own — borders would be redundant noise at 24px row height. Hover highlight was rejected because the entire row reads as one unit (you don't aim for a sub-element) and at high row density the highlight flashes as the eye drags down. The popover-active row gets an accent tint (`color-mix(in srgb, var(--accent) 12%, transparent)`) so the user can tell which row the popover belongs to; that's the only background state.

**Click targets are the word and score atoms only.** `cursor: pointer` and the click handler both gate on `.atom-word` or `.atom-score`. The count and length are read-only display; the row as a whole is not interactive. Cursor on the whole row would imply otherwise.

**Search highlight** marks pattern matches in the word slot via `<mark>` spans, colored per capture group. Ellipsis truncation respects the markup.

**Sort control inside the search bar.** "Sort by [Word ▾] [↑]" sits at the right edge of the search bar, after the score-range filter. An earlier draft had a dedicated thin toolbar above the list; that was replaced because the search bar's right-hand space was empty (the search input was flex-stretching to fill it) and consolidating saved a row of vertical space without crowding. Filter (search/whole-word/score) on the left, view-config (sort) on the right; same row.

The sort axis is a native `<select>` with `appearance: none` and a chevron painted via background-image — quiet inline text rather than bordered chrome. Direction is a borderless `↑`/`↓` button next to it. No persistent border or background; the controls flow inline with natural HTML whitespace between them. Sort axes for the words view: Word, Length, Score. Default Word ascending; Score defaults to descending when first selected.

**Click an atom → AtomPopover.** A click-driven popover anchored to the clicked atom (word or score). Content: a header line repeating the atom for context, a source block (which wordlist sourced the score, with rescore/override info or "Ignored by rescore rules"), score and comment text inputs, a "Saves to My Edits" footer, and a Delete button when the row is sourced from My Edits. Edits commit via Enter (commit + close) or blur (commit, popover stays open so you can tab to the next field); Escape reverts and closes. Click-outside, scroll, resize, search/filter/sort changes, and panel re-mount all close it.

The popover replaces both the previous in-cell `<input>` swap (score/comment edits) and the hover-only info tooltip (which explained rescoring and overrides). Comments and source moved off the at-rest list — comments are write-mostly in practice, and source matters only for investigation. Both are one click away in the popover when wanted.

**Re-render across edits keeps the popover open.** Edits flow through `_onCellEdit`, which routes to `upsertEdits` (non-Edits views) or directly mutates `rawEntries` (My Edits view), then triggers `_applyFilterAndSort(false)`. The scroller re-renders rows but doesn't close the popover, so chained edits (score → tab → comment) work. After re-render, the row matching the popover's active word gets `.active` reapplied via `AtomPopover.rebindRow`.

**Virtual scrolling.** Rows are absolute-positioned inside a height-sized `.word-list-rows` container; the scroller materializes only rows in the current viewport ± a buffer. Each row's `top` is `i * ROW_HEIGHT`. Cleaner than the previous `<table>` with top/bottom spacer rows.

## Help modal

Reachable from the header `?` button and the `?` keyboard shortcut. First-run users get it auto-opened. Slide content describes the pre-restructure UI and is out of date with the current shell — a redesign is planned in [`plans/help.md`](plans/help.md), to land once [`plans/tools.md`](plans/tools.md) settles.

## URL state

The query string mirrors the user's active pipeline: each tool stack row in pipeline order, then the permanent Search bar's pattern (`search=`), whole-word toggle (bare key `whole-word`), and score filter (`score=`). Pasting a Grawlix link into a chat reproduces what the sender was looking at; refreshing the page lands you back where you were.

A small `Router` IIFE owns parse, serialize, and `history.replaceState`.

### Tool stack encoding

Each user-added tool row gets one query parameter, in pipeline order:

- **With input:** `slug=value`. The slug is the tool's catalog key (lowercase: `anagram`, `subanagram`, `regex`, …). All values pass through `encodeURIComponent` — Grawlix's pattern syntax (`?`, `#`, `@`, `*`, `[`, `]`, `&`) overlaps with URL reserved characters and needs encoding.
- **Without input:** bare key, no `=` (`?palindrome`). `URLSearchParams` treats it as an empty-value entry, which round-trips.
- **Order is significant.** Parameter order is pipeline order — `?search=CAT&anagram=LINDSEY` runs Search before Anagram; the reverse runs them the other way. This breaks the convention that query strings are unordered, but the URL is mostly machine-generated and read back by Grawlix.
- **Repeated keys are fine.** Two regex rows become two `regex=` entries; their relative order is preserved.
- **Empty tool inputs are kept** (`?anagram=`) so a row the user added but hasn't filled in survives reload.
- **Empty Search drops out.** The UI invariant "always render a Search bar at the bottom" is applied after parsing — if the parsed pipeline doesn't end in a Search, the UI appends an empty one. The URL stays minimal in the 95% case (`?anagram=LINDSEY` doesn't carry a redundant trailing `&search=`).
- **Unknown tool keys are dropped** with a toast: *"That link references a tool that's no longer available."* The rest of the stack still renders.

### Stable links: don't rename, don't remove

Once URL keys are public, removing or renaming them breaks shared links. The rule:

- **Don't remove tools.** A superseded tool stays as a thin alias to its replacement, or stays indefinitely.
- **Don't rename tool keys.** If a tool's display name changes, its URL key stays.
- **If a rename or removal is unavoidable**, register the old key in an alias table that maps to the new key (or to a sensible fallback) and `replaceState` to the canonical form on load.

No aliases exist today — this is forward-looking guidance for when the catalog churns.

### Router policies

- **Real query string, no hash.** Grawlix is a single-page app; paths in the URL would suggest sections that don't exist. GitHub Pages serves `index.html` regardless of query string, so any URL deep-loads without server-side routing.
- **`replaceState` only.** Stack edits never push a history entry; the back button leaves Grawlix instead of navigating within. The visible UI is the user's history — clearing the search or popping a tool row is the explicit undo. A back button would be redundant or actively confusing ("did I lose my whole stack?").
- **URL wins over localStorage.** The score filter loads from localStorage and the URL overlays it on init. Search pattern, whole-word, and tool stack have no localStorage backing — they live entirely in the URL during a session.
- **Debounced ~250ms** for typing callers (search input, score input, tool-row inputs). Structural toggles (whole-word, add/remove tool, clear) replace instantly. The URL bar doesn't flicker per keystroke.

### Out of scope for the URL

These are local-only:

- **Dialogs** (Welcome, help, settings, Wordlists, Sync & backup) — transient UI state. Open them how you opened them; close them when you're done.
- **Selected wordlist** from the rail dropdown. Sharing a link to "anagram of LINDSEY in STWL" implies the recipient has STWL loaded; we don't pretend otherwise. The recipient sees their own selection (default `All`).
- Scroll position, edit-in-progress state, transient popovers.

### Open questions

- **Multi-input encoding.** Tools with multiple inputs (regex with min-length, anagram with bank letters) need a value-internal delimiter or named subkeys. Deferred to the first such tool — encoding choice will land alongside it.
- **Whole-word per Search row.** Today `whole-word` is a bare top-level key, fine for the single permanent Search row. If the stack ever holds two Search rows, it doesn't compose — the eventual fix is the multi-input encoding above (likely `search=CAT:w`). Revisit when chaining a Search above a transform becomes possible.
- **Chained Search row.** The URL schema allows `?search=CAT&anagram=LINDSEY` (Search before Anagram), but the UI only has the permanent Search bar at the bottom. Today's parser collapses any `search=` into the permanent bar; chained Search becomes meaningful only when the UI gains a way to add a Search row earlier in the stack.

## Caches

Wordlists can be hundreds of thousands of entries. Several caches keep wordlist switching, score editing, and merging snappy. They live either on the wordlist object (`wordlist._foo`) or as module-level variables, and they all derive their values from `state.sources` plus per-wordlist `rawEntries` and `rescoreRules`.

| Cache | Scope | Derived from | Cleared by |
|---|---|---|---|
| `wordlist._rescored` | per-wordlist | own `rawEntries` + `rescoreRules` | `invalidateRescoredCache(wordlist)` |
| `wordlist._rescoredMap` | per-wordlist | `_rescored` (UPPERCASE word → entry, for fast lookup) | `invalidateRescoredCache(wordlist)` |
| `wordlist._overrideMap` | per-wordlist | every higher-priority enabled wordlist's `_rescored` | `invalidateSourceCounts()` (clears all) |
| `_mergedWordlistCache` | module | every enabled wordlist's `_rescored` (entries + `byWord` map) | `invalidateSourceCounts()` |
| `_sourceCountsCache` | module | aliases `_mergedWordlistCache.sourceCounts` | `invalidateSourceCounts()` |
| `_statsCache` (WeakMap) | module, keyed by wordlist or `_mergedStatsKey` | a wordlist's `rawEntries` (or merged entries) | `invalidateStatsCache(key)` |

Three composite helpers cover the common change patterns:

- **`invalidateWordlistCaches(wordlist)`** — when a wordlist's `rawEntries` change. Clears its `_rescored`, its stats cache, merged stats, the merged caches, and every wordlist's `_overrideMap`.
- **`invalidateSourceCounts()`** — narrower. Used when source ordering, enabled flags, names, or any `_rescored` change but `rawEntries` did not. Clears merged caches and every `_overrideMap`.
- **`refreshSourceCounts()`** — invalidate then re-warm `_sourceCountsCache` (it's read by the rail meta on every dialog refresh).

Override maps are invalidated globally rather than per-affected-list because tracking dependencies (which lists sit below the changed one) isn't worth the complexity. Lazy rebuild on next access keeps the unaffected views free; only what's actually rendered pays the cost. The `_mergedWordlistCache` follows the same pattern.

**Read live, don't snapshot.** Cache entries hold a `wordlist` reference rather than copying out display fields like `name`. Render-time code reads `entry.wordlist.name` so renames propagate without cache invalidation. The virtual scroller follows the same convention — `currentWordlist` is a ref, not a name string.

**Hot path: switching wordlists.** First switch builds `_rescored` (lazy) and `_overrideMap` (lazy); subsequent switches are near-free. The virtual scroller's `_sortScores` Map is built only on demand — clicking the Score header to sort triggers it. Switching never builds it.

**Hot path: editing My Edits.** Score and comment edits, new-word adds, and deletes all flow through `patchCachesForEditsChange(word, newEditsEntry)`. It mutates the affected `_overrideMap` entries and the matching slot in `_mergedWordlistCache.byWord` instead of triggering a full rebuild. No `buildMergedWordlist` walks across all sources per keystroke.

The patch is structured around three observations:

- If a higher-priority wordlist also has `word` (`buildOverrideMap(edits).has(word)`), edits is overshadowed and never appears in any cache — nothing to patch.
- For ADD and UPDATE, edits becomes the contributor for `word` in every override map below it; for the merged cache, an existing entry's `wordlist` reference is reassigned (with source-count adjustments) or a new entry is bisect-inserted into the sorted `entries` array.
- For DELETE, walk down from edits's position to find the next enabled wordlist with `word` (using a lazily-built `wordlist._rescoredMap`). Override maps for positions ≤ next contributor's position drop the entry; positions below adopt next's value. The merged entry is reassigned to next, or removed if no contributor remains.

`_mergedWordlistCache` keeps a `byWord` Map alongside `entries`; both share the same entry objects, so patching via `byWord` is visible in `entries`. The merged-view refresh chooses between in-place refilter and full rebuild depending on whether the patch reused the entries array. `refreshDerivedDisplays()` is the post-patch counterpart to `refreshSourceCounts()` — it repaints the rail meta and scoring legend without invalidating any caches.

### Reactivity

Structural state and the view layer are reactive (signals + effects); the perf-critical caches above stay imperative. The split mirrors what production signal frameworks (Solid, Svelte 5, Preact signals) do internally.

A pure-reactive design — one big `merged$ = computed(() => buildMerged(sources$))` — re-derives the whole 1M-entry merged wordlist on every My Edits keystroke. The hybrid model keeps reactivity for the 90% of state where it doesn't fight performance, and leaves the cache layer alone where it earns its keep. Pushing further — replacing imperative caches with observable collections and the virtual scroller with per-row reactive components — is a possible future rewrite; see [`plans/per-row-reactivity.md`](plans/per-row-reactivity.md).

**The signals primitive** is hand-rolled at ~50 lines (no external dependency, preserves "no build step, no npm"):

- The API is the standard `get`/`set`/`effect` shape, plus two additions for the in-place-mutation case: `peek` reads without subscribing (used by the `state` proxy's getters so incidental reads inside effects don't accidentally subscribe), and `bump` notifies even when the reference is unchanged (for array/map mutations like reordering `sources`).
- No automatic dependency cleanup on re-runs — effects accumulate subscriptions. Acceptable for grawlix's small, stable graph.
- No `computed` primitive. The imperative caches play that role.

**What's reactive:**

- `sources$` — the wordlist array. The cosmetic effect subscribes; reorder/add/remove call `sources$.bump()` after splicing.
- `selected$` — the selected wordlist (or `MERGED_ID`). The render effect subscribes.
- Per-wordlist cosmetic fields: `name$`, `icon$`, `url$`, `publisherId$`. Each wordlist exposes both the signal (`wl.name$`) and a peek getter / set setter on the plain field (`wl.name`). `wrapWordlist(wl)` installs them at every wordlist-creation site.
- `cacheVersion$` — the bridge between layers. Bumped by helpers that change cache-affecting state; the render effect subscribes.

`state.searchQuery`, `state.searchWholeWord`, and `state.scoreRange` are plain properties. Search is dispatched imperatively from the input handlers (which call `scroller.filter()` directly); no effect needs to react.

Per-wordlist field categories beyond the cosmetic four:

- **Cache-affecting** (`enabled`, `rescoreRules`, `rawEntries`) — plain properties. Mutate via the helper (`setWordlistEnabled`, etc.) so the helper invalidates the right caches and bumps `cacheVersion$`. Never assign directly — there's no signal to fire and the caches will silently go stale.
- **Transient** (`_loading`, `_updateAvailable`, `lastUpdated`, `fetchedSize`, `_rescored`, `_rescoredMap`, `_overrideMap`, `originalFilename`) — plain properties. Set directly. Anything that displays them updates as a side effect of the surrounding flow (e.g. `applyWordlistText` ends with the render effect dispatching panel updates because it batched a `repaintAfterCacheChange`).

**The two effects:**

- **Render effect** reads `selected$` and `cacheVersion$`. On selection change it does a full panel re-render (fresh scroller). On cache-only change for the same selection it refreshes derived state in place: `refreshSourceCounts` rebuilds caches, `renderSources` repaints the rail/dropdown/dialog with fresh meta, `refreshDerivedDisplays` updates the scoring legend and the main-panel stats bar, then the active scroller is updated (the merged scroller via `refreshMergedScroller`, which shares its array-identity protocol with the patch path; a regular wordlist's scroller via in-place rebind of `rescoreRules`/`overrideMap` plus an identity check on `rawEntries` for the fetch/import case).
- **Cosmetic effect** reads `sources$` and every wordlist's `name$`/`icon$`/`url$`/`publisherId$`. Any cosmetic change re-renders the rail/dropdown/dialog and (when the merged scroller is the active view, since it has a per-row source column) the visible scroller rows. No cache touched — cache entries hold wordlist refs and read names live.

**The patch path skips reactivity.** `patchCachesForEditsChange` doesn't bump `cacheVersion$`; the My Edits hot path mutates caches in place and calls `refreshDerivedDisplays` + scroller re-filter directly. Routing through the render effect would call `refreshSourceCounts`, which invalidates and rebuilds the merged cache — defeating the patch. This is the one explicit exception to the rule "any cache mutation bumps `cacheVersion$`".

### Mutation helpers

Every state mutation goes through a helper that bundles the right invalidation, persistence, and (where needed) `cacheVersion$` bump. Call sites read like statements of intent:

```js
setWordlistName(wl, newName);
setWordlistEnabled(wl, !wl.enabled);
setWordlistRescoreRules(wl, rules);
reorderSources(fromIdx, toIdx);
```

Helper bodies come in two shapes:

- **Cosmetic** (name, icon, url, publisher) — set the signal, persist. The cosmetic effect re-renders.
- **Cache-affecting** (enabled, rescore rules, source order) — set the field, persist, call `repaintAfterCacheChange()` which bumps `cacheVersion$`. The render effect's cache branch invalidates and rebuilds derived state.

The alternative — sprinkling `invalidateX()` and `repaintY()` calls at every mutation site — concentrates the discipline of "what does changing X require?" at every caller. The helper-plus-effects shape concentrates that discipline in one place per field, and "forget to repaint" stops being a category of bug because the effect handles dispatch as long as the right signal got bumped.

`batchUpdate(fn)` coalesces a multi-field save (the configure-wordlist dialog can change up to five fields at once, and `applyWordlistText` batches its prelude similarly) into one effect run per subscriber. Signal writes inside a batch queue their subscribers in `_batchedEffects`; any `repaintAfterCacheChange` calls inside set a deferred bump flag, and `persistMeta()` calls set a deferred persist flag. At the end of the batch persistence runs once, the cache bump fires once, and the queued effects each run once.

## Open questions

### Fold "Configure wordlist" into the Wordlists dialog

Today, a wordlist's kebab menu's "Configure wordlist" opens a separate `ConfigureWordlistDialog` for icon, name, URL, publisher, and rule application — a second drill-down on top of a configuration page. That doesn't make sense; the Wordlists dialog is already where you configure things. The right pane should expose those fields directly (or in a collapsible "advanced" block) so there's no nested dialog.

### Setup as routes

Considered and not currently chosen: making setup screens into full-page routes — `#/wordlists` and `#/sync` — instead of modal dialogs. Confirms/alerts/downloads stay as dialogs regardless; those really are transient.

Arguments in favor of routes for setup: setup screens are *places* users spend real time, URL-addressable means deep-linkable and reload-safe, mobile and desktop converge in shape since dialogs go full-screen on phone anyway. Currently sticking with dialogs because they match the existing codebase idiom and the rest of the shell.

Worth revisiting if the dialog-as-workspace feel becomes a friction point — particularly when the mobile design lands, since the modal-ness is cost without payoff on phones. Notes for that revisit: bookmark/share-setup-state is unlikely (so deep-linking isn't a strong driver, just reload-safety); back button does default browser behavior (navigates back to the wordlist); header stays a fixture with no dynamic content (no breadcrumbs). *"Routes for everything" — including confirms — was considered and dropped as too heavy-handed.*

## Non-features

Things explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL encodes. No "save my exploration" feature, no session restore.
- **No cross-wordlist comparison.** "Words in JK but not XWI" set-difference views are not a real workflow.
- **No scratchpad / working set.** My Edits is the only persistence concept.
- **No multi-pattern search.** Serial single queries are fine.
- **No recent-searches strip.** Search history is not preserved or surfaced.
- **No two-stack comparison UI.** Editing in place on the existing input (e.g., toggle Anagram between LINDSEY and LINDSEYS) handles it via live re-execution.
