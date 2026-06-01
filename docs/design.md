# Design

The shape of Grawlix's UI and the architectural choices behind it. The *what* (user-visible behavior) lives in [`manual.md`](manual.md); this doc covers the *why* — what alternatives were rejected, what constraints shape things — plus architectural surfaces a contributor needs to orient.

This is the singular home for distilled design content. As plans ship, the `distill-design-doc` skill folds them into this file (and `manual.md` for user-facing surface).

## Workspace and sidekick

Constructors use Grawlix in two modes that share one UI:

- **Workspace** — typical during theme generation. The user lives in Grawlix: plays with tools, searches and filters the wordlist, grooms My Edits. Sessions are longer; exploration is open-ended.
- **Sidekick** — typical while filling a grid in another tool (Crossfire, Ingrid, Crossword Compiler, Crosserville). The user pops over to look something up, rescore an entry, type a comment, and goes back to filling.

Neither mode is primary. The workspace-leaning design accommodates sidekick mode for free as long as load is fast and chrome isn't loud — sidekick is just "brief use, leave."

Lookup features (definitions, NYT crossword history, semantic search; see [`future/lookup.md`](future/lookup.md)) are differentially valuable to constructors using grid software without built-in lookup. Crossfire and Crossword Compiler are the populations that benefit most; Ingrid has Google integration and Crosserville has clue lookup, so those populations need Grawlix-side lookup less.

Mobile is a third mode — theme research on the go (subway, Discord), where a constructor wants to act on an idea before it evaporates. It runs the same UI as desktop, responsively narrowed; the section nav is the lone control recomposed rather than merely narrowed (see § *The shell* for the convergence rationale and that exception).

## The shell

**The whole document scrolls.** The brand header, the active view, and everything in it share one document-level scroll — no nested scroll container. The header pins to the top of the viewport via `position: sticky`, so it stays visible while the page scrolls beneath it. The active view fills the full content width below it. As the user scrolls into the entries table, a sticky region (tool stack → stats bar → entry headers, the search bar being the tool stack's last row) pins directly under the header. One scrollbar, the document's.

`html` carries `overflow-y: scroll` to keep the scrollbar gutter present whether or not content overflows. Without it, the Library view (short, no scrollbar) and the Workshop view (tall, scrollbar) would lay out at different widths and the page would jump horizontally on every view switch. On mobile the scrollbars are overlay-drawn and reserve no space, so the declaration is inert there — which is fine, since the shift it prevents only happens with classic desktop scrollbars.

Earlier the shell was a centered, max-width card inside a viewport-height `<main>` that owned the only scrollbar. That scoped scroll container behaved badly on mobile — it killed pull-to-refresh, and pinch-zoom left the pinned header chrome stranded off-screen — so the app moved to a plain document scroll with full-bleed views.
**Header is brand chrome plus top-level navigation.** Wordmark on the left, Workshop / Library nav in the center, settings/help on the right. A personal-text subtitle (tagline, byline, contact, GitHub) on a darkened-purple band sits immediately below the row. Per-wordlist state, sync indicators, and wordlist pickers stay out — those would tie the header to ephemeral state. Top-level navigation is the one carve-out from brand-chrome-only: it's structural, not transient (GitHub, Linear, and Stripe all put primary nav in the brand bar without it reading as control clutter). The personal text is a subtitle row rather than the brand-bar center — nav owns the center, and a subtitle keeps the project's voice without competing for the eye-magnet slot.

*Alternative considered:* sticky footer at the bottom of the viewport for the personal text, with the brand bar staying a single row of wordmark + nav + utility. Rejected because the in-chrome subtitle keeps the personal text continuous with brand identity, while a footer would tax every screen with chrome that mostly says nothing once a user has read it. Worth revisiting if the chrome ever feels too tall.

**The section nav collapses to a dropdown on narrow viewports.** Below 760px the brand bar can't seat both Workshop and Library tabs beside the wordmark and utility cluster, so the two collapse into a single dropdown — a trigger showing the current view (icon, label, chevron) that opens a menu of the same two nav buttons. The menu reuses the desktop buttons and their click handlers verbatim; only open/close is mobile-specific. The collapsed trigger carries a rolled-up severity bubble — the highest severity across views — so a folded nav still flags a wordlist needing attention. This is the one spot mobile departs from running the desktop UI merely narrowed: a 2-item dropdown is an unusual control, but it's the honest call once two full tabs no longer fit the row.

**Two top-level views, Workshop and Library, are peers.** Workshop is the construction-aid surface (tools, stack, entries table). Library is wordlist management (rail, focused-wordlist details, rescore/scoring rules). They live as sibling sections in `<main>` and fill the full content width. Either is shown by toggling the other's `hidden` attribute; the active view is reflected by `.active` + `aria-current="page"` on its nav button. Workshop is the default landing on every boot, including first run — publisher wordlists auto-fetch in the background so someone who shows up to look words up doesn't have to think about wordlist management. Library is discovered when a user wants to customize.

Library is a peer view, not a setup dialog: rescoring and curating wordlists is a return-to activity, not occasional config you set once and leave — return-to activities warrant peer real estate.

**Tool gallery** sits as a top section of the Workshop card. Cards lay out as a responsive grid (~180px min). Discoverability is preserved — the gallery is always visible on entry — at the cost of being scrolled past every session. Tool catalog and chaining are owned by [`planned/tools.md`](planned/tools.md).

**Workshop is always-merged.** No per-wordlist scope; the entries table shows the merged `All` view exclusively. No Workshop activity is meaningfully scoped to a single source (no one wants "anagrams in STWL only"), and per-source inspection belongs to the Library — so Workshop carries no wordlist picker.

**Stats bar always renders, even for empty wordlists** — zero entries, dashes for min/max/etc., flat histogram baseline. Uniformity over an "empty placeholder" treatment.

**Score ranges come from data, never from code.** Wordlist scoring conventions vary widely — 0–100, 0–60, 1–10, 200–2000, even negative numbers. Anything that depends on a min or max — histogram bins, score colors, filter ranges — derives them from the rescored entries actually present in the merged set. This applies to the empty-data path too: when nothing has loaded, the range is *unknown*, not a hardcoded default. Stamping in `0–100` or `0–60` as a fallback is a recurring source of the same bug — it works in testing and quietly misrepresents anyone whose scores sit elsewhere.

**Table is always visible**, even at idle with no search active. The idle and search views are *the same view, just filtered*; live keystroke-to-result feedback depends on continuity. Filling sessions also treat the table as the working surface (type a word, edit its score, clear the search, repeat). Smart-default landings (recent edits, top-scoring, etc.) were considered and rejected; alphabetical-by-default is consistent with how filtering narrows during search.

**Default landing on `All`.** Including first run. The four publisher wordlists fetch automatically in the background, so the app has data to query right away and a new user can start doing wordlist tricks immediately without thinking about wordlist management.

**Sticky region: tool stack → stats bar → entry headers.** Three pinned bands, in pipeline-output order: the stack the user is editing, the readout describing its output, and the column headers labelling the rows. The tool stack always ends with the permanent search bar as its last row, and shows just that bar before the user adds a tool, so pre-tool-use Grawlix looks unchanged — see *Tool gallery & stack* below.

**One bar, one story.** The stats bar carries every readout about the visible result set (counts, stats numbers, histogram) and the two controls that shape that view (score range, sort) in a single sticky band. Counts and stats describe the score-range-filtered output; the histogram projects the unfiltered pipeline output with the bracket overlaid, so dragging the range narrower shows what's being trimmed instead of bars disappearing past the bracket. Left → right: `Entries N   Groups N` · `Min Max + histogram` · `Score [range] · Sort by [axis] [↑/↓]`. Counts hold; `Min · Max` collapses when the bar would overflow.

**No persistent rail, no collapsible side panel.** The tool gallery sits as a top section of the card instead of in a side rail; disk storage's loud signal is the boot-time blocking splash rather than a status indicator in the chrome (see § *Disk storage* below). A collapsible side panel was considered and rejected as a rail comeback in disguise.

**Mechanics worth knowing:**

- Each view uses `overflow: clip`, not `overflow: hidden`. The latter establishes a scroll container that breaks `position: sticky` for descendants, trapping the sticky region inside the view. `overflow: clip` contains stray child overflow without that side effect.
- The sticky region anchors at `top: var(--header-h)` — directly below the pinned brand header. `--header-h` is published at module load by a ResizeObserver on the header element so subtitle wrap on narrow viewports keeps the stack correctly offset.
- The virtual scroller listens for `scroll` events in **capture mode** on `window`, computes its visible slice from the host's `getBoundingClientRect()` against `window.innerHeight`, and slices a window of rows out of a full-height sizer. Capture is required because scroll events don't bubble. The math is viewport-relative and works directly against the document scroll.

## Wordlists & setup

Setup splits across two surfaces that answer different questions and stay distinct:

- **Library** — what wordlists do I have, in what order, with what rules. A top-level view (peer of Workshop) reached via the brand-bar nav.
- **Disk storage** — where my data lives on disk, with a boot-time blocking dialog when the FSA handle needs re-granting. Reached from Settings, not its own dialog or view.

### Library

Two-pane layout: list as a left rail beside the focused-wordlist panel when the viewport is wide enough, stacking above it on narrow viewports. The list itself groups into two labeled sections — **Merged** (the All card at the top) and **Sources** (every reorderable wordlist below). My Edits sits first inside Sources by default but is reorderable like any other.

The focused-wordlist panel has no name/icon header — the focused wordlist is identified by the highlighted card in the list. The action row always justifies the date label and primary action right; the Rescored/Original toggle sits left of them when present.

**On narrow viewports the selected card pins to the top.** When the list stacks above the panel, scrolling into the panel would otherwise carry the highlighted card off-screen — and that card is the only thing identifying the focused wordlist. So the selected card is `position: sticky`. The catch: a sticky element's travel is bounded by its parent box, and the card's wrappers (`.wld-list` / `.wld-list-sticky` / `.wld-list-body`) are only as tall as the list. The narrow layout collapses all three with `display: contents`, so the cards become flow children of `.wld-body` — which spans the full stacked height — and the card pins through the entire panel scroll. The desktop rail keeps the wrappers; it pins via the standard stretched-column inner-wrapper idiom instead.

**Two panel shapes** with one common skeleton (action row → rules editor → search bar → stats + histogram → entries view, the search bar and stats bar both sticky above the entries):

- **Sources** carry rescoring rules and the Rescored/Original toggle (toggle visible only when rules apply).
- **My Edits** and **All** both carry the scoring (tier-label) editor in the rules slot — same `state.scoring` data anchored on both panels, so edits in either place update both. My Edits has no rescore rules: user-typed scores are already on the unified scale, so there's nothing to map.

The three panels share one shape — action row → rules editor → search → stats → entries — but the rules editor has different semantics per panel (rescore on Sources, scoring on My Edits and All). The dual scoring anchor puts the tier-label legend right where the user is typing scores in My Edits, and keeps All as the canonical "this is the unified scale" surface. Either anchor edits the same data; refreshes propagate because both panels query `#wld-scoring-section` through the same `refreshScoringSection` path.

**The Rescored/Original toggle** is a coupled mode: flipping it switches stats, histogram, entries view, and what Download produces in lockstep. WYSIWYG — what you see is what you'd save. A single Download button governed by the toggle, rather than a split-button Download (rescored / original): the toggle's flip is already the gesture that picks which version to export, and routing Download through it earns the toggle its visible chrome. Hidden when no rules apply, and on All (the merged view has no coherent "original" version).

**The Library entries view** is a monospace, text-file-flavored counterpart to the Workshop entries table, sized for "rule tuning": tweak a rescore rule, see its effect in the rows immediately below. Inline `input → output` annotations appear only on rows where the rule actually changed something; ignored rows render the input score with the whole row struck through. Switching to Original mode strips all of that. The view is read-only — editing routes through Workshop's AtomPopover, where users already know to find it. Column widths are computed once across every source + the merged set and cached against `cacheVersion$`, so the entry and score columns stay stable as the user navigates between wordlists or flips the toggle.

**Identity contrast** between the two entries displays is deliberate:

| | Workshop entries table | Library entries view |
|---|---|---|
| Font | mixed (mono entries, sans-serif chrome) | monospace throughout |
| Row chrome | row separators, score badges, count column | whitespace-aligned columns, no separators, no badges |
| Click behavior | atom click → AtomPopover edit | read-only |
| Tools | full gallery + stack | none |
| Filter | search + score-range + sort | search + score-range + sort |
| Source attribution | per-atom source column on All | n/a |
| Rescore annotation | red `*` + popover detail | inline `→` |

The two views answer different questions about the same data — Workshop asks "what entries are available to me right now?" (merged, rescored, override-resolved), Library asks "what does this source contain and how does it get transformed?" — so they should look meaningfully different.

**Score-range filter scope.** Workshop has one global filter (single number band against the merged scale). Library keeps a separate filter per (wordlist, mode) — each card's Rescored and Original tabs draw against different score axes, so flipping the toggle swaps which range is active. Each wordlist's filter is independent so the user can dial in different bands per source while exploring; the merged All view has a single mode and one key. Workshop's filter is keyed `scoreRange` in localStorage; Library's filters live as a JSON map under `libScoreRanges` (`merged` for All, `${dbKey}:${mode}` for sources). The two views' filter scopes don't interact.

**Rescoring lives entirely inside the Library view**; it doesn't appear on the Workshop entries table. Rules are detail config, typically set once when adding a wordlist and rarely revisited; they don't earn persistent real estate next to the wordlist view.

**Scoring rules** are the user's single notion of what each score range means — there is no separate "output" tier system. Tier labels surface on Workshop's entries table as a hover tooltip on each score atom — point at a score, see what tier the user has called it. A tooltip rather than an always-visible legend block above the table: the lookup ("what does 50 mean again?") is a once-in-a-while need, and a legend would cost a row of vertical space the user pays for on every scroll. The editor lives on All's panel because the rules describe the merged scale; the data anchors on top-level `state.scoring` for the same reason. See § *Rescore rules & tier alignment* below.

**Renaming** happens on the wordlist card via F2 with the card focused. Configure (in a wordlist's ⋮ menu) is the secondary path. No Rename in the kebab menu — the F2 affordance is enough.

**Onboarding banner** lives at the top of the wordlist list — there's no auto-popup on Workshop. Users who never visit Library never see it; the defaults are sensible enough that this is fine.

The banner is a 3-page sequence (welcome, personal-wordlist import into My Edits, XWI subscriber import) that exists to *surface features users might not know are there*, not to provide parallel import paths — pages 2 and 3 route through the same `ingestFile` plumbing as the canonical import flows. Page 3 is gated on the XWI wordlist still being present and unpopulated, so it drops out when irrelevant rather than asking a question that has no answer.

**`All` lives in the Library.** It's the synthesized wordlist and belongs in the list of wordlists; the merged-wordlist download lives here too, alongside per-wordlist Downloads.

### Rich wordlists

The wlEntry schema is `{ norm, display, … }` (§ Tool gallery & stack — *Two-field entry identity*). The plumbing that surrounds it:

**Richness is a per-file load-time decision.** The parser classifies each imported file as **plain** or **rich** and populates `display` accordingly: plain files leave `display: null` on every entry; rich files preserve the entry text as written. The rule is:

- ≥99% of entries match `[a-z0-9]+` *or* `[A-Z0-9]+`, consistently the same one across the whole file, AND
- ≤1% of entries contain space, accent, punctuation, or within-entry mixed case.

Otherwise rich. The thresholds are knobs in code (`classifyWordlist`); reasonable defaults ship and get tuned against real-world feedback.

The heuristic guards a single direction. Three of the four misclassification cases are tolerable: a deliberately-rich file misclassified as plain *loses data*; a dirty personal file misclassified as rich renders as-given (the user put the dirt there); a uniformly-lowercase plain file misclassified as rich renders lowercase, visually identical to the plain treatment. The one bad case is misclassifying a uniformly-uppercase plain file as rich — every entry would render in shouty all-caps when the data is conceptually lowercase. The heuristic specifically guards against that: uniform `[A-Z0-9]+` plus very few rich-feature entries → plain.

Per-file rather than per-entry: a single accent typo in an otherwise-plain public wordlist shouldn't flip the whole file to rich, and a personal wordlist with mixed-case dirt shouldn't be forced into uniform plain rendering. Recovery from misclassification is re-import; no UI toggle today.

**UI-typed entries preserve display literally.** Popover edits and "add entry" rows store the entered text verbatim as `display` — even when it happens to be uniform lowercase. This is variant targeting: when a user edits the score on `the IRS`, the My Edits entry must carry `display: "the IRS"` so it targets that specific variant; if an autodetect ran per-string, an edit on plain `theirs` would null-out and become ambient (leaking onto `the IRS` and any other variant sharing the norm). Literal-preserve sidesteps that without per-string heuristics. As a result, My Edits ends up mixed-state — entries imported from a plain file have `display: null`, entries typed via the UI have `display` set — and the merge handles the mix correctly.

**Merge semantics: keyed by `(norm, display)`.** Within a single norm, multiple distinct displays from rich sources produce **multiple rows** in the merged view: `theirs` and `the IRS` are substitutable letter-wise in a 6-letter slot but the rich sources have deliberately split them, so the UI honors the split.

`display` is treated as opaque. Two displays compare as strings; there's no content-based normalization, no "richer display wins" rule. `"THEIRS"`, `"theirs"`, `"Theirs"`, and `"the IRS"` from different sources are four distinct rows sharing one norm.

Null-display contributors are **ambient**: a contributor with `display: null` participates in every merged row that shares its norm. So a plain source's entry for norm `theirs` contributes its score to both the `theirs` and `the IRS` rows if those rich variants exist. The plain entry doesn't surface as its own row — it has no display string to anchor — but it acts as a fallback contributor when no higher-priority source provides a matching display. When every contributor to a norm has `display: null`, the merged row renders `norm` (lowercase); no display is invented.

**Comment falls through blanks.** Score, display, and source attribution come from the highest-priority eligible contributor, but `comment` walks the eligibility chain for the first non-blank value. A high-priority entry without a comment doesn't shadow a lower-priority entry's curated note — a common case once a plain personal wordlist sits above a rich annotated one to override scoring. The split means a row can show one wordlist as its source while displaying another's comment; the UI doesn't flag the split (no per-field source attribution).

The merged cache exposes `byNorm` (norm → first row sharing that norm, the lookup tools use) and `byKey` (mergeKey → row, for full disambiguation when needed). My Edits edits go through `patchCachesForEditsChange`, which invalidates the merged cache and lets `refreshWorkshopMergedScroller` rebuild from scratch. The in-place patch path that ran on plain-only entries was retired: the `(norm, display)` keying makes correct in-place patching significantly more complex, and the rebuild cost is accepted for now. Revisit when My Edits sizes or edit cadences make it visible.

**Display-aware search.** Search's pattern is matched against `display` (falling back to `norm` when null) with implicit `[\W_]*` glue between every adjacent pair of pattern characters. Pattern characters are literal-required: letters case-insensitive, bare letters accent-permissive (`resume` matches `resume` and `résumé`), accented letters require a matching accent (`résumé` matches only `résumé`), spaces require a literal space, other punctuation requires the literal character. Wildcards (`?`, `*`, `#`, `@`, `[…]`) match alphanumerics only and treat punctuation/spaces as part of the glue — so `?O?` matches every letter-O-letter sequence regardless of the surrounding punctuation. Highlight ranges are emitted in display coordinates and pass through the projector untouched.

The matcher compiles to a regex (`buildSearchPattern`). Bare-letter tokens expand into a character class of all Latin accent variants (precomputed at module load); accented-letter tokens stay literal under the `i` flag. The conceptual model is "walk pattern char by pattern char, tolerating non-alnum gaps" — the regex shape preserves that exactly via `[^\p{L}\p{N}]*` between adjacent pattern tokens.

**Length, sort, stats — letter count always.** `wlEntry.norm.length` drives the Length column, the Length sort axis, histogram bin counts, and score-range / length-filter rule matching. `the IRS` has length 6, not 7. The crossword grid slot is letter-counted; display length never affects what fills where.

**Acronyms.** The first tool to operate on word structure rather than letter sequence. Pattern is a literal acronym; matches displays whose word-initial letters spell the pattern (case-insensitive). Word boundaries: spaces always, hyphens optional (the matcher tries both interpretations, so `CO` matches `co-op` via the split and `C` matches via the join), apostrophes/periods/commas/slashes never (`don't` is one word; `DT` does not match it). No wildcards, no minimum pattern length — a single-letter pattern matches every display whose first word starts with that letter. All-mode buckets every multi-word entry by its acronym (spaces only — the hyphen-optional branching would scatter an entry across clusters) and keeps only clusters whose acronym is itself a wordlist entry — the value of the cluster is the bidirectional pair (`TIS` ⇄ `the IRS`/`Tom Is Right`/…), not every prefix coincidence. Single-word entries are dropped because a one-letter "acronym" cluster is just a prefix bucket. Other rich-format tools (Initials, Has-accent, Word-count, …) ship later as the catalog grows.

**Space out and rich displays.** Space out emits the joined display (e.g. `a barrel of laughs`) and the executor looks it up against the merged wordlist's `byNorm` to recover real metadata. With rich sources providing the spaced form directly (`A BARREL OF LAUGHS` already an entry), the lookup hits the rich row and the atom inherits its score, comment, and source. For a passthrough — the segmenter's best split is the original input — the tool short-circuits before any lookup and reuses the input entry directly.

**Schema version bumped to 6.** The wlEntry shape change (`entry` → `{norm, display}`) is a stored-data format change, so the schema-mismatch reset prompt covers existing users.

### Disk storage

Disk storage lets the user pick a folder on their hard drive; from then on Grawlix reads and writes wordlists as files and settings as `grawlix.json` in that folder. IDB drops out of the picture entirely in this mode — the folder *is* the source of truth. User-facing behavior lives in [`manual.md` § Disk storage](manual.md#disk-storage); this section covers the architectural shape.

**One source of truth.** Disk mode does not also write to IDB. There is no reconciliation engine, no pending-edits log, no "both backends in sync" path. A single `Storage` dispatch object routes every read/write to whichever backend is active, and the user is in one mode at a time.

**Three backends, one shape.** `IdbBackend`, `DiskBackend`, and `NullBackend` share one method surface — meta / scoring / mergedSettings / wordlist / rescored / allRescored / reset:

- **`IdbBackend`** — IDB for wordlist text, localStorage for settings. The mode Grawlix runs in when storage isn't configured. `writeRescored` and `writeAllRescored` are no-ops.
- **`DiskBackend`** — FSA folder handle; settings cached in memory and flushed to `grawlix.json` through a queued in-flight write that coalesces bursts.
- **`NullBackend`** — All operations silently no-op. Active only when the user clicks "Use without disk storage this session" on the boot splash; the session runs with default state and edits don't persist anywhere.

`let Storage = IdbBackend` is the dispatch. On boot, if a disk folder handle is found in IDB and its permission is granted silently, `Storage = DiskBackend`. If permission isn't granted, the blocking splash runs; on success disk mode, on opt-out `NullBackend`. Call sites just call `Storage.writeMeta(...)` without branching on backend.

**Folder layout is flat.** All files at the root: `grawlix.json`, one `<name>.txt` per wordlist, one `<name> rescored.txt` per wordlist with rescore rules applied, an `All rescored.txt` of the merged-rescored output, and a `README.txt` generated on first setup.

The rescored suffix is a leading space — `XWI rescored.txt` rather than `XWI-rescored.txt`. Reads more naturally in file pickers; hyphens look like they're encoding a special token, spaces just look like a label.

**`grawlix.json`** carries everything except wordlist content — sources array, `state.scoring`, `state.scoringDirty`, `mergedSettings`, `schemaVersion`. The schema version follows the same wipe-on-mismatch policy as IDB's: a folder written by a different Grawlix schema is refused with an explanatory dialog rather than tolerated. Disk and IDB stay venue-symmetric; the wipe policy flips to layered migration when shared links and synced folders make it load-bearing — see [`planned/migration.md`](planned/migration.md).

**Sort on save; raw files unchanged.** When Grawlix writes a rescored file or `All rescored.txt`, entries are sorted alphabetically by `norm` via a shared `sortedEntries` helper. Raw wordlist files preserve insertion / import order verbatim — they round-trip as the user (or publisher) wrote them. The lone exception is `My Edits.txt`, which sorts on persist: it has no rescored variant (rescore rules don't apply to user-typed entries), and a sorted file is easier to scan in an editor.

**Empty files exist.** Every wordlist's raw file and rescored variant is written at migration time, even if the wordlist has no entries yet — the file just ends up empty. The watcher therefore only needs to detect *changes to existing files*; it never has to react to a file appearing for the first time. This is what makes the common "user externally creates `My Edits.txt`" case work — the file already exists from setup, so an external save is an mtime change on a known filename, which routes straight to the matching wordlist's `rawEntries`. The simpler watcher logic earns the cost of a few empty files in the folder.

**Atomic writes via FSA.** `Disk.writeFile` is a plain `getFileHandle({ create: true }) → createWritable → write → close` sequence. FSA's `FileSystemWritableFileStream` buffers writes to a hidden swap location and atomically swaps them into place on `close()`; partial writes are never visible to other readers (or to the watcher). The "write-to-temp + rename" idiom that's customary for atomic file writes is unnecessary — the FSA spec provides atomicity for free.

**File watcher polls.** FSA has no change-notification API, so `DiskWatcher` polls the folder every 2 seconds (paused when the tab is hidden, resumed on visibility return). Each tick compares each file's mtime against the previous snapshot; external changes route through `_applyExternalChange`, which re-reads the file, parses, and updates the matching wordlist's in-memory state. Cross-tab edits use the same mechanism: tab A's write produces an mtime change tab B's watcher sees as external.

**The watcher's own-write race.** Without care, an in-progress `Disk.writeFile` produces a file with intermediate (often empty) content visible to the watcher during the write. If the tick fires in that window, the watcher would re-read the file and overwrite `state.sources` mid-mutation. Two suppressions guard against this:

- **`_heldNames`** is set on every write before `Disk.writeFile` starts, cleared in `finally` after `recordOwnWrite` fires. The watcher tick skips held names entirely — doesn't even read the file. Counter-based, so concurrent writes to the same file compose.
- **`_ownWrites`** is set after the write completes (in the same `try` block, before `finally`). The watcher's next tick that sees the name consumes the mark and updates its snapshot to the new mtime, without flagging the file as changed. This suppresses the one post-write tick the held window doesn't cover.

A `withOwnWrite(name, op)` helper bundles hold + write + recordOwn + release so every disk-write site uses the same pattern.

**Detection: feature + media query.** The storage button is hidden when both `!Disk.isSupported()` (no `showDirectoryPicker`) and `!matchMedia('(hover: hover) and (pointer: fine)').matches` (no desktop-like input). The matrix:

- Chromium desktop has FSA → button shows, setup dialog works.
- Firefox / Safari desktop have desktop-like input but no FSA → button shows; click opens an info dialog explaining disk storage needs Chrome.
- Phones, tablets, iPadOS in "Request Desktop Site" mode all report coarse pointer or no hover → button hidden.
- Touchscreen laptops with a trackpad report `(pointer: fine)` as the primary pointer → button shown.

Media-query detection is future-proof: a new browser that ships FSA lights up `Disk.isSupported()` automatically without code changes. iPadOS's notorious "I'm a Mac" UA string is also handled cleanly — iPadOS reports a coarse pointer even in desktop mode, so the media query keeps the button hidden where UA matching would have shown it.

**The blocking splash, not a modal dialog.** When the saved handle exists but the permission isn't live (Chrome heuristics, explicit revocation, browser restart), the loading splash itself hosts the recovery UI: the spinner hides, and two buttons fade in below the logo after the logo's own fade-in (chained CSS animation with a 0.5s delay). Buttons are Load Grawlix data / Use without disk storage this session.

If the permission grant fails or the cache doesn't load (drive ejected, folder moved, JSON corrupt), the splash re-renders with Try again / Pick a different folder / Use without disk storage this session — same splash, different action set. A `_hasAnimatedIn` flag skips the entrance animation on re-renders; only the first appearance fades in.

Hosting recovery in the splash rather than in a separate modal puts the controls where the user is already looking (the page is blocked anyway) and avoids a small dialog window's awkward fit at this stage of init.

**Session-paused banner.** When the user opts out of disk storage for the session, `Storage = NullBackend` and a persistent banner sits at the top of the page: *"Disk storage paused for this session — your data is safe in your folder."* with **Reload to try again** and **Turn off storage** off-ramps. The banner pushes the header down. **Turn off storage** clears the saved handle from IDB and wipes IDB+localStorage so the next reload runs as fresh IDB-mode Grawlix.

**Cross-device via OS sync, not Grawlix code.** Grawlix ships no cloud code. Cross-device works because the user's existing cloud-drive client (Dropbox, iCloud Drive, OneDrive, Google Drive) syncs the folder. The user picks a synced folder on device A; on device B, the **Load existing** tab points at the same path. The diff-only merge dialog handles whatever's already there. The `README.txt` Grawlix writes on first setup names this workflow explicitly so users discover it without being told.

Two-device-simultaneous-editing produces last-writer-wins per file — the same model as opening one document in two text editors at once. Most cloud clients produce a "conflict copy" file when they can't decide; Grawlix ignores files it doesn't recognize, so the user resolves the conflict in their editor.

**Header chrome.** A storage button between the gear and the help-circle in the brand bar. Icon is Bootstrap's `hdd-fill` glyph. The off-state slash is a CSS pseudo-element — a diagonal band in `--hdr-bg` with a narrower `currentColor` line inside, so the slash reads cleanly against any background without needing a separate slashed icon. When `Storage === DiskBackend`, JS sets the slash element `hidden` and the unslashed hard-drive shows through.

A growing label sits next to the icon: `Disk storage on` shows whenever storage is set up, while `Disk storage off` appears only once the user has My Edits content — the moment they have state they'd care about losing. The label is permanent once it appears (no dismissal); it collapses at `≤899px` viewport widths to keep clearance above the nav-collapse breakpoint at 759px. Animation uses `max-width` / `opacity` / `margin-left` transitions on a span that's always present in the DOM — CSS transitions don't fire on freshly-created elements, so the span lives in the static HTML and JS just toggles a `.visible` class plus the text content.

**Non-features.** No second copy in IDB while disk is active. No reconciliation engine; no pending-edits log. No per-provider cloud integration — Grawlix has zero cloud code; the user's existing Dropbox/iCloud/OneDrive client does the sync. No degraded-but-usable read-only mode when storage is configured but unavailable; "Use without disk storage this session" is an escape hatch (loads defaults, silently discards writes) rather than a fallback UI, deliberately so the user doesn't accidentally make edits that vanish without warning.

### One path to "give me a file"

Any wordlist's `Download` button in the Library produces that wordlist's file. For Sources, the Rescored/Original toggle decides which version; for All, it produces the merged wordlist file. There's no separate "backup" gesture — under disk storage the folder is the backup; under unsynced mode the per-wordlist Downloads are the manual backup path.

### Fetching & updates

A wordlist with a `url` is auto-fetch capable. On boot, any URL-backed wordlist that isn't yet populated fetches in the background (§ *The shell* — default landing). Thereafter `checkForUpdates()` runs once on boot and hourly (`UPDATE_CHECK_INTERVAL`): a `HEAD` request per URL-backed, populated wordlist compares `Content-Length` against the stored `fetchedSize`. A size change is the update signal — cheap, no body transfer.

What happens on a detected change depends on the **Auto-update wordlists** setting (`grawlix_autoUpdate`, default on — a standalone localStorage key like `darkMode`, read-time default via `!== 'off'`, so no `SCHEMA_VERSION` bump):

- **On** — `checkForUpdates` immediately re-fetches the changed wordlist (`fetchWordlist(…, { silent: true, viaToast: true })`) and applies it.
- **Off** — the wordlist gets a transient `_updateAvailable` flag, surfaced as an `info`-severity (green) bubble on its card. The user fetches manually via the card's Update action.

`applyWordlistText` always diffs old vs. new `rawEntries` into added / deleted / rescored lists. The `viaToast` flag picks how that diff is reported: normally it opens the full `openUpdateSummaryDialog`; under auto-update it instead shows a one-line toast with the counts (`XWI auto-updated: 1,204 added, 58 rescored`, zero-count categories omitted), since an unattended background refresh shouldn't pop a modal in the user's face. The toast carries a **Details** action link (`showActionToast`) that opens the full `openUpdateSummaryDialog` on demand — the modal stays opt-in. Toggling the setting on from the Settings dialog runs `checkForUpdates()` immediately rather than waiting up to an hour for the next tick.

### Rescore rules & tier alignment

The unified scale is a declared contract: the tier labels on **All** (`state.scoring`) define what each score range means, and every wordlist's rescore rules describe how its raw scores map to that scale. Any deviation from the contract — input scores not covered by a wordlist's rescore rules, or output scores not covered by All's tier labels — surfaces uniformly as a warning the user can act on.

**Uncovered scores are the misalignment signal.** `recomputeUncovered(wordlist)` derives `wordlist._uncovered` — the raw scores present in the data but not matched by any length-filter-free rescore rule. `recomputeScoringUncovered` does the same on the tier scale, producing `state._scoringUncovered` — merged-output scores not covered by any tier label. A non-empty `_uncovered` drives a `warning`-severity bubble on the affected card; the max severity across all wordlists propagates to the Library nav tab. Alignment check is trivial (`_uncovered.length`) and no output-vs-tier simulation is needed.

Two layers, same surfacing. A source's rescore-side uncovered scores say "there are raw scores in this data you haven't ruled on" (input-side). All's tier-side uncovered scores say "there are merged output scores you haven't labeled" (output-side — a source's rescored output lands at a score outside the tier scale). Both produce an orange bubble. Resolution is structural: fill in rescore rules, or expand the tier scale; the uncovered list empties and the bubble clears. A pure state indicator with no acknowledgment / dismiss path — for deliberate misalignment (e.g. raw XWI scores in the merged view), the right resolution is just adding the missing tier labels, which clears the bubble naturally.

The uncovered metadata lives on the wordlist/state as transient fields, not inside the rules array — keeping it there (as a synthetic "catch-all" row carrying the uncovered list) would conflate "rules the user authored" with "auto-computed coverage metadata," forcing every read site to filter the two apart and muddying persistence. The transient-field shape matches the convention used for `_rescored`, `_overrideMap`, etc.

**Severity-keyed badge primitive.** A single `.badge[data-severity=…]` rendered by `buildBadgeHTML(severity, { count?, title? })`. Two shapes:

- **Plain dot** (no count): a 7px circle, severity-colored — `info` green (`#7add9e`, used for "update available"), `warning` orange (`#e8a040`, used for uncovered-score presence). At-a-glance distinction between *act on this* and *fyi*, which the user needs before clicking in. Renders inline at the right edge of its host surface (next to the card name on wordlist cards, at the right edge of the nav-tab button) — sized to read as a colored bullet, not a corner overlay.
- **Count pill** (`.badge--count`, numbered): always red (`#ff3b30`) with a white digit, iOS-style. The count is the meaningful payload; color is fixed so the badge reads as "N things to look at" regardless of severity. Sits at the right edge of its host (slightly overhanging via `right: -8px` on the nav tab), past the surrounding label.

The nav-tab's "inactive view" dimming uses `color: rgba(255,255,255,0.55)` rather than `opacity` so that an explicit-background element like the count pill keeps its full solid red even on the tab the user isn't on; the SVG icon (`fill="currentColor"`) and label text both dim correctly via color inheritance.

`maxSeverity(...)` resolves priority when badges propagate (`warning > info`). The primitive only knows about severity (and optional count); callers map their causes to severities and supply the title — both shapes carry the same `data-severity` so the aggregated title can point at the worst underlying cause.

**Banner + `+ Add rule` split in the editor.** The uncovered list surfaces as a warning-styled informational banner at the top of the editor (`⚠️ Unhandled scores: 25, 45-49, 75` — contiguous runs collapsed via `scoresToGroupedList`); rule authoring is a separate `+ Add rule` button below the list. The two jobs are kept apart deliberately — a single row that both *reports* uncovered scores and *doubles as* a way to author a rule conflates them, and the merged range string it would carry (e.g. `25-75` for uncovered scores `{25, 75}`) silently encourages over-broad rules. No "convert these to a rule" affordance on the banner either: any pre-fill for non-contiguous scores is over-broad, and for contiguous scores there's no single right answer (one wide rule, several narrow ones, or widening an adjacent rule all reasonable).

**Tier labels live on `state.scoring`, not on My Edits.** The unified scale belongs to the merged output (All) — what every wordlist gets translated *into* — not to any single wordlist. A top-level `state.scoring` makes the misalignment-signal pattern symmetric across input-side (per-wordlist `_uncovered`) and output-side (`state._scoringUncovered`), and lets a user customize the unified scale without it living on a "wordlist" data field.

**My Edits has no rescore rules.** Scores typed into the AtomPopover are already on the unified scale by construction — there is nothing to map. Bidirectional editing forces this: if rescore rules sat between "what the user typed" and "what gets merged," a typed `52` could surface as a different value, which is incoherent. Standing rules also can't coexist with external editing of My Edits' on-disk form (planned sync). My Edits' `rescoreRules` is held at `[]`; `recomputeUncovered` short-circuits to an empty list for it, so its scores never trip the misalignment bubble regardless of which tier labels are defined. Users who want to import an existing personal wordlist in a different scoring system import it as a Source instead, set rescore rules there, and (in a follow-up not yet shipped) bake the rescored result into My Edits in one shot.

**My Edits' rules slot renders the scoring (tier-label) editor.** Same data as All's — both panels point at `state.scoring` — so editing in either place updates both. Two anchors, one underlying scale. The legend sits right next to the entries the user is typing scores against, which is where it's most useful; All keeps the canonical "this is the unified scale" framing. The data still lives top-level on `state.scoring` rather than on a panel, so the dual rendering is two windows onto shared state, not two competing owners.

**Auto-seeded inert rules on custom-wordlist import.** When a custom wordlist (no `publisherId`) is fetched or imported with empty rescore rules and ≤10 distinct scores, Grawlix seeds one inert row per distinct score. Visible-but-inert: the editor shows the wordlist's score scale as concrete rows the user can fill in to translate into the unified scale. Identity mappings (`60 → 60`) aren't seeded because that would assert the wordlist uses the unified scale — wrong claim for an unknown source. Above the threshold, the Unhandled-scores banner does the surfacing instead. A wizard-style "rescore on import" was considered and rejected as speed-bump UX; an auto-suggested mapping based on score distribution was rejected because low-confidence guesses would mostly be wrong.

**Default-rule propagation via a `dirty` flag.** Each publisher-bound wordlist carries a persisted `dirty` boolean against its defaults; `state.scoringDirty` tracks the tier scale. `dirty` is recomputed from a direct equality check (`rescoreRulesEqual` / `scoringRulesEqual`) after every rule edit, so an edit landing back on defaults flips it false automatically. At boot, `propagateDefaults()` walks every rule set: if persisted rules differ from current in-code defaults and `dirty` is false, rules are silently overwritten with the new defaults. Dev-shipped updates land for pristine users without intervention.

Propagation is silent — no toast. Rule updates only ever *add* coverage; they never re-grade existing entries. There's no user-visible change to explain, and the cleared misalignment bubble is its own confirmation. A seed-fingerprint snapshot was considered as an alternative to the dirty flag and is functionally equivalent — the flag won on simpler mental model. A code-side history of past `defaultRules` per publisher was considered and rejected as heavier.

**Reset button scoped to the editor.** When `dirty == true`, a "Reset to defaults" button appears alongside `+ Add rule` at the bottom of the rules editor. Confirms before wiping customizations. Visible only inside the editor and only when there's something to undo — a reset button shown anywhere rules differ from defaults would feel nudgy. Per-rule revert was considered and rejected: any rule-matching algorithm is fragile, and the editor itself is the granular tool (a user wanting to revert one rule can manually retype its value).

## Tool gallery & stack

Tools live in two places: a persistent **gallery** as a top section of the card, and a **tool stack** inside the sticky region just below the brand header. The gallery is browseable; the stack is the user's current pipeline. The chrome and the pipeline runtime are shipped; the tool catalog — which tools are shipped, which are planned, with their cards' icon, name, description, and example — lives in [`tools.md`](tools.md). Chaining extensions and other planned gallery work are tracked in [`planned/tools.md`](planned/tools.md). Tool output lands in the entries table (§ Entries table) as **chain rows** (§ The chain-row model) — or, with a group tool in the stack, as **group rows** (§ The group-row model).

**Single catalog drives every surface.** Each tool is one record in `TOOLS` (`name`, `icon`, `category`, `desc`, `example`, `params`, `kind`, `inputHighlights`, `outputHighlights`, a `run` for filter/transform tools or a `group` for group tools, optional `glyph` / `findReplace` / `prepare`); gallery section ordering comes from a parallel `TOOL_CATEGORIES` list. Gallery cards, stack-row labels, and the search bar's `Search` label all render the inline icon-and-name pair through the shared `buildToolLabelHTML` helper. Adding a tool means adding one entry — every surface that names tools picks it up — and the helper guarantees the icon-and-name pair looks identical wherever it appears.

**Clicking a gallery card appends that tool** to the end of the user stack — one click target, the whole card. The first click on an empty stack starts a one-tool pipeline; each later click chains another tool onto the end. To swap tools, remove a row via its `✕` and click a fresh card.

**The search bar is always present; user tools sit above it.** `#tool-stack` always exists, holding at least the permanent Search bar as its last row. Before the user adds a tool the stack is just the bar — which looks exactly like the standalone search bar of pre-tool-use Grawlix. Adding the first tool inserts a row above the bar.

**Search is a tool.** The search bar *is* a `search` row — the permanent last row of `ToolStack`'s stack, and so the permanent last step of every pipeline. `ToolStack` keeps the invariant that the stack always ends with a Search row; that row is undeletable (no remove button) and renders with its own `.search-bar` chrome instead of the plain `.tool-row` layout. Both `.tool-row` and `.search-bar` are flat CSS grids with the same shape — drag handle, label, `.tool-row-main` (the row's center cell), and an asides slot — so the line-1 controls vertically center against each other and a row-2 replace input opens cleanly below them; see *The find/replace widget*. The search bar holds nothing but the search inputs: pattern, whole-word checkbox, and (when expanded) the replace input. Score range and sort are WorkshopView view-config and live in the stats bar below, not on the search row. The pattern, replace, and whole-word state live in that row's `params`, like any tool row. `search` is also a normal gallery card, so a user can add extra Search rows above the bar. Search has no special-case input builder: every Search surface — the permanent bar, gallery-added Search rows, and the Library search bar — draws its inputs through `buildToolRowPartsHTML` / `buildParamHTML`, the one generic renderer every tool's params use. The permanent bar and gallery Search rows are ordinary stack rows wired by delegated `data-row`/`data-key`; the Library bar has no tool stack, so it passes `id` + inline-handler wiring into the same renderer. Search carries a `replace` param like Regex (see *The find/replace widget*), so a Workshop Search row expands from a filter into a search-and-replace transform; the Library bar drops that param — it filters one wordlist's entries table with no pipeline behind it — so Library search stays filter-only. Folding search into the pipeline — rather than running it as a scroller-side filter outside the stack — makes it compose like any tool and lets the unification pass see search highlights (§ Symmetric unification).

`rerenderRows` rebuilds only the user tool rows on a stack mutation, leaving the Search bar's DOM untouched — so its input focus survives an add/remove. A full re-render (`mountWorkshopPanel`) does rebuild the bar.

**The find/replace widget.** A tool flagged `findReplace: true` — Search and Regex — splits its `pattern` and `replace` inputs across the tool row's two grid rows. Row 1 carries the pattern input with a caret button to its left (both inside `.tool-row-main`, the row's center cell), vertically centered alongside the drag handle, label, whole-word checkbox, and remove X. Row 2 carries the replace input as a `.tool-row-replace` cell in the same grid column as `.tool-row-main`, hidden until the caret expands — so the replace input lines up directly under the pattern while the row-1 controls stay pinned to row 1 instead of centering between the two lines. Same layout at every width — no side-by-side, no breakpoint. Expansion is a transient `row._replaceExpanded` flag, never URL-serialized; a row also renders expanded whenever its `replace` param is non-empty, so a shared link carrying a replacement opens already expanded. Collapsing the caret clears `params.replace` and drops it from the URL — a collapsed row is always a pure filter — but the replace `<input>` is hidden, not destroyed, so re-expanding restores its text. Both Search and Regex are filter/transform hybrids — `kind: params => params.replace ? 'transform' : 'filter'` — so an expanded-but-empty row still behaves as a plain filter. Inputs are placeholder-labelled, not `<label>`-prefixed. The shared renderer (`buildToolRowPartsHTML` → `buildParamHTML`) packs each row's text inputs, number inputs, and checkbox asides into one `.tool-row-main` flex cell; `findReplace` just emits the extra `.tool-row-replace` child, and the surrounding tool-row grid is what makes row 2 first-class.

**Tool rows are drag-reorderable.** Each user tool row carries a drag handle (`buildDragHandleHTML`, the same `≡` affordance wordlist cards use); dragging it reorders the row within the user portion of the stack via `reorderAt`. The handle itself is the drag source — not the whole row — so a drag begun inside a param input still selects text. The permanent Search bar isn't draggable: it carries a hidden placeholder handle (`aria-hidden`, `visibility: hidden`) so its `Search` label still lines up with the tool labels above it, and `reorderAt` clamps both indices out of the bar's slot so it stays pinned as the last row.

**Cheat-sheet popovers are a per-param opt-in.** A tool param declares an optional `help` HTML string on its schema; `buildHelpHTML` produces the standard markup — a `<kbd>`-and-description grid plus an optional footer link — but `help` accepts any HTML. At load time `PARAM_HELP` is built from every param that declares `help`, keyed `toolKey/paramKey`. `buildParamHTML` emits a matching `data-help` attribute for any param that declares `help`, and `attachHelpPopups` binds a `PopupHelp` popover to *every* `data-help` input found by a document-wide scan, resolving its content through `PARAM_HELP`. It runs whenever a view re-renders and an anchor may have been rebuilt — `mountWorkshopPanel`, `rerenderRows`, and `LibraryView.renderPane` — destroying the prior popovers and rebinding from scratch each time. Search's `pattern` param carries the wildcard cheat sheet; Regex's `pattern` and `replace` params carry regex-syntax sheets (no cheat sheet covers all of regex, so both link out to regexone.com). The popover is interactive — a `mousedown`-preventDefault keeps the anchored input focused — so a click on the footer link lands instead of blurring the input and dismissing the popover first.

**Hovering a gallery card shows an insertion cursor.** A `.tool-stack-cursor` — an accent caret-and-line — appears at the seam where the click will drop the new tool: between the last user tool row and the permanent Search bar, or at the top of the stack when there are no user tools yet. It's parented in the Search bar, absolutely positioned so it adds no height, and removed on mouseleave. A freshly added row gets a one-shot `.flash` accent pulse; `rerenderRows` rebuilds the user rows on every mutation, so the new row's element is always fresh.

### Pipeline execution

`executePipeline(mergedWordlist, stack, signal)` works in one shape end-to-end: a list of **groups**, each `{ key?, chains: Chain[] }`. The seed is a single group with `key === undefined` holding one chain per merged entry (a cached array — § Caches); a group tool partitions that single group's chains across K keys. Flat pipelines are the degenerate case — the whole run is one giant group that gets unwrapped at exit. The executor walks the stack rows in order, running each non-group tool over every group's chains; the only branch is at exit, where a never-grouped run returns its single group's `chains` as the `rows` array and a grouped run returns the group list itself. This is what keeps the same `runToolStage`, `unify`, and chain-bookkeeping code paths working for both modes — there is no separate "flat" executor.

The `mergedWordlist` it receives is the full merged view: the score range is a **post-pipeline filter** applied to the chain rows the pipeline emits, not a pre-pipeline trim. The pipeline runs against every entry, then `applyScoreRangeToRows` drops any chain whose journey touched an out-of-range atom; for grouped pipelines the drop is per chain inside each group, and a group stays as long as at least one chain survives. Two things drive the choice. First, the stats bar's histogram is *honest* about what dragging the range narrower will trim — it sources from the unfiltered pipeline output and fades the cut bars in place, instead of showing only what's already past the bracket. Second, an "all atoms in range" rule reads as "this row is fully valid under the current range," conservative and predictable; a "bottom-line only" rule would surface rows that relied on out-of-range source words. The cost is that heavy tools (anagram on a 500K wordlist) lose the ability to use the range as a pre-trim for performance — accepted, since tightening the range to manage tool perf was an indirect path users probably weren't reaching for. Range changes don't re-run the pipeline: `WorkshopEntriesScroller.setScoreRange` re-applies `applyScoreRangeToRows` over the cached unfiltered output and re-renders.

A tool's `run(entry, prepared, wordlist)` is a **per-row pure function** — it sees one entry's text and returns a per-row decision; the system owns the outer loop, cooperative yielding, abort, atom construction, and chain bookkeeping. Filter and transform tools carry a `run`; a group tool carries a `group` instead and is dispatched separately by `executePipeline`.

- **Filter** (`kind: 'filter'`) keeps or drops the row. `run` returns `null`/`false` (drop), `true` (keep), or a `Range[]` (keep, highlighting the match); a highlighting filter's kept rows gain a same-word atom carrying those ranges.
- **Transform** (`kind: 'transform'`) emits 0+ new entries; each output branches the row into a new chain row with an atom appended. `run` returns `TransformOutput[]` of `{ entry, inputHighlights?, outputHighlights? }`, where `entry` is a string (looked up in the merged wordlist's `byNorm` index) or `[string, score]` for a tool-synthesized entry not in any wordlist.

An optional `async prepare(params, ctx)` runs **once per stage**, after every upstream stage has finished; its return value is handed to `run` in place of the params. It's where a tool compiles a regex or pre-sorts letters once instead of per row — Search compiles its match pattern, Anagram pre-sorts its target letters — or builds an index for a heavier tool. Tools without a `prepare` get the normalized params object.

`ctx` is the tool's view of the run. `ctx.wordlist` is the merged-wordlist cache (`{ entries, sourceCounts, byNorm }`; `byNorm`, a `Map<entry, wlEntry>`, is the membership index that ships today, with sorted-letter and length indexes to land as tools demand them). `ctx.input` is a lazy, read-only view of the previous stage's output as entry strings — resolved on access, so a tool that ignores it pays nothing and the executor's chain rows never leak into the tool surface; it lets a `prepare` index the surviving working set, not only the wordlist. `ctx.forEach` / `ctx.times` / `ctx.due` / `ctx.yield` / `ctx.throwIfAborted` are the cooperative-yield surface (§ Cooperative runtime). `prepare` is `async`, and carries those helpers, because indexing the wordlist is real O(N) work that has to be chunked and yielded or it freezes the tab. `run` stays narrow by contrast — synchronous, per-row, no `ctx` — so the executor keeps sole ownership of the loop, its yielding, and abort; a tool's `run` can't stall or re-drive the run.

**Two-field entry identity.** Every wlEntry carries `{ norm, display, score, comment }`:

- `norm` — the canonical letter form. Lowercase `[a-z0-9]+`, accents stripped, spaces and punctuation removed. The merge key, the input letter-pattern tools (Anagrams, Behead, Curtail, Regex, …) operate on by default, the basis for `Length`/`Min`/`Max` sort.
- `display` — the rich form as written. Set when the source carries information not recoverable from `norm` (any space, accent, punctuation, or per-entry case beyond uniform all-upper / all-lower). `null` for entries from plain wordlists, where the renderer falls back to lowercase `norm`.

Plain wordlists in the wild collapse entries to a letter-only form (`[A-Z]+` or `[a-z]+`) with no spaces, punctuation, or accents. Rich wordlists preserve those distinctions, so `mate` and `maté` become distinct entries, `theirs` and `the IRS` carry independent scores and comments, and the Acronyms tool can read `Helen of Troy` as initials `HOT`.

The naming holds across the codebase: `norm` and `display` over `canonical / raw` or `letters / written` — short in code, semantically clear, no misleading "raw" for plain sources whose raw form *is* the canonical. Tool output APIs still use the `entry` slot — that's the *string* a transform emits (typically letter-form), and the executor decides whether it lands as a `byNorm` lookup or as a synthetic `{ norm: toNorm(text), display: text === norm ? null : text }`.

Param strings get lowercased at the executor boundary (raw flag opts out for regex patterns), so tools see canonical input on both sides without per-call ceremony.

**Runtime input routing.** Tools that operate on letters receive `wlEntry.norm`; tools flagged `matchOn: 'display'` (Search, Acronyms) receive `displayOf(wlEntry)` instead. The executor in `runToolStage` picks the right input per stage based on the tool definition — and `bucketize` honors the same flag, so a `matchOn: 'display'` tool's `group.key` gets the display string too (the Acronyms grouped mode needs word boundaries). The flag also tags any ranges the tool emits with their coordinate space (`norm` or `display`), so the renderer can project at paint time without each tool having to think about coordinates.

**"Download original"** still serves the raw IndexedDB blob (`idbGet('data_' + dbKey)`) byte-for-byte, even though `display` now preserves much of what was lost before. The blob is what's most loyal to the imported file's whitespace and comment formatting, and reparsing-then-serializing would add round-trip noise. My Edits has no "Download original" affordance — it has no imported file, only accumulated edits.

### The chain-row model

A **chain row** is `{ atoms: Atom[] }`; an **atom** is `{ wlEntry, highlights, glyph }`. Each atom is one view of a word as it moves through the pipeline — the originator entry, a new word per transform, and a same-word repeat carrying each additional highlight — and the entries table stacks them vertically, sharing column widths, so a row reads top-to-bottom as one entry's journey (`RELEARNING → ELEARNING → LEARNING → EARNING`). One shape covers a one-atom result, a two-atom pair, and any longer chain — there's no separate row type per output shape. `highlights` is the atom's flat list of `{ kind, start, end }` ranges — or `null` when the atom is not a highlight slot (see § Highlights pipeline).

A regular atom's `wlEntry` references the merged wordlist (same identity as the source entry, so AtomPopover edits route correctly). A **synthetic** atom — built from a tool's `[string, score]` output for an entry in no wordlist — has `wlEntry.wordlist === null`; `AtomPopover` suppresses open on it, since editing a synthetic's score wouldn't write back anywhere.

**Atom count is static.** Every row in a given pipeline has the same atom count, derivable from the catalog records alone — `currentAtomCount(stack)` simulates the executor's emit-then-unify over the active tools (not inert) without inspecting any row. The originator is one atom; each transform appends a new-word output atom; each highlighting tool (a search, or a transform marking its input via `inputHighlights`) appends a same-word atom that `unify` folds into the tail unless the tail is itself a highlight slot — so the originator and the first search collapse to one atom, while three searches on one word leave three. `atomCount` is the resulting count; the renderer and the virtual scroller read it, so the scroller knows every row's height (`atomCount` × row height) without measuring. An empty Search row is *inert* — it reports `isInert(params)` and `executePipeline` skips it, so an empty search bar adds no atom.

**Transforms emit per directed pair.** A transform writes the dumb thing — one row per `(input, output)` it produces. Semordnilap emits a row whenever the reverse is also an entry, in *both* directions; the unification pass cleans that up afterward (§ Symmetric unification). The relation `glyph` (`→`, `↔`) is a static field on the tool, not a character the tool body picks.

### The group-row model

A **group row** clusters the merged wordlist rather than transforming it entry by entry, then runs the rest of the pipeline as a *per-group* sub-pipeline. Groupable tools today: Anagrams (letter multiset), Letter bank (distinct-letter set — POST, STOP, SPOT, TOPS cluster under `opst`), Consonantcy (consonant skeleton), Vowelcy (vowel skeleton), and Acronyms (word-initial letters of multi-word displays).

**All-mode is a flag on the stack row, not a separate tool.** A flat tool declares groupability by adding a `group: { key, columns }` sub-object — `key(entry)` returns the equivalence's canonical string, and `columns` declares the per-group attributes that surface in the row. Two `✱` affordances drive it: a one-click button in each groupable card's top-right corner (calls `pick(key, { grouped: true })` to add the tool in all-mode in a single step), and a toggle anchored to the right of the row's input (flips `row.grouped` on an existing row in place). The two are wired to the same one-at-a-time rule, the same tooltip vocabulary, and the same state via `refreshGalleryActive` / `refreshOtherAllToggles`. `row.kind()` promotes a grouped row from the def's static kind to `'group'`, and a grouped row's `params` are ignored — its input is the whole upstream row set. URL representation: `?letter_bank=SPOT` is the flat tool; `?letter_bank&all` is the grouped row. `all` is a reserved positional keyword — the decoder treats it as a flag on the preceding row when that row's tool declares a `group:` sub-object.

**Why the input-anchored toggle.** The earlier affordance was a labeled "Grouped" button on the gallery card itself, decided flat-vs-grouped at add time. The wide button conflated *picking a tool* with *picking its operating mode*, and its absolute-positioning overlapped long tool names on narrow cards. The replacement is two `✱` affordances pointing at the same concept: a small button in each groupable card's top-right corner (one-click "add this tool already in all-mode") and a toggle anchored at the right edge of the tool row's input (flip an existing flat row into all-mode, or back). Both wear the same `✱` symbol, both use the same tooltip vocabulary (*Show all values* / *Show one value* / *Already showing all values* / *Only one tool can show all values at a time*), and both gate on the one-at-a-time rule. The corner button gives the gallery the same one-shot affordance the old Grouped button had — without the alignment problem of a labeled button — while the in-row toggle handles the "I added this flat, now I want all values" path and serves as the live state indicator. When the row is in all-mode the input clears, takes a `var(--surface)` disabled-style background, shows an accent-colored `all` placeholder, and `pointer-events` go to none — the field still reads as a text box but is clearly inert until toggled off. The user's typed value is preserved in `row.params` across the toggle and restored on exit.

`bucketize(chains, def, ctx)` takes the inbound chain list and returns the K-group partition. A group is `{ key, chains, anchor? }`: `key` is the equivalence key (`def.group.key(entry)` against the chain's *tail* entry — what the upstream pipeline transformed it into), `chains` carries the bucket's members **with their atoms intact**, and `anchor` (optional) is the wlEntry the cluster pivots around when the tool declares one. This is what lets a flat transform upstream of the group survive: Behead → Vowelcy clusters the beheaded forms but each chain still reads `AAMILNE → AMILNE`, the upstream Behead atom carried forward so the chain matches the height `currentAtomCount` reserves for it. Clusters of fewer than two members are dropped by the bucketizer, not the executor — a downstream tool may legitimately thin a cluster to one survivor, so the executor never imposes the rule.

**Optional `group.anchor(key, wordlist)` hook + `group.anchorLabel`.** Returns the wlEntry that anchors the cluster (or `null` to drop it); the label names what that anchor is for the user. Acronyms declares `anchor: (key, wordlist) => wordlist.byNorm.get(key) || null` and `anchorLabel: 'Acronym'`, so a `TIS ⇄ the IRS` cluster only survives when `TIS` itself is in the wordlist — the value is the bidirectional pair, not the one-way coincidence. The anchor's score also gates the score-range filter (`applyScoreRangeToRows` drops a group whose anchor falls outside the bracket, alongside its chain-atom check), so dragging the range narrower trims acronyms whose anchor leaves the band even when the expansions wouldn't have been cut on their own. The histogram source (`bottomLineAtoms` of the unfiltered pipeline output) still reflects chain atoms only — the anchor score isn't bar-counted, so an anchor-driven cut isn't visualized by the histogram. Acronym anchors typically land in the same score band as their expansions, so the cosmetic gap is rare.

The anchor is **first-class on the row**: when `anchorLabel` is set, the group row renders a dedicated slot between Count and the chains, drawn as a real atom (mono entry text + colored score badge — the same `.atom-entry`/`.atom-score` spans chain atoms use). Click anywhere on it and AtomPopover opens on the anchor's wlEntry, so editing it is exactly like editing any other atom and routes into My Edits. The slot also drives **three derived sort axes** keyed off the anchor: `entry` (alphabetical by `anchor.norm`, label tracks `anchorLabel` — "Acronym" rather than "Entry"), plus added `length` (anchor letter count) and `score` (anchor score). For unanchored group tools (Anagrams, Letter bank, Consonantcy, Vowelcy) nothing changes — the slot is omitted and the standard group axes apply.

**Group columns appear as row attributes and sort axes.** Each entry in `group.columns` carries `{ label, value(g), sort?, tiebreaker?, tiebreakers? }`. The label becomes a column header alongside Count; `value(g)` (called with the group object — `key` and `chains` available) renders once per row, aligned to the first atom-row of the row's chains. Each column also registers a sort axis (`Sort by Letters`, etc.) unless `sort: false`. When that column is the primary sort, its `tiebreakers` (an explicit `[{ project, dir }, ...]` matching the static axis shape) drives the cascade; if omitted, the fallback is count desc, min score desc, max score desc, then chain seeds alphabetical — equal-on-the-column groups surface bigger clusters first, then order by the quality of their worst member, then their best member. The `tiebreaker: false` flag separately opts a column out of contributing to *other* axes' cascades.

**Each chained tool runs `runToolStage` on every group's chain list, independently.** Behead chained after Letter bank (grouped) runs Behead on each cluster's members — each surviving chain gains a new output atom, each non-surviving chain drops. A filter chained after a group trims its chains; a transform branches them like any flat transform. Groups whose chain list empties drop (the never-bucketized flat group is the one exception — an empty result is still a flat result, not a vanished one). The end result: every group displays the chains that *survived the full pipeline*, with the same atom-stacked journey a flat chain renders. The whole machinery is one code path — `runToolStage` and `unify` run identically over each group's chain list, since the flat seed is itself a group of K chains.

**At most one group tool per pipeline.** A second has nothing well-defined to cluster — the first already replaced the entries with group rows — so the `✱` toggle on every other groupable row greys out once one is active, the toggle handler refuses to flip a second on, and the URL decoder ignores group tools past the first.

### Cooperative runtime — supersession and yielding

`runPipeline(mergedWordlist, stack)` wraps `executePipeline` with supersession and a slow-run indicator. Refresh sites (keystroke in a tool input or the search bar, view entry, gallery click) call it fire-and-forget; the promise resolves to `{rows, atomCount, aborted}` and a caller that sees `aborted: true` drops the result silently.

**Supersession.** A module-level `AbortController` tracks the in-flight run. Each new call aborts the previous controller before starting its own, so a fast typist's stale runs unwind at their next yield point and only the latest reaches the scroller.

**One yield gate per run.** `makeYielder` builds a cooperative-yield gate at the start of each run, shared by every O(N) pass it covers — the per-row loop, the `unify` pass, the initial chain-row build, and a tool's `prepare` (through `ctx`). `due()` is a cheap synchronous check; once it reports the run has held the thread past ~6ms — about half a 60Hz frame — the caller `await`s `yield()`, which returns control to input and paint via `scheduler.yield()` (with a `setTimeout(0)` fallback) and abort-throws if the run was superseded, so a stale run unwinds without per-call bail-out code.

`due()` can't afford to read `performance.now()` every iteration, so it samples the clock once per `stride` calls and retunes `stride` after each sample to keep the sampling interval near 1ms — a hot loop of cheap iterations samples rarely, an expensive one every iteration, with nothing for a caller to tune. Time-based rather than iteration-count: a heavy predicate and a trivial one take wildly different time per row, and pinning yields to wall-clock keeps the yield rate sane across both — a fixed iteration count would yield every ~1ms on a cheap 500K filter, burning hundreds of ms of pure overhead. `run` sees none of this — it's synchronous and per-row — but a `prepare` doing heavy work drives the same gate itself, via `ctx.forEach`/`ctx.times` or `ctx.due()`/`ctx.yield()`.

**Slow-run indicator.** One global signal: the entries panel gains `.pipeline-running` at the start of every run and loses it on completion or abort. The visible effects — fading the result list (`#vs-host`) to 0.55 opacity, revealing a spinner over the panel, and reserving 96px of vertical room for it — each carry a 100ms CSS `animation-delay`, so a run that adds and removes the class inside that window cancels the animations before they start and nothing flashes on fast keystrokes. CSS-driven rather than a JS `setTimeout` because `scheduler.yield()`'s continuations outrank lower-priority tasks and starve a JS-driven slow-indicator timer on CPU-bound runs; the browser's render pipeline ticks between yields regardless of task priority, so an animation-delay reveal triggers on wall-clock time even when the executor is hot. The threshold is the *whole run total*, not per-step — a long pipeline of individually-fast tools that sum past 100ms still trips it. One signal for the whole run rather than a per-tool spinner badge: the user cares that *results* are stale, not which row is slow. The dim lands on `#vs-host` rather than the panel itself so the spinner overlay stays at full opacity while the rows behind it fade.

**Tool errors.** A thrown `def.prepare` / `def.run` / group key is caught at the per-stage boundary in `executePipeline`, wrapped in a `ToolStageError` that carries the offending stack row, and re-thrown. `runPipeline` translates the error into `{ errored: true, rows: [] }` so the caller clears the stale results rather than continuing to show them. The failing row's `_error` field holds the message; `ToolStack.refreshErrorMarks()` runs after every pipeline run and toggles a red `⚠` icon on each row (always rendered, hidden by default), clickable to reveal the message in `ErrorPopover`. The popover positions on click and toggles on outside-click or Escape, so it works on touch — `title=""` would be desktop-only. A stack run that succeeds clears `_error` on every row at the top of `executePipeline`, so fixing the broken params makes the icon disappear on the next run.

**First-paint is unconditional.** `renderWorkshopMergedDetail` calls `_signalFirstPaint()` from a `finally` block so a boot-time pipeline throw still dismisses the busy splash. Without this, a broken tool in the boot URL would strand the user on a forever-spinning overlay with no error in sight. For long-but-successful boots, `mountWorkshopPanel` attaches an `animationstart` listener that calls `_signalFirstPaint()` when the slow-run reveal kicks in, so the splash hands off to the pipeline-spinner at the 100ms mark instead of staying up until the pipeline resolves.

**Test bridge.** `__grawlixTest.pipelineIdle()` resolves when no run is in flight; `getVisibleEntries` awaits it before reading the DOM so test assertions after a keystroke don't race a not-yet-finished refresh.

**Workers — considered and rejected.** Cooperative yielding covers what workers would have bought, without their cost. Yielding already keeps the main thread responsive between chunks — workers' core promise. There's no untrusted code to sandbox: custom JS tools (see [`planned/tools.md` § Open questions](planned/tools.md#open-questions)) run in the author's own browser, so a misbehaving tool only locks up its author. And worker bundling is awkward without a build step — the naïve "copy 500K entries every keystroke" shape serializes ~25 MB through structured clone each direction, likely slower than the main-thread compute it replaces; the viable shape (worker holds the wordlist) pulls a state-sync protocol into every mutation. Revisit only if a built-in tool surfaces whose work fundamentally can't fit the cooperative budget — bulk preprocessing where chunked yields can't hide enough latency.

### Symmetric unification

Semordnilap emits both `STRESSED → DESSERTS` and `DESSERTS → STRESSED`. The post-executor `unify` pass collapses such mirror pairs — rows that are exact reverses of each other, mirrored entries and mirrored scores — into a single row and promotes its relation glyph to `↔`, the natural glyph for "two one-way rows pointing at each other." (`unify` also does the within-row collapse of redundant same-word atoms — see § Highlights pipeline.) A downstream transform breaks the symmetry: `semordnilap → behead` diverges the two directions (`STRESSED → DESSERTS → ESSERTS` is not the reverse of `DESSERTS → STRESSED → TRESSED`), so those rows fail the mirror test and stay separate with directed `→` glyphs. The tool author writes the dumb bidirectional emit; whether a pair dedupes is decided afterward, from whether the rows actually mirror once the full pipeline has run.

Of the two directions, the survivor is chosen explicitly — whichever entry chain sorts lexicographically smaller — so the result is deterministic regardless of the order the executor emitted the pair in. The survivor keeps its own direction's highlights; the dropped direction's are not carried over. (Carrying them — lighting both atoms from both directions' search hits — was considered and dropped: the carried highlight could land on an already-lit atom, which by the unification rule spawns an extra atom, letting a unified row outgrow the static atom count.)

Because search is a pipeline tool running *before* unification, this composes: searching `ss` on semordnilap output highlights `stre[ss]ed` on the surviving row's tail. A one-sided query — matching only one direction's tail — kills the other direction, leaving an un-mirrored lone row that stays a directed `→`. That degradation is the accepted cost of folding search into the pipeline rather than running it after unification; running it after would keep the `↔` but make search a special non-tool case.

`unify` runs only when the stack actually produces multi-atom rows — when some active stage is a transform or a highlighting filter. A filter-only chain leaves every row a lone atom, where both the mirror collapse and the within-row collapse are no-ops, so the executor skips the pass and returns its rows untouched. In a grouped pipeline `unify` runs *per group* — mirror collapse only makes sense within a single cluster, since cross-group mirrors aren't a thing the user is comparing.

### Chain-row display

Atoms render top-to-bottom on every viewport — there is no side-by-side layout at any width. The entries table is one CSS Grid per row with `grid-auto-rows`; each atom occupies one grid line (`count`, then `entry` / `len` / `score`), and lines past the first wrap onto their own grid row while staying column-aligned with the line above via shared `--entry-w` / `--len-w` / `--score-w` variables. The relation glyph prefixes every word-introducing atom's entry; a same-word repeat atom carries none. Row stride is atom count × row height; the virtual scroller reads the static atom count for its stride math, and the row's own height is content-driven by the grid.

Comment and Source columns appear on every chain shape — a one-atom row and a stacked multi-atom row alike — when the viewport has room, dropping staggered as it narrows (source first at <960px, then comment at <760px). They render per-atom: each atom line carries its own comment and source, so a chain row reads top-to-bottom as where every word in the journey comes from. A synthetic atom — built from a tool's `[string, score]` output, sourced from no wordlist — gets blank cells. Column visibility is pure CSS media-query gating; the renderer emits len / score / comment / source on every atom line, including same-word repeats — a Kangaroos + Search row shows the metadata on both highlight lines rather than leaving the second line's cells empty. Headers stay constant: the Entry / Length / Score labels describe what each *line* contains, not the row, so one header set serves every chain shape.

### Group-row display

A group row lays out the cluster's surviving chains **side-by-side**, with each chain rendered the way a flat chain row would — atoms stacked top-to-bottom (entry / score per atom-row), the relation glyph prefixing each word-introducing atom. The row's chrome (row number, Count, the anchor slot when present, group columns) lives on the row's first atom-row only; chains extend down from there. Row stride is `atomCount × ROW_HEIGHT` where `atomCount` is shared with flat chains via `currentAtomCount(stack)` — the cluster seed plus what every chained tool adds.

The shape mirrors flat chains intentionally: a group row reads as "many of those flat chains, clustered." There is no Length, Comment, or Source column on group chains — a cluster is about set membership and the per-chain atoms are already wider than a single flat atom — but everything else carries over: same `.atom-entry`/`.atom-score` spans, same `<mark>` highlight markup, same AtomPopover routing.

**Overflow truncates rather than scrolls.** A row wider than its `.group-chains` slot clips at the slot's right edge, ending in a `+N more` chip — `N` the count of chains past the edge — with a fade gradient ramping the last visible chain out beneath the chip. Clicking the chip opens a popover with all of the row's chains, the same chain shape, wrap-stacked. A group member is editable wherever it shows — a visible chain's atom or a hidden chain's atom in the popover — through the AtomPopover. The popover dismisses on Escape, an outside click, or a re-click of its chip; it renders in chunks (200 chains at a time, more loaded as the user scrolls to the bottom via an `IntersectionObserver` sentinel) so a multi-thousand-chain cluster opens without a freeze.

### Sort axes per tier

Axes split by the pipeline's shape — a filter-only chain, a chain with a transform, or a pipeline with a group tool — not by an output kind. `isFilterOnlyChain(stack)` and `isGroupChain(stack)` are the signals — a filter-only chain can still stack several atoms (three searches on one word), but they're all the same word and score, so the score-spread axes would be noise; only a transform gives a row genuinely distinct atoms to sort across:

- **Filter-only chains** (empty stack, searches, plain filters): Entry, Length, Score. Default Entry asc.
- **Chains with a transform:** Entry, Length, Min score, Max score. Default Entry asc — same default in every tier, so adding a transform never silently swaps the axis on the user, and the table holds still when one comes or goes. Min score is one dropdown click away for grid-filling "what's worth fishing out" passes.
- **Grouped pipelines** (a group tool in the stack): Entry, Count, Min score, Max score. Default Entry asc. **With an anchor** (Acronyms): Entry's label and projection track the anchor (alphabetical by `anchor.norm`, labeled "Acronym"), and two extra axes register — `length` ("Acronym length", `anchor.norm.length`) and `score` ("Acronym score", `anchor.score`).

*Entry* (alphabetical) and *Length* project off the **first atom** — the merged-wordlist entry the row grew from — so the table holds its order when a tool is added: a filter or 1-output transform leaves every first atom in place, and the rows can't reshuffle. *Min/Max score* project across every atom; for filter-only chains *Score* reads the row's word directly. Each axis carries `{label, primary, tiebreakers}`; flipping the user direction reverses only the primary, tiebreakers keep their declared direction so short low-scoring junk doesn't float to the top of a tied bucket (longer > shorter, higher > lower, alphabetical asc as the final stable fallback).

A multi-output transform (anagram) branches one input into rows that share their *whole* first atom — indistinguishable by any first-atom projection. Each first-atom tiebreaker chain replays the tool-less order (Entry's is a no-op, since merged entries are unique; Length's is score desc then entry asc), then ends with `rowChainTail` — the later atoms joined low-separator — so branches fall into alphabetical order by their own output.

In a grouped pipeline the axes project off the whole group: Entry off the chains' seed atoms in display order, Count off the surviving chain count, Min/Max score across every atom in every chain. The chains *within* a group are themselves ordered to match the axis — alphabetical-by-seed under Entry, seed-score-descending otherwise — and Entry holds them ascending regardless of the row direction, since the toggle reverses the rows, not the chains inside a cluster.

The URL drops `sort=` when the axis matches the current tier's default. A stack edit that flips the tier — adding or removing a transform or a group tool — never snaps the chosen axis to a tier default; it remaps it. `entry` exists in every tier and carries across untouched. `score` ⇄ `min-score`, and `max-score` collapses to `score` when a transform is removed. `length` (the chain tiers) and `count` (the group tier) have no counterpart in the other, so they map to each other — every axis survives a tier round-trip rather than being silently lost. The tier default applies only on first boot from a URL with no `sort=`, never as a snap-back when crossing a boundary, so the user's sort intent survives adding and removing tools. The sort direction is preserved across a remap. The whole sort story is provisional — expect iteration now that the UI is live.

### Highlights pipeline

Search hits and tool-emitted highlights share one renderer and one channel: an atom's `highlights` is a flat list of `{ kind, start, end }` records in entry coordinates — or `null` when the atom is not a **highlight slot** at all (the originator, a plain transform output). A slot atom whose tool matched without producing any ranges holds `[]`, not `null`: `[]` still means "a slot, just empty." Each highlighting tool annotates its *own* atom — a search its same-word atom, a transform its input-mark atom (Behead's struck-through `removed` letters, Regex-replace's matched capture groups) or its output atom — so highlights from different tools never share an atom and never need merging. Tools emit those atoms unconditionally; `unify`'s `collapseRepeatAtoms` then folds adjacent same-word atoms together, **unless both are highlight slots** — that's the rule that collapses the originator into the first search yet leaves three searches as three distinct atoms. Keying the fold on slot-ness (`highlights !== null`) rather than on a non-empty array is what keeps a row's atom count equal to `currentAtomCount`'s static prediction even when a tool highlights only conditionally — a wildcard-only search matches every entry but produces no ranges, and its `[]`-holding atom must still count. Search is a tool, so its hits are baked into the chain like any tool's — `buildSearchPattern` exposes a `searchRanges(text)` function returning `search:N` records (one per matched literal run of the query — see *Literal-run highlighting* — the `N` cycling five color slots); transforms like Behead emit `removed` ranges. `renderHighlightedText(text, ranges)` walks an atom's merged-and-sorted ranges once, emitting `<mark class="search-match search-match-N">` for `search:N` kinds and `<span class="hl-<kind>">` for tool kinds.

**Literal-run highlighting.** Both Search and Regex color the *literal runs* of a pattern — maximal stretches of verbatim literal characters — and leave wildcards dark. The premise: highlighting *locates and groups*, it never *reveals* (the entry text is fully visible regardless), so a wildcard position carries no information worth a colored band and a dark notch for it only costs contiguity. So a run breaks on every wildcard: Search's `* ? # @` and `[…]` classes, Regex's `.`, classes (`[…]`, `\d`…), quantified atoms, groups, alternation, and anchors. `c?t` (Search) and `c.t` (Regex) both light `c` and `t`, leaving the middle dark — the two tools stay consistent because they apply the same rule. `buildSearchPattern` wraps each literal run of the compiled query in a capture group; `analyzeRegexPattern` does the same for a regex body, except it first checks for the user's own capture groups and honors those instead when the pattern has any. Either way a match's `indices` expose the runs to `groupSpansToRanges`.

The Regex tool reuses the `search:N` channel on both sides rather than minting its own kinds. As a replace transform it builds the output itself (`runRegexReplace`, not `String.replace`, so it can record output offsets), and which side carries which color follows the same group/no-group split the filter side uses. **With capture groups**, it colors each capture group on the input atom and its `$N`/`$&` echoes on the output atom with the *same* color — rearranged letters visibly move between the two — and literal replacement text stays dark. **With no capture groups**, there is no cross-side flow to trace, so each side falls back to literal-run highlighting: the pattern's literal runs on the input atom, the replacement string's literal runs on the output atom, both cycling `search:N`. The input runs come from a separate run-wrapped highlight regex (`hlRe`) built alongside the functional one — the functional regex can't be run-wrapped because synthetic groups would renumber the user's `$N`. A `$&`/`$N` echo on the output stays dark in this regime: with nothing to pair it to, the literal text is what carries meaning.

Search-replace highlights differently from its filter mode: `runSearchReplace` does a literal whole-span substitution, so there are no literal runs to segment within a match. It marks the whole matched span on the input atom and the whole replacement span on the output atom — one `search:N` color per match, paired across the two so the swap reads at a glance.

The kind registry is open-ended — adding a new tool highlight kind is one (kind name, CSS rule) pair. `removed` is the only tool-emitted kind shipped today (line-through + 0.5 opacity); future kinds (`kept`, `inserted`, `shifted`) land as tools start producing them. Match and capture-group coloring did not need a new kind — the Regex tool reuses the `search:N` channel (see *Highlights pipeline*).

Both `WorkshopEntriesScroller` and `LibraryEntriesScroller` route through the same `renderHighlightedText`; Library has no pipeline and computes its own search ranges directly.

**Range positions carry their coordinate space.** Each range carries an implicit `coord` tag — `norm` for letter-pattern tools (Behead, Curtail, Anagrams, …), `display` for the two display-aware tools (Search, Acronyms). The executor in `runToolStage` tags ranges as it appends them to atoms, so tools don't have to think about coordinates. At paint time `projectRangesToDisplay` projects `norm`-tagged ranges onto the display string via a per-wlEntry `Uint16Array` (norm index → display index), so a Behead range `[0, count]` lights up the right display characters even when the display has spaces or accents between the letters. Display-tagged ranges (Search hits) pass through unchanged.

On plain entries (`display === null`) the projection is the identity and the array is never built — near-zero cost on letter-only wordlists. On rich entries the array is built lazily and cached on `wlEntry._normMap`.

### Space out: phrase reconstruction via word-frequency NLP

Wordlists strip spaces. A serious crossword wordlist is plausibly more than half multi-word phrases — `ABARRELOFLAUGHS`, `BATOUTOFHELL`, `MIKHAILGORBACHEV`, `FBIAGENT` — stored as run-together letters because the grid representation strips them. **Space out** recovers those boundaries: it takes each entry and emits the most likely way to put the spaces back.

The naive "enumerate every legal split" shape produces tons of garbage. For `ABARRELOFLAUGHS` it would yield `A BARREL OF LAUGHS` (correct) alongside `A BARR ELO FLA UGHS` and four other nonsense parses. The wordlist's own scores can't filter the noise — BARR (Roseanne), ELO (band), FLA (Florida abbreviation) all legitimately appear in serious wordlists with non-trivial scores. The missing signal is *language-model probability*: in real English text, BARREL is orders of magnitude more frequent than BARR, LAUGHS far more frequent than UGHS, FLA far more frequent than... well, nothing — FLA is in the corpus. But the joint probability of "BARR ELO FLA UGHS" appearing as a sequence collapses many orders of magnitude below "BARREL OF LAUGHS." That's the discriminator the wordlist scores don't carry.

**Norvig's word segmenter.** Given a unigram frequency table for English, the most likely segmentation maximizes the product of per-word probabilities. The algorithm is ~10 lines of recursion with suffix memoization: for each prefix of length 1..n, score = log P(prefix) + best_score(suffix). Pick the max. For the entry lengths real wordlists carry (≤25 chars), per-call cost is microseconds; over a 500K wordlist the whole pass stays in the same speed budget as the other tools.

**Why a corpus, not just wordlist scores.** Brief tried alternatives:
- *Wordlist scores alone* — rejected; see opening paragraph.
- *Hardcoded curated short-word list (A, I, OF, IS, …)* — rejected; the corpus subsumes it. A, I, OF all have very high frequencies in any blended English corpus, so the segmenter handles them by construction. One signal, not two.
- *Bigrams / trigrams* — deferred. Adds ~20–50MB of bundled data; catches collocation signal that unigrams miss (`BARREL OF` is a much more common bigram than `BARR ELO`). Worth revisiting if unigrams produce noticeable failures on real wordlists. Unigrams alone clear the BARR/ELO/FLA failure mode by ~40 log-units, so the headroom is generous.
- *In-browser LM via transformers.js or WebLLM (WebGPU)* — deferred. Higher quality ceiling (true semantic judgment) but per-query inference at 10–100ms blows the speed budget by 4+ orders of magnitude over a wordlist pass. Plausible as a *re-ranker* on top of unigram top-K if real-world quality demands it.
- *Browser-native AI (Chrome `window.ai` / Gemini Nano)* — deferred. Free, local, semantic, but Chrome-only behind flags currently. Worth tracking for portability.

**The corpus.** The unigram frequency table is wordfreq's `large` English list (MIT-licensed, blended from Wikipedia + OpenSubtitles + Twitter + Google Books + news + reddit). ~320K entries, fetched directly from the upstream `rspeer/wordfreq` GitHub repo as `large_en.msgpack.gz` (~1.5 MB). The file is wordfreq's native centibel-bucketed msgpack: array index N is the bucket whose words have `log10(freq) = -N/100`. A small msgpack decoder and a `DecompressionStream('gzip')` pass produce the in-memory lookup. The blended-source corpus covers proper nouns and contemporary abbreviations (FBI, NASA, MIKHAIL, GORBACHEV) that a literary-only corpus would miss.

**Same fetch/cache/auto-update infrastructure as wordlists.** `loadUnigramCorpus()` checks the IDB cache first; on miss, fetches plaintext and stores it. `checkForUpdates()` HEADs the corpus URL each hour and compares `content-length` against the stored size — if it changed, the cache is invalidated and the corpus refetched. No version number in the filename. The corpus is fetched in the background at app boot alongside the wordlist auto-fetch, so by the time the user reaches for Space out the segmenter is usually warm. On a cold cache the tool's `prepare()` awaits the load and the existing `.pipeline-running` indicator covers the wait. Hard network failure surfaces as an empty result set.

**OOV calibration is corpus-floor-anchored, not Norvig's raw-count formula.** Norvig's original `P(OOV) = 1/(N×10^len)` was tuned for raw word counts (N = corpus size). Under wordfreq's normalized probability distribution, that formula leaves out-of-vocabulary words *more* probable than rare known words — a long OOV at `−len × log(10)` ends up above the `−18` floor for the rarest in-vocabulary entries. The consequence is silent: splits like `ABARREL OF LAUGHS` (where `ABARREL` is OOV) score nearly as high as the correct `A BARREL OF LAUGHS`, and the score window can't tell them apart. So the OOV log-probability is `unigramMinLogFreq − len × ln 10` — anchored to the corpus's actual floor, with Norvig's per-letter 10× decay layered on. With this calibration the BARR/ELO/FLA-style splits sit ~40+ log-units below the real one.

**Morpheme-aware second chance before OOV fallback.** The OOV floor handles unknown letter-sequences correctly but leaves a residual failure mode: inflected forms that slip through corpus coverage get crushed by the per-letter decay (~20 log-units for a 6-letter word), and the per-part penalty (`SPACE_OUT_PART_PENALTY = 7`) can't outpace that on its own. The result was splits like `ball ed` beating the joined `balled` whenever `balled` happened to be missing from the corpus. So `unigramLogFreq` tries one more thing before the OOV fallback: decompose the word as `stem + suffix` against a small whitelist of inflectional suffixes (`s, es, ed, ied, ing, er, est, ly, ies`), with E-elision (`raced → race + ed`, `racing → race + ing`) and Y→I (`tried → try + ied`, `tries → try + ies`) ortho rules. If the stem is in the corpus, the inflected form claims `stemLogFreq − SPACE_OUT_MORPHEME_PENALTY` (1.0 log-units, ≈ 37% of the stem's frequency). The per-part penalty then breaks the tie in favor of the joined form. Inflectional only — derivational suffixes (`-tion`, `-ness`, `-ment`, `-able`) are usually well-covered by the corpus directly, and recursive decomposition would open false-positive doors (`singing` → `sin + ging`?).

**Score window for selecting near-ties, not top-K.** Some entries admit one obvious split (`INCANDESCENT` → `INCAN DESCENT`, the only valid 2-part parse — a built-in funny-find). Others admit several near-tied readings (`MANSLAUGHTER` → `MAN SLAUGHTER` vs `MANS LAUGHTER`). The tool returns the top-scoring split plus any other splits within N log-units of it. Norvig log-scores are absolute likelihood ratios *within a given entry* — a 5-log-unit gap means the alternative is ~150× less likely — so a fixed window cleanly separates "genuine alternative" from "obvious garbage" regardless of how many candidates an entry happens to admit. Top-K, by contrast, would drag in junk when only one good split exists.

The window is user-controllable via a 3-position slider param, **Splits** (One / Few / Many), backed by `SPACE_OUT_WINDOWS = { one: 2, few: 5, many: 10 }` — within ~7× / ~150× / ~22000× of the top. Default is Few. One overrides the window to return exactly the top result (the user wants a single confident reading); Many surfaces speculative alternates including the funny-find regime where wrong-but-amusing parses surface deliberately. The slider's URL representation is the label itself (`splits=many`), not the position.

**Digit runs never split mid-run.** A digit-to-digit transition is essentially never a word boundary in written English — "25" reads as one token, not "2 5"; "100" is one token, not "1 0 0". The corpus alone can't enforce this because individual digits have very high frequencies (they appear everywhere as years, page numbers, list items), so the segmenter happily picks "2 5 or 6 to 4" over "25 or 6 to 4" if left to ranking. The fix is a hardcoded rule in the segmenter's prefix loop: skip any split point where the last character of the prefix and the first character of the suffix are both digits. This is the one character-class exception layered on top of the otherwise purely-probabilistic algorithm.

**Synthetic-atom score = input entry's score.** The tool emits `[joined, inputScore]`-shaped synthetic outputs, picked up by the executor's existing synthetic-atom path: a `wlEntry` with `wordlist: null`, no AtomPopover edit, blank Comment/Source columns. The displayed score is the originating wordlist entry's score, not min-of-parts or the Norvig log-likelihood. Rationale: Space out is *rendering* an existing entry, not creating a new one. `ABARRELOFLAUGHS` at score 80 stays score 80 when displayed as "A BARREL OF LAUGHS" — same entry, same quality, just with spaces restored. The Norvig log-likelihood is a *ranking signal*, decoupled from display.

**Downstream chain composition is undefined.** Chaining `[space_out, behead]` runs Behead on a synthetic multi-word entry like "A BARREL OF LAUGHS"; Behead operates on the norm (`abarreloflaughs`) which trivially has no `byNorm` entry for `barreloflaughs`, so the row drops. Probably degenerates harmlessly but the chained semantics are fuzzy; documented here in case a downstream tool ever wants to surface multi-word entries differently.

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

**Search and Regex highlights** mark pattern matches in the entry slot via `<mark>` spans, colored per literal run or capture group. Ellipsis truncation respects the markup.

**Sort control inside the stats bar.** "Sort by [Entry ▾] [↑]" sits at the right edge of the stats bar, after the score-range input — not in a dedicated toolbar above the table. Counts, stats numbers, and histogram on the left describe the visible result set; score range and sort on the right shape it. The Workshop scroller mounts its axes into `#stats-bar-sort` (a slot inside the stats bar's right region) so the available sort axes update with the pipeline's tier; Library renders its three static axes (Entry, Length, Score) directly into the same class slot.

The sort axis is a native `<select>` with `appearance: none` and a chevron painted via background-image — quiet inline text rather than bordered chrome. Direction is a borderless `↑`/`↓` button next to it. No persistent border or background; the controls flow inline with natural HTML whitespace between them. Sort axes: Entry (alphabetical by word), Length, Score (or Min score / Max score on a multi-atom chain tier). Default Entry ascending; every other axis defaults to descending when first selected.

**Stats bar refresh is surgical.** A score-range keystroke triggers a re-render of the bar's counts and stats numbers, but `.stats-bar-controls` (containing the input the user is typing into) is left untouched — `swapStatsBarReadouts` replaces only `.stats-bar-counts` and `.stats-bar-distribution`. Rebuilding the whole bar on every keystroke would destroy the input element under the cursor and drop focus mid-edit.

**Click an atom → AtomPopover.** A click-driven popover anchored to the clicked atom (word or score). Content: a header line repeating the atom for context, a source block (which wordlist sourced the score, with rescore/override info or "Ignored by rescore rules"), score and comment text inputs, a "Saves to My Edits" footer, and a Delete button when the row is sourced from My Edits. Edits commit via Enter (commit + close) or blur (commit, popover stays open so you can tab to the next field); Escape reverts and closes. Click-outside, resize, search/filter/sort changes, and panel re-mount all close it — but **scroll does not**. The popover is `position: fixed`; on scroll it floats free of its anchor and stays open, its header still naming the atom. Closing on scroll instead would let iOS dismiss an edit the instant it opened: focusing the popover's input scrolls it above the soft keyboard, and that scroll would read as a scroll-to-dismiss.

Score/comment edits and the rescore/override explanation all live in the popover — not as in-cell `<input>` swaps and not in a hover-only tooltip. The Comment and Source columns *display* that data on the at-rest list when the viewport is wide enough (see § Chain-row display); editing still routes through the popover — clicking a comment cell opens it focused on the comment field. On narrow viewports the columns drop and the popover is the only path to both.

**Re-render across edits keeps the popover open.** Edits flow through `_onCellEdit`, which routes to `upsertEdits` (non-Edits views) or directly mutates `rawEntries` (My Edits view), then triggers `_applyFilterAndSort(false)`. The scroller re-renders rows but doesn't close the popover, so chained edits (score → tab → comment) work. After re-render, the row matching the popover's active entry gets `.active` reapplied via `AtomPopover.rebindRow`.

**Virtual scrolling.** Rows are absolute-positioned inside a height-sized `.entries-table-rows` container; the scroller materializes only rows in the current viewport ± a buffer. Each row's `top` is `i ×` the row stride (atom count × `ROW_HEIGHT`).

**Two scrollers, one base class.** `BaseVirtualScroller` owns the shared mechanics — sizer DOM, capture-mode window scroll listener, ResizeObserver, the visible-range math, destroy. `WorkshopEntriesScroller` extends it with the atom-grid render, AtomPopover binding, click-to-edit wiring, and the sort toolbar. `LibraryEntriesScroller` extends it with the monospace render, mode-aware `→` annotations, and live rescore-rule preview. The two scrollers diverge in everything the user sees — they share only the act of "render a window of rows into a sizer as the user scrolls."

## Entries-table export

A kebab `⋮` menu at the right end of the Workshop stats bar offers four ways to get the current view out of Grawlix: **Copy to clipboard**, **Download as wordlist**, **Download as CSV**, **Download as JSON**. The four split by audience — Copy for paste-into-chat, wordlist for filling tools (Crossfire, Ingrid, Compiler, Crosserville), CSV for spreadsheets, JSON for scripters.

**Kebab over icon buttons or a dialog.** Two icon buttons (download + copy) was considered and rejected — icon mystery vs self-documenting named items, and the bar already collapses Min/Max on narrow viewports without room for more chrome. An "Export…" dialog with format chooser and live preview was considered and rejected as overcomplex for the common case; the kebab keeps the bar quiet and the per-format defaults are sensible enough.

**Scope is the visible view.** Every format reflects the current filter, sort, and pipeline output. Score range applies (WYSIWYG). Grouped pipelines export every surviving member chain — the `+N more` cap is a display artifact, not a filter. Synthetic atoms (tool-supplied `[string, score]` with no wordlist backing) are included.

**Same skip rule everywhere: highlight-slot atoms collapse.** A chain's same-word repeat atoms (the `[]`-slot atoms emitted by Search and other highlighting tools) are display constructs — their entry/score/comment match the prior atom — so exports use the chain's *content* entries (originator + transform outputs). `currentContentAtomCount(stack)` derives the static count from the catalog records (`1 + non-inert transforms`); CSV's column count and JSON's `entries[]` length both align with it.

**No "Export…" dialog or sticky settings.** Defaults are baked into each menu item; "Copy as wordlist with comments" or a comment-toggle variant lands only if users surface the need. Same for "with source attribution" — the column appears in the merged-view display but not in CSV/JSON exports today. Surface complexity costs more than the minor friction of users post-processing.

### Copy to clipboard

Plain text with a markdown header. Header is `[Tool description](URL)` — a markdown link to the URL that reproduces the view; string param values are backtick-quoted inside the label so a wildcard like `*EARNING` doesn't trigger italic-on-rest-of-line in markdown renderers that parse formatting inside link text (numeric params can't carry markdown specials and go bare for legibility). Empty-stack/empty-search header uses `[All](URL)` — the merged view's name — so every copy has the same shape rather than degrading to a bare angle-bracketed URL. No `#` prefix — markdown would render it as H1.

Body: one row per line, chains rendered inline with their glyphs (`RELEARNING → ELEARNING → LEARNING → EARNING`). Semordnilap mirror pairs use `↔` per `unify`. Grouped pipelines render one line per group as `chain1, chain2, …` — no `group_key:` prefix, since the key isn't shown on the group rows the user is looking at either; CSV/JSON carry the key when an exporter needs it.

Sort order = current table sort, no dedup needed (chains with glyphs are visibly distinct, so two journeys to the same tail are two distinct lines naturally).

### Download as wordlist

Strict `ENTRY;SCORE` per line, no header, no comments, `\n` line endings, trailing newline. Intended for filling tools that expect raw wordlist format.

**Chain rows → tail entry only.** The journey is meaningful in Grawlix but irrelevant to the filling tool consuming the file.

**Score = min across chain content atoms.** Matches the existing rationale that the worst-scoring atom caps a chain's quality (§ Sort axes per tier). A theme using both ends of the chain has to live with the weak link.

**Dedup by tail entry, score = max-of-mins.** Two chains both producing EARNING (mins 30 and 50) collapse to one `EARNING;50` line. Each chain is an alternate path; the user has the option of using the strongest, so the entry's effective quality is the better path's min. Per output entry: max over chains producing it of (min over atoms in chain of atom score).

**Grouped pipelines flatten.** Every surviving member-chain tail, group identity discarded. Wordlist format can't represent clusters; CSV/JSON carry the structure when needed.

**Sort = alphabetical asc.** Decoupled from the user's Workshop sort. Wordlist files in the wild ship alphabetical-ish (XWI, Broda, JK, STWL all follow this), and a canonical sort is diffable across snapshots.

**Semicolon-in-entry handling: drop + toast notice.** Wordlist format has no escape mechanism. Toast: `Downloaded grawlix-search-ice.txt — 124 entries (2 skipped due to semicolons)`. Parenthetical omitted when zero. Replacing the `;` with anything else would silently corrupt entries.

**Comments off by default.** The export's purpose is "snapshot for filling tool," not backup — comments are scoring metadata that mostly lives in Grawlix, and at least one consumer (Crossfire) chokes on them. Backup is Library's per-wordlist Download.

### Download as CSV

Spreadsheet-oriented structured format (`.csv`). Header row, RFC 4180 `"` quoting (handles entries with `,`, `;`, `"`, newlines — no dropping needed), UTF-8, `\r\n` line endings (Excel-friendly).

**Column order matches the site's display: `entry, length, score, comment, source`** — interleaved per entry on multi-content-atom chain rows (`entry_1, length_1, score_1, comment_1, source_1, entry_2, …`). On flat one-content-atom rows, plain column names.

**Sort = preserve table sort, no dedup.** CSV is the "analyze elsewhere" format; the user's current sort signals intent, and multiple chains producing the same tail are distinct rows.

**Computed columns kept** (`min_score`, `max_score` before the entry columns; `count` on grouped rows; catalog group columns). Asymmetric with JSON — the spreadsheet audience would hand-type `=MIN(...)` formulas otherwise.

**Comments + source mimic the display table** — present on flat pipelines, omitted on grouped (per `design.md`'s "no Length, Comment, or Source column on group chains" rule).

### Download as JSON

Scripter-oriented structured format (`.json`). Pretty-printed (2-space indent), UTF-8. Mirrors the executor's `group → chains → entries` model directly.

**Uniform shape regardless of pipeline.** Always `{url, tools, score_range?, sort, groups}`. Flat pipelines are one mega-group (no `group_key`, no catalog cols, comments/source on entries). Grouped pipelines have one group per cluster (with `group_key` and catalog cols, comments/source omitted on entries per the same rule as CSV). Consumer parses one schema.

**Drops generically-computed fields** — `length`, `count`, `min_score`, `max_score`. Scripter can compute trivially (`Math.min(...chain.entries.map(e => e.score))`); the JSON should be lean. Catalog group cols *kept* — they're tool-declared, and JSON doesn't know whether a given catalog col is trivially derivable from `group_key` (Letter clusters' `letters` is `group_key.length`) or non-trivial.

**Metadata fields:** `url` (the link that reproduces the view; mostly redundant with `tools`+`sort` but kept as the human-clickable handle); `tools` (parsed pipeline as `[{name, params?, grouped?}]` in order, with the same skip rule as `Router.buildQuery` — permanent search bar drops out when inert, other rows kept); `score_range` ({min, max} numbers, either bound omitted when open-ended, whole field omitted when no range set — the one piece not in URL since the filter is per-user); `sort` ({by, dir} matching internal axis keys).

Wordlist metadata (names + enabled state) was considered for forensic-reproducibility ("which data produced this view") and deferred — noise for the common case; timestamps and Grawlix-version fields were rejected outright (privacy-leakage on shared files, premature).

### Filename scheme

Across all three Download formats: `grawlix-<tool>-<param>-<tool>-<param>.<ext>`. Same tool keys as the URL query string, sanitized for filesystem safety (lowercase, wildcards `?` `*` `#` `@` `[…]` stripped — invalid on Windows, noisy anyway; non-alphanumerics collapsed to `-`; capped at 100 chars). Empty pipeline → `grawlix-all.<ext>`. The downside is that `grawlix-search-ice.txt` can't distinguish `?ICE` from `*ICE` from plain `ICE`; accepted, since the file content is the source of truth and the filename is just for telling snapshots apart in the Downloads folder.

## Help

The header `?` button is a deactivated placeholder — present so the slot doesn't disappear, but with a `not-allowed` cursor and no behavior. There is no help surface yet; one is planned in [`planned/help.md`](planned/help.md), to land once [`planned/tools.md`](planned/tools.md) settles.

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

- `sort=<axis>` — depends on the chain's sort tier (§ Sort axes per chain tier). Filter-only chains: `entry`, `length`, `score`. Chains with a transform: `entry`, `length`, `min-score`, `max-score`. Dropped when the axis matches the tier's default — `entry` in every tier.
- `sort-dir=<asc|desc>` — dropped when the direction matches the axis's default. `entry` defaults to ascending (alphabetical reads naturally A→Z); every other axis (`length`, `score`, `min-score`, `max-score`) defaults to descending, which reads top-down as "best/biggest rows first".

The two-key form keeps each piece independently minimizable, so the common cases stay quiet — `entry asc` is silent across every tier, `score desc` is just `sort=score`, `score asc` is `sort=score&sort-dir=asc`. `sort-dir` can appear without `sort` (e.g. `entry desc` becomes `sort-dir=desc`); the parser treats an absent `sort` as the tier default.

Unknown values for either key are dropped without a toast (no churn risk — the axes are a closed set, unlike the tool catalog). The parser accepts any axis valid in either tier; the scroller remaps the parsed axis (§ Sort axes per chain tier) if it isn't valid for the current tier. Sort persists across wordlist switches inside a session: it's a view-config preference of the user, not of the focused wordlist.

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

- **Score filter** (both Workshop's single filter and Library's per-(wordlist, mode) filters). Stored in localStorage, not the URL. Two reasons — written down so the question doesn't get re-litigated:
  1. **Scores aren't portable across users.** What counts as `60` depends on which wordlists you have loaded and how you've rescored them. There is no universal scale — even the "common" tier labels (great / good / fair / …) are themselves per-user via My Edits' scoring. A shared `score=60` filter would apply the sender's number to the recipient's scale and produce nonsense. The other URL params don't have this problem: a search pattern, a whole-word toggle, a sort axis, and a tool stack all mean the same thing on any setup.
  2. **It's a standing preference, not a query.** The dominant use is "filter the low-scoring junk out so I'm not wading through it" — that's a setting the user wants in place every visit, not something they re-enter each load. URL-bound state resets to empty on a fresh visit (no link to apply); localStorage carries it forward.
- **Dialogs** (settings, etc.) — transient UI state. Open them how you opened them; close them when you're done.
- **Library's focused wordlist** and its display mode — Library is wordlist-management workspace, not something a link should pre-position the recipient into.
- Scroll position, edit-in-progress state, transient popovers.

## Caches

Wordlists can be hundreds of thousands of entries. Several caches keep wordlist switching, score editing, and merging snappy. They live either on the wordlist object (`wordlist._foo`) or as module-level variables, and they all derive their values from `state.sources` plus per-wordlist `rawEntries` and `rescoreRules`.

| Cache | Scope | Derived from | Cleared by |
|---|---|---|---|
| `wordlist._rescored` | per-wordlist | own `rawEntries` + `rescoreRules` | `invalidateRescoredCache(wordlist)` |
| `wordlist._rescoredMap` | per-wordlist | `_rescored` (`norm` → wlEntry, for fast lookup) | `invalidateRescoredCache(wordlist)` |
| `wordlist._actualScores` | per-wordlist | own `rawEntries` (sorted distinct raw scores; feeds `_uncovered`) | `invalidateActualScoresCache(wordlist)` |
| `_mergedWordlistCache` | module | every enabled wordlist's `_rescored` (entries + `byNorm` + `byKey` maps) | `invalidateSourceCounts()` |
| `_sourceCountsCache` | module | aliases `_mergedWordlistCache.sourceCounts` | `invalidateSourceCounts()` |
| `_mergedWordlistCache._initialChains` | module (on the merged cache) | the cache's `entries` — one seed chain row each | replacing `_mergedWordlistCache` |
| `_statsCache` (WeakMap) | module, keyed by wordlist or `_mergedStatsKey` | a wordlist's `rawEntries` (or merged entries) | `invalidateStatsCache(key)` |
| `_layoutCache` | module | every enabled wordlist's score distribution (via `_rescored`) | `invalidateHistogramLayout()` (called from `invalidateRescoredCache`) |
| `_libraryColumnWidthsCache` | module, versioned by `cacheVersion$` | every source's `rawEntries` + the merged set | next `cacheVersion$` bump |

Three composite helpers cover the common change patterns:

- **`invalidateWordlistCaches(wordlist)`** — when a wordlist's `rawEntries` change. Clears its `_rescored`, its stats cache, merged stats, and the merged caches.
- **`invalidateSourceCounts()`** — narrower. Used when source ordering, enabled flags, names, or any `_rescored` change but `rawEntries` did not. Clears the merged caches.
- **`refreshSourceCounts()`** — invalidate then re-warm `_sourceCountsCache` (it's read by the rail meta on every dialog refresh).

The `_mergedWordlistCache` is invalidated globally rather than per-affected-list because tracking dependencies isn't worth the complexity. Lazy rebuild on next access keeps the unaffected views free; only what's actually rendered pays the cost.

**Read live, don't snapshot.** Cache entries hold a `wordlist` reference rather than copying out display fields like `name`. Render-time code reads `entry.wordlist.name` so renames propagate without cache invalidation. The virtual scroller follows the same convention — `currentWordlist` is a ref, not a name string.

**Canonical keys throughout.** `_rescoredMap` and `_mergedWordlistCache.byNorm` are keyed by `wlEntry.norm`, which is the canonical letter form computed once at parse. Map keys share storage with the wlEntry's `norm` field, so construction allocates no extra strings and lookups never need an extra normalization step. `_mergedWordlistCache.byKey` keys by `mergeKey(norm, display)` for full (norm, display) disambiguation in the rare callers that need it.

**Hot path: switching wordlists.** First switch builds `_rescored` (lazy); subsequent switches are near-free.

**Hot path: editing rescore rules.** Commits go through `applyRescoreRulesChange(wordlist)`, which clears `_rescored` so the merged view picks up the new mapping. The set of distinct raw scores in the data — needed to compute `_uncovered` — does not depend on rules, so it lives on `wordlist._actualScores` and survives rule edits. The keystroke preview path also compiles rules once before handing them to the Library entries scroller, so the per-row `rescoreEntry` walk reads compiled intervals instead of re-parsing strings; for Broda-sized wordlists (~500K entries) that's millions of regex calls saved per keystroke.

**Hot path: editing My Edits.** Score and comment edits, new-entry adds, and deletes all route through `patchCachesForEditsChange`, which invalidates the merged cache; `refreshWorkshopMergedScroller` then re-runs the pipeline against the freshly-rebuilt cache. The earlier in-place patch path that mutated `_mergedWordlistCache.byNorm` in-place was retired with the rich-entry shift: the `(norm, display)` keying makes correct in-place patching significantly more complex, and the rebuild cost is accepted for now. Revisit when My Edits sizes or edit cadences make the cost visible.

**Hot path: typing in search.** Per-keystroke filtering is sized to avoid the two costs that dominate large wordlists — normalizing the entry and re-sorting the filtered result. The caches involved are scroller-internal (not in the table above): they belong to the active `WorkshopEntriesScroller` / `LibraryEntriesScroller` instance and end with the scroller's life.

- Every `wlEntry` carries `norm` and `display` set once at parse. Filters read those directly — no per-keystroke normalization across hundreds of thousands of entries. Merged-map entries and My Edits-edited entries share the same `norm` field with no duplication.
- The Workshop scroller keeps `_sortedSource` — `allEntries` sorted by the current `sortKey`/`sortDir`. `.filter()` preserves order, so the filter result is already sorted and the post-filter sort drops out.
- The Library scroller splits work two ways. `_baseRows` holds the unfiltered row data — `_buildRows()` walks `rawEntries` and applies `rescoreEntry`, and that result is rebuilt only on `setWordlist` / `setMode` / `setRescorePreview`. `_sortedBaseRows` is its sorted view, rebuilt on sort change. `setQuery` runs neither — it just refilters the cached sorted source.

The invalidation contract for the sort caches is the same trap as the patch path's: anything that mutates entry scores in place must clear them. `_invalidateSortCache()` (Workshop) and `_invalidateRowsCache()` (Library) cover the in-class setters; `refreshWorkshopMergedScroller` and `deleteFromEdits` call `_invalidateSortCache()` directly after patching the merged cache. A new touchpoint that mutates scores on shared entries needs the same call.

### Reactivity

Structural state and the view layer are reactive (signals + effects); the perf-critical caches above stay imperative. The split mirrors what production signal frameworks (Solid, Svelte 5, Preact signals) do internally.

A pure-reactive design — one big `merged$ = computed(() => buildMerged(sources$))` — re-derives the whole 1M-entry merged wordlist on every My Edits keystroke. The hybrid model keeps reactivity for the 90% of state where it doesn't fight performance, and leaves the cache layer alone where it earns its keep. Pushing further — replacing imperative caches with observable collections and the virtual scroller with per-row reactive components — is a possible future rewrite; see [`planned/per-row-reactivity.md`](planned/per-row-reactivity.md).

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

### Routes for Settings, Help?

Top-level views (Workshop, Library) are routed; setup-style dialogs (Settings, Help) aren't. Confirms/alerts/downloads stay as dialogs regardless — those really are transient.

Arguments in favor of routes for setup: setup screens are *places* users spend real time, URL-addressable means deep-linkable and reload-safe, narrow viewports turn modals into full-screen routes anyway. Currently sticking with dialogs because they match the existing codebase idiom.

Worth revisiting if the dialog-as-workspace feel becomes a friction point — particularly at narrow viewport widths, where a full-screen modal is essentially a route in disguise. Notes for that revisit: bookmark/share-setup-state is unlikely (so deep-linking isn't a strong driver, just reload-safety); back button does default browser behavior (navigates back to the wordlist); header stays a fixture with no dynamic content (no breadcrumbs). *"Routes for everything" — including confirms — was considered and dropped as too heavy-handed.*

### Workshop result-export

A copy-to-clipboard + save-as-file affordance for *query results* (anagrams, regex hits) on the Workshop entries table. Distinct from any wordlist download — query results are not wordlists. Parked for now; placement (sort cluster vs. table-region header vs. separate button) deferred.

### Disk storage: deferred gaps

Known limitations to address as the need surfaces:

- **External file renames.** The watcher sees the old name disappear and the new name appear, but `wordlist.filename` doesn't auto-update. The renamed file becomes an ignored "unknown" file; the original wordlist sits with no on-disk file. Resolve in Grawlix's UI (rename the wordlist) or accept the stale state until next migration.
- **External file deletions.** Wordlist stays in `state.sources` with stale rawEntries; the next edit re-creates the file. Same shape as rename.
- **Externally-created files for unknown wordlists.** A `.txt` dropped into the folder with no matching wordlist meta is ignored. A "load this as a new wordlist?" prompt would be the natural feature, not built.

## Non-features

Things explicitly *not* built, so the design doesn't drift back to them:

- **No persistence of in-progress mining state** beyond what the URL encodes. No "save my exploration" feature, no session restore.
- **No cross-wordlist comparison.** "Words in JK but not XWI" set-difference views are not a real workflow.
- **No scratchpad / working set.** My Edits is the only persistence concept.
- **No multi-pattern search.** Serial single queries are fine.
- **No recent-searches strip.** Search history is not preserved or surfaced.
- **No two-stack comparison UI.** Editing in place on the existing input (e.g., toggle Anagram between LINDSEY and LINDSEYS) handles it via live re-execution.
