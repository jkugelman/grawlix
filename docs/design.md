# Design

The shape of Grawlix's UI and the architectural choices behind it. The *what* (user-visible behavior) lives in [`manual.md`](manual.md); this doc covers the *why* — what alternatives were rejected, what constraints shape things — plus architectural surfaces a contributor needs to orient.

This is the singular home for distilled design content. As plans ship, the `distill-design-doc` skill folds them into this file (and `manual.md` for user-facing surface).

## Workspace and sidekick

Constructors use Grawlix in two modes that share one UI:

- **Workspace** — typical during theme generation. The user lives in Grawlix: plays with tools, searches and filters the wordlist, grooms My Edits. Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire, Ingrid, Crossword Compiler, Crosserville). The user pops over to look something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary. The workspace-leaning design accommodates sidekick mode for free as long as load is fast and chrome isn't loud — sidekick is just "brief use, leave."

Lookup features (definitions, NYT crossword history, semantic search; see [`plans/lookup.md`](plans/lookup.md)) are differentially valuable to constructors using grid software without built-in lookup. Crossfire and Crossword Compiler are the populations that benefit most; Ingrid has Google integration and Crosserville has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord), where a constructor wants to act on an idea before it evaporates. It runs the same UI as desktop, responsively narrowed; see § *The shell* for the convergence rationale.

## The shell

**Centered card in a viewport-height app shell.** The brand header is full-bleed and pinned at the top of the viewport; a single `<main>` element below it is the scroll container for everything else. Inside `<main>`, content sits in a max-width (~1000px) card with side margins so the page-background gutters read as intentional. As the user scrolls into the entries table, a sticky region (stats bar → tool stack, the search bar being the stack's last row) anchors at the top of `<main>` — visually directly under the brand header, since the header is outside the scroller. One scrollbar, scoped to `<main>`.

`<main>` uses `scrollbar-gutter: stable` to reserve the scrollbar's gutter whether or not the content overflows. Without that, the Library view (short, no scrollbar) and the Workshop view (tall, scrollbar) would lay out at different inner widths and the centered card would jump horizontally on every view switch.

Bounded width plus a centered column keeps the horizontal space beside the (intentionally narrow, single-column atom) entries table from reading as a developer-tool-shaped empty expanse — the side margins say "this is a content page" rather than "the app didn't fill the window."
**Header is brand chrome plus top-level navigation.** Wordmark on the left, Workshop / Library nav in the center, settings/help on the right. A personal-text subtitle (tagline, byline, contact, GitHub) on a darkened-purple band sits immediately below the row. Per-wordlist state, sync indicators, and wordlist pickers stay out — those would tie the header to ephemeral state. Top-level navigation is the one carve-out from brand-chrome-only: it's structural, not transient (GitHub, Linear, and Stripe all put primary nav in the brand bar without it reading as control clutter). The personal text is a subtitle row rather than the brand-bar center — nav owns the center, and a subtitle keeps the project's voice without competing for the eye-magnet slot.

*Alternative considered:* sticky footer at the bottom of the viewport for the personal text, with the brand bar staying a single row of wordmark + nav + utility. Rejected because the in-chrome subtitle keeps the personal text continuous with brand identity, while a footer would tax every screen with chrome that mostly says nothing once a user has read it. Worth revisiting if the chrome ever feels too tall.

**Two top-level views, Workshop and Library, are peers.** Workshop is the construction-aid surface (tools, stack, entries table). Library is wordlist management (rail, focused-wordlist details, rescore/scoring rules). They share the centered-card chrome and live as sibling sections in `<main>`. Either is shown by toggling the other's `hidden` attribute; the active view is reflected by `.active` + `aria-current="page"` on its nav button. Workshop is the default landing on every boot, including first run — publisher wordlists auto-fetch in the background so someone who shows up to look words up doesn't have to think about wordlist management. Library is discovered when a user wants to customize.

Library is a peer view, not a setup dialog: rescoring and curating wordlists is a return-to activity, not occasional config you set once and leave — return-to activities warrant peer real estate.

**Tool gallery** sits as a top section of the Workshop card. Cards lay out as a responsive grid (~180px min). Discoverability is preserved — the gallery is always visible on entry — at the cost of being scrolled past every session. Tool catalog and chaining are owned by [`plans/tools.md`](plans/tools.md).

**Workshop is always-merged.** No per-wordlist scope; the entries table shows the merged `All` view exclusively. No Workshop activity is meaningfully scoped to a single source (no one wants "anagrams in STWL only"), and per-source inspection belongs to the Library — so Workshop carries no wordlist picker.

**Stats bar always renders, even for empty wordlists** — zero entries, dashes for min/max/etc., flat histogram baseline. Uniformity over an "empty placeholder" treatment.

**Score ranges come from data, never from code.** Wordlist scoring conventions vary widely — 0–100, 0–60, 1–10, 200–2000, even negative numbers. Anything that depends on a min or max — histogram bins, score colors, filter ranges — derives them from the rescored entries actually present in the merged set. This applies to the empty-data path too: when nothing has loaded, the range is *unknown*, not a hardcoded default. Stamping in `0–100` or `0–60` as a fallback is a recurring source of the same bug — it works in testing and quietly misrepresents anyone whose scores sit elsewhere.

**Table is always visible**, even at idle with no search active. The idle and search views are *the same view, just filtered*; live keystroke-to-result feedback depends on continuity. Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat). Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Default landing on `All`.** Including first run. The four publisher wordlists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about wordlist management.

**Sticky region: stats bar → tool stack.** Stats joins the sticky region because the histogram is a clickable filter affordance — keeping it reachable while scrolling the entries table is worth the extra row of sticky chrome. The tool stack always ends with the permanent search bar as its last row, and shows just that bar before the user adds a tool, so pre-tool-use Grawlix looks unchanged — see *Tool gallery & stack* below.

**No persistent rail, no collapsible side panel.** The tool gallery sits as a top section of the card instead of in a side rail; a sync indicator will arrive with sync (see [`plans/sync.md`](plans/sync.md)). A collapsible side panel was considered and rejected as a rail comeback in disguise.

**Mechanics worth knowing:**

- The card uses `overflow: clip`, not `overflow: hidden`. The latter establishes a scrolling block container that breaks `position: sticky` for descendants, trapping the sticky region inside the card. `overflow: clip` rounds the corners without that side effect.
- The sticky region anchors at `top: 0` of `<main>`. Because the brand header lives outside `<main>` and the scroller's top edge is flush with the header's bottom, "top of the scroll container" *is* "directly under the brand header" — no offset variable required.
- The virtual scroller listens for `scroll` events in **capture mode** on `window`, computes its visible slice from the host's `getBoundingClientRect()` against `window.innerHeight`, and slices a window of rows out of a full-height sizer. Capture is required because scroll events don't bubble, and the actual scroller is `<main>` — a non-capturing window listener wouldn't see them. The math is viewport-relative and works whether the scroller is `<main>` or the document.

## Wordlists & setup

Setup splits across two surfaces that answer different questions and stay distinct:

- **Library** — what wordlists do I have, in what order, with what rules. A top-level view (peer of Workshop) reached via the brand-bar nav.
- **Sync & backup** — how is my data being preserved across time and devices. A dialog.

### Library

Two-pane layout: list as a left rail beside the focused-wordlist panel when the viewport is wide enough, stacking above it on narrow viewports. The list itself groups into two labeled sections — **Merged** (the All card at the top) and **Sources** (every reorderable wordlist below). My Edits sits first inside Sources by default but is reorderable like any other.

The focused-wordlist panel has no name/icon header — the focused wordlist is identified by the highlighted card in the list. The action row always justifies the date label and primary action right; the Rescored/Original toggle sits left of them when present.

**Two panel shapes** with one common skeleton (action row → stats + histogram → rules editor → search bar → entries view):

- **Sources and My Edits** carry rescoring rules and the Rescored/Original toggle (toggle visible only when rules apply).
- **All** carries the scoring (tier-label) rules editor in place of rescoring.

My Edits' remaining distinction is just that the user's manual score/comment edits land there — its UI shape collapsed into the source shape once it gained rescore rules. See § *Rescore rules & tier alignment* for the why.

**The Rescored/Original toggle** is a coupled mode: flipping it switches stats, histogram, entries view, and what Download produces in lockstep. WYSIWYG — what you see is what you'd save. A single Download button governed by the toggle, rather than a split-button Download (rescored / original): the toggle's flip is already the gesture that picks which version to export, and routing Download through it earns the toggle its visible chrome. Hidden when no rules apply, and on All (the merged view has no coherent "original" version).

**The Library entries view** is a monospace, text-file-flavored counterpart to the Workshop entries table, sized for "rule tuning": tweak a rescore rule, see its effect in the rows immediately below. Inline `input → output` annotations appear only on rows where the rule actually changed something; ignored rows render the input score with the whole row struck through. Switching to Original mode strips all of that. The view is read-only — editing routes through Workshop's AtomPopover, where users already know to find it. Column widths are computed once across every source + the merged set and cached against `cacheVersion$`, so the entry and score columns stay stable as the user navigates between wordlists or flips the toggle.

**Identity contrast** between the two entries displays is deliberate:

| | Workshop entries table | Library entries view |
|---|---|---|
| Font | mixed (mono entries, sans-serif chrome) | monospace throughout |
| Row chrome | row separators, score badges, count column | whitespace-aligned columns, no separators, no badges |
| Click behavior | atom click → AtomPopover edit | read-only |
| Tools | full gallery + stack | none |
| Filter | search + score-range + sort | search + sort (no score-range) |
| Source attribution | per-atom source column on All | n/a |
| Rescore annotation | red `*` + popover detail | inline `→` |

The two views answer different questions about the same data — Workshop asks "what entries are available to me right now?" (merged, rescored, override-resolved), Library asks "what does this source contain and how does it get transformed?" — so they should look meaningfully different.

**The Library histogram is display-only.** No cursor:pointer, no hover-revealed score gradient, no click-to-filter. Score-range filtering belongs to Workshop alone — Library inspects, doesn't query. Workshop's score filter is a Workshop-side, localStorage-persisted standing preference; the two views' filter scopes don't interact.

**Rescoring lives entirely inside the Library view**; it doesn't appear on the Workshop entries table. Rules are detail config, typically set once when adding a wordlist and rarely revisited; they don't earn persistent real estate next to the wordlist view.

**Scoring rules** are the user's single notion of what each score range means — there is no separate "output" tier system. Tier labels surface on Workshop's entries table as a hover tooltip on each score atom — point at a score, see what tier the user has called it. A tooltip rather than an always-visible legend block above the table: the lookup ("what does 50 mean again?") is a once-in-a-while need, and a legend would cost a row of vertical space the user pays for on every scroll. The editor lives on All's panel because the rules describe the merged scale; the data anchors on top-level `state.scoring` for the same reason. See § *Rescore rules & tier alignment* below.

**Renaming** happens on the wordlist card via F2 with the card focused. Configure (in a wordlist's ⋮ menu) is the secondary path. No Rename in the kebab menu — the F2 affordance is enough.

**Onboarding banner** lives at the top of the wordlist list — there's no auto-popup on Workshop. Users who never visit Library never see it; the defaults are sensible enough that this is fine.

The banner is a 3-page sequence (welcome, personal-wordlist import into My Edits, XWI subscriber import) that exists to *surface features users might not know are there*, not to provide parallel import paths — pages 2 and 3 route through the same `ingestFile` plumbing as the canonical import flows. Page 3 is gated on the XWI wordlist still being present and unpopulated, so it drops out when irrelevant rather than asking a question that has no answer.

**`All` lives in the Library.** It's the synthesized wordlist and belongs in the list of wordlists; the merged-wordlist download lives here too rather than in Sync & backup, which would conflate *one-time download* with *backup workflow*.

### Sync & backup

Today this is a stub. Full design lives in [`plans/sync.md`](plans/sync.md): prominent "Download All" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

### Two paths to "give me a file"

- **Any wordlist's `Download` button in the Library** — produces that wordlist's file. For sources, the Rescored/Original toggle decides which version. For All, it produces the merged wordlist file.
- **Sync & backup dialog** — Tier 1 manual backup for the whole setup. Same file output as Library's All Download, but the workflow is "make a backup" rather than "give me this file"; once Tier 1 lands, using it bumps the "Last backup" timestamp.

### Rescore rules & tier alignment

The unified scale is a declared contract: the tier labels on **All** (`state.scoring`) define what each score range means, and every wordlist's rescore rules describe how its raw scores map to that scale. Any deviation from the contract — input scores not covered by a wordlist's rescore rules, or output scores not covered by All's tier labels — surfaces uniformly as a warning the user can act on.

**Uncovered scores are the misalignment signal.** `recomputeUncovered(wordlist)` derives `wordlist._uncovered` — the raw scores present in the data but not matched by any length-filter-free rescore rule. `recomputeScoringUncovered` does the same on the tier scale, producing `state._scoringUncovered` — merged-output scores not covered by any tier label. A non-empty `_uncovered` drives a `warning`-severity bubble on the affected card; the max severity across all wordlists propagates to the Library nav tab. Alignment check is trivial (`_uncovered.length`) and no output-vs-tier simulation is needed.

Two layers, same surfacing. A source's rescore-side uncovered scores say "there are raw scores in this data you haven't ruled on" (input-side). All's tier-side uncovered scores say "there are merged output scores you haven't labeled" (output-side — a source's rescored output lands at a score outside the tier scale). Both produce an orange bubble. Resolution is structural: fill in rescore rules, or expand the tier scale; the uncovered list empties and the bubble clears. A pure state indicator with no acknowledgment / dismiss path — for deliberate misalignment (e.g. raw XWI scores in the merged view), the right resolution is just adding the missing tier labels, which clears the bubble naturally.

The uncovered metadata lives on the wordlist/state as transient fields, not inside the rules array — keeping it there (as a synthetic "catch-all" row carrying the uncovered list) would conflate "rules the user authored" with "auto-computed coverage metadata," forcing every read site to filter the two apart and muddying persistence. The transient-field shape matches the convention used for `_rescored`, `_overrideMap`, etc.

**Severity-keyed bubble primitive.** A single `.severity-bubble[data-severity=…]` rendered by `buildSeverityBubbleHTML(severity, title)`. Severities today: `info` (green, used for "update available") and `warning` (orange, used for uncovered-score presence). `maxSeverity(...)` resolves priority when bubbles propagate (`warning > info`). The primitive only knows about severity; callers map causes to severities and supply the title ("Update available" vs. "Unhandled scores") — severity alone doesn't carry meaning.

**Banner + `+ Add rule` split in the editor.** The uncovered list surfaces as a warning-styled informational banner at the top of the editor (`⚠️ Unhandled scores: 25, 45-49, 75` — contiguous runs collapsed via `scoresToGroupedList`); rule authoring is a separate `+ Add rule` button below the list. The two jobs are kept apart deliberately — a single row that both *reports* uncovered scores and *doubles as* a way to author a rule conflates them, and the merged range string it would carry (e.g. `25-75` for uncovered scores `{25, 75}`) silently encourages over-broad rules. No "convert these to a rule" affordance on the banner either: any pre-fill for non-contiguous scores is over-broad, and for contiguous scores there's no single right answer (one wide rule, several narrow ones, or widening an adjacent rule all reasonable).

**Tier labels live on `state.scoring`, not on My Edits.** The unified scale belongs to the merged output (All) — what every wordlist gets translated *into* — not to any single wordlist. Anchoring the labels on `myEdits.scoring` would cast My Edits as the scale's owner, which doesn't hold once My Edits carries rescore rules like any other wordlist. A top-level `state.scoring` makes the misalignment-signal pattern symmetric across input-side (per-wordlist `_uncovered`) and output-side (`state._scoringUncovered`), and lets a user customize the unified scale without it living on a "wordlist" data field.

**My Edits' default rescore rules mirror All's tier scale.** One inert row per `state.scoring` tier (output forced blank). Inert because My Edits' scores are already in the unified scale — the rules just declare "these scores are recognized." Without defaults, a fresh user editing any score in My Edits would immediately trip the misalignment bubble — hostile onboarding. Mirroring All's tiers keeps My Edits' inert defaults in *lockstep* with the user's chosen contract: adding a tier on All gains a corresponding inert row in My Edits (when My Edits is pristine), so a future edit at the new tier doesn't trip a warning.

**Auto-seeded inert rules on custom-wordlist import.** When a custom wordlist (no `publisherId`) is fetched or imported with empty rescore rules and ≤10 distinct scores, Grawlix seeds one inert row per distinct score. Visible-but-inert: the editor shows the wordlist's score scale as concrete rows the user can fill in to translate into the unified scale. Identity mappings (`60 → 60`) aren't seeded because that would assert the wordlist uses the unified scale — wrong claim for an unknown source. Above the threshold, the Unhandled-scores banner does the surfacing instead. A wizard-style "rescore on import" was considered and rejected as speed-bump UX; an auto-suggested mapping based on score distribution was rejected because low-confidence guesses would mostly be wrong.

**Default-rule propagation via a `dirty` flag.** Each publisher-bound wordlist and My Edits carry a persisted `dirty` boolean against their defaults; `state.scoringDirty` tracks the tier scale. `dirty` is recomputed from a direct equality check (`rescoreRulesEqual` / `scoringRulesEqual`) after every rule edit, so an edit landing back on defaults flips it false automatically. Two flow points:

- **Boot:** `propagateDefaults()` walks every rule set. If persisted rules differ from current in-code defaults and `dirty` is false, rules are silently overwritten with the new defaults. Dev-shipped updates land for pristine users without intervention.
- **Within session:** the same call runs after every scoring mutation to keep My Edits' inert defaults in lockstep with `state.scoring`.

Propagation is silent — no toast. Rule updates only ever *add* coverage; they never re-grade existing entries. There's no user-visible change to explain, and the cleared misalignment bubble is its own confirmation. A seed-fingerprint snapshot was considered as an alternative to the dirty flag and is functionally equivalent — the flag won on simpler mental model. A code-side history of past `defaultRules` per publisher was considered and rejected as heavier.

**Reset button scoped to the editor.** When `dirty == true`, a "Reset to defaults" button appears alongside `+ Add rule` at the bottom of the rules editor. Confirms before wiping customizations. Visible only inside the editor and only when there's something to undo — a reset button shown anywhere rules differ from defaults would feel nudgy. Per-rule revert was considered and rejected: any rule-matching algorithm is fragile, and the editor itself is the granular tool (a user wanting to revert one rule can manually retype its value).

## Tool gallery & stack

Tools live in two places: a persistent **gallery** as a top section of the card, and a **tool stack** inside the sticky region just below the brand header. The gallery is browseable; the stack is the user's current pipeline. The chrome, the pipeline runtime, and five tools with working logic — Anagram, Semordnilap, Behead, Curtail, Search — are shipped; the rest of the catalog renders gallery cards but doesn't yet produce results. The remainder of the catalog and chaining extensions are tracked in [`plans/tools.md`](plans/tools.md). Tool output lands in the entries table (§ Entries table) as **chain rows** — see § The chain-row model.

**Single catalog drives every surface.** Each tool is one record in `TOOLS` (`name`, `icon`, `category`, `desc`, `example`, `params`, `kind`, `inputHighlights`, `outputHighlights`, optional `glyph` / `prepare` / `run`); gallery section ordering comes from a parallel `TOOL_CATEGORIES` list. Gallery cards, stack-row labels, and the search bar's `Search` label all render the inline icon-and-name pair through the shared `buildToolLabelHTML` helper. Adding a tool means adding one entry — every surface that names tools picks it up — and the helper guarantees the icon-and-name pair looks identical wherever it appears.

**Clicking a gallery card appends that tool** to the end of the user stack — one click target, the whole card. The first click on an empty stack starts a one-tool pipeline; each later click chains another tool onto the end. To swap tools, remove a row via its `✕` and click a fresh card.

**The search bar is always present; user tools sit above it.** `#tool-stack` always exists, holding at least the permanent Search bar as its last row. Before the user adds a tool the stack is just the bar — which looks exactly like the standalone search bar of pre-tool-use Grawlix. Adding the first tool inserts a row above the bar.

**Search is a tool.** The search bar *is* a `search` filter row — the permanent last row of `ToolStack`'s stack, and so the permanent last step of every pipeline. `ToolStack` keeps the invariant that the stack always ends with a Search row; that row is undeletable (no remove button) and renders with its own `.search-bar` chrome instead of the plain `.tool-row` layout. The chrome is the row's "escape hatch": alongside the query input and whole-word toggle (rendered by `buildSearchInputRowHTML`) it hosts the score-range filter and entries-table sort control — filter on the left, view-config on the right; see § Entries table. The query and whole-word state live in that row's `params`, like any tool row; score-range and sort are WorkshopView view-config and ride along as non-param chrome. `search` is also a normal gallery card, so a user can add extra Search rows above the bar. Those rows render the *same* `buildSearchInputRowHTML` chrome — input, clear button, whole-word toggle, and wildcard-help popup — rather than the generic `.tool-row-param` fields, so every Search surface looks and behaves identically; the only wiring difference is delegated `data-row`/`data-key` attributes in place of the bar's fixed ids and inline handlers. `buildSearchInputRowHTML` is shared across all three Search surfaces — the permanent bar, gallery-added Search rows, and the Library search bar. Folding search into the pipeline — rather than running it as a scroller-side filter outside the stack — makes it compose like any tool and lets the unification pass see search highlights (§ Symmetric unification).

`rerenderRows` rebuilds only the user tool rows on a stack mutation, leaving the Search bar's DOM untouched — so its input focus and the sort toolbar mounted inside it survive an add/remove. A full re-render (`mountWorkshopPanel`) does rebuild the bar.

`attachSearchHelpPopups` binds the wildcard-help popup to *every* Search input in the app — one per `.search-pattern-input`, found by a document-wide scan: the permanent bar, every gallery-added Search row, and the Library search bar (all three accept the same wildcard syntax). It runs whenever a view re-renders and a Search anchor may have been rebuilt — `mountWorkshopPanel`, `rerenderRows`, and `LibraryView.renderPane` — destroying the prior popups and rebinding from scratch each time.

**Hovering a gallery card shows an insertion cursor.** A `.tool-stack-cursor` — an accent caret-and-line — appears at the seam where the click will drop the new tool: between the last user tool row and the permanent Search bar, or at the top of the stack when there are no user tools yet. It's parented in the Search bar, absolutely positioned so it adds no height, and removed on mouseleave. A freshly added row gets a one-shot `.flash` accent pulse; `rerenderRows` rebuilds the user rows on every mutation, so the new row's element is always fresh.

### Pipeline execution

`executePipeline(mergedWordlist, stack, signal)` seeds one chain row per merged entry, then walks the stack rows in order, each tool transforming the row set into the next.

A tool's `run(entry, prepared, wordlist)` is a **per-row pure function** — it sees one entry's text and returns a per-row decision; the system owns the outer loop, cooperative yielding, abort, atom construction, and chain bookkeeping. `run` is optional — a tool without one is a transparent placeholder (its row renders, the URL serializes it, the executor passes it over), which keeps chrome-only catalog entries shipped during incremental rollout.

- **Filter** (`kind: 'filter'`) keeps or drops the row in place. `run` returns `null`/`false` (drop), `true` (keep), or a `Range[]` (keep + annotate the tail atom with highlights).
- **Transform** (`kind: 'transform'`) emits 0+ new entries; each output branches the row into a new chain row with an atom appended. `run` returns `TransformOutput[]` of `{ entry, inputHighlights?, outputHighlights? }`, where `entry` is a string (looked up in the merged wordlist's `byEntry` index) or `[string, score]` for a tool-synthesized entry not in any wordlist.

An optional `prepare(params, wordlist)` runs **once per pipeline run**; its return value is handed to `run` in place of the params. It's where a tool compiles a regex or pre-sorts letters once instead of per row — Search compiles its match pattern in `prepare`, Anagram pre-sorts its target letters. Tools without a `prepare` get the normalized params object. The `wordlist` argument exposes lazy indexed views — `byEntry` (a `Map<entry, wlEntry>`) ships today; sorted-letter and length indexes land as tools demand them.

**Runtime normalization.** Every wlEntry carries a single `entry` field, lowercased at parse and otherwise untouched — no separate normalized cache, no original-case backup. Tools compare against `.entry` directly. Param strings get the same treatment (`v.toLowerCase()`) at the executor boundary, so tools see canonical-lowercase input on both sides without per-call ceremony.

One field, not separate normalized caches. A two-field split — `entryLower` for case-insensitive matching, `entryNorm` for whitespace-stripped letter banks — solves a problem real wordlists don't have (they store letter-only entries with no spaces or mixed case) and would leave every `wlEntry` consumer choosing between three near-identical fields. The lone case where space-stripping actually matters is synthesized outputs from tools like `phrase_parsing` (which emit `HOT TO TROT` after parsing the run-together input), and there the spaces are *meaningful* — searching for "hottotrot" should *not* match the parsed form, because the parsing introduced the spaces as a deliberate result. One field, lowercased, spaces preserved, makes both cases work without special casing. Params follow the same rule: typing `L I N D S E Y` doesn't auto-match `LINDSEY` — if the user wanted a parsed/multi-word match, the parsing tool is the right surface for that.

The original-case form of the imported file isn't preserved on wlEntries. **"Download original"** serves the raw IndexedDB blob (`idbGet('data_' + dbKey)`) byte-for-byte, since the imported file text is already stashed there by `applyWordlistText`. Reconstructing from parsed wlEntries would lose case, whitespace nuance, and any comment formatting the user had. My Edits has no "Download original" affordance — it has no imported file, only the user's accumulated edits.

### The chain-row model

A **chain row** is `{ atoms: Atom[] }`; an **atom** is `{ wlEntry, lenses, glyph }`. Each atom is one significant transition through the pipeline — the originator entry, then one per transform — and the entries table stacks them vertically, sharing column widths, so a row reads top-to-bottom as one entry's journey (`RELEARNING → ELEARNING → LEARNING → EARNING`). One shape covers a one-atom result, a two-atom pair, and any longer chain — there's no separate row type per output shape. `lenses` is the atom's list of highlight lenses (see § Highlights pipeline) — usually one, two when the slot is annotated by two tools.

A regular atom's `wlEntry` references the merged wordlist (same identity as the source entry, so AtomPopover edits route correctly). A **synthetic** atom — built from a tool's `[string, score]` output for an entry in no wordlist — has `wlEntry.wordlist === null`; `AtomPopover` suppresses open on it, since editing a synthetic's score wouldn't write back anywhere.

**Atom count is static.** Every row in a given pipeline has the same atom count, derivable from the catalog records alone — `computeChainTemplate(stack)` walks the active tools (run-bearing, not inert) without inspecting any row. Each transform adds an entry slot; each tool's static `inputHighlights` / `outputHighlights` booleans annotate the slot it reads / the slot it creates with a highlight lens. A slot is a single atom in the data model, but it *renders* one display line per lens — one when unannotated or singly annotated, two once a second lens lands (the same entry stacked through two lenses), capped there so a third lens merges into the second line rather than growing the row. `atomCount` is the sum of those line counts; the renderer, the sort tier, and the virtual scroller all read it, so the scroller knows every row's height (`atomCount` × row height) without measuring. An empty Search row is *inert* — it reports `isInert(params)` and is skipped like a run-less tool, so an empty search bar adds neither a slot nor a lens.

**Transforms emit per directed pair.** A transform writes the dumb thing — one row per `(input, output)` it produces. Semordnilap emits a row whenever the reverse is also an entry, in *both* directions; the unification pass cleans that up afterward (§ Symmetric unification). The relation `glyph` (`→`, `↔`) is a static field on the tool, not a character the tool body picks.

### Cooperative runtime — supersession and yielding

`runPipeline(mergedWordlist, stack)` wraps `executePipeline` with supersession and a slow-run indicator. Refresh sites (keystroke in a tool input or the search bar, view entry, gallery click) call it fire-and-forget; the promise resolves to `{rows, atomCount, aborted}` and a caller that sees `aborted: true` drops the result silently.

**Supersession.** A module-level `AbortController` tracks the in-flight run. Each new call aborts the previous controller before starting its own, so a fast typist's stale runs unwind at their next yield point and only the latest reaches the scroller.

**The executor owns yielding.** `run` is a synchronous per-row function with no scheduling concerns. The executor's per-row loop tracks wall-clock and yields once it crosses ~6ms — about half a 60Hz frame — gated behind a `(i & 1023) === 0` bitmask so `performance.now()` doesn't run every iteration. `scheduler.yield()` (with a `setTimeout(0)` fallback) returns control to input and paint between chunks; the yield abort-throws if the run was superseded, so a stale run's body unwinds without per-call bail-out code. Time-based, not iteration-count: a heavy predicate and a trivial one take wildly different time per row, and pinning yields to wall-clock keeps the yield rate sane across both — 1K iterations of ~1μs work would yield every ~1ms, burning hundreds of ms of pure overhead on a 500K filter. Tools never see any of this: there is no scheduling API in the tool surface, only the synchronous `run`.

**Slow-run indicator.** One global signal: a 100ms timer started when a run begins; if it fires, the entries panel gains `.pipeline-running` (fading the result list to 0.55 opacity), cleared when the run completes or aborts. The threshold is the *whole run total*, not per-step — a long pipeline of individually-fast tools that sum past 100ms still trips it. One signal for the whole run rather than a per-tool spinner badge: the user cares that *results* are stale, not which row is slow.

**Test bridge.** `__grawlixTest.pipelineIdle()` resolves when no run is in flight; `getVisibleEntries` awaits it before reading the DOM so test assertions after a keystroke don't race a not-yet-finished refresh.

**Workers — considered and rejected.** Cooperative yielding covers what workers would have bought, without their cost. Yielding already keeps the main thread responsive between chunks — workers' core promise. There's no untrusted code to sandbox: custom JS tools (see [`plans/tools.md` § Open questions](plans/tools.md#open-questions)) run in the author's own browser, so a misbehaving tool only locks up its author. And worker bundling is awkward without a build step — the naïve "copy 500K entries every keystroke" shape serializes ~25 MB through structured clone each direction, likely slower than the main-thread compute it replaces; the viable shape (worker holds the wordlist) pulls a state-sync protocol into every mutation. Revisit only if a built-in tool surfaces whose work fundamentally can't fit the cooperative budget — bulk preprocessing where chunked yields can't hide enough latency.

### Symmetric unification

Semordnilap emits both `STRESSED → DESSERTS` and `DESSERTS → STRESSED`. The post-executor `unifyMirrorRows` pass collapses such mirror pairs — rows that are exact reverses of each other, mirrored entries and mirrored scores — into a single row and promotes its relation glyph to `↔`, the natural glyph for "two one-way rows pointing at each other." A downstream transform breaks the symmetry: `semordnilap → behead` diverges the two directions (`STRESSED → DESSERTS → ESSERTS` is not the reverse of `DESSERTS → STRESSED → TRESSED`), so those rows fail the mirror test and stay separate with directed `→` glyphs. The tool author writes the dumb bidirectional emit; whether a pair dedupes is decided afterward, from whether the rows actually mirror once the full pipeline has run.

Of the two directions, the survivor is chosen explicitly — whichever entry chain sorts lexicographically smaller — so the result is deterministic regardless of the order the executor emitted the pair in. Highlight lenses merge through the collapse: each direction may have been annotated on its own tail (a Search row after semordnilap matches a different word per direction), so the survivor absorbs the dropped row's lenses at mirrored atom indices, folded into its existing lens lines without growing their count. That's what turns two one-sided search hits into one row highlighted on both atoms.

Because search is a pipeline tool running *before* unification, this composes: searching `ss` on semordnilap output highlights both `de[ss]erts` and `stre[ss]ed` in the unified row. A one-sided query — matching only one direction's tail — kills the other direction, leaving an un-mirrored lone row that stays a directed `→`. That degradation is the accepted cost of folding search into the pipeline rather than running it after unification; running it after would keep the `↔` but make search a special non-tool case.

### Chain-row display

Atoms render top-to-bottom on every viewport — there is no side-by-side layout at any width. The entries table is one CSS Grid per row with `grid-auto-rows`; each atom occupies one grid line (`count`, then `entry` / `len` / `score`) — or two when the slot carries two lenses, the extra `.atom-lens` line repeating only the entry — and lines past the first wrap onto their own grid row while staying column-aligned with the line above via shared `--entry-w` / `--len-w` / `--score-w` variables. The relation glyph prefixes every non-originator atom's entry. Row stride is atom count × row height; the virtual scroller reads the static atom count for its stride math, and the row's own height is content-driven by the grid.

Comment and Source columns appear on every chain shape — a one-atom row and a stacked multi-atom row alike — when the viewport has room, dropping staggered as it narrows (source first at <960px, then comment at <760px). They render per-atom: each atom line carries its own comment and source, so a chain row reads top-to-bottom as where every word in the journey comes from. A synthetic atom — built from a tool's `[string, score]` output, sourced from no wordlist — gets blank cells. The columns are pure CSS media-query gating with no JS atom-count branch: the renderer always emits the cells, and the multi-atom rows have the horizontal room because each atom line carries only `entry / len / score`. Headers stay constant: the Entry / Length / Score labels describe what each *line* contains, not the row, so one header set serves every chain shape.

### Sort axes per atom count

Axes split by the row's atom count, not by an output kind:

- **1-atom rows** (empty stack or a pure filter): Entry, Length, Score. Default Entry asc.
- **≥2-atom rows:** Entry, Length, Min score, Max score. Default Min score desc (the worst-scoring atom caps a chain's quality; surfacing best-worst-case rows first matches "what's worth fishing out").

*Entry* (alphabetical) and *Length* project off the **first atom** — the merged-wordlist entry the row grew from — so the table holds its order when a tool is added: a filter or 1-output transform leaves every first atom in place, and the rows can't reshuffle. *Min/Max score* project across every atom; for 1-atom rows *Score* reads the single atom directly. Each axis carries `{label, primary, tiebreakers}`; flipping the user direction reverses only the primary, tiebreakers keep their declared direction so short low-scoring junk doesn't float to the top of a tied bucket (longer > shorter, higher > lower, alphabetical asc as the final stable fallback).

A multi-output transform (anagram) branches one input into rows that share their *whole* first atom — indistinguishable by any first-atom projection. Each first-atom tiebreaker chain replays the tool-less order (Entry's is a no-op, since merged entries are unique; Length's is score desc then entry asc), then ends with `rowChainTail` — the later atoms joined low-separator — so branches fall into alphabetical order by their own output.

The URL drops `sort=` when the axis matches the current tier's default. A stack edit that changes atom count never overrides the chosen axis with a tier default — it remaps it. `entry` and `length` exist in both tiers and carry across untouched; `score` ⇄ `min-score`, and `max-score` collapses to `score` when tools are removed. The tier default applies only on first boot from a URL with no `sort=`, never as a snap-back when crossing the boundary, so the user's sort intent (including the untouched default) survives adding and removing tools. The sort direction is preserved across the remap. The whole sort story is provisional — expect iteration now that the UI is live.

### Highlights pipeline

Search hits and tool-emitted highlights share one renderer and one channel: an atom's `lenses` is a list of **lenses**, each a list of `{ kind, start, end }` records in entry coordinates. A lens is one tool's annotation of that slot — one search row's hits, or one transform's `removed` marks — and the renderer draws one display line per lens, so a slot annotated by two tools shows its entry twice, once under each lens. Search is a tool, so its hits are baked into the chain like any tool's — `buildSearchPattern` exposes a `searchRanges(text)` function returning `search:N` records (one per matched non-wildcard segment, the `N` cycling five color slots); transforms like Behead emit `removed` ranges. `renderHighlightedText(text, ranges)` walks one lens's merged-and-sorted ranges once, emitting `<mark class="search-match search-match-N">` for `search:N` kinds and `<span class="hl-<kind>">` for tool kinds. Overlap is resolved by skipping later ranges entirely; for the patterns tools produce, strict overlap is rare and the simple rule keeps the renderer linear.

The kind registry is open-ended — adding a new tool highlight kind is one (kind name, CSS rule) pair. `removed` is the only tool-emitted kind shipped today (line-through + 0.5 opacity); future kinds (`kept`, `inserted`, `shifted`, `matched`, `group:N`) land as tools start producing them.

Both `WorkshopEntriesScroller` and `LibraryEntriesScroller` route through the same `renderHighlightedText`; Library has no pipeline and computes its own search ranges directly.

**Range positions are in entry coordinates.** A tool emitting a highlight indexes into `wlEntry.entry` directly. Since `entry` is the lowercased form (no whitespace strip) and the renderer's `displayEntry()` only changes case, `entry.length` always equals the rendered string's length — display-coordinates and entry-coordinates coincide. Curtail's "strike through the last letter" range is `[entry.length - 1, entry.length]`, marking the last character of whatever the user sees.

## Entries table

The at-rest results display below the search bar. Renders the merged `All` view — or, with tools in the stack, the pipeline's chain rows (§ Chain-row display) — one or more stacked atoms per row, same view whether idle or filtered. "Table" is meant loosely: rows are absolute-positioned divs in a virtual scroller, not a real `<table>`. Pseudo-column alignment via CSS Grid puts each atom in a fixed sub-slot so the eye reads down them as if they were columns.

**A column of word atoms.** Each atom carries the same shape: the word, its length, and a score badge, with a numbered position leading the row. The list is calm content; controls live in the search bar above.

This is the pattern modern productivity apps (Linear, Notion, Things, virtually every mobile app) have settled on. Two real losses vs. a spreadsheet-style table, judged worth it:
- **2D reading.** A table lets you sort by one axis and visually scan another (sort by Min, eyeball Max). The list can't — switching axes is a sort-control click. In practice users sort by their primary axis and scroll; switching is rare.
- **Click-to-sort headers.** A spreadsheet convention; widely learned but not universal. The separate sort control is fast to learn.

What's gained: visual calm at rest, narrow widths come nearly for free (lists scale; real tables don't), bigger friendlier fonts become natural, and the at-rest UI stays one column wide. Nothing is in the chrome just to tabulate.

**Word atom: `1. CARE 4 50`** — count, word, length, score-badge. Length is to the right of word ([Wordlisted](https://aaronson.org/wordlisted/)'s layout), freeing the leftmost column for the count. The count makes scanning a long list legible and lets a user keep their place when slowly reading through. Count and length use the sans-serif font; word and score-badge use monospace so columns of letters and digits visually align.

**Pseudo-column alignment, fixed widths from data.** Each row is its own grid container with `grid-template-columns: var(--count-w) var(--entry-w) var(--len-w) var(--score-w)` and `grid-auto-rows` for stacked atoms. The four CSS variables are computed once per filter/sort pass from the entire result set: count digits, max entry length across every atom (capped at 21 chars; longer entries truncate with ellipsis + tooltip), max length-number digits, max score digits. They stay fixed across scroll. Picking widths from the visible rows would jitter under virtual scrolling; one outlier row would also blow out the layout for everyone else. Each row is independently grid-laid-out (because rows are absolute-positioned for virtual scrolling), so the variables must be uniform — `max-content` tracks would size per-row and break cross-row alignment.

**Score badges right-aligned within their column.** `justify-self: end` on the score atom pushes each badge to the right edge of the (uniform) score track; numbers' right digits line up across rows. The score column width is `calc(maxScoreDigits ch + 12px)` — the 12px covers the badge's 5px-each-side padding plus a small safety margin.

**Click targets are the entry and score atoms only.** `cursor: pointer` and the click handler both gate on `.atom-entry` or `.atom-score`. The count and length are read-only display; the row as a whole is not interactive. Cursor on the whole row would imply otherwise.

**Search highlight** marks pattern matches in the entry slot via `<mark>` spans, colored per capture group. Ellipsis truncation respects the markup.

**Sort control inside the search bar.** "Sort by [Entry ▾] [↑]" sits at the right edge of the search bar, after the score-range filter — not in a dedicated toolbar above the table. The query input is a fixed width (shared with tool-row param inputs), leaving the bar's right-hand space for the score and sort controls, so folding sort in saves a row of vertical space without crowding. Filter (search/whole-word/score) on the left, view-config (sort) on the right; same row.

The sort axis is a native `<select>` with `appearance: none` and a chevron painted via background-image — quiet inline text rather than bordered chrome. Direction is a borderless `↑`/`↓` button next to it. No persistent border or background; the controls flow inline with natural HTML whitespace between them. Sort axes: Entry (alphabetical by word), Length, Score. Default Entry ascending; Score defaults to descending when first selected.

**Click an atom → AtomPopover.** A click-driven popover anchored to the clicked atom (word or score). Content: a header line repeating the atom for context, a source block (which wordlist sourced the score, with rescore/override info or "Ignored by rescore rules"), score and comment text inputs, a "Saves to My Edits" footer, and a Delete button when the row is sourced from My Edits. Edits commit via Enter (commit + close) or blur (commit, popover stays open so you can tab to the next field); Escape reverts and closes. Click-outside, scroll, resize, search/filter/sort changes, and panel re-mount all close it.

Score/comment edits and the rescore/override explanation all live in the popover — not as in-cell `<input>` swaps and not in a hover-only tooltip. The Comment and Source columns *display* that data on the at-rest list when the viewport is wide enough (see § Chain-row display); editing still routes through the popover — clicking a comment cell opens it focused on the comment field. On narrow viewports the columns drop and the popover is the only path to both.

**Re-render across edits keeps the popover open.** Edits flow through `_onCellEdit`, which routes to `upsertEdits` (non-Edits views) or directly mutates `rawEntries` (My Edits view), then triggers `_applyFilterAndSort(false)`. The scroller re-renders rows but doesn't close the popover, so chained edits (score → tab → comment) work. After re-render, the row matching the popover's active entry gets `.active` reapplied via `AtomPopover.rebindRow`.

**Virtual scrolling.** Rows are absolute-positioned inside a height-sized `.entries-table-rows` container; the scroller materializes only rows in the current viewport ± a buffer. Each row's `top` is `i ×` the row stride (atom count × `ROW_HEIGHT`).

**Two scrollers, one base class.** `BaseVirtualScroller` owns the shared mechanics — sizer DOM, capture-mode window scroll listener, ResizeObserver, the visible-range math, destroy. `WorkshopEntriesScroller` extends it with the atom-grid render, AtomPopover binding, click-to-edit wiring, and the sort toolbar. `LibraryEntriesScroller` extends it with the monospace render, mode-aware `→` annotations, and live rescore-rule preview. The two scrollers diverge in everything the user sees — they share only the act of "render a window of rows into a sizer as the user scrolls."

## Help

The header `?` button is a deactivated placeholder — present so the slot doesn't disappear, but with a `not-allowed` cursor and no behavior. There is no help surface yet; one is planned in [`plans/help.md`](plans/help.md), to land once [`plans/tools.md`](plans/tools.md) settles.

## URL state

The URL captures two things: which top-level view is active, and (for Workshop) the user's active pipeline — each tool stack row in pipeline order, then the permanent Search bar's pattern (`search=`), whole-word toggle (bare key `whole-word`), and the entries-table sort (`sort=`, `sort-dir=`). Pasting a Grawlix link into a chat reproduces what the sender was looking at; refreshing the page lands you back where you were. The score filter is the deliberate exception — see *Out of scope for the URL* below.

A small `Router` IIFE owns parse, serialize, and `history.replaceState`. `MainView` owns the view registry; the Router treats route names opaquely, so adding a new top-level view is one entry in `VIEWS` plus a matching nav button.

### View routes

Hash routes name the active view:

- bare URL → default view (Workshop), no query.
- `#/workshop?…` → Workshop with pipeline state.
- `#/library` → Library.

The default view gets the bare-URL form when its query is empty so the most-shared case stays short — `grawlix.wtf` and `grawlix.wtf/?anagram=CAT` are the 95% URLs. The query string only applies to Workshop today (the pipeline is Workshop's state), so making it implicitly Workshop's matches what users expect when they share a `?anagram=…` link. Non-default views always carry their route explicitly, even with no query: `#/library` is unambiguous about destination, where a bare URL claiming to be Library would compete with the default-view convention. Treating Workshop and Library as URL-symmetric was considered (`#/workshop` always present) but rejected — it adds 11 characters to every shared link to honor a peer-ness principle that's about UI treatment, not URL surface.

Workshop's query state survives view switches in memory. Clicking Library from `#/workshop?anagram=CAT` puts the URL at `#/library` while the in-memory pipeline stays put; clicking Workshop again restores `#/workshop?anagram=CAT`. The URL is what the user sees, not what the app is storing.

Unknown route names (`#/wat`) fall through to the default view; the query that came with them is dropped, on the assumption it was intended for a view that has since been renamed or removed.

### Tool stack encoding

Each pipeline row serializes in pipeline order. A tool's parameters spread across one or more adjacent query keys:

- **First param → the tool-name key.** `slug=value`, where the slug is the tool's catalog key (`anagram`, `regex`, …). This key always anchors the row, so it's emitted even when empty (`anagram=`) — an added-but-unfilled row survives reload. A param-less tool is a bare key (`palindrome`). All values pass through `encodeURIComponent` — Grawlix's pattern syntax (`?`, `#`, `@`, `*`, `[`, `]`, `&`) overlaps with URL reserved characters. Because the first param anchors the row, it must be a value (text) param, not a checkbox.
- **Successive params → their own adjacent keys.** A text param is `paramname=value`; a boolean (checkbox) param is a bare `paramname` when true. Both are omitted at their default (empty / false), so the common case stays short — Search with whole-word off is `search=cat`, with it on `search=cat&whole-word`. This readable per-key form is preferred over folding params into one delimited value.
- **Decoding is a three-way classify.** Each key is a tool name (starts a new row, its value is the first param), a reserved view-config key (`sort`, `sort-dir`), or a successive param of the most recent row. For this to be unambiguous, **param names must be distinct from every tool name and reserved key** — the one namespace rule the scheme rests on.
- **Order is significant.** Parameter order is pipeline order — `?search=cat&anagram=lindsey` runs Search before Anagram; the reverse runs them the other way. This breaks the convention that query strings are unordered, but the URL is mostly machine-generated and read back by Grawlix.
- **Repeated tools are fine.** Two regex rows become two `regex=` entries; their relative order is preserved.
- **The permanent Search bar is the pipeline's final row.** It serializes like any row, with one exception: its keys are elided when it's at default state (empty query, whole-word off) *and* the preceding row isn't a Search tool. That keeps an untouched app at a bare URL (`grawlix.wtf`) while still letting an added Search tool round-trip — `[Search "foo", bar ""]` is `search=foo&search=`, distinct from a lone populated bar `search=foo`. On decode, the last row is the bar if it's a Search; otherwise the bar is at default. Multiple Search rows therefore round-trip, the bar always being the last of them.
- **Unknown keys are dropped** with a toast: *"That link references a tool that's no longer available."* A key that matches no tool, no reserved key, and no tool's param name is treated as a removed tool; the rest of the stack still renders.

### Sort encoding

Two keys carry the entries-table sort:

- `sort=<axis>` — depends on the row's atom-count tier (§ Sort axes per atom count). 1-atom rows: `entry`, `length`, `score`. ≥2-atom rows: `entry`, `length`, `min-score`, `max-score`. Dropped when the axis matches the tier's default (`entry` at 1 atom, `min-score` above).
- `sort-dir=<asc|desc>` — dropped when the direction matches the axis's default. `entry` and `length` default to ascending; `score` / `min-score` / `max-score` default to descending (picking a score axis is "what are the best rows?", which reads top-down).

The two-key form keeps each piece independently minimizable, so the common cases stay quiet — a 1-atom `entry asc` is silent, a stacked `min-score desc` is silent, `score desc` is just `sort=score`, `score asc` is `sort=score&sort-dir=asc`. `sort-dir` can appear without `sort` (e.g. `entry desc` becomes `sort-dir=desc`); the parser treats an absent `sort` as the tier default.

Unknown values for either key are dropped without a toast (no churn risk — the axes are a closed set, unlike the tool catalog). The parser accepts any axis valid in either tier; the scroller remaps the parsed axis (§ Sort axes per atom count) if it isn't valid for the rendered atom count. Sort persists across wordlist switches inside a session: it's a view-config preference of the user, not of the focused wordlist.

### Stable links: don't rename, don't remove

Once URL keys are public, removing or renaming them breaks shared links. The rule:

- **Don't remove tools.** A superseded tool stays as a thin alias to its replacement, or stays indefinitely.
- **Don't rename tool keys.** If a tool's display name changes, its URL key stays.
- **If a rename or removal is unavoidable**, register the old key in an alias table that maps to the new key (or to a sensible fallback) and `replaceState` to the canonical form on load.

No aliases exist today — this is forward-looking guidance for when the catalog churns.

### Router policies

- **Hash routes for views, query string for Workshop's state.** Hash routes (`#/library`) name top-level views without needing server-side path handling on GitHub Pages — `index.html` is served regardless of hash or query. Real paths (`/library`) would require the GitHub Pages 404-redirect SPA trick; the hash dodges it entirely. A `?view=library` parameter was the alternative and was rejected — it couples view identity to query state and gives Library a URL longer than Workshop's bare form for no compositional gain.
- **`replaceState` only.** Stack edits never push a history entry; the back button leaves Grawlix instead of navigating within. The visible UI is the user's history — clearing the search or popping a tool row is the explicit undo. A back button would be redundant or actively confusing ("did I lose my whole stack?").
- **URL for shareable state, localStorage for personal state.** Search pattern, whole-word, sort, and tool stack live entirely in the URL during a session — no localStorage shadow. They describe *what the sender is looking at*, which composes meaningfully on the recipient's setup. The score filter is the lone exception: it's stored in localStorage instead, because scores aren't portable across users and the filter is a standing preference. Rationale in *Out of scope for the URL* below.
- **Updates synchronously on every change.** Every caller — typing, structural toggles, sort changes — replaces the URL immediately. `replaceState` is cheap and browsers rewrite the URL bar without animation, so there's nothing to throttle. Debouncing would also leave the URL briefly behind the visible state, so copying or refreshing mid-keystroke could yield a stale link.

### Out of scope for the URL

These are local-only:

- **Score filter.** Stored in localStorage, not the URL. Two reasons — written down so the question doesn't get re-litigated:
  1. **Scores aren't portable across users.** What counts as `60` depends on which wordlists you have loaded and how you've rescored them. There is no universal scale — even the "common" tier labels (great / good / fair / …) are themselves per-user via My Edits' scoring. A shared `score=60` filter would apply the sender's number to the recipient's scale and produce nonsense. The other URL params don't have this problem: a search pattern, a whole-word toggle, a sort axis, and a tool stack all mean the same thing on any setup.
  2. **It's a standing preference, not a query.** The dominant use is "filter the low-scoring junk out so I'm not wading through it" — that's a setting the user wants in place every visit, not something they re-enter each load. URL-bound state resets to empty on a fresh visit (no link to apply); localStorage carries it forward.
- **Dialogs** (settings, Sync & backup) — transient UI state. Open them how you opened them; close them when you're done.
- **Library's focused wordlist** and its display mode — Library is wordlist-management workspace, not something a link should pre-position the recipient into.
- Scroll position, edit-in-progress state, transient popovers.

## Caches

Wordlists can be hundreds of thousands of entries. Several caches keep wordlist switching, score editing, and merging snappy. They live either on the wordlist object (`wordlist._foo`) or as module-level variables, and they all derive their values from `state.sources` plus per-wordlist `rawEntries` and `rescoreRules`.

| Cache | Scope | Derived from | Cleared by |
|---|---|---|---|
| `wordlist._rescored` | per-wordlist | own `rawEntries` + `rescoreRules` | `invalidateRescoredCache(wordlist)` |
| `wordlist._rescoredMap` | per-wordlist | `_rescored` (`entry` → wlEntry, for fast lookup) | `invalidateRescoredCache(wordlist)` |
| `wordlist._actualScores` | per-wordlist | own `rawEntries` (sorted distinct raw scores; feeds `_uncovered`) | `invalidateActualScoresCache(wordlist)` |
| `wordlist._overrideMap` | per-wordlist | every higher-priority enabled wordlist's `_rescored` | `invalidateSourceCounts()` (clears all) |
| `_mergedWordlistCache` | module | every enabled wordlist's `_rescored` (entries + `byEntry` map) | `invalidateSourceCounts()` |
| `_sourceCountsCache` | module | aliases `_mergedWordlistCache.sourceCounts` | `invalidateSourceCounts()` |
| `_statsCache` (WeakMap) | module, keyed by wordlist or `_mergedStatsKey` | a wordlist's `rawEntries` (or merged entries) | `invalidateStatsCache(key)` |
| `_layoutCache` | module | every enabled wordlist's score distribution (via `_rescored`) | `invalidateHistogramLayout()` (called from `invalidateRescoredCache`) |
| `_libraryColumnWidthsCache` | module, versioned by `cacheVersion$` | every source's `rawEntries` + the merged set | next `cacheVersion$` bump |

Three composite helpers cover the common change patterns:

- **`invalidateWordlistCaches(wordlist)`** — when a wordlist's `rawEntries` change. Clears its `_rescored`, its stats cache, merged stats, the merged caches, and every wordlist's `_overrideMap`.
- **`invalidateSourceCounts()`** — narrower. Used when source ordering, enabled flags, names, or any `_rescored` change but `rawEntries` did not. Clears merged caches and every `_overrideMap`.
- **`refreshSourceCounts()`** — invalidate then re-warm `_sourceCountsCache` (it's read by the rail meta on every dialog refresh).

Override maps are invalidated globally rather than per-affected-list because tracking dependencies (which lists sit below the changed one) isn't worth the complexity. Lazy rebuild on next access keeps the unaffected views free; only what's actually rendered pays the cost. The `_mergedWordlistCache` follows the same pattern.

**Read live, don't snapshot.** Cache entries hold a `wordlist` reference rather than copying out display fields like `name`. Render-time code reads `entry.wordlist.name` so renames propagate without cache invalidation. The virtual scroller follows the same convention — `currentWordlist` is a ref, not a name string.

**Lowercase keys throughout.** `_rescoredMap`, `_overrideMap`, and `_mergedWordlistCache.byEntry` are all keyed by `wlEntry.entry`, which is lowercased at parse. Map keys share storage with the wlEntry's `entry` field, so construction allocates no extra strings and lookups never need a per-call `.toLowerCase()`. Anything that looks up against these caches (e.g. `patchCachesForEditsChange(entry, ...)`) takes its `entry` parameter already-lowercased.

**Hot path: switching wordlists.** First switch builds `_rescored` (lazy) and `_overrideMap` (lazy); subsequent switches are near-free.

**Hot path: editing rescore rules.** Commits go through `applyRescoreRulesChange(wordlist)`, which clears `_rescored` so the merged view picks up the new mapping. The set of distinct raw scores in the data — needed to compute `_uncovered` — does not depend on rules, so it lives on `wordlist._actualScores` and survives rule edits. The keystroke preview path also compiles rules once before handing them to the Library entries scroller, so the per-row `rescoreEntry` walk reads compiled intervals instead of re-parsing strings; for Broda-sized wordlists (~500K entries) that's millions of regex calls saved per keystroke.

**Hot path: editing My Edits.** Score and comment edits, new-entry adds, and deletes all flow through `patchCachesForEditsChange(entry, newEditsWlEntry)`. It mutates the affected `_overrideMap` entries and the matching slot in `_mergedWordlistCache.byEntry` instead of triggering a full rebuild. No `buildMergedWordlist` walks across all sources per keystroke.

The patch is structured around three observations:

- If a higher-priority wordlist also has `entry` (`buildOverrideMap(edits).has(entry)`), edits is overshadowed and never appears in any cache — nothing to patch.
- For ADD and UPDATE, edits becomes the contributor for `entry` in every override map below it; for the merged cache, an existing entry's `wordlist` reference is reassigned (with source-count adjustments) or a new entry is bisect-inserted into the sorted `entries` array.
- For DELETE, walk down from edits's position to find the next enabled wordlist with `entry` (using a lazily-built `wordlist._rescoredMap`). Override maps for positions ≤ next contributor's position drop the entry; positions below adopt next's value. The merged entry is reassigned to next, or removed if no contributor remains.

`_mergedWordlistCache` keeps a `byEntry` Map alongside `entries`; both share the same wlEntry objects, so patching via `byEntry` is visible in `entries`. The merged-view refresh chooses between in-place refilter and full rebuild depending on whether the patch reused the entries array. `refreshDerivedDisplays()` is the post-patch counterpart to `refreshSourceCounts()` — it repaints the rail meta and the scroller's score-atom tier tooltips without invalidating any caches.

**Hot path: typing in search.** Per-keystroke filtering is sized to avoid the two costs that dominate large wordlists — lowercasing the entry and re-sorting the filtered result. The caches involved are scroller-internal (not in the table above): they belong to the active `WorkshopEntriesScroller` / `LibraryEntriesScroller` instance and end with the scroller's life.

- Every `wlEntry` carries a single `entry` field, lowercased at parse and at every mutation path. Filters read `.entry` directly — no per-keystroke `.toLowerCase()` allocation across hundreds of thousands of entries. For source wordlists with uppercase entries (e.g. Broda), the lowercase form is allocated once at parse; the original-case file content is preserved separately as a raw blob in IndexedDB for "Download original" but isn't stored on the wlEntry. Merged-map entries and My Edits-edited entries share the same `entry` field with no duplication.
- The Workshop scroller keeps `_sortedSource` — `allEntries` sorted by the current `sortKey`/`sortDir`. `.filter()` preserves order, so the filter result is already sorted and the post-filter sort drops out.
- The Library scroller splits work two ways. `_baseRows` holds the unfiltered row data — `_buildRows()` walks `rawEntries` and applies `rescoreEntry`, and that result is rebuilt only on `setWordlist` / `setMode` / `setRescorePreview`. `_sortedBaseRows` is its sorted view, rebuilt on sort change. `setQuery` runs neither — it just refilters the cached sorted source.

The invalidation contract for the sort caches is the same trap as the patch path's: anything that mutates entry scores in place must clear them. `_invalidateSortCache()` (Workshop) and `_invalidateRowsCache()` (Library) cover the in-class setters; `refreshWorkshopMergedScroller` and `deleteFromEdits` call `_invalidateSortCache()` directly after patching the merged cache. A new touchpoint that mutates scores on shared entries needs the same call.

### Reactivity

Structural state and the view layer are reactive (signals + effects); the perf-critical caches above stay imperative. The split mirrors what production signal frameworks (Solid, Svelte 5, Preact signals) do internally.

A pure-reactive design — one big `merged$ = computed(() => buildMerged(sources$))` — re-derives the whole 1M-entry merged wordlist on every My Edits keystroke. The hybrid model keeps reactivity for the 90% of state where it doesn't fight performance, and leaves the cache layer alone where it earns its keep. Pushing further — replacing imperative caches with observable collections and the virtual scroller with per-row reactive components — is a possible future rewrite; see [`plans/per-row-reactivity.md`](plans/per-row-reactivity.md).

**The signals primitive** is hand-rolled at ~50 lines (no external dependency, preserves "no build step, no npm"):

- The API is the standard `get`/`set`/`effect` shape, plus two additions for the in-place-mutation case: `peek` reads without subscribing (used by the `state` proxy's getters so incidental reads inside effects don't accidentally subscribe), and `bump` notifies even when the reference is unchanged (for array/map mutations like reordering `sources`).
- No automatic dependency cleanup on re-runs — effects accumulate subscriptions. Acceptable for grawlix's small, stable graph.
- No `computed` primitive. The imperative caches play that role.

**What's reactive:**

- `sources$` — the wordlist array. The cosmetic effect subscribes; reorder/add/remove call `sources$.bump()` after splicing.
- Per-wordlist cosmetic fields: `name$`, `icon$`, `url$`, `publisherId$`. Each wordlist exposes both the signal (`wl.name$`) and a peek getter / set setter on the plain field (`wl.name`). `wrapWordlist(wl)` installs them at every wordlist-creation site.
- `cacheVersion$` — the bridge between layers. Bumped by helpers that change cache-affecting state; the render effect subscribes.

Search, sort, score-range, and the Library's focused wordlist + display mode aren't on the global `state` object — they live inside `WorkshopView`'s and `LibraryView`'s closures. Each view is a self-contained module owning its own UI state; the input handlers it exposes update the closure variables and call the relevant scroller directly. No effect needs to react.

Per-wordlist field categories beyond the cosmetic four:

- **Cache-affecting** (`enabled`, `rescoreRules`, `rawEntries`) — plain properties. Mutate via the helper (`setWordlistEnabled`, etc.) so the helper invalidates the right caches and bumps `cacheVersion$`. Never assign directly — there's no signal to fire and the caches will silently go stale.
- **Transient** (`_loading`, `_updateAvailable`, `lastUpdated`, `fetchedSize`, `_rescored`, `_rescoredMap`, `_overrideMap`, `originalFilename`) — plain properties. Set directly. Anything that displays them updates as a side effect of the surrounding flow (e.g. `applyWordlistText` ends with the render effect dispatching panel updates because it batched a `repaintAfterCacheChange`).

**The two effects:**

- **Render effect** reads `cacheVersion$`. First run does the initial Workshop paint (always merged — there's no selection). Subsequent cache bumps refresh derived state in place: `refreshSourceCounts` rebuilds caches, `renderSources` repaints the Library list with fresh meta, `refreshDerivedDisplays` updates the scroller's score-atom tier tooltips and the main-panel stats bar, then the Workshop merged scroller is updated via `refreshWorkshopMergedScroller` (which shares its array-identity protocol with the patch path).
- **Cosmetic effect** reads `sources$` and every wordlist's `name$`/`icon$`/`url$`/`publisherId$`. Any cosmetic change re-renders the Library list and (since the merged scroller has a per-atom source column) the visible Workshop scroller rows. No cache touched — cache entries hold wordlist refs and read names live.

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

### Routes for Sync & backup, Settings, Help?

Top-level views (Workshop, Library) are routed; setup-style dialogs (Sync & backup, Settings, Help) aren't. Confirms/alerts/downloads stay as dialogs regardless — those really are transient.

Arguments in favor of routes for setup: setup screens are *places* users spend real time, URL-addressable means deep-linkable and reload-safe, narrow viewports turn modals into full-screen routes anyway. Currently sticking with dialogs because they match the existing codebase idiom.

Worth revisiting if the dialog-as-workspace feel becomes a friction point — particularly at narrow viewport widths, where a full-screen modal is essentially a route in disguise. Notes for that revisit: bookmark/share-setup-state is unlikely (so deep-linking isn't a strong driver, just reload-safety); back button does default browser behavior (navigates back to the wordlist); header stays a fixture with no dynamic content (no breadcrumbs). *"Routes for everything" — including confirms — was considered and dropped as too heavy-handed.*

### Workshop result-export

A copy-to-clipboard + save-as-file affordance for *query results* (anagrams, regex hits) on the Workshop entries table. Distinct from any wordlist download — query results are not wordlists. Parked for now; placement (sort cluster vs. table-region header vs. separate button) deferred.

## Non-features

Things explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL encodes. No "save my exploration" feature, no session restore.
- **No cross-wordlist comparison.** "Words in JK but not XWI" set-difference views are not a real workflow.
- **No scratchpad / working set.** My Edits is the only persistence concept.
- **No multi-pattern search.** Serial single queries are fine.
- **No recent-searches strip.** Search history is not preserved or surfaced.
- **No two-stack comparison UI.** Editing in place on the existing input (e.g., toggle Anagram between LINDSEY and LINDSEYS) handles it via live re-execution.
