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

**Centered card in a viewport-height app shell.** The brand header is full-bleed and pinned at the top of the viewport; a single `<main>` element below it is the scroll container for everything else. Inside `<main>`, content sits in a max-width (~1000px) card with side margins so the page-background gutters read as intentional. As the user scrolls into the entries table, a sticky region (stats bar → tool stack → search bar) anchors at the top of `<main>` — visually directly under the brand header, since the header is outside the scroller. One scrollbar, scoped to `<main>`.

`<main>` uses `scrollbar-gutter: stable` to reserve the scrollbar's gutter whether or not the content overflows. Without that, the Library view (short, no scrollbar) and the Workshop view (tall, scrollbar) would lay out at different inner widths and the centered card would jump horizontally on every view switch. The previous arrangement put the scroll on the document, which had the same shift problem plus made the header narrower than the viewport while the scrollbar was present.

The shape replaced an earlier full-bleed, fixed-left-rail layout that left a developer-tool-shaped expanse of empty horizontal space to the right of the (intentionally narrow, single-column atom) entries table. Bounded width plus centered column makes that empty space *intentional* — the side margins read as "this is a content page" rather than "the app didn't fill the window."
**Header is brand chrome plus top-level navigation.** Wordmark on the left, Workshop / Library nav in the center, settings/help on the right. A personal-text subtitle (tagline, byline, contact, GitHub) on a darkened-purple band sits immediately below the row. Per-wordlist state, sync indicators, and wordlist pickers stay out — those would tie the header to ephemeral state. The earlier "brand chrome only" rule excluded all controls; top-level navigation is the carve-out because it's structural, not transient (GitHub, Linear, and Stripe all put their primary nav in the brand bar without it reading as control clutter). The personal text used to occupy the brand-bar center but lost that slot to nav; demoting it to a subtitle row keeps the tone — "this is the project's voice" — without making it compete for the eye-magnet center.

*Alternative considered:* sticky footer at the bottom of the viewport for the personal text, with the brand bar staying a single row of wordmark + nav + utility. Rejected because the in-chrome subtitle keeps the personal text continuous with brand identity, while a footer would tax every screen with chrome that mostly says nothing once a user has read it. Worth revisiting if the chrome ever feels too tall.

**Two top-level views, Workshop and Library, are peers.** Workshop is the construction-aid surface (tools, stack, entries table). Library is wordlist management (rail, focused-wordlist details, rescore/scoring rules). They share the centered-card chrome and live as sibling sections in `<main>`. Either is shown by toggling the other's `hidden` attribute; the active view is reflected by `.active` + `aria-current="page"` on its nav button. Workshop is the default landing on every boot, including first run — publisher wordlists auto-fetch in the background so someone who shows up to look words up doesn't have to think about wordlist management. Library is discovered when a user wants to customize.

Library used to live behind a ⚙ button in Workshop's slim top row as a *Wordlists dialog*, on the premise that setup was occasional config you wouldn't return to. Community signal reset that premise: rescoring and curating wordlists is a return-to activity, which warrants peer real estate.

**Tool gallery** sits as a top section of the Workshop card. Cards lay out as a responsive grid (~180px min). Discoverability is preserved — the gallery is always visible on entry — at the cost of being scrolled past every session. Tool catalog and chaining are owned by [`plans/tools.md`](plans/tools.md).

**Workshop is always-merged.** No per-wordlist scope; the entries table shows the merged `All` view exclusively. A wordlist picker used to sit in a slim top row above the gallery, but it was removed: there's no Workshop activity meaningfully scoped to a single source (no one wants "anagrams in STWL only"), and the picker only stuck around because per-source viewing had nowhere else to live. With per-source inspection now in the Library, the picker no longer earned its slot.

**Stats bar always renders, even for empty wordlists** — zero entries, dashes for min/max/etc., flat histogram baseline. Uniformity over an "empty placeholder" treatment.

**Score ranges come from data, never from code.** Wordlist scoring conventions vary widely — 0–100, 0–60, 1–10, 200–2000, even negative numbers. Anything that depends on a min or max — histogram bins, score colors, filter ranges — derives them from the rescored entries actually present in the merged set. This applies to the empty-data path too: when nothing has loaded, the range is *unknown*, not a hardcoded default. Stamping in `0–100` or `0–60` as a fallback is a recurring source of the same bug — it works in testing and quietly misrepresents anyone whose scores sit elsewhere.

**Table is always visible**, even at idle with no search active. The idle and search views are *the same view, just filtered*; live keystroke-to-result feedback depends on continuity. Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat). Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Default landing on `All`.** Including first run. The four publisher wordlists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about wordlist management.

**Sticky region: stats bar → tool stack (when populated) → search bar.** Stats joins the sticky region because the histogram is a clickable filter affordance — keeping it reachable while scrolling the entries table is worth the extra row of sticky chrome. The tool stack is hidden when empty so pre-tool-use Grawlix looks unchanged — see *Tool gallery & stack* below.

**No persistent rail, no collapsible side panel.** The previous left rail held the wordlist picker, sync indicator, and tool gallery. Its content dispersed: picker to the slim top row, tool gallery to a top section of the card, sync indicator deleted (it'll be reintroduced when sync ships — see [`plans/sync.md`](plans/sync.md)). A "collapsible side panel" interim was considered and rejected as a rail comeback in disguise.

**Mechanics worth knowing:**

- The card uses `overflow: clip`, not `overflow: hidden`. The latter establishes a scrolling block container that breaks `position: sticky` for descendants, trapping the sticky region inside the card. `overflow: clip` rounds the corners without that side effect.
- The sticky region anchors at `top: 0` of `<main>`. Because the brand header lives outside `<main>` and the scroller's top edge is flush with the header's bottom, "top of the scroll container" *is* "directly under the brand header" — no offset variable required. Earlier the scroll was on the document, which forced a `--sticky-top` custom property tracking the header's `offsetHeight`; moving scroll into `<main>` retired that machinery.
- The virtual scroller listens for `scroll` events in **capture mode** on `window`, computes its visible slice from the host's `getBoundingClientRect()` against `window.innerHeight`, and slices a window of rows out of a full-height sizer (`entries × ROW_HEIGHT`). Capture is required because scroll events don't bubble, and the actual scroller is `<main>` — a non-capturing window listener wouldn't see them. The math itself is viewport-relative and works whether the scroller is `<main>` or the document. The earlier two-scrollbar arrangement (page + inner host) was rejected explicitly; today's single scrollbar on `<main>` keeps that win.

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

**The Rescored/Original toggle** is a coupled mode: flipping it switches stats, histogram, entries view, and what Download produces in lockstep. WYSIWYG — what you see is what you'd save. A split-button Download (rescored / original) was the prior shape; collapsing it into a single Download button governed by the toggle makes the toggle's flip the gesture that picks which version to export, and earns the toggle its visible chrome. Hidden when no rules apply, and on All (the merged view has no coherent "original" version).

**The Library entries view** is a monospace, text-file-flavored counterpart to the Workshop entries table, sized for "rule tuning": tweak a rescore rule, see its effect in the rows immediately below. Inline `input → output` annotations appear only on rows where the rule actually changed something; ignored rows render the input score with the whole row struck through. Switching to Original mode strips all of that. The view is read-only — editing routes through Workshop's AtomPopover, where users already know to find it. Column widths are computed once across every source + the merged set and cached against `cacheVersion$`, so the entry and score columns stay stable as the user navigates between wordlists or flips the toggle.

**Identity contrast** between the two entries displays is deliberate:

| | Workshop entries table | Library entries view |
|---|---|---|
| Font | mixed (mono entries, sans-serif chrome) | monospace throughout |
| Row chrome | row separators, score badges, count column | whitespace-aligned columns, no separators, no badges |
| Click behavior | atom click → AtomPopover edit | read-only |
| Tools | full gallery + stack | none |
| Filter | search + score-range + sort | search + sort (no score-range) |
| Source attribution | per-row source column on All | n/a |
| Rescore annotation | red `*` + popover detail | inline `→` |

The two views answer different questions about the same data — Workshop asks "what entries are available to me right now?" (merged, rescored, override-resolved), Library asks "what does this source contain and how does it get transformed?" — so they should look meaningfully different.

**The Library histogram is display-only.** No cursor:pointer, no hover-revealed score gradient, no click-to-filter. Score-range filtering belongs to Workshop alone — Library inspects, doesn't query. Workshop's score filter is a Workshop-side, localStorage-persisted standing preference; the two views' filter scopes don't interact.

**Rescoring lives entirely inside the Library view**; it doesn't appear on the Workshop entries table. Rules are detail config, typically set once when adding a wordlist and rarely revisited; they don't earn persistent real estate next to the wordlist view.

**Scoring rules** are the user's single notion of what each score range means — there is no separate "output" tier system. Tier labels surface on Workshop's entries table as a hover tooltip on each score atom — point at a score, see what tier the user has called it. The earlier always-visible legend block above the table was dropped because it earned a row of vertical real estate the user paid for on every scroll, even though the lookup ("what does 50 mean again?") is a once-in-a-while need. The editor lives on All's panel because the rules describe the merged scale; the data anchors on top-level `state.scoring` for the same reason. See § *Rescore rules & tier alignment* below.

**Renaming** happens on the wordlist card via F2 with the card focused. Configure (in a wordlist's ⋮ menu) is the secondary path. No Rename in the kebab menu — the F2 affordance is enough.

**Onboarding banner** lives at the top of the wordlist list — there's no auto-popup on Workshop. Users who never visit Library never see it; the defaults are sensible enough that this is fine.

The banner is a 3-page sequence (welcome, personal-wordlist import into My Edits, XWI subscriber import) that exists to *surface features users might not know are there*, not to provide parallel import paths — pages 2 and 3 route through the same `ingestFile` plumbing as the canonical import flows. Page 3 is gated on the XWI wordlist still being present and unpopulated, so it drops out when irrelevant rather than asking a question that has no answer.

**`All` returned to the Library** when source-only scoping was relaxed. It's just the synthesized wordlist and belongs in the list of wordlists; the merged-wordlist download lives here too rather than in Sync & backup (which conflated *one-time download* with *backup workflow*).

### Sync & backup

Today this is a stub. Full design lives in [`plans/sync.md`](plans/sync.md): prominent "Download All" and "Download My Edits" buttons (Tier 1 manual backup), per-cloud-provider connect/disconnect (Tier 3), disk-sync section gated on PWA install (Tier 2), recent activity log.

### Two paths to "give me a file"

- **Any wordlist's `Download` button in the Library** — produces that wordlist's file. For sources, the Rescored/Original toggle decides which version. For All, it produces the merged wordlist file.
- **Sync & backup dialog** — Tier 1 manual backup for the whole setup. Same file output as Library's All Download, but the workflow is "make a backup" rather than "give me this file"; once Tier 1 lands, using it bumps the "Last backup" timestamp.

### Rescore rules & tier alignment

The unified scale is a declared contract: the tier labels on **All** (`state.scoring`) define what each score range means, and every wordlist's rescore rules describe how its raw scores map to that scale. Any deviation from the contract — input scores not covered by a wordlist's rescore rules, or output scores not covered by All's tier labels — surfaces uniformly as a warning the user can act on.

**Uncovered scores are the misalignment signal.** `recomputeUncovered(wordlist)` derives `wordlist._uncovered` — the raw scores present in the data but not matched by any length-filter-free rescore rule. `recomputeScoringUncovered` does the same on the tier scale, producing `state._scoringUncovered` — merged-output scores not covered by any tier label. A non-empty `_uncovered` drives a `warning`-severity bubble on the affected card; the max severity across all wordlists propagates to the Library nav tab. Alignment check is trivial (`_uncovered.length`) and no output-vs-tier simulation is needed.

Two layers, same surfacing. A source's rescore-side uncovered scores say "there are raw scores in this data you haven't ruled on" (input-side). All's tier-side uncovered scores say "there are merged output scores you haven't labeled" (output-side — a source's rescored output lands at a score outside the tier scale). Both produce an orange bubble. Resolution is structural: fill in rescore rules, or expand the tier scale; the uncovered list empties and the bubble clears. A pure state indicator with no acknowledgment / dismiss path — for deliberate misalignment (e.g. raw XWI scores in the merged view), the right resolution is just adding the missing tier labels, which clears the bubble naturally.

The uncovered metadata lives on the wordlist/state as transient fields rather than inside the rules array. An earlier shape pushed a synthetic "catch-all" row into the rules array carrying the uncovered list; that conflated "rules the user authored" with "auto-computed metadata about coverage gaps," forcing every read site to filter the two apart and confusing the persistence story. The transient-field shape matches the convention used for `_rescored`, `_overrideMap`, etc.

**Severity-keyed bubble primitive.** A single `.severity-bubble[data-severity=…]` rendered by `buildSeverityBubbleHTML(severity, title)`. Severities today: `info` (green, used for "update available") and `warning` (orange, used for uncovered-score presence). `maxSeverity(...)` resolves priority when bubbles propagate (`warning > info`). The primitive only knows about severity; callers map causes to severities and supply the title ("Update available" vs. "Unhandled scores") — severity alone doesn't carry meaning. Generalizing the green update-dot into this primitive happened before any misalignment wiring; the dot's CSS and JS shape stayed the same, the new severity slot fell out naturally.

**Banner + `+ Add rule` split in the editor.** Uncovered scores used to render as a regular rule row that doubled as a way to author a new rule. Users found the dual purpose confusing, and the merged range string (e.g. `25-75` for uncovered scores `{25, 75}`) silently encouraged over-broad rules. The uncovered list now surfaces as a warning-styled informational banner at the top of the editor (`⚠️ Unhandled scores: 25, 45-49, 75` — contiguous runs collapsed via `scoresToGroupedList`), with a separate `+ Add rule` button below the list. No "convert these to a rule" affordance on the banner: any pre-fill for non-contiguous scores is over-broad, and for contiguous scores there's no single right answer (one wide rule, several narrow ones, or widening an adjacent rule all reasonable).

**Tier labels live on `state.scoring`, not on My Edits.** An earlier shape anchored the tier labels on `myEdits.scoring`, treating My Edits as the canonical owner of the unified scale. That stopped making sense once My Edits gained rescore rules like any other wordlist — the unified scale belongs to the merged output (All), which is what every wordlist gets translated *into*. A top-level `state.scoring` makes the misalignment-signal pattern symmetric across input-side (per-wordlist `_uncovered`) and output-side (`state._scoringUncovered`), and lets a user customize the unified scale without it living on a "wordlist" data field. This is a return to a pre-v4 shape; the new wrinkle is My Edits getting its own rescore rules.

**My Edits' default rescore rules mirror All's tier scale.** One inert row per `state.scoring` tier (output forced blank). Inert because My Edits' scores are already in the unified scale — the rules just declare "these scores are recognized." Without defaults, a fresh user editing any score in My Edits would immediately trip the misalignment bubble — hostile onboarding. Mirroring All's tiers keeps My Edits' inert defaults in *lockstep* with the user's chosen contract: adding a tier on All gains a corresponding inert row in My Edits (when My Edits is pristine), so a future edit at the new tier doesn't trip a warning.

**Auto-seeded inert rules on custom-wordlist import.** When a custom wordlist (no `publisherId`) is fetched or imported with empty rescore rules and ≤10 distinct scores, Grawlix seeds one inert row per distinct score. Visible-but-inert: the editor shows the wordlist's score scale as concrete rows the user can fill in to translate into the unified scale. Identity mappings (`60 → 60`) aren't seeded because that would assert the wordlist uses the unified scale — wrong claim for an unknown source. Above the threshold, the Unhandled-scores banner does the surfacing instead. A wizard-style "rescore on import" was considered and rejected as speed-bump UX; an auto-suggested mapping based on score distribution was rejected because low-confidence guesses would mostly be wrong.

**Default-rule propagation via a `dirty` flag.** Each publisher-bound wordlist and My Edits carry a persisted `dirty` boolean against their defaults; `state.scoringDirty` tracks the tier scale. `dirty` is recomputed from a direct equality check (`rescoreRulesEqual` / `scoringRulesEqual`) after every rule edit, so an edit landing back on defaults flips it false automatically. Two flow points:

- **Boot:** `propagateDefaults()` walks every rule set. If persisted rules differ from current in-code defaults and `dirty` is false, rules are silently overwritten with the new defaults. Dev-shipped updates land for pristine users without intervention.
- **Within session:** the same call runs after every scoring mutation to keep My Edits' inert defaults in lockstep with `state.scoring`.

Propagation is silent — no toast. Rule updates only ever *add* coverage; they never re-grade existing entries. There's no user-visible change to explain, and the cleared misalignment bubble is its own confirmation. A seed-fingerprint snapshot was considered as an alternative to the dirty flag and is functionally equivalent — the flag won on simpler mental model. A code-side history of past `defaultRules` per publisher was considered and rejected as heavier.

**Reset button scoped to the editor.** When `dirty == true`, a "Reset to defaults" button appears alongside `+ Add rule` at the bottom of the rules editor. Confirms before wiping customizations. Visible only inside the editor and only when there's something to undo — an earlier always-visible reset button felt nudgy by appearing anywhere rules differed from defaults. Per-rule revert was considered and rejected: any rule-matching algorithm is fragile, and the editor itself is the granular tool (a user wanting to revert one rule can manually retype its value).

## Tool gallery & stack

Tools live in two places: a persistent **gallery** as a top section of the card, and a **tool stack** inside the sticky region just below the brand header. The gallery is browseable; the stack is the user's current pipeline. The chrome and the pipeline runtime are shipped; two tools (Anagram, Semordnilap) actually transform their input today, the rest of the catalog renders rows but doesn't yet produce results. The remainder of the catalog and chaining extensions are tracked in [`plans/tools.md`](plans/tools.md). Tool output lands in the entries table (§ Entries table) — words rows for word output, pair rows for pair output.

**Single catalog drives every surface.** Each tool is one record in `TOOLS` (`name`, `icon`, `category`, `desc`, `example`, `params`, `output`, optional `run`); section ordering for the gallery comes from a parallel `TOOL_CATEGORIES` list. Gallery cards, stack-row labels, and the search bar's `Search` label all render the inline icon-and-name pair through the shared `buildToolLabelHTML` helper. Adding a tool means adding one entry — every surface that names tools picks it up — and the helper guarantees the icon-and-name pair looks identical wherever it appears.

**Two click targets per gallery card.** The card body replaces the stack with that tool — the 98%-case gesture. The `+` badge on the right edge appends the tool to the end of the stack — the 2%-case "chain" gesture. The `+` is hover-revealed (no visual presence at rest) and hidden entirely when the stack is empty: chain has no referent without existing tools, so the unfamiliar affordance shouldn't appear before there's something to chain to.

**Stack hidden when empty.** No user-added tools = no `#tool-stack` element in the DOM. The functional search bar below sits in its usual position. The stack appears only when the user adds the first tool.

**Search bar styled as the bottom row of the stack.** Same row layout (icon + bold name + params), same background, abuts the stack with no gap. An earlier mockup had a chrome "permanent Search" row inside the stack itself; that produced two visible search inputs (one chrome, one functional). Dropping the chrome row and restyling the functional bar to match the stack gives a single search input with visual continuity. The whole-word toggle, score-range filter, and the entries-table sort control all live in the same row — filter on the left, view-config (sort) on the right; see § Entries table for the sort cluster's shape.

**Hover previews show what the click will do — but only when the click is visually surprising.** The rules:

- *Chain hover (`+` button)*: a ghost row appended at the end of the stack. Always shown; the `+` is unfamiliar and the ghost teaches what it does.
- *Replace hover (card body), 2+ tools in stack*: doomed rows collapse to zero height; ghost slides in. Communicates "this click will destroy multiple rows."
- *Replace hover, 0 or 1 tools in stack*: no preview. The click is simple enough to leave bare; previewing would add clutter.

Ghost rows carry an accent tint and a subtle shimmer (sweeping accent gradient via an `::after` pseudo-element). `prefers-reduced-motion` disables the shimmer.

**One animation primitive: `animateHeight(mutate)`.** Capture the stack's current rendered height, run the mutation, measure the new natural height, transition between them via an explicit `height` style. Per-row `max-height` transitions were tried first and produced jiggle when multiple rows animated in opposite directions (one collapsing, one growing); container-level animation is one coherent move regardless of how many rows changed underneath.

**Doomed rows collapse rather than fade in place.** An earlier version held doomed rows at full height (opacity 0) with the ghost as an absolute-positioned overlay — no height changes during preview, no jiggle, but the fixed-height stack with the ghost floating in it left an empty gap that looked bad. Collapsing doomed rows lets the table move up smoothly into the freed space; `animateHeight` ensures the move is one continuous direction.

**Ghost-promote in place on commit.** When a click commits a hovered ghost, the *same* DOM element loses its `.ghost` class and gains real-row content (via `innerHTML` swap of the inner body). CSS transitions on opacity/color/background handle the visual shift naturally. Replacing the node with a fresh element would lose the in-progress transition state and produce a flash. A 24×24 placeholder div in the ghost's right slot matches the X button's footprint so the row's height is identical between ghost and real states.

**`+`-button camouflage gotcha.** The global `button:hover:not(:disabled)` rule (specificity 0,2,1) overrides naive `.gallery-card-add:hover` (0,2,0), giving the add button the card's hovered background and making it visually invisible against the card. The hover rule is scoped as `.gallery-card .gallery-card-add:hover` (specificity 0,3,0) to win on specificity without `!important`.

### Pipeline execution

A tool's `run(input, params, ctx)` does the work. `run` is optional — tools without one are transparent placeholders in the pipeline. Their row renders, the URL serializes them, but the executor passes them over. Chrome-only catalog entries stay shipped until their run arrives, which keeps the gallery's catalog visible during incremental rollout.

`executePipeline(mergedEntries, stack, ctx, onRowStart, onRowEnd)` walks stack rows in order. `run` is async-by-default — sync tools `return` items, async tools `await` the `ctx` helpers, the executor awaits either way. For each row whose tool has a `run`, the executor normalizes the params and calls `tool.run(items, normalizedParams, ctx)`. The return is `{kind, items}`: `kind` is `'words'` (a wlEntry array) or `'pairs'` (`{a, b}[]`); groups output is still planned. When a pair-output tool is followed by a word-input tool, the executor projects the pair list down to a wlEntry array via the producer's `chainProjection` (`'a'` / `'b'` / `'both'`); the consumer row's `col` toggle can override per row.

**Runtime normalization.** Every wlEntry carries a precomputed `entryNorm` field — lowercase + whitespace-stripped — alongside `entryLower`. Tools compare against `entryNorm` and never re-normalize. Param strings get the same treatment at the executor boundary, so a tool's `run` receives canonical inputs on both sides without per-call ceremony. For wordlists with uppercase-letter-only entries (the common case), `entryNorm` shares string identity with `entryLower` — no extra allocation.

**Identity preservation for the patch path.** When the stack contains no run-bearing tools (or only no-op ones), `executePipeline` returns the merged cache's entries array unchanged. The scroller compares array identity to decide whether to take the patch path (in-place edits to scores via My Edits keep the open popover) or the full refresh path. Once a transforming tool is in the stack, the pipeline produces a fresh array per call and the patch optimization is bypassed; chained popover edits in anagram or pair view close the popover on commit, which is acceptable for the niche.

**Pair output declarations.** A pair-producing tool declares `output: 'pairs'`, a `relation` (`'transform'` / `'symmetric'` / `'contains'`), `labels` naming the two sides, and a `chainProjection` for downstream. The renderer maps `relation` to a glyph (→ / · / ⊃) — tools don't pick characters themselves so display stays consistent across all tools sharing a relation. Pair-producing tools that share an `a`-or-`b` identity (semordnilap's b is uniquely reverse(a); behead's b is a-minus-first-letter) emit each pair once via a canonical ordering — for semordnilap, smaller `entryNorm` becomes `a`.

### Cooperative runtime — supersession, yield, spinners

`runPipeline(mergedEntries, stack)` wraps `executePipeline` with three pieces that the user-visible pipeline depends on. Refresh sites (keystroke in a tool input, view entry, gallery click) call `runPipeline` fire-and-forget; the returned promise resolves to `{kind, items, aborted}` and a caller that sees `aborted: true` drops the result silently.

**Supersession.** A module-level `AbortController` tracks the in-flight run. Each new call to `runPipeline` aborts the previous controller before starting its own, so a fast typist's stale runs unwind at their next yield point (or, for sync tools, at the executor's per-row abort check) and only the latest keystroke's result reaches the scroller. Synchronous tools today are short enough that abort is observed at row boundaries rather than mid-tool, but the same plumbing serves async tools the moment they appear.

**The `ctx` API.** Tools receive `ctx` carrying `signal` (an `AbortSignal` for `fetch`), `aborted` (cheap read), `yield()` (manual yield that throws `AbortError` on a flipped signal), and two chunked iteration helpers — `forEach(input, fn)` and `filter(input, predicate)`. The helpers own time-tracking: every 1024 iterations (gated behind a single `(i & 1023) === 0` bitmask so `performance.now()` doesn't run every iteration), they check elapsed wall-clock and yield once it crosses ~6ms — about half a 60Hz frame. Yielding throws `AbortError` if the signal flipped during the yield, so an aborted run's tool body unwinds at the next yield without per-call bail-out code. Iteration-count chunking was rejected: 1K iterations of ~1μs work would yield every ~1ms, burning hundreds of ms of pure yield overhead on a 500K filter.

**Why time-based, not iteration-count.** Yield count should scale with wall-clock cost, not loop count. A heavy predicate (a chunked regex over a long entry) and a trivial predicate (a length check) take wildly different time per iteration; pinning yields to wall-clock keeps the yield rate sane across both. `filter` is implemented as a thin wrapper over `forEach` plus an accumulator — single source of yield/abort logic.

**Per-row spinner.** Each row gets a 100ms timer when its run begins; if it fires, the row gains `.tool-row-slow` (showing a spinner badge in place of the remove button) and the entries panel gains `.pipeline-running` (fading the result list to 0.55 opacity). The timer is cleared when the row's run ends or the pipeline aborts. Since today's tools all run synchronously and complete in a single tick, no timer fires — there is no visual flicker on current workloads. The machinery activates the moment a tool's run actually crosses the threshold.

**Test bridge.** `__grawlixTest.pipelineIdle()` resolves when no run is in flight; `getVisibleEntries` awaits it before reading the DOM so test assertions after a keystroke don't race a not-yet-finished refresh.

**Workers — considered and rejected.** Cooperative yielding covers what workers would have bought, without their cost. Yielding already keeps the main thread responsive between chunks — workers' core promise. There's no untrusted code to sandbox: custom JS tools (see [`plans/tools.md` § Open questions](plans/tools.md#open-questions)) run in the author's own browser, so a misbehaving tool only locks up its author. And worker bundling is awkward without a build step — the naïve "copy 500K entries every keystroke" shape serializes ~25 MB through structured clone each direction, likely slower than the main-thread compute it replaces; the viable shape (worker holds the wordlist) pulls a state-sync protocol into every mutation. Revisit only if a built-in tool surfaces whose work fundamentally can't fit the cooperative budget — bulk preprocessing where chunked yields can't hide enough latency.

### Pair-row display

Pair rows render `count len entry score · len entry score` with the relation glyph in its own pseudo-column between the two sides. Both sides reuse the same `--len-w` / `--entry-w` / `--score-w` CSS variables, so length and score columns align across pair rows even when the two sides differ in length.

**`justify-content: start` is load-bearing.** CSS Grid's default `normal` behaves as `stretch` on grid containers, which expands `auto` tracks to fill leftover space. Without explicit `start`, the central relation track balloons, pushing the b-side cluster to the right edge of the row. The fix replaces the implicit stretch with explicit start, parking leftover space at the row's right edge and leaving the pair naturally bunched against the a-side.

**Fixed-width relation track.** The relation column uses `var(--relation-w, 28px)`, not `auto`. Each grid container sizes its tracks independently, so `auto` measured the row's relation span (glyph + 12px padding ≈ 18–26px) and the header's empty `<span>` (0px) at different widths, drifting the b-side header labels left of the b-side row atoms. Pinning to 28px fits any single-char relation glyph plus its side-padding and keeps headers aligned with rows.

**`.atom-entry` stays default-stretched.** Pair-row atoms inherit the default `justify-self: stretch` from the grid item rules so they fill the entry-w track, letting `text-overflow: ellipsis` clip long entries. An explicit `justify-self: start` was tried as defensive cement for left-alignment but shrank the atom to content width, defeating the truncation and spilling long entries into the score column. The default `text-align: start` inside a stretched atom already produces the left-aligned text, so the override added bugs without adding behavior.

**Kind-aware headers.** Two header divs always live in the DOM — the words-mode `count entry len score [comment] [source]` row and the pair-mode `count len entry score · len entry score` row. The `tools-multi-word` body class (toggled by `ToolStack.refreshGalleryActive` when the last tool's output is `'pairs'`) decides which is visible. Mounting both up-front means kind flips via add/remove only need to toggle a class, not remount the chrome.

**Filter and aggregate semantics for pairs.**

- **Search** matches either side's `entryLower` against the pattern.
- **Score-range filter** uses `min(a.score, b.score)` — the row qualifies if its worst-scoring atom falls in range.
- **Stats bar** labels the count as `Pairs` instead of `Entries`. Min/max/mean/median/mode aggregate over flattened atoms (every wlEntry on either side of every visible pair), so a 60/40 pair contributes both 60 and 40 to the histogram and the average.

**Pair-side click resolution.** Each pair atom carries `data-side="a"` or `data-side="b"`. The scroller's click handler reads the side and opens the AtomPopover anchored to that specific wlEntry — clicking STRESSED in a DESSERTS · STRESSED pair edits STRESSED's score, not DESSERTS's.

### Sort axes per kind, with tiebreakers

Each output kind exposes its own axis set:

- **Words:** Entry, Length, Score.
- **Pairs:** Min score, Max score, Length, Alphabetical (by a-side).

Each axis carries `{label, primary, tiebreakers}` where `primary` is the value projection and `tiebreakers` is a fixed-direction chain. Flipping the user-level direction (asc/desc) reverses only the primary; tiebreakers keep their declared direction. Without a multi-column tiebreaker pass, sorting by score asc would let short low-scoring junk float to the top of a tied bucket — the tiebreakers ensure the most interesting entry surfaces first within ties (longer > shorter, higher score > lower), with alphabetical asc as the final stable fallback.

Defaults are kind-specific: words defaults to `entry asc`, pairs to `min-score desc` (worst-side caps pair quality; surfacing best-worst-case pairs first matches "what's worth fishing out"). The URL drops `sort=` when the current axis matches the kind default, so a pair URL stays minimal (`?semordnilap`) until the user picks something other than min-score-desc. Stack-driven kind changes snap the sort axis to the new default only when the prior axis was the *old* kind's default — an explicit user pick survives the kind flip as long as the axis is still valid (e.g. `length` stays through both kinds; `score` snaps to `min-score` because `score` is words-only).

`currentOutputKind(stack)` (the last run-bearing tool's output, or `'words'` for an empty stack) is what the Router and scroller both consult. It treats no-run rows as transparent, matching the executor's semantics.

### Highlights pipeline

Search hits and tool-emitted highlights share one renderer. `buildSearchPattern` exposes a `searchRanges(text)` function that returns `[{ start, end, kind: 'search:N' }]` records, one per matched non-wildcard segment (the `N` cycles through five color slots). Tools that want to mark characters inside a pair atom — Behead's struck-through first letter, Curtail's last letter, future `inserted`/`shifted`/`kept` kinds — emit `{ kind, start, end }` ranges on the corresponding side of each pair item (`highlights: { a: [...], b: [...] }`). `renderHighlightedText(text, ranges)` walks the merged-and-sorted range list once, emitting `<mark class="search-match search-match-N">` for `search:N` kinds and `<span class="hl-<kind>">` for tool kinds.

Tool ranges precede search ranges in the merged list so they win ties on shared starts (the more informative annotation — "this is the letter the pair dropped" — beats the search highlight when both apply to the same character). Overlap is resolved by skipping later ranges entirely; for the patterns these tools produce (search matches inside a multi-character substring, tool highlights on a single character at one end), strict overlap is rare and the simple precedence rule keeps the renderer linear.

The kind registry is open-ended — adding a new tool highlight kind is one (kind name, CSS rule) pair. `removed` is the only tool-emitted kind shipped today (line-through + 0.5 opacity); future kinds (`kept`, `inserted`, `shifted`, `matched`, `group:N`) land as tools start producing them.

Both `WorkshopEntriesScroller` and `LibraryEntriesScroller` route through the same `renderHighlightedText`. Library doesn't emit tool highlights, so it passes only the search ranges.

**Range positions are in display coordinates, not entryNorm.** A tool emitting a highlight should index into `wlEntry.entry` (which has the same length as the rendered `displayed` string), not `wlEntry.entryNorm`. For ASCII-letter-only entries the two coincide; for multi-word entries they diverge — `RUN AMOK`'s entry is 8 chars but its entryNorm is `runamok` (7 chars, no space). Curtail's "strike through the last letter" range is `[entry.length - 1, entry.length]` because the user perceives the last letter as the last visible character of `RUN AMOK`, which is `K` at index 7 — not `entryNorm`'s last char at index 6 (which would land on the space). The tool's matching logic still runs against entryNorm; only the rendered range is in entry-space.

## Entries table

The at-rest results display below the search bar. Renders the active wordlist (or merged `All` view) as one row per entry — same view whether idle or filtered. "Table" is meant loosely: rows are absolute-positioned divs in a virtual scroller, not a real `<table>`. Pseudo-column alignment via CSS Grid puts each atom in a fixed sub-slot so the eye reads down them as if they were columns. The label evolved with the feature — first a real spreadsheet-style table (sticky resizable headers, per-cell inline edit, hover info popover), then "word list" when that was pared down to a single column of atoms, now "entries table" again as columns, headers, and sorting grew back.

**Single column of word atoms.** Each row carries the same shape: a numbered position, the word, its length, and a score badge. The list is calm content; controls live in the search bar above.

This is the pattern modern productivity apps (Linear, Notion, Things, virtually every mobile app) have settled on. Two real losses vs. the earlier spreadsheet-style table, judged worth it:
- **2D reading.** A table lets you sort by one axis and visually scan another (sort by Min, eyeball Max). The list can't — switching axes is a sort-control click. In practice users sort by their primary axis and scroll; switching is rare.
- **Click-to-sort headers.** A spreadsheet convention; widely learned but not universal. The separate sort control is fast to learn.

What's gained: visual calm at rest, narrow widths come nearly for free (lists scale; real tables don't), bigger friendlier fonts become natural, and the at-rest UI stays one column wide. Nothing is in the chrome just to tabulate.

**Word atom: `1. CARE 4 50`** — count, word, length, score-badge. Length is to the right of word ([Wordlisted](https://aaronson.org/wordlisted/)'s layout), freeing the leftmost column for the count. The count makes scanning a long list legible and lets a user keep their place when slowly reading through. Count and length use the sans-serif font; word and score-badge use monospace so columns of letters and digits visually align.

**Pseudo-column alignment, fixed widths from data.** Each row is its own grid container with `grid-template-columns: var(--count-w) var(--entry-w) var(--len-w) var(--score-w)`. The four CSS variables are computed once per filter/sort pass from the entire result set: count digits, max entry length (capped at 20 chars; longer entries truncate with ellipsis + tooltip), max length-number digits, max score digits. They stay fixed across scroll. Picking widths from the visible rows would jitter under virtual scrolling; one outlier row would also blow out the layout for everyone else. Each row is independently grid-laid-out (because rows are absolute-positioned for virtual scrolling), so the variables must be uniform — `max-content` tracks would size per-row and break cross-row alignment.

**Score badges right-aligned within their column.** `justify-self: end` on the score atom pushes each badge to the right edge of the (uniform) score track; numbers' right digits line up across rows. The score column width is `calc(maxScoreDigits ch + 12px)` — the 12px covers the badge's 5px-each-side padding plus a small safety margin.

**Click targets are the entry and score atoms only.** `cursor: pointer` and the click handler both gate on `.atom-entry` or `.atom-score`. The count and length are read-only display; the row as a whole is not interactive. Cursor on the whole row would imply otherwise.

**Search highlight** marks pattern matches in the entry slot via `<mark>` spans, colored per capture group. Ellipsis truncation respects the markup.

**Sort control inside the search bar.** "Sort by [Entry ▾] [↑]" sits at the right edge of the search bar, after the score-range filter. An earlier draft had a dedicated thin toolbar above the table; that was replaced because the search bar's right-hand space was empty (the search input was flex-stretching to fill it) and consolidating saved a row of vertical space without crowding. Filter (search/whole-word/score) on the left, view-config (sort) on the right; same row.

The sort axis is a native `<select>` with `appearance: none` and a chevron painted via background-image — quiet inline text rather than bordered chrome. Direction is a borderless `↑`/`↓` button next to it. No persistent border or background; the controls flow inline with natural HTML whitespace between them. Sort axes: Entry (alphabetical by word), Length, Score. Default Entry ascending; Score defaults to descending when first selected.

**Click an atom → AtomPopover.** A click-driven popover anchored to the clicked atom (word or score). Content: a header line repeating the atom for context, a source block (which wordlist sourced the score, with rescore/override info or "Ignored by rescore rules"), score and comment text inputs, a "Saves to My Edits" footer, and a Delete button when the row is sourced from My Edits. Edits commit via Enter (commit + close) or blur (commit, popover stays open so you can tab to the next field); Escape reverts and closes. Click-outside, scroll, resize, search/filter/sort changes, and panel re-mount all close it.

The popover replaces both the previous in-cell `<input>` swap (score/comment edits) and the hover-only info tooltip (which explained rescoring and overrides). Comments and source moved off the at-rest list — comments are write-mostly in practice, and source matters only for investigation. Both are one click away in the popover when wanted.

**Re-render across edits keeps the popover open.** Edits flow through `_onCellEdit`, which routes to `upsertEdits` (non-Edits views) or directly mutates `rawEntries` (My Edits view), then triggers `_applyFilterAndSort(false)`. The scroller re-renders rows but doesn't close the popover, so chained edits (score → tab → comment) work. After re-render, the row matching the popover's active entry gets `.active` reapplied via `AtomPopover.rebindRow`.

**Virtual scrolling.** Rows are absolute-positioned inside a height-sized `.entries-table-rows` container; the scroller materializes only rows in the current viewport ± a buffer. Each row's `top` is `i * ROW_HEIGHT`. Cleaner than the previous real `<table>` with top/bottom spacer rows.

**Two scrollers, one base class.** `BaseVirtualScroller` owns the shared mechanics — sizer DOM, capture-mode window scroll listener, ResizeObserver, the visible-range math, destroy. `WorkshopEntriesScroller` extends it with the atom-grid render, AtomPopover binding, click-to-edit wiring, and the sort toolbar. `LibraryEntriesScroller` extends it with the monospace render, mode-aware `→` annotations, and live rescore-rule preview. The two scrollers diverge in everything the user sees — they share only the act of "render a window of rows into a sizer as the user scrolls."

## Help

The header `?` button is a deactivated placeholder — present so the slot doesn't disappear, but with a `not-allowed` cursor and no behavior. The previous slide-based welcome tour was removed because it described the pre-restructure UI and was high-maintenance for a userbase that doesn't yet exist. A replacement is planned in [`plans/help.md`](plans/help.md), to land once [`plans/tools.md`](plans/tools.md) settles.

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

Each user-added tool row gets one query parameter, in pipeline order:

- **With input:** `slug=value`. The slug is the tool's catalog key (lowercase: `anagram`, `subanagram`, `regex`, …). All values pass through `encodeURIComponent` — Grawlix's pattern syntax (`?`, `#`, `@`, `*`, `[`, `]`, `&`) overlaps with URL reserved characters and needs encoding.
- **Without input:** bare key, no `=` (`?palindrome`). `URLSearchParams` treats it as an empty-value entry, which round-trips.
- **Order is significant.** Parameter order is pipeline order — `?search=CAT&anagram=LINDSEY` runs Search before Anagram; the reverse runs them the other way. This breaks the convention that query strings are unordered, but the URL is mostly machine-generated and read back by Grawlix.
- **Repeated keys are fine.** Two regex rows become two `regex=` entries; their relative order is preserved.
- **Empty tool inputs are kept** (`?anagram=`) so a row the user added but hasn't filled in survives reload.
- **Empty Search drops out.** The UI invariant "always render a Search bar at the bottom" is applied after parsing — if the parsed pipeline doesn't end in a Search, the UI appends an empty one. The URL stays minimal in the 95% case (`?anagram=LINDSEY` doesn't carry a redundant trailing `&search=`).
- **Unknown tool keys are dropped** with a toast: *"That link references a tool that's no longer available."* The rest of the stack still renders.

### Sort encoding

Two keys carry the entries-table sort:

- `sort=<axis>` — depends on the active output kind. Words: `entry`, `length`, `score`. Pairs: `min-score`, `max-score`, `length`, `entry`. Dropped when the axis matches the kind's default (`entry` for words, `min-score` for pairs).
- `sort-dir=<asc|desc>` — dropped when the direction matches the axis's default. `entry` and `length` default to ascending; `score` / `min-score` / `max-score` default to descending (picking a score axis is "what are the best entries / best worst-case pairs?", which reads top-down).

The two-key form keeps each piece independently minimizable, so the common cases stay quiet — words `entry asc` is silent, pairs `min-score desc` is silent, `score desc` is just `sort=score`, `score asc` is `sort=score&sort-dir=asc`. `sort-dir` can appear without `sort` (e.g. words `entry desc` becomes `sort-dir=desc`); the parser treats an absent `sort` as the kind default.

Unknown values for either key are dropped without a toast (no churn risk — the axes are a closed set per kind, unlike the tool catalog). The parser accepts any axis valid in either kind; the scroller snaps to a per-kind default if the parsed axis isn't valid for the rendered kind. Sort persists across wordlist switches inside a session: it's a view-config preference of the user, not of the focused wordlist.

### Stable links: don't rename, don't remove

Once URL keys are public, removing or renaming them breaks shared links. The rule:

- **Don't remove tools.** A superseded tool stays as a thin alias to its replacement, or stays indefinitely.
- **Don't rename tool keys.** If a tool's display name changes, its URL key stays.
- **If a rename or removal is unavoidable**, register the old key in an alias table that maps to the new key (or to a sensible fallback) and `replaceState` to the canonical form on load.

No aliases exist today — this is forward-looking guidance for when the catalog churns.

### Router policies

- **Hash routes for views, query string for Workshop's state.** Hash routes (`#/library`) name top-level views without needing server-side path handling on GitHub Pages — `index.html` is served regardless of hash or query. Real paths (`/library`) would require the GitHub Pages 404-redirect SPA trick; the hash dodges it entirely. The earlier "no hash" policy held when there was a single view and the URL was state-only; with peers, the alternative was a `?view=library` parameter, which couples view identity to query state and gives Library a URL longer than Workshop's bare form for no compositional gain.
- **`replaceState` only.** Stack edits never push a history entry; the back button leaves Grawlix instead of navigating within. The visible UI is the user's history — clearing the search or popping a tool row is the explicit undo. A back button would be redundant or actively confusing ("did I lose my whole stack?").
- **URL for shareable state, localStorage for personal state.** Search pattern, whole-word, sort, and tool stack live entirely in the URL during a session — no localStorage shadow. They describe *what the sender is looking at*, which composes meaningfully on the recipient's setup. The score filter is the lone exception: it's stored in localStorage instead, because scores aren't portable across users and the filter is a standing preference. Rationale in *Out of scope for the URL* below.
- **Updates synchronously on every change.** Every caller — typing, structural toggles, sort changes — replaces the URL immediately. `replaceState` is cheap and browsers rewrite the URL bar without animation, so there's nothing to throttle. Debouncing would also leave the URL briefly behind the visible state, so copying or refreshing mid-keystroke could yield a stale link.

### Out of scope for the URL

These are local-only:

- **Score filter.** Stored in localStorage, not the URL. Two reasons, and the history matters because the filter has bounced between URL-bound and unbacked before — this is the written-down version so the question doesn't get re-relitigated.
  1. **Scores aren't portable across users.** What counts as `60` depends on which wordlists you have loaded and how you've rescored them. There is no universal scale — even the "common" tier labels (great / good / fair / …) are themselves per-user via My Edits' scoring. A shared `score=60` filter would apply the sender's number to the recipient's scale and produce nonsense. The other URL params don't have this problem: a search pattern, a whole-word toggle, a sort axis, and a tool stack all mean the same thing on any setup.
  2. **It's a standing preference, not a query.** The dominant use is "filter the low-scoring junk out so I'm not wading through it" — that's a setting the user wants in place every visit, not something they re-enter each load. URL-bound state resets to empty on a fresh visit (no link to apply); localStorage carries it forward.
- **Dialogs** (settings, Sync & backup) — transient UI state. Open them how you opened them; close them when you're done.
- **Library's focused wordlist** and its display mode — Library is wordlist-management workspace, not something a link should pre-position the recipient into.
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
| `wordlist._rescoredMap` | per-wordlist | `_rescored` (`entryLower` → wlEntry, for fast lookup) | `invalidateRescoredCache(wordlist)` |
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

**Lowercase keys throughout.** `_rescoredMap`, `_overrideMap`, and `_mergedWordlistCache.byEntry` are all keyed by `entryLower`. The key is the same string object as the wlEntry's `entryLower` field — Map keys share storage with the value's lowercase form, so construction allocates no extra strings and lookups never need a per-call `.toLowerCase()`. Anything that lookups against these caches (e.g. `patchCachesForEditsChange(entry, ...)`) takes its `entry` parameter in lowercase form.

**Hot path: switching wordlists.** First switch builds `_rescored` (lazy) and `_overrideMap` (lazy); subsequent switches are near-free.

**Hot path: editing rescore rules.** Commits go through `applyRescoreRulesChange(wordlist)`, which clears `_rescored` so the merged view picks up the new mapping. The set of distinct raw scores in the data — needed to compute `_uncovered` — does not depend on rules, so it lives on `wordlist._actualScores` and survives rule edits. The keystroke preview path also compiles rules once before handing them to the Library entries scroller, so the per-row `rescoreEntry` walk reads compiled intervals instead of re-parsing strings; for Broda-sized wordlists (~500K entries) that's millions of regex calls saved per keystroke.

**Hot path: editing My Edits.** Score and comment edits, new-entry adds, and deletes all flow through `patchCachesForEditsChange(entry, newEditsWlEntry)`. It mutates the affected `_overrideMap` entries and the matching slot in `_mergedWordlistCache.byEntry` instead of triggering a full rebuild. No `buildMergedWordlist` walks across all sources per keystroke.

The patch is structured around three observations:

- If a higher-priority wordlist also has `entry` (`buildOverrideMap(edits).has(entry)`), edits is overshadowed and never appears in any cache — nothing to patch.
- For ADD and UPDATE, edits becomes the contributor for `entry` in every override map below it; for the merged cache, an existing entry's `wordlist` reference is reassigned (with source-count adjustments) or a new entry is bisect-inserted into the sorted `entries` array.
- For DELETE, walk down from edits's position to find the next enabled wordlist with `entry` (using a lazily-built `wordlist._rescoredMap`). Override maps for positions ≤ next contributor's position drop the entry; positions below adopt next's value. The merged entry is reassigned to next, or removed if no contributor remains.

`_mergedWordlistCache` keeps a `byEntry` Map alongside `entries`; both share the same wlEntry objects, so patching via `byEntry` is visible in `entries`. The merged-view refresh chooses between in-place refilter and full rebuild depending on whether the patch reused the entries array. `refreshDerivedDisplays()` is the post-patch counterpart to `refreshSourceCounts()` — it repaints the rail meta and the scroller's score-atom tier tooltips without invalidating any caches.

**Hot path: typing in search.** Per-keystroke filtering is sized to avoid the two costs that dominate large wordlists — lowercasing the entry and re-sorting the filtered result. The caches involved are scroller-internal (not in the table above): they belong to the active `WorkshopEntriesScroller` / `LibraryEntriesScroller` instance and end with the scroller's life.

- Every `wlEntry` carries a precomputed `entryLower` field, assigned at parse and at every mutation path. Filters read `.entryLower` directly — no per-keystroke `.toLowerCase()` allocation across hundreds of thousands of entries. For merged-map entries and My Edits-edited entries, `entry` and `entryLower` are assigned from one variable, so both fields point at the same string object and the field costs one property slot, not a fresh allocation. For source wordlists with uppercase entries (e.g. Broda), the lowercase form is a fresh string allocated once at parse.
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
- **Cosmetic effect** reads `sources$` and every wordlist's `name$`/`icon$`/`url$`/`publisherId$`. Any cosmetic change re-renders the Library list and (since the merged scroller has a per-row source column) the visible Workshop scroller rows. No cache touched — cache entries hold wordlist refs and read names live.

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
