# Design

The shape of Grawlix's UI and the architectural choices behind it.
Each section describes both what the user sees (labels, defaults, keys, edge cases) and why it is built that way — what alternatives were rejected, what constraints shape things — plus the architectural surfaces a contributor needs to orient.

Subsystems with enough design to stand alone have their own docs, which hold their user-visible behavior and their whys in the same way, and this one defers to them: [`wordlists.md`](wordlists.md) (wordlist data and management), [`entry-panel.md`](entry-panel.md), [`pipeline.md`](pipeline.md) (how a tool stack runs), [`segmenter.md`](segmenter.md), [`umiaq.md`](umiaq.md), [`tools.md`](tools.md) (the tool catalog), and [`worker-protocol.md`](worker-protocol.md).
As plans ship, the `distill-design-doc` skill folds them into this file or the subsystem doc that owns the area.

## Workspace and sidekick

Constructors use Grawlix in two modes that share one UI:

- **Workspace** — typical during theme generation.
  The user lives in Grawlix: plays with tools, searches and filters the wordlist, grooms My Edits.
  Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire, Ingrid, Crossword Compiler, Crosserville).
  The user pops over to look something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary.
The workspace-leaning design accommodates sidekick mode for free as long as load is fast and chrome isn't loud — sidekick is just "brief use, leave."

Entry lookups (Wiktionary definitions, Wikipedia, and thesaurus inline, plus link-outs to Google, OneLook, XWord Info, Crosserville, and Puzzmo) are differentially valuable to constructors using grid software without built-in lookup.
Crossfire and Crossword Compiler are the populations that benefit most; Ingrid has Google integration and Crosserville has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord), where a constructor wants to act on an idea before it evaporates.
It runs the same UI as desktop, responsively narrowed — no control is recomposed for mobile, only narrowed.
The one exception is overlays.
Below 760px, modal dialogs dock to the bottom as full-width sheets that slide up (a `@starting-style`/`allow-discrete` transition, disabled under reduced-motion), because a centered dialog at its fixed pixel width overflows a phone.
The entry panel is its own responsive case ([`entry-panel.md`](entry-panel.md) § *Opening and closing*): a fixed-width column floating over the table's right edge on wide viewports, and below ~1000px a full-screen overlay.
Both shells slide in from the right (a `@starting-style`/`transform` transition, disabled under reduced-motion) and are dismissed by the browser Back gesture/button (it parks a history entry while open — [`entry-panel.md`](entry-panel.md) § *Opening and closing*).
Both are positioned entirely in CSS — no cell anchoring, no inline coordinates — so the surface holds still while you type.

## The shell

**Everything stays in the browser.**
There is no account, no login, and no server-side storage: wordlists, edits, and settings live in the browser's localStorage and IndexedDB on that device.

**The whole document scrolls.**
The brand header, the screen, and everything in it share one document-level scroll — no nested scroll container.
The header and the wordlist bar scroll away with the page; the screen fills the full content width below them.
As the user scrolls into the entries table, a sticky region (tool stack → stats bar → entry headers, the search bar being the tool stack's last row) pins to the top of the viewport — the only chrome that pins, so a phone keeps most of its height for entries.
One scrollbar, the document's.

`html` carries `overflow-y: scroll` to keep the scrollbar gutter present whether or not content overflows, so a short result set (no scrollbar) and a tall one (scrollbar) lay out at the same width — the page doesn't jump horizontally as filtering grows or shrinks the list.
On mobile the scrollbars are overlay-drawn and reserve no space, so the declaration is inert there — which is fine, since the shift it prevents only happens with classic desktop scrollbars.

A scoped scroll container — a centered, max-width card inside a viewport-height `<main>` that owns the only scrollbar — behaves badly on mobile: it kills pull-to-refresh, and pinch-zoom leaves the pinned header chrome stranded off-screen.
So the app uses a plain document scroll with a full-bleed screen.

**Header is brand chrome only.**
Wordmark on the left, the personal text (the byline, whose name links to email, plus GitHub) in the center, settings/help on the right.
Per-wordlist state, sync indicators, and wordlist pickers stay out — those would tie the header to ephemeral state, and they have their own home on the wordlist bar below.
There is no top-level navigation, because there are no top-level views to navigate between: Grawlix is one screen, and the personal text sits in the brand row's center where nav would otherwise go.

**Settings.**
The header gear opens the **Settings** dialog (`ui/dialogs/settings.js`), one row per setting:

- **Dark mode** — a segmented **Auto** / **☀ Light** / **☽ Dark** control, stored in the standalone `darkMode` localStorage key (default `auto`).
  Auto follows `prefers-color-scheme` and re-applies live when the OS setting flips.
  Alt-M cycles the three from anywhere and confirms with a toast (`Dark mode: Light`).
- **Auto-update wordlists** — [`wordlists.md`](wordlists.md) § *Fetching & updates*.
- **Trash score** — a non-negative number, default 0 (`DEFAULT_TRASH_SCORE`), sub-labelled *Score given to deleted and unlisted entries*.
  It scores the downscore a norm-changing rename leaves behind ([`entry-panel.md`](entry-panel.md) § *Editing*), a coined Replace entry in a wordlist download ([`pipeline.md`](pipeline.md) § *The chain-row model*), and sets the default score filter one above it ([`wordlists.md`](wordlists.md) § *Scope: the selected wordlist is the corpus*).
- **Output format** — [`wordlists.md`](wordlists.md) § *Output format*.
- **Reset browser data** — a **Reset** button that, behind a confirm, wipes Grawlix's localStorage keys and IndexedDB and reloads (`resetAllDataAndReload`).

**The wordmark is the start-over button.**
It's a real `<a>` pointing at the bare URL — the affordance every site trains you to expect — but a plain click doesn't reload.
`resetView` clears the query string, re-runs `Router.applyURL()` over the now-bare URL, re-renders the panel, and scrolls to the top: the same end state a reload reaches, without re-reading IndexedDB and rebuilding the worker's corpus.
Re-applying the empty URL rather than hand-clearing the stack and sort keeps one definition of "default state" — the boot path's.
Only URL state resets; scope and score filter are localStorage, so they survive exactly as they would across a reload (§ *Out of scope for the URL*).
The `href` stays real so ⌘-click and middle-click still open a clean app, and modified clicks are passed through untouched.

**One screen — the selected wordlist is the corpus.**
A single screen: wordlist bar, tool gallery, then the sticky region (tool stack → stats bar → entry headers) over the entries table.
`state.selected` — either `MERGED_ID` (the merged `All Wordlists` view) or one source wordlist — names *what the user is looking at*, and the entries table, the tool pipeline, the stats bar, and the histogram all reflect it.
Selecting `All Wordlists` is the merged view and the 95% case; selecting a source scopes everything to that source.
The data model underneath is untouched (merge, rescore, pipeline, caches, disk sync) — the screen is a composition of the view layer plus one new capability, scoping.
The keystone — *scope, not filter* — and the editing model that follows from it are the subject of [`wordlists.md`](wordlists.md) § *Scope: the selected wordlist is the corpus*.

Per-wordlist scope is the organizing idea, and it's the load-bearing reason the wordlist picker is just a dropdown on the bar: scope is a selection, not a place to navigate to, so the picker needs no UI region of its own.
Filtering tools by wordlist, sorting and editing a single wordlist's entries, and viewing the merge are then all the same screen with a different selection.

**Tool gallery** sits as a top section of the screen.
At rest it's a compact strip of featured tools; the full catalog expands into a drawer on demand (see *Tool gallery & stack* below for its layout).
Discoverability is preserved — tools are one click from every entry — without the whole catalog eating vertical space every session.
Tool catalog and chaining are owned by [`planned/tools.md`](planned/tools.md).

**Stats bar always renders, even for empty wordlists** — a zero entries count and a flat histogram baseline.
Uniformity over an "empty placeholder" treatment.

**Score ranges come from data, never from code.**
Wordlist scoring conventions vary widely — 0–100, 0–60, 1–10, 200–2000, even negative numbers.
Anything that depends on a min or max — histogram bins, score colors, filter ranges — derives them from the rescored entries actually present in the merged set.
This applies to the empty-data path too: when nothing has loaded, the range is *unknown*, not a hardcoded default.
Stamping in `0–100` or `0–60` as a fallback is a recurring source of the same bug — it works in testing and quietly misrepresents anyone whose scores sit elsewhere.

**Table is always visible**, even at idle with no search active.
The idle and search views are *the same view, just filtered*; live keystroke-to-result feedback depends on continuity.
Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat).
Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Landing: `All Wordlists` on first run, last scope thereafter.**
The four publisher wordlists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about wordlist management.
`state.selected` is sticky ([`wordlists.md`](wordlists.md) § *Scope: the selected wordlist is the corpus*) — a returning user reopens to whatever they were last looking at; only a fresh user, or one whose last scope has vanished, lands on `All Wordlists`.

**Sticky region: tool stack → stats bar → entry headers.**
Three pinned bands, in pipeline-output order: the stack the user is editing, the readout describing its output, and the column headers labelling the rows.
The tool stack always ends with the permanent search bar as its last row, and shows just that bar before the user adds a tool, so Grawlix with no tools looks like a plain search box — see *Tool gallery & stack* below.

**One bar, one story.**
The stats bar carries the counts, the score-range control paired with its histogram, the length filter, and the Share control.
The count describes the score-range-filtered output; the histogram projects the unfiltered pipeline output with the bracket overlaid, so dragging the range narrower shows what's being trimmed instead of bars disappearing past the bracket.
The histogram sits *between* the counts and the score box: it's stats about the entries on one side and the filter's visual twin on the other, so the middle is where it belongs, with the exact control (the box) and the visual one (the histogram) adjacent.
Left → right: `Entries N   Groups N` · `histogram + Scores [range] + Lengths [range]` · `Share ▾`.
**Entries** counts what reached the end of the pipeline: chain rows on a flat pipeline, surviving member chains across every visible group with a tool in all-mode, where **Groups** rides alongside.
A tuple search (Umiaq with a `;`, Weave) reads **Results** instead, with a trailing `+` and a *Results incomplete* tooltip when the tool hit its result cap.
Clicking a histogram bar sets the score range to that bar's bin, and dragging across bars sets the span they cover; clicking a bar already inside the current range clears the filter.
The two filter boxes are load-bearing and always hold; when the bar would overflow the histogram collapses first, then the counts.
Both share the `.range-filter` class, which is what the overflow guard measures — a filter box added without it silently overlaps the Share control instead of triggering the collapse.
On a phone the histogram is the price of the second box — a second filter's width moves the collapse threshold up, so it sheds at a wider window than it would with one box.
No exact figure is recorded here on purpose: it shifts with any padding or box-width tweak, and `stats-bar-layout.spec.js` pins the ordering (histogram sheds, then the counts; the filter boxes never do) rather than a number, for the same reason.
Sorting lives on the column headers below, not in this bar — see [`pipeline.md`](pipeline.md) § *Sort axes per tier*.

**No side panel.**
The tool gallery sits as a top section of the screen, and disk sync's signals live where the scoped list lives — the sync button in the wordlist bar (see [`wordlists.md`](wordlists.md) § *Disk sync* below) — rather than in the global chrome.
A collapsible side panel was considered and rejected: it would pull these surfaces off the main vertical flow into a persistent secondary region, working against the single-screen layout.

**Installable as a PWA.**
A web app manifest (`site/manifest.webmanifest`) plus icons (`site/icons/`) and a `theme-color` make Grawlix installable through the browser's own install affordance (the address-bar install icon, "Add to Home Screen", etc.) — there is no in-app install button.
No service worker: Grawlix is online-only by choice, which trades offline support for a much smaller blast radius — it sidesteps the failure mode where a stale cached service worker bricks installed users after a deploy.

**Mechanics worth knowing:**

- The screen uses `overflow: clip`, not `overflow: hidden`.
  The latter establishes a scroll container that breaks `position: sticky` for descendants, trapping the sticky region.
  `overflow: clip` contains stray child overflow without that side effect.
- The sticky region's layers offset from each other by published heights (`--tool-stack-h`, `--stats-bar-h`, and the whole stack's `--sticky-stack-h`, re-measured by a ResizeObserver), which the entries table also uses to keep a keyboard-scrolled row out from under the stack.
- The virtual scroller listens for `scroll` events in **capture mode** on `window`, computes its visible slice from the host's `getBoundingClientRect()` against `window.innerHeight`, and slices a window of rows out of a full-height sizer.
  Capture is required because scroll events don't bubble.
  The math is viewport-relative and works directly against the document scroll.

## Keyboard shortcuts

The global shortcuts:

- **Ctrl/Cmd+F** — find in the entries table (§ *Find in page*).
- **Alt-T**, or **Ctrl/Cmd+K** — open the tool picker.
- **Alt-S** — focus the permanent search bar's pattern.
- **Alt-W** — toggle the match-mode checkbox of the focused Search, Regex, or Phone search row, else the permanent search bar's (§ *Match modes*).
- **Alt-C** — focus the score-range box.
- **Alt-L** — focus the length box, unless it's disabled for a tuple tool ([`pipeline.md`](pipeline.md) § *Length filter*).
- **Alt-A** — add an entry, same as the floating **+** button: a blank entry panel that saves into My Edits; inert while the panel is already open.
- **Alt-↑ / Alt-↓** — walk to the previous / next entry with the entry panel open, saving the current edit ([`entry-panel.md`](entry-panel.md) § *Walking a set*); with it closed, they move the table cursor like the plain arrows.
- **Alt-M** — cycle dark mode (§ *Settings*).
- **Alt-0 … Alt-9** — retier a score in All Wordlists or My Edits: the open tier picker's entry, else the selected rows; Alt-0 is the lowest tier.
  In the entry panel it fills the Score field without saving (§ *The score cell is a tier quick-pick*).

The Alt shortcuts live in one document `keydown` handler in `bindEvents` (`app/actions.js`), except Alt-T, which `ToolStack` owns.
They match `e.code`, not `e.key`, because macOS Option turns `e.key` into a symbol (Option-S is `ß`).
The entries table's own keys (arrows, Shift/Ctrl selection, Space, Enter, Esc, Delete) are in § *Keyboard navigation & multi-select*.

## Wordlists & setup

Wordlist data and its management — scope, the wordlist bar and manage panel, the rescore editor, rich entries, disk sync, output format, fetching and updates, and rescore rules — have their own doc, [`wordlists.md`](wordlists.md).
The entry panel, which edits single entries across wordlists, is in [`entry-panel.md`](entry-panel.md).

## Tool gallery & stack

Tools live in two places: a persistent **gallery** as a top section of the screen, and a **tool stack** inside the sticky region that pins to the top of the viewport.
The gallery is browseable; the stack is the user's current pipeline.
The chrome and the pipeline runtime are shipped; the tool catalog — which tools are shipped, which are planned, with their cards' icon, name, description, and example — lives in [`tools.md`](tools.md).
Chaining extensions and other planned gallery work are tracked in [`planned/tools.md`](planned/tools.md).
Tool output lands in the entries table (§ Entries table) as **chain rows** ([`pipeline.md`](pipeline.md) § *The chain-row model*) — or, with a group tool in the stack, as **group rows** ([`pipeline.md`](pipeline.md) § *The group-row model*).

**Single catalog drives every surface.**
Each tool is one record in `TOOLS` (`name`, `icon`, `category`, `desc`, `example`, `params`, `kind`, `input`, `output`, a `run` for filter/transform tools or a `group` for group tools, optional `glyph` / `findReplace` / `replaceName` / `prepare`); gallery section ordering comes from a parallel `TOOL_CATEGORIES` list.
Gallery cards, stack-row labels, and the search bar's `Search` label all render the inline icon-and-name pair through the shared `buildToolLabelHTML` helper.
Adding a tool means adding one entry — every surface that names tools picks it up — and the helper guarantees the icon-and-name pair looks identical wherever it appears.

**Clicking a gallery card appends that tool** to the end of the user stack — one click target, the whole card.
The first click on an empty stack starts a one-tool pipeline; each later click chains another tool onto the end.
To swap tools, remove a row via its `✕` and click a fresh card.

**Gallery layout — a packed flow of category spines.**
The full catalog lives in a drawer that expands from the featured strip (at rest: a handful of featured tools plus a `+N more` tile; the tile, the tool search, or `Alt-T` opens it).
Inside, cards pack wall-to-wall as a wrapping flex flow rather than a grid of full-width category sections — the old layout spent a label row plus a half-empty card row on every category, waste that only compounds as the catalog grows toward ~50 tools.
Each category's run opens with a vertical **spine** (`.gallery-cat-chip`): a color pill standing a card tall, its name reading bottom-to-top (`writing-mode: vertical-rl` plus a 180° turn — the universally-supported way to get upward-reading text, where `sideways-lr` is Firefox-only).
Cards stay neutral; an earlier pass tinting every card by category read as a rainbow, so the color lives on the spine alone.
Spine colors are the **shared highlight palette** (`--hl0..8`), the same nine the search-match marks cycle through (retuning a hue moves both surfaces).
A category takes its color by position — `hl-cat-${i % HL_COLORS}` over `TOOL_CATEGORIES`, so reordering or adding a category reassigns colors with no per-category CSS — and because the palette isn't in spectral order, neighbors hop disjointly around the wheel like cycling search hits instead of blending into a gradient.
Each spine is bound to its first card inside a `.gallery-cat-group` so a wrap can never strand it alone at a row's end.
Cards are **fixed-width**, not flex-grown: grow-to-fill only earns a flush right edge in the narrow band where the per-card width beats the cap, which it rarely does, so fixed width gives the same look with perfectly uniform widths.
Categories are separated by a *trailing* margin on whatever precedes a group (`:has(+ .gallery-cat-group)`) — a seam that widens mid-row and collapses to harmless slack when a category wraps to a row's start, where a leading margin would instead indent the wrapped group.

**The search bar is always present; user tools sit above it.**
`#tool-stack` always exists, holding at least the permanent Search bar as its last row.
Before the user adds a tool the stack is just the bar — which looks exactly like a standalone search bar.
Adding the first tool inserts a row above the bar.

**Search is a tool.**
The search bar *is* a `search` row — the permanent last row of `ToolStack`'s stack, and so the permanent last step of every pipeline.
`ToolStack` keeps the invariant that the stack always ends with a Search row; that row is undeletable (no remove button) and renders with its own `.search-bar` chrome instead of the plain `.tool-row` layout.
Both `.tool-row` and `.search-bar` are flat CSS grids with the same shape — drag handle, label, `.tool-row-main` (the row's center cell), and an asides slot — so the line-1 controls vertically center against each other and a row-2 replace input opens cleanly below them; see *The find/replace widget*.
The search bar holds nothing but the search inputs: pattern, the match-mode control, and (when expanded) the replace input.
Score range and sort are view-config and live in the stats bar below, not on the search row.
The pattern, replace, and match-mode state live in that row's `params`, like any tool row.
`search` is also a normal gallery card, so a user can add extra Search rows above the bar.
Search has no special-case input builder: every Search surface — the permanent bar and gallery-added Search rows — draws its inputs through `buildToolRowPartsHTML` / `buildParamHTML`, the one generic renderer every tool's params use, wired by delegated `data-row`/`data-key`.
Search carries a `replace` param like Regex (see *The find/replace widget*), so a Search row expands from a filter into a search-and-replace transform.
Folding search into the pipeline — rather than running it as a scroller-side filter outside the stack — makes it compose like any tool and lets the unification pass see search highlights ([`pipeline.md`](pipeline.md) § *Symmetric unification*).

**Search syntax.**
A Search pattern is letters plus five wildcards: `?` any letter or digit, `#` a consonant, `@` a vowel, `*` any substring, and a class `[abc]` / `[^abc]` / `[a-m]` (`[0-9]` too).
Every pattern runs against an entry both as written and as its letters alone, matching if either does, so `theirs` finds `the IRS` while a typed `co-op` finds only `co-op`; a `?` counts grid squares, never a separator ([`wordlists.md`](wordlists.md) § *Dual-arm search*).
Focusing the pattern pops the wildcard cheat sheet (§ *Cheat-sheet popovers are a per-param opt-in*).

**Match modes.**
Unchecked, a pattern matches anywhere in an entry; checked, the mode picker offers **Whole entry**, **Starts entry** (`cat` matches `cats`, not `scat`), **Ends entry** (the reverse), **Whole word** (`cat` matches `cat` and `cat food`, not `copycat`), and **Spans words** (`heir` matches `the IRS`, not `theirs`).
Clicking the mode name toggles the constraint, the arrow beside it opens the picker, and picking a mode turns the checkbox on.
On a run-together list the first search in a word-relative mode pauses a few seconds while every unspaced entry is read; later searches reuse the readings.
Offline, before the segmenter's corpus has been fetched, a run-together entry counts as one word.

Search and Regex carry one `mode` param (`MATCH_PARAM`, `tools/shared.js`) that constrains where a match sits relative to the entry's words: absent (anywhere), `full` (whole entry — the anchored `^…$` wrap), `start`/`end` (anchored at one end — `^…` or `…$`), `word` (whole words — the match's first letter starts a word and its last letter ends one, possibly covering *several* complete words so a norm-arm query can match an exact phrase), or `span` (spans words — the match's letters straddle a break, the hidden-theme hunt: `heir` finds `the IRS`).
A **word break is whitespace or a hyphen; an apostrophe or period is not** (`isn't` is one word) — the policy lives in `WORD_BREAK_RE` (`engine/norm.js`) beside `wordBreaks`, which answers an entry's breaks as norm offsets, and the two predicates over them, `isWholeWords` and `spansWords`.
A display-coordinate match is projected onto the norm first (`displayRangeToNorm`), so both gates run in one coordinate space; the projection counts letters, which drops a separator at either edge (a `\s` a regex extends onto a space) rather than letting a one-word match that touches a break count as spanning.
**A run-together entry reads its breaks from the spacing table** ([`segmenter.md`](segmenter.md) § *The spacing table*): `wordBreaks` takes a `SpacingReader` and, for a display with no break of its own, uses the reader's `best` reading — the reading Space out's One shows and Initialisms keys on — so `at` spans `DATATABLE` and `cat` is a whole word in `catfood` on a bare list exactly as they would be on a spaced one.
It is `best`, not Rhymes' `guess`: the gates exist to reproduce authored spacing, and the compound tier answers a different question (how to split a word that is one word), which would make `roll` a whole word in `rickroll` on a bare list but not on a spaced one.
Authored spacing always wins: an entry written with a space or hyphen is never re-read, since the guess can disagree with it and a gate built on the guess would contradict the spacing on the row.
Search and Regex build the table in `prepare` whenever a word-relative mode is on (`matchModeSpacing`, `tools/shared.js`) — eagerly, because a short pattern's candidates run to hundreds of thousands and reading each on the spot would cost seconds per keystroke; Hidden anagram reads on demand, since its anagram window leaves few candidates.
All three declare the unigram asset only while such a mode is on (`assets` is a function of params, read through `toolAssets`), because the Search bar never leaves the stack and a flat declaration would pin the corpus for the session; the worker reaps assets whenever the *set* its stack needs changes, so the bar's mode toggling frees and reloads the corpus like any other row.
Each declares a sync `replay` ([`pipeline.md`](pipeline.md) § *A highlight re-derived at render time gets a `ctx`*), since its `prepare` is async.
`matchModeOk` reads an entry's breaks on its first match rather than up front, so an entry the pattern rejects never costs a table lookup, and a spanning candidate shorter than two letters is rejected before the lookup.
`full`, `start`, and `end` are anchors on the compiled regex (`anchorPattern`, `engine/search.js`, non-capturing so Regex's `$N` backrefs keep their numbers); `word`/`span` are **per-match gates** (`matchModeOk`, `engine/search.js`) applied wherever matches are iterated — the Search matcher's dual arms, `regexExecAll`, and `execMatches` for replace mode, where only gate-passing matches are rewritten (an entry whose every match fails the gate drops).
One subtlety is load-bearing: when a gate rejects a match the scan resumes from **one past the match's start**, not its end, because an accepted match can overlap the rejected one (`at.` on `data table`: the rejected `ata` at 1–4 hides the spanning `ata` at 3–6).
Highlights show only gate-passing matches.
In the UI the param renders as a split control (`.tool-row-match`): a checkbox-plus-label toggle (`.match-mode-toggle`, reading Whole entry / Starts entry / Ends entry / Whole word / Spans words) sits beside a caret button (`.match-mode-arrow`) that opens the mode menu — the overflow-menu convention where the body performs the primary action and only the caret reveals the options.
Clicking the label toggles on/off (it's a native `<label>` over the checkbox; Alt-W toggles it too); clicking the caret opens the menu (`MatchModeMenu`, a body-parented `.split-btn-menu` singleton positioned by `positionPopover` under the whole control rather than an in-row dropdown, because `.tool-row` clips overflow).
Picking a mode auto-checks the box, and unchecking leaves the wrapper's `data-mode` and label in place as the memory of what re-checking will enable — the displayed mode is the single source of truth, so the shown and applied modes can't diverge.
The URL key is `mode=full|start|end|word|span`, absent when off; the retired `whole-word` bare key decodes as `mode=full` (an alias kept per § *Stable links*) and re-encodes as the modern key.
**Hidden anagram** takes just the spanning constraint as a standalone `Spans words` checkbox — anywhere/spanning are its only meaningful extents (a whole-entry anagram is the Anagrams tool), and its window scan keeps sliding past non-spanning hits, so a later spanning window still matches.
Its param shares the `mode` key (a value-carrying checkbox, `mode=span` in the URL; any other mode value decodes as off), so growing it into the full mode menu later won't break links.

`rerenderRows` rebuilds only the user tool rows on a stack mutation, leaving the Search bar's DOM untouched — so its input focus survives an add/remove.
A full re-render (`mountPanel`) does rebuild the bar.

**The find/replace widget.**
A tool flagged `findReplace: true` — Search, Regex, and Phone search — splits its `pattern` and `replace` inputs across the tool row's two grid rows.
Row 1 carries the pattern input with a caret button to its left (both inside `.tool-row-main`, the row's center cell), vertically centered alongside the drag handle, label, match-mode control, and remove X. Row 2 carries the replace input as a `.tool-row-replace` cell in the same grid column as `.tool-row-main`, hidden until the caret expands — so the replace input lines up directly under the pattern while the row-1 controls stay pinned to row 1 instead of centering between the two lines.
Same layout at every width — no side-by-side, no breakpoint.
Expansion is the presence of the `replace` param (`isReplacing`, `tools/shared.js`): the caret adds the key when it opens — seeded from whatever the hidden input holds, empty included — and deletes it when it closes, so a shared link carrying a replacement opens already expanded.
All three are filter/transform hybrids keyed on that presence — `kind: params => isReplacing(params) ? 'transform' : 'filter'` — so an open, empty replace field is **delete mode**: the match is cut out of the entry.
The row's label reads **Replace** (**Phone replace** for Phone search) while the field is open — `row.name()` picks the catalog record's `replaceName` the way a reversible tool's picks `reverseName`, and the caret handler rewrites the name span in place rather than re-rendering the row, which would rebuild the hidden replace input and lose its kept text.
Presence is the test because a blank field's text can't say whether it was ever opened; the caret is what tells a deletion from a plain filter.
The URL carries the empty form as a bare `replace=` (the param's `encodeEmpty` flag — the encoder drops every other empty value), so delete mode survives a reload or a share.
Every caret toggle flips the row's kind, so every toggle re-runs the pipeline and rewrites the URL.
Collapsing drops `params.replace` — a collapsed row is always a pure filter — but the replace `<input>` is hidden, not destroyed, so re-expanding restores its text.
A deletion that empties the entry emits nothing (`runReplace` drops an empty output norm), so `*` in delete mode can't coin blank entries under **Allow unlisted**.
Inputs are placeholder-labelled, not `<label>`-prefixed.
The shared renderer (`buildToolRowPartsHTML` → `buildParamHTML`) packs each row's text inputs, number inputs, and checkbox asides into one `.tool-row-main` flex cell; `findReplace` just emits the extra `.tool-row-replace` child, and the surrounding tool-row grid is what makes row 2 first-class.

**The Rebus pair list.**
Rebus is the catalog's first **synthetic-emitting** transform — it produces symbol forms (`BARSTOOL → BARSⓉ`) that exist in no wordlist, so unlike Search/Regex replace it skips the `norms` existence check and emits `[entry]` tuples (just the text); the executor's synthetic-atom path gives the output a live getter onto the input entry's score.
Its `string` input is a **literal**, normalized through `toNorm` and matched case-insensitively on both norm and display, then projected back onto the display so the output keeps the entry's case and spacing; every active string→symbol pair is applied at once into a single output.
Wildcards were supported and removed: they let the replaced letters vary per entry, which is only legible while the input atom is on screen, and the input carries nothing else — you typed the string being replaced.
Hiding it (`input: 'hidden'`) is what made the flexibility a liability, and the general lesson is that capability nobody validated becomes a constraint that outlives its usefulness.
The user-visible tool is in § *Rebus*.
Its UI is the catalog's first use of **repeatable params** (`repeat: true`): `string` and `symbol` are parallel arrays rendered by `buildPairListHTML` as a vertical stack of `[string] → [symbol]` pair rows; once there are two, every row carries an inline `×`, and the last row carries the inline `+` (where the eye lands when the rows run out).
The `symbol` box opens `SymbolSuggest` — a body-parented popover sharing `PopupHelp`'s on-screen `positionPopover` — on focus, inserting a circled letter, circled digit, or symbol on click.
The pair-list branch short-circuits `buildToolRowPartsHTML` (`params.some(p => p.repeat)`), so the generic renderer is untouched.

**Tool rows are drag-reorderable.**
Each user tool row carries a drag handle (`buildDragHandleHTML`, the same `≡` affordance wordlist cards use); dragging it reorders the row within the user portion of the stack via `reorderAt`.
The handle itself is the drag source — not the whole row — so a drag begun inside a param input still selects text.
The permanent Search bar isn't draggable: it carries a hidden placeholder handle (`aria-hidden`, `visibility: hidden`) so its `Search` label still lines up with the tool labels above it, and `reorderAt` clamps both indices out of the bar's slot so it stays pinned as the last row.

**A Search row can drop *below* the bar — and only a Search row.**
The invariant that keeps the bar permanent is "the last row is a Search row," not "this particular row is the bar," so dragging one Search row below another is fine: the dropped Search row becomes the new last row (and so the new bar, picking up `.search-bar` chrome), while the displaced old bar lands in the user portion as a plain Search tool row.
Any non-Search tool is still held above the bar.
The bar joins the drag's *drop targets* (`itemSelector` gains `.search-bar`) without becoming a drag source — its handle stays `aria-hidden` — and `makeReorderable`'s optional `canDrop(fromEl, beforeEl)` veto suppresses the below-bar drop line for everything but a Search row.
The commit (`moveBelowBar`) splices the row to the stack's end and rebuilds the whole stack via `rerenderAll` — not `rerenderRows`, which preserves the bar's DOM in place and so would leave the displaced bar stale and duplicated.
Because the move is a real array reorder, it round-trips through the URL like any other (`search=&search=foo` — see § *URL state*).

**Cheat-sheet popovers are a per-param opt-in.**
A tool param declares an optional `help` HTML string on its schema; `buildHelpHTML` produces the standard markup — a `<kbd>`-and-description grid plus an optional footer link — but `help` accepts any HTML.
At load time `PARAM_HELP` is built from every param that declares `help`, keyed `toolKey/paramKey`.
`buildParamHTML` emits a matching `data-help` attribute for any param that declares `help`, and `attachHelpPopups` binds a `PopupHelp` popover to *every* `data-help` input found by a document-wide scan, resolving its content through `PARAM_HELP`.
It runs whenever the panel re-renders and an anchor may have been rebuilt — `mountPanel` and `rerenderRows` — destroying the prior popovers and rebinding from scratch each time.
Search's `pattern` param carries the wildcard cheat sheet; Regex's `pattern` and `replace` params carry regex-syntax sheets (no cheat sheet covers all of regex, so both link out to regexone.com).
Several **non-tool inputs** ride the same mechanism: the stats-bar score-range filter (`data-help="filter/score"`) and the rescore/scoring rule fields (`rule/score`, `rule/length`, `rule/output`).
`PARAM_HELP` carries their content keyed to match each input builder's emitted `data-help` — `SCORE_RANGE_HELP` and `LENGTH_HELP` live beside `parseRange` (the parser whose `n` / `lo-hi` / `lo+` syntax they document), `OUTPUT_HELP` in `rescore.js`.
The rescore editor isn't reached by `mountPanel`/`rerenderRows`, so `renderEditorContent` calls `attachHelpPopups` itself after writing the field DOM.
Each input keeps a short `title` — a field label, or the filter's `Alt-C` shortcut — and leaves the syntax to the cheat sheet, exactly as the search bar pairs its cheat sheet with a `Search (Alt-S)` title.
The popover is interactive — a `mousedown`-preventDefault keeps the anchored input focused — so a click on the footer link lands instead of blurring the input and dismissing the popover first.

**Hovering a gallery card shows an insertion cursor.**
A `.tool-stack-cursor` — an accent caret-and-line — appears at the seam where the click will drop the new tool: between the last user tool row and the permanent Search bar, or at the top of the stack when there are no user tools yet.
It's parented in the Search bar, absolutely positioned so it adds no height, and removed on mouseleave.
A freshly added row gets a one-shot `.flash` accent pulse; `rerenderRows` rebuilds the user rows on every mutation, so the new row's element is always fresh.

**The new-tools reveal.**
When a boot finds tools the visitor hasn't seen, a full-screen overlay (`NewToolsReveal`, [`ui/new-tools-reveal.js`](../site/src/ui/new-tools-reveal.js)) opens a treasure chest and flies their gallery cards out, then into the featured strip on dismiss.
The seen set is the `seenTools` localStorage key, a list of tool slugs ([`data/new-tools.js`](../site/src/data/new-tools.js)); `pendingNewTools` returns the catalog slugs missing from it and the reveal marks them seen.
A first boot seeds the key: a brand-new visitor with the whole catalog, so nothing is revealed, and a returning visitor from before the reveal shipped (one with the `returningVisitor` key) with `RETURNING_BASELINE`.
That baseline is a frozen, hand-written slug list — the catalog as of the release before the reveal — not `Object.keys(TOOLS)`, which would fold every tool added since into the baseline and never reveal it.
So adding a slug to `RETURNING_BASELINE` hides that tool from those visitors, and renaming a tool's slug reveals it again to everyone, since the old slug in each seen list no longer matches.

**How a stack runs** — the executor, the chain-row and group-row models, the length filter, inversion, the cooperative runtime and streaming, sort axes, and highlights — has its own doc, [`pipeline.md`](pipeline.md).
The sections below cover the individual tools whose design needs more than their catalog entry in [`tools.md`](tools.md).

### Bookends

Bookends finds entries that start with one piece of the typed word and end with the rest: PURSE bookends `(PURS)UIT OF JUSTIC(E)`.
The middle must be non-empty, so the word itself never matches.
An entry that also contains the word whole (PURSES GALORE) still matches, and so does one with several valid splits (PURE BRED HORSE reads as `PU|RSE` and `PUR|SE`): editors count either as a ding, not a disqualification, and a tool should err toward showing too much.

The letters that could belong to either end (the R in PURE BRED HORSE, or the E in CHANCE OF A LIFETIME, where the whole word at the start is one more reading) wear a second highlight color, `ambiguous`, at both of their positions, so the ding shows on the row.
Each entry stays one row, since the flat table's selection, counts, and downloads all assume one row per entry.

Results stay flat rather than grouping by split; a **Split** column shows each row's split (`purs…e`; an ambiguous entry shows its longest start piece) and sorts by it, and the run bracket marks each split's run under that sort.
The column is the flat tool-column hook ([`pipeline.md`](pipeline.md) § *Sort axes per tier*), so it shows only in a filter-only stack: chaining a transform after Bookends drops it, leaving the highlights.
Clearing the word hides the column too, and the Split sort returns with it once a word is typed again.

### Initialisms

The first tool to operate on word structure rather than letter sequence.
Pattern is a literal initialism; matches displays whose word-initial letters spell the pattern (case-insensitive).
Word boundaries: spaces always, hyphens optional (the matcher tries both interpretations, so `CO` matches `co-op` via the split and `C` matches via the join), apostrophes/periods/commas/slashes never (`don't` is one word; `DT` does not match it).
A display with no space or hyphen is read through the spacing table's `best` reading ([`segmenter.md`](segmenter.md) § *The spacing table*), its initials taken from each part's norm because a guessed part can carry an override's apostrophe or capital.
The filter rules an entry out on first letter and length before asking for its reading, which leaves a few percent of a merge to segment on a cold keystroke.
So `HOT` also finds `HANGONTIGHT` and `HATSOFFTO`; an entry the reading leaves as one word stays one word, and offline, before the corpus has been fetched, run-together entries go unread.
A match on a guessed reading **marks its initials**, in norm coordinates so the renderer projects them onto a display carrying punctuation.
A spaced entry is never marked: its own spelling already shows where the words are, so a mark would only restate it.
That is also why the marks are worth carrying — on a run-together entry nothing else on the row says where the tool read the boundaries.
No wildcards, no minimum pattern length — a single-letter pattern matches every display whose first word starts with that letter.
All-mode buckets every multi-word entry by its initialism — a spaced display as written (spaces only — the hyphen-optional branching would scatter an entry across clusters), an unspaced one as read — and builds the spacing table to do it.
The first all-mode run on a large list takes a few seconds to read every run-together entry; the table then lasts until the wordlists change, and Rhymes shares it.
A `keepGroup` demands two distinct norms, since a phrase the merge carries both spaced and unspaced is one member.
Members are marked by the same rule, through `group.memberHighlights`, which re-derives the reading at render time and **checks it against the cluster key** — an edit since the run can change a reading, and a stale mark would point at the wrong letters.
It keeps only clusters whose initialism is itself a wordlist entry — the value of the cluster is the bidirectional pair (`TIS` ⇄ `the IRS`/`Tom Is Right`/…), not every prefix coincidence.
Single-word entries are dropped because a one-letter "initialism" cluster is just a prefix bucket.
Other rich-format tools (Initials, Has-accent, Word-count, …) ship later as the catalog grows.

### Space out

Space out ([`engine/tools/space_out.js`](../site/src/engine/tools/space_out.js)) emits the most likely ways to put the spaces back in each run-together entry.
The readings come from the segmenter, which has its own reference: [`segmenter.md`](segmenter.md) covers the algorithm, the corpus, every scoring refinement, and the spacing table that Rhymes, Phone search, Initialisms, Optional letters, and the word-relative match modes share.
This section covers only the tool's wiring.

**Space out and rich displays.**
A split re-spaces an entry without changing its letters, so every output shares the input's norm — which is why the tool rules on real metadata *once*, before splitting: when the merged wordlist already spells this norm with spaces (`A BARREL OF LAUGHS` is itself an entry), the tool passes that entry straight through and the atom keeps its real score, comment, and source.
A passthrough also covers the segmenter's best split being the original input.
Everything else is a spacing the list does not carry, emitted as a `[joined]` synthetic (below).
There is deliberately no second lookup after splitting: sharing the input's norm is what makes it unreachable, since it could only ever re-find the row the passthrough already ruled on.

**The Splits slider sets the score window.**
Its three stops (One / Few / Many) map onto `SPACE_OUT_WINDOWS = { few: 5, many: 10 }`, readings within ~150× / ~22000× of the top.
Few is the default.
**One** is not a third window: it enumerates at `few` and keeps one result, since a narrower enumeration would mute the bigram re-rank ([`segmenter.md`](segmenter.md) § *Choosing among readings*).
Many surfaces speculative alternates, including the wrong-but-amusing parses (`INCAN DESCENT`).
The slider's URL form is the label (`splits=many`), not the position.

**A reading's score is the input entry's score, live.**
The tool emits text-only synthetic outputs; the executor's synthetic-atom path builds a `wlEntry` with `wordlist: null`, no EntryPanel edit, blank Comment and Source, and a `score` that reads live off the input entry, so editing the input's score shows through.
Space out *renders* an existing entry rather than creating one: `ABARRELOFLAUGHS` at 80 stays 80 as `A BARREL OF LAUGHS`.
The segmenter's log-likelihood is a ranking signal only, never displayed.

**Downstream chain composition is undefined.**
Chaining `[space_out, head_off]` runs Head off on a synthetic multi-word entry; Head off works on the norm (`abarreloflaughs`), which has no `norms` entry for `barreloflaughs`, so the row drops.
It degenerates harmlessly, but a downstream tool that wants to treat multi-word entries differently will need to define it.

### Pronunciations

Rhymes and Phone search run on the **CMU Pronouncing Dictionary** ([`engine/phonetics.js`](../site/src/engine/phonetics.js)): ~135k pronunciations of ~122k words, each a flat ARPABET phone string carrying a stress digit on every vowel (`1` primary, `2` secondary, `0` unstressed) and no syllable boundaries.
It is a worker-owned data asset beside the segmenter's corpus (`cmudict` in [`engine/assets.js`](../site/src/engine/assets.js)): fetched from the upstream `cmusphinx/cmudict` repo on first use, parsed, and cached decoded in IndexedDB; a static dataset, refreshed by bumping its IDB key.
Lookups key on a word's letters alone.

**A word CMU lacks is read through the segmenter.**
It is split into words the dictionary might know, via the spacing table's `guess` ([`segmenter.md`](segmenter.md) § *The spacing table*).
A word that still can't be read has no pronunciation; there is no letter-to-sound fallback. eSpeak NG would supply one; it was evaluated and not adopted ([`planned/phonetics.md`](planned/phonetics.md)).

**The cot–caught merger is folded, except before R.** CMU records the AO/AA split, and records it arbitrarily: CAUGHT is listed both ways, GONE only AO, DON only AA, ON both; 10,164 of the 10,574 AO headwords carry no AA variant, so the exceptions are coin flips.
Honoring the split tears rhyme families in half along those flips: GONE PRO and COINTREAU bucketed away from DON HO, JOHN DOE, and TONTO, with ON AUX, ON LOW, and ON TOE stranded in each half, which reads as a duplicate-row bug.
So AO folds into AA everywhere a pronunciation is compared, in all three rhyme modes and in Phone search.
Not before R, where no dialect merges NORTH with START and folding would rhyme CARD with CORD and BARB with ORB.
The R must be one the vowel's own syllable closes on, since a word-initial R colors nothing before it: SAW RED folds, SORE ED does not.
(CMU also lists six headwords both R-ful and R-less, CARS and FOR among them, which is why OLD CARS reaches OLD SAWS; a dictionary wart, left alone.)

### Rhymes

Rhymes ([`engine/tools/rhymes.js`](../site/src/engine/tools/rhymes.js)) keeps entries that share a **rhyming part** with the typed entry.
The Match slider picks how a rhyming part is cut: **Loose** and **Strict** take the suffix of the last word's pronunciation from an anchor vowel to the end, stress digits stripped; **Whole** keys the entire entry syllable by syllable.

**Loose anchors on either stress, Strict on the primary.**
Loose (the default) anchors on the last vowel with primary *or* secondary stress, so CUMBERBATCH rhymes with MATCH and DYNAMITE with KITE; Strict anchors only on the primary, the classical perfect rhyme.
Stress is stripped from the suffix so a secondary anchor still meets a primary one.

**A phrase rhymes on its last word, and sharing it is a repeat.**
Loose and Strict look up only the last word.
An entry whose last word is the target's last word is excluded, so a word never rhymes with itself or with a phrase ending in it (AGATHA and AUNT AGATHA).

**Unspaced entries are spaced out first.**
An unspaced entry CMU doesn't know whole is read through the segmenter's `guess`, which forces a compound split where the corpus would call the entry one word (`RICKROLL` → `RICK ROLL`; [`segmenter.md`](segmenter.md) § *The compound reading*).
Measured on XWI, Spread the Wordlist, and Broda, this takes the share of entries that can rhyme from 13–22% to 75–80%.
The dictionary wins where it has the whole string, so NOTABLE stays NOTABLE rather than NO TABLE, and a spaced entry is used as written.
The **typed** entry gets a second pass at the wider `many` window: at the default window the scorer prunes `time machine`, because wordfreq carries `timemachine` as a token, so a pasted unspaced entry would return nothing with nothing on screen to say why.
The wordlist doesn't get the wider window, because there it rescues 4% of XWI and reads them as `orbs → or bs` and `not ate`; one deliberate query is worth a guess, 280k rows are not.

**All-mode buckets by rhyming part.**
An entry carries one key per reading, so a family is bucketed once per reading its members share; `bucketize` drops the repeats and any family wholly inside a larger one, which matters most under Whole, where a key is an entire pronunciation.
A family needs two or more distinct last words, read off the spaced form, so ROADRAGE and PARKINGRAGE count as one.

**Whole rhymes every syllable.**
Two entries match when they have the same number of syllables and each syllable's nucleus and coda agree; onsets are free throughout, so word boundaries need not line up: ANNE BOLEYN / MANDOLIN, TIME MACHINE / LIMA BEAN, CODE PAGE / ROAD RAGE, POTATO / TOMATO.
It needs no phrase stress.
A suffix rhyme has to locate its anchor vowel, and in a phrase the anchor depends on phrase stress (LI-ma bean, TIME ma-chine), which CMU's isolated-word stress can't supply.
Whole covers every syllable, so where the stress falls never matters, and syllable division becomes the whole mechanism.
Six rules carry it, each validated against CMU and the shipped wordlists (the second only after it shipped):

- **Maximal Onset, per word, never across a word boundary** (`syllabify`).
  Spanning one makes D R a legal onset, so ROAD RAGE reads roa-drage and stops meeting CODE PAGE.
  The onset table is restricted to native English clusters; CMU also attests loanword onsets (SH W, S V, K N, T S), whose admission would pull a consonant off a coda word-internally: ASH-ley read as A-shley.
- **Maximal Onset yields to the checked vowels.**
  English doesn't let a stressed lax vowel end a syllable: BAREST is /ˈbɛr.əst/, never /ˈbɛ.rəst/.
  Unconditional Maximal Onset hands that R to the next onset, which the key drops, so every C-EH-C-schwa-S-T word collapsed onto one key and BAREST rhymed with CHEMIST, DENTIST, WETTEST, and ten more.
  A coda is forced after a stressed AA AE AH AO EH IH UH; the tense vowels still hand their consonant forward, which lets SCOO-by meet LU-cy.
  This one shipped as a bug and was caught by a user on their first query.
- **Schwa-equivalence, restricted.**
  Unstressed AA AE AH AO EH IH OW UH collapse to one class, which marries ANNE BOLEYN's OW0 to MANDOLIN's AH0.
  ER0, IY0, UW0, and the diphthongs stay distinct: collapse those too and any two entries sharing a stress shape match, CZECHOSLOVAKIA against ENERGY POLICY.
- **The cot–caught merger** (§ *Pronunciations*).
  On a 738k-entry merge it takes Whole from 46,520 families to 46,685 and Loose from 7,173 to 7,128: it fuses families, and more often forms new ones from AO-only words that had no partner.
- **Degemination as an alternate reading.**
  A coda repeating the next onset is held once: TIME MACHINE is said ti-ma-chine, which lets it meet LIMA BEAN.
  Both readings are kept, since dropping the undegeminated one loses CLIMB A BEAN / TIME MACHINE.
- **Every word must be readable.**
  Unlike Loose and Strict, which need only the tail, Whole reads every word, so one unreadable word leaves the entry out, and a mid-entry split error that the last-word modes never notice does bite.

A word-by-word rhyme (CODE PAGE / ROAD RAGE pairing word with word) falls out of this wherever the paired words have equal syllable counts, the common case; it would differ only for a pair like BANANA SPLIT / HAVANA LIT, whose word divisions carry different syllable counts.
It isn't a separate mode, since syllable-by-syllable is the more general relation.

### Phone search and letter–sound alignment

Phone search ([`engine/tools/phone_search.js`](../site/src/engine/tools/phone_search.js)) is a filter that turns the input and each entry into sound strings and runs a substring search on them.
`soundsOf` ([`engine/phonetics.js`](../site/src/engine/phonetics.js)) gives a word's CMU pronunciations with stress stripped and the cot–caught merger folded (§ *Pronunciations*).
It encodes each phone as exactly one code unit, so `indexOf` can't land partway through a phone.
A word CMU doesn't know is read through the spacing table's `guess` ([`segmenter.md`](segmenter.md) § *The spacing table*).
If a word still can't be read, or it contains a digit, it reads as a **hole**: one code unit that no sound matches.
A run of sounds can't be heard across a hole, and a hole keeps its place in the entry, so Whole entry can't match an entry with an unreadable word (Starts entry can, when the hole comes after the sounds).
An entry's readings are the product of its words' pronunciations, capped at 16.
The match-mode control sets where the sounds sit: **Whole entry** finds homophones (`KNIGHT` finds `NIGHT`), **Starts entry** and **Ends entry** pin one end (`KNEE` finds `NEON` and `HONEY` respectively), **Whole word** needs word breaks at both ends (`TEA` finds `TEE` but not `ARTY`), and **Spans words** needs a break inside (`TEA` finds `NOT EVEN`).

**The query is whole words.**
The input must read as whole words; it can't be a fragment like `pho` meaning "starts with the letters PHO", because only whole words have pronunciations.
For each reading of the entry, the tool finds every occurrence of the query's sounds and keeps the ones the match mode allows: Whole entry needs offset 0 and the full length, Starts entry and Ends entry need just one of them, Whole word needs word breaks, and Spans words needs a break strictly between them.

**The search words themselves never match.**
An occurrence that is the query's own words is dropped: it starts on a word break, runs through words spelled as the query's, and ends in its last word or an inflection of it (morphology's `candidates`).
`FIGURE` skips `FIGURES` and `FIGURE SKATING` but keeps `CONFIGURE`.
A sound search that returns the typed word is noise, and under Whole entry this rule is what turns the search into a homophone finder.

**Only citation pronunciations are used.**
CMU lists weak forms (`ARE` as ER, `FOR` as F ER) and abbreviation expansions (`CO.` as "company") alongside a word's ordinary pronunciation.
If they were kept, `ARE` would find `BUTCHER` and `KNEE` would find `AND CO`.
`citationProns` drops the weak forms listed in `WEAK_FORMS`: 22 pronunciations of 20 common words (`ARE`, `FOR`, `TO`, `AND`, `HIM`…).
A weak form is only a sound or two, found all over the wordlist, so searching the bare word would flood.
The list is explicit rather than a rule like "drop every unstressed alternate": such a rule also drops readings that are real, like `A` as "uh" and `THE` as "thee", which a phrase such as `A LOT` needs, and multi-syllable alternates like `COMPARABLE` as "COMP-ruh-ble".
It also drops a pronunciation the spelling can't produce (`spellsOut`, below) when some other pronunciation of the word can.
For the same reason, a split into parts drops any one-letter part other than `a` and `i`, because CMU reads a stray `r` as its letter name and would hear ARE in `DEFOGGERS`.

**Replacing works on sounds, so its output is any entry that sounds like the result.**
With the replace field open (§ *The find/replace widget*), the row becomes **Phone replace**, a transform.
Within each reading of an entry it takes the complete matches the match mode allows, leftmost first and longest at each start with none overlapping, as Search's replace does, and puts the replacement's sounds in their place; a blank replacement deletes them, so ARE → blank turns ARBITER into BITTER.
The resulting sound string is looked up in an index of every corpus entry's whole-entry readings, built in `prepare` and kept in the prepare-artifact cache, so the output is whatever entries are pronounced that way, spelled however they are.
Since there's no way to spell a sound string, there is no **Allow unlisted**.
An output that is the input itself is dropped.
Unlike the filter, replace keeps occurrences of the typed word itself: KNIGHT → DAY turns KNIGHT SHIFT into DAY SHIFT.
The output is marked on the letters spelling the inserted sounds, in norm coordinates, because the executor emits every spelling of the output's norm and display marks would land wrong on a differently spaced one.

**Highlighting uses a letter–sound alignment.**
[`engine/phone-align.js`](../site/src/engine/phone-align.js) pairs each word's letters with its sounds using a cheapest-path search over (letters used, sounds used).
Each step uses a spelling from a hand-written table: `ph`→F, `igh`→AY, `x`→K S, `qu`→K W, a doubled consonant, a letter's name for initialisms (`TV`), or a silent letter priced by how often that letter is silent.
Any run of vowel letters can stand for any vowel sound at a middling price.
A letter and sound with no known spelling can still pair up, but at a steep price, so every word gets some alignment.
On the full CMU dictionary, 99.7% of words align without a guessed step, and almost all of the rest are foreign names.
A matched run of sounds is highlighted on the letters of the steps that produced it.
Silent letters just outside the matched sounds are included only when they run to the edge of the word (the final `e` of `phone`, the `k` of `knight`).
When any matched sound in a word has no letters of its own, the whole word is highlighted.
That happens with an abbreviation CMU reads as its full word (`DR` as "drive") or a schwa no letter spells (`SHOULD'VE`).
Marking only the letters that do have sounds (the `r` of `DR` for "rye") would pass off a guess as a letter-for-sound match.
A run that crosses words highlights each word's part separately.
Alignments are computed only for matching entries and are cached per word and pronunciation.

**Tuning the alignment.**
The prices trade off against each other, so a tweak usually fixes some words and breaks others.
[`scripts/phone-align-diff.js`](../scripts/phone-align-diff.js) aligns every CMU word with the working tree and with a git ref, and lists the words whose alignment changed; run it before committing a change.
Highlights that have been checked by hand are rows in [`tests/unit/tools/phone_search.cases.js`](../tests/unit/tools/phone_search.cases.js), run offline against the real CMU lines in `tests/unit/fixtures/cmu-cases.dict`.
After adding a row with new words, refresh that file with `node scripts/phone-cases-dict.js`.

### Rebus

Rebus ([`engine/tools/rebus.js`](../site/src/engine/tools/rebus.js)) builds a supplementary wordlist for *rebus* puzzles, where several letters share one grid square.
Each row pairs a letter string with a symbol that replaces it — `TOOL` → `Ⓣ` turns `BARSTOOL` into `BARSⓉ` — and the downloaded results let construction software fill a grid holding a few `Ⓣ`s.
The string box takes plain letters, matched as everywhere else in Grawlix (case, spaces, and accents ignored), so `A-B` and `AB` find each other.
The symbol box pops up a grid of circled letters, circled digits, and ASCII symbols, or takes any typed text.
The last pair row's `+` adds a pair and each row's `×` drops one; all pairs apply at once, so an entry matching several gets every substitution in one output.
A row shows only the squeezed form, at the input entry's score, and needn't be a real entry.
The pair-list widget and the synthetic-output wiring are in § *The Rebus pair list*.

### Optional letters

Optional letters ([`engine/tools/optional_letters.js`](../site/src/engine/tools/optional_letters.js)) finds entries with a letter that can be dropped to leave another entry, and circles it: `HART` becomes `HAⓡT`, since dropping the R leaves `HAT`.
It serves puzzles where the grid holds `HART` while the clue is for `HAT`.
It takes no text input; its one param is the **Include plurals** checkbox.

- **Every position gets its own row**, a doubled letter included (`HOLLY` gives `HOⓛLY` and `HOLⓛY`), because the circled square crosses a different entry depending on where it sits.
- **The score is the lower of the two entries'**, since a marked entry is only as good as its weaker half ([`pipeline.md`](pipeline.md) § *The chain-row model*).
- **A plural's own S is skipped** unless **Include plurals** is ticked: an optional S on a plural is a thin theme with a great many candidates.
  The rule applies to every word in an entry (`LANDS A BLOW` is skipped too) and only to the S itself, so `CARTS` still offers its R (leaving `CATS`).
  A plural is whatever `looksPlural` accepts (ends in S, not SS), minus a short keep-list whose S is worth having: `HIS`, `AS`, `IS`, `HAS`, `YES`, `DOES`, `NEWS`.
  Possessives like `ITS` and `YOURS` stay skipped, since a hidden possessive S is as dull as a plural one.
- **Run-together entries are read into words** through the spacing table's `best` reading ([`segmenter.md`](segmenter.md) § *The spacing table*), so the S of `CATS` in `CATSANDDOGS` is skipped too.
  It reads on demand rather than building the table, since only an S whose removal leaves an entry needs its word read.
  Offline, an unspaced entry counts as one word and only its last S is skipped.
- **One row per norm**: a norm with several spellings marks only its `bestRowForNorm` spelling, since the grid slot holds the same letters either way.

The circled forms are symbols to the output format, so unchecking **Symbols** ([`wordlists.md`](wordlists.md) § *Output format*) leaves them out of the download.

### Remove string

Remove string ([`engine/tools/remove.js`](../site/src/engine/tools/remove.js)) cuts a string out of an entry wherever it appears, keeping the results that are themselves entries — `XBOX ONE` minus its Xs gives `BOONE`.
The string is plain letters matched on the norm, so it can't remove a space or a hyphen.
An **All | One** switch (`mode`, always encoded in the URL — § *Tool stack encoding*) sets how many copies go: **All**, the default, cuts every non-overlapping occurrence at once; **One** cuts them one at a time, a row per distinct result, overlapping occurrences included.
`DERRIERES` minus all its ERs gives `DRIES`; minus one gives `DRIERES`.
Reversed with ⇄ it becomes **Add string** ([`pipeline.md`](pipeline.md) § *Inverting a transform's direction*), finding the longer entries an entry grows into (`BOONE` finds `XBOX ONE`).
Reversal indexes the forward cut over the whole wordlist, so reversed **All** asks which entries cut *down* to this one, and an entry still containing the string has no answer: `DRIERES` finds `DERRIERES` on **One** but nothing on **All**.

### Weave

Weave ([`engine/tools/weave.js`](../site/src/engine/tools/weave.js)) is a tuple tool that finds an entry whose letters split into two other entries, each keeping its letter order — `WALL SOCKETS` is `WALLET` and `SOCKS` woven together.
An empty box scans the whole wordlist; a typed entry pins one side of every weave.
Each side must be at least four letters.
The **Runs** box (minimum 3) sets how many alternating pieces the split must break into.
The default, 4, is the least that puts both entries in two or more pieces, which reads as woven rather than one entry stuck on another's end; 3 also admits one entry tucked whole inside the other (`BLANKETS` = `BETS` around `LANK`).
A pair is judged by the *fewest* runs it can be read in, so raising Runs never surfaces a pair that also has a looser reading.
Results stream as three-lane tuple rows and stop at a per-platform result cap ([`pipeline.md`](pipeline.md) § *Streaming results*).

**The corpus index is a sorted norm array used as a trie.**
Every prefix owns a contiguous range of the sorted array, so descending one letter is a binary search within the current range and costs no memory beyond the array; an explicit trie over a full merge runs to ~3M nodes and ~500 MB, which a worker can't hold.
Ranges for prefixes up to three letters are memoized; deeper ones are narrow and number in the millions.
`rangeFor` skips an entry that *is* the prefix (`wall` beside `wallet`): it sorts first in its range and has no letter at that depth, which breaks the binary searches' monotone predicate, and without the skip a descent silently lands on an unrelated norm.

**A pair scores by its fewest runs.**
Repeated letters let a plain concatenation also be read as a four-run weave, so judging a pair by its best-looking assignment would admit exactly the splits the Runs floor rejects.
`findWeaves` therefore records every complete assignment in `best`, keeping the lowest run count per pair, and filters on Runs only afterward.
Filtering before `best` would take the minimum over the surviving assignments only, which admits the concatenation just as judging by the most runs would (the "max-runs bug").
The input's first letter is pinned to pile A, so each split isn't also emitted as its mirror.

**Retention drops whole.**
Past `weaveRetainLimit` (50,000) tuples a streamed run's batches are the only copy and the run retains nothing, rather than a truncated set the executor would take as complete and cache as a prefix tile that answers later runs with tuples silently missing.

### Caesar shift

Caesar shift ([`engine/tools/caesar.js`](../site/src/engine/tools/caesar.js)) takes an entry and an optional **Shift**.
As a filter, a blank Shift keeps every Caesar shift of the entry (the entry itself excluded) and a set Shift keeps only that rotation.
In all-mode a blank Shift groups entries into shift classes (STEEDS and TUFFET cluster), while a set Shift rotates every entry by that amount and keeps the results that are entries — a transform shown as chain rows, the one all-mode that isn't a grouping ([`pipeline.md`](pipeline.md) § *The group-row model*).

### Umiaq: variable & pattern search

Umiaq, the variable-and-pattern search, has its own doc.
[`umiaq.md`](umiaq.md) is the dialect reference, and its [`umiaq.md`](umiaq.md) § *How the tool runs* covers the wiring: the semicolon escalation from filter to tuple search, the two arms, the tuple tier, the three search strategies, the memory ceiling, and composition.

## Entries table

The at-rest results display below the search bar.
Renders the merged `All Wordlists` view — or, with tools in the stack, the pipeline's chain rows ([`pipeline.md`](pipeline.md) § *Chain-row display*) — one or more stacked atoms per row, same view whether idle or filtered.
"Table" is meant loosely: rows are absolute-positioned divs in a virtual scroller, not a real `<table>`.
Pseudo-column alignment via CSS Grid puts each atom in a fixed sub-slot so the eye reads down them as if they were columns.

**A column of word atoms.**
Each atom carries the same shape: the word, its length, and a score badge, with a numbered position leading the row.
The list is calm content; controls live in the search bar above.

This is the pattern modern productivity apps (Linear, Notion, Things, virtually every mobile app) have settled on.
One real loss vs. a spreadsheet-style table, judged worth it:
- **2D reading.**
  A table lets you sort by one axis and visually scan another (sort by Min, eyeball Max).
  The list can't — switching axes is one click away (a column header — [`pipeline.md`](pipeline.md) § *Sort axes per tier*), but you see one ordering at a time.
  In practice users sort by their primary axis and scroll; switching is rare.

What's gained: visual calm at rest, narrow widths come nearly for free (lists scale; real tables don't), bigger friendlier fonts become natural, and the at-rest UI stays one column wide.
Nothing is in the chrome just to tabulate.

**Word atom: `1. CARE 4 50`** — count, word, length, score-badge.
Length is to the right of word ([Wordlisted](https://aaronson.org/wordlisted/)'s layout), freeing the leftmost column for the count.
The count makes scanning a long list legible and lets a user keep their place when slowly reading through.
Count and length use the sans-serif font; word and score-badge use monospace so columns of letters and digits visually align.

**Pseudo-column alignment, fixed widths from data.**
Each row is its own grid container with `grid-template-columns: var(--count-w) var(--entry-w) var(--len-w) var(--score-w)` and `grid-auto-rows` for stacked atoms.
The four CSS variables are computed once per filter/sort pass from the entire result set: count digits, max entry length across every atom (capped at 21 chars; longer entries truncate with ellipsis + tooltip), max length-number digits, max score digits.
They stay fixed across scroll.
Picking widths from the visible rows would jitter under virtual scrolling; one outlier row would also blow out the layout for everyone else.
Each row is independently grid-laid-out (because rows are absolute-positioned for virtual scrolling), so the variables must be uniform — `max-content` tracks would size per-row and break cross-row alignment.

**Score badges right-aligned within their column.**
`justify-self: end` on the score atom pushes each badge to the right edge of the (uniform) score track; numbers' right digits line up across rows.
The score column width is `calc(maxScoreDigits ch + 12px)` — the 12px covers the badge's 5px-each-side padding plus a small safety margin.

**The Sources column is a presence matrix.**
Every enabled wordlist, plus the scoped one even when disabled, gets a fixed 16px slot in priority order (`sourceMatrixSlots`), and each row shows that list's icon where it carries the entry and an empty gap where it doesn't, so the icons line up into columns that read both ways: across a row, an entry's coverage; down a slot, what one list contributes.
A list is in full color when it supplies a value on screen — the displayed spelling, the winning score, or the comment — and muted to gray (`src-slot--muted`, tooltip *(overridden)*, full opacity on row hover) when it merely also carries the entry.
Each shown value has a single source, so a duplicate holding the winner's spelling and score is muted; two lists light up when a high-priority bare entry wins the score and a lower list supplies the richer spelling (`the IRS`).
The column shows in every scope; scoped to one list, only that list can be in color, so a row where it is the lone icon is unique to it.
It hides below 960px ([`pipeline.md`](pipeline.md) § *Chain-row display*), and the slot universe must mirror the worker's contributor universe (`shipContributors`), or a row's source silently renders nowhere.
Per-list spelling, score, and comment, disabled and losing lists included, are the entry panel's provenance view ([`entry-panel.md`](entry-panel.md) § *The cross-wordlist view*).

**Click targets: the entry text opens, the rest of the row selects — except the score badge.**
A plain click on a flat row's **entry text** opens its panel *and* selects the row, so the table selection and the open panel stay in sync (Esc-then-Enter reopens the same one, and a lone open's walk has a visible anchor to follow); a click anywhere **else** on the row selects it without opening.
Two things override that split: the **score badge** keeps its single-click **tier quick-pick** (in the mergeable scopes — a foreign single-list score opens the panel), and a **double-click** anywhere but the score also opens the panel, so the spreadsheet gesture — click a cell, double-click to edit — still carries over.
A modifier-click (Shift / Ctrl / Cmd) anywhere is always a selection gesture, never an open.
**Touch:** a coarse pointer (`isMobile()`) has no double-click, drag, or modifier keys, so a lone **tap opens the panel** anywhere on the row — multi-select is desktop-only (and keyboard-fed anyway), so on a phone the select-first model would strand a row you can't act on; the score badge still taps to its quick-pick.
The non-flat exploration tiers (group/transform) aren't selectable, so they open on a single click on every pointer.
Selection — not hover — is the sole target for row-level shortcuts (§ *Keyboard navigation & multi-select*).

**Run bracket.**
Under the Entry (family) sort, a thin accent down the left gutter brackets each run of two or more same-family rows; singletons are unmarked, so the list stays calm and only the clusters read.
Under a flat tool column's sort (Bookends' Split) the same bracket marks each run of equal column values.
The worker stamps a per-row `runStart` flag (true on the first row of a run) only under those sorts — the orders where equal keys are contiguous ([`pipeline.md`](pipeline.md) § *Sort axes per tier*).
The scroller reads it per rendered position to tag each row `run-start` / `run-end` / `run-member` (a row that is both a start and an end is a singleton and gets no class), and the bracket itself is a CSS `::before` riding in the row's existing left padding — no DOM, no layout shift.
Flat tier only; transform and group tiers don't bracket.
The score badges are already tier-colored, so within a bracketed family a scoring discrepancy (`cat=60` green above `cats=20` red) reads off the existing colors with no added marker — the deliberate non-feature here is any discrepancy *flag*, which would pile up like an uncleared warning.

**Search and Regex highlights** mark pattern matches in the entry slot via `<mark>` spans, colored per literal run or capture group.
Ellipsis truncation respects the markup.

**Sorting is on the column headers, not the stats bar.**
The bar's right region holds the score-range input and the Share control; there's no Sort-by control here.
Sorting is on the entry/group column headers ([`pipeline.md`](pipeline.md) § *Sort axes per tier*) — clicking a header sorts by it, and a header with several axes opens a menu of them.
Keeping sort out of the bar is what leaves room for Share to read as a labeled button rather than a bare icon.

**Stats bar refresh is surgical.**
A score-range keystroke triggers a re-render of the bar's counts and stats numbers, but `.stats-bar-controls` (containing the input the user is typing into) is left untouched — `swapStatsBarReadouts` replaces only `.stats-bar-counts` and `.stats-bar-distribution`.
Rebuilding the whole bar on every keystroke would destroy the input element under the cursor and drop focus mid-edit.

**Open an atom → the entry panel.**
Which clicks open it is § *Click targets*.
The panel — opening and closing, editing, the cross-wordlist provenance view, the rename hint, Related entries, and the Prev/Next walk — has its own doc, [`entry-panel.md`](entry-panel.md).

**The score cell is a tier quick-pick in the merged and My Edits views.**
Clicking a score in All Wordlists or My Edits opens `ScorePicker`, a listbox of the tier labels (`state.scoring`) rendered as score badges, highest to lowest, with the entry's current tier marked (a score that falls between tiers marks nothing but starts the cursor on the next tier down).
Picking one — by click, or ↑/↓ then Enter — writes that tier's score into My Edits in a single action and closes, no Save step: it's the common rescoring move (click→select) without the panel's full ceremony, and it writes the tier's low bound so the entry just lands in-range.
The listbox opens positioned so the current tier's badge sits directly over the clicked badge — a native-select feel, the value you're changing staying put under the cursor rather than the list dropping below the row.
It's offered in exactly the two scopes where the clicked row *is* the value a save writes, so the new badge appears in place; in a single-source scope the score cell still opens the full panel, because an edit there routes to My Edits while the table keeps showing the source's own score (§ no override indicator) — a quick-pick would silently appear to do nothing.
The save path is shared with the panel (`seedFromWinnerRow` → `_onSave`), so retiering routes into My Edits identically; arbitrary (non-tier) scores, renames, and deletes remain the panel's job.
Every committed retier — picker click, picker Alt+digit, or a selection Alt+digit — converges in `commitRescore` (single) or `batchRescore` (a multi-row selection), which save through a `'rescore'` mode: they plan like an ordinary edit but fire an **Undo** toast naming the entry(ies) and the new score, reusing `saveEntry`'s inverse-writeset undo (the same machinery behind the panel's rename/add/adopt toasts), so undoing a rescore that *created* a My Edits entry deletes it rather than writing the source's old score back.
Re-picking the entry's current tier is a true no-op and stays silent.
Each row also carries an **Alt+digit** accelerator — `buildScoreOptions` numbers tiers from 0 = lowest upward (so the mapping holds on any scale rather than assuming a ×10 one) and surfaces the digit as a row hint.
`handleScoreDigitShortcut` routes Alt+digit three ways: it commits the tier in the open picker, fills the Score field in the entry panel without saving (`EntryPanel.setScoreByDigit`, complementing that field's tier combobox ([`entry-panel.md`](entry-panel.md) § *The Score field*) and deferring to the panel's own Save), and — with neither open — rescores the **current selection** (`EntriesScroller.rescoreSelectionByDigit`, gated to the same two scopes), one or many rows in a single write-set (§ *Keyboard navigation & multi-select*).
The picker's badge column is measured to the widest tier (`badgeWidthPx`) so the labels line up regardless of digit count.

**Virtual scrolling.**
Rows are absolute-positioned inside a height-sized `.entries-table-rows` container; the scroller materializes only rows in the current viewport ± a buffer.
Each row's `top` is `i ×` the row stride (atom count × `ROW_HEIGHT`).

**Scroller on a shared base class.**
`BaseVirtualScroller` owns the shared mechanics — sizer DOM, capture-mode window scroll listener, ResizeObserver, the visible-range math, destroy.
`EntriesScroller` extends it with the atom-grid render, EntryPanel binding, and click-to-edit wiring.
(`UpdateSummaryScroller` is the other extension, for the update-diff dialog.)

**The entries-table footer.**
`_renderFooter` composes up to two independent lines at the very end of the table — a flow element after the full-height sizer, so it sits below the rows (at the table's end for a long result, in the empty area for a short one).
**No matches.** shows whenever the result is empty.
An **Expecting more?
Switch to All Wordlists** line (a one-click `setScope(MERGED_ID)`) shows whenever the scope isn't All Wordlists, independent of result count — a scoped view quietly caps what search and tools turn up, and it's easy to forget you're on a small list like My Edits when results come up thin.
The two stack as separate paragraphs with even spacing — each carries the footer's top inset as its own top padding, so the gap between the lines matches the gap above them: either, both, or neither.
The empty line rides the reservation/reveal parking — the sizer holds its prior height while a search/tool input is focused so "No matches." doesn't flash mid-type, revealing on the typing pause.

### Keyboard navigation & multi-select

The flat entries list is a fully keyboard-operable, virtualized `role="listbox"`.
Arrow / PgUp / PgDn / Home / End move a **cursor** (Alt+↑/↓ mirror the plain arrows, so the same up/down reflex serves the table cursor and the entry panel's walk); Shift extends a contiguous range; Ctrl/Cmd moves the cursor without disturbing the selection; Space toggles the cursor row; Ctrl/Cmd+A selects the whole filtered view; Enter opens the entry panel; Escape clears the selection; Alt+digit rescores the selection and Delete (My Edits scope) deletes it.
Only the flat tier is selectable today (§ *Parked*); the group/transform tiers leave the machinery inert.

**Selection is data, not DOM focus.**
The virtual scroller destroys a row's `<div>` the instant it scrolls out of view, so a roving `tabindex` + `.focus()` on the selected row would evaporate on scroll, taking its keydown listeners with it.
Instead focus lives permanently on the rows container (`this.sizer`), and the selection is a set re-applied on every `_render` exactly parallel to how `.active` is toggled — the standard virtualized-listbox pattern (`role="listbox"` + `aria-activedescendant` pointing at the mounted cursor row).
Rows carry `role="option"` plus `aria-setsize`/`aria-posinset` set to the **true filtered count**, not the mounted-row count, so a screen reader announces "5 of 12,458" rather than "5 of 40".
The container's outline is suppressed in favor of a ring on the cursor row (a full-height outline on the giant sizer is meaningless).

**Selection identity is the atom's `(norm, display)` pair, never a row index.**
The list windows — a row's absolute index names a different entry after a scroll or a re-ingest — so membership keyed on identity is the only thing that survives.
It also makes the multi-atom tiers *additive* rather than a rewrite: a flat row is the degenerate one-atom case, and keying on the atom from day one means the transform/group tiers extend the same selection state (§ *Parked*).
The cursor carries a cached index alongside its identity — the index drives nav / scroll-into-view / `aria-activedescendant`, the identity re-anchors it when the result changes.
The cursor and the selection set are deliberately **distinct**: Ctrl/Cmd+arrow advances the cursor while leaving the set intact, and Space toggles the cursor's membership — the non-contiguous keyboard path, which the unspaced-family case needs (a family Grawlix can't detect until it's spaced sorts *apart*, so its rows aren't adjacent).
A press-and-drag across rows selects the dragged range: the rows carry `user-select: none`, so a drag is a clean row gesture rather than a native text highlight (Copy/Export handle getting text out), and the trailing `click` a drag emits is swallowed so it can't collapse the range back to one row.
Scroll-into-view brings the cursor below the sticky stack via `scroll-margin-top: var(--sticky-stack-h)` and a manual document scroll (the list windows against the page, so `scrollIntoView` on an unmounted off-window row would no-op).

**Survival across re-render, reset when what's shown changes.**
A live result re-orders under the selection — a sort flips, a stream repaints, an edit re-runs the pipeline — and because membership is identity-keyed, the set survives every such *mechanical* re-render untouched, each rendered row re-checking the set by identity.
What resets it is any change to **which entries the table shows** — whether the *view definition* (a **scope change**, `setEntries`; a **tool-stack / search edit**, `resetSelectionForViewChange` from the `pipelineVersion$` effect before the re-run; a **score-range filter**, `setScoreRange`) or the *corpus* under it (enable/disable a wordlist, reorder, edit a rescore rule — all via the `cacheVersion$` effect).
Each can drop a selected row out of the visible result, so a preserved set would leave it an invisible Alt+digit / Delete target the user can't see to deselect: a scope change carries one scope's picks into another, and a rescore-rule edit can push a selected score past the range filter and out of sight.
That the `cacheVersion$` path also fires for a background disk-sync merge into My Edits — clearing a hand-built batch with no user gesture behind it — is an accepted cost: the merge rewrites the very entries the batch names, so a full re-render dropping the highlight is the lesser surprise.
The one reproject that *doesn't* reset is a pure **sort** — it reorders the same rows, so the selection stays valid — and neither does an **edit-driven refresh**, since the user is acting *on* the selection and expects to rescore it again (and it bumps neither signal); both route through `updateEntries`, which **reconciles** (re-derives the cursor/anchor indices against the new window, membership untouched) rather than resetting.
Keeping the batch sticky as the filter narrows — pick a batch, then type to whittle it down — was considered and rejected: a selection scoped to a result the user has replaced shouldn't silently outlive it, and Alt+digit acting on rows scrolled out of sight by a filter is the bug that motivated the reset.
A rename is the one identity *change* the selection follows on purpose: since a rename is a delete-of-old + add-of-new, the edit path remaps the selected (and cursor/anchor) identity old→new (`renameInSelection`) so a selected entry stays selected — and stays visibly marked as it re-sorts to its new spot — instead of silently deselecting one entry at a time as you rename through a batch.

**Batch actions ride one write-set and one undo.**
A multi-row rescore or delete plans the N selected atoms, merges their write-sets into one, applies it optimistically once, ships a single `editEntry`, and shows one Undo toast ("Rescored 12 entries to 60").
The worker applies an arbitrary-size write-set in **O(affected norms)** (§ worker-protocol `editEntry`), so batch is one round-trip regardless of N — no protocol change.
`mergeWriteSets` is plain concatenation, safe only because a pure rescore renames nothing (no keep-copy/downscore siblings, no `(norm, display)` collisions); its `primary` is null (no single focus for a batch — the worker ignores it and the refresh re-runs).
Each target's seed is resolved through the same `fetchEditSeed` the panel uses, so the batch and single-rescore paths can't drift.

**Hover is not a target.**
The row-level shortcuts act on the selection, never the *hovered* row; honoring both hover and selection would leave two "which row does Alt+# hit?" inputs that could disagree (mouse over row 12, keyboard on row 5).
One target is cleaner, and the succession workflow hover would serve — rescore several in a row — is better served by multi-select: hover costs one mouse-move plus one keypress per row; a batch is mark-the-run-once plus one keypress for the whole set.

**Enter closes the keyboard loop.**
Enter — and a click on the entry text, or a double-click — opens the panel with the **entry field focused as a caret** (no selection, so typing appends), ready to retype.
On close focus returns to the listbox with the cursor intact, so the arrow → Enter → edit → save → back-on-the-row → arrow-to-next loop makes serial editing fast.
(A touch **tap** opens view-first with no auto-focus, so the soft keyboard doesn't spring up until a field is tapped.)
A polite live region announces the result count (debounced) when a search or filter changes it.

**Parked.**
The multi-atom tiers (transform, group) and a deeper multi-entry *panel* editor — editing a selection's shared fields (one comment template, one score) at once, past the per-member walk ([`entry-panel.md`](entry-panel.md) § *Walking a set*) — are deferred with a designed-in path, not a rewrite.
See [`planned/editing.md`](planned/editing.md), which also holds the bulk-editing stretch goal (batch-editing related entries with parallel-but-not-identical changes) that motivates the whole effort.

### Find in page (Ctrl/Cmd+F)

The browser's own find can only see the mounted rows — the virtual scroller windows the result, so native find silently misses everything off-screen.
Grawlix overrides Ctrl/Cmd+F with a custom find that searches the **whole result** and navigates + highlights across it, with parity to the browser's: a bar with an in-field `N/M` counter and prev/next carets, Enter/↓ for next and Shift+Enter/↑ for previous (both wrapping), and Escape to close.
It is **find, not filter** — non-destructive, leaving the sort and any tool filter untouched.
On the editable **flat tier** it drives the cursor and single-selection: the current match becomes the selected row, so closing find (Esc) lands **edit-ready** — Enter opens the entry panel on it, Alt+digit retiers it — and because Alt+digit already acts on the selection, retiering works straight from the open bar too, making a type→`Alt`+digit→`Enter` sweep down every match.
Non-flat tiers aren't selectable, so there find stays navigate-only.

The full result lives only in the worker, so find is a worker scan (`find` / `findResult`, § worker-protocol) rather than a DOM walk: `engine/find.js` holds the pure occurrence finder and the 999-match cap; `worker.js` scans the retained result of whichever tier the run produced and returns ordered match coordinates (capped, with a `capped` flag so the counter reads "N/999+").
It matches **the text each tier displays** — entry + comment in the chain tiers (flat, transform), **entry only** in group/tuple, whose rows have no comment cell.
An entry matches the way the Search bar does (§ *Search syntax*), through `buildSearchPattern` in literal mode: case-insensitive, against both the display and the letters-only norm, so `motherteresa` finds `Mother Teresa` and `theirs` finds `the IRS`, but `*`, `?`, and the other wildcards match themselves.
A comment is a plain case-insensitive substring scan (`findOccurrences`).

`EntriesScroller` owns the bar and the navigation: it builds a row→matches map for O(1) render-time lookup, scrolls a match's row into view — **centering it only when it's off-screen** (an already-visible match just moves the highlight, like the browser), generalizing the cursor scroll-to-index and fetching that window through the ordinary bridges — and composes find-hit ranges into `renderHighlightedText` — a distinct kind for the current match, given tie-break priority so it's never masked by a co-starting search highlight.
A grouped hit can land in a member hidden behind **+N more**; navigating to it **auto-reveals** the group's popover and lights the member there (fetching its chain if it's past `firstChains`).
Because the scroller only mounts visible rows, "highlight all" paints all *visible* hits and the counter reports the true total — the same behavior as the browser.
A sort/filter/result change reindexes rows, so find drops its stale coordinates and re-scans (non-navigating, to keep the scroll put); a superseded scan is dropped by a find sequence token.
Find and the entry panel are mutually exclusive — both dock to the right edge and the panel is modal (its scrim covers the table) — so opening the panel dismisses an open find, and Ctrl/Cmd+F is inert while the panel is up, exactly as it is under an open dialog.

## Entries-table export

**Share** is the sole stats-bar control that gets the current view out of Grawlix.
It opens a copy popover with two link rows and a **Results** row, whose action is a split button: **Copy** as the primary (the plain results list, into another app) plus a menu holding the three file downloads — **Download as wordlist**, **Download as CSV**, **Download as JSON** — wordlist for filling tools (Crossfire, Ingrid, Compiler, Crosserville), CSV for spreadsheets, JSON for scripters.
Getting results out still splits by intent — copy-into-chat reads differently from writing a file — but both intents live inside the one popover instead of each claiming a stats-bar slot, because the bar's space is scarce and the file exports rarely need to sit one click from the counts.
The split button keeps the two intents visibly distinct: Copy is the button, the downloads are behind its caret.
"Download as …" names the file exports directly, in step with the project's "download means output" rule.

**A download menu, not an Export dialog.**
For the *file* exports, an "Export…" dialog with a format chooser and live preview was considered and rejected as overcomplex for the common case; the per-format defaults are sensible enough that plain menu items keep the surface quiet.
The downloads sit in the Results split menu because that's where the user already is when deciding how to get results out — the popover shows how far the result runs, and one caret puts "write a file" beside "copy the text".
**Share** itself is a labeled trigger, not a bare icon: an icon button was considered and rejected (icon mystery vs a self-documenting name), and with sorting on the column headers the bar has the room to label it.

**Scope is the visible view.**
Every format reflects the current filter, sort, and pipeline output.
Score range applies (WYSIWYG).
Grouped pipelines export every surviving member chain — the `+N more` cap is a display artifact, not a filter.
Synthetic atoms (tool-supplied `[string]`, or `[string, score]` when the tool computes one, with no wordlist backing) are included.
A coined atom's own score is blank in the CSV and `null` in the JSON, matching the dash on screen; the wordlist download writes the trash score, since a wordlist line can't go without a number.

**Same skip rule everywhere: highlight-slot atoms collapse.**
A chain's same-word repeat atoms (the `[]`-slot atoms emitted by Search and other highlighting tools) are display constructs — their entry/score/comment match the prior atom — so exports use the chain's *content* entries (originator + transform outputs).
A repeat is the same `(norm, display)` pair as the atom before it, not merely the same norm: a Space out re-spacing shares its input's norm and is a content entry in its own right — the spaced form is the tail the wordlist download keeps and the `entry_2` CSV carries.
`currentContentAtomCount(stack)` derives the static count from the catalog records (`1 + non-inert transforms`); CSV's column count and JSON's `entries[]` length both align with it.

**The global output format governs the entry text.**
**Download as wordlist** and **Download as CSV** write entries through `formatEntryText` at the current output format ([`wordlists.md`](wordlists.md) § *Output format*), exactly as the downloads and disk mirrors do — a user who set "strip accents" because their software demands it means it for every file Grawlix writes, and having these exports quietly opt out of the setting would be a bug, not a policy.
**Download as JSON is exempt**: it's the programmatic format, where a script wants the entry as Grawlix knows it and can strip for itself.
In CSV the format touches *only* the entry cells (plus unchecked `digits` or `symbols`, which drop a row when any entry in it has one — [`wordlists.md`](wordlists.md) § *Output format*) — `length` is the norm length (already accent- and space-free), `group_key` and the catalog group columns are derived metadata rather than entry text, and the `comment`/`source` columns stay put unconditionally, since dropping a declared column would change the schema out from under a spreadsheet.

**No sticky export settings.**
Defaults are baked into each menu item; "with source attribution" lands only if users surface the need — the column appears in the merged-view display but not in CSV/JSON exports today.
Surface complexity costs more than the minor friction of users post-processing.

### Copy to clipboard

**Share** opens a small anchored popover (`openCopyPopover`, in `app/actions.js`) with three targets.
The two link targets each pair a read-only field with a **Copy** button; the **Results** target is a split button — **Copy** for the plain results list, plus a menu of the three file downloads (§ *Entries-table export*):

- **Markdown link** — `[Tool description](URL)`, a markdown link to the URL that reproduces the view.
  String param values are backtick-quoted inside the label so a wildcard like `*EARNING` doesn't trigger italic-on-rest-of-line in markdown renderers that parse formatting inside link text (numeric params can't carry markdown specials and go bare for legibility).
  Empty-stack/empty-search uses `[Grawlix](URL)` so it never degrades to a bare angle-bracketed URL.
  The label describes the whole row, mirroring what the URL carries: the tool name (`Replace` for a Search row whose replace field is open — the catalog record's `replaceName`), the first filled text or number param, then every other non-default setting lowercased in parentheses — a match mode bare (`(whole entry)`), a checkbox by its label (`(spans words)`), any other choice or number as `label: value` (`(occurrences: one)`, `(shift: 3)`).
  A find/replace row then adds `→` and the backticked replacement, or `→ empty` in delete mode, with the replace-scoped flags after it (`(allow unlisted)`); those stay out of the label while the field is closed, since a collapsed row is a plain filter.
  A grouped row skips the first param, as the codec does.
  So a full row reads `Replace `c?t` (whole word) → `dog` (allow unlisted)`.
  Stages join with `›`, a breadcrumb rather than a second arrow, so `Anagrams `lindsey` › Replace `s` → `x`` can't be misread as a three-step rewrite.
- **Plain link** — the bare URL, for pasting where a markdown link would show as literal `[…](…)` (a plain note, an email, a text field).
- **Results** — the entry list *alone*, no link or description line, under a plain **Results** label.
  One row per line, chains rendered inline with their glyphs (`RELEARNING → ELEARNING → LEARNING → EARNING`); semordnilap mirror pairs use `↔` per `unify`; grouped pipelines render one line per group as `chain1, chain2, …` with no `group_key:` prefix (the key isn't shown on the group rows the user is looking at either; CSV/JSON carry it when an exporter needs it).
  Sort follows the current table sort, no dedup (glyph chains are visibly distinct, so two journeys to the same tail are two distinct lines).

**Splitting the link out dissolves the format question.**
The markdown-ness only ever lived in that link line; once the link is its own field, the results are always the plain list, so there's no markdown-vs-plain mode to choose, toggle, or persist.
The user copies whichever link style suits the destination; wanting both a link and the results is two copies.
Three visible fields carry no state and read at a glance — worth a slightly taller panel over a mode toggle.

**Instant preview, fetch-on-copy.**
The full result set lives in the worker and can be the whole merged corpus, so the popover never fetches or formats all of it just to open.
It shows a bounded first-window preview (`exportPreviewRows` — a small windowed fetch on the flat and transform tiers, either of which can run the whole merged corpus; grouped/tuple results are few enough to fetch whole) capped to a few rows, the last reading `+N more` when the result runs longer — that overflow count comes from the result's resident total (`resultRowCount`), no round-trip.
The Results **Copy** button is what pulls the full set (`exportRows`) and writes it — the same fetch-then-write the copy has always done — after which a toast confirms with the count; the two link fields copy synchronously.
A sequence token drops a preview fill superseded by a reopen.
Every copy confirms with a toast rather than mutating its button.

**One panel for both.**
Copy earns an anchored panel because it has a real fork the plain downloads don't — link vs results, and which link style — and because seeing how far the result runs (the `+N more` tail) before you commit is the point when results are large.
The file downloads ride along in the Results split menu rather than getting their own control or dialog: they're one caret from the Copy the user is already reaching for, and folding them here keeps the stats bar down to the single Share trigger.
It's a lightweight anchored popover (dismiss on outside-click/Esc), not a modal.
The outside-click dismiss listens on the capture phase: `toggleSplitMenu` stops a toggle click from bubbling, so a bubble-phase dismiss would miss a click on some *other* split menu's trigger and leave this popover stranded open.

### Download as wordlist

Strict `ENTRY;SCORE` per line, no header, no comments, `\n` line endings, trailing newline.
Intended for filling tools that expect raw wordlist format.

**Chain rows → tail entry only.**
The journey is meaningful in Grawlix but irrelevant to the filling tool consuming the file.

**Score = min across chain content atoms.**
Matches the existing rationale that the worst-scoring atom caps a chain's quality ([`pipeline.md`](pipeline.md) § *Sort axes per tier*).
A theme using both ends of the chain has to live with the weak link.

**Dedup by tail entry, score = max-of-mins.**
Two chains both producing EARNING (mins 30 and 50) collapse to one `EARNING;50` line.
Each chain is an alternate path; the user has the option of using the strongest, so the entry's effective quality is the better path's min.
Per output entry: max over chains producing it of (min over atoms in chain of atom score).

**Grouped pipelines flatten.**
Every surviving member-chain tail, group identity discarded.
Wordlist format can't represent clusters; CSV/JSON carry the structure when needed.

**Sort = alphabetical asc.**
Decoupled from the user's table sort — it falls out of `serializeEntries`, which sorts by norm.
Wordlist files in the wild ship alphabetical-ish (XWI, Broda, JK, STWL all follow this), and a canonical sort is diffable across snapshots.

**Semicolon-in-entry handling: drop + toast notice.**
Wordlist format has no escape mechanism.
Toast: `Downloaded 124 entries (2 entries skipped due to semicolons)`.
The parenthetical also counts entries left out by unchecked **digits** or **symbols** and entries stripped to nothing, and is omitted when every count is zero.
Replacing the `;` with anything else would silently corrupt entries.
The check runs on the *formatted* text, so stripping punctuation removes the `;` first and the entry exports instead of vanishing.

**Comments follow the output format.**
The `comments` axis governs the third field, same as every other generated wordlist file — checked (the default) writes `ENTRY;SCORE;COMMENT`, unchecked writes `ENTRY;SCORE`.
There is no separate rule for this export: a user whose filling software chokes on comments (Crossfire does) unchecks the box once and every file Grawlix writes obeys.

**Only the chain reduction is bespoke; the rest is `serializeEntries`.**
The export reduces chains to one entry per tail (max-of-mins, above) and hands those entries to the shared serializer for formatting, sorting, and identical-line dedupe.
The reduction stays because a chain minimum is a *derived* number, not a property of the entry — emitting `EARNING;50` and `EARNING;40` for two paths tells a filling tool nothing it can act on, unlike a strip-collision, which represents two genuinely distinct entries.
The export hand-rolls none of its own line building, sort, or dedupe policy; a private copy of those is how the output format once went missing here.

### Download as CSV

Spreadsheet-oriented structured format (`.csv`).
Header row, RFC 4180 `"` quoting (handles entries with `,`, `;`, `"`, newlines — no dropping needed), UTF-8, `\r\n` line endings (Excel-friendly).

**Column order matches the site's display: `entry, length, score, comment, source`** — interleaved per entry on multi-content-atom chain rows (`entry_1, length_1, score_1, comment_1, source_1, entry_2, …`).
On flat one-content-atom rows, plain column names.

**Sort = preserve table sort, no dedup.**
CSV is the "analyze elsewhere" format; the user's current sort signals intent, and multiple chains producing the same tail are distinct rows.

**Computed columns kept** (`min_score`, `max_score` before the entry columns; `count` on grouped rows; catalog group columns).
Asymmetric with JSON — the spreadsheet audience would hand-type `=MIN(...)` formulas otherwise.

**Comments + source mimic the display table** — present on flat pipelines, omitted on grouped, which show no Length, Comment, or Source column ([`pipeline.md`](pipeline.md) § *Group-row display*).

### Download as JSON

Scripter-oriented structured format (`.json`).
Pretty-printed (2-space indent), UTF-8.
Mirrors the executor's `group → chains → entries` model directly.

**Uniform shape regardless of pipeline.**
Always `{url, tools, score_range?, sort, groups}`.
Flat pipelines are one mega-group (no `group_key`, no catalog cols, comments/source on entries).
Grouped pipelines have one group per cluster (with `group_key` and catalog cols, comments/source omitted on entries per the same rule as CSV).
Consumer parses one schema.

**Drops generically-computed fields** — `length`, `count`, `min_score`, `max_score`.
Scripter can compute trivially (`Math.min(...chain.entries.map(e => e.score))`); the JSON should be lean.
Catalog group cols *kept* — they're tool-declared, and JSON doesn't know whether a given catalog col is trivially derivable from `group_key` (Letter clusters' `letters` is `group_key.length`) or non-trivial.

**Metadata fields:** `url` (the link that reproduces the view; mostly redundant with `tools`+`sort` but kept as the human-clickable handle); `tools` (parsed pipeline as `[{name, params?, grouped?}]` in order, with the same skip rule as `Router.buildQuery` — permanent search bar drops out when inert, other rows kept); `score_range` ({min, max} numbers, either bound omitted when open-ended, whole field omitted when no range set — the one piece not in URL since the filter is per-user); `sort` ({by, dir} matching internal axis keys).

Wordlist metadata (names + enabled state) was considered for forensic-reproducibility ("which data produced this view") and deferred — noise for the common case; timestamps and Grawlix-version fields were rejected outright (privacy-leakage on shared files, premature).

### Filename scheme

Across all three Download formats: `grawlix-<tool>-<param>-<tool>-<param>.<ext>`.
Same tool keys as the URL query string, sanitized for filesystem safety (lowercase, wildcards `?` `*` `#` `@` `[…]` stripped — invalid on Windows, noisy anyway; non-alphanumerics collapsed to `-`; capped at 100 chars).
Empty pipeline → `grawlix-all.<ext>`.
The downside is that `grawlix-search-ice.txt` can't distinguish `?ICE` from `*ICE` from plain `ICE`; accepted, since the file content is the source of truth and the filename is just for telling snapshots apart in the Downloads folder.

## Help

The header `?` button opens the **Help** dialog (`FaqDialog`) directly — there is no menu.
It is one scrollable dialog that gathers everything help-shaped:

- An **FAQ** of collapsible (`<details>`) questions grouped into sections, content authored inline in the module (it can't be sourced from `docs/`: dev serves the raw module graph and `docs/` sits outside `site/`).
- A couple of small **diagrams** embedded in the relevant answers — the source wordlists merging into All Wordlists (with the live merged count), and the browser ⇄ file ⇄ construction-software sync bridge — plus a featured-tools strip, all rendered at open time from the live catalog.
- A **screenshot walkthrough** for wiring the two synced files into Ingrid, the far half of disk sync that Grawlix can't do for the user: the Grawlix-side syncs, then Ingrid's Word Lists pane, Personal List, and its diacritics/punctuation options.
  Its two PNGs under `site/img/` are the only screenshots in the app.
  Ingrid is covered because it reloads a changed file on its own, which is what makes the round trip feel live; Crossfire and Crossword Compiler read the same files behind a manual refresh and get a closing sentence, not their own walkthrough.
  Stripping accents and punctuation is advised **in Ingrid** rather than via Grawlix's Output format, so the files on disk stay rich — and because the two-way My Edits file is written as-is regardless ([`wordlists.md`](wordlists.md) § *Output format*), leaving no other place to do it.
- An **Acknowledgements** question (folded into the first section) crediting the third-party wordlist authors (rendered from the publisher catalog, minus John's own list) and Wordlisted, whose search catalog charted much of the tool gallery.
  The fuller, maintainer-facing license inventory (third-party deps, wordlist terms, verbatim MIT texts for the bundled icons) lives in [`THIRD-PARTY-NOTICES`](../THIRD-PARTY-NOTICES) at the repo root, kept there deliberately and not shipped with the deployed site.

Help is **deep-linkable at the `#/help` hash**, and every individual answer at `#/help/<slug>`: the `?` button sets the bare hash, a boot/hashchange sync (in `actions`) opens or closes the dialog to match, a slug expands that one `<details>` and scrolls it into view, and closing strips the hash (`history.replaceState`).
A hash rather than a `/help` path because GitHub Pages serves no path routes without the SPA 404 trick (§ *URL state*).
Every answer is slugged, not just the ones something links to, because the shareable unit of Help is an answer — pasting "here's how that works" into a chat is the common case, and a scheme that covers only some answers invites a second, ad-hoc one later.
An unrecognized slug opens Help with nothing expanded rather than erroring, so a stale link still lands somewhere useful.
Re-entering a slug while the dialog is already open expands and scrolls without re-rendering, which would collapse whatever else the reader had opened.
The dialog never opens on its own — there is no first-boot popup.

Two places link inward.
The **sync dialog** carries a footer link to `#/help/ingrid` and closes itself on the way, so the two dialogs never stack — sync is a decision surface (which file?) and the walkthrough is reading material, and the sparse decision dialog is the wrong place to inline eight steps and three screenshots.
Inside Help, the *How do I set it up?* answer links on to the Ingrid walkthrough, since the two halves of the job are naturally read in sequence.

The Help dialog is the only help surface, deliberately so: one scrollable dialog gathering everything help-shaped rather than a multi-page reference/onboarding system, and its FAQ coverage is treated as sufficient.

## URL state

The URL captures the user's active pipeline — each tool stack row in pipeline order, then the permanent Search bar's pattern (`search=`), match mode (`mode=full|start|end|word|span`), and the entries-table sort (`sort=`) — plus the open **entry panel** (`entry=`, § *Entry panel*) and the **length filter** (`length=`, [`pipeline.md`](pipeline.md) § *Length filter*).
Pasting a Grawlix link into a chat reproduces what the sender was looking at; refreshing the page lands you back where you were.
The scope and the score filter are the deliberate exceptions — see *Out of scope for the URL* below.

A small `Router` IIFE owns parse, serialize, and `history` writes — `replaceState` for pipeline/sort edits and for stripping the panel param in place, `pushState` for opening the panel (so Back closes it), and a `popstate` reconcile the panel listens to.

### Query-string URLs

Grawlix is one screen, so the query string carries the whole pipeline — `grawlix.wtf` bare, `grawlix.wtf/?anagram=CAT` with state.
By default an unrecognized query isn't remapped through an alias table — it just yields an empty pipeline, which can't lose data; whether a specific dropped key earns an alias instead is a per-change call (§ *Stable links*).

### Tool stack encoding

Each pipeline row serializes in pipeline order.
A tool's parameters spread across one or more adjacent query keys:

- **First param → the tool-name key.**
  `slug=value`, where the slug is the tool's catalog key (`anagram`, `regex`, …).
  This key always anchors the row, so it's emitted even when empty (`anagram=`) — an added-but-unfilled row survives reload.
  A param-less tool is a bare key (`palindrome`).
  All values pass through `encodeURIComponent` — Grawlix's pattern syntax (`?`, `#`, `@`, `*`, `[`, `]`, `&`) overlaps with URL reserved characters.
  A checkbox has no text to ride the slug, so a tool whose first param is a checkbox keeps the slug bare and writes the checkbox as its own key (`supervocalics&y`).
- **Successive params → their own adjacent keys.**
  A text param is `paramname=value`; a boolean (checkbox) param is a bare `paramname` when true.
  Both are omitted at their default (empty / false), so the common case stays short — Search with the match mode off is `search=cat`, with whole-entry on `search=cat&mode=full`.
  A param flagged `alwaysEncode` opts out and is written even at its default: a control with two equal readings and no "off" state — Remove string's `mode=all|one` — would otherwise make a shared link's behaviour depend on knowing which value absence stood for.
  A param flagged `encodeEmpty` is written even when empty: the `replace` of Search, Regex, and Phone search, whose bare `replace=` is delete mode (§ *The find/replace widget*) and must not collapse into "no replacement".
  This readable per-key form is preferred over folding params into one delimited value.
  (The retired `whole-word` bare key still decodes, as an alias for `mode=full`.)
- **Repeatable params → repeated keys.**
  A param flagged `repeat` holds a parallel array; Rebus's `string`/`symbol` are the first users, one string→symbol pair per array index.
  The groups serialize in index order — the first group's first value rides the tool-name key, every other value is its own adjacent key — so two Rebus pairs are `rebus=tool&symbol=Ⓣ&string=star&symbol=★`.
  Decoding *appends* each repeat key onto its array instead of clobbering, so the parallel arrays rebuild; an unfilled pair round-trips as `rebus=&symbol=`.
  This is what the per-key scheme buys over a delimited value — no value-internal delimiter to escape.
  Encode/decode live in [`app/url-codec.js`](../site/src/app/url-codec.js), a UI-free seam so they unit-test under node.
- **Row flags → bare positional keywords.**
  `all` (all-mode) and `not` (invert) are flags on the preceding row rather than params of it, so each is a bare reserved keyword the decoder binds to the row before it: `?letter_bank&all`, `?search=c%3Ft&not`.
  `not` rides at the tail of its row's params (`search=c%3Ft&mode=word&not`); the decoder binds a bare flag to the current row wherever it falls, so an older link with `not` mid-row still decodes.
  Like any row flag it must be distinct from every tool slug and param name.
  Both are dropped when the row can't take them — `all` when the tool declares no `group:`, `not` when the row isn't a filter — so a hand-written link never encodes a mode nothing honors.
- **Direction → the reverse slug.**
  A reversible tool reversed serializes under its reverse slug in place of the base one — `head_on`, `back_on` — so `?head_on=can` reads on screen as the reversed Head off it is; decode maps the reverse slug back to (tool, reversed).
  Retired pre-rename slugs — the count keys `behead`/`curtail` and the affix keys `add_prefix`/`remove_suffix`/… — live on as decode-only aliases onto the renamed tool plus its direction; the count keys digit-migrate (`?behead=3` → `???`) while the affix values stay literal.
- **Decoding is a three-way classify.**
  Each key is a tool name or reverse slug (starts a new row, its value is the first param), a reserved view-config key (`sort`, `sort-dir`, `entry`, `length`), or a successive param of the most recent row.
  For this to be unambiguous, **param names must be distinct from every tool name, reverse slug, and reserved key** — the one namespace rule the scheme rests on.
  (`entry` *is* several tools' first-param key, but a first param always rides its tool-slug key, so `entry=` is never emitted as a standalone key by a tool — only the panel emits it, and reserving it is safe.)
- **Order is significant.**
  Parameter order is pipeline order — `?search=cat&anagram=lindsey` runs Search before Anagram; the reverse runs them the other way.
  This breaks the convention that query strings are unordered, but the URL is mostly machine-generated and read back by Grawlix.
- **Repeated tools are fine.**
  Two regex rows become two `regex=` entries; their relative order is preserved.
- **The permanent Search bar is the pipeline's final row.**
  It serializes like any row, with one exception: its keys are elided when it's at default state (empty query, match mode off) *and* the preceding row isn't a Search tool.
  That keeps an untouched app at a bare URL (`grawlix.wtf`) while still letting an added Search tool round-trip — `[Search "foo", bar ""]` is `search=foo&search=`, distinct from a lone populated bar `search=foo`.
  On decode, the last row is the bar if it's a Search; otherwise the bar is at default.
  Multiple Search rows therefore round-trip, the bar always being the last of them.
- **Unknown keys are dropped** with a toast: *"That link references a tool that's no longer available."*
  A key that matches no tool, no reserved key, and no tool's param name is treated as a removed tool; the rest of the stack still renders.

### Sort encoding

`sort=` carries the entries-table sort as an ordered, comma-separated list of `key:dir` levels, highest priority first — `sort=count:desc,letters` sorts by Count descending, then breaks ties by Letters ascending.
Each level's axis depends on the chain's sort tier ([`pipeline.md`](pipeline.md) § *Sort axes per tier*): filter-only chains have `entry`/`length`/`score`, chains with a transform `entry`/`length`/`min-length`/`max-length`/`min-score`/`max-score`, grouped pipelines `count` plus the group columns and anchor/Entries axes.

`:dir` is elided when ascending (the default), so a lone ascending sort is just `sort=length`, and the whole key drops when the sort is the tier default (`entry` asc, one level).
`score desc` is `sort=score:desc`; `count:desc` then `letters` is `sort=count:desc,letters`.
Each level minimizes independently, so the common cases stay quiet.

Unknown axis tokens are dropped without a toast (no churn risk — the axes are a closed set, unlike the tool catalog); a level whose axis is valid in some tier but not the current one is remapped per [`pipeline.md`](pipeline.md) § *Sort axes per tier* (`reconcileSort`), and if every token is unknown the sort falls to the tier default.

**Old links keep working.**
Legacy links carry the sort in two keys — `sort=<axis>` plus a separate `sort-dir=<asc|desc>`.
A link still carrying `sort-dir=` is read as the legacy form: that direction applies to the single bare `sort=` token, or — with no `sort=` at all, since an old `entry desc` link was just `sort-dir=desc` — to the tier-default axis.
`sort-dir` is never emitted but stays a reserved decode key so those shared links don't rot (§ Stable links).

Sort persists across scope switches inside a session: it's a view-config preference of the user, not of the scoped wordlist.

### Entry panel encoding

The open entry panel rides a single `entry=<display>` key, the visible entry text (`display ?? norm`), URL-encoded — `grawlix.wtf/?entry=BAGEL`, or `?entry=BAGEL&search=cat` with a pipeline.
It's emitted **first** so a shared link reads cleanly, and it's a reserved decode key (above).
The display alone is enough: the norm is `toNorm(display)`, and the panel re-resolves the `(norm, display)` target through the worker.
Scope stays out — the panel is cross-wordlist, so a deep link opens correctly whatever scope the visitor has.

The panel writes history rather than just mirroring it: opening **pushes** a new entry (`?entry=…`), so the browser Back gesture/button closes it ([`entry-panel.md`](entry-panel.md) § *Opening and closing*); a UI close pops the pushed entry with `history.back()`.
A Prev/Next walk (§ *Keyboard navigation*) **replaces** rather than pushes, so the whole walk stays one pushed entry and Back closes the panel instead of rewinding member-by-member.
To know whether a given entry is ours to pop, `open` tags the pushed entry in `history.state` (`{ entryPanel: true }`); `openFromRoute` reads that tag, so a panel re-entered via Back/Forward closes by popping just like a fresh open — keeping the Forward button consistent instead of orphaning it.
The lone exception is a **cold deep link**: its entry is untagged with nothing of ours behind it, so closing strips the param in place (a `replaceState`) rather than navigating away from the app.
`Router.navigate`'s `replaceState` preserves `history.state` so a pipeline/sort edit can't wipe the tag.
`EntryPanel` reconciles to the URL on `popstate`, idempotently (our own back() and the help-hash both fire it, both must no-op).

The panel **slides** in however it opens — a click, an in-session Back/Forward, or a boot deep link.
`openFromRoute` takes an `animate` flag; a false value suppresses the slide by toggling a `no-anim` class around a forced reflow.
A route open is also **view-first** — it never auto-focuses a field (which would pop the mobile keyboard on a restore); that guard rides the same flag through both the synchronous and the worker-seeded focus paths.

A deep link or reload opens the panel **as soon as the app shell renders — ahead of `firstPaint`/`workerReady`** (`Router.openPendingEntry`, called right after `renderAll`): the panel synthesizes a bare target and seeds its fields from the worker (no clicked row to read).
It waits on none of the corpus build, which on a four-wordlist setup is a second-plus of worker CPU while a shared link's whole payload is the panel — so the entry text, the seven Search link-outs, and the Wikipedia/Wiktionary/thesaurus cards (plain fetches, no wordlist involved) land in tens of milliseconds instead of after the merge.
What shows at once and what waits on the corpus, with the shimmer placeholders and why the fields stay locked, is [`entry-panel.md`](entry-panel.md) § *Loading and clearing*; each worker-fed block holds its un-ready reply and re-asks on `whenWorkerCommitted()` (`ready` in [`worker-protocol.md`](worker-protocol.md)).
The splash deliberately stays up **behind** the panel (z-200 under its z-600) for that stretch: the table underneath is still empty, and a visible "0 entries" behind a panel about a real entry reads as a wrong answer rather than a pending one.
The splash keeps its logo centered in the full viewport and lets the panel sit over it.

**What's still loading has to say so.**
An empty field is not self-evidently a pending one — a blank Score reads as "this entry is unscored," which is a claim Grawlix hasn't earned yet — so the un-ready state is drawn, not left blank.
Beyond the placeholders [`entry-panel.md`](entry-panel.md) § *Loading and clearing* lists, the score combo's toggle disables alongside its field (left live, it offers a tier pick the arriving seed would silently overwrite), and "Appears in" keeps its heading over the shimmer bars rather than collapsing, since the gap would be both an unexplained hole and a shove when the real table lands.
Related entries is left to collapse: it is legitimately empty for many entries, so a placeholder there would promise content that may never come.
The retry that clears each placeholder also clears it when the retry *fails*, or a wedged worker would shimmer forever.
A value equal to its own norm is treated as a **bare** entry (display null) so the worker's bare fallback resolves the winner — otherwise a deep-linked lowercase entry wouldn't seed.
**A route open also resolves case-insensitively**, via the seed fetch's `bareFallback` (§ *`fetchEditSeed`* in [`worker-protocol.md`](worker-protocol.md)): a spelling absent from the merge falls through to the norm's rows, so `?entry=BAGEL` seeds off lists that spell it `bagel` and the panel re-titles itself to the entry as it actually exists.
An exact spelling still wins where one exists, so `?entry=Boney M.` round-trips to itself rather than collapsing onto `Boney M`.
Links are written by hand and by other apps, and crossword tooling writes uppercase — without this every such link opened on a blank score while its provenance table sat right below showing the entry plainly present.
**Create (＋) isn't routable** — a not-yet-existing entry has nothing to name — so it pushes a paramless history entry (Back-closable, but reload won't reopen it).

**A route open reveals its row in the table behind the panel.**
With no clicked row, the table would otherwise sit wherever it loaded — at the top on a deep link — and the entry the link names would be nowhere in sight when the panel closes.
So `openFromRoute` hands the target to the scroller (`revealRouteEntry`), which **centers** the row and, in the flat tier, adopts it as cursor + selection — the same landing a find-in-page hit gets, so Esc→Enter reopens it and arrow keys continue from there.
It scrolls **only when the row isn't already in view**, which keeps a Back/Forward reconcile from jumping away from the offset the browser just restored.
Finding the row is a worker question (`locate`, § *`locate`* in [`worker-protocol.md`](worker-protocol.md)) because main holds only its own window of a result that can run to hundreds of thousands of rows; the scan is exact-`(norm, display)`-then-same-norm, `findResultEntry`'s rule.
An entry the current filter or pipeline excludes answers `-1` and the table stays put — the panel still opens on it, since it resolves against the corpus rather than the result.
The reveal is **latched, not run inline**: boot opens the panel as soon as the shell renders, long *before* the first pipeline result exists to locate a row in (it precedes both the corpus build and the run — `renderMergedDetail` signals `firstPaint` ahead of awaiting that run), so the scroller consumes the latch at the tail of `setEntries`/`updateEntries`.
The browser's own history scroll restoration is no substitute for any of this: it fires only when a close pops to a prior entry (so a reload, never a pasted link), it lands on whatever offset the page had when the panel was opened rather than on the row, and it happens at close — too late to be what the visitor sees while reading the panel.

### Stable links: decide breakage case-by-case

URL keys are public, so renaming or removing a tool key breaks links already shared in the wild.
But a broken link costs a re-share, never data — so neither freezing every key forever nor breaking them freely is forced.
Breakage is a per-change judgment call, made by the user, not a blanket rule:

- **Flag every break.**
  When a change would rename or drop a tool slug or URL key, surface it before proceeding rather than deciding unilaterally.
- **The user picks the outcome** — keep the old form working or let it rot — case by case, weighing how likely that link is to be out there against the cost of carrying the alias.
- **To keep an old form working**, register its key in an alias table that maps to the new key (or to a sensible fallback) and `replaceState` to the canonical form on load.

Three aliases exist: the retired `whole-word` bare key (decodes as `mode=full`), the retired tool slugs in `LEGACY_SLUGS` (`behead`/`curtail` and the affix keys, § *Tool stack encoding*), both in [`app/url-codec.js`](../site/src/app/url-codec.js), and the legacy `sort-dir` key (§ *Sort encoding*).

### Router policies

- **Query string carries the pipeline; no path routes.**
  State lives in the query string (`?anagram=CAT`) rather than a path segment (`/anagram/CAT`): GitHub Pages serves `index.html` for `/` and ignores the query, whereas a real path would 404 without the SPA 404-redirect trick.
  With one screen there's nothing to route *to* — the query string is purely the pipeline's serialization.
- **`replaceState` only.**
  Stack edits never push a history entry; the back button leaves Grawlix instead of navigating within.
  The visible UI is the user's history — clearing the search or popping a tool row is the explicit undo.
  A back button would be redundant or actively confusing ("did I lose my whole stack?").
- **URL for shareable state, localStorage for personal state.**
  Search pattern, match mode, sort, tool stack, and the length filter live entirely in the URL during a session — no localStorage shadow.
  They describe *what the sender is looking at*, which composes meaningfully on the recipient's setup.
  The scope and the score filter are the exceptions: both are stored in localStorage, because neither is portable across users and both are standing preferences.
  Rationale in *Out of scope for the URL* below.
- **Updates synchronously on every change.**
  Every caller — typing, structural toggles, sort changes — replaces the URL immediately.
  `replaceState` is cheap and browsers rewrite the URL bar without animation, so there's nothing to throttle.
  Debouncing would also leave the URL briefly behind the visible state, so copying or refreshing mid-keystroke could yield a stale link.

### Out of scope for the URL

These are local-only:

- **Score filter** (one global range).
  Stored in localStorage, not the URL.
  Two reasons — written down so the question doesn't get re-litigated:
  1. **Scores aren't portable across users.**
     What counts as `60` depends on which wordlists you have loaded and how you've rescored them.
     There is no universal scale — even the "common" tier labels (great / good / fair / …) are themselves per-user via My Edits' scoring.
     A shared `score=60` filter would apply the sender's number to the recipient's scale and produce nonsense.
     The other URL params don't have this problem: a search pattern, a match mode, a sort axis, and a tool stack all mean the same thing on any setup.
  2. **It's a standing preference, not a query.**
     The dominant use is "filter the low-scoring junk out so I'm not wading through it" — that's a setting the user wants in place every visit, not something they re-enter each load.
     URL-bound state resets to empty on a fresh visit (no link to apply); localStorage carries it forward.
  3. **Length is the counterexample, and it travels.**
     The length filter (`length=`) sits in the same stats bar and takes the same range syntax, yet it *is* in the URL — because neither reason above applies to it.
     A length means the same thing on every setup (a 7 is seven grid squares, no matter whose wordlists are loaded), and it's a query about the slot you're filling right now, not a standing preference you want re-applied every visit.
     The split is the two reasons, not the surface the control sits on.
- **Scope** (`state.selected`).
  Stored in localStorage (sticky landing), never shared.
  A shared link carries only the pipeline; the recipient sees the same tools applied to *their* current scope (usually All Wordlists).
  The sender's scope doesn't travel — the recipient may not have that source, and graceful-degrade-to-All Wordlists is fine for the narrow case of sharing a scoped view.
  Encoding scope by publisher id was considered and rejected as not worth re-opening the stable-links surface.
- **Dialogs** (settings, etc.) — transient UI state.
  Open them how you opened them; close them when you're done.
- Scroll position, edit-in-progress state, transient popovers.

## Code structure

The app is authored as ES modules under [`site/src/`](../site/src/) — one entry, `main.js`, and a graph of ~75 small modules below it.
`site/index.html` is just a shell: a synchronous `<head>` FOUC script (sets the dark/light class before first paint — it must stay a plain non-module inline script, since module scripts are deferred and would reintroduce the flash), `<link>`s to `css/`, and a single `<script type="module" src="src/main.js">`.

### Layering: imports flow strictly downward

Modules are organized by **dependency layer**, and imports only ever flow *down* — a lower layer never imports an upper one:

```
core  <  engine  <  data  <  model  <  ui  <  app
```

- **`core/`** — leaf utilities with no app dependencies: constants, platform detection, the hand-rolled signals primitive, small string helpers.
- **`engine/`** — the pure, DOM-free, worker-ready core: normalization, ranges, search/regex compilation, the phrase segmenter, the tool catalog (each of the ~23 tools in its own `engine/tools/<slug>.js`, see below), the pipeline executor, and the pure stats/histogram cores.
  Nothing here touches `document`, `window`, `localStorage`, or `navigator`.
- **`data/`** — `state` plus *everything derived from it*: storage (IDB + localStorage), schema migrations, rescoring, merge, the state-reading stats/histogram wrappers, disk sync, persistence, publishers.
  The governing rule is that `data/` is state-and-derivations; `model/` is the thin band above it.
- **`model/`** — the thin domain band: tier-label logic (`scoring.js`) and the state-coupled score-display helpers (`score-display.js`).
  Small on purpose (rescoring lives *below* it in `data/`, not above — see § *Cycle-breaking* below).
- **`ui/`** — components, dialogs, scrollers, and rendering.
  Owns all DOM.
  The reusable pieces are catalogued in [`components.md`](components.md).
- **`app/`** — orchestration: the URL router and the action dispatcher (fetch/import/update, My Edits add/delete, merge & download, export, rename).

Two modules sit outside the layer stack.
`main.js` is a thin boot entry (imports everything, runs the ordered `boot()` — below).
`test-api.js` is the **only** every-layer importer: it assembles `window.__grawlixTest` from bindings across core/engine/data/model/ui/app, so `main.js` imports it *last*, after every layer it reaches into is initialized.

### Dev serves modules; deploy bundles them

The dev artifact and the shipped artifact are deliberately different, and that split is what keeps local development trivially simple.
**Dev serves the raw module graph statically** — any static server hands the tree to the browser, which walks the `import` graph itself.
There is no build step, no watch process, no bundler in the local loop: edit a file, refresh.
**Deploy bundles.**
`npm run build` runs esbuild from `main.js`, following every `import` into one tree-shaken, minified file, then minifies the HTML shell as before; esbuild touches `dist/` only.
The reason to bundle is cold-load performance — the unbundled graph waterfalls through ~75 small HTTP requests, while the bundle is one cacheable request.
The reason to bundle *only at deploy* is that dev doesn't pay the cold-load cost and benefits from editing the exact files the browser runs.
Bundling is behavior-preserving (concatenation, renaming, dead-code removal — never a semantic change), and the seam is continuously verified: [`playwright.config.js`](../playwright.config.js) parameterizes the served directory via `GRAWLIX_SITE_DIR`, and **CI runs the full suite against the bundled `dist/`** (`GRAWLIX_SITE_DIR=dist`) — the divergence is tested, not trusted.

The build was rejected from being a *dev-server* bundler (Vite et al.): in dev those transform files on request, so the workflow becomes "run the bundler" rather than "serve static files," colliding with the static-serve requirement.
Native modules in dev cost nothing because Grawlix is always behind an HTTP server anyway (ES modules are blocked over `file://`, fine over `http://`).

Which test runs need the bundled `dist/` is in [`testing.md`](testing.md) § *CI*.

### Importing defines; `boot()` does

The single load-bearing rule that makes the module graph work: **importing or evaluating a module only *defines* things.**
Every DOM build, every event listener, every `effect()` registration, every `window` touch runs from one ordered `boot()` in `main.js`.
(Pure, idempotent top-level computation — e.g. the `for` loops that backfill default `key`s on the tool params — is fine and stays put; the bar is *no DOM, no effect registration, no cross-layer reach at import*, not "no top-level statements.")

This matters because every top-level statement of a module runs *at import*, in dependency-graph order — so an import-time side effect becomes a fragile ordering constraint or a temporal-dead-zone error.
With imports side-effect-free, import order stops being a correctness concern, and the worker can import the tool catalog without a `document` to throw on.

The flip side: **the mount/boot order in `boot()` is an explicit, load-bearing contract.**
Each step assumes the prior ones ran — `configureX` injections before the components that call them, dialogs before `init()` opens them, app-shell components before `init()`'s first `renderAll`.
A wrong order mostly fails silently: nearly every `configureX` seam defaults to a no-op (table below), so a call that runs before its injection does nothing — a sync conflict prompt raised before `configureSyncDialogs` simply never appears.
The order is derived from the layer graph and commented at the one place it's wired (`boot()`).

### Cycle-breaking and the injection seams

Real module boundaries turn several couplings into illegal `import` loops.
The seams that break them:

- **Rescoring is `data/`, below merge — not `model/` above it.**
  The tempting split ("merge is data, rescoring is domain logic above it") inverts the real dependency: `buildCorpus` (`engine/corpus.js`) *consumes* rescored entries to bucket contributors, so merge depends on rescore.
  Putting rescore in `model/` (data < model) would make `data/merge` import upward.
  Resolution: rescoring is a per-wordlist transform over `rawEntries` — it *is* derived-from-state data — and lives in `data/rescoring.js`, below `data/merge.js`.
  `editsLegend` / `getWordlistDefaultRules` live there too: they read `state.scoring` and `getPublisher` (both `data/`), so "reads `state.scoring`" — not "is about scoring" — decides the layer.
  `model/` shrinks to tier labels and the state-coupled display helpers; nothing in `data/` imports `model/`.
- **The data⇄ui seam.**
  Disk sync needs to repaint the sync indicators (ui) and raise permission/conflict dialogs (ui), but `data/` must not import `ui/`.
  Two inversions: a targeted status repaint routes through a **dedicated `syncStatus$` signal** in `data/state.js` that the ui subscribes to in `boot()` (`effect(() => { syncStatus$.get(); renderSyncIndicators(); })`) — deliberately *not* `cacheVersion$`, which drives the full-table repaint and would be a sledgehammer for a status-dot change.
  And dialogs are raised through an **injected callback** (`configureSyncDialogs({ alert, resolveConflict })`), wired at boot.
  So `data/disk-sync.js` imports no ui.
- **The `configureX` injection pattern, generally.**
  Wherever a lower module would otherwise need to call upward (a ui view reaching an `app/` action, or any module reaching a not-yet-carved dependency), the lower module exposes `configureFoo({...})` and `boot()` wires the real functions in.
  This is how ui views invoke `app/` actions without importing `app/`, and it's the same shape as the segmenter's I/O injection below.
- **The invalidation graph.**
  Cache invalidation is composed downward: each owning module exports its own narrow invalidator (`engine/histogram` → `invalidateHistogramLayout`, `data/rescoring` → `invalidateRescoredCache`, `data/merge` → `invalidateSourceCounts`), and `data/invalidate.js` imports them downward to compose `invalidateWordlistCaches`.
  (The pipeline's own prefix cache lives worker-side and invalidates by corpus-object identity, so it needs no main-thread invalidator here.
  The caches themselves and their contracts are § *Caches*.)

Every `configureX` seam, with what injects it and what it does before then.
The worker-side seams are wired at the top of `engine/worker.js` or on its `configTools` message, since the worker never runs `boot()`.

| Seam | Module | Injected | Default before injection |
|---|---|---|---|
| `configurePipelineWorker` | `ui/pipeline-worker.js` | `baseURL: import.meta.url` (main.js's) | `null`: spawning the worker throws |
| `configureSyncDialog` | `ui/dialogs/sync.js` | `WordlistActions` | no-op |
| `configureConfigureWordlist` | `ui/dialogs/configure-wordlist.js` | `addNewWordlist`, `fetchWordlist`, `ingestFile` | no-op |
| `configureImportGuide` | `ui/dialogs/import-guide.js` | `ingestFile` | no-op |
| `configureRendering` | `ui/rendering.js` | `refreshDerivedDisplays`, `deleteFromEdits`, `attachExternalEditHandlers`, the score-range, length-range, and Share HTML builders | no-op; builders return `''` |
| `configureAppView` | `ui/app-view.js` | `navigate` (`Router.navigate`) | no-op |
| `configureEntriesTable` | `ui/entries-table.js` | `navigate` (`Router.navigate`) | no-op |
| `configureToolStack` | `ui/tool-stack.js` | `navigate`, `showRowError` (`ErrorPopover`), `attachHelpPopups` | no-op |
| `configureRescoreEditor` | `ui/rescore-editor.js` | `bakeMenuOpts`, `bake` | no-op |
| `configureManagePanel` | `ui/manage-panel.js` | `deleteWordlist` | resolves false |
| `configureDiscoveryBanner` | `ui/discovery-banner.js` | `runImport` | no-op |
| `configureSettings` | `ui/dialogs/settings.js` | `checkForUpdates`, `regenerateFillOutputs`, `getAutoUpdate` | no-op (`getAutoUpdate` → true) |
| `configureSyncDialogs` | `data/disk-sync.js` | `alert` (`showAlert`), `resolveConflict` (`showEditsConflict`) | no-op; a conflict resolves to `'device'` unasked |
| `configureMirrorSerializer` | `data/disk-sync.js` | `fetchWorkerSerialize` | `null`: a mirror write serializes on main, and All Wordlists retries |
| `configureEditsMerger` | `data/disk-sync.js` | `mergeDisk` (`fetchWorkerMergeDisk`) | `mergeDisk` resolves `null` |
| `configureIO` (imported as `configureSegmenterIO`) | `engine/segmenter.js` | the worker's own `idbGet`/`idbPut` | `null`: loading the unigram corpus throws |
| `configureIO` | `engine/phonetics.js` | the worker's own `idbGet`/`idbPut` | `null`: loading CMU throws |
| `configureSpaceOutBigrams` | `engine/segmenter.js` | `SPACE_OUT_BIGRAMS` | `null`: unigram-only ranking |
| `configureCommonWords` | `engine/morphology.js` | `COMMON_WORDS`, `LEMMA_BASES` | empty sets |
| `configureExecutorYield` | `engine/executor.js` | a `setTimeout(0)` yield every 30 ms | `scheduler.yield()`, which starves the cancel message |
| `configureUmiaq` | `engine/tools/umiaq.js` | `maxResults` from `configTools` | the mobile cap |
| `configureWeave` | `engine/tools/weave.js` | `maxResults` from `configTools` | the mobile cap |

The `configure*ForTest` exports in `ui/pipeline-worker.js` are test hooks, not seams.

**Intra-`ui/` circular imports are permitted.**
The strict rule is *cross-layer* acyclicity (ui ↛ app, data ↛ ui, engine stays pure), not intra-`ui` acyclicity.
The ui core — scope-selector, rescore-editor, rendering, tool-stack, app-view, entries-table — is genuinely mutually recursive, and because imports are define-only they resolve as live bindings even in a cycle.
Carving those together with circular imports is a deliberate choice over force-inverting every cycle into a callback seam; the cheap one-directional seams (e.g. the severity builders living in the leaf `ui/sync-indicators.js`, with `renderSyncIndicators` up in `ui/scope-selector.js`) are used where they're natural, and circular imports where they aren't.

### The pure engine and the worker boundary

The `engine/` layer being DOM-free is what lets the pipeline executor run in the worker: the worker `import`s `engine/` directly and runs the identical module text the main thread would, so a tool can't drift between threads.
The concrete main↔worker interface — data ownership, the message protocol, and the cancellation policy — is specified in [`worker-protocol.md`](worker-protocol.md).
The one function that straddles the DOM line is the unigram-corpus loader: it mixes pure decode with I/O, and `localStorage` isn't worker-safe.
Rather than let the engine reach into `data/storage` (an engine→data upward edge), `engine/segmenter.js` takes its I/O **injected** — `configureIO({ idbGet, idbPut })`, which `engine/worker.js` imports as `configureSegmenterIO` and calls once at startup with its own handle on the same IndexedDB store; the loader closes over the stashed deps and records the fetched size itself (`UNIGRAM_CORPUS_SIZE_KEY`).
`engine/phonetics.js` takes the CMU dictionary's I/O the same way.
A tool's `prepare` then calls the segmenter's own loader (an engine-internal call), never `data/`.
The corpus *mutators* — `setUnigramCorpus` / `invalidateUnigramCorpus` — are exported setters because ES modules forbid reassigning another module's `let` from outside.
`invalidateUnigramCorpus` is the corpus's `invalidate` hook in the data-asset registry (`engine/assets.js`), which the worker calls to reap an asset its stack no longer needs or to drop one its remote-freshness check finds changed; `setUnigramCorpus` is the Test API's stub (the worker's `__testSetUnigramCorpus` message).

### Per-tool files

Each tool is its own `engine/tools/<slug>.js` that `export default`s its definition and imports only down-layer modules plus `engine/tools/shared.js` (cross-tool helpers).
`engine/tools.js` is a thin **assembler**: it imports all the per-tool definitions, builds the ordered `TOOLS` catalog and its metadata (`TOOL_CATEGORIES`, `FEATURED_TOOLS`), runs the param/column key-backfill, and exposes `makeToolRow` / `normalizeParams` / the pure `groupColumnCSS()`.
Per-tool files never import the assembler, so there's no cycle.
(The catalog *content* — every tool's icon, name, description, status — is owned by [`tools.md`](tools.md), not the code.)

### Stored data is unchanged

The module split is a pure code reorganization: no `meta`/IDB shape change, so no `SCHEMA_VERSION` bump and no migration.
Every `localStorage` key keeps its exact `grawlix_` string; URL keys and tool slugs are untouched.
Existing users notice nothing.

### Build settings that the worker forced

- **esbuild multi-entry for `engine/worker.js`.**
  The worker can't share the main bundle's scope, so `build.js` emits it as a second entry point, its outfile mirroring the source path so the literal `new Worker(new URL(...))` spawn URL resolves the same against `site/` and `dist/`.
- **The corpus loader fetches its own data.**
  The unigram-corpus seam landed as injected-I/O rather than ship-the-map: the worker opens the same per-origin IndexedDB store directly and decodes the corpus itself (the segmenter's `configureIO`, above), instead of the main thread building the frequency map and shipping it.
- **Source maps ship.** esbuild emits them cheaply (`sourcemap: true`), so a production stack trace points back into source rather than minified bundle code.

## Caches

Wordlists can be hundreds of thousands of entries.
The merged and scoped corpora — the one bulk thing big enough to freeze a thread — live in the worker ([`pipeline.md`](pipeline.md) § *Cooperative runtime*; ownership and freshness rules in [`worker-protocol.md`](worker-protocol.md)), so the caches that protect *building* and *querying* a corpus live there too.
Main keeps only small caches: per-wordlist rescore caches that feed My Edits' edit path and the few single-source derived fallbacks, the worker's shipped per-config summaries, and the scroller's render-window caches.
Each exists to protect a specific invariant against a specific freeze.

**Worker-side: the owned corpus and its build caches.**
The worker holds `ownedBuilt` (every configured source's rich rescored wordlist), `ownedMerged` (the enabled-only deduped merge — feeds the config summaries regardless of active scope), and `ownedCorpus` (the active-scope corpus the pipeline executes against).
Each entry's index into `ownedCorpus.entries` is stamped onto the entry itself as an `_i` slot — the flat result encodes survivor positions from it — **once per corpus rebuild**, never per run (a per-keystroke 1M-entry restamp is exactly the lag this design removes), kept strictly paired with `ownedCorpus`.
Why it lives on the entry rather than in a side `Map` is in [`pipeline.md`](pipeline.md) § *The worker owns the corpus*.
`ownedCorpusFresh` gates whether a run/fetch may serve from `ownedCorpus`: a `syncConfig` clears it synchronously, so a run dispatched in the rebuild gap defers (the deferred-run queue, [`worker-protocol.md`](worker-protocol.md)) rather than enriching from stale data.
Within a corpus build the worker caches compiled rescore intervals and per-norm lookups.
The pipeline **seeds straight off `ownedCorpus.entries`** — an undecorated row stays the bare entry ([`pipeline.md`](pipeline.md) § *Pipeline execution*), so a filter-only run materializes no per-entry seed chain at all.
The worker's result caches (finished results, prefix tiles, partial runs) and their corpus-identity invalidation are in [`pipeline.md`](pipeline.md) § *Streaming results*; the worker state itself is in [`worker-protocol.md`](worker-protocol.md).

**Main-side caches.**
Small, and none is a corpus:

| Cache | Where | Derived from | Cleared by |
|---|---|---|---|
| `wordlist._rescored` | per-wordlist (`engine/rescore.js`) | own `rawEntries` + `rescoreRules` | `invalidateRescoredCache(wordlist)` |
| `wordlist._rescoredByNorm` | per-wordlist | `_rescored` (`norm` → every variant) | `invalidateRescoredCache(wordlist)` |
| shipped all-sources badge axis (`_shippedAxis`) | module (`data/derived.js`) | the worker's `selfReady`/`editAck` axis, version-guarded | replaced by a newer-version `setShippedAllSourcesAxis` |
| shipped scoped histogram layout (`_shippedScopedLayout`) | module (`data/derived.js`) | the worker's per-run scoped layout, scope-keyed | replaced by the next run's layout; scope-key guard rejects a stale scope's |
| shipped config counts (`_shippedSourceCounts` / `_shippedMergedCount`) | module (`data/merge.js`) | the worker's `selfReady`/`editAck` summaries, version-guarded | replaced by a newer-version `setShippedConfigCounts` |
| `_layoutCache` | module (`engine/histogram.js`), keyed `scoped:<key>` / `all` | a scope's score distribution | `invalidateHistogramLayout()` (called from `invalidateRescoredCache`) |
| scroller `_winCache` / `_groupWinCache` | per-`EntriesScroller` instance | the worker's shipped rows / group rows, by index | runId change (a new result re-orders everything); bounded + evicted |

The per-wordlist `_rescored*` caches are a **My-Edits-only** thing on main: `getRescoredEntries` caches `_rescored` when My Edits is downloaded or baked, and that is the only resident source.
Every other source's rescore is the worker's job — the histogram axis, the merge, the edit plan, and the provenance table all come from it — so main builds no non-Edits `_rescored*`.
The few main reads that need a non-Edits source's bytes (a bake, a not-fresh download/mirror fallback) re-read its IDB text transiently and discard.
These caches are not the corpus — the worker builds its own from the same IDB text and the same `engine/` code, so the two never need to agree by synchronization.
The shipped-value holders are the inverse: small results the worker computes once per config (the badge axis, the per-config counts) and the histogram layout it computes per run, cached on main only so a display can read them without a round-trip; each is **version-** or **scope-keyed** so an async-arriving value can't overwrite a newer one or be read against the wrong scope.

Two composite invalidation helpers remain:

- **`invalidateWordlistCaches(wordlist)`** — a wordlist's `rawEntries` changed: clear its `_rescored*` and (via `invalidateSourceCounts`) the histogram-layout cache.
- **`invalidateSourceCounts()`** — narrower (order/enabled/name changes that don't touch `rawEntries`): just `invalidateHistogramLayout`.
  It touches no merged cache, because main holds none; the worker rebuilds its corpus (and drops its prefix tiles by corpus identity) on the `resyncWorkerConfig` the same change fires.

**The scroller windows the result; it holds no corpus.**
Rendering is asynchronous ([`pipeline.md`](pipeline.md) § *Cooperative runtime*): the flat scroller keeps `_winCache` (rich rows by index, seeded from the result's inline first window, runId-invalidated, bounded and evicted) and the grouped scroller keeps `_groupWinCache` (decoded group rows by index, same lifecycle).
A miss renders a shimmer skeleton and fetches the window (`fetchRows`/`fetchGroups`); a new run bumps the runId, which clears the cache and re-seeds it from the new inline window.
The caches are scoped to the live scroller instance and a per-request sequence number drops superseded fetches — they hold no authority, just a bounded view of what the worker owns.

**Read live, don't snapshot.**
A rendered row holds a `wordlist` reference (resolved from the shipped `sourceId`), not copied-out display fields like `name`, so a rename propagates through the cosmetic effect without invalidating any data cache.
The virtual scroller follows the same convention — `currentWordlist` is a ref, not a name string.

**Canonical keys throughout.**
`_rescoredByNorm` and the worker's `norms` are keyed by `wlEntry.norm`, the canonical letter form computed once at parse, so construction allocates no extra strings and lookups never re-normalize; the worker's `byKey` keys by `mergeKey(norm, display)` for full (norm, display) disambiguation.

**Hot path: switching wordlists.**
A scope switch posts `setScope`; the worker rebuilds `ownedCorpus` from its resident `ownedBuilt` **synchronously** (no IDB read, no corpus crossing the boundary), and the scope's run then renders the new windows.
The freeze a main-resident corpus left here — re-shipping or re-resolving a corpus on the main thread — is gone because the corpus never leaves the worker.

**Hot path: editing rescore rules.**
A rule commit clears the source's `_rescored*` and fires `resyncWorkerConfig`, so the worker rebuilds its corpus with the new mapping off-thread behind the busy indicator; `compileRescoreRules` compiles the rules into intervals once (in both realms) so the per-row `rescoreEntry` walk reads compiled intervals rather than re-parsing strings — for Broda-sized wordlists (~500K entries) millions of regex calls saved per build.
While scoped to the edited source with the rescore editor open, the table itself is the live preview — rule-changed rows render the `raw → rescored` arrow ([`wordlists.md`](wordlists.md) § *Rescore and scoring*) — so there's no separate preview scroller to feed.

**Hot path: editing My Edits.**
A score/comment edit, a new-entry add, or a delete routes through `applyEditsChange(edits, mutate)`: it applies the mutation to My Edits' resident `rawEntries`, drops My Edits' own derived caches (`invalidateRescoredCache`), and refreshes the count/legend displays — main holds no merged corpus to patch (the worker's prefix cache is invalidated worker-side by the splice's corpus-identity purge, not from here).
The corpus update is the **worker's**: the caller fires an `editEntry`/`deleteEntry` command alongside, and the worker splices the affected norms into `ownedMerged` (and the scoped `ownedCorpus` when scoped to My Edits) in O(affected norms), writes the My Edits IDB itself, and ships back the refreshed per-config summaries on the ack ([`worker-protocol.md`](worker-protocol.md)).
When the edit leaves each norm's variant set intact (a score/comment change), the splice reconciles fields onto the existing row objects in place and keeps the worker's prefix tiles, so the re-run reuses the cached tool output instead of re-running the stack.
A **respelling** — spacing, case, or punctuation, same norm — patches in place too when the displayed result is a Search-only flat list and the worker proves (by re-testing the respelled row against the search, and reading the old verdict off the retained join) that no row joins or leaves the result: the worker swaps the new rows into the norm's existing slots, so positions hold, and main reprojects exactly as for a score edit.
The patch is what keeps the reader's place: a re-run re-streams the search, and a first streamed snapshot shorter than the scroll position shrinks the page and clamps the scroll.
Any other stack, a flipped verdict, or a live run keeps the replacing splice and the re-run.
And when that same key-stable edit lands while a tuple search (Umiaq) is still *streaming*, main skips the re-run entirely (`refreshAfterEdit`): the worker's `replaced: false` ack confirms the in-flight run already reflects the splice — live getters carry the new score and tuple completion re-sorts from scratch — so the stream rides through the edit rather than restarting the expensive search.
A reshaping edit, or one that lands after the run has settled, re-runs as usual (the settled re-run is the cheap cache-backed path above; only the tuple tier rides, because flat/transform completion adopts the streamed result rather than re-sorting).
Keeping My Edits' `rawEntries` resident on main is what lets the edited row paint optimistically before the ack lands; everything else about the edit is a command to the one owner, so there is no second winner-resolver on main to keep bit-for-bit in sync with the worker's merge.

**Hot path: typing in search.**
A keystroke re-runs the pipeline on the worker, which seeds the whole user stack from its longest prefix tile and re-runs only the search row ([`pipeline.md`](pipeline.md) § *Streaming results*), shipping a survivor count plus an inline first window ([`pipeline.md`](pipeline.md) § *Cooperative runtime*).
Main does no per-keystroke filtering or sorting over hundreds of thousands of entries — the scroller renders the window the worker sends and fetches more as it scrolls.
The two costs that would dominate a main-thread filter (normalizing each entry, re-sorting the survivors) are the worker's, and the worker pre-sorts the flat survivors so main never re-sorts.

### Reactivity

Structural state and the view layer are reactive (signals + effects); the perf-critical caches stay imperative.
The split mirrors what production signal frameworks (Solid, Svelte 5, Preact signals) do internally.

A pure-reactive design — one big `merged$ = computed(() => buildMerged(sources$))` — would re-derive the whole merged wordlist on every change, and on main that derivation doesn't even live here: the corpus is the worker's ([`pipeline.md`](pipeline.md) § *Cooperative runtime*).
So reactivity on main is about *propagating a config change to the worker and repainting the view*, not rebuilding data.
A config-affecting mutation bumps a signal, an effect re-syncs the worker and refreshes the lightweight derived displays, and the result re-renders through the windowed scroller as the worker's fresh rows arrive.
The hybrid model keeps reactivity for the 90% of state where it doesn't fight performance and leaves the imperative caches (above) alone.

**The signals primitive** is hand-rolled at ~50 lines in `core/signals.js` (no runtime framework dependency — the only build-time tool is esbuild, which bundles but ships nothing into the page):

- The API is the standard `signal`/`get`/`set`/`effect` shape, plus two additions for the in-place-mutation case: `peek` reads without subscribing (so incidental reads inside an effect don't accidentally subscribe), and `bump` notifies even when the reference is unchanged (for array/map mutations like reordering `sources`).
  `runBatched` coalesces a multi-field write into one effect run per subscriber.
- No automatic dependency cleanup on re-runs — effects accumulate subscriptions.
  Acceptable for grawlix's small, stable graph.
- No `computed` primitive.
  The imperative caches play that role.

**What's reactive:**

- `sources$` — the wordlist array.
  The cosmetic effect subscribes; reorder/add/remove call `sources$.bump()` after splicing.
- Per-wordlist cosmetic fields: `name$`, `icon$`, `url$`, `publisherId$`.
  Each wordlist exposes both the signal (`wl.name$`) and a peek getter / set setter on the plain field (`wl.name`).
  `wrapWordlist(wl)` installs them at every wordlist-creation site (the names live in `REACTIVE_WORDLIST_FIELDS`).
- `cacheVersion$` — the bridge between layers.
  Bumped by helpers that change config-affecting state (a genuine source mutation: enable/disable, reorder, rescore-rule edit, import, delete); the render effect subscribes, and every bump re-syncs the worker config.
- `pipelineVersion$` — bumped by tool-stack/search changes (a keystroke, a tool add/remove/reorder, a tool-param edit); the pipeline effect subscribes.
  These re-run the pipeline but don't touch the sources, so they stay off `cacheVersion$` — whose cache branch would needlessly `resyncWorkerConfig` (rebuilding the worker's corpus) for a change that didn't alter it.
- `configSummary$` — bumped when the worker's shipped per-config summaries land asynchronously (the badge axis, the X-of-Y counts, the merged total; via `setShippedAllSourcesAxis`/`setShippedConfigCounts`).
  The config-summary effect subscribes and repaints just the count/legend/badge displays, separately from `cacheVersion$` so an arriving summary can't re-trigger the re-sync that produced it (an infinite loop).
- `syncStatus$` — the data→ui inversion seam: disk-sync repaints route through this signal (main.js's `effect(() => { syncStatus$.get(); renderSyncIndicators(); })`) rather than `data/` calling `ui/` directly, which would point an import upward.
- `errorMarks$` — the same inversion for the ⚠ tool-row marks' async channel: the pipeline worker bumps it when it writes or clears a row's runtime `_error`, so the marks repaint without `pipeline-worker.js` importing the tool stack.
  Kept off `pipelineVersion$` so an `_error` write doesn't spuriously re-run the pipeline.

Sort and score-range aren't on the global `state` object — they live inside `AppView`'s closure.
The screen owns its own UI state; the handlers it exposes update the closure variables and reproject the displayed result (a sort-axis or score-range change re-derives the view over the worker's retained join, no re-join — [`pipeline.md`](pipeline.md) § *Streaming results*), no effect needed.
The search query is the exception among the screen's own inputs: it rides in the Search bar's stack row, and a keystroke bumps `pipelineVersion$`.
(Scope is global too: `state.selected` drives the worker's `setScope` and the scope-keyed derived holders.)

Per-wordlist field categories beyond the cosmetic four:

- **Config-affecting** (`enabled`, `rescoreRules`, `rawEntries`) — plain properties.
  Mutate via the helper (`setWordlistEnabled`, etc.) so it invalidates the right caches and bumps `cacheVersion$` (which re-syncs the worker).
  Never assign directly — there's no signal to fire, no re-sync, and the worker's corpus silently goes stale.
- **Transient** (`_loading`, `_updateAvailable`, `lastUpdated`, `fetchedSize`, `_rescored`, `_rescoredByNorm`, `originalFilename`) — plain properties.
  Set directly.
  Anything that displays them updates as a side effect of the surrounding flow (e.g. `applyWordlistText` ends with the render effect dispatching panel updates because it batched a `repaintAfterCacheChange`).

**The five effects** (all wired in `setupRenderEffect`, plus the sync-status effect in `main.js`):

- **Render effect** reads `cacheVersion$`.
  First run does the initial paint at the restored scope.
  Subsequent bumps refresh derived state in place: `refreshSourceCounts` drops the histogram layout and re-reads the shipped counts, **`resyncWorkerConfig` re-syncs the worker** (every `cacheVersion$` bump is a config change, so the owned corpus can't go stale-but-fresh), the selector and discovery banner repaint, `refreshDerivedDisplays` updates the scoring legend and stats bar, then the scroller re-runs via `refreshMergedScroller`.
- **Pipeline effect** reads `pipelineVersion$`, re-runs the pipeline, and refreshes the scroller (whose `onFilterChange` repaints the stats bar).
  It deliberately omits `refreshSourceCounts` *and* the re-sync: a tool-stack/search change leaves the sources untouched, so re-syncing the worker's corpus would be pure waste.
  That separation is the whole reason the two signals exist; folding them into one would re-sync the corpus on every keystroke.
- **Cosmetic effect** reads `sources$` and every wordlist's `name$`/`icon$`/`url$`/`publisherId$`.
  Any cosmetic change re-renders the selector and the visible scroller rows, whose Sources column draws each list's icon.
  No cache or corpus touched — rendered rows resolve their source by `sourceId` and read the name live.
- **Config-summary effect** reads `configSummary$`.
  The worker's per-config summaries arrive *after* the `cacheVersion$` bump that re-synced (the cache branch already painted with the previous shipped values), so this repaints the count displays, scoring legend, and stats bar once the fresh values land.
- **Error-marks effect** reads `pipelineVersion$` and `errorMarks$` and repaints the tool rows' ⚠ marks.
  The two signals are the two error channels: a parse error is a pure function of the params, so it rides `pipelineVersion$` and updates live on every keystroke; a runtime error is the worker's, so it rides `errorMarks$`.
  Reacting to the inputs rather than to a run resolving is what keeps a mark from lagging a superseded run — a keystroke supersedes the in-flight run, and a superseded run never settles, so a settle-gated mark would strand a stale ⚠.
  Freshly built rows (panel mount, tool add/remove/reorder) self-init their marks at build time; the effect covers the state changes that *don't* rebuild the DOM.

**The edit path repaints directly, not through `cacheVersion$`.**
`applyEditsChange` doesn't bump `cacheVersion$`: a per-entry My Edits change drives the worker `editEntry`/`deleteEntry` command (an O(affected-norms) splice, not a config rebuild), and the ack's refreshed summaries repaint via `configSummary$`.
Routing the edit through the render effect would `resyncWorkerConfig` — a full off-thread corpus rebuild from IDB — for a change the command already applied surgically.
So the edit path invalidates My Edits' own caches and refreshes the derived displays directly, and lets the command + ack carry the corpus and the summaries.

### Mutation helpers

Every state mutation goes through a helper that bundles the right invalidation, persistence, and (where needed) `cacheVersion$` bump.
Call sites read like statements of intent:

```js
setWordlistName(wl, newName);
setWordlistEnabled(wl, !wl.enabled);
setWordlistRescoreRules(wl, rules);
reorderSources(fromIdx, toIdx);
```

Helper bodies come in two shapes:

- **Cosmetic** (name, icon, url, publisher) — set the signal, persist.
  The cosmetic effect re-renders.
- **Config-affecting** (enabled, rescore rules, source order) — set the field, persist, call `repaintAfterCacheChange()` which bumps `cacheVersion$`.
  The render effect's cache branch re-warms the derived caches, re-syncs the worker config, and repaints.

The alternative — sprinkling `invalidateX()` and `repaintY()` calls at every mutation site — concentrates the discipline of "what does changing X require?" at every caller.
The helper-plus-effects shape concentrates that discipline in one place per field, and "forget to repaint" stops being a category of bug because the effect handles dispatch as long as the right signal got bumped.

`batchUpdate(fn)` coalesces a multi-field save (the configure-wordlist dialog can change up to five fields at once, and `applyWordlistText` batches its prelude similarly) into one effect run per subscriber.
Signal writes inside a batch queue their subscribers in `_batchedEffects`; any `repaintAfterCacheChange` calls inside set a deferred bump flag, and `persistMeta()` calls set a deferred persist flag.
At the end of the batch persistence runs once, the cache bump fires once, and the queued effects each run once.

## Open questions

### Routes for Settings?

Grawlix has no path routes (§ *URL state*); state lives in the query string.
**Help** is the one routed dialog — deep-linkable at the `#/help` hash, per-answer at `#/help/<slug>` (§ *Help*) — chosen because a help page is something people share and bookmark.
Settings and the transient confirms/alerts/downloads stay unrouted; whether Settings should also route is the open question here.

Arguments in favor of routes for setup: setup screens are *places* users spend real time, URL-addressable means deep-linkable and reload-safe, narrow viewports turn modals into full-screen routes anyway.
Currently sticking with dialogs because they match the existing codebase idiom.
Worth revisiting if the dialog-as-workspace feel becomes a friction point — particularly at narrow viewport widths, where a full-screen modal is essentially a route in disguise.
Notes for that revisit: bookmark/share-setup-state is unlikely (so deep-linking isn't a strong driver, just reload-safety); the back button does default browser behavior; the header stays a fixture with no dynamic content (no breadcrumbs).
*"Routes for everything" — including confirms — was considered and dropped as too heavy-handed.*

## Non-features

Things explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL encodes.
  No "save my exploration" feature, no session restore.
- **No cross-wordlist comparison.**
  "Words in JK but not XWI" set-difference views are not a real workflow.
- **No scratchpad / working set.**
  My Edits is the only persistence concept.
- **No batch of independent searches.**
  Serial single queries are fine.
  Umiaq's `;` tuple search is one query whose patterns bind together ([`umiaq.md`](umiaq.md) § *Systems and tuples*), not a batch.
- **No *negated* transforms or groups.**
  The `not` flag is filters-only ([`pipeline.md`](pipeline.md) § *Inverting a filter*); reversing a transform's *direction* is a separate shipped feature ([`pipeline.md`](pipeline.md) § *Inverting a transform's direction*).
  A transform's negation is coherent — "keep the inputs it produced nothing for", so `¬ Space out` is *entries that can't be spaced out* — but it flips the row's kind mid-pipeline and stops the chain growing, which the atom model would have to absorb for a payoff nobody has asked for.
  A group's is "in no surviving cluster" (words with no anagram), which reads well but needs a new engine path to diff the buckets against their input and then un-groups the result.
  A record's lanes are positional parts of one solution, so Umiaq has no verdict to negate at all — that one is likely permanent.
  Revisit the first two only if a real workflow surfaces; the `row.inverted()` gate already keeps a stray flag inert, so neither can arrive by accident.
- **No quick-fix links on tool rows.**
  A `def.quickFix(params)` hook once offered a one-click repair for params that are *valid* but quietly under-report — the counterpart to the `⚠` channel, which covers params a tool can't run.
  Umiaq was the only taker: *Allow empty variables* appended `|V|>=0` where its non-empty floor was hiding matches, and [`umiaq.md`](umiaq.md#every-variable--and-a-c)'s `|*|>=0` says the same in one clause.
  The trigger fired on nearly every query, since a bare `AB;BA` declares no floors, so the link read as chrome.
  A hazard that pervasive belongs in the syntax and the docs.
- **No recent-searches strip.**
  Search history is not preserved or surfaced.
- **No two-stack comparison UI.**
  Editing in place on the existing input (e.g., toggle Anagram between LINDSEY and LINDSEYS) handles it via live re-execution.
